import assert from "node:assert/strict";
import { test } from "node:test";

import {
  evaluateOpenClawRuntimeMigrationReadiness,
  OPENCLAW_RUNTIME_MIGRATION_CORE_OPERATION_IDS
} from "@/lib/openclaw/runtime-certification/readiness-gate";
import type {
  OpenClawRuntimeCertificationReport,
  OpenClawRuntimeOperationEvidence
} from "@/lib/openclaw/runtime-certification/types";

test("readiness gate blocks when a required core operation is missing", () => {
  const report = createReport([]);
  const readiness = evaluateOpenClawRuntimeMigrationReadiness({ runtimeReport: report, staticTargetVersion: "2026.8.1", persistenceHealthy: true });

  assert.equal(readiness.readyForMigrationEngine, false);
  assert.ok(readiness.blockers.some((blocker) => blocker.includes("chat.send")));
});

test("readiness gate ignores optional and experimental gaps", () => {
  const report = createReport(OPENCLAW_RUNTIME_MIGRATION_CORE_OPERATION_IDS.map((operationId) => operation(operationId, "certified")));
  report.operations.push(operation("talk.session.create", "uncertified", "experimental"));
  report.operations.push(operation("cron.run", "partially-certified", "optional"));

  const readiness = evaluateOpenClawRuntimeMigrationReadiness({ runtimeReport: report, staticTargetVersion: "2026.8.1", persistenceHealthy: true });

  assert.equal(readiness.readyForMigrationEngine, true);
  assert.equal(readiness.blockers.length, 0);
  assert.deepEqual(readiness.experimentalOperations, [{ operationId: "talk.session.create", outcome: "uncertified" }]);
});

test("readiness gate requires model execution, streaming, and continuity evidence", () => {
  const report = createReport(OPENCLAW_RUNTIME_MIGRATION_CORE_OPERATION_IDS
    .filter((operationId) => !["chat.send", "chat.streaming", "session.continuity"].includes(operationId))
    .map((operationId) => operation(operationId, "certified")));
  const readiness = evaluateOpenClawRuntimeMigrationReadiness({ runtimeReport: report, staticTargetVersion: "2026.8.1", persistenceHealthy: true });

  assert.equal(readiness.readyForMigrationEngine, false);
  assert.equal(readiness.blockers.filter((blocker) => /chat.send|chat.streaming|session.continuity/.test(blocker)).length, 3);
});

test("readiness gate returns ready only with exact provenance, handshake, persistence, and core proofs", () => {
  const report = createReport(OPENCLAW_RUNTIME_MIGRATION_CORE_OPERATION_IDS.map((operationId) => operation(operationId, "certified")));
  const readiness = evaluateOpenClawRuntimeMigrationReadiness({ runtimeReport: report, staticTargetVersion: "2026.8.1" });

  assert.equal(readiness.readyForMigrationEngine, true);
  assert.equal(readiness.targetVersionMatched, true);
  assert.equal(readiness.installedVersionMatched, true);
  assert.equal(readiness.protocolSupported, true);
  assert.equal(readiness.handshakeValid, true);
  assert.equal(readiness.persistenceHealthy, true);
});

function operation(
  operationId: string,
  outcome: OpenClawRuntimeOperationEvidence["outcome"],
  requirementLevel: OpenClawRuntimeOperationEvidence["requirementLevel"] = "required"
): OpenClawRuntimeOperationEvidence {
  return {
    operationId,
    method: operationId,
    requirementLevel,
    requiredEvidenceDimensions: ["availability", "authorization", "positiveExecution", "responseShape"],
    requirementRationale: "Test evidence.",
    evidenceDimensions: {
      availability: "proven",
      authorization: "proven",
      positiveExecution: "proven",
      responseShape: "proven",
      lifecycle: "not-tested"
    },
    outcome,
    proofIds: [operationId],
    reason: outcome === "certified" ? "All required evidence dimensions are proven." : "Test gap."
  };
}

function createReport(operations: OpenClawRuntimeOperationEvidence[]): OpenClawRuntimeCertificationReport {
  return {
    schemaVersion: 2,
    generatedAt: "2026-08-31T00:00:00.000Z",
    targetVersion: "2026.8.1",
    gatewayUrl: "ws://127.0.0.1:28789",
    installedVersion: "2026.8.1",
    buildId: "target-build",
    protocolVersion: 4,
    role: "operator",
    scopes: ["operator.read", "operator.write"],
    advertisedMethods: [],
    advertisedEvents: [],
    methodCount: 0,
    eventCount: 0,
    connectionStatus: "connected",
    operations,
    results: [],
    persistence: { status: "healthy" },
    summary: { total: 0, passed: 0, failed: 0, skipped: 0, expectedDenials: 0, unknown: 0, requiredFailures: 0 }
  };
}
