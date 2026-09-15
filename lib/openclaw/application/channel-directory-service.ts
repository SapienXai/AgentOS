import "server-only";

import { runOpenClawJson } from "@/lib/openclaw/cli";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  readNativeRouteBindings,
  resolveChannelRouteBinding
} from "@/lib/openclaw/application/channel-route-binding-service";
import {
  buildChannelRouteIdentity,
  normalizeChannelRouteKind,
  type ChannelRouteAccessPolicy,
  type ChannelRouteKind
} from "@/lib/openclaw/domains/channel-center";
import type { MissionControlSurfaceProvider, WorkspaceChannelGroupAssignment } from "@/lib/openclaw/types";
import { measureTiming, type TimingCollector } from "@/lib/openclaw/timing";
import { redactErrorMessage } from "@/lib/security/redaction";

export type ChannelDirectorySource = "openclaw-gateway" | "openclaw-cli" | "openclaw-config" | "agentos-compatibility";
export type ChannelDirectoryStatus = "ok" | "empty" | "unsupported" | "failed";

export type ChannelDirectoryEntry = {
  routeId: string;
  kind: ChannelRouteKind;
  accountId: string;
  parentRouteId: string | null;
  title: string | null;
  handle: string | null;
  avatarUrl: string | null;
  memberCount: number | null;
  rank: number | null;
  agentId: string | null;
  bindingSource: "openclaw" | "agentos-compatibility" | null;
  bindingMatch: "exact" | "fallback" | "none" | "conflict" | null;
  bindingConflict: boolean;
  accessPolicy: ChannelRouteAccessPolicy | null;
};

export type ChannelDirectoryResult = {
  provider: MissionControlSurfaceProvider;
  accountId: string | null;
  entries: ChannelDirectoryEntry[];
  source: ChannelDirectorySource;
  status: ChannelDirectoryStatus;
  fallbackReason: string | null;
  error: string | null;
};

export type ChannelDirectoryListInput = {
  provider: MissionControlSurfaceProvider;
  accountId?: string | null;
  query?: string | null;
  limit?: number | null;
  resolveBindings?: boolean;
  compatibilityAssignments?: WorkspaceChannelGroupAssignment[];
};

export type ChannelDirectoryMembersInput = ChannelDirectoryListInput & {
  groupId: string;
};

type ChannelDirectoryTransport = {
  source: Exclude<ChannelDirectorySource, "openclaw-config" | "agentos-compatibility">;
  listPeers(input: ChannelDirectoryListInput): Promise<unknown>;
  listGroups(input: ChannelDirectoryListInput): Promise<unknown>;
  listGroupMembers(input: ChannelDirectoryMembersInput): Promise<unknown>;
};

const cliDirectoryTransport: ChannelDirectoryTransport = {
  source: "openclaw-cli",
  listPeers: (input) => runOpenClawJson(buildDirectoryArgs("peers", "list", input), { timeoutMs: 15_000 }),
  listGroups: (input) => runOpenClawJson(buildDirectoryArgs("groups", "list", input), { timeoutMs: 15_000 }),
  listGroupMembers: (input) => runOpenClawJson(buildDirectoryArgs("groups", "members", input), { timeoutMs: 15_000 })
};

let directoryTransport: ChannelDirectoryTransport = cliDirectoryTransport;

/** Test-only transport seam. Production callers should not select transports. */
export function setChannelDirectoryTransportForTesting(transport: ChannelDirectoryTransport | null) {
  directoryTransport = transport ?? cliDirectoryTransport;
}

export async function listChannelPeers(
  input: ChannelDirectoryListInput,
  options: { timings?: TimingCollector } = {}
): Promise<ChannelDirectoryResult> {
  const result = await listDirectoryEntries("peers", input, options);
  return input.resolveBindings ? enrichRouteBindings(result, input) : result;
}

export async function listChannelGroups(
  input: ChannelDirectoryListInput,
  options: { timings?: TimingCollector } = {}
): Promise<ChannelDirectoryResult> {
  const result = await listDirectoryEntries("groups", input, options);

  if (result.status !== "unsupported" || input.provider !== "telegram") {
    return input.resolveBindings ? enrichRouteBindings(result, input) : result;
  }

  const compatibility = await readTelegramGroupsFromConfig(input, options.timings);
  if (compatibility.entries.length > 0 || compatibility.status === "empty") {
    const resolved = {
      ...compatibility,
      fallbackReason: result.error ?? "OpenClaw directory groups are unsupported for this installed provider."
    };
    return input.resolveBindings ? enrichRouteBindings(resolved, input) : resolved;
  }

  return input.resolveBindings ? enrichRouteBindings(result, input) : result;
}

