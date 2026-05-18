import assert from "node:assert/strict";
import { test } from "node:test";

import {
  clearOpenClawGatewayFallbackDiagnosticsForTesting,
  getRecentOpenClawGatewayFallbackDiagnostics,
  NativeWsOpenClawGatewayClient,
  type WebSocketFactory
} from "@/lib/openclaw/client/native-ws-gateway-client";
import type {
  OpenClawCommandOptions,
  OpenClawGatewayClient
} from "@/lib/openclaw/client/gateway-client";

type SentFrame = {
  type: string;
  id: string;
  method: string;
  params: Record<string, unknown>;
};

class FallbackGatewayClient implements OpenClawGatewayClient {
  calls: Array<{ method: string; params?: Record<string, unknown>; options?: OpenClawCommandOptions }> = [];
  configCalls: string[] = [];
  config = new Map<string, unknown>();
  failConfigWithInvalidConfig = false;
  failStatus = false;
  statusPayload: Record<string, unknown> = {};

  async getHealth() {
    this.calls.push({ method: "getHealth" });
    return { ok: true };
  }

  async getStatus() {
    this.calls.push({ method: "getStatus" });
    if (this.failStatus) {
      throw new Error("CLI status failed");
    }
    return this.statusPayload;
  }

  async getGatewayStatus() {
    this.calls.push({ method: "getGatewayStatus" });
    return {};
  }

  async getModelStatus() {
    this.calls.push({ method: "getModelStatus" });
    return {};
  }

  async getAgentModelStatus() {
    this.calls.push({ method: "getAgentModelStatus" });
    return {};
  }

  async setModelAuthOrder() {
    this.calls.push({ method: "setModelAuthOrder" });
    return { stdout: "", stderr: "", code: 0 };
  }

  async listAgents() {
    this.calls.push({ method: "listAgents" });
    return { agents: [] };
  }

  async listSessions() {
    this.calls.push({ method: "listSessions" });
    return { sessions: [] };
  }

  async describeSession() {
    this.calls.push({ method: "describeSession" });
    return {};
  }

  async getSessionHistory() {
    this.calls.push({ method: "getSessionHistory" });
    return {};
  }

  async exportSession() {
    this.calls.push({ method: "exportSession" });
    return {};
  }

  async listTasks() {
    this.calls.push({ method: "listTasks" });
    return { tasks: [] };
  }

  async getTask() {
    this.calls.push({ method: "getTask" });
    return {};
  }

  async assignTask() {
    this.calls.push({ method: "assignTask" });
    return {};
  }

  async cancelTask() {
    this.calls.push({ method: "cancelTask" });
    return {};
  }

  async listArtifacts() {
    this.calls.push({ method: "listArtifacts" });
    return { artifacts: [] };
  }

  async getArtifact() {
    this.calls.push({ method: "getArtifact" });
    return {};
  }

  async putArtifact() {
    this.calls.push({ method: "putArtifact" });
    return {};
  }

  async deleteArtifact() {
    this.calls.push({ method: "deleteArtifact" });
    return {};
  }

  async getRuntimeSnapshot() {
    this.calls.push({ method: "getRuntimeSnapshot" });
    return {};
  }

  async getToolsCatalog() {
    this.calls.push({ method: "getToolsCatalog" });
    return { tools: [] };
  }

  async getEffectiveTools() {
    this.calls.push({ method: "getEffectiveTools" });
    return { tools: [] };
  }

  async invokeTool() {
    this.calls.push({ method: "invokeTool" });
    return { ok: true };
  }

  async subscribeRuntimeEvents() {
    this.calls.push({ method: "subscribeRuntimeEvents" });
    return {
      close() {
        return undefined;
      }
    };
  }

  async getChannelStatus() {
    this.calls.push({ method: "getChannelStatus" });
    return {
      ts: 0,
      channelOrder: [],
      channelLabels: {},
      channels: {},
      channelAccounts: {},
      channelDefaultAccountId: {}
    };
  }

  async getChannelLogs() {
    this.calls.push({ method: "getChannelLogs" });
    return { lines: [] };
  }

  async listSkills() {
    this.calls.push({ method: "listSkills" });
    return { skills: [] };
  }

  async listPlugins() {
    this.calls.push({ method: "listPlugins" });
    return { plugins: [] };
  }

  async listModels() {
    this.calls.push({ method: "listModels" });
    return { models: [] };
  }

  async scanModels() {
    return [];
  }

  async probeGateway() {
    return {};
  }

  async controlGateway() {
    return {};
  }

  async call<TPayload>(
    method: string,
    params: Record<string, unknown> = {},
    options: OpenClawCommandOptions = {}
  ) {
    this.calls.push({ method, params, options });
    return { fallback: true, method, params } as TPayload;
  }

  async getConfig<TPayload>(path: string) {
    this.configCalls.push(path);
    if (this.failConfigWithInvalidConfig) {
      throw new Error(
        "OpenClaw config is invalid\nStatus, health, logs, and doctor commands still run with invalid config."
      );
    }

    return (this.config.has(path) ? this.config.get(path) : null) as TPayload | null;
  }

