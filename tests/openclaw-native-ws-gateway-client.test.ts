import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  clearOpenClawGatewayFallbackDiagnosticsForTesting,
  getRecentOpenClawGatewayFallbackDiagnostics,
  NativeWsOpenClawGatewayClient,
  type WebSocketFactory
} from "@/lib/openclaw/client/native-ws-gateway-client";
import { resolveConfiguredGatewaySecretFromLocalConfig } from "@/lib/openclaw/client/native-ws-gateway-auth";
import type {
  OpenClawAddAgentInput,
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
  calls: Array<{ method: string; params?: unknown; options?: OpenClawCommandOptions }> = [];
  configCalls: string[] = [];
  config = new Map<string, unknown>();
  failConfigWithInvalidConfig = false;
  failStatus = false;
  statusPayload: Record<string, unknown> = {};
  updateStatusPayload: Record<string, unknown> = {};

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

  async getUpdateStatus() {
    this.calls.push({ method: "getUpdateStatus" });
    return this.updateStatusPayload;
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

  async provisionChannelAccount() {
    this.calls.push({ method: "provisionChannelAccount" });
    return { stdout: JSON.stringify({ ok: true }), stderr: "" };
  }

  async removeChannelAccount() {
    this.calls.push({ method: "removeChannelAccount" });
    return { stdout: JSON.stringify({ ok: true }), stderr: "" };
  }

  async setupGmailWebhook() {
    this.calls.push({ method: "setupGmailWebhook" });
    return { stdout: JSON.stringify({ ok: true }), stderr: "" };
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

  async approveDeviceAccess() {
    this.calls.push({ method: "approveDeviceAccess" });
    return { requestId: "latest", device: { deviceId: "device-1" } };
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

  async setConfig(path: string, value: unknown) {
    this.calls.push({ method: "setConfig", params: { path, value } });
    this.config.set(path, value);
    return { stdout: "", stderr: "", code: 0 };
  }

  async unsetConfig(path: string) {
    this.calls.push({ method: "unsetConfig", params: { path } });
    this.config.delete(path);
    return { stdout: "", stderr: "", code: 0 };
  }

  async addAgent(input: OpenClawAddAgentInput) {
    this.calls.push({ method: "addAgent", params: input });
    return { stdout: "", stderr: "", code: 0 };
  }

  async setAgentIdentity() {
    this.calls.push({ method: "setAgentIdentity" });
    return { stdout: JSON.stringify({ ok: true }), stderr: "" };
  }

  async deleteAgent() {
    this.calls.push({ method: "deleteAgent" });
    return { stdout: "", stderr: "", code: 0 };
  }

  async provisionAutomation() {
    this.calls.push({ method: "provisionAutomation" });
    return { stdout: JSON.stringify({ ok: true }), stderr: "" };
  }

  async runAgentTurn() {
    this.calls.push({ method: "runAgentTurn" });
    return {};
  }

  async abortAgentTurn() {
    this.calls.push({ method: "abortAgentTurn" });
    return {};
  }

  async steerSession() {
    this.calls.push({ method: "steerSession" });
    return {};
  }

  async injectChat() {
    this.calls.push({ method: "injectChat" });
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

  await assert.rejects(
    () => client.getStatus(),
    /Gateway-native operation failed; CLI fallback disabled/
  );
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect"]);
  assert.deepEqual(fallback.calls, []);
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
  const diagnostics = client.getDiagnostics();
  assert.equal(diagnostics.gatewayMode, "unreachable");
  assert.match(diagnostics.lastNativeError ?? "", /supported range 3-4/);
  assert.match(diagnostics.recovery ?? "", /supported range 3-4/);
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
    "operator.pairing",
    "operator.talk.secrets"
  ]);
  assert.deepEqual(fallback.calls, []);
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
});

test("native WS gateway client does not backfill missing update registry details from CLI status", async () => {
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

  assert.deepEqual(await client.getStatus(), { version: "9.9.9" });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "status"]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client uses CLI update status when Gateway lacks availability details", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  fallback.updateStatusPayload = {
    update: {
      registry: {
        latestVersion: "10.0.0"
      }
    },
    availability: {
      available: true,
      latestVersion: "10.0.0"
    }
  };
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 3 } : { sentinel: null }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.getUpdateStatus(), {
    sentinel: null,
    update: {
      registry: {
        latestVersion: "10.0.0"
      }
    },
    availability: {
      available: true,
      latestVersion: "10.0.0"
    }
  });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "update.status"]);
  assert.deepEqual(fallback.calls.map((call) => call.method), ["getUpdateStatus"]);
  assert.equal(client.getDiagnostics().fallbackTotal, 1);
  assert.equal(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.operation, "update.status");
});

