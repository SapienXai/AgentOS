import "server-only";

import { getOpenClawAdapter, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  readNativeRouteBindings,
  readOpenClawDefaultAgentId,
  resolveChannelRouteBinding,
  type ChannelRouteBindingMatch,
  type OpenClawNativeRouteBinding
} from "@/lib/openclaw/application/channel-route-binding-service";
import {
  buildChannelRouteIdentity,
  channelRouteKey,
  serializeRouteToOpenClawBindingMatch,
  type ChannelRouteIdentity,
  type ChannelRouteKind
} from "@/lib/openclaw/domains/channel-center";
import type { ChannelRouteMetadata } from "@/lib/openclaw/domains/channel-center";
import type { MissionControlSurfaceProvider } from "@/lib/openclaw/types";

export type AgentChannelRouteDisplayMatch = "explicit" | "inherited" | "default";

export type AgentChannelRouteProjection = {
  id: string;
  route: ChannelRouteIdentity | null;
  provider: MissionControlSurfaceProvider | null;
  accountId: string | null;
  kind: ChannelRouteKind | null;
  title: string;
  subtitle: string;
  scope: "route" | "account";
  effectiveAgentId: string | null;
  explicitAgentId: string | null;
  displayMatch: AgentChannelRouteDisplayMatch;
  bindingMatch: ChannelRouteBindingMatch;
  source: "openclaw";
  inheritedFrom: ChannelRouteIdentity | null;
  editable: boolean;
  editingAmbiguity: boolean;
  shadowedBindingCount: number;
};

export type AgentChannelRouteSummary = {
  agentId: string;
  routes: AgentChannelRouteProjection[];
  defaultAgentId: string | null;
  source: "openclaw";
  diagnostics: {
    topicConfig: "read" | "unavailable" | "not-requested";
  };
};

/**
 * Read-only agent projection of OpenClaw's native route bindings.
 *
 * This is deliberately not a second routing model. The route-binding service
 * remains the only mutation and resolution authority; this service only makes
 * the already-authoritative state useful from the Agent Profile surface.
 */
export async function getAgentChannelRouteSummary(input: {
  agentId: string;
  adapter?: OpenClawAdapter;
}): Promise<AgentChannelRouteSummary> {
  const agentId = normalizeAgentId(input.agentId);
  if (!agentId) {
    throw new Error("An agent id is required to read channel routes.");
  }

  const adapter = input.adapter ?? getOpenClawAdapter();
  const bindings = await readNativeRouteBindings(adapter);
  const defaultAgentId = await readOpenClawDefaultAgentId(adapter);
  const projections: AgentChannelRouteProjection[] = [];
  for (const entry of bindings.entries) {
    if (entry.binding.agentId !== agentId) continue;
    const projection = projectNativeBinding(entry.binding, entry.index, bindings, defaultAgentId);
    if (projection) projections.push(projection);
  }

  let topicConfig: AgentChannelRouteSummary["diagnostics"]["topicConfig"] = "not-requested";
  try {
    const topics = await readTelegramTopicProjections({ agentId, adapter, bindings, defaultAgentId });
    projections.push(...topics);
    topicConfig = "read";
  } catch {
    // Native binding summaries remain useful when provider-native topic
    // config cannot be read. The degraded state is explicit in diagnostics.
    topicConfig = "unavailable";
  }

  if (defaultAgentId === agentId) {
    projections.push(createDefaultProjection(agentId));
  }

  return {
    agentId,
    routes: dedupeProjections(projections),
    defaultAgentId,
    source: "openclaw",
    diagnostics: { topicConfig }
  };
}

/**
 * Normalize a directory result for a selected agent without changing the
 * directory's native resolution. Agent Profile uses this for lazy Add route
 * previews; Channels uses the same underlying directory service directly.
 */
