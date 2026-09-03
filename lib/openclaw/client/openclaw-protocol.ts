import "server-only";

import {
  GATEWAY_CLIENT_CAPS,
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_MODES,
  normalizeGatewayClientId
} from "@openclaw/gateway-protocol/client-info";
import {
  MIN_CLIENT_PROTOCOL_VERSION,
  PROTOCOL_VERSION
} from "@openclaw/gateway-protocol/version";

export const OPENCLAW_GATEWAY_PROTOCOL_RANGE = {
  min: MIN_CLIENT_PROTOCOL_VERSION,
  max: PROTOCOL_VERSION
} as const;

export const SERVER_OPERATOR_CLIENT_ID = GATEWAY_CLIENT_IDS.GATEWAY_CLIENT;
export const SERVER_OPERATOR_CLIENT_MODE = GATEWAY_CLIENT_MODES.BACKEND;

// These are the only Gateway client capabilities AgentOS currently consumes.
// Do not advertise a capability merely because the upstream registry contains it.
export const AGENTOS_GATEWAY_CLIENT_CAPABILITIES = [
  GATEWAY_CLIENT_CAPS.AGENT_KIND,
  GATEWAY_CLIENT_CAPS.TOOL_EVENTS
] as const;

export type AgentOsGatewayClientCapability = (typeof AGENTOS_GATEWAY_CLIENT_CAPABILITIES)[number];

export function resolveGatewayClientId(raw?: string | null) {
  const normalized = normalizeGatewayClientId(raw);

  if (raw?.trim() && !normalized) {
    throw new Error(`Unsupported OpenClaw Gateway client id "${raw.trim()}".`);
  }

  return normalized ?? SERVER_OPERATOR_CLIENT_ID;
}
