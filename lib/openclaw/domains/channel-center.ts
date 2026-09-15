import type { MissionControlSurfaceProvider, WorkspaceChannelGroupAssignment } from "@/lib/openclaw/types";

export type ChannelRouteKind =
  | "dm"
  | "group"
  | "channel"
  | "thread"
  | "topic"
  | "role"
  | "peer";

export type ChannelRouteIdentity = {
  provider: MissionControlSurfaceProvider;
  accountId: string;
  kind: ChannelRouteKind;
  routeId: string;
  parentRouteId: string | null;
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
}): ChannelRouteIdentity {
  const provider = input.provider.trim();
  const accountId = input.accountId.trim();
  const routeId = input.routeId.trim();

  if (!provider || !accountId || !routeId) {
    throw new Error("A channel route requires provider, accountId, and routeId.");
  }

  return {
    provider,
    accountId,
    kind: input.kind,
    routeId,
    parentRouteId: input.parentRouteId?.trim() || null
  };
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
