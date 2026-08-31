import assert from "node:assert/strict";
import { test } from "node:test";

import { executeOpenClawRuntimeProbe, runOpenClawRuntimeCertification } from "@/lib/openclaw/runtime-certification/harness";
import type {
  OpenClawRuntimeCertificationClient,
  OpenClawRuntimeCertificationContext
} from "@/lib/openclaw/runtime-certification/types";

const handshake = {
  protocol: 4,
  server: { version: "2026.8.1", buildId: "target-build" },
  features: {
    methods: ["config.get", "sessions.create", "sessions.messages.subscribe"],
    events: ["session.message"]
  },
  auth: { role: "operator", scopes: ["operator.read", "operator.write"] }
};

test("runtime certification records native PASS and response shape evidence", async () => {
  const client = createClient(async (method) => {
    assert.equal(method, "config.get");
    return { config: {}, hash: "hash" };
  });
  const report = await runOpenClawRuntimeCertification({
    targetVersion: "2026.8.1",
    gatewayUrl: "ws://127.0.0.1:28789",
    handshake,
    clients: { default: { client, handshake } },
    probes: [{
      id: "config-get",
      operation: "Config",
      method: "config.get",
      expectedScope: "operator.read",
      validateResponse: (payload) => Boolean(payload && typeof payload === "object" && "hash" in payload)
    }]
  });

  assert.equal(report.results[0]?.status, "PASS");
  assert.equal(report.results[0]?.responseShape, "valid");
  assert.equal(report.summary.passed, 1);
  assert.equal(report.methodCount, 3);
});

test("runtime certification distinguishes expected authorization denial from a failure", async () => {
  const client = createClient(async () => {
    throw new Error("FORBIDDEN: missing scope: operator.write");
  });
  const context: OpenClawRuntimeCertificationContext = {
    clients: { default: { client, handshake } },
    results: [],
    data: {}
  };
  const result = await executeOpenClawRuntimeProbe({
    context,
    probe: {
      id: "sessions-create-read-denial",
      operation: "Session lifecycle",
      method: "sessions.create",
      expectedScope: "operator.write",
      expectedOutcome: "authorization-denied"
    }
  });

  assert.equal(result.status, "EXPECTED-DENIAL");
  assert.equal(result.failureKind, "authorization-denied");
  assert.match(result.errorMessage ?? "", /missing scope/);
});

test("runtime certification treats expected invalid parameters as a passing contract proof", async () => {
  const client = createClient(async () => {
    throw new Error("INVALID_REQUEST: key is required");
  });
  const context: OpenClawRuntimeCertificationContext = {
    clients: { default: { client, handshake } },
    results: [],
    data: {}
  };
  const result = await executeOpenClawRuntimeProbe({
    context,
    probe: {
      id: "sessions-create-invalid",
      operation: "Session validation",
      method: "sessions.create",
      expectedOutcome: "invalid-parameters"
    }
  });

  assert.equal(result.status, "PASS");
  assert.equal(result.failureKind, "invalid-parameters");
  assert.equal(result.responseShape, "not-checked");
});

test("runtime certification preserves skips for absent methods and environmental work", async () => {
  const client = createClient(async () => ({ ok: true }));
  const context: OpenClawRuntimeCertificationContext = {
    clients: { default: { client, handshake } },
    results: [],
    data: {}
  };
  const absent = await executeOpenClawRuntimeProbe({
    context,
    probe: {
      id: "talk-session",
      operation: "Talk",
      method: "talk.session.create"
    }
  });
  const environmental = await executeOpenClawRuntimeProbe({
    context,
    probe: {
      id: "models-probe",
      operation: "Models",
      method: "models.probe",
      skipReason: "Credentials are not configured."
    }
  });

  assert.equal(absent.status, "SKIPPED");
  assert.equal(absent.failureKind, "method-unavailable");
  assert.equal(environmental.status, "SKIPPED");
  assert.equal(environmental.failureKind, "environmental-skip");
});

test("runtime certification fails closed on a response shape mismatch", async () => {
  const client = createClient(async () => ({ ok: true }));
  const context: OpenClawRuntimeCertificationContext = {
    clients: { default: { client, handshake } },
    results: [],
    data: {}
  };
  const result = await executeOpenClawRuntimeProbe({
    context,
    probe: {
      id: "config-get",
      operation: "Config",
      method: "config.get",
      validateResponse: () => false
    }
  });

  assert.equal(result.status, "FAIL");
  assert.equal(result.failureKind, "response-shape-mismatch");
  assert.equal(result.responseShape, "invalid");
});

function createClient(handler: (method: string, ...args: unknown[]) => Promise<unknown>): OpenClawRuntimeCertificationClient {
  return {
    callNative: async <TPayload = unknown>(
      method: string,
      params?: Record<string, unknown>,
      options?: { timeoutMs?: number },
      policy?: { safety: "read" | "mutation"; timeoutMs?: number }
    ) =>
      await handler(method, params, options, policy) as TPayload
  };
}
