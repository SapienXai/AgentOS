import "server-only";

import { buildConnectParams } from "@/lib/openclaw/client/native-ws-gateway-auth";
import {
  NativeGatewayError,
  NativeGatewayRequestError
} from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  assertGatewayMethodSupported,
  resolveEventSubscriptionRequests,
  supportsGatewayEvent,
  validateGatewayHandshakePayload
} from "@/lib/openclaw/client/native-ws-gateway-protocol";
import { resolveGatewayUrl } from "@/lib/openclaw/client/native-ws-gateway-policy";
import {
  CONNECT_METHOD,
  type GatewayEventFrame,
  type NativeHandshakePayload,
  type NativeWsOpenClawGatewayClientOptions,
  type WebSocketLike
} from "@/lib/openclaw/client/native-ws-gateway-types";
import {
  addSocketListener,
  normalizeGatewayResponseFailure,
  parseGatewayFrameData,
  type PendingRequest,
  readSocketCloseReason,
  resolveWebSocketFactory,
  sendGatewayRequest,
  throwIfAborted,
  waitForConnectChallenge,
  waitForSocketOpen
} from "@/lib/openclaw/client/native-ws-gateway-wire";
import type {
  OpenClawCommandOptions,
  OpenClawGatewayClient,
  OpenClawGatewayClientDiagnostics,
  OpenClawGatewayRequestPolicy,
  OpenClawGatewayEventSubscription
} from "@/lib/openclaw/client/types";

export type GatewayEventListener = (event: GatewayEventFrame) => void;

export type GatewayCloseListener = () => void;

const readRequestCacheTtlMs = 300;

export class PersistentOpenClawGatewayConnection {
  private socket: WebSocketLike | null = null;
  private pending = new Map<string, PendingRequest>();
  private sharedReadRequests = new Map<string, Promise<unknown>>();
  private readRequestCache = new Map<string, { expiresAt: number; payload: unknown }>();
  private cleanupCallbacks: Array<() => void> = [];
  private eventListeners = new Set<GatewayEventListener>();
  private closeListeners = new Set<GatewayCloseListener>();
  private connectPromise: Promise<NativeHandshakePayload> | null = null;
  private hello: NativeHandshakePayload | null = null;
  private state: OpenClawGatewayClientDiagnostics["connectionState"] = "idle";
  private lastNativeError: string | null = null;
  private lastConnectedAt: string | null = null;
  private lastDisconnectedAt: string | null = null;

  constructor(
    private readonly fallback: OpenClawGatewayClient,
    private readonly options: NativeWsOpenClawGatewayClientOptions
  ) {}

  getDiagnostics(): Pick<
    OpenClawGatewayClientDiagnostics,
    | "connectionState"
    | "protocolVersion"
    | "pendingRequestCount"
    | "sharedInFlightRequestCount"
    | "cachedReadRequestCount"
    | "lastNativeError"
    | "lastConnectedAt"
    | "lastDisconnectedAt"
  > {
    return {
      connectionState: this.state,
      protocolVersion: typeof this.hello?.protocol === "number" ? this.hello.protocol : null,
      pendingRequestCount: this.pending.size,
      sharedInFlightRequestCount: this.sharedReadRequests.size,
      cachedReadRequestCount: this.readRequestCache.size,
      lastNativeError: this.lastNativeError,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt
    };
  }

  async request<TPayload>(
    method: string,
    params: Record<string, unknown>,
    options: OpenClawCommandOptions,
    timeoutMs: number,
    policy?: Pick<OpenClawGatewayRequestPolicy, "safety">
  ) {
    const hello = await this.ensureConnected(options, timeoutMs);
    assertGatewayMethodSupported(hello, method);
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) {
      throw new NativeGatewayError("OpenClaw Gateway connection is not ready.");
    }

    if (policy?.safety !== "read" || options.signal) {
      return sendGatewayRequest<TPayload>(socket, this.pending, method, params, timeoutMs, options.signal);
    }

