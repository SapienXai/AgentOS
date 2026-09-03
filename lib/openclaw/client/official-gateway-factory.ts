import "server-only";

import type { OpenClawGatewayClient } from "@/lib/openclaw/client/types";
import {
  NativeWsOpenClawGatewayClient,
  type NativeWsOpenClawGatewayClientOptions
} from "@/lib/openclaw/client/native-ws-gateway-client";
import {
  OfficialOpenClawGatewayConnectionCoordinator
} from "@/lib/openclaw/client/official-gateway-coordinator";
import {
  OfficialOpenClawGatewayTransport,
  type OfficialGatewayTransportOptions
} from "@/lib/openclaw/client/official-gateway-transport";

export type OfficialBackedOpenClawGatewayClientOptions = OfficialGatewayTransportOptions & {
  fallback?: OpenClawGatewayClient;
  forceCli?: boolean;
  onNativeFailure?: NativeWsOpenClawGatewayClientOptions["onNativeFailure"];
};

/**
 * Constructs the Phase 3 official-backed domain path without changing the
 * production factory. NativeWsOpenClawGatewayClient remains the domain and
 * policy implementation; only its transport boundary is replaced.
 */
export function createOfficialBackedOpenClawGatewayClient(
  options: OfficialBackedOpenClawGatewayClientOptions = {}
) {
  let coordinator: OfficialOpenClawGatewayConnectionCoordinator | null = null;
  const callbacks = options.callbacks ?? {};
  const transport = new OfficialOpenClawGatewayTransport({
    ...options,
    callbacks: {
      ...callbacks,
      onHello: (hello) => {
        callbacks.onHello?.(hello);
        coordinator?.handleHello(hello);
      },
      onEvent: (event) => {
        callbacks.onEvent?.(event);
        coordinator?.handleEvent(event);
      },
      onClose: (code, reason, info) => {
        callbacks.onClose?.(code, reason, info);
        coordinator?.handleClose();
      },
      onError: (error) => callbacks.onError?.(error),
      onReconnectPaused: (info) => {
        callbacks.onReconnectPaused?.(info);
        coordinator?.handleReconnectPaused();
      },
      onGap: (info) => {
        callbacks.onGap?.(info);
        coordinator?.handleGap(info);
      },
      onConnectionStateChange: callbacks.onConnectionStateChange
    }
  });
  coordinator = new OfficialOpenClawGatewayConnectionCoordinator(transport, {
    replayTimeoutMs: options.requestTimeoutMs ?? options.timeoutMs
  });

  const client = new NativeWsOpenClawGatewayClient({
    fallback: options.fallback,
    forceCli: options.forceCli,
    onNativeFailure: options.onNativeFailure,
    transport: coordinator
  });
  return client;
}
