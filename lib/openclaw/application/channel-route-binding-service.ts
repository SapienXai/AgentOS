import "server-only";

import { getOpenClawAdapter, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  type OpenClawConfigMutationOutcome,
  readConfigMutationOutcome
} from "@/lib/openclaw/application/config-mutation-result";
import { updateTelegramRoutePolicy } from "@/lib/openclaw/application/channel-route-policy-service";
import {
  buildChannelRouteIdentity,
  channelRouteKey,
  type ChannelAgentBinding,
  type ChannelRouteIdentity
} from "@/lib/openclaw/domains/channel-center";
import type { ChannelRegistry } from "@/lib/openclaw/types";
import { redactErrorMessage } from "@/lib/security/redaction";

export type OpenClawNativeRouteBinding = {
  agentId: string;
  match: Record<string, unknown>;
  [key: string]: unknown;
};

export type ChannelRouteBindingMatch = "exact" | "fallback" | "none" | "conflict";

export type ChannelRouteBindingConflict = {
  reason: "duplicate-native-binding" | "native-vs-compatibility" | "ambiguous-compatibility";
  route: ChannelRouteIdentity;
  agentIds: string[];
};

export type ChannelRouteBindingResolution = {
  route: ChannelRouteIdentity;
  agentId: string | null;
  explicitAgentId: string | null;
  source: "openclaw" | "agentos-compatibility" | "unknown";
  match: ChannelRouteBindingMatch;
  conflict: ChannelRouteBindingConflict | null;
};

export type ChannelRouteBindingMutation = {
  route: ChannelRouteIdentity;
  agentId: string | null;
  changed: boolean;
  source: "openclaw";
  configPath: string;
  applyMode: OpenClawConfigMutationOutcome["applyMode"];
  reloadKind: OpenClawConfigMutationOutcome["reloadKind"];
  restartRequired: boolean;
  hotReloaded: boolean;
  appliedVia: OpenClawConfigMutationOutcome["appliedVia"];
  pending: boolean;
  baseHash: string | null;
  changedPaths: string[];
};

export type ChannelRouteBindingMigrationConflict = ChannelRouteBindingConflict & {
  compatibilityAgentIds: string[];
  nativeAgentIds: string[];
};

export type ChannelRouteBindingMigrationResult = {
  changed: boolean;
  migrated: number;
  skipped: number;
  conflicts: ChannelRouteBindingMigrationConflict[];
  mutation: ChannelRouteBindingMutation | null;
};

export class ChannelRouteBindingConflictError extends Error {
  readonly conflict: ChannelRouteBindingConflict;

  constructor(conflict: ChannelRouteBindingConflict) {
    super(formatBindingConflict(conflict));
    this.name = "ChannelRouteBindingConflictError";
    this.conflict = conflict;
  }
}

export async function getChannelRouteBinding(
  route: ChannelRouteIdentity,
  options: {
    adapter?: OpenClawAdapter;
    compatibilityBinding?: ChannelAgentBinding | null;
  } = {}
): Promise<ChannelRouteBindingResolution> {
  const adapter = options.adapter ?? getOpenClawAdapter();

  if (route.kind === "topic") {
    return resolveTelegramTopicBinding(route, adapter, options.compatibilityBinding);
  }

  const bindings = await readNativeRouteBindings(adapter);
  return resolveChannelRouteBinding(route, bindings, options.compatibilityBinding);
}