  async getConfigSchema() {
    return null;
  }

  async hasConfig() {
    return false;
  }

  async setConfig() {
    return { stdout: "", stderr: "", code: 0 };
  }

  async unsetConfig() {
    return { stdout: "", stderr: "", code: 0 };
  }

  async addAgent() {
    this.calls.push({ method: "addAgent" });
    return { stdout: "", stderr: "", code: 0 };
  }

  async deleteAgent() {
    this.calls.push({ method: "deleteAgent" });
    return { stdout: "", stderr: "", code: 0 };
  }

  async runAgentTurn() {
    this.calls.push({ method: "runAgentTurn" });
    return {};
  }

  async abortAgentTurn() {
    this.calls.push({ method: "abortAgentTurn" });
    return {};
  }

  async streamAgentTurn() {
    this.calls.push({ method: "streamAgentTurn" });
    return {};
  }
}

function createFakeWebSocket(
  respond: (socket: {
    emitMessage: (frame: Record<string, unknown>) => void;
    emitRaw: (data: string) => void;
    close: () => void;
  }, frame: SentFrame) => void
) {
  const sentFrames: SentFrame[] = [];
  const sockets: Array<{
    emitMessage: (frame: Record<string, unknown>) => void;
    emitRaw: (data: string) => void;
    close: () => void;
  }> = [];

  class FakeWebSocket {
    readyState = 0;
    private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

    constructor(readonly url: string) {
      sockets.push({
        emitMessage: (response) => this.emit("message", { data: JSON.stringify(response) }),
        emitRaw: (response) => this.emit("message", { data: response }),
        close: () => this.close()
      });
      globalThis.queueMicrotask(() => {
        this.readyState = 1;
        this.emit("open", {});
      });
    }

    addEventListener(type: string, listener: (event: unknown) => void) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: (event: unknown) => void) {
      this.listeners.get(type)?.delete(listener);
    }

    send(data: string) {
      const frame = JSON.parse(data) as SentFrame;
      sentFrames.push(frame);
      respond(
        {
          emitMessage: (response) => this.emit("message", { data: JSON.stringify(response) }),
          emitRaw: (response) => this.emit("message", { data: response }),
          close: () => this.close()
        },
        frame
      );
    }

    close() {
      this.readyState = 3;
      this.emit("close", { code: 1000, reason: "closed" });
    }

    private emit(type: string, event: unknown) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event);
      }
    }
  }

  return {
    WebSocketImpl: FakeWebSocket as unknown as WebSocketFactory,
    sentFrames,
    sockets
  };
}

test("native WS gateway client handshakes and correlates request responses", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 3 }
          : { ok: true, method: frame.method, params: frame.params }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.call<{ ok: boolean; method: string; params: Record<string, unknown> }>(
    "health",
    { probe: true }
  );

  assert.deepEqual(result, { ok: true, method: "health", params: { probe: true } });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "health"]);
  assert.equal(fallback.calls.length, 0);
});

test("native WS gateway client reuses one persistent handshake for multiple RPCs", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : { ok: true, method: frame.method }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.call("health");
  await client.call("status");
  await client.call("models.list");

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "health", "status", "models.list"]);
  assert.equal(client.getDiagnostics().protocolVersion, 4);
  assert.equal(client.getDiagnostics().connectionState, "connected");
});

test("native WS gateway client resolves out-of-order responses by request id", async () => {
  const fallback = new FallbackGatewayClient();
  const queued: Array<{ socket: { emitMessage: (frame: Record<string, unknown>) => void }; frame: SentFrame }> = [];
  const { WebSocketImpl } = createFakeWebSocket((socket, frame) => {
    if (frame.method === "connect") {
      globalThis.queueMicrotask(() => {
        socket.emitMessage({ type: "res", id: frame.id, ok: true, payload: { protocol: 4 } });
      });
      return;
    }

    queued.push({ socket, frame });
    if (queued.length === 2) {
      const [first, second] = queued;
      second.socket.emitMessage({
        type: "res",
        id: second.frame.id,
        ok: true,
        payload: { method: second.frame.method }
      });
      first.socket.emitMessage({
        type: "res",
        id: first.frame.id,
        ok: true,
        payload: { method: first.frame.method }
      });
    }
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const [first, second] = await Promise.all([
    client.call<{ method: string }>("agents.list"),
    client.call<{ method: string }>("sessions.list")
  ]);

  assert.deepEqual(first, { method: "agents.list" });
  assert.deepEqual(second, { method: "sessions.list" });
});

test("native WS gateway client ignores event frames while resolving RPC responses", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { ok: true }
      });
      if (frame.method !== "connect") {
        socket.emitMessage({
          type: "event",
          event: "sessions.changed",
          payload: { key: "agent:main:main" }
        });
      }
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.call("health"), { ok: true });
});