test("native WS gateway client keeps status native without cached CLI registry backfill", async () => {
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

  assert.deepEqual(await client.getStatus(), { version: "9.9.9" });
  assert.deepEqual(fallback.calls, []);
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

test("native WS gateway auth can read local OpenClaw config without CLI secret probes", async () => {
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;
  const stateDir = await mkdtemp(join(tmpdir(), "agentos-openclaw-config-auth-"));
  process.env.OPENCLAW_STATE_DIR = stateDir;
  await writeFile(join(stateDir, "openclaw.json"), JSON.stringify({
    gateway: {
      auth: {
        token: "local-config-token"
      }
    }
  }), "utf8");

  try {
    assert.deepEqual(
      await resolveConfiguredGatewaySecretFromLocalConfig(["gateway.auth.token"]),
      {
        value: "local-config-token",
        invalidConfig: false,
        fromConfigFile: true
      }
    );
  } finally {
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
  }
});

test("native WS gateway client prefers shared auth over local device tokens", async () => {
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;
  const previousToken = process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN;
  const stateDir = await mkdtemp(join(tmpdir(), "agentos-openclaw-device-auth-"));
  const identityDir = join(stateDir, "identity");
  await mkdir(identityDir, { recursive: true });
  await writeFile(join(identityDir, "device.json"), JSON.stringify({
    deviceId: "device-1",
    publicKeyPem: "unused-public-key",
    privateKeyPem: "unused-private-key"
  }), "utf8");
  await writeFile(join(identityDir, "device-auth.json"), JSON.stringify({
    deviceId: "device-1",
    tokens: {
      operator: {
        token: "read-only-device-token",
        scopes: ["operator.read"]
      }
    }
  }), "utf8");
  process.env.OPENCLAW_STATE_DIR = stateDir;
  process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN = "shared-gateway-token";

  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { version: "9.9.9" }
      });
    });
  });

  try {
    const client = new NativeWsOpenClawGatewayClient({
      fallback,
      webSocketFactory: WebSocketImpl,
      url: "ws://127.0.0.1:18789",
      timeoutMs: 250
    });

    await client.getStatus();

    assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "status"]);
    assert.deepEqual(sentFrames[0]?.params.auth, {
      token: "shared-gateway-token"
    });
    assert.equal(sentFrames[0]?.params.device, undefined);
    assert.deepEqual(fallback.configCalls, []);
  } finally {
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }

    if (previousToken === undefined) {
      delete process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN;
    } else {
      process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN = previousToken;
    }
  }
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

  await assert.rejects(
    () => client.getStatus(),
    /Gateway-native operation failed; CLI fallback disabled/
  );
  assert.equal(sentFrames.length, 0);
  assert.deepEqual(fallback.calls, []);
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
  const diagnostics = client.getDiagnostics();
  assert.equal(diagnostics.lastNativeError?.includes("__OPENCLAW_REDACTED__"), false);
  assert.match(diagnostics.lastNativeError ?? "", /redacted secret/);
});

test("native WS gateway client does not hide malformed Gateway typed responses behind CLI", async () => {
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

  await assert.rejects(
    () => client.listModels(),
    /Gateway-native operation failed; CLI fallback disabled/
  );
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "models.list"]);
  assert.deepEqual(fallback.calls, []);
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
  assert.match(client.getDiagnostics().lastNativeError ?? "", /malformed response/);
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

