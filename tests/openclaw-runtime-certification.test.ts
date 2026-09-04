import assert from "node:assert/strict";
import { test } from "node:test";

import {
  aggregateOpenClawRuntimeEvidence,
  createRuntimeEvidence
} from "@/lib/openclaw/runtime-certification/evidence-model";
import { executeOpenClawRuntimeProbe, runOpenClawRuntimeCertification } from "@/lib/openclaw/runtime-certification/harness";
import type {
  OpenClawRuntimeCertificationClient,
  OpenClawRuntimeCertificationContext,
  OpenClawRuntimeCertificationProbe,
  OpenClawRuntimeCertificationResult
} from "@/lib/openclaw/runtime-certification/types";

const handshake = {
  protocol: 4,
  server: { version: "2026.9.1", buildId: "target-build" },
  features: {
    methods: ["config.get", "sessions.create", "sessions.messages.subscribe", "models.probe"],
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
    targetVersion: "2026.9.1",
    gatewayUrl: "ws://127.0.0.1:28789",
    handshake,
    clients: { default: { client, handshake } },
    probes: [makeProbe({
      id: "config-get",
      operationId: "config.get",
      operation: "Config",
      method: "config.get",
      requiredEvidenceDimensions: ["availability", "positiveExecution", "responseShape"],
      validateResponse: (payload) => Boolean(payload && typeof payload === "object" && "hash" in payload)
    })]
  });

  assert.equal(report.results[0]?.status, "PASS");
  assert.equal(report.results[0]?.responseShape, "valid");
  assert.deepEqual(report.results[0]?.evidenceDimensions, createRuntimeEvidence({ availability: "proven", positiveExecution: "proven", responseShape: "proven" }));
  assert.equal(report.operations[0]?.outcome, "certified");
  assert.equal(report.summary.passed, 1);
  assert.equal(report.methodCount, 4);
});

test("runtime certification distinguishes expected authorization denial from positive execution", async () => {
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
    probe: makeProbe({
      id: "sessions-create-read-denial",
      operationId: "sessions.create",
      operation: "Session lifecycle",
      method: "sessions.create",
      expectedOutcome: "authorization-denied"
    })
  });

  assert.equal(result.status, "EXPECTED-DENIAL");
  assert.equal(result.expectedOutcome, "authorization-denied");
  assert.equal(result.actualOutcome, "authorization-denied");
  assert.equal(result.failureKind, "authorization-denied");
  assert.equal(result.evidenceDimensions.authorization, "proven");
  assert.equal(result.evidenceDimensions.positiveExecution, "not-tested");
  assert.equal(result.evidenceDimensions.responseShape, "not-tested");
  assert.match(result.errorMessage ?? "", /missing scope/);
});

test("runtime certification treats expected invalid parameters as a passing validation proof", async () => {
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
    probe: makeProbe({
      id: "sessions-create-invalid",
      operationId: "sessions.create",
      operation: "Session validation",
      method: "sessions.create",
      expectedOutcome: "invalid-parameters"
    })
  });

  assert.equal(result.status, "PASS");
  assert.equal(result.expectedOutcome, "invalid-parameters");
  assert.equal(result.actualOutcome, "invalid-parameters");
  assert.equal(result.failureKind, "invalid-parameters");
  assert.equal(result.responseShape, "not-checked");
  assert.equal(result.evidenceDimensions.positiveExecution, "not-tested");
});

