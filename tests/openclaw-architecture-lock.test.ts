import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { OPENCLAW_GATEWAY_PROTOCOL_RANGE } from "@/lib/openclaw/client/openclaw-protocol";
import { resolveOpenClawTransportSelection } from "@/lib/openclaw/client/native-ws-gateway-policy";

const root = process.cwd();

async function source(relativePath: string) {
  return readFile(join(root, relativePath), "utf8");
}

test("Phase 5A locks the official production dependency boundary", async () => {
  const factory = await source("lib/openclaw/client/gateway-client-factory.ts");
  const officialFiles = await Promise.all([
    source("lib/openclaw/client/official-gateway-transport.ts"),
    source("lib/openclaw/client/official-gateway-host.ts"),
    source("lib/openclaw/client/official-gateway-coordinator.ts"),
    source("lib/openclaw/client/official-gateway-factory.ts")
  ]);

  assert.match(factory, /resolveOpenClawTransportSelection/);
  assert.match(factory, /selection\.implementation === "custom"/);
  assert.match(factory, /createOfficialBackedOpenClawGatewayClient/);
  assert.ok(
    factory.indexOf('selection.implementation === "custom"') <
      factory.indexOf("return createOfficialBackedOpenClawGatewayClient"),
    "the official factory must be the non-custom branch"
  );
  assert.doesNotMatch(factory, /native-ws-gateway-(wire|connection|auth)/);

  for (const officialSource of officialFiles) {
    assert.doesNotMatch(
      officialSource,
      /native-ws-gateway-(wire|connection|auth)|PersistentOpenClawGatewayConnection/,
      "official production files must not depend on rollback wire/auth assembly"
    );
  }

  const officialTransport = officialFiles[0];
  const officialFactory = officialFiles[3];
  assert.match(officialTransport, /from "@openclaw\/gateway-client"/);
  assert.match(officialTransport, /onReconnectPaused/);
  assert.match(officialTransport, /this\.#client\.start\(\)/);
  assert.match(officialFactory, /AgentOsGatewayRequestPolicy/);
  assert.match(officialFactory, /requestPolicy/);
  assert.match(officialFactory, /transport: coordinator/);
});

test("Phase 5A keeps rollback selection explicit and one-way", () => {
  assert.deepEqual(resolveOpenClawTransportSelection(undefined), {
    implementation: "official",
    source: "default",
    warning: null
  });
  assert.deepEqual(resolveOpenClawTransportSelection("official"), {
    implementation: "official",
    source: "explicit",
    warning: null
  });
  assert.deepEqual(resolveOpenClawTransportSelection("custom"), {
    implementation: "custom",
    source: "explicit",
    warning: null
  });
  assert.equal(resolveOpenClawTransportSelection("invalid").implementation, "official");
});

test("Phase 5A preserves the raw task event bridge without tasks.subscribe", async () => {
  const [protocol, coordinator, bridge, runtime] = await Promise.all([
    source("lib/openclaw/client/native-ws-gateway-protocol.ts"),
    source("lib/openclaw/client/official-gateway-coordinator.ts"),
    source("lib/openclaw/application/event-bridge-service.ts"),
    source("lib/openclaw/application/runtime-state-service.ts")
  ]);

  for (const productionSource of [protocol, coordinator, bridge]) {
    assert.doesNotMatch(productionSource, /tasks\.subscribe/);
  }
  assert.match(protocol, /task lifecycle changes on the authenticated event/);
  assert.match(protocol, /stream\. Task inclusion is AgentOs product intent/i);
  assert.match(bridge, /notifyBridgeEventSubscribers\(frame\)/);
  assert.match(bridge, /persistGatewayEvent\(frame\)/);
  assert.match(runtime, /eventName === "task"/);
  assert.match(runtime, /taskId/);
});

test("Phase 5A keeps the exact official package and protocol authority", async () => {
  const packageJson = JSON.parse(await source("package.json")) as {
    dependencies?: Record<string, string>;
  };
  const lockfile = await source("pnpm-lock.yaml");

  assert.equal(packageJson.dependencies?.["@openclaw/gateway-client"], "2026.8.2");
  assert.equal(packageJson.dependencies?.["@openclaw/gateway-protocol"], "2026.8.2");
  assert.match(lockfile, /'@openclaw\/gateway-client':\n\s+specifier: 2026\.8\.2\n\s+version: 2026\.8\.2/);
  assert.match(lockfile, /'@openclaw\/gateway-protocol':\n\s+specifier: 2026\.8\.2\n\s+version: 2026\.8\.2/);
  assert.deepEqual(OPENCLAW_GATEWAY_PROTOCOL_RANGE, { min: 4, max: 4 });
});

test("Phase 5A keeps current certification entrypoints off direct custom construction", async () => {
  const currentEntryPoints = await Promise.all([
    "scripts/openclaw-runtime-certification.ts",
    "scripts/openclaw-automation-e2e.ts",
    "scripts/openclaw-lifecycle-e2e.ts",
    "scripts/openclaw-identity-e2e.ts",
    "scripts/openclaw-multi-user-e2e.ts",
    "scripts/openclaw-session-task-e2e.ts",
    "scripts/openclaw-compat.ts",
    "lib/openclaw/lifecycle/service.ts",
    "lib/openclaw/application/compatibility-smoke-service.ts",
    "lib/openclaw/application/capability-matrix-service.ts",
    "lib/openclaw/application/settings-service.ts"
  ].map((relativePath) => source(relativePath)));

  for (const entryPoint of currentEntryPoints) {
    assert.doesNotMatch(entryPoint, /new NativeWsOpenClawGatewayClient/);
  }
});

test("Phase 5A marks the custom socket and connect assembly as rollback-only", async () => {
  const [connection, wire, auth, eventBridge] = await Promise.all([
    source("lib/openclaw/client/native-ws-gateway-connection.ts"),
    source("lib/openclaw/client/native-ws-gateway-wire.ts"),
    source("lib/openclaw/client/native-ws-gateway-auth.ts"),
    source("lib/openclaw/application/event-bridge-service.ts")
  ]);

  assert.match(connection, /ROLLBACK-ONLY/);
  assert.match(wire, /ROLLBACK-ONLY/);
  assert.match(auth, /ROLLBACK-ONLY/);
  assert.match(eventBridge, /officialLifecycleManaged \|\| subscription \|\| starting \|\| reconnectTimer/);
});
