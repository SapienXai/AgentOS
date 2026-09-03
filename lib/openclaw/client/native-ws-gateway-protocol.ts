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
  if (method === CONNECT_METHOD) {
    return true;
  }

  const advertisedMethods = readAdvertisedGatewayMethods(hello);
  return advertisedMethods.length === 0 || advertisedMethods.includes(method);
}

export function supportsGatewayEvent(hello: NativeHandshakePayload | null | undefined, event: string) {
  const advertisedEvents = readAdvertisedGatewayEvents(hello);
  return advertisedEvents.length === 0 || advertisedEvents.includes(event);
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
  if (supportsGatewayMethod(hello, method)) {
    return;
  }

  throw new NativeGatewayError(`OpenClaw Gateway does not advertise method "${method}".`, {
    kind: "unsupported"
  });
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