export async function listChannelGroupMembers(
  input: ChannelDirectoryMembersInput,
  options: { timings?: TimingCollector } = {}
): Promise<ChannelDirectoryResult> {
  const accountId = normalizeAccountId(input.accountId);
  const result = await listDirectoryEntries("members", input, options);
  return {
    ...result,
    accountId
  };
}

export async function listTelegramTopics(
  input: { accountId: string; groupId: string; query?: string | null; limit?: number | null },
  options: { timings?: TimingCollector } = {}
): Promise<ChannelDirectoryResult> {
  const accountId = normalizeAccountId(input.accountId);
  if (!accountId) {
    return createResult("telegram", null, [], "openclaw-config", "failed", null, "A Telegram account is required to list topics.");
  }

  try {
    const config = await measureTiming(options.timings, "telegram-directory.read-topic-config", () =>
      getOpenClawAdapter().getConfig<Record<string, unknown>>("channels.telegram", { timeoutMs: 10_000 })
    );
    const groups = resolveTelegramAccountGroups(config, accountId);
    const group = groups[input.groupId];
    const topics = isRecord(group) && isRecord(group.topics) ? group.topics : {};
    const entries = Object.entries(topics)
      .map(([topicId, rawTopic]) => normalizeTopicEntry(topicId, rawTopic, accountId, input.groupId))
      .filter((entry): entry is ChannelDirectoryEntry => Boolean(entry))
      .filter((entry) => matchesQuery(entry, input.query))
      .slice(0, normalizeLimit(input.limit));

    return createResult(
      "telegram",
      accountId,
      entries,
      "openclaw-config",
      entries.length > 0 ? "ok" : "empty",
      null,
      null
    );
  } catch (error) {
    return createResult(
      "telegram",
      accountId,
      [],
      "openclaw-config",
      "failed",
      null,
      redactErrorMessage(error, "OpenClaw Telegram topic configuration is unavailable.")
    );
  }
}

async function listDirectoryEntries(
  kind: "peers" | "groups" | "members",
  input: ChannelDirectoryListInput | ChannelDirectoryMembersInput,
  options: { timings?: TimingCollector }
): Promise<ChannelDirectoryResult> {
  const accountId = normalizeAccountId(input.accountId);
  const provider = input.provider.trim();

  if (!provider) {
    return createResult(provider, accountId, [], directoryTransport.source, "failed", null, "A channel provider is required.");
  }

  try {
    const payload = await measureTiming(options.timings, `channel-directory.${kind}`, () => {
      if (kind === "peers") {
        return directoryTransport.listPeers(input);
      }
      if (kind === "groups") {
        return directoryTransport.listGroups(input);
      }
      return directoryTransport.listGroupMembers(input as ChannelDirectoryMembersInput);
    });

    const envelope = readErrorEnvelope(payload);
    if (envelope) {
      const unsupported = isUnsupportedDirectoryError(envelope.message, envelope.type);
      return createResult(provider, accountId, [], directoryTransport.source, unsupported ? "unsupported" : "failed", null, envelope.message);
    }

    const extracted = extractList(payload);
    if (extracted.malformed) {
      return createResult(
        provider,
        accountId,
        [],
        directoryTransport.source,
        "failed",
        null,
        "OpenClaw returned an unrecognized directory result."
      );
    }

    const entries = extracted.items
      .map((entry, index) => normalizeDirectoryEntry(entry, {
        provider,
        accountId,
        kind: kind === "peers" ? "peer" : kind === "groups" ? "group" : "peer",
        parentRouteId: kind === "members" ? (input as ChannelDirectoryMembersInput).groupId : null,
        rank: index
      }))
      .filter((entry): entry is ChannelDirectoryEntry => Boolean(entry))
      .filter((entry) => matchesQuery(entry, input.query))
      .slice(0, normalizeLimit(input.limit));

    if (extracted.items.length > 0 && entries.length === 0) {
      return createResult(
        provider,
        accountId,
        [],
        directoryTransport.source,
        "failed",
        null,
        "OpenClaw returned directory entries without usable route identities."
      );
    }

    return createResult(provider, accountId, entries, directoryTransport.source, entries.length > 0 ? "ok" : "empty", null, null);
  } catch (error) {
    const message = redactErrorMessage(error, "OpenClaw channel directory is unavailable.");
    return createResult(
      provider,
      accountId,
      [],
      directoryTransport.source,
      isUnsupportedDirectoryError(message, null) ? "unsupported" : "failed",
      null,
      message
    );
  }
}

