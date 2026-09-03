import "server-only";

import {
  GatewayClient,
  GatewayClientRequestError,
  GatewayClientRequestTimeoutError,
  type GatewayClientCloseInfo,
  type GatewayClientConnectionMetadata,
  type GatewayClientHostDeps,
  type GatewayClientRequestOptions,
  type GatewayReconnectPausedInfo
} from "@openclaw/gateway-client";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  type GatewayClientMode,
  type GatewayClientName
} from "@openclaw/gateway-protocol/client-info";
import type { EventFrame, HelloOk } from "@openclaw/gateway-protocol/frame-guards";

import {
  AGENTOS_GATEWAY_CLIENT_CAPABILITIES,
  OPENCLAW_GATEWAY_PROTOCOL_RANGE,
  SERVER_OPERATOR_CLIENT_ID,
  SERVER_OPERATOR_CLIENT_MODE
} from "@/lib/openclaw/client/openclaw-protocol";
import {
  DEFAULT_OPERATOR_SCOPES,
  DEFAULT_GATEWAY_URL
} from "@/lib/openclaw/client/native-ws-gateway-types";
import {
  NativeGatewayError,
  NativeGatewayRequestError,
  normalizeClientError
} from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  createAgentOsGatewayClientHostDeps,
  type AgentOsGatewayClientHostOptions
} from "@/lib/openclaw/client/official-gateway-host";

export type OfficialGatewayTransportCallbacks = {
  onHello?: (hello: HelloOk) => void;
  onEvent?: (event: EventFrame) => void;
  onClose?: (code: number, reason: string, info?: GatewayClientCloseInfo) => void;
  onError?: (error: Error) => void;
  onReconnectPaused?: (info: GatewayReconnectPausedInfo) => void;
  onGap?: (info: { expected: number; received: number }) => void;
};

export type OfficialGatewayTransportOptions = AgentOsGatewayClientHostOptions & {
  url?: string;
  token?: string | null;
  password?: string | null;
  deviceToken?: string | null;
  timeoutMs?: number;
  requestTimeoutMs?: number;
  clientName?: GatewayClientName;
  clientVersion?: string;
  clientBuildId?: string;
  instanceId?: string;
  role?: string;
  scopes?: string[];
  caps?: string[];
  mode?: GatewayClientMode;
  platform?: string;
  deviceFamily?: string;
  minProtocol?: number;
  maxProtocol?: number;
  hostDeps?: GatewayClientHostDeps;
  callbacks?: OfficialGatewayTransportCallbacks;
};

export type OfficialGatewayRequestOptions = GatewayClientRequestOptions;

/**
 * Thin AgentOS boundary around @openclaw/gateway-client.
 *
 * The official package owns WebSocket lifecycle, protocol correlation,
 * timeout/abort handling, reconnect, sequence-gap detection, and device
 * authentication. This class only supplies AgentOS metadata/host hooks and
 * maps package errors into the existing AgentOS error vocabulary.
 */
export class OfficialOpenClawGatewayTransport {
  readonly #client: GatewayClient;
  #hello: HelloOk | null = null;

  constructor(options: OfficialGatewayTransportOptions = {}) {
    const callbacks = options.callbacks ?? {};
    const hostDeps = options.hostDeps ?? createAgentOsGatewayClientHostDeps({
      stateDir: options.stateDir,
      sharedStateMode: options.sharedStateMode,
      overrides: options.overrides
    });

    this.#client = new GatewayClient({
      url: options.url ?? DEFAULT_GATEWAY_URL,
      token: options.token?.trim() || undefined,
      password: options.password?.trim() || undefined,
      deviceToken: options.deviceToken?.trim() || undefined,
      clientName: options.clientName ?? GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
      clientVersion: options.clientVersion ?? "agentos",
      clientBuildId: options.clientBuildId,
      instanceId: options.instanceId,
      platform: options.platform ?? process.platform,
      deviceFamily: options.deviceFamily,
      mode: options.mode ?? GATEWAY_CLIENT_MODES.BACKEND,
      role: options.role ?? "operator",
      scopes: options.scopes ?? [...DEFAULT_OPERATOR_SCOPES],
      caps: options.caps ?? [...AGENTOS_GATEWAY_CLIENT_CAPABILITIES],
      minProtocol: options.minProtocol ?? OPENCLAW_GATEWAY_PROTOCOL_RANGE.min,
      maxProtocol: options.maxProtocol ?? OPENCLAW_GATEWAY_PROTOCOL_RANGE.max,
      requestTimeoutMs: options.requestTimeoutMs ?? options.timeoutMs,
      // Explicit null prevents the official package from creating a device
      // identity when this transport is used with token/password auth.
      deviceIdentity: options.token || options.password ? null : undefined,
      hostDeps,
      onHelloOk: (hello) => {
        this.#hello = hello;
        callbacks.onHello?.(hello);
      },
      onEvent: (event) => callbacks.onEvent?.(event),
      onClose: (code, reason, info) => callbacks.onClose?.(code, reason, info),
      onConnectError: (error) => callbacks.onError?.(this.#mapConnectionError(error)),
      onReconnectPaused: (info) => callbacks.onReconnectPaused?.(info),
      onGap: (info) => callbacks.onGap?.(info)
    });
  }

  start() {
    this.#client.start();
  }

  stop() {
    this.#client.stop();
  }

  stopAndWait(options?: { timeoutMs?: number }) {
    return this.#client.stopAndWait(options);
  }

  request<T = Record<string, unknown>>(
    method: string,
    params?: unknown,
    options?: OfficialGatewayRequestOptions
  ): Promise<T> {
    return this.#client.request<T>(method, params, options).catch((error: unknown) => {
      throw this.#mapRequestError(method, error);
    });
  }

  getHandshake() {
    return this.#hello;
  }

  getConnectionMetadata(): GatewayClientConnectionMetadata {
    return this.#client.getConnectionMetadata();
  }

  #mapConnectionError(error: Error) {
    const normalized = normalizeClientError(error);
    return new NativeGatewayError(normalized.message, {
      cause: error,
      kind: normalized.kind
    });
  }

  #mapRequestError(method: string, error: unknown) {
    if (error instanceof GatewayClientRequestTimeoutError) {
      return new NativeGatewayRequestError(
        `OpenClaw Gateway request "${method}" timed out after ${error.timeoutMs} ms.`,
        method,
        error.requestSent,
        { cause: error, kind: "timeout" }
      );
    }

    const normalized = normalizeClientError(error);
    const requestSent = error instanceof GatewayClientRequestError ||
      (error instanceof Error && error.name === "GatewayProtocolRequestError");

    return new NativeGatewayRequestError(normalized.message, method, requestSent, {
      cause: error,
      kind: normalized.kind
    });
  }
}

export {
  SERVER_OPERATOR_CLIENT_ID,
  SERVER_OPERATOR_CLIENT_MODE
};
