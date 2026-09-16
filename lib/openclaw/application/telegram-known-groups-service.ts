import "server-only";

import { getOpenClawAdapter, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  listConfiguredChannelGroups,
  type ChannelDirectoryEntry
} from "@/lib/openclaw/application/channel-directory-service";
import {
  readNativeRouteBindings,
  readOpenClawDefaultAgentId,
  resolveChannelRouteBinding,
  type OpenClawNativeRouteBinding
} from "@/lib/openclaw/application/channel-route-binding-service";
import { buildChannelRouteIdentity } from "@/lib/openclaw/domains/channel-center";
import { readChannelRegistry } from "@/lib/openclaw/domains/channels";
import type {
  ChannelRegistry,
  WorkspaceChannelGroupAssignment
} from "@/lib/openclaw/types";
import type { OpenClawSessionsPayload } from "@/lib/openclaw/client/types";
import { redactErrorMessage } from "@/lib/security/redaction";

export type TelegramKnownGroupSource =
  | "openclaw-config"
  | "openclaw-binding"
  | "agentos-registry"
  | "openclaw-session";

export type TelegramKnownGroup = {
  accountId: string;
  chatId: string;
  title: string;
  titleSource: "observed" | "stored" | "chat-id";
  configured: boolean;
  connectedAgentId: string | null;
  historicalAgentId: string | null;
  source: TelegramKnownGroupSource;
  sources: TelegramKnownGroupSource[];
  connectable: boolean;
  historical: boolean;
  bindingConflict: boolean;
  lastObservedAt: string | null;
};

export type TelegramKnownGroupsResult = {
  provider: "telegram";
  accountId: string;
  groups: TelegramKnownGroup[];
  observation: {
    supported: boolean;
    available: boolean;
    source: "openclaw-gateway-sessions";
    error: string | null;
  };
};

export type TelegramKnownGroupCandidate = {
  accountId: string;
  chatId: string;
  title?: string | null;
  titlePriority?: number;
  titleSource?: "observed" | "stored";
  configured?: boolean;
  source: TelegramKnownGroupSource;
  connectedAgentId?: string | null;
  historicalAgentId?: string | null;
  bindingConflict?: boolean;
  lastObservedAt?: string | null;
};

type ParsedTelegramSession = {
  accountId: string;
  chatId: string;
  title: string | null;
  lastObservedAt: string | null;
};

const SOURCE_PRIORITY: Record<TelegramKnownGroupSource, number> = {
  "openclaw-config": 4,
  "openclaw-binding": 3,
  "agentos-registry": 2,
  "openclaw-session": 1
};

const NUMERIC_TELEGRAM_CHAT_ID = /^-?\d+$/;
const TELEGRAM_GROUP_SESSION_KEY = /^agent:[^:]+:telegram:group:(-?\d+)$/;
const TELEGRAM_GROUP_ORIGIN = /^telegram:(?:group|channel):(-?\d+)$/;
const TELEGRAM_GROUP_TARGET = /^telegram:(-?\d+)$/;

