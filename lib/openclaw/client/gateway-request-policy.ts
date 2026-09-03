import "server-only";

import type {
  OpenClawCommandOptions,
  OpenClawGatewayRequestPolicy
} from "@/lib/openclaw/client/types";

export const AGENTOS_GATEWAY_READ_CACHE_TTL_MS = 300;

export type AgentOsGatewayRequestPolicyConnectionSnapshot = {
  lifecycleState: string;
  generation: number;
};

export type AgentOsGatewayRequestPolicyConnectionState = AgentOsGatewayRequestPolicyConnectionSnapshot & {
  getCurrentState: () => AgentOsGatewayRequestPolicyConnectionSnapshot;
};

export type AgentOsGatewayRequestPolicyOptions = {
  now?: () => number;
  readCacheTtlMs?: number;
};

type ReadCacheEntry = {
  expiresAt: number;
  generation: number;
  payload: unknown;
};

type SharedReadRequest = {
  promise: Promise<unknown>;
};

/**
 * AgentOS-owned request policy shared by every Gateway transport.
 *
 * This class deliberately knows nothing about WebSockets or OpenClaw wire
 * frames. The caller supplies the transport request and the current
 * lifecycle/generation state, so policy semantics remain stable when the
 * underlying Gateway transport changes.
 */
export class AgentOsGatewayRequestPolicy {
  readonly #now: () => number;
  readonly #readCacheTtlMs: number;
  readonly #sharedReadRequests = new Map<string, SharedReadRequest>();
  readonly #readRequestCache = new Map<string, ReadCacheEntry>();
  #epoch = 0;
  #generation: number | null = null;
  #lifecycleState: string | null = null;

  constructor(options: AgentOsGatewayRequestPolicyOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#readCacheTtlMs = typeof options.readCacheTtlMs === "number" && Number.isFinite(options.readCacheTtlMs)
      ? Math.max(1, options.readCacheTtlMs)
      : AGENTOS_GATEWAY_READ_CACHE_TTL_MS;
  }

  getDiagnostics() {
    this.#pruneExpiredReadCache();
    return {
      sharedInFlightRequestCount: this.#sharedReadRequests.size,
      cachedReadRequestCount: this.#readRequestCache.size
    };
  }

  observeConnectionState(connection: AgentOsGatewayRequestPolicyConnectionState) {
    const previousLifecycleState = this.#lifecycleState;
    const lifecycleChanged = this.#lifecycleState !== connection.lifecycleState;
    this.#lifecycleState = connection.lifecycleState;

    if (lifecycleChanged && shouldResetForLifecycleState(connection.lifecycleState)) {
      this.reset(connection.generation);
      return;
    }

    const previousConnectionWasInvalidated = previousLifecycleState === null ||
      shouldResetForLifecycleState(previousLifecycleState);
    if (
      this.#generation !== null &&
      this.#generation !== connection.generation &&
      !previousConnectionWasInvalidated
    ) {
      this.reset(connection.generation);
      return;
    }

    this.#generation = connection.generation;
  }

  reset(generation = this.#generation) {
    this.#epoch += 1;
    this.#sharedReadRequests.clear();
    this.#readRequestCache.clear();
    this.#generation = generation;
  }

  invalidateReadCache() {
    this.invalidateReadState();
  }

  async request<TPayload>(
    method: string,
    params: Record<string, unknown>,
    options: OpenClawCommandOptions,
    policy: Pick<OpenClawGatewayRequestPolicy, "safety">,
    send: () => Promise<TPayload>,
    connection: AgentOsGatewayRequestPolicyConnectionState
  ): Promise<TPayload> {
    this.observeConnectionState(connection);

    if (policy.safety !== "read" || options.signal) {
      if (policy.safety !== "read") {
        this.invalidateReadState();
      }
      return send();
    }

    this.#pruneExpiredReadCache();
    const cacheKey = buildGatewayRequestCacheKey(method, params);
    const cached = this.#readRequestCache.get(cacheKey);

    if (
      connection.lifecycleState === "connected" &&
      cached &&
      cached.generation === connection.generation &&
      cached.expiresAt > this.#now()
    ) {
      return cached.payload as TPayload;
    }

    const existing = this.#sharedReadRequests.get(cacheKey);
    if (existing) {
      return existing.promise as Promise<TPayload>;
    }

    const requestEpoch = this.#epoch;
    const requestGeneration = connection.generation;
    const startedConnected = connection.lifecycleState === "connected";
    let sharedReadRequest: SharedReadRequest | null = null;
    const promise = Promise.resolve()
      .then(send)
      .then((payload) => {
        const current = connection.getCurrentState();
        const generationMatches = startedConnected
          ? current.generation === requestGeneration
          : current.lifecycleState === "connected";

        if (
          requestEpoch === this.#epoch &&
          current.lifecycleState === "connected" &&
          generationMatches
        ) {
          this.#generation = current.generation;
          this.#readRequestCache.set(cacheKey, {
            expiresAt: this.#now() + this.#readCacheTtlMs,
            generation: current.generation,
            payload
          });
        }

        return payload;
      })
      .finally(() => {
        if (sharedReadRequest && this.#sharedReadRequests.get(cacheKey) === sharedReadRequest) {
          this.#sharedReadRequests.delete(cacheKey);
        }
      });

    sharedReadRequest = {
      promise
    };
    this.#sharedReadRequests.set(cacheKey, sharedReadRequest);
    return promise;
  }

  private invalidateReadState() {
    this.#epoch += 1;
    this.#sharedReadRequests.clear();
    this.#readRequestCache.clear();
  }

  #pruneExpiredReadCache() {
    const now = this.#now();
    for (const [key, entry] of this.#readRequestCache) {
      if (entry.expiresAt <= now) {
        this.#readRequestCache.delete(key);
      }
    }
  }
}

export function buildGatewayRequestCacheKey(method: string, params: Record<string, unknown>) {
  return `${method}:${stableStringify(params)}`;
}

export function stableStringify(value: unknown): string {
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

function shouldResetForLifecycleState(state: string) {
  return state === "reconnecting" ||
    state === "reconnect-paused" ||
    state === "closed" ||
    state === "error" ||
    state === "stopped";
}