test("native WS gateway client exposes handshake feature discovery", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: {
          type: "hello-ok",
          protocol: 4,
          server: { version: "2026.5.12" },
          features: {
            methods: ["status", "chat.send", "sessions.subscribe"],
            events: ["chat", "sessions.changed"]
          },
          auth: { role: "operator", scopes: ["operator.read"] },
          policy: { tickIntervalMs: 15000 }
        }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const hello = await client.probeNativeHandshake();

  assert.equal(hello.protocol, 4);
  assert.deepEqual(hello.features?.methods, ["status", "chat.send", "sessions.subscribe"]);
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect"]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client records protocol mismatch recovery diagnostics", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  fallback.statusPayload = { version: "fallback" };
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: { protocol: 99 }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.getStatus(), { version: "fallback" });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect"]);
  const [diagnostic] = getRecentOpenClawGatewayFallbackDiagnostics();
  assert.equal(diagnostic.operation, "status");
  assert.equal(diagnostic.kind, "protocol-mismatch");
  assert.match(diagnostic.recovery, /supported range 3-4/);
});

test("native WS gateway client uses Gateway first for typed status requests", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
      globalThis.queueMicrotask(() => {
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: true,
          payload: frame.method === "connect"
            ? { protocol: 3 }
            : {
                version: "9.9.9",
                update: {
                  registry: {
                    latestVersion: "10.0.0"
                  }
                },
                ignored: true
              }
        });
      });
    });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.getStatus(), {
    version: "9.9.9",
    update: {
      registry: {
        latestVersion: "10.0.0"
      }
    },
    ignored: true
  });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "status"]);
  assert.deepEqual(sentFrames[0]?.params.client, {
    id: "gateway-client",
    version: "agentos",
    platform: process.platform,
    mode: "backend"
  });
  assert.equal(sentFrames[0]?.params.minProtocol, 3);
  assert.equal(sentFrames[0]?.params.maxProtocol, 4);
  assert.deepEqual(sentFrames[0]?.params.scopes, [
    "operator.admin",
    "operator.read",
    "operator.write",
    "operator.approvals",
    "operator.pairing"
  ]);
  assert.deepEqual(fallback.calls, []);
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
});

test("native WS gateway client backfills missing update registry details from CLI status", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  fallback.statusPayload = {
    version: "9.9.9",
    update: {
      registry: {
        latestVersion: "10.0.0"
      }
    }
  };
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 3 } : { version: "9.9.9" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.getStatus(), {
    version: "9.9.9",
    update: {
      registry: {
        latestVersion: "10.0.0"
      }
    }
  });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "status"]);
  assert.deepEqual(fallback.calls.map((call) => call.method), ["getStatus"]);
});

test("native WS gateway client reuses cached update registry details without repeated CLI status", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  fallback.statusPayload = {
    version: "9.9.9",
    update: {
      registry: {
        latestVersion: "10.0.0"
      }
    }
  };
  const { WebSocketImpl } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 3 } : { version: "9.9.9" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.getStatus();

  assert.deepEqual(await client.getStatus(), {
    version: "9.9.9",
    update: {
      registry: {
        latestVersion: "10.0.0"
      }
    }
  });
  assert.deepEqual(fallback.calls.map((call) => call.method), ["getStatus"]);
});

test("native WS gateway client discovers configured Gateway auth for handshakes", async () => {
  const fallback = new FallbackGatewayClient();
  fallback.config.set("gateway.remote.token", "remote-token");
  fallback.config.set("gateway.auth.token", "local-token");
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 3 } : { version: "9.9.9" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.getStatus();

  assert.deepEqual(sentFrames[0]?.params.auth, {
    token: "local-token"
  });
});

test("native WS gateway client prefers remote auth for remote Gateway URLs", async () => {
  const fallback = new FallbackGatewayClient();
  fallback.config.set("gateway.remote.token", "remote-token");
  fallback.config.set("gateway.auth.token", "local-token");
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 3 } : { version: "9.9.9" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "wss://gateway.example.test",
    timeoutMs: 250
  });

  await client.getStatus();

  assert.deepEqual(sentFrames[0]?.params.auth, {
    token: "remote-token"
  });
});

test("native WS gateway client uses env token without config secret probes", async () => {
  const previousToken = process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN;
  process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN = "env-token";
  const fallback = new FallbackGatewayClient();
  fallback.failConfigWithInvalidConfig = true;
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 3 } : { version: "9.9.9" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  try {
    await client.getStatus();

    assert.deepEqual(sentFrames[0]?.params.auth, {
      token: "env-token"
    });
    assert.deepEqual(fallback.configCalls, []);
  } finally {
    if (previousToken === undefined) {
      delete process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN;
    } else {
      process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN = previousToken;
    }
  }
});

test("native WS gateway client stops config auth probing after invalid config", async () => {
  const fallback = new FallbackGatewayClient();
  fallback.failConfigWithInvalidConfig = true;
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 3 } : { version: "9.9.9" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.getStatus();

  assert.equal(sentFrames[0]?.params.auth, undefined);
  assert.deepEqual(fallback.configCalls, ["gateway.auth.token"]);
});

