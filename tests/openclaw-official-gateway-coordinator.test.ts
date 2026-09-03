import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

import {
  AgentOsGatewayRequestPolicy,
  createAgentOsGatewayClientHostDeps,
  createOfficialBackedOpenClawGatewayClient,
  NativeGatewayRequestError
} from "@/lib/openclaw/client/gateway-client";
import { publicKeyRawBase64UrlFromPem } from "@/lib/openclaw/client/native-ws-gateway-auth";
import { OfficialGatewayHarness } from "@/tests/helpers/official-gateway-harness";

test("official-backed domain client preserves representative reads and identity", async () => {
  const harness = await OfficialGatewayHarness.create({
    methods: [
      "agents.list",
      "sessions.list",
      "tasks.list",
      "models.list",
      "channels.status",
      "config.get"
    ],
    routes: {
      "agents.list": ({ respond }) => respond({ agents: [] }),
      "sessions.list": ({ respond }) => respond({ sessions: [] }),
      "tasks.list": ({ respond }) => respond({ tasks: [] }),
      "models.list": ({ respond }) => respond({ models: [{ id: "demo", name: "Demo", provider: "demo" }] }),
      "channels.status": ({ respond }) => respond({
        ts: Date.now(),
        channels: {},
        channelAccounts: {},
        channelOrder: [],
        channelLabels: {},
        channelDefaultAccountId: {}
      }),
      "config.get": ({ respond }) => respond({ config: { gateway: { port: 18789 } } })
    }
  });
  const client = createOfficialBackedOpenClawGatewayClient({
    url: harness.url,
    token: "phase3-token"
  });

  try {
    assert.deepEqual((await client.listAgents()).agents, []);
    assert.deepEqual((await client.listSessions()).sessions, []);
    assert.deepEqual((await client.listTasks()).tasks, []);
    assert.equal((await client.listModels()).models[0]?.name, "Demo");
    assert.deepEqual((await client.getChannelStatus()).channels, {});
    assert.equal(await client.getConfig<number>("gateway.port"), 18789);

    const identity = await client.getOperatorIdentity?.();
    assert.equal(identity?.authenticated, true);
    assert.equal(identity?.role, "operator");
    assert.deepEqual(identity?.requestedScopes, [
      "operator.admin",
      "operator.read",
      "operator.write",
      "operator.approvals",
      "operator.questions",
      "operator.pairing",
      "operator.talk",
      "operator.talk.secrets"
    ]);
  } finally {
    client.close?.("phase3 test cleanup");
    await harness.close();
  }
});

test("official-backed domain path preserves AgentOS read-policy semantics", async () => {
  let now = 1_000;
  let readCount = 0;
  let failedReadAttempts = 0;
  const harness = await OfficialGatewayHarness.create({
    routes: {
      "policy.read": ({ respond }) => {
        readCount += 1;
        respond({ value: readCount });
      },
      "policy.failed": ({ fail, respond }) => {
        failedReadAttempts += 1;
        if (failedReadAttempts === 1) {
          fail({ code: "INTERNAL", message: "controlled read failure" });
          return;
        }
        respond({ value: "retry-success" });
      },
      "policy.update": ({ respond }) => respond({ ok: true })
    }
  });
  const client = createOfficialBackedOpenClawGatewayClient({
    url: harness.url,
    token: "policy-token",
    requestPolicy: new AgentOsGatewayRequestPolicy({ now: () => now })
  });

  try {
    const [first, equivalent] = await Promise.all([
      client.call<{ value: number }>("policy.read", { a: 1, b: 2 }),
      client.call<{ value: number }>("policy.read", { b: 2, a: 1 })
    ]);
    assert.deepEqual(first, { value: 1 });
    assert.deepEqual(equivalent, { value: 1 });
    assert.equal(countRequests(harness, "policy.read"), 1);

    assert.deepEqual(await client.call("policy.read", { a: 1, b: 2 }), { value: 1 });
    assert.equal(countRequests(harness, "policy.read"), 1);
    now += 301;
    assert.deepEqual(await client.call("policy.read", { a: 1, b: 2 }), { value: 2 });
    assert.equal(countRequests(harness, "policy.read"), 2);

    await assert.rejects(client.call("policy.failed"));
    assert.deepEqual(await client.call("policy.failed"), { value: "retry-success" });
    assert.equal(countRequests(harness, "policy.failed"), 2);

    await client.call("policy.read", { id: "mutation" });
    await client.call("policy.update", { id: "mutation" });
    assert.deepEqual(await client.call("policy.read", { id: "mutation" }), { value: 4 });
    assert.equal(countRequests(harness, "policy.read"), 4);
    assert.equal(client.getDiagnostics().cachedReadRequestCount, 1);
  } finally {
    client.close?.("official request-policy test cleanup");
    await harness.close();
  }
});