test("native WS gateway client derives default model from configured model tags", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      const payload =
        frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "models.authStatus"
            ? {
                providers: [{
                  provider: "openai-codex",
                  status: "ok",
                  profiles: [{ profileId: "openai-codex:user@example.com", status: "ok" }]
                }]
              }
            : {
                models: [{
                  id: "gpt-5.4-mini",
                  provider: "openai",
                  name: "gpt-5.4-mini",
                  tags: ["default", "configured"]
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

  assert.equal(status.defaultModel, "openai/gpt-5.4-mini");
  assert.equal(status.resolvedDefault, "openai/gpt-5.4-mini");
  assert.deepEqual(status.allowed, ["openai/gpt-5.4-mini"]);
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
      ["models.list", { view: "configured" }]
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
        ok: frame.method === "connect" || !malformed,
        payload: frame.method === "connect"
          ? { protocol: 3 }
          : malformed
            ? undefined
            : { models: [{ id: "gpt-5.5", provider: "openai", name: "GPT 5.5", input: ["text"] }] },
        error: frame.method !== "connect" && malformed
          ? { message: "INVALID_REQUEST: unknown method: models.list" }
          : undefined
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

test("native WS gateway client surfaces malformed channel status without CLI fallback", async () => {
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

  await assert.rejects(
    () => client.getChannelStatus(),
    /Gateway-native operation failed; CLI fallback disabled/
  );
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "channels.status"]);
  assert.deepEqual(fallback.calls, []);
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
  assert.match(client.getDiagnostics().lastNativeError ?? "", /malformed response/);
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

test("native WS gateway client provisions channel accounts through Gateway before CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { ok: true, accountId: "telegram-main" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.provisionChannelAccount({
    channel: "telegram",
    account: "telegram-main",
    token: "token",
    name: "Telegram Main"
  });
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, accountId: "telegram-main" });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "channels.add"]);
  assert.deepEqual(sentFrames[1]?.params, {
    channel: "telegram",
    account: "telegram-main",
    accountId: "telegram-main",
    name: "Telegram Main",
    token: "token"
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client removes channel accounts through Gateway before CLI fallback", async () => {
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

  assert.deepEqual(JSON.parse((await client.removeChannelAccount({
    channel: "telegram",
    account: "telegram-main",
    delete: true
  })).stdout), { ok: true });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "channels.remove"]);
  assert.deepEqual(sentFrames[1]?.params, {
    channel: "telegram",
    account: "telegram-main",
    accountId: "telegram-main",
    delete: true
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client sets up Gmail webhooks through Gateway before CLI fallback", async () => {
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

  assert.deepEqual(JSON.parse((await client.setupGmailWebhook({
    account: "user@example.com",
    config: { project: "agentos" }
  })).stdout), { ok: true });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "webhooks.gmail.setup"]);
  assert.deepEqual(sentFrames[1]?.params, {
    account: "user@example.com",
    config: { project: "agentos" }
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client approves device access through Gateway before CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      const payload = frame.method === "connect"
        ? { protocol: 4 }
        : frame.method === "device.pair.list"
          ? {
              pending: [
                { requestId: "older-request", ts: 1 },
                { requestId: "latest-request", ts: 2 }
              ]
            }
          : { requestId: "latest-request", device: { deviceId: "device-1", approvedScopes: ["operator.read"] } };

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

  assert.deepEqual(await client.approveDeviceAccess({ latest: true }), {
    requestId: "latest-request",
    device: { deviceId: "device-1", approvedScopes: ["operator.read"] }
  });
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "device.pair.list", "device.pair.approve"]);
  assert.deepEqual(sentFrames[2]?.params, { requestId: "latest-request" });
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

test("native WS gateway client returns config reload metadata from schema lookup", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "config.get"
            ? { exists: true, valid: true, hash: "hash-1", config: { gateway: { auth: {} } } }
            : frame.method === "config.schema.lookup"
              ? { path: "gateway.auth.token", reloadKind: "restart" }
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

  const result = await client.setConfig("gateway.auth.token", "secret-token");
  const payload = JSON.parse(result.stdout);

  assert.equal(result.metadata?.openClawConfig && typeof result.metadata.openClawConfig === "object"
    ? (result.metadata.openClawConfig as { reloadKind?: unknown }).reloadKind
    : null, "restart");
  assert.equal(payload.configMutation.reloadKind, "restart");
  assert.equal(payload.configMutation.restartRequired, true);
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

test("native WS gateway client falls back to CLI for Gateway auth config repair when token mismatches", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: false,
        error: {
          message: "INVALID_REQUEST: unauthorized: gateway token mismatch (provide gateway auth token)"
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

  await client.setConfig("gateway.auth.token", "fresh-token");

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect"]);
  assert.deepEqual(fallback.calls.map((call) => call.method), ["setConfig"]);
  assert.equal(fallback.config.get("gateway.auth.token"), "fresh-token");
  assert.equal(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.kind, "auth");
});

test("native WS gateway client reports OK after auth repair reconnects", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  let connectAttempts = 0;
  const { WebSocketImpl } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      if (frame.method === "connect") {
        connectAttempts += 1;
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: connectAttempts > 1,
          payload: connectAttempts > 1 ? { protocol: 4 } : undefined,
          error: connectAttempts === 1
            ? { message: "INVALID_REQUEST: unauthorized: gateway token mismatch (provide gateway auth token)" }
            : undefined
        });
        return;
      }

      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "status" ? { version: "9.9.9" } : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.setConfig("gateway.auth.token", "fresh-token");
  await new Promise((resolve) => setTimeout(resolve, 5));
  await client.getStatus();

  const diagnostics = client.getDiagnostics();
  assert.equal(diagnostics.gatewayMode, "native-ws");
  assert.equal(diagnostics.statusLabel, "Native Gateway: OK");
  assert.equal(diagnostics.recovery, null);
  assert.equal(diagnostics.fallbackTotal, 1);
  assert.equal(diagnostics.recentFallbackDiagnostics[0]?.kind, "auth");
  assert.match(diagnostics.lastNativeError ?? "", /token mismatch/);
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