test("native WS gateway client does not send redacted OpenClaw secrets", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  fallback.config.set("gateway.auth.token", "__OPENCLAW_REDACTED__");
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: { protocol: 3 }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.getStatus(), {});
  assert.equal(sentFrames.length, 0);
  const [diagnostic] = getRecentOpenClawGatewayFallbackDiagnostics();
  assert.equal(diagnostic?.kind, "auth");
  assert.match(diagnostic?.issue, /redacted secret/);
});

test("native WS gateway client falls back when Gateway typed response is malformed", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 3 }
          : { models: [{ id: "missing-name" }] }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.listModels(), { models: [] });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "models.list"]);
  assert.deepEqual(fallback.calls.map((call) => call.method), ["listModels"]);
  assert.match(getRecentOpenClawGatewayFallbackDiagnostics()[0].issue, /malformed response/);
});

test("native WS gateway client treats mixed model auth profiles as connected when one profile is usable", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      const payload =
        frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "models.authStatus"
            ? {
                providers: [{
                  provider: "openai-codex",
                  status: "expired",
                  profiles: [
                    { profileId: "openai-codex:default", status: "expired" },
                    { profileId: "openai-codex:user@example.com", status: "ok" },
                    { profileId: "openai-codex:old@example.com", status: "missing" }
                  ]
                }]
              }
            : {
                models: [{
                  id: "gpt-5.5",
                  provider: "openai-codex",
                  name: "gpt-5.5"
                }]
              };
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const status = await client.getModelStatus();

  assert.deepEqual(status.allowed, ["openai-codex/gpt-5.5"]);
  assert.equal(status.auth?.providers?.[0]?.effective?.kind, "ok");
  assert.equal(status.auth?.providers?.[0]?.profiles?.count, 1);
  assert.equal(status.auth?.oauth?.providers?.[0]?.status, "ok");
  assert.deepEqual(
    sentFrames.map((frame) => frame.method).filter((method) => method !== "connect").sort(),
    ["models.authStatus", "models.list"]
  );
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client reads agent model status through Gateway methods", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      const payload =
        frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "models.authStatus"
            ? {
                agentDir: "/tmp/agent-1",
                providers: [{
                  provider: "openai-codex",
                  status: "expired",
                  profiles: [{ profileId: "openai-codex:user@example.com", status: "ok" }],
                  effectiveProfiles: [{ profileId: "openai-codex:user@example.com" }]
                }]
              }
            : {
                models: [{
                  id: "gpt-5.5",
                  provider: "openai-codex",
                  name: "gpt-5.5"
                }]
              };
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const status = await client.getAgentModelStatus({ agentId: "agent-1" });

  assert.equal(status.agentDir, "/tmp/agent-1");
  assert.deepEqual(status.allowed, ["openai-codex/gpt-5.5"]);
  assert.equal(status.auth?.oauth?.providers?.[0]?.status, "ok");
  assert.deepEqual(status.auth?.oauth?.providers?.[0]?.profiles, [
    { profileId: "openai-codex:user@example.com", status: "ok" }
  ]);
  assert.deepEqual(status.auth?.oauth?.providers?.[0]?.effectiveProfiles, [
    { profileId: "openai-codex:user@example.com" }
  ]);
  assert.deepEqual(
    sentFrames.map((frame) => [frame.method, frame.params]).filter(([method]) => method !== "connect"),
    [
      ["models.authStatus", { agentId: "agent-1" }],
      ["models.list", { view: "configured", agentId: "agent-1" }]
    ]
  );
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client sets model auth order through Gateway before CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.setModelAuthOrder({
    provider: "openai-codex",
    agentId: "agent-1",
    profileIds: ["profile-1"]
  });

  assert.equal(result.stderr, "");
  assert.deepEqual(
    sentFrames.map((frame) => [frame.method, frame.params]).filter(([method]) => method !== "connect"),
    [
      ["models.authOrder.set", {
        provider: "openai-codex",
        agentId: "agent-1",
        profileIds: ["profile-1"]
      }]
    ]
  );
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client uses model auth order compatibility aliases before CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4, features: { methods: ["models.auth.order.set"] } }
          : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.setModelAuthOrder({
    provider: "openai-codex",
    agentId: "agent-1",
    profileIds: ["profile-1"]
  });

  assert.deepEqual(
    sentFrames.map((frame) => frame.method),
    ["connect", "models.auth.order.set"]
  );
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client clears operation fallback diagnostics after Gateway recovery", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  let malformed = true;
  const { WebSocketImpl } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 3 }
          : malformed
            ? { models: [{ id: "missing-name" }] }
            : { models: [{ id: "gpt-5.5", provider: "openai", name: "GPT 5.5", input: ["text"] }] }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.listModels(), { models: [] });
  assert.equal(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.operation, "models.list");

  malformed = false;
  assert.deepEqual(await client.listModels(), {
    models: [{
      key: "openai/gpt-5.5",
      name: "GPT 5.5",
      input: "text",
      contextWindow: null,
      local: null,
      available: null,
      tags: [],
      missing: false
    }]
  });
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
});