test("official-backed request policy isolates aborts, reports diagnostics, and fences sent mutations", async () => {
  let readCount = 0;
  let respondPending: (payload?: unknown) => void = () => {
    throw new Error("The pending request responder was not initialized.");
  };
  const harness = await OfficialGatewayHarness.create({
    routes: {
      "policy.pending": (context) => {
        respondPending = context.respond;
      },
      "policy.signal": (context) => {
        if (countRequests(harness, "policy.signal") === 1) {
          context.leaveOpen();
          return;
        }
        context.respond({ value: "normal" });
      },
      "policy.read": ({ respond }) => {
        readCount += 1;
        respond({ value: readCount });
      },
      "policy.update": ({ request, leaveOpen, respond }) => {
        if (request.params && typeof request.params === "object" && "ambiguous" in request.params) {
          leaveOpen();
          return;
        }
        respond({ ok: true });
      }
    }
  });
  const client = createOfficialBackedOpenClawGatewayClient({
    url: harness.url,
    token: "policy-token"
  });

  try {
    const pending = client.callNative("policy.pending", {}, {}, { safety: "read" });
    await waitFor(() => countRequests(harness, "policy.pending") === 1);
    assert.equal(client.getDiagnostics().sharedInFlightRequestCount, 1);
    assert.equal(client.getDiagnostics().pendingRequestCount, undefined);
    respondPending({ value: "pending" });
    assert.deepEqual(await pending, { value: "pending" });
    assert.equal(client.getDiagnostics().sharedInFlightRequestCount, 0);

    const controller = new AbortController();
    const signalled = client.callNative(
      "policy.signal",
      { key: "same-read" },
      { signal: controller.signal },
      { safety: "read" }
    );
    await waitFor(() => countRequests(harness, "policy.signal") === 1);
    const normal = client.callNative(
      "policy.signal",
      { key: "same-read" },
      {},
      { safety: "read" }
    );
    await waitFor(() => countRequests(harness, "policy.signal") === 2);
    controller.abort();
    assert.deepEqual(await normal, { value: "normal" });
    await assert.rejects(signalled);
    assert.equal(countRequests(harness, "policy.signal"), 2);

    await client.call("policy.read", { id: "ambiguous" });
    await assert.rejects(
      client.callNative(
        "policy.update",
        { ambiguous: true },
        { timeoutMs: 20 },
        { safety: "mutation" }
      ),
      (error: unknown) => {
        assert.ok(error instanceof NativeGatewayRequestError);
        assert.equal(error.sent, true);
        return true;
      }
    );
    await client.call("policy.read", { id: "ambiguous" });
    assert.equal(readCount, 2);
    assert.equal(client.getDiagnostics().cachedReadRequestCount, 1);
  } finally {
    client.close?.("official request-policy test cleanup");
    await harness.close();
  }
});