export async function listTelegramKnownGroups(input: {
  accountId: string;
  workspaceId?: string | null;
  adapter?: OpenClawAdapter;
  registry?: ChannelRegistry;
}): Promise<TelegramKnownGroupsResult> {
  const accountId = normalizeRequiredAccountId(input.accountId);
  const adapter = input.adapter ?? getOpenClawAdapter();

  const [configuredResult, registry, bindingState, defaultAgentId, observed] = await Promise.all([
    listConfiguredChannelGroups({ provider: "telegram", accountId, limit: 500 }).catch((error) => ({
      entries: [] as ChannelDirectoryEntry[],
      status: "failed" as const,
      error: redactErrorMessage(error, "OpenClaw Telegram configuration is unavailable.")
    })),
    input.registry ? Promise.resolve(input.registry) : readChannelRegistry(),
    readBindingState(adapter),
    readOpenClawDefaultAgentId(adapter),
    readObservedTelegramSessions(adapter)
  ]);

  const candidates: TelegramKnownGroupCandidate[] = [
    ...configuredResult.entries
      .filter((entry) => entry.kind === "group" && entry.accountId === accountId)
      .map((entry) => configuredCandidate(entry)),
    ...readRegistryCandidates(registry, accountId, input.workspaceId),
    ...readBindingCandidates(bindingState.entries, accountId),
    ...observed.sessions
      .map((session) => parseTelegramSessionGroup(session))
      .filter((candidate): candidate is ParsedTelegramSession => Boolean(candidate))
      .filter((candidate) => candidate.accountId === accountId)
      .map((candidate) => ({
        accountId: candidate.accountId,
        chatId: candidate.chatId,
        title: candidate.title,
        titlePriority: 3,
        titleSource: "observed" as const,
        source: "openclaw-session" as const,
        lastObservedAt: candidate.lastObservedAt
      }))
  ];

  const merged = mergeTelegramKnownGroups(candidates);
  const groups = merged.map((group) => {
    const route = buildChannelRouteIdentity({
      provider: "telegram",
      accountId: group.accountId,
      kind: "group",
      routeId: group.chatId,
      metadata: { nativePeerKind: "group" }
    });
    const compatibilityBinding = !bindingState.available && group.historicalAgentId
      ? {
          route,
          agentId: group.historicalAgentId,
          workspaceId: input.workspaceId ?? null,
          source: "agentos-compatibility" as const
        }
      : null;
    const resolution = resolveChannelRouteBinding(
      route,
      bindingState,
      compatibilityBinding,
      defaultAgentId
    );
    const connectedAgentId = resolution.agentId && resolution.source === "openclaw"
      ? resolution.agentId
      : null;
    const bindingConflict = group.bindingConflict || resolution.editingAmbiguity;

    return {
      ...group,
      connectedAgentId,
      connectable: !bindingConflict && !connectedAgentId,
      bindingConflict
    } satisfies TelegramKnownGroup;
  });

  return {
    provider: "telegram",
    accountId,
    groups,
    observation: {
      supported: observed.supported,
      available: observed.available,
      source: "openclaw-gateway-sessions",
      error: observed.error
    }
  };
}

/**
 * Pure projection seam used by the API and tests. The key is deliberately
 * provider/account/chat identity, never the display title.
 */
export function mergeTelegramKnownGroups(
  candidates: readonly TelegramKnownGroupCandidate[]
): TelegramKnownGroup[] {
  const merged = new Map<string, {
    accountId: string;
    chatId: string;
    title: string | null;
    titlePriority: number;
    titleSource: "observed" | "stored" | null;
    configured: boolean;
    connectedAgentIds: string[];
    historicalAgentIds: string[];
    source: TelegramKnownGroupSource;
    sources: TelegramKnownGroupSource[];
    bindingConflict: boolean;
    lastObservedAt: string | null;
  }>();

  for (const candidate of candidates) {
    const accountId = candidate.accountId.trim();
    const chatId = candidate.chatId.trim();
    if (!accountId || !NUMERIC_TELEGRAM_CHAT_ID.test(chatId)) continue;

    const key = `${accountId}:${chatId}`;
    const existing = merged.get(key);
    const title = normalizeTitle(candidate.title);
    const titlePriority = title ? candidate.titlePriority ?? 1 : 0;
    const nextSource = existing && SOURCE_PRIORITY[candidate.source] > SOURCE_PRIORITY[existing.source]
      ? candidate.source
      : existing?.source ?? candidate.source;
    const sources = existing?.sources ?? [];
    if (!sources.includes(candidate.source)) sources.push(candidate.source);

    if (!existing) {
      merged.set(key, {
        accountId,
        chatId,
        title,
        titlePriority,
        titleSource: title ? candidate.titleSource ?? "stored" : null,
        configured: candidate.configured === true,
        connectedAgentIds: uniqueStrings(candidate.connectedAgentId ? [candidate.connectedAgentId] : []),
        historicalAgentIds: uniqueStrings(candidate.historicalAgentId ? [candidate.historicalAgentId] : []),
        source: candidate.source,
        sources,
        bindingConflict: candidate.bindingConflict === true,
        lastObservedAt: candidate.lastObservedAt ?? null
      });
      continue;
    }

    if (title && titlePriority > existing.titlePriority) {
      existing.title = title;
      existing.titlePriority = titlePriority;
      existing.titleSource = candidate.titleSource ?? "stored";
    }
    existing.configured ||= candidate.configured === true;
    existing.connectedAgentIds = uniqueStrings([
      ...existing.connectedAgentIds,
      ...(candidate.connectedAgentId ? [candidate.connectedAgentId] : [])
    ]);
    existing.historicalAgentIds = uniqueStrings([
      ...existing.historicalAgentIds,
      ...(candidate.historicalAgentId ? [candidate.historicalAgentId] : [])
    ]);
    existing.source = nextSource;
    existing.bindingConflict ||= candidate.bindingConflict === true;
    existing.lastObservedAt = latestTimestamp(existing.lastObservedAt, candidate.lastObservedAt ?? null);
  }

  return Array.from(merged.values())
    .sort((left, right) => (left.title ?? left.chatId).localeCompare(right.title ?? right.chatId))
    .map((entry) => {
      const bindingConflict = entry.bindingConflict || entry.connectedAgentIds.length > 1;
      const connectedAgentId = entry.connectedAgentIds[0] ?? null;
      const historicalAgentId = entry.historicalAgentIds[0] ?? null;
      const titleSource = entry.titleSource ?? "chat-id";
      return {
        accountId: entry.accountId,
        chatId: entry.chatId,
        title: entry.title ?? entry.chatId,
        titleSource,
        configured: entry.configured,
        connectedAgentId,
        historicalAgentId,
        source: entry.source,
        sources: [...entry.sources].sort((left, right) => SOURCE_PRIORITY[right] - SOURCE_PRIORITY[left]),
        connectable: !bindingConflict && !connectedAgentId,
        historical: !entry.configured && (entry.sources.includes("agentos-registry") || entry.sources.includes("openclaw-session")),
        bindingConflict,
        lastObservedAt: entry.lastObservedAt
      } satisfies TelegramKnownGroup;
    });
}

