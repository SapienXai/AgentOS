import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { WebSocketServer, type WebSocket } from "ws";

export type OfficialGatewayRequest = {
  id: string;
  method: string;
  params?: unknown;
  socket: WebSocket;
};

export type OfficialGatewayRequestContext = {
  request: OfficialGatewayRequest;
  respond: (payload?: unknown) => void;
  fail: (error: { code: string; message: string; details?: unknown }) => void;
  leaveOpen: () => void;
  emitEvent: (event: string, payload: unknown, seq?: number) => void;
  sendRaw: (frame: unknown) => void;
  close: (code?: number, reason?: string) => void;
};

export type OfficialGatewayRoute = (
  context: OfficialGatewayRequestContext
) => void | Promise<void>;

export type OfficialGatewayHarnessOptions = {
  methods?: string[];
  events?: string[];
  scopes?: string[];
  version?: string;
  challengeNonce?: string;
  challengeTimestamp?: number;
  deviceToken?: string;
  connectFailure?: { code: string; message: string; details?: unknown };
  routes?: Record<string, OfficialGatewayRoute>;
};

type HarnessConnection = {
  socket: WebSocket;
  requests: OfficialGatewayRequest[];
};

/** A small protocol-valid Gateway server backed by a real ws.WebSocketServer. */
export class OfficialGatewayHarness {
  readonly #server: WebSocketServer;
  readonly #options: Required<Pick<OfficialGatewayHarnessOptions, "methods" | "events" | "scopes" | "version">> &
    Pick<OfficialGatewayHarnessOptions, "challengeNonce" | "challengeTimestamp" | "connectFailure" | "deviceToken" | "routes">;
  readonly #connections: HarnessConnection[] = [];
  readonly #requests: OfficialGatewayRequest[] = [];
  readonly #waiters = new Map<string, Array<(request: OfficialGatewayRequest) => void>>();

  private constructor(options: OfficialGatewayHarnessOptions) {
    this.#server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    this.#options = {
      methods: options.methods ?? [],
      events: options.events ?? [],
      scopes: options.scopes ?? ["operator.admin", "operator.read", "operator.write"],
      version: options.version ?? "2026.9.1",
      challengeNonce: options.challengeNonce ?? "harness-nonce",
      challengeTimestamp: options.challengeTimestamp ?? Date.now(),
      connectFailure: options.connectFailure,
      deviceToken: options.deviceToken,
      routes: options.routes
    };

    this.#server.on("connection", (socket) => this.#handleConnection(socket));
  }

  static async create(options: OfficialGatewayHarnessOptions = {}) {
    const harness = new OfficialGatewayHarness(options);
    await once(harness.#server, "listening");
    return harness;
  }

  get url() {
    const address = this.#server.address() as AddressInfo;
    return `ws://127.0.0.1:${address.port}`;
  }

  get requests() {
    return [...this.#requests];
  }

  get connectionCount() {
    return this.#connections.length;
  }

  get connections() {
    return this.#connections.map(({ socket }) => socket);
  }

  async waitForRequest(method: string, timeoutMs = 2_000) {
    const existing = this.#requests.find((request) => request.method === method);
    if (existing) {
      return existing;
    }

    return new Promise<OfficialGatewayRequest>((resolve, reject) => {
      const timer = setTimeout(() => {
        const waiters = this.#waiters.get(method) ?? [];
        this.#waiters.set(method, waiters.filter((waiter) => waiter !== onRequest));
        reject(new Error(`Timed out waiting for Gateway request ${method}.`));
      }, timeoutMs);
      const onRequest = (request: OfficialGatewayRequest) => {
        clearTimeout(timer);
        resolve(request);
      };
      this.#waiters.set(method, [...(this.#waiters.get(method) ?? []), onRequest]);
    });
  }

  emitEvent(event: string, payload: unknown, seq?: number, socket?: WebSocket) {
    const frame = {
      type: "event",
      event,
      payload,
      ...(seq === undefined ? {} : { seq })
    };
    const targets = socket ? [socket] : this.connections;

    for (const target of targets) {
      if (target.readyState === target.OPEN) {
        target.send(JSON.stringify(frame));
      }
    }
  }

  closeSockets(code = 1012, reason = "restart") {
    for (const socket of this.connections) {
      if (socket.readyState === socket.OPEN) {
        socket.close(code, reason);
      }
    }
  }

  async close() {
    this.closeSockets(1000, "harness closed");
    for (const socket of this.connections) {
      socket.terminate();
    }
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  #handleConnection(socket: WebSocket) {
    const connection: HarnessConnection = { socket, requests: [] };
    this.#connections.push(connection);
    socket.send(JSON.stringify({
      type: "event",
      event: "connect.challenge",
      payload: {
        nonce: `${this.#options.challengeNonce}-${this.#connections.length}`,
        ts: this.#options.challengeTimestamp
      }
    }));

    socket.on("message", (data) => {
      let frame: unknown;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        socket.close(1007, "invalid json");
        return;
      }

      if (!isRequestFrame(frame)) {
        return;
      }

      const request: OfficialGatewayRequest = {
        id: frame.id,
        method: frame.method,
        params: frame.params,
        socket
      };
      connection.requests.push(request);
      this.#requests.push(request);
      for (const waiter of this.#waiters.get(request.method) ?? []) {
        waiter(request);
      }
      this.#waiters.delete(request.method);

      const context: OfficialGatewayRequestContext = {
        request,
        respond: (payload = {}) => this.#send(socket, { type: "res", id: request.id, ok: true, payload }),
        fail: (error) => this.#send(socket, { type: "res", id: request.id, ok: false, error }),
        leaveOpen: () => {},
        emitEvent: (event, payload, seq) => this.emitEvent(event, payload, seq, socket),
        sendRaw: (rawFrame) => this.#send(socket, rawFrame),
        close: (code, reason) => socket.close(code, reason)
      };

      if (request.method === "connect") {
        if (this.#options.connectFailure) {
          context.fail(this.#options.connectFailure);
          return;
        }
        context.respond({
          type: "hello-ok",
          protocol: 4,
          server: {
            version: this.#options.version,
            connId: `harness-${this.#connections.length}`
          },
          features: {
            methods: this.#options.methods,
            events: this.#options.events
          },
          snapshot: {},
          auth: {
            role: "operator",
            scopes: this.#options.scopes,
            ...(this.#options.deviceToken ? { deviceToken: this.#options.deviceToken } : {})
          },
          policy: {
            maxPayload: 1_000_000,
            maxBufferedBytes: 1_000_000,
            tickIntervalMs: 15_000
          }
        });
        return;
      }

      const route = this.#options.routes?.[request.method];
      if (route) {
        void route(context);
        return;
      }

      context.respond({ method: request.method, params: request.params });
    });
  }

  #send(socket: WebSocket, frame: unknown) {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify(frame));
    }
  }
}

function isRequestFrame(value: unknown): value is { type: "req"; id: string; method: string; params?: unknown } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const frame = value as Record<string, unknown>;
  return frame.type === "req" && typeof frame.id === "string" && typeof frame.method === "string";
}