export async function setChannelRouteBinding(input: {
  route: ChannelRouteIdentity;
  agentId: string | null;
  adapter?: OpenClawAdapter;
}): Promise<ChannelRouteBindingMutation> {
  const adapter = input.adapter ?? getOpenClawAdapter();
  const agentId = normalizeAgentId(input.agentId);

  if (input.route.kind === "topic") {
    if (input.route.provider !== "telegram") {
      throw new Error("Native topic agent routing is currently supported only for Telegram.");
    }

    const result = await updateTelegramRoutePolicy({
      accountId: input.route.accountId,
      groupId: requireParentRouteId(input.route),
      topicId: input.route.routeId,
      patch: { agentId }
    });

    return {
      route: input.route,
      agentId,
      changed: result.changedFields.includes("agentId"),
      source: "openclaw",
      configPath: result.configPath,
      applyMode: result.applyMode,
      reloadKind: result.reloadKind,
      restartRequired: result.restartRequired,
      hotReloaded: result.hotReloaded,
      appliedVia: result.appliedVia,
      pending: result.pending,
      baseHash: result.baseHash,
      changedPaths: result.changedPaths
    };
  }

  const currentBindings = await readNativeRouteBindings(adapter);
  const exact = findExactNativeBindings(input.route, currentBindings);

  if (exact.length > 1) {
    throw new ChannelRouteBindingConflictError({
      reason: "duplicate-native-binding",
      route: input.route,
      agentIds: exact.map((entry) => entry.binding.agentId)
    });
  }

  if (exact.length === 0 && agentId === null) {
    return createNoopMutation(input.route, null);
  }

  if (exact.length === 1 && exact[0]!.binding.agentId === agentId) {
    return createNoopMutation(input.route, agentId);
  }

  const nextBindings = [...currentBindings.raw];
  if (exact.length === 1) {
    const current = nextBindings[exact[0]!.index];
    if (!isRecord(current)) {
      throw new Error("The OpenClaw route binding changed while it was being edited. Refresh and try again.");
    }

    if (agentId === null) {
      nextBindings.splice(exact[0]!.index, 1);
    } else {
      nextBindings[exact[0]!.index] = { ...current, agentId };
    }
  } else if (agentId) {
    nextBindings.push(buildNativeRouteBinding(input.route, agentId));
  }

  const result = await adapter.setConfig("bindings", nextBindings, {
    strictJson: true,
    ...(currentBindings.baseHash ? { baseHash: currentBindings.baseHash } : {}),
    replacePaths: ["bindings"],
    timeoutMs: 15_000
  });
  const mutation = readConfigMutationOutcome(result, "bindings");

  return {
    route: input.route,
    agentId,
    changed: true,
    source: "openclaw",
    configPath: mutation.path,
    applyMode: mutation.applyMode,
    reloadKind: mutation.reloadKind,
    restartRequired: mutation.restartRequired,
    hotReloaded: mutation.hotReloaded,
    appliedVia: mutation.appliedVia,
    pending: mutation.pending,
    baseHash: mutation.baseHash,
    changedPaths: mutation.changedPaths
  };
}

export async function clearChannelRouteBinding(input: {
  route: ChannelRouteIdentity;
  adapter?: OpenClawAdapter;
}) {
  return setChannelRouteBinding({ ...input, agentId: null });
}

export async function migrateLegacyChannelRouteBindings(input: {
  registry: ChannelRegistry;
  workspaceId?: string | null;
  adapter?: OpenClawAdapter;
}): Promise<ChannelRouteBindingMigrationResult> {
  const adapter = input.adapter ?? getOpenClawAdapter();
  const currentBindings = await readNativeRouteBindings(adapter);
  const candidates = collectLegacyTelegramAssignments(input.registry, input.workspaceId);
  const nextBindings = [...currentBindings.raw];
  const conflicts: ChannelRouteBindingMigrationConflict[] = [];
  let migrated = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const exact = findExactNativeBindings(candidate.route, currentBindings);
    if (exact.length > 1) {
      conflicts.push({
        reason: "duplicate-native-binding",
        route: candidate.route,
        agentIds: exact.map((entry) => entry.binding.agentId),
        compatibilityAgentIds: candidate.agentIds,
        nativeAgentIds: exact.map((entry) => entry.binding.agentId)
      });
      skipped += 1;
      continue;
    }

    const effectiveNative = resolveChannelRouteBinding(candidate.route, currentBindings);
    if (effectiveNative.match === "conflict") {
      const nativeAgentIds = currentBindings.entries
        .filter((entry) => scoreNativeBinding(candidate.route, entry) !== null)
        .map((entry) => entry.binding.agentId);
      conflicts.push({
        reason: "duplicate-native-binding",
        route: candidate.route,
        agentIds: Array.from(new Set([...nativeAgentIds, ...candidate.agentIds])),
        compatibilityAgentIds: candidate.agentIds,
        nativeAgentIds: Array.from(new Set(nativeAgentIds))
      });
      skipped += 1;
      continue;
    }

    if (exact.length === 1) {
      const nativeAgentId = exact[0]!.binding.agentId;
      if (candidate.agentIds.length !== 1 || candidate.agentIds[0] !== nativeAgentId) {
        conflicts.push({
          reason: "native-vs-compatibility",
          route: candidate.route,
          agentIds: Array.from(new Set([nativeAgentId, ...candidate.agentIds])),
          compatibilityAgentIds: candidate.agentIds,
          nativeAgentIds: [nativeAgentId]
        });
      } else {
        skipped += 1;
      }
      continue;
    }

    if (effectiveNative.source === "openclaw" && effectiveNative.agentId) {
      if (candidate.agentIds.length !== 1 || candidate.agentIds[0] !== effectiveNative.agentId) {
        conflicts.push({
          reason: "native-vs-compatibility",
          route: candidate.route,
          agentIds: Array.from(new Set([effectiveNative.agentId, ...candidate.agentIds])),
          compatibilityAgentIds: candidate.agentIds,
          nativeAgentIds: [effectiveNative.agentId]
        });
      } else {
        skipped += 1;
      }
      continue;
    }

    if (candidate.agentIds.length !== 1) {
      conflicts.push({
        reason: "ambiguous-compatibility",
        route: candidate.route,
        agentIds: candidate.agentIds,
        compatibilityAgentIds: candidate.agentIds,
        nativeAgentIds: []
      });
      skipped += 1;
      continue;
    }

    nextBindings.push(buildNativeRouteBinding(candidate.route, candidate.agentIds[0]!));
    migrated += 1;
  }

  if (migrated === 0) {
    return { changed: false, migrated, skipped, conflicts, mutation: null };
  }

  const result = await adapter.setConfig("bindings", nextBindings, {
    strictJson: true,
    ...(currentBindings.baseHash ? { baseHash: currentBindings.baseHash } : {}),
    replacePaths: ["bindings"],
    timeoutMs: 15_000
  });
  const mutation = readConfigMutationOutcome(result, "bindings");

  return {
    changed: true,
    migrated,
    skipped,
    conflicts,
    mutation: {
      route: buildChannelRouteIdentity({
        provider: "telegram",
        accountId: "*",
        kind: "peer",
        routeId: "legacy-migration"
      }),
      agentId: null,
      changed: true,
      source: "openclaw",
      configPath: mutation.path,
      applyMode: mutation.applyMode,
      reloadKind: mutation.reloadKind,
      restartRequired: mutation.restartRequired,
      hotReloaded: mutation.hotReloaded,
      appliedVia: mutation.appliedVia,
      pending: mutation.pending,
      baseHash: mutation.baseHash,
      changedPaths: mutation.changedPaths
    }
  };
}