test("official-backed request policy clears cached projections after reconnect", async () => {
  let readCount = 0;
  let lifecycleState = "stopped";
  const harness = await OfficialGatewayHarness.create({
    routes: {
      "policy.read": ({ respond }) => {
        readCount += 1;
        respond({ value: readCount });
      }
    }
  });
  const client = createOfficialBackedOpenClawGatewayClient({
    url: harness.url,
    token: "policy-token",
    callbacks: { onConnectionStateChange: (state) => { lifecycleState = state; } }
  });

  try {
    assert.deepEqual(await client.call("policy.read", { id: "reconnect" }), { value: 1 });
    assert.deepEqual(await client.call("policy.read", { id: "reconnect" }), { value: 1 });
    assert.equal(readCount, 1);

    harness.closeSockets(1012, "restart");
    await waitFor(() => lifecycleState === "reconnecting", 2_000);
    await waitFor(() => harness.connectionCount >= 2, 5_000);
    assert.deepEqual(await client.call("policy.read", { id: "reconnect" }), { value: 2 });
    assert.equal(readCount, 2);
  } finally {
    client.close?.("official request-policy test cleanup");
    await harness.close();
  }
});

test("official coordinator replays session intent once after official reconnect", async () => {
  const harness = await OfficialGatewayHarness.create({
    routes: {
      "sessions.subscribe": ({ respond }) => respond({ ok: true }),
      "sessions.messages.subscribe": ({ respond }) => respond({ key: "agent:one:main" }),
      "sessions.messages.unsubscribe": ({ respond }) => respond({ ok: true })
    }
  });
  const client = createOfficialBackedOpenClawGatewayClient({
    url: harness.url,
    token: "token"
  });
  const events: string[] = [];

  try {
    const subscription = await client.subscribeRuntimeEvents(
      { includeSessions: true, includeTasks: true, sessionKeys: ["agent:one:main"] },
      { onEvent: (event) => events.push(event.event) }
    );
    await waitFor(() => countRequests(harness, "sessions.subscribe") === 1);
    assert.equal(countRequests(harness, "sessions.messages.subscribe"), 1);
    assert.equal(countRequests(harness, "tasks.subscribe"), 0);

    harness.emitEvent("task", { task: { id: "task-1", status: "running" } }, 1);
    await waitFor(() => events.length === 1);
    harness.closeSockets(1012, "restart");
    await waitFor(() => countRequests(harness, "sessions.subscribe") === 2, 5_000);
    await waitFor(() => countRequests(harness, "sessions.messages.subscribe") === 2, 5_000);
    assert.equal(countRequests(harness, "tasks.subscribe"), 0);

    harness.emitEvent("sessions.changed", { sessionId: "session-1" }, 1);
    await waitFor(() => events.length === 2);
    subscription.close();
  } finally {
    client.close?.("phase3 test cleanup");
    await harness.close();
  }
});

test("released official subscription intent is not replayed during reconnect", async () => {
  const harness = await OfficialGatewayHarness.create({
    routes: {
      "sessions.messages.subscribe": ({ respond }) => respond({ key: "key-a" })
    }
  });
  let lifecycleState = "stopped";
  const client = createOfficialBackedOpenClawGatewayClient({
    url: harness.url,
    token: "token",
    callbacks: { onConnectionStateChange: (state) => { lifecycleState = state; } }
  });

  try {
    const subscription = await client.subscribeRuntimeEvents(
      { includeSessions: false, sessionKeys: ["key-a"] },
      { onEvent: () => {} }
    );
    await waitFor(() => countRequests(harness, "sessions.messages.subscribe") === 1);
    harness.closeSockets(1012, "restart");
    await waitFor(() => lifecycleState === "reconnecting", 2_000);
    subscription.close();
    await waitFor(() => harness.connectionCount >= 2, 5_000);
    await delay(100);
    assert.equal(countRequests(harness, "sessions.messages.subscribe"), 1);
    assert.equal(countRequests(harness, "sessions.messages.unsubscribe"), 0);
  } finally {
    client.close?.("phase3 test cleanup");
    await harness.close();
  }
});