test("native WS gateway client uses Gateway first for agent list", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 3 }
          : {
              defaultId: "main",
              mainKey: "main",
              scope: "per-sender",
              agents: [{
                id: "main",
                identity: { name: "Main" },
                workspace: "/workspace",
                model: { primary: "openai/test-model" },
                ignored: true
              }]
            }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.listAgents(), {
    defaultId: "main",
    mainKey: "main",
    scope: "per-sender",
    agents: [{
      id: "main",
      identity: { name: "Main" },
      workspace: "/workspace",
      model: { primary: "openai/test-model" },
      ignored: true
    }]
  });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "agents.list"]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client reads config paths from Gateway snapshots", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 3 }
          : {
              exists: true,
              valid: true,
              hash: "hash-1",
              config: {
                gateway: {
                  remote: {
                    url: "ws://127.0.0.1:18789"
                  }
                }
              }
            }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.equal(await client.getConfig("gateway.remote.url"), "ws://127.0.0.1:18789");
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "config.get"]);
  assert.deepEqual(sentFrames[1]?.params, {});
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client uses Gateway first for session list", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 3 }
          : {
              sessions: [{
                key: "agent:main:direct:test",
                agentId: "main",
                sessionId: "session-1",
                updatedAt: 123
              }],
              ignored: true
            }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.listSessions({ limit: 1 }), {
    sessions: [{
      key: "agent:main:direct:test",
      agentId: "main",
      sessionId: "session-1",
      updatedAt: 123
    }],
    ignored: true
  });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "sessions.list"]);
  assert.deepEqual(sentFrames[1]?.params, { limit: 1 });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client uses Gateway first for channel status", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 3 }
          : {
              ts: 123,
              channelOrder: ["telegram"],
              channelLabels: { telegram: "Telegram" },
              channelDetailLabels: { telegram: "Telegram Bot" },
              channels: { telegram: { configured: true } },
              channelAccounts: {
                telegram: [{
                  accountId: "main",
                  connected: true,
                  ignored: true
                }]
              },
              channelDefaultAccountId: { telegram: "main" },
              ignored: true
            }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.getChannelStatus({ probe: true, timeoutMs: 500 }), {
    ts: 123,
    channelOrder: ["telegram"],
    channelLabels: { telegram: "Telegram" },
    channelDetailLabels: { telegram: "Telegram Bot" },
    channels: { telegram: { configured: true } },
    channelAccounts: {
      telegram: [{
        accountId: "main",
        connected: true,
        ignored: true
      }]
    },
    channelDefaultAccountId: { telegram: "main" },
    ignored: true
  });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "channels.status"]);
  assert.deepEqual(sentFrames[1]?.params, { probe: true, timeoutMs: 500 });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client falls back when channel status is malformed", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 3 } : { channelOrder: [] }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.getChannelStatus(), {
    ts: 0,
    channelOrder: [],
    channelLabels: {},
    channels: {},
    channelAccounts: {},
    channelDefaultAccountId: {}
  });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "channels.status"]);
  assert.deepEqual(fallback.calls.map((call) => call.method), ["getChannelStatus"]);
  assert.equal(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.operation, "channels.status");
  assert.equal(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.kind, "malformed-response");
});

test("native WS gateway client reads channel logs through Gateway before CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : { lines: [{ time: "2026-05-18T12:00:00.000Z", message: "hello" }] }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.getChannelLogs({ channel: "telegram", lines: 25 }), {
    lines: [{ time: "2026-05-18T12:00:00.000Z", message: "hello" }]
  });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "channels.logs"]);
  assert.deepEqual(sentFrames[1]?.params, { channel: "telegram", lines: 25 });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client mutates config through Gateway snapshots", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 3 }
          : frame.method === "config.get"
            ? {
                exists: true,
                valid: true,
                hash: "hash-1",
                config: {
                  gateway: {
                    remote: {}
                  }
                }
              }
            : { ok: true, path: "/config/openclaw.json", config: {} }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.setConfig("gateway.remote.url", "ws://127.0.0.1:18789");

  assert.match(result.stdout, /"ok":true/);
  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "config.get",
    "config.schema.lookup",
    "config.patch"
  ]);
  assert.deepEqual(sentFrames[3]?.params, {
    raw: JSON.stringify({ gateway: { remote: { url: "ws://127.0.0.1:18789" } } }),
    baseHash: "hash-1"
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client closes persistent connection after Gateway auth URL config mutation", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "config.get"
            ? { exists: true, valid: true, hash: "hash-1", config: { gateway: { remote: {} } } }
            : frame.method === "status"
              ? { version: "9.9.9" }
              : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.setConfig("gateway.remote.url", "ws://127.0.0.1:18789");
  await client.getStatus();

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "config.get",
    "config.schema.lookup",
    "config.patch",
    "connect",
    "status"
  ]);
});