export async function readNativeRouteBindings(adapter: OpenClawAdapter = getOpenClawAdapter()) {
  let value: unknown = null;
  let baseHash: string | null = null;
  let available = false;

  if (adapter.getConfigSnapshot) {
    try {
      const snapshot = await adapter.getConfigSnapshot({ timeoutMs: 10_000 });
      const config = isRecord(snapshot.config) ? snapshot.config : {};
      const resolved = isRecord(snapshot.resolved) ? snapshot.resolved : {};
      if (Object.prototype.hasOwnProperty.call(config, "bindings")) {
        value = config.bindings;
        available = true;
      } else if (Object.prototype.hasOwnProperty.call(resolved, "bindings")) {
        value = resolved.bindings;
        available = true;
      }
      baseHash = normalizeString(snapshot.hash ?? snapshot.configRevisionHash ?? snapshot.appliedConfigHash);
    } catch {
      value = await adapter.getConfig<unknown>("bindings", { timeoutMs: 10_000 });
      available = value !== null && value !== undefined;
    }
  } else {
    value = await adapter.getConfig<unknown>("bindings", { timeoutMs: 10_000 });
    available = value !== null && value !== undefined;
  }

  const raw = Array.isArray(value) ? value : [];
  const entries = raw
    .map((entry, index) => normalizeNativeRouteBinding(entry, index))
    .filter((entry): entry is NormalizedNativeRouteBinding => Boolean(entry));

  return { raw, entries, baseHash, available };
}