test("official coordinator records a subscription acquired during reconnect", async () => {
  const harness = await OfficialGatewayHarness.create({
    routes: {
      "sessions.subscribe": ({ respond }) => respond({ ok: true }),
      "sessions.messages.subscribe": ({ request, respond }) => respond({ key: request.params && typeof request.params === "object" && "key" in request.params ? String(request.params.key) : "unknown" })
    }
  });
  let lifecycleState = "stopped";
  const client = createOfficialBackedOpenClawGatewayClient({
    url: harness.url,
    token: "token",
    callbacks: { onConnectionStateChange: (state) => { lifecycleState = state; } }
  });

  try {
    const first = await client.subscribeRuntimeEvents(
      { includeSessions: true, sessionKeys: ["key-a"] },
      { onEvent: () => {} }
    );
    await waitFor(() => countRequests(harness, "sessions.messages.subscribe") === 1);
    harness.closeSockets(1012, "restart");
    await waitFor(() => lifecycleState === "reconnecting", 2_000);
    const second = await client.subscribeRuntimeEvents(
      { includeSessions: false, sessionKeys: ["key-b"] },
      { onEvent: () => {} },
      { timeoutMs: 5_000 }
    );
    await waitFor(() => countRequests(harness, "sessions.messages.subscribe") === 3, 5_000);
    const keys = harness.requests
      .filter((request) => request.method === "sessions.messages.subscribe")
      .map((request) => (request.params as { key?: string }).key);
    assert.deepEqual(keys, ["key-a", "key-a", "key-b"]);
    first.close();
    second.close();
  } finally {
    client.close?.("phase3 test cleanup");
    await harness.close();
  }
});

test("official coordinator releases the final connected session-message lease", async () => {
  const harness = await OfficialGatewayHarness.create({
    routes: {
      "sessions.messages.subscribe": ({ respond }) => respond({ key: "key-a" }),
      "sessions.messages.unsubscribe": ({ respond }) => respond({ ok: true })
    }
  });
  const client = createOfficialBackedOpenClawGatewayClient({ url: harness.url, token: "token" });

  try {
    const subscription = await client.subscribeRuntimeEvents(
      { includeSessions: false, sessionKeys: ["key-a"] },
      { onEvent: () => {} }
    );
    await waitFor(() => countRequests(harness, "sessions.messages.subscribe") === 1);
    subscription.close();
    await waitFor(() => countRequests(harness, "sessions.messages.unsubscribe") === 1);
  } finally {
    client.close?.("phase3 test cleanup");
    await harness.close();
  }
});

test("managed-write official host persists and fences device-token mutation", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "agentos-official-managed-auth-"));
  const identityDir = join(stateDir, "identity");
  await (await import("node:fs/promises")).mkdir(identityDir, { recursive: true });
  await writeFile(join(identityDir, "device.json"), JSON.stringify({
    deviceId: "device-1",
    privateKeyPem: "private-key",
    publicKeyPem: "public-key"
  }));
  const authPath = join(identityDir, "device-auth.json");
  await writeFile(authPath, JSON.stringify({
    deviceId: "device-1",
    tokens: { operator: { token: "token-x", scopes: ["operator.read"] } }
  }));

  const first = createAgentOsGatewayClientHostDeps({ stateDir, sharedStateMode: "managed-write" });
  const second = createAgentOsGatewayClientHostDeps({ stateDir, sharedStateMode: "managed-write" });
  const firstLoaded = first.loadDeviceAuthToken?.({ deviceId: "device-1", role: "operator" });
  const secondLoaded = second.loadDeviceAuthToken?.({ deviceId: "device-1", role: "operator" });
  assert.equal(firstLoaded?.token, "token-x");
  assert.equal(secondLoaded?.token, "token-x");

  first.storeDeviceAuthToken?.({ deviceId: "device-1", role: "operator", token: "token-y", scopes: ["operator.write"] });
  second.clearDeviceAuthToken?.({ deviceId: "device-1", role: "operator" });
  assert.equal(JSON.parse(await readFile(authPath, "utf8")).tokens.operator.token, "token-y");

  first.clearDeviceAuthToken?.({ deviceId: "device-1", role: "operator" });
  assert.equal(JSON.parse(await readFile(authPath, "utf8")).tokens.operator, undefined);
});