test("native WS gateway client falls back from config.patch to config.apply", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      if (frame.method === "config.patch") {
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: false,
          error: { message: "unknown method: config.patch" }
        });
        return;
      }

      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "config.get"
            ? {
                exists: true,
                valid: true,
                hash: "hash-2",
                config: {
                  gateway: {
                    remote: {}
                  }
                }
              }
            : { ok: true, method: frame.method }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.setConfig("gateway.remote.url", "ws://127.0.0.1:18789");

  assert.match(result.stdout, /"ok":true/);
  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "config.get",
    "config.schema.lookup",
    "config.patch",
    "config.apply"
  ]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client refuses redacted config writes without CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket(() => {});
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(
    () => client.setConfig("gateway.auth.token", "__OPENCLAW_REDACTED__"),
    /Refusing to write a redacted OpenClaw secret/
  );
  assert.deepEqual(sentFrames, []);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client surfaces CLI fallback failures after Gateway failure", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  fallback.failStatus = true;
  const { WebSocketImpl } = createFakeWebSocket((socket, frame) => {
    if (frame.method !== "connect") {
      return;
    }

    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: false,
        error: { message: "scope denied" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(() => client.getStatus(), /CLI status failed/);
  const [diagnostic] = getRecentOpenClawGatewayFallbackDiagnostics();
  assert.equal(diagnostic.operation, "status");
  assert.equal(diagnostic.kind, "scope-limited");
});

test("native WS gateway client falls back to CLI client when handshake fails", async () => {
  const fallback = new FallbackGatewayClient();
  const failures: string[] = [];
  const { WebSocketImpl } = createFakeWebSocket((socket, frame) => {
    if (frame.method !== "connect") {
      return;
    }

    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: false,
        error: {
          message: "auth failed"
        }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250,
    onNativeFailure: (error) => failures.push(error instanceof Error ? error.message : String(error))
  });

  const result = await client.call<{ fallback: boolean; method: string }>("health", { probe: true });

  assert.deepEqual(result, { fallback: true, method: "health", params: { probe: true } });
  assert.equal(fallback.calls.length, 1);
  assert.match(failures[0], /auth failed/);
});

test("native WS gateway client falls back to CLI client on timeout", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl } = createFakeWebSocket(() => {});
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 20
  });

  const result = await client.call<{ fallback: boolean; method: string }>("health", { probe: true });

  assert.deepEqual(result, { fallback: true, method: "health", params: { probe: true } });
  assert.equal(fallback.calls.length, 1);
});

test("native WS gateway client does not CLI fallback after sent mutation timeout", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    if (frame.method === "connect") {
      globalThis.queueMicrotask(() => {
        socket.emitMessage({ type: "res", id: frame.id, ok: true, payload: { protocol: 4 } });
      });
    }
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 20
  });

  await assert.rejects(
    () => client.addAgent({ id: "agent-1", workspace: "/workspace", agentDir: "/agent" }),
    /Timed out waiting for OpenClaw Gateway method "agents.create"/
  );
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "agents.create"]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client honors forced CLI mode without opening a socket", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket(() => {
    throw new Error("socket should not be used");
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250,
    forceCli: true
  });

  const result = await client.call<{ fallback: boolean; method: string }>("health", { probe: true });

  assert.deepEqual(result, { fallback: true, method: "health", params: { probe: true } });
  assert.deepEqual(sentFrames, []);
  assert.deepEqual(fallback.calls.map((call) => call.method), ["health"]);
});

test("native WS gateway client honors per-request CLI stream fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket(() => {
    throw new Error("socket should not be used");
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.streamAgentTurn(
    { agentId: "agent-1", sessionId: "session-1", message: "hello" },
    {},
    { forceCli: true }
  );

  assert.deepEqual(sentFrames, []);
  assert.deepEqual(fallback.calls.map((call) => call.method), ["streamAgentTurn"]);
});

test("native WS gateway client classifies unknown Gateway methods as unsupported", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: frame.method === "connect",
        payload: frame.method === "connect" ? { protocol: 3 } : undefined,
        error: frame.method === "connect" ? undefined : { message: "INVALID_REQUEST: unknown method: models.authStatus" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.getModelStatus();

  assert.deepEqual(fallback.calls.map((call) => call.method), ["getModelStatus"]);
  assert.equal(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.operation, "models.authStatus");
  assert.equal(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.kind, "unsupported");
});

test("native WS gateway client uses Gateway first for critical workflows", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 3 } : { runId: "run-1", status: "running" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.addAgent({ id: "agent-1", workspace: "/workspace", agentDir: "/agent" });
  await client.deleteAgent("agent-1");
  await client.runAgentTurn({ agentId: "agent-1", message: "hello" });
  await client.abortAgentTurn({ runId: "run-1", reason: "stop" });

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "agents.create",
    "agents.delete",
    "chat.send",
    "sessions.abort"
  ]);
  assert.deepEqual(fallback.calls.map((call) => call.method), []);
  assert.deepEqual(sentFrames.find((frame) => frame.method === "agents.create")?.params, {
    id: "agent-1",
    agentId: "agent-1",
    name: "agent-1",
    workspace: "/workspace",
    agentDir: "/agent"
  });
  assert.equal(sentFrames.find((frame) => frame.method === "chat.send")?.params.sessionKey, "agent:agent-1:main");
  assert.equal(sentFrames.find((frame) => frame.method === "sessions.abort")?.params.runId, "run-1");
});

