import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { GatewayBackedOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  CliOpenClawGatewayClient,
  clearOpenClawGatewayFallbackDiagnosticsForTesting,
  getRecentOpenClawGatewayFallbackDiagnostics,
  OPENCLAW_GATEWAY_PROTOCOL_RANGE
} from "@/lib/openclaw/client/gateway-client";
import {
  getOpenClawGatewayClient,
  setOpenClawGatewayClientForTesting,
  setOpenClawGatewayClientProvider
} from "@/lib/openclaw/client/gateway-client-factory";
import {
  createNativeGatewayTestClient,
  FakeOpenClawGateway,
  type FakeOpenClawGatewayRoute
} from "./helpers/fake-openclaw-gateway";

const originalEnv = {
  AGENTOS_OPENCLAW_GATEWAY_CLIENT: process.env.AGENTOS_OPENCLAW_GATEWAY_CLIENT,
  AGENTOS_OPENCLAW_NATIVE_WS: process.env.AGENTOS_OPENCLAW_NATIVE_WS,
  OPENCLAW_GATEWAY_CLIENT: process.env.OPENCLAW_GATEWAY_CLIENT
};

afterEach(() => {
  restoreEnv();
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  setOpenClawGatewayClientForTesting(null);
  setOpenClawGatewayClientProvider(null);
});

test("fake OpenClaw Gateway captures native connect protocol negotiation", async () => {
  const { client, fallback, gateway } = createNativeGatewayTestClient({
    gatewayOptions: {
      protocol: 4,
      methods: ["health"],
      events: ["session.message"]
    }
  });
  gateway.route("health", (_frame, context) => {
    context.respond({ ok: true });
  });

  assert.deepEqual(await client.call("health", { probe: true }), { ok: true });

  const [connectFrame, healthFrame] = gateway.sentFrames;
  assert.equal(connectFrame?.method, "connect");
  assert.equal(connectFrame?.params.minProtocol, OPENCLAW_GATEWAY_PROTOCOL_RANGE.min);
  assert.equal(connectFrame?.params.maxProtocol, OPENCLAW_GATEWAY_PROTOCOL_RANGE.max);
  assert.deepEqual(connectFrame?.params.client, {
    id: "gateway-client",
    version: "agentos",
    platform: process.platform,
    mode: "backend"
  });
  assert.equal(healthFrame?.method, "health");
  assert.deepEqual(healthFrame?.params, { probe: true });
  assert.deepEqual(fallback.calls, []);
});

test("fake OpenClaw Gateway exposes protocol mismatch errors without CLI fallback probes", async () => {
  const { client, gateway } = createNativeGatewayTestClient({
    gatewayOptions: {
      protocol: 99
    }
  });

  await assert.rejects(
    () => client.probeNativeHandshake(),
    (error) => {
      assert.equal(readErrorKind(error), "protocol-mismatch");
      assert.match(error instanceof Error ? error.message : String(error), /supported range 3-4/);
      return true;
    }
  );
  assert.deepEqual(gateway.methods(), ["connect"]);
});

test("fake OpenClaw Gateway drives adapter calls over the native wire contract", async () => {
  const { client, gateway } = createNativeGatewayTestClient();
  gateway.route("health", (_frame, context) => {
    context.respond({ ok: true, adapter: true });
  });
  const adapter = new GatewayBackedOpenClawAdapter(() => client);

  assert.deepEqual(await adapter.call("health", { source: "adapter" }), { ok: true, adapter: true });
  assert.deepEqual(gateway.methods(), ["connect", "health"]);
  assert.deepEqual(gateway.sentFrames[1]?.params, { source: "adapter" });
});

test("unsupported Gateway responses create diagnostics and recover when native succeeds later", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const { client, fallback, gateway } = createNativeGatewayTestClient();
  gateway.route("health", (_frame, context) => {
    context.unsupported();
  });

  assert.deepEqual(await client.call("health", { probe: true }), {
    fallback: true,
    method: "health",
    params: { probe: true }
  });
  assert.deepEqual(fallback.calls.map((call) => call.method), ["health"]);
  assert.equal(client.getDiagnostics().fallbackCounts.health, 1);
  assert.equal(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.operation, "health");
  assert.equal(getRecentOpenClawGatewayFallbackDiagnostics()[0]?.kind, "unsupported");

  gateway.route("health", (_frame, context) => {
    context.respond({ ok: true });
  });

  assert.deepEqual(await client.call("health"), { ok: true });
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
  assert.equal(client.getDiagnostics().fallbackCounts.health, 1);
});