/** Parses only structured OpenClaw session fields; no transcript or log text is inspected. */
export function parseTelegramSessionGroup(
  session: Record<string, unknown>,
  fallbackAccountId = "default"
): ParsedTelegramSession | null {
  const key = normalizeString(session.key);
  const origin = asRecord(session.origin);
  const deliveryContext = asRecord(session.deliveryContext);
  const participants = Array.isArray(session.participants) ? session.participants : [];
  const participantAccountId = participants
    .map((participant) => asRecord(asRecord(participant)?.identity)?.accountId)
    .map(normalizeString)
    .find(Boolean) ?? null;
  const channel = normalizeString(session.channel)
    ?? normalizeString(origin?.provider)
    ?? normalizeString(origin?.surface)
    ?? (key?.includes(":telegram:") ? "telegram" : null);
  if (channel?.toLowerCase() !== "telegram") return null;

  const keyId = key ? TELEGRAM_GROUP_SESSION_KEY.exec(key)?.[1] ?? null : null;
  const originId = normalizeTelegramOriginId(origin?.from) ?? normalizeTelegramOriginId(origin?.to);
  const chatId = keyId ?? originId;
  const kind = normalizeString(session.peerKind)
    ?? normalizeString(session.chatType)
    ?? normalizeString(session.kind)
    ?? normalizeString(origin?.chatType);
  if (!chatId || !NUMERIC_TELEGRAM_CHAT_ID.test(chatId) || (kind && kind !== "group")) return null;
  if (!keyId && !originId) return null;

  const accountId = normalizeString(origin?.accountId)
    ?? normalizeString(deliveryContext?.accountId)
    ?? normalizeString(session.lastAccountId)
    ?? normalizeString(session.accountId)
    ?? participantAccountId
    ?? fallbackAccountId;
  const title = normalizeTitle(
    session.subject
      ?? session.groupChannel
      ?? session.space
      ?? session.displayName
      ?? session.label
  );

  return {
    accountId,
    chatId,
    title,
    lastObservedAt: normalizeTimestamp(session.updatedAt)
  };
}

function configuredCandidate(entry: ChannelDirectoryEntry): TelegramKnownGroupCandidate {
  return {
    accountId: entry.accountId,
    chatId: entry.routeId,
    title: entry.title,
    titlePriority: 2,
    titleSource: "stored",
    configured: true,
    source: "openclaw-config"
  };
}

