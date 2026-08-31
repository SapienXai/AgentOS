import assert from "node:assert/strict";
import { test } from "node:test";

import { bridgeOpenClawStaticRuntimeEvidence } from "@/lib/openclaw/runtime-certification/evidence-bridge";
import type {
  OpenClawRuntimeCertificationReport,
  OpenClawRuntimeCertificationResult
} from "@/lib/openclaw/runtime-certification/types";
import type { OpenClawServerMethodContractDiffReport } from "@/lib/openclaw/types";

test("evidence bridge certifies only an exact target-version method proof", () => {
  const result = bridgeOpenClawStaticRuntimeEvidence({
    staticReport: createStaticReport({
      targetVersion: "2026.8.1",
      changes: [{ method: "sessions.create", status: "unknown", authorizationEvidence: "runtime-required" }]
    }),
    runtimeReport: createRuntimeReport({
      targetVersion: "2026.8.1",
      results: [runtimeResult("sessions.create", "PASS")]
    })
  });

  assert.equal(result.runtimeVersionMatched, true);
  assert.equal(result.rows[0]?.outcome, "certified");
  assert.equal(result.summary.certified, 1);
});

test("evidence bridge ignores a proof for the wrong method", () => {
  const result = bridgeOpenClawStaticRuntimeEvidence({
    staticReport: createStaticReport({
      targetVersion: "2026.8.1",
      changes: [{ method: "sessions.create", status: "unknown", authorizationEvidence: "runtime-required" }]
    }),
    runtimeReport: createRuntimeReport({
      targetVersion: "2026.8.1",
      results: [runtimeResult("sessions.patch", "PASS")]
    })
  });

  assert.equal(result.rows[0]?.outcome, "uncertified");
  assert.equal(result.summary.uncertified, 1);
});

test("evidence bridge ignores a proof for the wrong target version", () => {
  const result = bridgeOpenClawStaticRuntimeEvidence({
    staticReport: createStaticReport({
      targetVersion: "2026.8.1",
      changes: [{ method: "sessions.create", status: "warning", authorizationEvidence: "static" }]
    }),
    runtimeReport: createRuntimeReport({
      targetVersion: "2026.8.2",
      results: [runtimeResult("sessions.create", "PASS")]
    })
  });

  assert.equal(result.runtimeVersionMatched, false);
  assert.equal(result.rows[0]?.outcome, "static-only");
  assert.match(result.rows[0]?.reason ?? "", /exactly match/);
});

test("evidence bridge lets a failed runtime proof override static optimism", () => {
  const result = bridgeOpenClawStaticRuntimeEvidence({
    staticReport: createStaticReport({
      targetVersion: "2026.8.1",
      changes: [{ method: "talk.config", status: "safe", authorizationEvidence: "static" }]
    }),
    runtimeReport: createRuntimeReport({
      targetVersion: "2026.8.1",
      results: [runtimeResult("talk.config", "FAIL")]
    })
  });

  assert.equal(result.rows[0]?.outcome, "failed");
  assert.equal(result.summary.failed, 1);
});

test("evidence bridge accepts expected denial as authorization proof", () => {
  const result = bridgeOpenClawStaticRuntimeEvidence({
    staticReport: createStaticReport({
      targetVersion: "2026.8.1",
      changes: [{ method: "node.invoke", status: "unknown", authorizationEvidence: "runtime-required" }]
    }),
    runtimeReport: createRuntimeReport({
      targetVersion: "2026.8.1",
      results: [
        runtimeResult("node.invoke", "SKIPPED"),
        {
          ...runtimeResult("node.invoke", "PASS"),
          status: "EXPECTED-DENIAL",
          failureKind: "authorization-denied"
        }
      ]
    })
  });

  assert.equal(result.rows[0]?.outcome, "certified");
});

function runtimeResult(
  method: string,
  status: "PASS" | "FAIL" | "SKIPPED"
) : OpenClawRuntimeCertificationResult {
  return {
    id: method,
    operation: method,
    method,
    expectedScope: null,
    actualRole: "operator",
    actualScopes: ["operator.admin"],
    status,
    responseShape: status === "PASS" ? "valid" : "unknown",
    errorCode: status === "FAIL" ? "RUNTIME_ERROR" : null,
    errorMessage: status === "FAIL" ? "runtime failure" : null,
    failureKind: status === "FAIL" ? "runtime-error" : "none",
    retryable: false,
    evidence: []
  };
}

function createRuntimeReport(input: {
  targetVersion: string;
  results: OpenClawRuntimeCertificationReport["results"];
}): OpenClawRuntimeCertificationReport {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-31T00:00:00.000Z",
    targetVersion: input.targetVersion,
    gatewayUrl: "ws://127.0.0.1:28789",
    installedVersion: input.targetVersion,
    buildId: "build",
    protocolVersion: 4,
    role: "operator",
    scopes: ["operator.admin"],
    advertisedMethods: [],
    advertisedEvents: [],
    methodCount: 0,
    eventCount: 0,
    connectionStatus: "connected",
    results: input.results,
    summary: {
      total: input.results.length,
      passed: input.results.filter((result) => result.status === "PASS").length,
      failed: input.results.filter((result) => result.status === "FAIL").length,
      skipped: 0,
      expectedDenials: 0,
      unknown: 0,
      requiredFailures: 0
    }
  };
}

function createStaticReport(input: {
  targetVersion: string;
  changes: Array<{
    method: string;
    status: "safe" | "warning" | "blocker" | "unknown";
    authorizationEvidence: "static" | "runtime-required";
  }>;
}): OpenClawServerMethodContractDiffReport {
  return {
    generatedAt: "2026-08-31T00:00:00.000Z",
    source: "github-static",
    currentVersion: "2026.6.11",
    targetVersion: input.targetVersion,
    status: "unknown",
    currentMethodCount: null,
    targetMethodCount: null,
    currentRegisteredMethodCount: null,
    targetRegisteredMethodCount: null,
    changedServerMethodFiles: [],
    changedProtocolFiles: [],
    changes: input.changes.map((change) => ({
      ...change,
      kind: "scope-changed" as const,
      currentScope: "operator.read",
      targetScope: "dynamic",
      affectedOperations: [],
      message: "test static evidence"
    })),
    blockerCount: 0,
    warningCount: 0,
    unknownCount: input.changes.filter((change) => change.status === "unknown").length,
    renamedCount: 0,
    replacedCount: 0,
    summary: "test static evidence",
    error: null
  };
}