test("native WS gateway client does not use CLI fallback when config.patch is rate limited", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      if (frame.method === "config.patch") {
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: false,
          error: { message: "UNAVAILABLE: rate limit exceeded for config.patch; retry after 17s" }
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
            ? { exists: true, valid: true, hash: "hash-3", config: { agents: {} } }
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

  await assert.rejects(
    () => client.setConfig("agents.list", [{ id: "agent-1", workspace: "/workspace" }], { strictJson: true }),
    /rate limit exceeded for config\.patch.*CLI fallback disabled/
  );

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "config.get",
    "config.schema.lookup",
    "config.patch"
  ]);
  assert.deepEqual(fallback.calls, []);
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
  assert.equal(client.getDiagnostics().gatewayMode, "degraded");
  assert.match(client.getDiagnostics().recovery ?? "", /cooldown/);
});

test("native WS gateway client does not escalate config.patch conflict to apply or CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: frame.method !== "config.patch",
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "config.get"
            ? { exists: true, valid: true, hash: "hash-2", config: { gateway: { remote: {} } } }
            : frame.method === "config.patch"
              ? undefined
              : { ok: true },
        error: frame.method === "config.patch"
          ? { code: "CONFIG_CONFLICT", message: "baseHash conflict" }
          : undefined
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(
    () => client.setConfig("gateway.remote.url", "ws://127.0.0.1:18789"),
    /baseHash conflict/
  );
  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "config.get",
    "config.schema.lookup",
    "config.patch"
  ]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client does not escalate config.patch auth failure to apply or CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: frame.method !== "config.patch",
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "config.get"
            ? { exists: true, valid: true, hash: "hash-2", config: { gateway: { remote: {} } } }
            : frame.method === "config.patch"
              ? undefined
              : { ok: true },
        error: frame.method === "config.patch"
          ? { message: "missing operator.admin scope" }
          : undefined
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(
    () => client.setConfig("gateway.remote.url", "ws://127.0.0.1:18789"),
    /operator\.admin/
  );
  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "config.get",
    "config.schema.lookup",
    "config.patch"
  ]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client does not CLI fallback after sent config.apply timeout", async () => {
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

      if (frame.method === "config.apply") {
        return;
      }

      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "config.get"
            ? { exists: true, valid: true, hash: "hash-2", config: { gateway: { remote: {} } } }
            : { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 20
  });

  await assert.rejects(
    () => client.setConfig("gateway.remote.url", "ws://127.0.0.1:18789"),
    /Timed out waiting for OpenClaw Gateway method "config.apply"/
  );
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

test("native WS gateway client does not surface stale connecting socket close errors", async () => {
  const fallback = new FallbackGatewayClient();
  let terminated = false;

  class ClosingBeforeOpenSocket extends EventEmitter {
    readyState = 0;

    constructor(readonly url: string) {
      super();
    }

    send() {
      throw new Error("socket is not open");
    }

    close() {
      this.readyState = 3;
      this.emit("close", 1006, "closed before open");
      globalThis.queueMicrotask(() => {
        this.emit("error", new Error("WebSocket was closed before the connection was established"));
      });
    }

    terminate() {
      terminated = true;
      this.readyState = 3;
      this.emit("close", 1006, "terminated before open");
      globalThis.queueMicrotask(() => {
        this.emit("error", new Error("WebSocket was closed before the connection was established"));
      });
    }
  }

  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: ClosingBeforeOpenSocket as unknown as WebSocketFactory,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 5
  });

  await assert.rejects(
    () => client.listAgents(),
    /Timed out connecting to OpenClaw Gateway/
  );
  await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
  assert.equal(terminated, true);
});

test("native WS gateway client surfaces native failure without CLI fallback after Gateway failure", async () => {
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

  await assert.rejects(
    () => client.getStatus(),
    /Gateway-native operation failed; CLI fallback disabled/
  );
  assert.deepEqual(fallback.calls, []);
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
  assert.match(client.getDiagnostics().lastNativeError ?? "", /scope denied/);
});

test("native WS gateway client does not CLI fallback when handshake auth fails", async () => {
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

  await assert.rejects(
    () => client.call<{ fallback: boolean; method: string }>("health", { probe: true }),
    /Gateway-native operation failed; CLI fallback disabled/
  );
  assert.deepEqual(fallback.calls, []);
  assert.match(failures[0], /auth failed/);
});