    this.pruneExpiredReadCache();
    const cacheKey = buildReadRequestCacheKey(method, params);
    const cached = this.readRequestCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.payload as TPayload;
    }

    const existing = this.sharedReadRequests.get(cacheKey);

    if (existing) {
      return existing as Promise<TPayload>;
    }

    const request = sendGatewayRequest<TPayload>(socket, this.pending, method, params, timeoutMs)
      .then((payload) => {
        this.readRequestCache.set(cacheKey, {
          expiresAt: Date.now() + readRequestCacheTtlMs,
          payload
        });

        return payload;
      })
      .finally(() => {
        this.sharedReadRequests.delete(cacheKey);
      });

    this.sharedReadRequests.set(cacheKey, request);
    return request;
  }

  private pruneExpiredReadCache() {
    const now = Date.now();

    for (const [key, entry] of this.readRequestCache) {
      if (entry.expiresAt <= now) {
        this.readRequestCache.delete(key);
      }
    }
  }

  async probe(options: OpenClawCommandOptions, timeoutMs: number) {
    return this.ensureConnected(options, timeoutMs);
  }

  async subscribe(
    params: Record<string, unknown>,
    callbacks: {
      onEvent: (event: GatewayEventFrame) => void;
      onError?: (error: unknown) => void;
      onClose?: () => void;
    },
    options: OpenClawCommandOptions,
    timeoutMs: number
  ): Promise<OpenClawGatewayEventSubscription> {
    const hello = await this.ensureConnected(options, timeoutMs);
    const subscriptionRequests = resolveEventSubscriptionRequests(params, hello);
    if (
      subscriptionRequests.length === 0 &&
      !supportsGatewayEvent(hello, "chat") &&
      !supportsGatewayEvent(hello, "agent") &&
      !supportsGatewayEvent(hello, "session.message") &&
      !supportsGatewayEvent(hello, "session.tool") &&
      !supportsGatewayEvent(hello, "sessions.changed") &&
      !supportsGatewayEvent(hello, "task") &&
      !supportsGatewayEvent(hello, "task.updated") &&
      !supportsGatewayEvent(hello, "task.completed") &&
      !supportsGatewayEvent(hello, "artifact") &&
      !supportsGatewayEvent(hello, "artifact.updated") &&
      !supportsGatewayEvent(hello, "exec.approval.requested") &&
      !supportsGatewayEvent(hello, "plugin.approval.requested")
    ) {
      throw new NativeGatewayError(
        "OpenClaw Gateway does not advertise compatible runtime event streaming.",
        { kind: "unsupported" }
      );
    }

    const listener: GatewayEventListener = (frame) => {
      try {
        callbacks.onEvent(frame);
      } catch (error) {
        callbacks.onError?.(error);
      }
    };
    const closeListener: GatewayCloseListener = () => callbacks.onClose?.();

    this.eventListeners.add(listener);
    this.closeListeners.add(closeListener);

    try {
      for (const request of subscriptionRequests) {
        await this.request(request.method, request.params, options, timeoutMs);
      }
    } catch (error) {
      this.eventListeners.delete(listener);
      this.closeListeners.delete(closeListener);
      throw error;
    }

    let closed = false;
    return {
      close: () => {
        if (closed) {
          return;
        }

        closed = true;
        this.eventListeners.delete(listener);
        this.closeListeners.delete(closeListener);
        if (subscriptionRequests.length > 0) {
          this.close("event subscription closed");
        }
      }
    };
  }

  close(reason = "closed") {
    this.disconnect(new NativeGatewayError(`OpenClaw Gateway connection closed: ${reason}.`), {
      notify: true,
      closeSocket: true,
      state: "closed"
    });
  }

  private async ensureConnected(options: OpenClawCommandOptions, timeoutMs: number) {
    throwIfAborted(options.signal);

    if (this.socket?.readyState === 1 && this.hello) {
      return this.hello;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.connect(options, timeoutMs).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  private async connect(options: OpenClawCommandOptions, timeoutMs: number) {
    this.disconnect(new NativeGatewayError("Replacing stale OpenClaw Gateway connection."), {
      notify: false,
      closeSocket: true,
      state: "connecting"
    });

    const url = resolveGatewayUrl(this.options.url);
    const WebSocketImpl = resolveWebSocketFactory(this.options.webSocketFactory);
    const connectContext = await buildConnectParams(this.fallback, this.options, url, options);
    const socket = new WebSocketImpl(url);
    this.socket = socket;
    this.state = "connecting";
    this.lastNativeError = null;

    this.cleanupCallbacks = [
      addSocketListener(socket, "message", (event) => this.handleMessage(event)),
      addSocketListener(socket, "error", (event) => {
        const error = new NativeGatewayError("OpenClaw Gateway WebSocket error.", { cause: event });
        this.lastNativeError = error.message;
        this.rejectPending(error);
      }),
      addSocketListener(socket, "close", (event) => {
        const detail = readSocketCloseReason(event);
        this.disconnect(
          new NativeGatewayError(`OpenClaw Gateway connection closed${detail ? ` (${detail})` : ""}.`),
          { notify: true, closeSocket: false, state: "closed" }
        );
      })
    ];

    try {
      await waitForSocketOpen(socket, timeoutMs, options.signal);
      const connectParams = connectContext.deviceAuth
        ? (await buildConnectParams(
          this.fallback,
          this.options,
          url,
          options,
          await waitForConnectChallenge(socket, timeoutMs, options.signal)
        )).params
        : connectContext.params;
      const hello = await sendGatewayRequest<NativeHandshakePayload>(
        socket,
        this.pending,
        CONNECT_METHOD,
        connectParams,
        timeoutMs,
        options.signal
      );
      validateGatewayHandshakePayload(hello);
      this.hello = hello;
      this.state = "connected";
      this.lastConnectedAt = new Date().toISOString();
      this.lastNativeError = null;
      return hello;
    } catch (error) {
      this.lastNativeError = error instanceof Error ? error.message : String(error);
      this.disconnect(error, { notify: true, closeSocket: true, state: "error" });
      throw error;
    }
  }

  private handleMessage(event: unknown) {
    try {
      const data = (event as { data?: unknown })?.data ?? event;
      const frame = parseGatewayFrameData(data);

      if (!frame) {
        return;
      }

      if (frame.type === "event") {
        for (const listener of [...this.eventListeners]) {
          listener(frame as GatewayEventFrame);
        }
        return;
      }

      if (frame.type !== "res" || frame.id === undefined) {
        return;
      }

      const requestId = String(frame.id);
      const request = this.pending.get(requestId);
      if (!request) {
        return;
      }

      this.pending.delete(requestId);
      globalThis.clearTimeout(request.timer);

      if (frame.ok === false) {
        request.reject(new NativeGatewayRequestError(
          normalizeGatewayResponseFailure(frame),
          request.method,
          request.sent,
          { cause: frame }
        ));
        return;
      }

      request.resolve(frame.payload);
    } catch (error) {
      this.lastNativeError = error instanceof Error ? error.message : String(error);
      this.rejectPending(error);
    }
  }

  private rejectPending(error: unknown) {
    for (const [id, request] of this.pending) {
      globalThis.clearTimeout(request.timer);
      this.pending.delete(id);
      request.reject(error);
    }
  }

  private disconnect(
    error: unknown,
    options: {
      notify: boolean;
      closeSocket: boolean;
      state: OpenClawGatewayClientDiagnostics["connectionState"];
    }
  ) {
    const hadSocket = Boolean(this.socket);
    const socket = this.socket;
    this.socket = null;
    this.hello = null;
    this.state = options.state;
    this.sharedReadRequests.clear();
    this.readRequestCache.clear();
    if (options.state !== "connecting" && hadSocket) {
      this.lastDisconnectedAt = new Date().toISOString();
    }

    for (const cleanup of this.cleanupCallbacks) {
      cleanup();
    }
    this.cleanupCallbacks = [];
    this.rejectPending(error);

    if (options.notify) {
      for (const listener of [...this.closeListeners]) {
        listener();
      }
    }

    if (options.closeSocket && socket) {
      closeSocketForDisconnect(socket);
    }
  }
}

function buildReadRequestCacheKey(method: string, params: Record<string, unknown>) {
  return `${method}:${stableStringify(params)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function closeSocketForDisconnect(socket: WebSocketLike) {
  if (socket.readyState === 3) {
    return;
  }

  let cleanupErrorListener: (() => void) | null = addSocketListener(socket, "error", () => {
    // A Node ws socket can emit "WebSocket was closed before the connection was established"
    // after cleanup removed the normal error listener. The stale socket is already detached.
  });
  let cleanupCloseListener: (() => void) | null = null;
  let terminateTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  const cleanupTimer = globalThis.setTimeout(() => {
    cleanupErrorListener?.();
    cleanupErrorListener = null;
  }, 30_000);
  const cleanupCloseListenerOnly = () => {
    cleanupCloseListener?.();
    cleanupCloseListener = null;
    if (terminateTimer) {
      globalThis.clearTimeout(terminateTimer);
      terminateTimer = null;
    }
  };
  const cleanupAllGuards = () => {
    cleanupCloseListenerOnly();
    cleanupErrorListener?.();
    cleanupErrorListener = null;
    globalThis.clearTimeout(cleanupTimer);
  };

  if (
    typeof cleanupTimer === "object" &&
    cleanupTimer &&
    "unref" in cleanupTimer &&
    typeof cleanupTimer.unref === "function"
  ) {
    cleanupTimer.unref();
  }
  cleanupCloseListener = addSocketListener(socket, "close", cleanupCloseListenerOnly);

  try {
    if (socket.readyState === 0 && typeof socket.terminate === "function") {
      socket.terminate();
      return;
    }

    socket.close();
    if (typeof socket.terminate === "function") {
      terminateTimer = globalThis.setTimeout(() => {
        if (socket.readyState !== 3) {
          socket.terminate?.();
        }
      }, 1_000);
      if (
        typeof terminateTimer === "object" &&
        terminateTimer &&
        "unref" in terminateTimer &&
        typeof terminateTimer.unref === "function"
      ) {
        terminateTimer.unref();
      }
    }
  } catch {
    cleanupAllGuards();
  }
}