test("native read failures do not hide behind CLI while sent mutation auth failures do not", async () => {
  const read = createNativeGatewayTestClient();
  read.gateway.route("sessions.list", (_frame, context) => {
    context.fail("Gateway read failed");
  });

  await assert.rejects(
    () => read.client.listSessions(),
    /Gateway-native operation failed; CLI fallback disabled/
  );
  assert.deepEqual(read.gateway.methods(), ["connect", "sessions.list"]);
  assert.deepEqual(read.fallback.calls, []);
  assert.match(read.client.getDiagnostics().lastNativeError ?? "", /Gateway read failed/);

  const mutation = createNativeGatewayTestClient();
  mutation.gateway.route("agents.delete", (_frame, context) => {
    context.fail("unauthorized");
  });

  await assert.rejects(
    () => mutation.client.deleteAgent("agent-1"),
    /unauthorized/
  );
  assert.deepEqual(mutation.gateway.methods(), ["connect", "agents.delete"]);
  assert.deepEqual(mutation.fallback.calls, []);
});

test("chat.send unsupported responses fall through to sessions.send without CLI fallback", async () => {
  const { client, fallback, gateway } = createNativeGatewayTestClient();
  gateway.route("chat.send", (_frame, context) => {
    context.unsupported();
  });
  gateway.route("sessions.send", (_frame, context) => {
    context.respond({ runId: "run-1", status: "running" });
  });

  assert.deepEqual(
    await client.runAgentTurn({ agentId: "agent-1", message: "hello", workspace: "/workspace" }),
    { runId: "run-1", status: "running" }
  );
  assert.deepEqual(gateway.methods(), ["connect", "chat.send", "sessions.send"]);
  assert.equal(Object.hasOwn(gateway.sentFrames[1]?.params ?? {}, "workspace"), false);
  assert.equal(Object.hasOwn(gateway.sentFrames[2]?.params ?? {}, "workspace"), false);
  assert.deepEqual(fallback.calls, []);
});

test("session preparation creates explicit sessions without patching unsupported metadata", async () => {
  const { client, fallback, gateway } = createNativeGatewayTestClient({
    gatewayOptions: {
      methods: ["sessions.create", "sessions.patch", "chat.send"]
    }
  });
  gateway.route("sessions.create", (_frame, context) => {
    context.respond({ ok: true });
  });
  gateway.route("chat.send", (_frame, context) => {
    context.respond({ runId: "run-1", status: "running" });
  });

  await client.runAgentTurn({
    agentId: "agent-1",
    sessionId: "session-1",
    message: "hello",
    workspace: "/workspace",
    dispatchId: "dispatch-1"
  });

  assert.deepEqual(gateway.methods(), ["connect", "sessions.create", "chat.send"]);
  assert.deepEqual(gateway.sentFrames[1]?.params, {
    key: "agent:agent-1:explicit:session-1",
    agentId: "agent-1"
  });
  assert.equal(gateway.sentFrames.some((frame) => frame.method === "sessions.patch"), false);
  assert.deepEqual(fallback.calls, []);
});

test("agent.wait unsupported, timeout, and malformed responses are ignored after dispatch", async () => {
  await assertAgentWaitIgnored("unsupported", (_frame, context) => {
    context.unsupported();
  });
  await assertAgentWaitIgnored("timeout", (_frame, context) => {
    context.leaveOpen();
  });
  await assertAgentWaitIgnored("malformed", (_frame, context) => {
    context.malformedJson();
  });
});