test("native WS gateway client does not CLI fallback on native timeout", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl } = createFakeWebSocket(() => {});
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 20
  });

  await assert.rejects(
    () => client.call<{ fallback: boolean; method: string }>("health", { probe: true }),
    /Gateway-native operation failed; CLI fallback disabled/
  );
  assert.deepEqual(fallback.calls, []);
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
    () => client.deleteAgent("agent-1"),
    /Timed out waiting for OpenClaw Gateway method "agents.delete"/
  );
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "agents.delete"]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client falls back for unadvertised mutation methods before sending them", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    if (frame.method === "connect") {
      globalThis.queueMicrotask(() => {
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { protocol: 4, features: { methods: ["status"] } }
        });
      });
    }
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.deleteAgent("agent-1");

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect"]);
  assert.deepEqual(fallback.calls.map((call) => call.method), ["deleteAgent"]);
});

test("native WS gateway client blocks CLI fallback for sent mutation auth failures", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: frame.method === "connect",
        payload: frame.method === "connect" ? { protocol: 4 } : undefined,
        error: frame.method === "connect" ? undefined : { message: "unauthorized" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(
    () => client.deleteAgent("agent-1"),
    /unauthorized/
  );
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "agents.delete"]);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client blocks CLI fallback for sent mutation malformed request failures", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: frame.method === "connect",
        payload: frame.method === "connect" ? { protocol: 4 } : undefined,
        error: frame.method === "connect" ? undefined : { message: "invalid request payload" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await assert.rejects(
    () => client.provisionChannelAccount({ channel: "telegram", account: "main" }),
    /invalid request payload/
  );
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "channels.add"]);
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

test("native WS gateway client uses Gateway first for critical workflows with compatible payloads", async () => {
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
  await client.runAgentTurn({ agentId: "agent-1", message: "hello", workspace: "/workspace" });
  await client.abortAgentTurn({ runId: "run-1", reason: "stop" });

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "agents.delete",
    "chat.send",
    "sessions.abort"
  ]);
  assert.deepEqual(fallback.calls.map((call) => call.method), ["addAgent"]);
  assert.deepEqual(fallback.calls.find((call) => call.method === "addAgent")?.params, {
    id: "agent-1",
    workspace: "/workspace",
    agentDir: "/agent"
  });
  const chatParams = sentFrames.find((frame) => frame.method === "chat.send")?.params;
  assert.equal(chatParams?.sessionKey, "agent:agent-1:main");
  assert.equal(Object.hasOwn(chatParams ?? {}, "agentId"), false);
  assert.equal(Object.hasOwn(chatParams ?? {}, "workspace"), false);
  assert.equal(sentFrames.find((frame) => frame.method === "sessions.abort")?.params.runId, "run-1");
});

