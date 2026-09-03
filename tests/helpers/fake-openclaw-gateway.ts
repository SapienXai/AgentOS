import {
  NativeWsOpenClawGatewayClient,
  type NativeWsOpenClawGatewayClientOptions,
  type WebSocketFactory
} from "@/lib/openclaw/client/native-ws-gateway-client";
import type { NativeHandshakePayload } from "@/lib/openclaw/client/native-ws-gateway-types";
import type {
  OpenClawAddAgentInput,
  OpenClawCommandOptions,
  OpenClawGatewayClient
} from "@/lib/openclaw/client/gateway-client";

export type FakeOpenClawGatewayRequestFrame = {
  type: "req";
  id: string;
  method: string;
  params: Record<string, unknown>;
};

export type FakeOpenClawGatewayRouteContext = {
  respond: (payload: unknown) => void;
  fail: (message: string, options?: { code?: string }) => void;
  unsupported: (message?: string) => void;
  malformedJson: () => void;
  emitEvent: (event: string, payload?: unknown) => void;
  emitRaw: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  error: (error?: unknown) => void;
  leaveOpen: () => void;
};

export type FakeOpenClawGatewayRoute = (
  frame: FakeOpenClawGatewayRequestFrame,
  context: FakeOpenClawGatewayRouteContext
) => void | Promise<void>;

export type FakeOpenClawGatewayOptions = {
  protocol?: number;
  methods?: string[];
  events?: string[];
  handshake?: NativeHandshakePayload | ((frame: FakeOpenClawGatewayRequestFrame) => NativeHandshakePayload);
  routes?: Record<string, FakeOpenClawGatewayRoute>;
};

export type FakeOpenClawGatewaySocket = {
  readonly url: string;
  readonly readyState: number;
  emitMessage: (frame: Record<string, unknown>) => void;
  emitRaw: (data: string) => void;
  emitEvent: (event: string, payload?: unknown) => void;
  close: (code?: number, reason?: string) => void;
  error: (error?: unknown) => void;
};

export class FakeOpenClawGateway {
  readonly sentFrames: FakeOpenClawGatewayRequestFrame[] = [];
  readonly sockets: FakeOpenClawGatewaySocket[] = [];
  readonly webSocketFactory: WebSocketFactory;
  private readonly routes = new Map<string, FakeOpenClawGatewayRoute>();

  constructor(private readonly options: FakeOpenClawGatewayOptions = {}) {
    for (const [method, route] of Object.entries(options.routes ?? {})) {
      this.routes.set(method, route);
    }
    this.webSocketFactory = createFakeWebSocketFactory(this);
  }

  route(method: string, route: FakeOpenClawGatewayRoute) {
    this.routes.set(method, route);
  }

  methods() {
    return this.sentFrames.map((frame) => frame.method);
  }

  async handleRequest(socket: FakeOpenClawGatewaySocket, frame: FakeOpenClawGatewayRequestFrame) {
    const context = this.createRouteContext(socket, frame);
    const route = this.routes.get(frame.method);

    if (route) {
      await route(frame, context);
      return;
    }

    if (frame.method === "connect") {
      context.respond(this.buildHandshake(frame));
      return;
    }

    context.respond({ ok: true, method: frame.method, params: frame.params });
  }

  private createRouteContext(
    socket: FakeOpenClawGatewaySocket,
    frame: FakeOpenClawGatewayRequestFrame
  ): FakeOpenClawGatewayRouteContext {
    return {
      respond: (payload) => {
        socket.emitMessage({ type: "res", id: frame.id, ok: true, payload });
      },
      fail: (message, options = {}) => {
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: false,
          error: { message, code: options.code ?? "INVALID_REQUEST" }
        });
      },
      unsupported: (message = `INVALID_REQUEST: unknown method: ${frame.method}`) => {
        socket.emitMessage({
          type: "res",
          id: frame.id,
          ok: false,
          error: { code: "INVALID_REQUEST", message }
        });
      },
      malformedJson: () => socket.emitRaw("{malformed-json"),
      emitEvent: (event, payload) => socket.emitEvent(event, payload),
      emitRaw: (data) => socket.emitRaw(data),
      close: (code, reason) => socket.close(code, reason),
      error: (error) => socket.error(error),
      leaveOpen: () => undefined
    };
  }

  private buildHandshake(frame: FakeOpenClawGatewayRequestFrame): NativeHandshakePayload {
    if (typeof this.options.handshake === "function") {
      return this.options.handshake(frame);
    }

    if (this.options.handshake) {
      return this.options.handshake;
    }

    return {
      type: "hello-ok",
      protocol: this.options.protocol ?? 4,
      server: {
        version: "2026.8.2",
        connId: "fake-connection"
      },
      features: {
        methods: this.options.methods ?? [],
        events: this.options.events ?? []
      },
      snapshot: {},
      auth: { role: "operator", scopes: ["operator.read", "operator.write"] },
      policy: { maxPayload: 1_000_000, maxBufferedBytes: 1_000_000, tickIntervalMs: 15_000 }
    };
  }
}