test("runtime event subscription forwards Gateway event frames to callbacks", async () => {
  const { client, fallback, gateway } = createNativeGatewayTestClient({
    gatewayOptions: {
      methods: ["tasks.subscribe"],
      events: ["task.updated"]
    }
  });
  const events: unknown[] = [];
  gateway.route("tasks.subscribe", (_frame, context) => {
    context.respond({ subscribed: true });
    context.emitEvent("task.updated", { taskId: "task-1", status: "running" });
  });

  const subscription = await client.subscribeRuntimeEvents(
    { includeSessions: false, includeTasks: true, taskIds: ["task-1"] },
    {
      onEvent: (event) => {
        events.push(event);
      }
    }
  );
  subscription.close();

  assert.deepEqual(gateway.methods(), ["connect", "tasks.subscribe"]);
  assert.deepEqual(gateway.sentFrames[1]?.params, { taskIds: ["task-1"] });
  assert.deepEqual(events, [{
    type: "event",
    event: "task.updated",
    payload: { taskId: "task-1", status: "running" }
  }]);
  assert.deepEqual(fallback.calls, []);
});

test("malformed JSON and deterministic timeouts surface native failures without CLI fallback", async () => {
  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const malformed = createNativeGatewayTestClient();
  malformed.gateway.route("sessions.list", (_frame, context) => {
    context.malformedJson();
  });

  await assert.rejects(
    () => malformed.client.listSessions(),
    /Gateway-native operation failed; CLI fallback disabled/
  );
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
  assert.deepEqual(malformed.fallback.calls, []);
  assert.equal(malformed.client.getDiagnostics().lastNativeFailureAt !== null, true);

  clearOpenClawGatewayFallbackDiagnosticsForTesting();
  const timeout = createNativeGatewayTestClient({
    clientOptions: {
      timeoutMs: 5
    }
  });
  timeout.gateway.route("health", (_frame, context) => {
    context.leaveOpen();
  });

  await assert.rejects(
    () => timeout.client.call("health", { probe: true }, { timeoutMs: 5 }),
    /Gateway-native operation failed; CLI fallback disabled/
  );
  assert.deepEqual(getRecentOpenClawGatewayFallbackDiagnostics(), []);
  assert.deepEqual(timeout.fallback.calls, []);
  assert.equal(timeout.client.getDiagnostics().gatewayMode, "degraded");
});

test("config mutation refuses to rewrite redacted secrets from Gateway snapshots", async () => {
  const { client, fallback, gateway } = createNativeGatewayTestClient();
  gateway.route("config.get", (_frame, context) => {
    context.respond({
      exists: true,
      valid: true,
      hash: "hash-redacted",
      config: {
        gateway: {
          auth: {
            token: "__OPENCLAW_REDACTED__"
          }
        },
        feature: {}
      }
    });
  });
  gateway.route("config.schema.lookup", (_frame, context) => {
    context.respond({ path: "feature.enabled", reloadKind: "hot" });
  });
  gateway.route("config.patch", (_frame, context) => {
    context.unsupported();
  });
  gateway.route("config.apply", (_frame, context) => {
    context.unsupported();
  });
  gateway.route("config.set", (_frame, context) => {
    context.respond({ ok: true });
  });

  await assert.rejects(
    () => client.setConfig("feature.enabled", true),
    /redacted secrets/
  );
  assert.deepEqual(gateway.methods(), [
    "connect",
    "config.get",
    "config.schema.lookup",
    "config.patch",
    "config.apply"
  ]);
  assert.deepEqual(fallback.calls, []);
});

test("config mutation preserves config.patch to config.apply to config.set fallback order", async () => {
  const { client, fallback, gateway } = createNativeGatewayTestClient();
  gateway.route("config.get", (_frame, context) => {
    context.respond({
      exists: true,
      valid: true,
      hash: "hash-1",
      config: {
        feature: {}
      }
    });
  });
  gateway.route("config.schema.lookup", (_frame, context) => {
    context.respond({ path: "feature.enabled", reloadKind: "hot" });
  });
  gateway.route("config.patch", (_frame, context) => {
    context.unsupported();
  });
  gateway.route("config.apply", (_frame, context) => {
    context.unsupported();
  });
  gateway.route("config.set", (_frame, context) => {
    context.respond({ ok: true });
  });

  const result = await client.setConfig("feature.enabled", true);
  const payload = JSON.parse(result.stdout) as { configMutation?: { appliedVia?: string; hotReloaded?: boolean } };

  assert.deepEqual(gateway.methods(), [
    "connect",
    "config.get",
    "config.schema.lookup",
    "config.patch",
    "config.apply",
    "config.set"
  ]);
  assert.equal(payload.configMutation?.appliedVia, "config.set");
  assert.equal(payload.configMutation?.hotReloaded, true);
  assert.deepEqual(fallback.calls, []);
});