test("managed-write official host uses canonical OpenClaw SQLite auth state when present", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "agentos-official-canonical-auth-"));
  const dbPath = join(stateDir, "state", "openclaw.sqlite");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const deviceId = createHash("sha256")
    .update(Buffer.from(publicKeyRawBase64UrlFromPem(publicKeyPem), "base64url"))
    .digest("hex");
  await mkdir(join(stateDir, "state"), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE device_identities (
      identity_key TEXT NOT NULL PRIMARY KEY,
      device_id TEXT NOT NULL,
      public_key_pem TEXT NOT NULL,
      private_key_pem TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE device_auth_tokens (
      device_id TEXT NOT NULL,
      role TEXT NOT NULL,
      token TEXT NOT NULL,
      scopes_json TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (device_id, role)
    ) STRICT;
  `);
  db.prepare("INSERT INTO device_identities VALUES (?, ?, ?, ?, ?, ?)")
    .run("primary", deviceId, publicKeyPem, privateKeyPem, Date.now(), Date.now());
  db.prepare("INSERT INTO device_auth_tokens VALUES (?, ?, ?, ?, ?)")
    .run(deviceId, "operator", "token-x", JSON.stringify(["operator.read"]), Date.now());
  db.close();

  try {
    const first = createAgentOsGatewayClientHostDeps({ stateDir, sharedStateMode: "managed-write" });
    const second = createAgentOsGatewayClientHostDeps({ stateDir, sharedStateMode: "managed-write" });
    assert.equal(first.loadOrCreateDeviceIdentity?.()?.deviceId, deviceId);
    assert.equal(first.loadDeviceAuthToken?.({ deviceId, role: "operator" })?.token, "token-x");
    assert.equal(second.loadDeviceAuthToken?.({ deviceId, role: "operator" })?.token, "token-x");

    first.storeDeviceAuthToken?.({ deviceId, role: "operator", token: "token-y", scopes: ["operator.write"] });
    second.clearDeviceAuthToken?.({ deviceId, role: "operator" });

    const check = new DatabaseSync(dbPath, { readOnly: true });
    const row = check.prepare("SELECT token FROM device_auth_tokens WHERE device_id = ? AND role = ?")
      .get(deviceId, "operator") as { token?: string } | undefined;
    check.close();
    assert.equal(row?.token, "token-y");

    first.clearDeviceAuthToken?.({ deviceId, role: "operator" });
    const cleared = new DatabaseSync(dbPath, { readOnly: true });
    assert.equal(cleared.prepare("SELECT token FROM device_auth_tokens WHERE device_id = ? AND role = ?")
      .get(deviceId, "operator"), undefined);
    cleared.close();
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("official host redacts auth material even when a caller supplies a log override", () => {
  const deps = createAgentOsGatewayClientHostDeps({
    overrides: { redactForLog: (message) => message }
  });
  const redacted = deps.redactForLog?.(
    'Authorization: Bearer bearer-secret ws://127.0.0.1:18789/?token=query-secret {"password":"password-secret","privateKey":"private-key-secret"}'
  );
  assert.ok(redacted);
  assert.doesNotMatch(redacted, /bearer-secret|query-secret|password-secret|private-key-secret/);
  assert.match(redacted, /\[redacted\]/);
});

function countRequests(harness: OfficialGatewayHarness, method: string) {
  return harness.requests.filter((request) => request.method === method).length;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for official Gateway coordinator state.");
    }
    await delay(10);
  }
}