async function readTelegramGroupsFromConfig(input: ChannelDirectoryListInput, timings?: TimingCollector): Promise<ChannelDirectoryResult> {
  const accountId = normalizeAccountId(input.accountId);
  if (!accountId) {
    return createResult("telegram", null, [], "openclaw-config", "failed", null, "A Telegram account is required to list groups.");
  }

  try {
    const config = await measureTiming(timings, "telegram-directory.read-group-config", () =>
      getOpenClawAdapter().getConfig<Record<string, unknown>>("channels.telegram", { timeoutMs: 10_000 })
    );
    const groups = resolveTelegramAccountGroups(config, accountId);
    const entries = Object.entries(groups)
      .map(([groupId, rawGroup], index) => normalizeDirectoryEntry(rawGroup, {
        provider: "telegram",
        accountId,
        kind: "group",
        routeId: groupId,
        rank: index
      }))
      .filter((entry): entry is ChannelDirectoryEntry => Boolean(entry))
      .filter((entry) => matchesQuery(entry, input.query))
      .slice(0, normalizeLimit(input.limit));

    return createResult("telegram", accountId, entries, "openclaw-config", entries.length > 0 ? "ok" : "empty", null, null);
  } catch (error) {
    return createResult(
      "telegram",
      accountId,
      [],
      "openclaw-config",
      "failed",
      null,
      redactErrorMessage(error, "OpenClaw Telegram group configuration is unavailable.")
    );
  }
}

function buildDirectoryArgs(
  resource: "peers" | "groups",
  action: "list" | "members",
  input: ChannelDirectoryListInput | ChannelDirectoryMembersInput
) {
  const args = ["directory", resource, action, "--channel", input.provider.trim()];
  const accountId = normalizeAccountId(input.accountId);
  if (accountId) {
    args.push("--account", accountId);
  }
  if (action === "members") {
    const groupId = (input as ChannelDirectoryMembersInput).groupId.trim();
    if (!groupId) {
      throw new Error("A group ID is required to list members.");
    }
    args.push("--group-id", groupId);
  }
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (query) {
    args.push("--query", query);
  }
  const limit = normalizeLimit(input.limit);
  if (limit !== DEFAULT_LIMIT) {
    args.push("--limit", String(limit));
  }
  args.push("--json");
  return args;
}

const DEFAULT_LIMIT = 200;

function normalizeLimit(value: number | null | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? Math.min(value, 500) : DEFAULT_LIMIT;
}

function normalizeAccountId(value: string | null | undefined) {
  const accountId = typeof value === "string" ? value.trim() : "";
  return accountId || null;
}

function extractList(payload: unknown): { items: unknown[]; malformed: boolean } {
  if (Array.isArray(payload)) {
    return { items: payload, malformed: false };
  }
  if (!isRecord(payload)) {
    return { items: [], malformed: true };
  }
  for (const key of ["items", "entries", "peers", "groups", "members"]) {
    if (Array.isArray(payload[key])) {
      return { items: payload[key], malformed: false };
    }
  }
  return { items: [], malformed: true };
}

function normalizeDirectoryEntry(
  value: unknown,
  input: {
    provider: MissionControlSurfaceProvider;
    accountId: string | null;
    kind: ChannelRouteKind;
    parentRouteId?: string | null;
    routeId?: string;
    rank: number;
  }
): ChannelDirectoryEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const routeId = normalizeString(input.routeId ?? value.id ?? value.routeId ?? value.peerId ?? value.chatId);
  if (!routeId || !input.accountId) {
    return null;
  }

  const identity = buildChannelRouteIdentity({
    provider: input.provider,
    accountId: input.accountId,
    kind: normalizeChannelRouteKind(value.kind ?? value.type ?? input.kind),
    routeId,
    parentRouteId: input.parentRouteId
  });

  return {
    routeId: identity.routeId,
    kind: identity.kind,
    accountId: identity.accountId,
    parentRouteId: identity.parentRouteId,
    title: normalizeString(value.name ?? value.title ?? value.label),
    handle: normalizeString(value.handle ?? value.username ?? value.address),
    avatarUrl: normalizeString(value.avatarUrl ?? value.avatar ?? value.imageUrl),
    memberCount: normalizeNumber(value.memberCount ?? value.membersCount ?? value.member_count),
    rank: input.rank,
    agentId: normalizeString(value.agentId ?? value.agent),
    bindingSource: null,
    bindingMatch: null,
    bindingConflict: false,
    accessPolicy: normalizeAccessPolicy(value)
  };
}

function normalizeTopicEntry(topicId: string, value: unknown, accountId: string, groupId: string): ChannelDirectoryEntry | null {
  const normalized = normalizeDirectoryEntry(value, {
    provider: "telegram",
    accountId,
    kind: "topic",
    routeId: topicId,
    parentRouteId: groupId,
    rank: 0
  });
  if (!normalized) {
    return null;
  }
  return {
    ...normalized,
    title: normalized.title ?? (topicId === "*" ? "All topics" : `Topic ${topicId}`),
    agentId: normalizeString(isRecord(value) ? value.agentId : null),
    bindingSource: normalized.agentId ? "openclaw" : null,
    bindingMatch: normalized.agentId ? "exact" : null,
    bindingConflict: false,
    accessPolicy: isRecord(value) ? normalizeAccessPolicy(value) : normalized.accessPolicy
  };
}

