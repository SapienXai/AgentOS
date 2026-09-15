import type { MissionControlSurfaceProvider, WorkspaceChannelGroupAssignment } from "@/lib/openclaw/types";

export type ChannelRouteKind =
  | "dm"
  | "group"
  | "channel"
  | "thread"
  | "topic"
  | "role"
  | "peer";

/** Native OpenClaw peer kinds as of the current channel routing contract. */
export type OpenClawNativePeerKind = "direct" | "group" | "channel";

/**
 * Provider metadata that changes how an AgentOS route is translated to the
 * native OpenClaw binding shape. The route model stays provider-neutral while
 * the adapter can retain hierarchy details such as a Discord guild or Slack
 * team.
 */
export type ChannelRouteMetadata = {
  nativePeerKind?: OpenClawNativePeerKind | null;
  nativeScope?: "peer" | "guild" | "team" | "role" | null;
  parentPeerKind?: OpenClawNativePeerKind | null;
  guildId?: string | null;
  teamId?: string | null;
  memberRoleIds?: string[];
  [key: string]: unknown;
};

export type ChannelRouteIdentity = {
  provider: MissionControlSurfaceProvider;
  accountId: string;
  kind: ChannelRouteKind;
  routeId: string;
  parentRouteId: string | null;
  metadata?: ChannelRouteMetadata;
};

export type ChannelRouteAccessPolicy = {
  enabled: boolean | null;
  groupPolicy: string | null;
  allowFrom: string[];
  requireMention: boolean | null;
  source: "openclaw" | "agentos-compatibility" | "unknown";
};

export type ChannelAgentBinding = {
  route: ChannelRouteIdentity;
  agentId: string | null;
  workspaceId: string | null;
  source: "openclaw" | "agentos-compatibility" | "unknown";
};

export type ChannelRoute = {
  identity: ChannelRouteIdentity;
  title: string | null;
  subtitle: string | null;
  source: "openclaw-gateway" | "openclaw-cli" | "openclaw-config" | "agentos-compatibility";
  accessPolicy?: ChannelRouteAccessPolicy;
};

export function normalizeChannelRouteKind(value: unknown): ChannelRouteKind {
  switch (value) {
    case "dm":
    case "group":
    case "channel":
    case "thread":
    case "topic":
    case "role":
    case "peer":
      return value;
    default:
      return "peer";
  }
}

export function buildChannelRouteIdentity(input: {
  provider: MissionControlSurfaceProvider;
  accountId: string;
  kind: ChannelRouteKind;
  routeId: string;
  parentRouteId?: string | null;
  metadata?: ChannelRouteMetadata | null;
}): ChannelRouteIdentity {
  const provider = input.provider.trim();
  const accountId = input.accountId.trim();
  const routeId = input.routeId.trim();

  if (!provider || !accountId || !routeId) {
    throw new Error("A channel route requires provider, accountId, and routeId.");
  }

  const metadata = input.metadata && typeof input.metadata === "object"
    ? Object.fromEntries(Object.entries(input.metadata).filter(([, value]) => value !== undefined)) as ChannelRouteMetadata
    : undefined;

  return {
    provider,
    accountId,
    kind: input.kind,
    routeId,
    parentRouteId: input.parentRouteId?.trim() || null,
    ...(metadata && Object.keys(metadata).length > 0 ? { metadata } : {})
  };
}

/**
 * Translate the expressive AgentOS route model into an OpenClaw binding
 * match. Returning null is intentional: the route has no native binding
 * primitive and must use upstream inheritance or a provider-native config
 * surface instead of inventing a peer kind.
 */
export function serializeRouteToOpenClawBindingMatch(
  route: ChannelRouteIdentity
): Record<string, unknown> | null {
  const match: Record<string, unknown> = {
    channel: route.provider,
    accountId: route.accountId
  };
  const metadata = route.metadata ?? {};
  const provider = route.provider.toLowerCase();

  if (route.kind === "topic" || route.kind === "thread") {
    return null;
  }

  if (route.kind === "role" || metadata.nativeScope === "role") {
    const guildId = normalizedMetadataId(metadata.guildId) ?? route.parentRouteId;
    if (guildId) match.guildId = guildId;
    match.roles = [route.routeId];
    return match;
  }

  const nativeScope = metadata.nativeScope ?? defaultNativeScope(route, provider);
  if (nativeScope === "guild") {
    const guildId = normalizedMetadataId(metadata.guildId) ?? route.routeId;
    if (!guildId) return null;
    match.guildId = guildId;
    return match;
  }
  if (nativeScope === "team") {
    const teamId = normalizedMetadataId(metadata.teamId) ?? route.routeId;
    if (!teamId) return null;
    match.teamId = teamId;
    return match;
  }

  const peerKind = routeNativePeerKind(route);
  if (!peerKind) return null;
  match.peer = { kind: peerKind, id: route.routeId };

  const guildId = normalizedMetadataId(metadata.guildId)
    ?? (provider === "discord" ? route.parentRouteId : null);
  const teamId = normalizedMetadataId(metadata.teamId)
    ?? (provider === "slack" ? route.parentRouteId : null);
  if (guildId) match.guildId = guildId;
  if (teamId) match.teamId = teamId;
  return match;
}

/** Return the native peer kind for a directly bindable AgentOS route. */
export function routeNativePeerKind(route: ChannelRouteIdentity): OpenClawNativePeerKind | null {
  if (route.metadata?.nativePeerKind) return route.metadata.nativePeerKind;
  switch (route.kind) {
    case "dm":
      return "direct";
    case "group":
      return "group";
    case "channel":
      return "channel";
    case "peer":
      return null;
    default:
      return null;
  }
}

/** OpenClaw treats group and channel peers as compatible for route matching. */
export function nativePeerKindsMatch(
  left: OpenClawNativePeerKind,
  right: OpenClawNativePeerKind
) {
  return left === right
    || (left === "group" && right === "channel")
    || (left === "channel" && right === "group");
}

function defaultNativeScope(route: ChannelRouteIdentity, provider: string) {
  if (route.kind === "group" && provider === "discord") return "guild" as const;
  if (route.kind === "group" && provider === "slack") return "team" as const;
  return "peer" as const;
}

function normalizedMetadataId(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value).trim() || null
    : null;
}

export function channelRouteKey(identity: ChannelRouteIdentity) {
  return [identity.provider, identity.accountId, identity.kind, identity.parentRouteId ?? "", identity.routeId].join(":");
}

export function legacyAssignmentToRouteBinding(
  assignment: WorkspaceChannelGroupAssignment,
  input: {
    provider: MissionControlSurfaceProvider;
    accountId: string;
    workspaceId: string;
  }
): ChannelAgentBinding {
  return {
    route: buildChannelRouteIdentity({
      provider: input.provider,
      accountId: input.accountId,
      kind: input.provider === "telegram" ? "group" : "peer",
      routeId: assignment.chatId
    }),
    agentId: assignment.agentId,
    workspaceId: input.workspaceId,
    source: "agentos-compatibility"
  };
}

export function routeBindingToLegacyAssignment(
  binding: ChannelAgentBinding,
  title?: string | null,
  accessPolicy?: Pick<ChannelRouteAccessPolicy, "enabled"> | null
) {
  return {
    chatId: binding.route.routeId,
    agentId: binding.agentId,
    title: title ?? null,
    // Compatibility projection only. Routing state must never determine access state.
    enabled: accessPolicy?.enabled ?? true
  } satisfies WorkspaceChannelGroupAssignment;
}
