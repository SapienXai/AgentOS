import "server-only";

import type {
  EventFrame,
  HelloOk,
  ResponseFrame
} from "@openclaw/gateway-protocol/frame-guards";

import type {
  OpenClawCommandOptions,
  OpenClawGatewayClient,
  OpenClawGatewayClientDiagnostics,
  OpenClawGatewayEventCallbacks,
  OpenClawGatewayEventSubscription,
  OpenClawGatewayConnectionState,
  OpenClawGatewayEventConnectionState
} from "@/lib/openclaw/client/types";
import type { OpenClawOperatorIdentity } from "@/lib/openclaw/identity/types";
import type { AgentOsGatewayRequestPolicy } from "@/lib/openclaw/client/gateway-request-policy";
import {
  OPENCLAW_GATEWAY_PROTOCOL_RANGE
} from "@/lib/openclaw/client/openclaw-protocol";

export const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";

export const DEFAULT_NATIVE_TIMEOUT_MS = 4_000;

export const DEFAULT_NATIVE_LIST_TIMEOUT_MS = 8_000;

export const DEFAULT_NATIVE_STREAM_TIMEOUT_MS = 30_000;

export const CONNECT_METHOD = "connect";

export const MIN_CONTROL_PROTOCOL_VERSION = OPENCLAW_GATEWAY_PROTOCOL_RANGE.min;

export const MAX_CONTROL_PROTOCOL_VERSION = OPENCLAW_GATEWAY_PROTOCOL_RANGE.max;

export { OPENCLAW_GATEWAY_PROTOCOL_RANGE, SERVER_OPERATOR_CLIENT_ID, SERVER_OPERATOR_CLIENT_MODE } from "@/lib/openclaw/client/openclaw-protocol";

export const DEFAULT_OPERATOR_SCOPES = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.questions",
  "operator.pairing",
  "operator.talk",
  "operator.talk.secrets"
];

export const REDACTED_OPENCLAW_SECRET = "__OPENCLAW_REDACTED__";

export type NativeWsOpenClawGatewayClientOptions = {
  url?: string | null;
  token?: string | null;
  password?: string | null;
  timeoutMs?: number;
  clientName?: string;
  clientVersion?: string;
  instanceId?: string;
  role?: string;
  scopes?: string[];
  fallback?: OpenClawGatewayClient;
  /** Optional AgentOS transport implementation used by migration paths. */
  transport?: OpenClawGatewayTransport;
  /** Testable/shared AgentOS request policy; production creates one per client. */
  requestPolicy?: AgentOsGatewayRequestPolicy;
  forceCli?: boolean;
  onNativeFailure?: (error: unknown, method: string) => void;
};

/**
 * The small request/event boundary used by the AgentOS domain client.
 * The production implementation is the official OpenClaw transport. Tests
 * and migration tooling may inject a transport-neutral double at this seam.
 */
export type OpenClawGatewayTransport = {
  readonly lifecycleOwner?: "official";
  request<TPayload>(
    method: string,
    params: Record<string, unknown>,
    options: OpenClawCommandOptions,
    timeoutMs: number
  ): Promise<TPayload>;
  probe(options: OpenClawCommandOptions, timeoutMs: number): Promise<NativeHandshakePayload>;
  subscribe(
    params: Record<string, unknown>,
    callbacks: OpenClawGatewayEventCallbacks,
    options: OpenClawCommandOptions,
    timeoutMs: number
  ): Promise<OpenClawGatewayEventSubscription>;
  close(reason?: string): void;
  getDiagnostics(): Pick<
    OpenClawGatewayClientDiagnostics,
    | "connectionState"
    | "protocolVersion"
    | "gatewayCapabilities"
    | "pendingRequestCount"
    | "sharedInFlightRequestCount"
    | "cachedReadRequestCount"
    | "lastNativeError"
    | "lastConnectedAt"
    | "lastDisconnectedAt"
    | "operatorIdentity"
  >;
  getOperatorIdentity(): OpenClawOperatorIdentity;
  getGeneration(): number;
  getLifecycleState(): OpenClawGatewayConnectionState | OpenClawGatewayEventConnectionState;
};

export type GatewayResponseFrame = ResponseFrame;

export type GatewayEventFrame = EventFrame;

export type NativeHandshakePayload = {
  type?: string;
  protocol?: HelloOk["protocol"];
  server?: Partial<HelloOk["server"]> & Record<string, unknown>;
  features?: Partial<HelloOk["features"]> & Record<string, unknown>;
  snapshot?: unknown;
  auth?: Partial<HelloOk["auth"]> & Record<string, unknown>;
  policy?: Partial<HelloOk["policy"]> & Record<string, unknown>;
};
