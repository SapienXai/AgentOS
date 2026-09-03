import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  getOpenClawGatewayClient,
  resetOpenClawGatewayClient
} from "@/lib/openclaw/client/gateway-client-factory";
import {
  AGENTOS_OPENCLAW_TRANSPORT_ENV,
  resolveOpenClawTransportSelection
} from "@/lib/openclaw/client/gateway-client";
import { OfficialGatewayHarness } from "@/tests/helpers/official-gateway-harness";

const ENVIRONMENT_KEYS = [
  AGENTOS_OPENCLAW_TRANSPORT_ENV,
  "AGENTOS_OPENCLAW_GATEWAY_CLIENT",
  "OPENCLAW_GATEWAY_CLIENT",
  "AGENTOS_OPENCLAW_NATIVE_WS",
  "AGENTOS_OPENCLAW_GATEWAY_URL",
  "OPENCLAW_GATEWAY_URL",
  "AGENTOS_OPENCLAW_GATEWAY_TOKEN",
  "OPENCLAW_GATEWAY_TOKEN",
  "AGENTOS_OPENCLAW_GATEWAY_PASSWORD",
  "OPENCLAW_GATEWAY_PASSWORD",
  "OPENCLAW_STATE_DIR"
] as const;

const originalEnvironment = new Map(
  ENVIRONMENT_KEYS.map((key) => [key, process.env[key]])
);

afterEach(() => {
  resetOpenClawGatewayClient("factory test cleanup");
  for (const key of ENVIRONMENT_KEYS) {
    const value = originalEnvironment.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("transport selector defaults to official and fails closed on invalid values", () => {
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
  assert.deepEqual(resolveOpenClawTransportSelection("typo"), {
    implementation: "official",
    source: "invalid",
    warning: "Invalid AGENTOS_OPENCLAW_TRANSPORT value; using the official transport."
  });
});

test("default factory selects the official-backed domain path", () => {
  delete process.env[AGENTOS_OPENCLAW_TRANSPORT_ENV];
  delete process.env.AGENTOS_OPENCLAW_GATEWAY_CLIENT;
  delete process.env.OPENCLAW_GATEWAY_CLIENT;
  delete process.env.AGENTOS_OPENCLAW_NATIVE_WS;

  const client = getOpenClawGatewayClient();
  assert.equal(client.getDiagnostics?.().transportImplementation, "official");
  assert.equal(client.getDiagnostics?.().transportSelectionWarning, null);
});

test("explicit official selector and invalid selector stay on the official path", () => {
  process.env[AGENTOS_OPENCLAW_TRANSPORT_ENV] = "official";
  assert.equal(getOpenClawGatewayClient().getDiagnostics?.().transportImplementation, "official");

  resetOpenClawGatewayClient("invalid selector test");
  process.env[AGENTOS_OPENCLAW_TRANSPORT_ENV] = "invalid-value";
  const diagnostics = getOpenClawGatewayClient().getDiagnostics?.();
  assert.equal(diagnostics?.transportImplementation, "official");
  assert.equal(
    diagnostics?.transportSelectionWarning,
    "Invalid AGENTOS_OPENCLAW_TRANSPORT value; using the official transport."
  );
});

test("custom selector is an explicit rollback and forced CLI remains authoritative", () => {
  process.env[AGENTOS_OPENCLAW_TRANSPORT_ENV] = "custom";
  assert.equal(getOpenClawGatewayClient().getDiagnostics?.().transportImplementation, "custom");

  resetOpenClawGatewayClient("forced cli test");
  process.env.AGENTOS_OPENCLAW_GATEWAY_CLIENT = "cli";
  const diagnostics = getOpenClawGatewayClient().getDiagnostics?.();
  assert.equal(diagnostics?.transportImplementation, "cli");
});

test("default factory reaches the official Gateway through the real domain client", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "agentos-factory-official-state-"));
  const harness = await OfficialGatewayHarness.create({
    routes: {
      health: ({ respond }) => respond({ ok: true, source: "official-harness" })
    }
  });

  try {
    delete process.env[AGENTOS_OPENCLAW_TRANSPORT_ENV];
    delete process.env.AGENTOS_OPENCLAW_GATEWAY_CLIENT;
    delete process.env.OPENCLAW_GATEWAY_CLIENT;
    delete process.env.AGENTOS_OPENCLAW_NATIVE_WS;
    process.env.AGENTOS_OPENCLAW_GATEWAY_URL = harness.url;
    process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN = "factory-test-token";
    process.env.OPENCLAW_STATE_DIR = stateDir;

    const client = getOpenClawGatewayClient();
    const health = await client.getHealth({ timeoutMs: 2_000 });
    assert.deepEqual(health, { ok: true, source: "official-harness" });
    assert.equal(client.getDiagnostics?.().transportImplementation, "official");
    assert.equal(harness.connectionCount, 1);
    assert.deepEqual(harness.requests.map(({ method }) => method), ["connect", "health"]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
    await harness.close();
  }
});

test("custom rollback reaches the legacy transport without starting an official peer", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "agentos-factory-custom-state-"));
  const harness = await OfficialGatewayHarness.create({
    routes: {
      health: ({ respond }) => respond({ ok: true, source: "custom-harness" })
    }
  });

  try {
    process.env[AGENTOS_OPENCLAW_TRANSPORT_ENV] = "custom";
    delete process.env.AGENTOS_OPENCLAW_GATEWAY_CLIENT;
    delete process.env.OPENCLAW_GATEWAY_CLIENT;
    delete process.env.AGENTOS_OPENCLAW_NATIVE_WS;
    process.env.AGENTOS_OPENCLAW_GATEWAY_URL = harness.url;
    process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN = "factory-test-token";
    process.env.OPENCLAW_STATE_DIR = stateDir;

    const client = getOpenClawGatewayClient();
    const health = await client.getHealth({ timeoutMs: 2_000 });
    assert.deepEqual(health, { ok: true, source: "custom-harness" });
    assert.equal(client.getDiagnostics?.().transportImplementation, "custom");
    assert.equal(harness.connectionCount, 1);
    assert.deepEqual(harness.requests.map(({ method }) => method), ["connect", "health"]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
    await harness.close();
  }
});
