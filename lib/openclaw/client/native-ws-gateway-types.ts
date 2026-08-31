import "server-only";

import type {
  OpenClawGatewayClient,
  OpenClawGatewayEventFrame
} from "@/lib/openclaw/client/types";

export const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18789";

export const DEFAULT_NATIVE_TIMEOUT_MS = 4_000;

export const DEFAULT_NATIVE_LIST_TIMEOUT_MS = 8_000;

export const DEFAULT_NATIVE_STREAM_TIMEOUT_MS = 30_000;

export const CONNECT_METHOD = "connect";

export const MIN_CONTROL_PROTOCOL_VERSION = 3;

export const MAX_CONTROL_PROTOCOL_VERSION = 4;

export const OPENCLAW_GATEWAY_PROTOCOL_RANGE = {
  min: MIN_CONTROL_PROTOCOL_VERSION,
  max: MAX_CONTROL_PROTOCOL_VERSION
} as const;

export const SERVER_OPERATOR_CLIENT_ID = "gateway-client";

export const SERVER_OPERATOR_CLIENT_MODE = "backend";

export const OPENCLAW_DEVICE_AUTH_FILE_NAME = "device-auth.json";

export const OPENCLAW_DEVICE_IDENTITY_FILE_NAME = "device.json";

export const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export const DEFAULT_OPERATOR_SCOPES = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.pairing",
  "operator.talk.secrets"
];

export const REDACTED_OPENCLAW_SECRET = "__OPENCLAW_REDACTED__";

export type WebSocketLike = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate?: () => void;
  addEventListener?: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener?: (type: string, listener: (event: unknown) => void) => void;
  on?: (type: string, listener: (...args: unknown[]) => void) => void;
  off?: (type: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (type: string, listener: (...args: unknown[]) => void) => void;
  onopen?: ((event: unknown) => void) | null;
  onmessage?: ((event: unknown) => void) | null;
  onerror?: ((event: unknown) => void) | null;
  onclose?: ((event: unknown) => void) | null;
};

export type WebSocketFactory = new (url: string) => WebSocketLike;

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
  webSocketFactory?: WebSocketFactory;
  forceCli?: boolean;
  onNativeFailure?: (error: unknown, method: string) => void;
};

export type GatewayResponseFrame = {
  type?: string;
  id?: string | number;
  ok?: boolean;
  payload?: unknown;
  error?: unknown;
  message?: string;
  code?: string;
};

export type GatewayEventFrame = OpenClawGatewayEventFrame;

export type NativeHandshakePayload = {
  type?: string;
  protocol?: number;
  server?: {
    version?: string;
    buildId?: string;
    connId?: string;
  };
  features?: {
    methods?: string[];
    events?: string[];
  };
  snapshot?: unknown;
  auth?: {
    role?: string;
    scopes?: string[];
  };
  policy?: Record<string, unknown>;
};

export type LocalDeviceAuth = {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  token: string;
};

export type ConnectParamsContext = {
  params: Record<string, unknown>;
  deviceAuth: LocalDeviceAuth | null;
};
