import "server-only";

import {
  CONNECT_METHOD,
  MAX_CONTROL_PROTOCOL_VERSION,
  MIN_CONTROL_PROTOCOL_VERSION,
  type NativeHandshakePayload
} from "@/lib/openclaw/client/native-ws-gateway-types";
import {
  NativeGatewayError,
  normalizeClientError
} from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  isObjectRecord,
  readNonEmptyString
} from "@/lib/openclaw/client/native-ws-gateway-utils";
import {
  OPENCLAW_GATEWAY_BASELINE_OPTIONAL_METHODS,
  OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS
} from "@/lib/openclaw/client/gateway-compatibility";

export type GatewayMethodSupportState =
  | "explicitly-advertised"
  | "known-by-contract"
  | "proven-unsupported"
  | "auth-denied"
  | "unknown-not-advertised";

const knownGatewayMethods = new Set([
  ...OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS,
  ...OPENCLAW_GATEWAY_BASELINE_OPTIONAL_METHODS
]);

export function resolveEventSubscriptionRequests(params: Record<string, unknown>, hello?: NativeHandshakePayload | null) {
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];

  if (params.subscribeSessions !== false && supportsGatewayMethod(hello, "sessions.subscribe")) {
    requests.push({ method: "sessions.subscribe", params: {} });
  }

  const sessionKeys = Array.isArray(params.sessionKeys)
    ? params.sessionKeys.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

  for (const key of sessionKeys) {
    if (supportsGatewayMethod(hello, "sessions.messages.subscribe")) {
      requests.push({ method: "sessions.messages.subscribe", params: { key: key.trim() } });
    }
  }

  const taskIds = Array.isArray(params.taskIds)
    ? params.taskIds.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  if ((params.subscribeTasks === true || taskIds.length > 0) && supportsGatewayMethod(hello, "tasks.subscribe")) {
    requests.push({
      method: "tasks.subscribe",
      params: taskIds.length > 0 ? { taskIds: taskIds.map((entry) => entry.trim()) } : {}
    });
  }

  return requests;
}

export function readAdvertisedGatewayMethods(hello?: NativeHandshakePayload | null) {
  return Array.isArray(hello?.features?.methods)
    ? hello.features.methods.filter((method): method is string => typeof method === "string" && method.trim().length > 0)
    : [];
}

export function readAdvertisedGatewayEvents(hello?: NativeHandshakePayload | null) {
  return Array.isArray(hello?.features?.events)
    ? hello.features.events.filter((event): event is string => typeof event === "string" && event.trim().length > 0)
    : [];
}

export function readAdvertisedGatewayCapabilities(hello?: NativeHandshakePayload | null) {
  return Array.isArray(hello?.features?.capabilities)
    ? hello.features.capabilities.filter((capability): capability is string =>
      typeof capability === "string" && capability.trim().length > 0
    )
    : [];
}

export function supportsGatewayCapability(hello: NativeHandshakePayload | null | undefined, capability: string) {
  if (!Array.isArray(hello?.features?.capabilities)) {
    return true;
  }

  return readAdvertisedGatewayCapabilities(hello).includes(capability);
}

export function supportsGatewayMethod(hello: NativeHandshakePayload | null | undefined, method: string) {
  // hello-ok.features.methods is a conservative discovery hint, not an
  // exhaustive RPC inventory. Only an authoritative RPC error can prove a
  // method unsupported; omission must still attempt the native request.
  return resolveGatewayMethodSupportState(hello, method) !== "proven-unsupported";
}

export function supportsGatewayEvent(hello: NativeHandshakePayload | null | undefined, event: string) {
  return resolveGatewayEventSupportState(hello, event) !== "proven-unsupported";
}

export function resolveGatewayMethodSupportState(
  hello: NativeHandshakePayload | null | undefined,
  method: string
): Exclude<GatewayMethodSupportState, "proven-unsupported" | "auth-denied"> {
  if (method === CONNECT_METHOD || readAdvertisedGatewayMethods(hello).includes(method)) {
    return method === CONNECT_METHOD ? "known-by-contract" : "explicitly-advertised";
  }

  if (knownGatewayMethods.has(method)) {
    return "known-by-contract";
  }

  return "unknown-not-advertised";
}

export function resolveGatewayEventSupportState(
  hello: NativeHandshakePayload | null | undefined,
  event: string
): Exclude<GatewayMethodSupportState, "proven-unsupported" | "auth-denied"> {
  return readAdvertisedGatewayEvents(hello).includes(event)
    ? "explicitly-advertised"
    : "unknown-not-advertised";
}

export function validateGatewayHandshakePayload(hello: NativeHandshakePayload | null | undefined) {
  if (!hello || typeof hello !== "object") {
    throw new NativeGatewayError("OpenClaw Gateway connect response was malformed.", {
      kind: "malformed-response"
    });
  }

  if (hello.type === "hello-ok") {
    if (hello.protocol === undefined || !hello.server?.version || !hello.server.connId ||
      !Array.isArray(hello.features?.methods) || !Array.isArray(hello.features?.events) ||
      hello.snapshot === undefined || !hello.auth?.role || !Array.isArray(hello.auth.scopes) ||
      !Number.isFinite(hello.policy?.maxPayload as number) ||
      !Number.isFinite(hello.policy?.maxBufferedBytes as number) ||
      !Number.isFinite(hello.policy?.tickIntervalMs as number)) {
      throw new NativeGatewayError("OpenClaw Gateway hello-ok response was incomplete.", {
        kind: "malformed-response"
      });
    }
  }

  const protocol = hello.protocol;
  if (typeof protocol !== "number" || !Number.isFinite(protocol)) {
    return;
  }

  // Very old fixtures/CLI bridges omitted the hello type and did not carry
  // the complete HelloOk envelope. Keep that shape bounded for compatibility,
  // while exact typed hello-ok frames must negotiate the official range.
  if (protocol < MIN_CONTROL_PROTOCOL_VERSION && hello.type === undefined) {
    return;
  }

  if (protocol < MIN_CONTROL_PROTOCOL_VERSION || protocol > MAX_CONTROL_PROTOCOL_VERSION) {
    throw new NativeGatewayError(
      `OpenClaw Gateway protocol ${protocol} is outside AgentOS' supported range ${MIN_CONTROL_PROTOCOL_VERSION}-${MAX_CONTROL_PROTOCOL_VERSION}.`,
      { kind: "protocol-mismatch" }
    );
  }
}

export function assertGatewayMethodSupported(hello: NativeHandshakePayload | null | undefined, method: string) {
  // Keep this boundary for callers, but do not turn conservative discovery
  // metadata into a false unsupported result before the RPC is attempted.
  void hello;
  void method;
}

export function isGatewayMethodUnsupported(error: unknown) {
  return normalizeClientError(error).kind === "unsupported";
}

export function resolveLatestPendingDeviceRequestId(payload: Record<string, unknown>) {
  const pending = Array.isArray(payload.pending) ? payload.pending : [];
  let selected: { requestId: string; ts: number } | null = null;

  for (const entry of pending) {
    if (!isObjectRecord(entry)) {
      continue;
    }

    const requestId = readNonEmptyString(entry.requestId);

    if (!requestId) {
      continue;
    }

    const ts = typeof entry.ts === "number" && Number.isFinite(entry.ts) ? entry.ts : 0;

    if (!selected || ts > selected.ts) {
      selected = { requestId, ts };
    }
  }

  return selected?.requestId ?? null;
}