export function resolveChannelRouteBinding(
  route: ChannelRouteIdentity,
  bindings: { entries: NormalizedNativeRouteBinding[] } | NormalizedNativeRouteBinding[],
  compatibilityBinding?: ChannelAgentBinding | null
): ChannelRouteBindingResolution {
  const entries = Array.isArray(bindings) ? bindings : bindings.entries;
  const candidates = entries
    .map((entry) => ({ entry, score: scoreNativeBinding(route, entry) }))
    .filter((candidate): candidate is { entry: NormalizedNativeRouteBinding; score: number } => candidate.score !== null)
    .sort((left, right) => right.score - left.score);

  const topScore = candidates[0]?.score ?? null;
  const top = topScore === null ? [] : candidates.filter((candidate) => candidate.score === topScore).map((candidate) => candidate.entry);
  const explicit = top.filter((entry) => isExactNativeRouteMatch(route, entry));

  if (top.length > 1) {
    return {
      route,
      agentId: null,
      explicitAgentId: explicit.length === 1 ? explicit[0]!.binding.agentId : null,
      source: "unknown",
      match: "conflict",
      conflict: {
        reason: "duplicate-native-binding",
        route,
        agentIds: Array.from(new Set(top.map((entry) => entry.binding.agentId)))
      }
    };
  }

  if (top.length === 1) {
    const selected = top[0]!;
    return {
      route,
      agentId: selected.binding.agentId,
      explicitAgentId: isExactNativeRouteMatch(route, selected) ? selected.binding.agentId : null,
      source: "openclaw",
      match: isExactNativeRouteMatch(route, selected) ? "exact" : "fallback",
      conflict: null
    };
  }

  if (compatibilityBinding?.agentId) {
    return {
      route,
      agentId: compatibilityBinding.agentId,
      explicitAgentId: compatibilityBinding.agentId,
      source: "agentos-compatibility",
      match: "exact",
      conflict: null
    };
  }

  return {
    route,
    agentId: null,
    explicitAgentId: null,
    source: "unknown",
    match: "none",
    conflict: null
  };
}

export function buildNativeRouteBinding(route: ChannelRouteIdentity, agentId: string): OpenClawNativeRouteBinding {
  const match: Record<string, unknown> = {
    channel: route.provider,
    accountId: route.accountId
  };

  if (route.kind === "role") {
    match.roles = [route.routeId];
    if (route.parentRouteId) match.guildId = route.parentRouteId;
  } else {
    match.peer = {
      kind: nativePeerKind(route),
      id: route.routeId
    };
    if (route.parentRouteId && (route.kind === "channel" || route.kind === "thread")) {
      match.guildId = route.parentRouteId;
    }
  }

  return { agentId, match };
}

function resolveTelegramTopicBinding(
  route: ChannelRouteIdentity,
  adapter: OpenClawAdapter,
  compatibilityBinding?: ChannelAgentBinding | null
): Promise<ChannelRouteBindingResolution> {
  if (route.provider !== "telegram") {
    throw new Error("Native topic agent routing is currently supported only for Telegram.");
  }

  return adapter
    .getConfig<Record<string, unknown>>("channels.telegram", { timeoutMs: 10_000 })
    .then((config) => {
      const group = resolveTelegramGroup(config, route.accountId, requireParentRouteId(route));
      const topics = isRecord(group?.topics) ? group.topics : {};
      const topic = topics[route.routeId];
      const agentId = isRecord(topic) ? normalizeAgentId(topic.agentId) : null;

      if (agentId) {
        return {
          route,
          agentId,
          explicitAgentId: agentId,
          source: "openclaw" as const,
          match: "exact" as const,
          conflict: null
        };
      }

      if (compatibilityBinding?.agentId) {
        return {
          route,
          agentId: compatibilityBinding.agentId,
          explicitAgentId: compatibilityBinding.agentId,
          source: "agentos-compatibility" as const,
          match: "exact" as const,
          conflict: null
        };
      }

      return {
        route,
        agentId: null,
        explicitAgentId: null,
        source: "unknown" as const,
        match: "none" as const,
        conflict: null
      };
    });
}

function findExactNativeBindings(route: ChannelRouteIdentity, snapshot: { entries: NormalizedNativeRouteBinding[] }) {
  return snapshot.entries.filter((entry) => isExactNativeRouteMatch(route, entry));
}

function isExactNativeRouteMatch(route: ChannelRouteIdentity, entry: NormalizedNativeRouteBinding) {
  const score = scoreNativeBinding(route, entry);
  return score !== null && score >= 120;
}

function scoreNativeBinding(route: ChannelRouteIdentity, entry: NormalizedNativeRouteBinding) {
  const match = entry.binding.match;
  if (normalizeString(match.channel)?.toLowerCase() !== route.provider.toLowerCase()) {
    return null;
  }

  const accountScore = scoreAccountMatch(route.accountId, normalizeString(match.accountId));
  if (accountScore === null) {
    return null;
  }

  if (route.kind === "role") {
    const roles = normalizeStringArray(match.roles);
    if (!roles.includes(route.routeId)) {
      return matchHasNoRoute(match) ? accountScore : null;
    }
    if (route.parentRouteId && normalizeString(match.guildId) && normalizeString(match.guildId) !== route.parentRouteId) {
      return null;
    }
    return 120 + accountScore;
  }

  const peer = isRecord(match.peer) ? match.peer : null;
  if (peer) {
    if (normalizeString(peer.kind) !== nativePeerKind(route) || normalizeString(peer.id) !== route.routeId) {
      return null;
    }
    if (route.parentRouteId && normalizeString(match.guildId) && normalizeString(match.guildId) !== route.parentRouteId) {
      return null;
    }
    return 120 + accountScore;
  }

  return matchHasNoRoute(match) ? accountScore : null;
}