test("native WS gateway client waits for agent turn completion when a timeout is requested", async () => {
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
                methods: ["chat.send", "agent.wait"]
              }
            }
          : frame.method === "agent.wait"
            ? {
                runId: "run-1",
                status: "completed",
                summary: "Done",
                payloads: [{ text: "Done", mediaUrl: null }]
              }
            : {
                runId: "run-1",
                status: "started"
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

  const result = await client.runAgentTurn({
    agentId: "agent-1",
    sessionId: "session-1",
    message: "hello",
    timeoutSeconds: 1
  });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "chat.send", "agent.wait"]);
  assert.deepEqual(sentFrames[2]?.params, {
    runId: "run-1",
    timeoutMs: 1000
  });
  assert.equal(result.status, "completed");
  assert.equal(result.payloads?.[0]?.text, "Done");
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client retries agent wait with session params for legacy Gateway schemas", async () => {
  const fallback = new FallbackGatewayClient();
  let waitAttempts = 0;
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      if (frame.method === "connect") {
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: true,
          payload: {
            protocol: 4,
            features: {
              methods: ["chat.send", "agent.wait"]
            }
          }
        });
        return;
      }

      if (frame.method === "agent.wait") {
        waitAttempts += 1;
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: waitAttempts > 1,
          error: waitAttempts === 1
            ? { message: "INVALID_REQUEST: invalid agent.wait params: must have required property 'sessionKey'" }
            : undefined,
          payload: waitAttempts > 1
            ? {
                runId: "run-1",
                status: "completed",
                summary: "Done",
                payloads: [{ text: "Done", mediaUrl: null }]
              }
            : undefined
        });
        return;
      }

      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: {
          runId: "run-1",
          status: "started"
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

  const result = await client.runAgentTurn({
    agentId: "agent-1",
    sessionId: "session-1",
    message: "hello",
    timeoutSeconds: 1
  });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "chat.send", "agent.wait", "agent.wait"]);
  assert.deepEqual(sentFrames[2]?.params, {
    runId: "run-1",
    timeoutMs: 1000
  });
  assert.deepEqual(sentFrames[3]?.params, {
    runId: "run-1",
    sessionKey: "agent:agent-1:explicit:session-1",
    sessionId: "session-1",
    timeoutMs: 1000
  });
  assert.equal(result.status, "completed");
  assert.equal(result.payloads?.[0]?.text, "Done");
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client returns Gateway wait timeout payloads", async () => {
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
                methods: ["chat.send", "agent.wait"]
              }
            }
          : frame.method === "agent.wait"
            ? {
                runId: "run-1",
                status: "timeout",
                timeoutPhase: "gateway_draining"
              }
            : {
                runId: "run-1",
                status: "started"
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

  const result = await client.runAgentTurn({
    agentId: "agent-1",
    message: "hello",
    timeoutSeconds: 1
  });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "chat.send", "agent.wait"]);
  assert.equal(result.status, "timeout");
  assert.equal((result as { timeoutPhase?: string }).timeoutPhase, "gateway_draining");
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client retries chat.send when the Gateway registry confirms the agent", async () => {
  const fallback = new FallbackGatewayClient();
  let chatAttempts = 0;
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      if (frame.method === "connect") {
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: true,
          payload: { protocol: 3 }
        });
        return;
      }

      if (frame.method === "chat.send") {
        chatAttempts += 1;
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: chatAttempts > 1,
          payload: chatAttempts > 1 ? { runId: "run-1", status: "running" } : undefined,
          error: chatAttempts === 1 ? { message: 'INVALID_REQUEST: agent "agent-1" not found' } : undefined
        });
        return;
      }

      if (frame.method === "agents.list") {
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: true,
          payload: {
            agents: [
              {
                id: "agent-1",
                workspace: "/workspace"
              }
            ]
          }
        });
        return;
      }

      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: { ok: true }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.runAgentTurn({ agentId: "agent-1", message: "hello", workspace: "/workspace" });

  assert.equal(result.runId, "run-1");
  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "chat.send", "agents.list", "chat.send"]);
  assert.deepEqual(
    sentFrames.filter((frame) => frame.method === "chat.send").map((frame) => frame.params.sessionKey),
    ["agent:agent-1:main", "agent:agent-1:main"]
  );
  assert.equal(
    sentFrames.filter((frame) => frame.method === "chat.send").some((frame) => Object.hasOwn(frame.params, "agentId")),
    false
  );
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client sends task steering and context injection without CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 3 } : { ok: true, method: frame.method }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(
    await client.steerSession({ key: "agent:agent-1:main", message: "Focus on tests" }),
    { ok: true, method: "sessions.steer" }
  );
  assert.deepEqual(
    await client.injectChat({ sessionKey: "agent:agent-1:main", message: "Use this reference" }),
    { ok: true, method: "chat.inject" }
  );

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "sessions.steer", "chat.inject"]);
  assert.deepEqual(sentFrames.find((frame) => frame.method === "sessions.steer")?.params, {
    key: "agent:agent-1:main",
    message: "Focus on tests"
  });
  assert.deepEqual(sentFrames.find((frame) => frame.method === "chat.inject")?.params, {
    sessionKey: "agent:agent-1:main",
    message: "Use this reference"
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client omits workspace when falling back from chat.send to sessions.send", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: frame.method !== "chat.send",
        payload: frame.method === "connect"
          ? { protocol: 4 }
          : frame.method === "sessions.send"
            ? { runId: "run-1", status: "running" }
            : undefined,
        error: frame.method === "chat.send" ? { message: "INVALID_REQUEST: unknown method: chat.send" } : undefined
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.runAgentTurn({ agentId: "agent-1", message: "hello", workspace: "/workspace" });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "chat.send", "sessions.send"]);
  assert.equal(Object.hasOwn(sentFrames[1]?.params ?? {}, "workspace"), false);
  assert.equal(Object.hasOwn(sentFrames[2]?.params ?? {}, "workspace"), false);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client creates and patches explicit sessions before chat send", async () => {
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
                methods: ["sessions.create", "sessions.patch", "chat.send"]
              }
            }
          : frame.method === "chat.send"
            ? { runId: "run-1", status: "running" }
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

  await client.runAgentTurn({
    agentId: "agent-1",
    sessionId: "session-1",
    message: "hello",
    workspace: "/workspace",
    dispatchId: "dispatch-1"
  });

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "sessions.create",
    "sessions.patch",
    "chat.send"
  ]);
  assert.deepEqual(sentFrames[1]?.params, {
    key: "agent:agent-1:explicit:session-1",
    agentId: "agent-1"
  });
  assert.deepEqual(sentFrames[2]?.params, {
    key: "agent:agent-1:explicit:session-1",
    metadata: {
      agentId: "agent-1",
      sessionId: "session-1",
      workspace: "/workspace",
      dispatchId: "dispatch-1",
      origin: "agentos-mission-dispatch"
    }
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client keeps direct chat moving when session creation params are rejected", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: frame.method !== "sessions.create",
        payload: frame.method === "connect"
          ? {
              protocol: 4,
              features: {
                methods: ["sessions.create", "sessions.patch", "chat.send"]
              }
            }
          : frame.method === "chat.send"
            ? { runId: "run-1", status: "running" }
            : { ok: true },
        error: frame.method === "sessions.create"
          ? {
              message:
                "INVALID_REQUEST: invalid sessions.create params: at root: unexpected property 'sessionKey'"
            }
          : undefined
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  const result = await client.runAgentTurn({
    agentId: "agent-1",
    sessionId: "session-1",
    message: "hello",
    workspace: "/workspace"
  });

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "sessions.create",
    "sessions.patch",
    "chat.send"
  ]);
  assert.equal(result.runId, "run-1");
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client uses CLI agent creation to preserve explicit agentDir", async () => {
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

  assert.deepEqual(sentFrames.map((frame) => frame.method), []);
  assert.deepEqual(fallback.calls.map((call) => call.method), ["addAgent"]);
  assert.deepEqual(fallback.calls[0]?.params, {
    id: "agent-1",
    workspace: "/workspace",
    agentDir: "/agent"
  });
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
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