test("runtime certification attempts omitted methods and preserves environmental skips", async () => {
  const calls: string[] = [];
  const client = createClient(async (method) => {
    calls.push(method);
    return { ok: true };
  });
  const context: OpenClawRuntimeCertificationContext = {
    clients: { default: { client, handshake } },
    results: [],
    data: {}
  };
  const absent = await executeOpenClawRuntimeProbe({
    context,
    probe: makeProbe({ id: "talk-session", operationId: "talk.session.create", operation: "Talk", method: "talk.session.create" })
  });
  const environmental = await executeOpenClawRuntimeProbe({
    context,
    probe: makeProbe({ id: "models-probe", operationId: "models.probe", operation: "Models", method: "models.probe", skipReason: "Credentials are not configured." })
  });

  assert.equal(absent.status, "PASS");
  assert.equal(absent.failureKind, "none");
  assert.equal(absent.evidenceDimensions.availability, "proven");
  assert.deepEqual(calls, ["talk.session.create"]);
  assert.equal(environmental.status, "SKIPPED");
  assert.equal(environmental.failureKind, "environmental-skip");
  assert.equal(environmental.evidenceDimensions.availability, "proven");
  assert.equal(environmental.evidenceDimensions.positiveExecution, "not-tested");
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
    probe: makeProbe({ id: "config-get", operationId: "config.get", operation: "Config", method: "config.get", validateResponse: () => false })
  });

  assert.equal(result.status, "FAIL");
  assert.equal(result.failureKind, "response-shape-mismatch");
  assert.equal(result.responseShape, "invalid");
  assert.equal(result.evidenceDimensions.positiveExecution, "proven");
  assert.equal(result.evidenceDimensions.responseShape, "failed");
});

test("runtime evidence does not promote authorization denial to positive certification", () => {
  const result = aggregateOpenClawRuntimeEvidence([
    makeResult({ id: "read-denial", operationId: "chat.send", status: "EXPECTED-DENIAL", proofKind: "authorization-denial", evidenceDimensions: createRuntimeEvidence({ availability: "proven", authorization: "proven" }) })
  ]);

  assert.equal(result[0]?.outcome, "partially-certified");
  assert.equal(result[0]?.evidenceDimensions.authorization, "proven");
  assert.equal(result[0]?.evidenceDimensions.positiveExecution, "not-tested");
});

test("runtime evidence certifies only after positive execution and authorization proofs are combined", () => {
  const result = aggregateOpenClawRuntimeEvidence([
    makeResult({ id: "positive", operationId: "chat.send", status: "PASS", proofKind: "positive", evidenceDimensions: createRuntimeEvidence({ availability: "proven", positiveExecution: "proven", responseShape: "proven" }) }),
    makeResult({ id: "read-denial", operationId: "chat.send", status: "EXPECTED-DENIAL", proofKind: "authorization-denial", evidenceDimensions: createRuntimeEvidence({ availability: "proven", authorization: "proven" }) })
  ]);

  assert.equal(result[0]?.outcome, "certified");
  assert.deepEqual(result[0]?.evidenceDimensions, createRuntimeEvidence({ availability: "proven", authorization: "proven", positiveExecution: "proven", responseShape: "proven" }));
});

function makeProbe(overrides: Partial<OpenClawRuntimeCertificationProbe>): OpenClawRuntimeCertificationProbe {
  return {
    id: "probe",
    operationId: "operation",
    operation: "Operation",
    method: "operation",
    requirementLevel: "required",
    requiredEvidenceDimensions: ["availability", "authorization", "positiveExecution", "responseShape"],
    requirementRationale: "Required by the test.",
    ...overrides
  };
}

function makeResult(overrides: Partial<OpenClawRuntimeCertificationResult>): OpenClawRuntimeCertificationResult {
  return {
    id: "probe",
    operationId: "operation",
    operation: "Operation",
    method: "operation",
    requirementLevel: "required",
    requiredEvidenceDimensions: ["availability", "authorization", "positiveExecution", "responseShape"],
    requirementRationale: "Required by the test.",
    actualRole: "operator",
    actualScopes: ["operator.read"],
    expectedOutcome: "positive",
    actualOutcome: "positive",
    status: "PASS",
    proofKind: "positive",
    evidenceDimensions: createRuntimeEvidence({ availability: "proven", positiveExecution: "proven", responseShape: "proven" }),
    responseShape: "valid",
    errorCode: null,
    errorMessage: null,
    failureKind: "none",
    retryable: false,
    evidence: [],
    ...overrides
  };
}

function createClient(handler: (method: string, ...args: unknown[]) => Promise<unknown>): OpenClawRuntimeCertificationClient {
  return {
    callNative: async <TPayload = unknown>(
      method: string,
      params?: Record<string, unknown>,
      options?: { timeoutMs?: number },
      policy?: { safety: "read" | "mutation"; timeoutMs?: number }
    ) => await handler(method, params, options, policy) as TPayload
  };
}
