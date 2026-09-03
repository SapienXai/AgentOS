import "server-only";

import type { HelloOk } from "@openclaw/gateway-protocol/frame-guards";
import {
  getGatewaySessionMessageSubscriptionCoordinator,
  releaseGatewaySessionMessageSubscription,
  resetGatewaySessionMessageSubscriptionCoordinator,
  type GatewaySessionMessageSubscription,
  type GatewaySessionMessageSubscriptionCoordinator
} from "@openclaw/gateway-client";

import { NativeGatewayError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import type {
  OpenClawCommandOptions,
  OpenClawGatewayClientDiagnostics,
  OpenClawGatewayEventCallbacks,
  OpenClawGatewayEventConnectionState,
  OpenClawGatewayEventFrame,
  OpenClawGatewayEventSubscription
} from "@/lib/openclaw/client/types";
import type { OpenClawOperatorIdentity } from "@/lib/openclaw/identity/types";
import {
  readAdvertisedGatewayCapabilities,
  readAdvertisedGatewayMethods
} from "@/lib/openclaw/client/native-ws-gateway-protocol";
import type { NativeHandshakePayload } from "@/lib/openclaw/client/native-ws-gateway-types";
import { OfficialOpenClawGatewayTransport } from "@/lib/openclaw/client/official-gateway-transport";
import { AgentOsGatewayRequestPolicy } from "@/lib/openclaw/client/gateway-request-policy";

type RuntimeLease = {
  callbacks: OpenClawGatewayEventCallbacks;
  includeSessions: boolean;
  sessionKeys: Set<string>;
  closed: boolean;
};

type OfficialCoordinatorOptions = {
  replayTimeoutMs?: number;
  requestPolicy?: AgentOsGatewayRequestPolicy;
};

const defaultReplayTimeoutMs = 5_000;

/**
 * AgentOS-owned integration coordinator for one official GatewayClient.
 *
 * The official transport remains the only socket/reconnect/request owner. This
 * class retains AgentOS subscription intent and replays it after each hello-ok;
 * it never opens a socket or invents a second request/correlation layer.
 */
export class OfficialOpenClawGatewayConnectionCoordinator {
  readonly lifecycleOwner = "official" as const;
  readonly #transport: OfficialOpenClawGatewayTransport;
  readonly #replayTimeoutMs: number;
  readonly #requestPolicy: AgentOsGatewayRequestPolicy | null;
  readonly #leases = new Set<RuntimeLease>();
  #state: OpenClawGatewayEventConnectionState = "stopped";
  #generation = 0;
  #replayPromise: Promise<void> | null = null;
  #sessionsEstablishedGeneration = 0;
  readonly #messageEstablishedGeneration = new Map<string, number>();
  #messageCoordinator: GatewaySessionMessageSubscriptionCoordinator | null = null;
  #messageRequestClient: { request: <TPayload = unknown>(method: string, params: Record<string, unknown>, options?: { timeoutMs?: number | null; signal?: AbortSignal }) => Promise<TPayload> } | null = null;
  readonly #messageSubscriptions = new Map<string, GatewaySessionMessageSubscription>();

  constructor(
    transport: OfficialOpenClawGatewayTransport,
    options: OfficialCoordinatorOptions = {}
  ) {
    this.#transport = transport;
    this.#requestPolicy = options.requestPolicy ?? null;
    this.#replayTimeoutMs = typeof options.replayTimeoutMs === "number" && Number.isFinite(options.replayTimeoutMs)
      ? Math.max(1, options.replayTimeoutMs)
      : defaultReplayTimeoutMs;
  }

  handleHello(hello: HelloOk): void {
    const generation = this.#transport.getGeneration();
    if (this.#messageRequestClient) {
      resetGatewaySessionMessageSubscriptionCoordinator(this.#messageRequestClient);
    }
    this.#messageSubscriptions.clear();
    this.#messageRequestClient = {
      request: <TPayload = unknown>(method: string, params: Record<string, unknown>, options?: { timeoutMs?: number | null; signal?: AbortSignal }) =>
        this.#transport.requestForGeneration<TPayload>(generation, method, params, {
          timeoutMs: Math.min(
            this.#replayTimeoutMs,
            typeof options?.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
              ? Math.max(1, options.timeoutMs)
              : this.#replayTimeoutMs
          ),
          signal: options?.signal
        })
    };
    this.#messageCoordinator = getGatewaySessionMessageSubscriptionCoordinator(this.#messageRequestClient);
    this.#generation = generation;
    this.#sessionsEstablishedGeneration = 0;
    this.#messageEstablishedGeneration.clear();
    const reconnect = generation > 1;
    this.#setState(reconnect ? "reconnecting" : "connecting");

    const replay = this.#replayForGeneration(generation);
    this.#replayPromise = replay;
    void replay
      .then(async () => {
        if (this.#generation !== generation || this.#transport.getGeneration() !== generation) {
          return;
        }
        if (reconnect) {
          await this.#notifyReconnected(generation);
        }
        if (this.#generation === generation && this.#transport.getGeneration() === generation) {
          this.#setState("connected");
        }
      })
      .catch((error) => {
        if (this.#generation !== generation) {
          return;
        }
        this.#notifyError(error);
        if (this.#transport.getLifecycleState() !== "reconnecting") {
          this.#setState("reconnecting");
        }
      });

    // Keep the argument observable for lifecycle tests without storing a raw
    // protocol frame outside the official transport.
    void hello;
  }

  handleEvent(event: OpenClawGatewayEventFrame): void {
    for (const lease of [...this.#leases]) {
      if (lease.closed) {
        continue;
      }
      try {
        lease.callbacks.onEvent(event);
      } catch (error) {
        this.#notifyLeaseError(lease, error);
      }
    }
  }

  handleClose(): void {
    this.#replayPromise = null;
    this.#sessionsEstablishedGeneration = 0;
    this.#messageEstablishedGeneration.clear();
    if (this.#messageRequestClient) {
      resetGatewaySessionMessageSubscriptionCoordinator(this.#messageRequestClient);
    }
    this.#messageCoordinator = null;
    this.#messageRequestClient = null;
    this.#messageSubscriptions.clear();
    if (this.#transport.getLifecycleState() === "stopped") {
      this.#setState("stopped");
      return;
    }
    if (this.#transport.getLifecycleState() === "reconnect-paused") {
      this.#setState("reconnect-paused");
      return;
    }
    this.#setState("reconnecting");
  }

  handleReconnectPaused(): void {
    this.#replayPromise = null;
    this.#setState("reconnect-paused");
  }

  handleGap(info: { expected: number; received: number }): void {
    for (const lease of [...this.#leases]) {
      if (lease.closed || !lease.callbacks.onGap) {
        continue;
      }
      void Promise.resolve(lease.callbacks.onGap(info)).catch((error) => {
        this.#notifyLeaseError(lease, error);
      });
    }
  }

  start(): void {
    this.#transport.start();
    if (this.#state === "stopped") {
      this.#setState("connecting");
    }
  }

  close(reason = "closed"): void {
    for (const lease of this.#leases) {
      lease.closed = true;
    }
    this.#leases.clear();
    if (this.#messageRequestClient) {
      resetGatewaySessionMessageSubscriptionCoordinator(this.#messageRequestClient);
    }
    this.#messageCoordinator = null;
    this.#messageRequestClient = null;
    this.#messageSubscriptions.clear();
    this.#transport.stop();
    this.#setState("stopped");
    void reason;
  }

  async request<TPayload>(
    method: string,
    params: Record<string, unknown>,
    options: OpenClawCommandOptions,
    timeoutMs: number
  ): Promise<TPayload> {
    const deadline = Date.now() + timeoutMs;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const remainingMs = Math.max(1, deadline - Date.now());
      const hello = await this.#transport.waitForReady({ method, timeoutMs: remainingMs, signal: options.signal });
      const generation = this.#transport.getGeneration();
      await this.#waitForReplay(generation);
      this.#assertGeneration(generation);
      try {
        void hello;
        return await this.#transport.request<TPayload>(method, params, {
          timeoutMs: remainingMs,
          signal: options.signal
        });
      } catch (error) {
        if (attempt === 0 && isRetryableConnectionTransition(error) && Date.now() < deadline) {
          continue;
        }
        throw error;
      }
    }
    throw new NativeGatewayError(`OpenClaw Gateway request "${method}" exceeded its retry budget.`, { kind: "unreachable" });
  }

  async probe(options: OpenClawCommandOptions, timeoutMs: number): Promise<NativeHandshakePayload> {
    const hello = await this.#transport.waitForReady({ method: "connect", timeoutMs, signal: options.signal });
    await this.#waitForReplay(this.#transport.getGeneration());
    return hello;
  }

  async subscribe(
    params: Record<string, unknown>,
    callbacks: OpenClawGatewayEventCallbacks,
    options: OpenClawCommandOptions,
    timeoutMs: number
  ): Promise<OpenClawGatewayEventSubscription> {
    const input = normalizeRuntimeIntent(params);
    const wasAlreadyConnected = this.#state === "connected" && this.#transport.getLifecycleState() === "connected";
    const lease: RuntimeLease = {
      callbacks,
      includeSessions: input.includeSessions,
      sessionKeys: new Set(input.sessionKeys),
      closed: false
    };
    this.#leases.add(lease);

    const deadline = Date.now() + timeoutMs;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const remainingMs = Math.max(1, deadline - Date.now());
      try {
        this.start();
        await this.#transport.waitForReady({ method: "sessions.subscribe", timeoutMs: remainingMs, signal: options.signal });
        const generation = this.#transport.getGeneration();
        await this.#waitForReplay(generation);
        await this.#ensureIntentForGeneration(generation);
        if (wasAlreadyConnected && !lease.closed) {
          this.#notifyLeaseState(lease, "connected");
        }
        return {
          reconnectManagedByClient: true,
          close: () => {
            if (lease.closed) {
              return;
            }
            lease.closed = true;
            this.#leases.delete(lease);
            void this.#releaseIntent(lease).catch((error) => this.#notifyLeaseError(lease, error));
          }
        };
      } catch (error) {
        if (attempt === 0 && isRetryableConnectionTransition(error) && Date.now() < deadline) {
          continue;
        }
        this.#leases.delete(lease);
        lease.closed = true;
        throw error;
      }
    }
    this.#leases.delete(lease);
    lease.closed = true;
    throw new NativeGatewayError("OpenClaw Gateway subscription exceeded its retry budget.", { kind: "unreachable" });
  }

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
  > {
    const hello = this.#transport.getHandshake();
    const transportState = this.#transport.getLifecycleState();
    const requestPolicy = this.#requestPolicy;
    requestPolicy?.observeConnectionState(this.#requestPolicyConnectionState());
    const requestPolicyDiagnostics = requestPolicy?.getDiagnostics();
    return {
      connectionState: transportState === "connected"
        ? "connected"
        : transportState === "stopped"
          ? "closed"
          : transportState === "reconnect-paused"
            ? "error"
            : "connecting",
      protocolVersion: typeof hello?.protocol === "number" ? hello.protocol : null,
      gatewayCapabilities: readAdvertisedGatewayCapabilities(hello),
      pendingRequestCount: undefined,
      sharedInFlightRequestCount: requestPolicyDiagnostics?.sharedInFlightRequestCount,
      cachedReadRequestCount: requestPolicyDiagnostics?.cachedReadRequestCount,
      lastNativeError: this.#transport.getLastError(),
      lastConnectedAt: this.#transport.getLastConnectedAt(),
      lastDisconnectedAt: this.#transport.getLastDisconnectedAt(),
      operatorIdentity: this.getOperatorIdentity()
    };
  }

  getOperatorIdentity(): OpenClawOperatorIdentity {
    const hello = this.#transport.getHandshake();
    const authenticated = Boolean(hello?.auth?.role);
    return {
      requestedRole: this.#transport.getRequestedRole(),
      role: authenticated ? readOptionalString(hello?.auth?.role) : null,
      requestedScopes: this.#transport.getRequestedScopes(),
      grantedScopes: readStringArray(hello?.auth?.scopes),
      grantedScopesKnown: Array.isArray(hello?.auth?.scopes),
      deviceId: this.#transport.getDeviceId(),
      connectionId: readOptionalString(hello?.server?.connId),
      authenticated,
      source: authenticated ? "native-handshake" : "unavailable"
    };
  }

  getHandshake() {
    return this.#transport.getHandshake();
  }

  getAdvertisedGatewayMethods() {
    return readAdvertisedGatewayMethods(this.#transport.getHandshake());
  }

  getLifecycleState() {
    return this.#state;
  }

  getGeneration() {
    return this.#transport.getGeneration();
  }

  #requestPolicyConnectionState() {
    return {
      lifecycleState: this.#state,
      generation: this.#transport.getGeneration(),
      getCurrentState: () => ({
        lifecycleState: this.#state,
        generation: this.#transport.getGeneration()
      })
    };
  }

  #setState(state: OpenClawGatewayEventConnectionState) {
    this.#state = state;
    for (const lease of [...this.#leases]) {
      this.#notifyLeaseState(lease, state);
    }
  }

  #notifyLeaseState(lease: RuntimeLease, state: OpenClawGatewayEventConnectionState) {
    if (lease.closed || !lease.callbacks.onConnectionStateChange) {
      return;
    }
    try {
      lease.callbacks.onConnectionStateChange(state);
    } catch (error) {
      this.#notifyLeaseError(lease, error);
    }
  }

  async #waitForReplay(generation: number) {
    const replay = this.#replayPromise;
    if (replay) {
      await replay;
    }
    this.#assertGeneration(generation);
  }

  async #replayForGeneration(generation: number) {
    if (this.#transport.getGeneration() !== generation) {
      return;
    }

    if (this.#hasSessionIntent() && this.#sessionsEstablishedGeneration !== generation) {
      await this.#requestForGeneration("sessions.subscribe", {}, generation);
      this.#sessionsEstablishedGeneration = generation;
    }

    for (const key of this.#sessionKeys()) {
      if (this.#messageEstablishedGeneration.get(key) === generation) {
        continue;
      }
      const messageCoordinator = this.#messageCoordinator;
      const messageRequestClient = this.#messageRequestClient;
      if (!messageCoordinator || !messageRequestClient) {
        throw new NativeGatewayError("OpenClaw Gateway session-message coordinator is not ready.", { kind: "unreachable" });
      }
      const subscription = await messageCoordinator.acquire(key);
      if (this.#generation !== generation || this.#transport.getGeneration() !== generation) {
        resetGatewaySessionMessageSubscriptionCoordinator(messageRequestClient);
        throw new NativeGatewayError("OpenClaw Gateway session-message subscription crossed a connection generation boundary.", { kind: "unreachable" });
      }
      this.#messageSubscriptions.set(key, subscription);
      this.#messageEstablishedGeneration.set(key, generation);
    }
  }

  async #ensureIntentForGeneration(generation: number) {
    if (this.#hasSessionIntent() && this.#sessionsEstablishedGeneration !== generation) {
      await this.#requestForGeneration("sessions.subscribe", {}, generation);
      this.#sessionsEstablishedGeneration = generation;
    }
    for (const key of this.#sessionKeys()) {
      if (this.#messageEstablishedGeneration.get(key) === generation) {
        continue;
      }
      const messageCoordinator = this.#messageCoordinator;
      if (!messageCoordinator) {
        throw new NativeGatewayError("OpenClaw Gateway session-message coordinator is not ready.", { kind: "unreachable" });
      }
      const subscription = await messageCoordinator.acquire(key);
      this.#messageSubscriptions.set(key, subscription);
      this.#messageEstablishedGeneration.set(key, generation);
    }
  }

  async #requestForGeneration(method: string, params: Record<string, unknown>, generation: number) {
    this.#assertGeneration(generation);
    if (method === "sessions.subscribe" && !this.#hasSessionIntent()) {
      return;
    }
    if (method === "sessions.messages.subscribe" && !this.#sessionKeys().includes(String(params.key))) {
      return;
    }
    await this.#transport.requestForGeneration(generation, method, params, {
      timeoutMs: this.#replayTimeoutMs
    });
    this.#assertGeneration(generation);
  }

  async #releaseIntent(lease: RuntimeLease) {
    const generation = this.#generation;
    if (this.#state !== "connected" || this.#transport.getGeneration() !== generation) {
      return;
    }

    for (const key of lease.sessionKeys) {
      if (this.#sessionKeys().includes(key)) {
        continue;
      }
      if (this.#messageEstablishedGeneration.get(key) !== generation) {
        continue;
      }
      const messageSubscription = this.#messageSubscriptions.get(key);
      if (messageSubscription) {
        await releaseGatewaySessionMessageSubscription(messageSubscription);
        this.#messageSubscriptions.delete(key);
      }
      this.#messageEstablishedGeneration.delete(key);
    }
  }

  #hasSessionIntent() {
    return [...this.#leases].some((lease) => !lease.closed && lease.includeSessions);
  }

  #sessionKeys() {
    return [...new Set(
      [...this.#leases].flatMap((lease) => lease.closed ? [] : [...lease.sessionKeys])
    )].sort();
  }

  async #notifyReconnected(generation: number) {
    const callbacks = new Set(
      [...this.#leases]
        .filter((lease) => !lease.closed && lease.callbacks.onReconnected)
        .map((lease) => lease.callbacks.onReconnected)
    );
    for (const callback of callbacks) {
      if (!callback) {
        continue;
      }
      await callback({ generation });
    }
  }

  #notifyError(error: unknown) {
    for (const lease of [...this.#leases]) {
      this.#notifyLeaseError(lease, error);
    }
  }

  #notifyLeaseError(lease: RuntimeLease, error: unknown) {
    if (lease.closed) {
      return;
    }
    try {
      lease.callbacks.onError?.(error);
    } catch {
      // Diagnostics callbacks cannot be allowed to break the official event path.
    }
  }

  #assertGeneration(generation: number) {
    if (this.#transport.getGeneration() !== generation || this.#state === "reconnect-paused" || this.#state === "stopped") {
      throw new NativeGatewayError("OpenClaw Gateway connection generation changed while replaying subscription intent.", {
        kind: "unreachable"
      });
    }
  }
}

function normalizeRuntimeIntent(params: Record<string, unknown>) {
  const explicit = [
    params.subscribeSessions,
    params.subscribeTasks,
    params.subscribeArtifacts,
    params.subscribeApprovals
  ].some((value) => value !== undefined);
  const sessionKeys = Array.isArray(params.sessionKeys)
    ? [...new Set(params.sessionKeys.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim()))]
    : [];
  return {
    includeSessions: params.subscribeSessions !== false && (!explicit || params.subscribeSessions === true),
    sessionKeys
  };
}

function readOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function isRetryableConnectionTransition(error: unknown) {
  return error instanceof NativeGatewayError && error.kind === "unreachable" &&
    (!("sent" in error) || (error as { sent?: boolean }).sent === false);
}
