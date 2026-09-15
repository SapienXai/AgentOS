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
  nativePeerKindsMatch,
  routeNativePeerKind,
  serializeRouteToOpenClawBindingMatch,
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

export type ChannelRouteBindingMatch =
  | "exact"
  | "inherited"
  | "fallback"
  | "shadowed"
  | "overlapping"
  | "ambiguous-edit"
  | "none"
  // Kept for compatibility with older API consumers. New effective routing
  // diagnostics use shadowed/ambiguous-edit instead of runtime conflict.
  | "conflict";

export type ChannelRouteBindingEffectiveMatch = "exact" | "inherited" | "fallback" | "none";

export type ChannelRouteBindingMatchedBy =
  | "binding.peer"
  | "binding.peer.parent"
  | "binding.peer.wildcard"
  | "binding.guild+roles"
  | "binding.guild"
  | "binding.team"
  | "binding.account"
  | "binding.channel"
  | "default";

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
  effectiveMatch: ChannelRouteBindingEffectiveMatch;
  matchedBy: ChannelRouteBindingMatchedBy | null;
  sourceBinding: OpenClawNativeRouteBinding | null;
  inheritedFrom: ChannelRouteIdentity | null;
  shadowedBindings: OpenClawNativeRouteBinding[];
  editingAmbiguity: boolean;
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
      patch: { agentId },
      adapter
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

  if (input.route.kind === "thread") {
    if (agentId === null) {
      return createNoopMutation(input.route, null);
    }
    throw new Error(
      "OpenClaw routes thread messages through the parent peer binding in this release; direct thread overrides are not supported."
    );
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
    if (effectiveNative.editingAmbiguity) {
      const nativeAgentIds = currentBindings.entries
        .filter((entry) => isRouteCandidate(candidate.route, entry))
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
  const resolution = resolveNativeRouteCandidate(route, entries);

  if (resolution) {
    const shadowedBindings = resolution.matches
      .slice(1)
      .map((candidate) => candidate.binding);
    const effectiveMatch = resolution.matchedBy === "binding.peer"
      ? "exact"
      : resolution.matchedBy === "binding.peer.parent"
        ? "inherited"
        : "fallback";
    const exact = effectiveMatch === "exact";

    return {
      route,
      agentId: resolution.selected.binding.agentId,
      explicitAgentId: exact ? resolution.selected.binding.agentId : null,
      source: "openclaw",
      match: shadowedBindings.length > 0 ? "shadowed" : effectiveMatch,
      effectiveMatch,
      matchedBy: resolution.matchedBy,
      sourceBinding: resolution.selected.binding,
      inheritedFrom: effectiveMatch === "inherited" ? inheritedRoute(route, resolution.context.parentPeer) : null,
      shadowedBindings,
      editingAmbiguity: shadowedBindings.length > 0,
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
      effectiveMatch: "exact",
      matchedBy: null,
      sourceBinding: null,
      inheritedFrom: null,
      shadowedBindings: [],
      editingAmbiguity: false,
      conflict: null
    };
  }

  return {
    route,
    agentId: null,
    explicitAgentId: null,
    source: "unknown",
    match: "none",
    effectiveMatch: "none",
    matchedBy: null,
    sourceBinding: null,
    inheritedFrom: null,
    shadowedBindings: [],
    editingAmbiguity: false,
    conflict: null
  };
}

export function buildNativeRouteBinding(route: ChannelRouteIdentity, agentId: string): OpenClawNativeRouteBinding {
  const match = serializeRouteToOpenClawBindingMatch(route);
  if (!match) {
    throw new Error(
      `The ${route.provider} ${route.kind} route cannot be represented by an OpenClaw native binding. It follows provider-native inheritance instead.`
    );
  }
  return { agentId, match };
}

async function resolveTelegramTopicBinding(
  route: ChannelRouteIdentity,
  adapter: OpenClawAdapter,
  compatibilityBinding?: ChannelAgentBinding | null
): Promise<ChannelRouteBindingResolution> {
  if (route.provider !== "telegram") {
    throw new Error("Native topic agent routing is currently supported only for Telegram.");
  }

  const config = await adapter.getConfig<Record<string, unknown>>("channels.telegram", { timeoutMs: 10_000 });
  const groupId = requireParentRouteId(route);
  const group = resolveTelegramGroup(config, route.accountId, groupId);
  const topics = isRecord(group?.topics) ? group.topics : {};
  const topic = topics[route.routeId];
  const agentId = isRecord(topic) ? normalizeAgentId(topic.agentId) : null;

  if (agentId) {
    return {
      route,
      agentId,
      explicitAgentId: agentId,
      source: "openclaw",
      match: "exact",
      effectiveMatch: "exact",
      matchedBy: null,
      sourceBinding: null,
      inheritedFrom: null,
      shadowedBindings: [],
      editingAmbiguity: false,
      conflict: null
    };
  }

  // Telegram topics are provider-native child config. When a topic has no
  // explicit agentId, the parent group's native binding is still effective.
  const parentRoute = buildChannelRouteIdentity({
    provider: route.provider,
    accountId: route.accountId,
    kind: "group",
    routeId: groupId
  });
  const parentBindings = await readNativeRouteBindings(adapter);
  const parentResolution = resolveChannelRouteBinding(parentRoute, parentBindings);
  if (parentResolution.agentId) {
    return {
      ...parentResolution,
      route,
      effectiveMatch: "inherited",
      match: parentResolution.match === "shadowed" ? "shadowed" : "inherited",
      explicitAgentId: null,
      inheritedFrom: parentRoute
    };
  }

  if (compatibilityBinding?.agentId) {
    return {
      route,
      agentId: compatibilityBinding.agentId,
      explicitAgentId: compatibilityBinding.agentId,
      source: "agentos-compatibility",
      match: "exact",
      effectiveMatch: "exact",
      matchedBy: null,
      sourceBinding: null,
      inheritedFrom: null,
      shadowedBindings: [],
      editingAmbiguity: false,
      conflict: null
    };
  }

  return {
    route,
    agentId: null,
    explicitAgentId: null,
    source: "unknown",
    match: "none",
    effectiveMatch: "none",
    matchedBy: null,
    sourceBinding: null,
    inheritedFrom: null,
    shadowedBindings: [],
    editingAmbiguity: false,
    conflict: null
  };
}

function findExactNativeBindings(route: ChannelRouteIdentity, snapshot: { entries: NormalizedNativeRouteBinding[] }) {
  return snapshot.entries.filter((entry) => isExactNativeRouteMatch(route, entry));
}

function isExactNativeRouteMatch(route: ChannelRouteIdentity, entry: NormalizedNativeRouteBinding) {
  const target = serializeRouteToOpenClawBindingMatch(route);
  if (!target || !bindingMatchIsExact(entry.binding.match, target, route.accountId)) {
    return false;
  }
  return true;
}

type NormalizedNativeRouteBinding = {
  index: number;
  binding: OpenClawNativeRouteBinding;
};

type NativePeer = {
  kind: "direct" | "group" | "channel";
  id: string;
};

type NativeRouteContext = {
  peer: NativePeer | null;
  parentPeer: NativePeer | null;
  guildId: string | null;
  teamId: string | null;
  memberRoleIds: string[];
};

type NativeRouteCandidate = {
  selected: NormalizedNativeRouteBinding;
  matches: NormalizedNativeRouteBinding[];
  matchedBy: ChannelRouteBindingMatchedBy;
  context: NativeRouteContext;
};

function resolveNativeRouteCandidate(
  route: ChannelRouteIdentity,
  entries: NormalizedNativeRouteBinding[]
): NativeRouteCandidate | null {
  const context = buildNativeRouteContext(route);
  const tiers: Array<{
    matchedBy: Exclude<ChannelRouteBindingMatchedBy, "default">;
    enabled: boolean;
    matches: (entry: NormalizedNativeRouteBinding) => boolean;
  }> = [
    {
      matchedBy: "binding.peer",
      enabled: Boolean(context.peer),
      matches: (entry) => matchesPeerTier(entry, context.peer, context)
    },
    {
      matchedBy: "binding.peer.parent",
      enabled: Boolean(context.parentPeer),
      matches: (entry) => matchesPeerTier(entry, context.parentPeer, context)
    },
    {
      matchedBy: "binding.peer.wildcard",
      enabled: Boolean(context.peer),
      matches: (entry) => matchesWildcardPeerTier(entry, context.peer, context)
    },
    {
      matchedBy: "binding.guild+roles",
      enabled: Boolean(context.guildId && context.memberRoleIds.length > 0),
      matches: (entry) => matchesGuildRoleTier(entry, context)
    },
    {
      matchedBy: "binding.guild",
      enabled: Boolean(context.guildId),
      matches: (entry) => matchesGuildTier(entry, context)
    },
    {
      matchedBy: "binding.team",
      enabled: Boolean(context.teamId),
      matches: (entry) => matchesTeamTier(entry, context)
    },
    {
      matchedBy: "binding.account",
      enabled: true,
      matches: (entry) => matchesAccountTier(entry, route.accountId, context)
    },
    {
      matchedBy: "binding.channel",
      enabled: true,
      matches: (entry) => matchesChannelTier(entry, context)
    }
  ];

  for (const tier of tiers) {
    if (!tier.enabled) continue;
    const matches = entries.filter(tier.matches);
    const selected = matches[0];
    if (selected) {
      return { selected, matches, matchedBy: tier.matchedBy, context };
    }
  }

  return null;
}

function buildNativeRouteContext(route: ChannelRouteIdentity): NativeRouteContext {
  const metadata = route.metadata ?? {};
  const serialized = serializeRouteToOpenClawBindingMatch(route);
  const peer = readNativePeer(serialized?.peer);
  const provider = route.provider.toLowerCase();
  const parentPeer = route.kind === "thread" && route.parentRouteId
    ? {
        kind: metadata.parentPeerKind ?? (provider === "discord" || provider === "slack" ? "channel" : "group"),
        id: route.parentRouteId
      }
    : null;

  const guildId = normalizeString(serialized?.guildId) ?? normalizeString(metadata.guildId);
  const teamId = normalizeString(serialized?.teamId) ?? normalizeString(metadata.teamId);
  const memberRoleIds = Array.from(new Set([
    ...(Array.isArray(metadata.memberRoleIds) ? normalizeStringArray(metadata.memberRoleIds) : []),
    ...(route.kind === "role" ? [route.routeId] : [])
  ]));

  return { peer, parentPeer, guildId, teamId, memberRoleIds };
}

function isRouteCandidate(route: ChannelRouteIdentity, entry: NormalizedNativeRouteBinding) {
  const context = buildNativeRouteContext(route);
  return [
    matchesPeerTier(entry, context.peer, context),
    matchesPeerTier(entry, context.parentPeer, context),
    matchesWildcardPeerTier(entry, context.peer, context),
    matchesGuildRoleTier(entry, context),
    matchesGuildTier(entry, context),
    matchesTeamTier(entry, context),
    matchesAccountTier(entry, route.accountId, context),
    matchesChannelTier(entry, context)
  ].some(Boolean);
}

function matchesPeerTier(entry: NormalizedNativeRouteBinding, peer: NativePeer | null, context: NativeRouteContext) {
  const bindingPeer = readNativePeer(entry.binding.match.peer);
  if (!peer || !bindingPeer || !nativePeerKindsMatch(bindingPeer.kind, peer.kind) || bindingPeer.id !== peer.id) {
    return false;
  }
  return matchesBindingScope(entry, context, peer);
}

function matchesWildcardPeerTier(entry: NormalizedNativeRouteBinding, peer: NativePeer | null, context: NativeRouteContext) {
  const rawPeer = isRecord(entry.binding.match.peer) ? entry.binding.match.peer : null;
  const kind = rawPeer ? normalizeNativePeerKind(rawPeer.kind) : null;
  const id = rawPeer ? normalizeString(rawPeer.id) : null;
  if (!peer || !kind || id !== "*" || !nativePeerKindsMatch(kind, peer.kind)) return false;
  return matchesBindingScope(entry, context, peer);
}

function matchesGuildRoleTier(entry: NormalizedNativeRouteBinding, context: NativeRouteContext) {
  const guildId = normalizeString(entry.binding.match.guildId);
  const roles = normalizeStringArray(entry.binding.match.roles);
  if (!context.guildId || !guildId || guildId !== context.guildId || roles.length === 0) return false;
  return matchesBindingScope(entry, context, context.peer);
}

function matchesGuildTier(entry: NormalizedNativeRouteBinding, context: NativeRouteContext) {
  const guildId = normalizeString(entry.binding.match.guildId);
  if (!context.guildId || !guildId || guildId !== context.guildId || normalizeStringArray(entry.binding.match.roles).length > 0) {
    return false;
  }
  return matchesBindingScope(entry, context, context.peer);
}

function matchesTeamTier(entry: NormalizedNativeRouteBinding, context: NativeRouteContext) {
  const teamId = normalizeString(entry.binding.match.teamId);
  if (!context.teamId || !teamId || teamId !== context.teamId) return false;
  return matchesBindingScope(entry, context, context.peer);
}

function matchesAccountTier(entry: NormalizedNativeRouteBinding, accountId: string, context: NativeRouteContext) {
  const bindingAccount = normalizeAccountPattern(entry.binding.match.accountId);
  if (bindingAccount === "*") return false;
  if (bindingAccount !== normalizeAccountPattern(accountId)) return false;
  return matchesBindingScope(entry, context, context.peer);
}

function matchesChannelTier(entry: NormalizedNativeRouteBinding, context: NativeRouteContext) {
  if (normalizeAccountPattern(entry.binding.match.accountId) !== "*") return false;
  return matchesBindingScope(entry, context, context.peer);
}

function matchesBindingScope(
  entry: NormalizedNativeRouteBinding,
  context: NativeRouteContext,
  scopePeer: NativePeer | null
) {
  const bindingPeer = readNativePeer(entry.binding.match.peer);
  const rawPeer = isRecord(entry.binding.match.peer) ? entry.binding.match.peer : null;
  const wildcardKind = rawPeer ? normalizeNativePeerKind(rawPeer.kind) : null;
  const rawPeerId = rawPeer ? normalizeString(rawPeer.id) : null;

  if (bindingPeer && (!scopePeer || !nativePeerKindsMatch(bindingPeer.kind, scopePeer.kind) || bindingPeer.id !== scopePeer.id)) {
    return false;
  }
  if (rawPeerId === "*" && (!scopePeer || !wildcardKind || !nativePeerKindsMatch(wildcardKind, scopePeer.kind))) {
    return false;
  }
  if (normalizeString(entry.binding.match.guildId) && normalizeString(entry.binding.match.guildId) !== context.guildId) {
    return false;
  }
  if (normalizeString(entry.binding.match.teamId) && normalizeString(entry.binding.match.teamId) !== context.teamId) {
    return false;
  }
  const roles = normalizeStringArray(entry.binding.match.roles);
  if (roles.length > 0 && !roles.some((role) => context.memberRoleIds.includes(role))) {
    return false;
  }
  return true;
}

function inheritedRoute(route: ChannelRouteIdentity, parentPeer: NativePeer | null) {
  if (!parentPeer) return null;
  const provider = route.provider.toLowerCase();
  return buildChannelRouteIdentity({
    provider: route.provider,
    accountId: route.accountId,
    kind: parentPeer.kind === "channel" ? "channel" : "group",
    routeId: parentPeer.id,
    parentRouteId: provider === "discord"
      ? route.metadata?.guildId ?? null
      : provider === "slack"
        ? route.metadata?.teamId ?? null
        : null,
    metadata: {
      nativePeerKind: parentPeer.kind,
      ...(route.metadata?.guildId ? { guildId: route.metadata.guildId } : {}),
      ...(route.metadata?.teamId ? { teamId: route.metadata.teamId } : {})
    }
  });
}

function bindingMatchIsExact(
  binding: Record<string, unknown>,
  target: Record<string, unknown>,
  accountId: string
) {
  const supportedKeys = new Set(["channel", "accountId", "peer", "guildId", "teamId", "roles"]);
  if (Object.keys(binding).some((key) => !supportedKeys.has(key))) return false;
  if (normalizeString(binding.channel)?.toLowerCase() !== normalizeString(target.channel)?.toLowerCase()) return false;
  const bindingAccount = normalizeAccountPattern(binding.accountId);
  if (bindingAccount === "*" || bindingAccount !== normalizeAccountPattern(accountId)) return false;

  const targetPeer = readNativePeer(target.peer);
  const bindingPeer = readNativePeer(binding.peer);
  if (Boolean(targetPeer) !== Boolean(bindingPeer)) return false;
  if (targetPeer && bindingPeer && (!nativePeerKindsMatch(targetPeer.kind, bindingPeer.kind) || targetPeer.id !== bindingPeer.id)) return false;

  for (const field of ["guildId", "teamId"] as const) {
    if (normalizeString(binding[field]) !== normalizeString(target[field])) return false;
  }

  const targetRoles = normalizeStringArray(target.roles);
  const bindingRoles = normalizeStringArray(binding.roles);
  if (targetRoles.length !== bindingRoles.length || targetRoles.some((role) => !bindingRoles.includes(role))) return false;
  return true;
}

function readNativePeer(value: unknown): NativePeer | null {
  if (!isRecord(value)) return null;
  const kind = normalizeNativePeerKind(value.kind);
  const id = normalizeString(value.id);
  return kind && id && id !== "*" ? { kind, id } : null;
}

function normalizeNativePeerKind(value: unknown): "direct" | "group" | "channel" | null {
  if (value === "dm") return "direct";
  return value === "direct" || value === "group" || value === "channel" ? value : null;
}

function normalizeAccountPattern(value: unknown) {
  return (normalizeString(value) ?? "default").toLowerCase();
}

function normalizeNativeRouteBinding(value: unknown, index: number): NormalizedNativeRouteBinding | null {
  if (!isRecord(value) || value.type === "acp" || !isRecord(value.match)) {
    return null;
  }

  if (isRecord(value.match.peer) && !normalizeNativePeerKind(value.match.peer.kind)) {
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