test("native WS gateway client sets agent identity through Gateway before CLI fallback", async () => {
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

  await client.setAgentIdentity({
    agentId: "agent-1",
    workspace: "/workspace",
    identityFile: "/workspace/.openclaw/agents/agent-1/agent/IDENTITY.md",
    name: "Agent One",
    emoji: "A"
  });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "agents.identity.set"]);
  assert.deepEqual(sentFrames[1]?.params, {
    agentId: "agent-1",
    agent: "agent-1",
    workspace: "/workspace",
    identityFile: "/workspace/.openclaw/agents/agent-1/agent/IDENTITY.md",
    name: "Agent One",
    emoji: "A"
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client provisions automations through Gateway before CLI fallback", async () => {
  const fallback = new FallbackGatewayClient();
  const { WebSocketImpl, sentFrames } = createFakeWebSocket((socket, frame) => {
    globalThis.queueMicrotask(() => {
      socket.emitMessage({
        type: "res",
        id: frame.id,
        ok: true,
        payload: frame.method === "connect" ? { protocol: 4 } : { ok: true, automationId: "digest" }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  await client.provisionAutomation({
    name: "Digest",
    description: "Daily digest",
    agentId: "agent-1",
    message: "Summarize updates",
    thinking: "medium",
    timeoutSeconds: 120,
    schedule: { kind: "every", value: "1d" },
    announce: { channel: "telegram", target: "team" }
  });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "cron.add"]);
  assert.deepEqual(sentFrames[1]?.params, {
    name: "Digest",
    description: "Daily digest",
    agentId: "agent-1",
    agent: "agent-1",
    message: "Summarize updates",
    thinking: "medium",
    timeoutSeconds: 120,
    schedule: { kind: "every", value: "1d" },
    announce: { channel: "telegram", target: "team" }
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
                  "sessions.get",
                  "sessions.list",
                  "chat.history",
                  "tasks.list",
                  "tasks.get",
                  "tasks.cancel",
                  "artifacts.list",
                  "artifacts.get",
                  "artifacts.download",
                  "tools.catalog",
                  "tools.effective",
                  "tools.invoke"
                ]
              }
            }
          : frame.method === "sessions.describe"
            ? { session: { id: "session-1" } }
            : frame.method === "chat.history"
              ? { messages: [{ text: "hello" }] }
              : frame.method === "sessions.get"
                ? { format: "json", content: "{}" }
                : frame.method === "sessions.list"
                  ? { sessions: [{ key: "agent:agent-1:main" }] }
                  : frame.method === "tasks.list"
                    ? { tasks: [{ id: "task-1" }] }
                    : frame.method === "tasks.get"
                      ? { task: { id: "task-1" } }
                      : frame.method === "artifacts.list"
                        ? { artifacts: [{ id: "artifact-1" }] }
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
  assert.deepEqual(await client.cancelTask({ taskId: "task-1", reason: "duplicate" }), { ok: true });
  assert.deepEqual(
    await client.listArtifacts({ taskId: "task-1", agentId: "agent-1", workspace: "/tmp/workspace", limit: 100 }),
    { artifacts: [{ id: "artifact-1" }] }
  );
  assert.deepEqual(await client.getArtifact({ artifactId: "artifact-1", includeContent: true }), { ok: true });
  assert.deepEqual(await client.getRuntimeSnapshot({ includeTasks: true }), {
    sessions: [{ key: "agent:agent-1:main" }],
    tasks: [{ id: "task-1" }],
    artifacts: []
  });
  assert.deepEqual(await client.getToolsCatalog({ agentId: "agent-1" }), { tools: [{ name: "shell" }] });
  assert.deepEqual(await client.getEffectiveTools({ agentId: "agent-1" }), { tools: [{ name: "shell" }] });
  assert.deepEqual(await client.invokeTool({ toolName: "shell", input: { command: "pwd" } }), { ok: true });

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "sessions.describe",
    "chat.history",
    "sessions.get",
    "tasks.list",
    "tasks.get",
    "tasks.cancel",
    "artifacts.list",
    "artifacts.get",
    "sessions.list",
    "tasks.list",
    "tools.catalog",
    "tools.effective",
    "tools.invoke"
  ]);
  assert.deepEqual(sentFrames[1]?.params, {
    key: "agent:agent-1:main"
  });
  assert.deepEqual(sentFrames[7]?.params, {
    taskId: "task-1"
  });
  assert.deepEqual(sentFrames[13]?.params, {
    toolName: "shell",
    input: { command: "pwd" }
  });
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client queries chat history with sessionKey for explicit agent sessions", async () => {
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
                methods: ["chat.history"]
              }
            }
          : { messages: [{ role: "assistant", text: "history reply" }] }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(await client.getSessionHistory({ agentId: "agent-1", sessionId: "session-1", limit: 40 }), {
    messages: [{ role: "assistant", text: "history reply" }]
  });

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "chat.history"]);
  assert.deepEqual(sentFrames[1]?.params, {
    sessionKey: "agent:agent-1:explicit:session-1",
    limit: 40
  });
  assert.equal(Object.hasOwn(sentFrames[1]?.params ?? {}, "agentId"), false);
  assert.equal(Object.hasOwn(sentFrames[1]?.params ?? {}, "sessionId"), false);
  assert.deepEqual(fallback.calls, []);
});