export function projectChannelDirectoryEntryForAgent(input: {
  entry: {
    provider: MissionControlSurfaceProvider;
    routeId: string;
    kind: ChannelRouteKind;
    accountId: string;
    parentRouteId: string | null;
    title: string | null;
    handle: string | null;
    metadata: ChannelRouteMetadata;
    agentId: string | null;
    bindingSource: "openclaw" | "agentos-compatibility" | null;
    bindingMatch: ChannelRouteBindingMatch | null;
    bindingEditingAmbiguous: boolean;
    inheritedFrom: ChannelRouteIdentity | null;
    shadowedBindingCount: number;
  };
  agentId: string;
}): AgentChannelRouteProjection | null {
  const targetAgentId = normalizeAgentId(input.agentId);
  if (input.entry.bindingSource !== "openclaw" || !targetAgentId || input.entry.agentId !== targetAgentId) {
    return null;
  }

  const route = buildChannelRouteIdentity({
    provider: input.entry.provider,
    accountId: input.entry.accountId,
    kind: input.entry.kind,
    routeId: input.entry.routeId,
    parentRouteId: input.entry.parentRouteId,
    metadata: input.entry.metadata
  });
  const displayMatch = input.entry.bindingMatch === "inherited"
    ? "inherited"
    : input.entry.bindingMatch === "fallback"
      ? "default"
      : "explicit";

  return {
    id: `directory:${channelRouteKey(route)}`,
    route,
    provider: route.provider,
    accountId: route.accountId,
    kind: route.kind,
    title: input.entry.title ?? input.entry.handle ?? routeKindLabel(route.kind),
    subtitle: displayMatch === "inherited"
      ? `Inherited from ${input.entry.inheritedFrom ? routeKindLabel(input.entry.inheritedFrom.kind) : "a broader OpenClaw route"}`
      : displayMatch === "default"
        ? "OpenClaw default agent"
        : "OpenClaw native route",
    scope: "route",
    effectiveAgentId: targetAgentId,
    explicitAgentId: displayMatch === "explicit" ? targetAgentId : null,
    displayMatch,
    bindingMatch: input.entry.bindingMatch ?? "none",
    source: "openclaw",
    inheritedFrom: input.entry.inheritedFrom,
    editable: !input.entry.bindingEditingAmbiguous && Boolean(serializeRouteToOpenClawBindingMatch(route)),
    editingAmbiguity: input.entry.bindingEditingAmbiguous,
    shadowedBindingCount: input.entry.shadowedBindingCount
  };
}

function projectNativeBinding(
  binding: OpenClawNativeRouteBinding,
  index: number,
  snapshot: Awaited<ReturnType<typeof readNativeRouteBindings>>,
  defaultAgentId: string | null
): AgentChannelRouteProjection | null {
  const route = nativeBindingToRouteIdentity(binding);
  if (!route) {
    return projectAccountScopeBinding(binding, index);
  }

  const resolution = resolveChannelRouteBinding(route, snapshot, null, defaultAgentId);
  return {
    id: `binding:${index}`,
    route,
    provider: route.provider,
    accountId: route.accountId,
    kind: route.kind,
    title: routeKindLabel(route.kind),
    subtitle: `${route.provider} · OpenClaw native route`,
    scope: "route" as const,
    effectiveAgentId: resolution.agentId ?? binding.agentId,
    explicitAgentId: binding.agentId,
    displayMatch: "explicit" as const,
    bindingMatch: resolution.match,
    source: "openclaw" as const,
    inheritedFrom: null,
    editable: !resolution.editingAmbiguity && Boolean(serializeRouteToOpenClawBindingMatch(route)),
    editingAmbiguity: resolution.editingAmbiguity,
    shadowedBindingCount: resolution.shadowedBindings.length
  } satisfies AgentChannelRouteProjection;
}

function projectAccountScopeBinding(binding: OpenClawNativeRouteBinding, index: number) {
  const provider = normalizeString(binding.match.channel);
  const accountId = normalizeString(binding.match.accountId) ?? "default";
  if (!provider) return null;

  return {
    id: `binding:${index}`,
    route: null,
    provider,
    accountId,
    kind: null,
    title: "Account-wide route",
    subtitle: `${provider} · OpenClaw account scope`,
    scope: "account" as const,
    effectiveAgentId: binding.agentId,
    explicitAgentId: binding.agentId,
    displayMatch: "explicit" as const,
    bindingMatch: "fallback" as const,
    source: "openclaw" as const,
    inheritedFrom: null,
    editable: false,
    editingAmbiguity: false,
    shadowedBindingCount: 0
  } satisfies AgentChannelRouteProjection;
}

async function readTelegramTopicProjections(input: {
  agentId: string;
  adapter: OpenClawAdapter;
  bindings: Awaited<ReturnType<typeof readNativeRouteBindings>>;
  defaultAgentId: string | null;
}) {
  const config = await input.adapter.getConfig<Record<string, unknown>>("channels.telegram", { timeoutMs: 10_000 });
  const accounts = isRecord(config?.accounts) ? config.accounts : {};
  const accountEntries = Object.entries(accounts);
  const roots = accountEntries.length > 0
    ? accountEntries
    : [["default", config]] as Array<[string, unknown]>;
  const projections: AgentChannelRouteProjection[] = [];

  for (const [accountId, rawAccount] of roots) {
    const account = isRecord(rawAccount) ? rawAccount : {};
    const groups = isRecord(account.groups)
      ? account.groups
      : isRecord(config?.groups)
        ? config.groups
        : {};

    for (const [groupId, rawGroup] of Object.entries(groups)) {
      if (!isRecord(rawGroup) || !isRecord(rawGroup.topics)) continue;
      const parentRoute = buildChannelRouteIdentity({
        provider: "telegram",
        accountId,
        kind: "group",
        routeId: groupId,
        metadata: { nativePeerKind: "group" }
      });
      const parentResolution = resolveChannelRouteBinding(parentRoute, input.bindings, null, input.defaultAgentId);

      for (const [topicId, rawTopic] of Object.entries(rawGroup.topics)) {
        const topic = isRecord(rawTopic) ? rawTopic : {};
        const explicitAgentId = normalizeAgentId(topic.agentId);
        const inheritedAgentId = explicitAgentId ? null : parentResolution.agentId;
        const effectiveAgentId = explicitAgentId ?? inheritedAgentId;
        if (effectiveAgentId !== input.agentId) continue;

        const route = buildChannelRouteIdentity({
          provider: "telegram",
          accountId,
          kind: "topic",
          routeId: topicId,
          parentRouteId: groupId,
          metadata: { nativePeerKind: "group", nativeScope: "peer" }
        });
        const inherited = !explicitAgentId && Boolean(inheritedAgentId);
        projections.push({
          id: `telegram-topic:${channelRouteKey(route)}`,
          route,
          provider: "telegram",
          accountId,
          kind: "topic",
          title: normalizeString(topic.name ?? topic.title) ?? "Telegram topic",
          subtitle: inherited ? "Inherited from the Telegram group route" : "Telegram native topic route",
          scope: "route",
          effectiveAgentId,
          explicitAgentId,
          displayMatch: inherited ? "inherited" : "explicit",
          bindingMatch: inherited ? "inherited" : "exact",
          source: "openclaw",
          inheritedFrom: inherited ? parentRoute : null,
          editable: true,
          editingAmbiguity: false,
          shadowedBindingCount: inherited ? parentResolution.shadowedBindings.length : 0
        });
      }
    }
  }

  return projections;
}