function matchHasNoRoute(match: Record<string, unknown>) {
  return !match.peer && !Array.isArray(match.roles);
}

function scoreAccountMatch(routeAccountId: string, bindingAccountId: string | null) {
  if (bindingAccountId === "*") return 10;
  if (bindingAccountId) return bindingAccountId === routeAccountId ? 20 : null;
  return routeAccountId === "default" ? 10 : null;
}

type NormalizedNativeRouteBinding = {
  index: number;
  binding: OpenClawNativeRouteBinding;
};

function normalizeNativeRouteBinding(value: unknown, index: number): NormalizedNativeRouteBinding | null {
  if (!isRecord(value) || value.type === "acp" || !isRecord(value.match)) {
    return null;
  }

  const agentId = normalizeAgentId(value.agentId);
  const channel = normalizeString(value.match.channel);
  if (!agentId || !channel) {
    return null;
  }

  return {
    index,
    binding: {
      ...value,
      agentId,
      match: { ...value.match, channel }
    }
  };
}

function collectLegacyTelegramAssignments(registry: ChannelRegistry, workspaceId?: string | null) {
  const byRoute = new Map<string, { route: ChannelRouteIdentity; agentIds: string[] }>();

  for (const channel of registry.channels.filter((entry) => entry.type === "telegram")) {
    const accountId = channel.id;
    const workspaces = workspaceId
      ? channel.workspaces.filter((workspace) => workspace.workspaceId === workspaceId)
      : channel.workspaces;

    for (const workspace of workspaces) {
      for (const assignment of workspace.groupAssignments) {
        const agentId = normalizeAgentId(assignment.agentId);
        const routeId = assignment.chatId.trim();
        if (!agentId || !routeId) continue;

        const route = buildChannelRouteIdentity({
          provider: "telegram",
          accountId,
          kind: "group",
          routeId
        });
        const key = channelRouteKey(route);
        const existing = byRoute.get(key);
        if (existing) {
          if (!existing.agentIds.includes(agentId)) existing.agentIds.push(agentId);
        } else {
          byRoute.set(key, { route, agentIds: [agentId] });
        }
      }
    }
  }

  return Array.from(byRoute.values());
}

function resolveTelegramGroup(config: Record<string, unknown> | null, accountId: string, groupId: string) {
  if (!isRecord(config)) return null;
  const accounts = isRecord(config.accounts) ? config.accounts : {};
  const accountConfig = isRecord(accounts[accountId]) ? accounts[accountId] : null;
  const groups = accountConfig && Object.prototype.hasOwnProperty.call(accountConfig, "groups")
    ? accountConfig.groups
    : config.groups;
  return isRecord(groups) && isRecord(groups[groupId]) ? groups[groupId] : null;
}

function requireParentRouteId(route: ChannelRouteIdentity) {
  const parent = route.parentRouteId?.trim();
  if (!parent) throw new Error("A Telegram topic requires its parent group route.");
  return parent;
}

function nativePeerKind(route: ChannelRouteIdentity) {
  return route.kind === "dm" ? "direct" : route.kind;
}

function createNoopMutation(route: ChannelRouteIdentity, agentId: string | null): ChannelRouteBindingMutation {
  return {
    route,
    agentId,
    changed: false,
    source: "openclaw",
    configPath: "bindings",
    applyMode: "live",
    reloadKind: "none",
    restartRequired: false,
    hotReloaded: false,
    appliedVia: "noop",
    pending: false,
    baseHash: null,
    changedPaths: []
  };
}

function formatBindingConflict(conflict: ChannelRouteBindingConflict) {
  return `OpenClaw has conflicting native bindings for ${conflict.route.provider}/${conflict.route.accountId}/${conflict.route.routeId}. Resolve the binding in the OpenClaw Control UI before editing it.`;
}

function normalizeAgentId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() || null : null;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value) ? value.map(normalizeString).filter((entry): entry is string => Boolean(entry)) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatChannelRouteBindingError(error: unknown) {
  return redactErrorMessage(error, "OpenClaw channel route binding could not be updated.");
}