function readRegistryCandidates(
  registry: ChannelRegistry,
  accountId: string,
  workspaceId?: string | null
): TelegramKnownGroupCandidate[] {
  const channel = registry.channels.find((entry) => entry.type === "telegram" && entry.id === accountId);
  if (!channel) return [];

  const workspaces = workspaceId
    ? channel.workspaces.filter((workspace) => workspace.workspaceId === workspaceId)
    : channel.workspaces;

  return workspaces.flatMap((workspace) => workspace.groupAssignments)
    .filter((assignment) => NUMERIC_TELEGRAM_CHAT_ID.test(assignment.chatId.trim()))
    .map((assignment) => registryCandidate(accountId, assignment));
}

function registryCandidate(accountId: string, assignment: WorkspaceChannelGroupAssignment): TelegramKnownGroupCandidate {
  return {
    accountId,
    chatId: assignment.chatId.trim(),
    title: assignment.title,
    titlePriority: 2,
    titleSource: "stored",
    source: "agentos-registry",
    historicalAgentId: normalizeString(assignment.agentId)
  };
}

function readBindingCandidates(
  bindings: Array<{ binding: OpenClawNativeRouteBinding; index: number }>,
  accountId: string
): TelegramKnownGroupCandidate[] {
  return bindings.flatMap(({ binding }) => {
    const match = asRecord(binding.match);
    if (normalizeString(match?.channel)?.toLowerCase() !== "telegram") return [];
    const bindingAccountId = normalizeString(match?.accountId);
    if (bindingAccountId && bindingAccountId !== "*" && bindingAccountId !== accountId) return [];
    const peer = asRecord(match?.peer);
    if (normalizeString(peer?.kind) !== "group") return [];
    const chatId = normalizeString(peer?.id);
    const agentId = normalizeString(binding.agentId);
    if (!chatId || !agentId || !NUMERIC_TELEGRAM_CHAT_ID.test(chatId)) return [];
    return [{
      accountId,
      chatId,
      source: "openclaw-binding" as const,
      connectedAgentId: agentId
    }];
  });
}

async function readBindingState(adapter: OpenClawAdapter) {
  try {
    const snapshot = await readNativeRouteBindings(adapter);
    return {
      available: snapshot.available,
      entries: snapshot.entries
    };
  } catch {
    return {
      available: false,
      entries: [] as Array<{ binding: OpenClawNativeRouteBinding; index: number }>
    };
  }
}

async function readObservedTelegramSessions(adapter: OpenClawAdapter) {
  if (typeof adapter.listSessions !== "function") {
    return {
      supported: false,
      available: false,
      sessions: [] as OpenClawSessionsPayload["sessions"],
      error: "OpenClaw does not expose a structured session list in this runtime."
    };
  }

  try {
    const result = await adapter.listSessions({
      limit: 500,
      includeDerivedTitles: true,
      includeGlobal: true,
      includeUnknown: true
    }, { timeoutMs: 10_000 });
    return {
      supported: true,
      available: true,
      sessions: result.sessions,
      error: null
    };
  } catch (error) {
    return {
      supported: true,
      available: false,
      sessions: [] as OpenClawSessionsPayload["sessions"],
      error: redactErrorMessage(error, "OpenClaw observed Telegram sessions are unavailable.")
    };
  }
}

function normalizeRequiredAccountId(value: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error("A Telegram account is required to list known groups.");
  return normalized;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim() || null
    : null;
}

function normalizeTitle(value: unknown): string | null {
  const normalized = normalizeString(value);
  if (!normalized || NUMERIC_TELEGRAM_CHAT_ID.test(normalized)) return null;
  return normalized;
}

function normalizeTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  return null;
}

function latestTimestamp(left: string | null, right: string | null) {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(right) > Date.parse(left) ? right : left;
}

function normalizeTelegramOriginId(value: unknown) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  return normalized.match(TELEGRAM_GROUP_ORIGIN)?.[1]
    ?? normalized.match(TELEGRAM_GROUP_TARGET)?.[1]
    ?? null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