async function enrichRouteBindings(result: ChannelDirectoryResult, input: ChannelDirectoryListInput) {
  if (!input.accountId || result.entries.length === 0) {
    return result;
  }

  let snapshot: Awaited<ReturnType<typeof readNativeRouteBindings>> = { raw: [], entries: [], baseHash: null };
  try {
    snapshot = await readNativeRouteBindings(getOpenClawAdapter());
  } catch {
    // Compatibility assignment is only a migration bridge. If no bridge was supplied,
    // keep the directory data useful without inventing a runtime binding.
    if (!input.compatibilityAssignments?.length) return result;
  }

  const compatibilityByRouteId = new Map(
    (input.compatibilityAssignments ?? [])
      .filter((assignment) => assignment.chatId.trim())
      .map((assignment) => [assignment.chatId.trim(), assignment] as const)
  );

  return {
    ...result,
    entries: result.entries.map((entry) => {
      const route = buildChannelRouteIdentity({
        provider: result.provider,
        accountId: entry.accountId,
        kind: entry.kind,
        routeId: entry.routeId,
        parentRouteId: entry.parentRouteId
      });
      const legacyAssignment = compatibilityByRouteId.get(entry.routeId);
      const resolution = resolveChannelRouteBinding(
        route,
        snapshot,
        legacyAssignment
          ? {
              route,
              agentId: legacyAssignment.agentId,
              workspaceId: null,
              source: "agentos-compatibility"
            }
          : null
      );

      return {
        ...entry,
        agentId: resolution.match === "conflict" ? null : resolution.agentId ?? entry.agentId,
        bindingSource: resolution.source === "unknown" ? (entry.agentId ? "openclaw" : null) : resolution.source,
        bindingMatch: resolution.match,
        bindingConflict: Boolean(resolution.conflict)
      };
    })
  };
}

function normalizeAccessPolicy(value: Record<string, unknown>): ChannelRouteAccessPolicy | null {
  const hasPolicy = ["enabled", "groupPolicy", "groupAllowFrom", "allowFrom", "requireMention"].some((key) => key in value);
  if (!hasPolicy) {
    return null;
  }
  const allowFrom = value.groupAllowFrom ?? value.allowFrom;
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : null,
    groupPolicy: normalizeString(value.groupPolicy),
    allowFrom: Array.isArray(allowFrom)
      ? allowFrom.filter((entry): entry is string => typeof entry === "string").slice(0, 200)
      : [],
    requireMention: typeof value.requireMention === "boolean" ? value.requireMention : null,
    source: "openclaw"
  };
}

function resolveTelegramAccountGroups(config: Record<string, unknown> | null, accountId: string) {
  if (!isRecord(config)) {
    return {} as Record<string, unknown>;
  }
  const accounts = isRecord(config.accounts) ? config.accounts : {};
  const accountConfig = isRecord(accounts[accountId]) ? accounts[accountId] : null;
  if (accountConfig && Object.prototype.hasOwnProperty.call(accountConfig, "groups")) {
    return isRecord(accountConfig.groups) ? accountConfig.groups : {};
  }
  if (Object.prototype.hasOwnProperty.call(config, "groups")) {
    return isRecord(config.groups) ? config.groups : {};
  }
  return {} as Record<string, unknown>;
}

function matchesQuery(entry: ChannelDirectoryEntry, query: string | null | undefined) {
  const normalized = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!normalized) {
    return true;
  }
  return [entry.routeId, entry.title, entry.handle]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(normalized));
}

function createResult(
  provider: MissionControlSurfaceProvider,
  accountId: string | null,
  entries: ChannelDirectoryEntry[],
  source: ChannelDirectorySource,
  status: ChannelDirectoryStatus,
  fallbackReason: string | null,
  error: string | null
): ChannelDirectoryResult {
  return { provider, accountId, entries, source, status, fallbackReason, error };
}

function readErrorEnvelope(value: unknown) {
  if (!isRecord(value) || value.ok !== false || !isRecord(value.error)) {
    return null;
  }
  return {
    type: normalizeString(value.error.type),
    message: normalizeString(value.error.message) ?? "OpenClaw directory request failed."
  };
}

function isUnsupportedDirectoryError(message: string | null, type: string | null) {
  return Boolean(type?.toLowerCase().includes("unsupported") || message && /unsupported|does not support|not available|unknown command/i.test(message));
}

function normalizeString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() || null : null;
}

function normalizeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type { ChannelDirectoryTransport };