function nativeBindingToRouteIdentity(binding: OpenClawNativeRouteBinding): ChannelRouteIdentity | null {
  const provider = normalizeString(binding.match.channel);
  if (!provider) return null;
  const accountId = normalizeString(binding.match.accountId) ?? "default";
  const peer = isRecord(binding.match.peer) ? binding.match.peer : null;
  const peerKind = normalizePeerKind(peer?.kind);
  const peerId = normalizeString(peer?.id);
  const guildId = normalizeString(binding.match.guildId);
  const teamId = normalizeString(binding.match.teamId);
  const roles = normalizeStringArray(binding.match.roles);

  if (roles.length > 0) {
    const routeId = roles[0];
    if (!routeId) return null;
    return buildChannelRouteIdentity({
      provider,
      accountId,
      kind: "role",
      routeId,
      parentRouteId: guildId,
      metadata: { nativeScope: "role", guildId }
    });
  }

  if (peerKind && peerId) {
    return buildChannelRouteIdentity({
      provider,
      accountId,
      kind: peerKind === "direct" ? "dm" : peerKind === "group" ? "group" : "channel",
      routeId: peerId,
      parentRouteId: guildId ?? teamId,
      metadata: {
        nativePeerKind: peerKind,
        ...(guildId ? { guildId } : {}),
        ...(teamId ? { teamId } : {})
      }
    });
  }

  if (guildId) {
    return buildChannelRouteIdentity({
      provider,
      accountId,
      kind: "group",
      routeId: guildId,
      metadata: { nativeScope: "guild", guildId }
    });
  }

  if (teamId) {
    return buildChannelRouteIdentity({
      provider,
      accountId,
      kind: "group",
      routeId: teamId,
      metadata: { nativeScope: "team", teamId }
    });
  }

  return null;
}

function createDefaultProjection(agentId: string): AgentChannelRouteProjection {
  return {
    id: "openclaw-default",
    route: null,
    provider: null,
    accountId: null,
    kind: null,
    title: "OpenClaw default route",
    subtitle: "Messages without a more specific native binding use this agent.",
    scope: "account",
    effectiveAgentId: agentId,
    explicitAgentId: null,
    displayMatch: "default",
    bindingMatch: "fallback",
    source: "openclaw",
    inheritedFrom: null,
    editable: false,
    editingAmbiguity: false,
    shadowedBindingCount: 0
  };
}

function dedupeProjections(projections: Array<AgentChannelRouteProjection | null>) {
  const byId = new Map<string, AgentChannelRouteProjection>();
  for (const projection of projections) {
    if (projection && !byId.has(projection.id)) byId.set(projection.id, projection);
  }
  return Array.from(byId.values()).sort((left, right) => {
    const matchOrder = { explicit: 0, inherited: 1, default: 2 } as const;
    return matchOrder[left.displayMatch] - matchOrder[right.displayMatch] || left.title.localeCompare(right.title);
  });
}

function routeKindLabel(kind: ChannelRouteKind) {
  switch (kind) {
    case "dm": return "Direct route";
    case "group": return "Group route";
    case "channel": return "Channel route";
    case "topic": return "Topic route";
    case "thread": return "Thread route";
    case "role": return "Role route";
    default: return "Native route";
  }
}

function normalizePeerKind(value: unknown): "direct" | "group" | "channel" | null {
  if (value === "dm") return "direct";
  return value === "direct" || value === "group" || value === "channel" ? value : null;
}

function normalizeAgentId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() || null : null;
}

function normalizeStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(normalizeString).filter((entry): entry is string => Boolean(entry))
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