test("native WS gateway client falls back before agents.create when method is not advertised", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: ["agents.list", "agents.delete"]
              }
            }
          : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.addAgent({ id: "agent-1", workspace: "/workspace", agentDir: "/agent" });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect"]);
  assert.deepEqual(fallback.calls.map((call) => call.method), ["addAgent"]);
  assert.equal(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.operation, "agents.create");
  assert.equal(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.kind, "unsupported");
});

test("native WS gateway client uses agents.update when supported", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { ok: true, agentId: "agent-1" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.updateAgent({ id: "agent-1", name: "Agent One", workspace: "/workspace", model: "openai/test" });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "agents.update"]);
  assert.deepEqual(sentFrames[1]?.params, {
    agentId: "agent-1",
    name: "Agent One",
    workspace: "/workspace",
    model: "openai/test"
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client exposes optional Gateway support methods", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "logs.tail"
            ? { lines: ["log"] }
            : frame.method === "exec.approval.list"
              ? { approvals: [{ id: "approval-1" }] }
              : frame.method === "exec.approval.resolve"
                ? { ok: true, approvalId: "approval-1" }
                : frame.method === "cron.status"
                  ? { enabled: true }
                  : frame.method === "cron.list"
                    ? { jobs: [{ id: "job-1" }] }
                    : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.tailLogs({ limit: 1 }), { lines: ["log"] });
  assert.deepEqual(await client.listExecApprovals({ status: "pending" }), { approvals: [{ id: "approval-1" }] });
  assert.deepEqual(await client.resolveExecApproval({ approvalId: "approval-1", decision: "allow" }), {
    ok: true,
    approvalId: "approval-1"
  });
  assert.deepEqual(await client.getCronStatus(), { enabled: true });
  assert.deepEqual(await client.listCronJobs({ includeDisabled: true }), { jobs: [{ id: "job-1" }] });
  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "logs.tail",
    "exec.approval.list",
    "exec.approval.resolve",
    "cron.status",
    "cron.list"
  ]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client exposes Phase 2 runtime Gateway methods", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: [
                  "sessions.describe",
                  "sessions.history",
                  "sessions.export",
                  "tasks.list",
                  "tasks.get",
                  "tasks.assign",
                  "tasks.cancel",
                  "artifacts.list",
                  "artifacts.get",
                  "artifacts.put",
                  "artifacts.delete",
                  "runtime.snapshot",
                  "tools.catalog",
                  "tools.effective",
                  "tools.invoke"
                ]
              }
            }
          : frame.method === "sessions.describe"
            ? { session: { id: "session-1" } }
            : frame.method === "sessions.history"
              ? { messages: [{ text: "hello" }] }
              : frame.method === "sessions.export"
                ? { format: "json", content: "{}" }
                : frame.method === "tasks.list"
                  ? { tasks: [{ id: "task-1" }] }
                  : frame.method === "tasks.get"
                    ? { task: { id: "task-1" } }
                    : frame.method === "artifacts.list"
                      ? { artifacts: [{ id: "artifact-1" }] }
                      : frame.method === "runtime.snapshot"
                        ? { tasks: [], sessions: [] }
                        : frame.method === "tools.catalog"
                          ? { tools: [{ name: "shell" }] }
                          : frame.method === "tools.effective"
                            ? { tools: [{ name: "shell" }] }
                            : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.describeSession({ key: "agent:agent-1:main" }), { session: { id: "session-1" } });
  assert.deepEqual(await client.getSessionHistory({ key: "agent:agent-1:main", limit: 5 }), {
    messages: [{ text: "hello" }]
  });
  assert.deepEqual(await client.exportSession({ key: "agent:agent-1:main", format: "json" }), {
    format: "json",
    content: "{}"
  });
  assert.deepEqual(await client.listTasks({ agentId: "agent-1" }), { tasks: [{ id: "task-1" }] });
  assert.deepEqual(await client.getTask({ taskId: "task-1" }), { task: { id: "task-1" } });
  assert.deepEqual(await client.assignTask({ taskId: "task-1", agentId: "agent-1" }), { ok: true });
  assert.deepEqual(await client.cancelTask({ taskId: "task-1", reason: "duplicate" }), { ok: true });
  assert.deepEqual(await client.listArtifacts({ taskId: "task-1" }), { artifacts: [{ id: "artifact-1" }] });
  assert.deepEqual(await client.getArtifact({ artifactId: "artifact-1", includeContent: true }), { ok: true });
  assert.deepEqual(await client.putArtifact({ name: "result.txt", content: "ok" }), { ok: true });
  assert.deepEqual(await client.deleteArtifact({ artifactId: "artifact-1" }), { ok: true });
  assert.deepEqual(await client.getRuntimeSnapshot({ includeTasks: true }), { tasks: [], sessions: [] });
  assert.deepEqual(await client.getToolsCatalog({ agentId: "agent-1" }), { tools: [{ name: "shell" }] });
  assert.deepEqual(await client.getEffectiveTools({ agentId: "agent-1" }), { tools: [{ name: "shell" }] });
  assert.deepEqual(await client.invokeTool({ toolName: "shell", input: { command: "pwd" } }), { ok: true });

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "sessions.describe",
    "sessions.history",
    "sessions.export",
    "tasks.list",
    "tasks.get",
    "tasks.assign",
    "tasks.cancel",
    "artifacts.list",
    "artifacts.get",
    "artifacts.put",
    "artifacts.delete",
    "runtime.snapshot",
    "tools.catalog",
    "tools.effective",
    "tools.invoke"
  ]);
  assert.deepEqual(sentFrames[1]?.params, {
    key: "agent:agent-1:main"
  });
  assert.deepEqual(sentFrames[15]?.params, {
    toolName: "shell",
    input: { command: "pwd" }
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client subscribes to Phase 3 runtime event streams", async () => {
  const fallback = new FallbackGatewayClient();
  const events: unknown[] = [];
  let subscriptionSocket: { emitMessage: (frame: Record<string, unknown>) => void } | null = null;
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: ["tasks.subscribe"],
                events: ["task.updated"]
              }
            }
          : { ok: true }
      });

      if (frame.method === "tasks.subscribe") {
        subscriptionSocket = socket;
        subscriptionSocket.emitMessage({
          type: "event",
          event: "task.updated",
          payload: { taskId: "task-1", status: "running" }
        });
      }
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const subscription = await client.subscribeRuntimeEvents(
    { includeSessions: false, includeTasks: true, taskIds: ["task-1"] },
    {
      onEvent: (event) => {
        events.push(event);
      }
    },
    { timeoutMs: 250 }
  );

  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  subscription.close();

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "tasks.subscribe"]);
  assert.deepEqual(sentFrames[1]?.params, { taskIds: ["task-1"] });
  assert.deepEqual(events, [{
    type: "event",
    event: "task.updated",
    payload: { taskId: "task-1", status: "running" }
  }]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client streams agent turns through chat.send and session events", async () => {
  const fallback = new FallbackGatewayClient();
  const stdout: string[] = [];
  let subscriptionSocket: { emitMessage: (frame: Record<string, unknown>) => void } | null = null;
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: ["chat.send", "sessions.subscribe", "sessions.messages.subscribe"],
                events: ["session.message"]
              }
            }
          : { ok: true, runId: "run-1", status: "running" }
      });

      if (frame.method === "sessions.messages.subscribe") {
        subscriptionSocket = socket;
      }

      if (frame.method === "chat.send") {
        subscriptionSocket?.emitMessage({
          type: "event",
          event: "session.message",
          payload: {
            sessionKey: "agent:agent-1:explicit:session-1",
            runId: "run-1",
            status: "completed",
            message: { text: "Done from Gateway" }
          }
        });
      }
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.streamAgentTurn(
    { agentId: "agent-1", sessionId: "session-1", message: "hello", timeoutSeconds: 1 },
    {
      onStdout: (text) => {
        stdout.push(text);
      }
    }
  );

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "sessions.subscribe",
    "sessions.messages.subscribe",
    "chat.send"
  ]);
  assert.equal(result.runId, "run-1");
  assert.equal(result.status, "completed");
  assert.equal(result.payloads?.[0]?.text, "Done from Gateway");
  assert.match(stdout.join(""), /Done from Gateway/);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client does not synthesize final text for empty stream completion events", async () => {
  const fallback = new FallbackGatewayClient();
  const stdout: string[] = [];
  let subscriptionSocket: { emitMessage: (frame: Record<string, unknown>) => void } | null = null;
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: ["chat.send", "sessions.subscribe", "sessions.messages.subscribe"],
                events: ["session.message"]
              }
            }
          : { runId: "run-1", status: "running" }
      });

      if (frame.method === "sessions.messages.subscribe") {
        subscriptionSocket = socket;
      }

      if (frame.method === "chat.send") {
        subscriptionSocket?.emitMessage({
          type: "event",
          event: "session.message",
          payload: {
            sessionKey: "agent:agent-1:explicit:session-1",
            runId: "run-1",
            status: "completed"
          }
        });
      }
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.streamAgentTurn(
    { agentId: "agent-1", sessionId: "session-1", message: "hello" },
    {
      onStdout: (text) => {
        stdout.push(text);
      }
    },
    { timeoutMs: 25 }
  );

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "sessions.subscribe",
    "sessions.messages.subscribe",
    "chat.send"
  ]);
  assert.equal(result.runId, "run-1");
  assert.equal(result.status, "running");
  assert.equal(result.summary, undefined);
  assert.deepEqual(stdout, []);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client subscribes to Gateway session events without legacy events.subscribe", async () => {
  const fallback = new FallbackGatewayClient();
  const events: string[] = [];
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { subscribed: true }
      });
      if (frame.method === "sessions.subscribe") {
        socket.emitMessage({
          type: "event",
          event: "sessions.changed",
          payload: { key: "agent:main:main" }
        });
      }
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const subscription = await client.subscribeNativeEvents(
    { subscribeSessions: true },
    {
      onEvent: (frame) => {
        if (frame.event) {
          events.push(frame.event);
        }
      }
    }
  );
  subscription.close();

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "sessions.subscribe"]);
  assert.deepEqual(events, ["sessions.changed"]);
});