function createFakeWebSocketFactory(gateway: FakeOpenClawGateway): WebSocketFactory {
  class FakeWebSocket implements FakeOpenClawGatewaySocket {
    readyState = 0;
    private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

    constructor(readonly url: string) {
      gateway.sockets.push(this);
      globalThis.queueMicrotask(() => {
        if (this.readyState !== 0) {
          return;
        }

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
      const frame = JSON.parse(data) as FakeOpenClawGatewayRequestFrame;
      gateway.sentFrames.push(frame);
      void Promise.resolve(gateway.handleRequest(this, frame)).catch((error: unknown) => {
        this.error(error);
      });
    }

    emitMessage(frame: Record<string, unknown>) {
      this.emitRaw(JSON.stringify(frame));
    }

    emitRaw(data: string) {
      this.emit("message", { data });
    }

    emitEvent(event: string, payload?: unknown) {
      this.emitMessage({ type: "event", event, payload });
    }

    close(code = 1000, reason = "closed") {
      if (this.readyState === 3) {
        return;
      }

      this.readyState = 3;
      this.emit("close", { code, reason });
    }

    error(error: unknown = new Error("Fake OpenClaw Gateway socket error")) {
      this.emit("error", error);
    }

    private emit(type: string, event: unknown) {
      for (const listener of this.listeners.get(type) ?? []) {
        listener(event);
      }
    }
  }

  return FakeWebSocket as unknown as WebSocketFactory;
}

export class RecordingFallbackGatewayClient implements OpenClawGatewayClient {
  calls: Array<{ method: string; params?: unknown; options?: OpenClawCommandOptions }> = [];
  configCalls: string[] = [];
  config = new Map<string, unknown>();
  statusPayload: Record<string, unknown> = {};
  updateStatusPayload: Record<string, unknown> = {};

  async getHealth(options: OpenClawCommandOptions = {}) {
    this.calls.push({ method: "getHealth", options });
    return { ok: true };
  }

  async getStatus(options: OpenClawCommandOptions = {}) {
    this.calls.push({ method: "getStatus", options });
    return this.statusPayload;
  }

  async getUpdateStatus(options: OpenClawCommandOptions = {}) {
    this.calls.push({ method: "getUpdateStatus", options });
    return this.updateStatusPayload;
  }

  async getGatewayStatus(options: OpenClawCommandOptions = {}) {
    this.calls.push({ method: "getGatewayStatus", options });
    return {};
  }

  async getModelStatus(options: OpenClawCommandOptions = {}) {
    this.calls.push({ method: "getModelStatus", options });
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
    return { agentId: "agent-1", profiles: [], groups: [] };
  }

  async getEffectiveTools() {
    this.calls.push({ method: "getEffectiveTools" });
    return { agentId: "agent-1", profile: "full", groups: [] };
  }

  async invokeTool() {
    this.calls.push({ method: "invokeTool" });
    return { ok: true, toolName: "shell" };
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
    this.calls.push({ method: "scanModels" });
    return [];
  }

  async probeGateway() {
    this.calls.push({ method: "probeGateway" });
    return {};
  }

  async controlGateway(action: "start" | "stop" | "restart") {
    this.calls.push({ method: "controlGateway", params: { action } });
    return { ok: true, action };
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

  async updateAgent() {
    this.calls.push({ method: "updateAgent" });
    return { stdout: JSON.stringify({ ok: true }), stderr: "" };
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
    return { runId: "fallback-run", status: "running" };
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
    return { runId: "fallback-stream", status: "running" };
  }

  async tailLogs() {
    this.calls.push({ method: "tailLogs" });
    return { lines: [] };
  }

  async listExecApprovals() {
    this.calls.push({ method: "listExecApprovals" });
    return { approvals: [] };
  }

  async resolveExecApproval() {
    this.calls.push({ method: "resolveExecApproval" });
    return { ok: true };
  }

  async getCronStatus() {
    this.calls.push({ method: "getCronStatus" });
    return { enabled: true };
  }

  async listCronJobs() {
    this.calls.push({ method: "listCronJobs" });
    return { jobs: [] };
  }
}

export function createNativeGatewayTestClient(options: {
  gateway?: FakeOpenClawGateway;
  gatewayOptions?: FakeOpenClawGatewayOptions;
  fallback?: RecordingFallbackGatewayClient;
  clientOptions?: Omit<NativeWsOpenClawGatewayClientOptions, "fallback" | "webSocketFactory">;
} = {}) {
  const gateway = options.gateway ?? new FakeOpenClawGateway(options.gatewayOptions);
  const fallback = options.fallback ?? new RecordingFallbackGatewayClient();
  const client = new NativeWsOpenClawGatewayClient({
    fallback,
    webSocketFactory: gateway.webSocketFactory,
    url: "ws://127.0.0.1:18789",
    timeoutMs: 50,
    ...options.clientOptions
  });

  return { client, fallback, gateway };
}