test("artifact mutation fails closed without CLI fallback", async () => {
  const { client, fallback, gateway } = createNativeGatewayTestClient();
  gateway.route("artifacts.put", (_frame, context) => {
    context.unsupported();
  });
  gateway.route("artifacts.delete", (_frame, context) => {
    context.unsupported();
  });

  await assert.rejects(
    () => client.putArtifact({ name: "result.txt", content: "ok" }),
    /Gateway-native operation failed; CLI fallback disabled/
  );
  await assert.rejects(
    () => client.deleteArtifact({ artifactId: "artifact-1" }),
    /Gateway-native operation failed; CLI fallback disabled/
  );

  assert.deepEqual(fallback.calls, []);
});

test("environment forced CLI mode bypasses Native WS and the default factory", async () => {
  process.env.AGENTOS_OPENCLAW_GATEWAY_CLIENT = "cli";
  setOpenClawGatewayClientForTesting(null);
  setOpenClawGatewayClientProvider(null);

  const { client, fallback, gateway } = createNativeGatewayTestClient();
  assert.deepEqual(await client.call("health", { probe: true }), {
    fallback: true,
    method: "health",
    params: { probe: true }
  });
  assert.deepEqual(gateway.sentFrames, []);
  assert.deepEqual(fallback.calls.map((call) => call.method), ["health"]);
  assert.equal(client.getDiagnostics().mode, "cli");
  assert.ok(getOpenClawGatewayClient() instanceof CliOpenClawGatewayClient);
});

async function assertAgentWaitIgnored(name: string, route: FakeOpenClawGatewayRoute) {
  const gateway = new FakeOpenClawGateway({
    methods: ["chat.send", "sessions.subscribe", "sessions.messages.subscribe", "agent.wait"],
    events: ["session.message"]
  });
  gateway.route("sessions.subscribe", (_frame, context) => {
    context.respond({ subscribed: true });
  });
  gateway.route("sessions.messages.subscribe", (_frame, context) => {
    context.respond({ subscribed: true });
  });
  gateway.route("chat.send", (_frame, context) => {
    context.respond({ runId: `run-${name}`, status: "running" });
  });
  gateway.route("agent.wait", route);
  const { client, fallback } = createNativeGatewayTestClient({
    gateway,
    clientOptions: {
      timeoutMs: 5
    }
  });

  const result = await client.streamAgentTurn(
    { agentId: "agent-1", sessionId: "session-1", message: "hello" },
    {},
    { timeoutMs: 5 }
  );

  assert.equal(result.runId, `run-${name}`);
  assert.equal(result.status, "running");
  assert.deepEqual(gateway.methods(), [
    "connect",
    "sessions.subscribe",
    "sessions.messages.subscribe",
    "chat.send",
    "agent.wait"
  ]);
  assert.deepEqual(fallback.calls, []);
}

function readErrorKind(error: unknown) {
  return typeof error === "object" && error !== null && "kind" in error
    ? (error as { kind?: unknown }).kind
    : undefined;
}

function restoreEnv() {
  restoreEnvValue("AGENTOS_OPENCLAW_GATEWAY_CLIENT", originalEnv.AGENTOS_OPENCLAW_GATEWAY_CLIENT);
  restoreEnvValue("AGENTOS_OPENCLAW_NATIVE_WS", originalEnv.AGENTOS_OPENCLAW_NATIVE_WS);
  restoreEnvValue("OPENCLAW_GATEWAY_CLIENT", originalEnv.OPENCLAW_GATEWAY_CLIENT);
}

function restoreEnvValue(key: keyof typeof originalEnv, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
