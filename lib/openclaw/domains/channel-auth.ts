import type { PlannerChannelType } from "@/lib/openclaw/types";

export type OpenClawChannelAuthenticationKind =
  | "none"
  | "token"
  | "service-account"
  | "qr-session"
  | "unknown";

export type OpenClawChannelAuthentication = {
  authenticationKind: OpenClawChannelAuthenticationKind;
  requiresCredentials: boolean;
  requiresAuthentication: boolean;
};

/**
 * Static setup semantics for the channels supported by the planner/blueprint
 * projections. Live account state remains owned by OpenClaw channel services.
 */
const channelAuthentication: Record<PlannerChannelType, OpenClawChannelAuthentication> = {
  internal: {
    authenticationKind: "none",
    requiresCredentials: false,
    requiresAuthentication: false
  },
  telegram: {
    authenticationKind: "token",
    requiresCredentials: true,
    requiresAuthentication: true
  },
  whatsapp: {
    authenticationKind: "qr-session",
    requiresCredentials: false,
    requiresAuthentication: true
  },
  slack: {
    authenticationKind: "token",
    requiresCredentials: true,
    requiresAuthentication: true
  },
  discord: {
    authenticationKind: "token",
    requiresCredentials: true,
    requiresAuthentication: true
  },
  googlechat: {
    authenticationKind: "service-account",
    requiresCredentials: true,
    requiresAuthentication: true
  }
};

export function getOpenClawChannelAuthentication(
  channelType: PlannerChannelType
): OpenClawChannelAuthentication {
  return channelAuthentication[channelType] ?? {
    authenticationKind: "unknown",
    requiresCredentials: false,
    requiresAuthentication: true
  };
}