test("native WS runtime snapshot only queries artifacts with an explicit Gateway scope", async () => {
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
                methods: ["sessions.list", "tasks.list", "artifacts.list"]
              }
            }
          : frame.method === "artifacts.list"
            ? { artifacts: [{ id: "artifact-1", taskId: "task-1" }] }
            : { sessions: [], tasks: [] }
      });
    });
  });
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: WebSocketImpl,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 250
  });

  assert.deepEqual(
    await client.getRuntimeSnapshot({
      includeSessions: false,
      includeTasks: false,
      includeArtifacts: true,
      taskId: "task-1",
      agentId: "agent-1",
      workspace: "/tmp/workspace",
      limit: 500
    }),
    {
      sessions: [],
      tasks: [],
      artifacts: [{ id: "artifact-1", taskId: "task-1" }]
    }
  );

  assert.deepEqual(sentFrames.map((frame) => frame.method), ["connect", "artifacts.list"]);
  assert.deepEqual(sentFrames[1]?.params, { taskId: "task-1" });
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
            status: "running",
            message: {
              role: "user",
              text: "You are chatting directly with the operator inside AgentOS."
            }
          }
        });
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
  assert.doesNotMatch(stdout.join(""), /You are chatting directly with the operator/);
  assert.deepEqual(fallback.calls, []);
});

test("native WS gateway client reads assistant text from Gateway message content arrays", async () => {
  const fallback = new FallbackGatewayClient();
  let subscriptionSocket: { emitMessage: (frame: Record<string, unknown>) => void } | null = null;
  const { WebSocketImpl } = createFakeWebSocket((socket, frame) => {
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
            message: {
              role: "assistant",
              content: [
                {
                  type: "text",
                  text: "Done from content array"
                }
              ]
            }
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
    { agentId: "agent-1", sessionId: "session-1", message: "hello", timeoutSeconds: 1 }
  );

  assert.equal(result.status, "completed");
  assert.equal(result.payloads?.[0]?.text, "Done from content array");
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

test("native WS gateway client resolves stream completion through agent.wait when events have no final text", async () => {
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
                methods: ["chat.send", "sessions.subscribe", "sessions.messages.subscribe", "agent.wait"],
                events: ["session.message"]
              }
            }
          : frame.method === "agent.wait"
            ? {
                runId: "run-1",
                status: "completed",
                summary: "Done from wait",
                payloads: [{ text: "Done from wait", mediaUrl: null }]
              }
            : { runId: "run-1", status: "running" }
      });
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
    {},
    { timeoutMs: 25 }
  );

  assert.deepEqual(sentFrames.map((frame) => frame.method), [
    "connect",
    "sessions.subscribe",
    "sessions.messages.subscribe",
    "chat.send",
    "agent.wait"
  ]);
  assert.equal(sentFrames[4]?.params.runId, "run-1");
  assert.equal(result.status, "completed");
  assert.equal(result.payloads?.[0]?.text, "Done from wait");
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
