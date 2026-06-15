import "server-only";

import {
  DEFAULT_GATEWAY_URL,
  DEFAULT_NATIVE_LIST_TIMEOUT_MS,
  DEFAULT_NATIVE_STREAM_TIMEOUT_MS,
  DEFAULT_NATIVE_TIMEOUT_MS
} from "@/lib/openclaw/client/native-ws-gateway-types";
import {
  NativeGatewayRequestError,
  normalizeClientError
} from "@/lib/openclaw/client/native-ws-gateway-errors";
import type {
  OpenClawCommandOptions,
  OpenClawGatewayRequestPolicy
} from "@/lib/openclaw/client/types";

export function normalizeEnvFlag(value: string | undefined) {
  return value?.trim().toLowerCase();
}

export function isCliGatewayClientForcedByEnv() {
  const clientMode = normalizeEnvFlag(
    process.env.AGENTOS_OPENCLAW_GATEWAY_CLIENT ?? process.env.OPENCLAW_GATEWAY_CLIENT
  );
  const nativeFlag = normalizeEnvFlag(process.env.AGENTOS_OPENCLAW_NATIVE_WS);

  return clientMode === "cli" || nativeFlag === "0" || nativeFlag === "false" || nativeFlag === "off";
}

export function resolveGatewayUrl(input?: string | null) {
  return (
    input?.trim() ||
    process.env.AGENTOS_OPENCLAW_GATEWAY_URL?.trim() ||
    process.env.OPENCLAW_GATEWAY_URL?.trim() ||
    DEFAULT_GATEWAY_URL
  );
}

export function resolveNativeTimeoutMs(input?: number, method?: string) {
  if (typeof input === "number" && Number.isFinite(input) && input > 0) {
    return input;
  }

  const envTimeout = Number(process.env.AGENTOS_OPENCLAW_NATIVE_WS_TIMEOUT_MS);
  if (Number.isFinite(envTimeout) && envTimeout > 0) {
    return envTimeout;
  }

  if (method && /^(chat\.send|sessions\.send|sessions\.abort|chat\.abort)$/.test(method)) {
    return DEFAULT_NATIVE_STREAM_TIMEOUT_MS;
  }

  if (method && /(^|\.)(list|get|status|authStatus|schema|tail)$/.test(method)) {
    return DEFAULT_NATIVE_LIST_TIMEOUT_MS;
  }

  return DEFAULT_NATIVE_TIMEOUT_MS;
}

export function resolveGatewayRequestPolicy(method: string, options: OpenClawCommandOptions = {}): OpenClawGatewayRequestPolicy {
  const safety = method === "update.status"
    ? "read"
    : isGatewayMutationMethod(method)
      ? "mutation"
      : "read";

  return {
    safety,
    timeoutMs: options.timeoutMs,
    allowCliFallback: true,
    allowReadCliFallbackOnNativeFailure: method === "update.status",
    allowMutationFallbackOnUnsupported: safety === "mutation"
  };
}

export function isGatewayMutationMethod(method: string) {
  return /(^|\.)(add|assign|cancel|configure|create|delete|invoke|put|remove|setup|update|set|unset|patch|apply|send|abort|resolve|restart|start|stop|logout)$/i.test(method);
}

export function shouldUseCliFallback(
  error: unknown,
  method: string,
  policy: OpenClawGatewayRequestPolicy
) {
  if (policy.allowCliFallback === false) {
    return false;
  }

  const normalized = normalizeClientError(error);

  if (policy.safety !== "mutation") {
    return normalized.kind === "unsupported" || policy.allowReadCliFallbackOnNativeFailure === true;
  }

  if (policy.allowUnsafeMutationCliFallback) {
    return true;
  }

  if (error instanceof NativeGatewayRequestError && error.method !== method) {
    return false;
  }

  if (normalized.kind === "unsupported" && policy.allowMutationFallbackOnUnsupported !== false) {
    return true;
  }

  return false;
}
