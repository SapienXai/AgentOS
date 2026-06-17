import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOpenClawCompatibilityLabReport } from "@/lib/openclaw/compatibility-lab/report-service";
import type { OpenClawCompatibilityReport } from "@/lib/openclaw/compat";
import type {
  OpenClawUpdateDecision
} from "@/lib/openclaw/types";

test("compatibility lab keeps unknown targets report-only and certification blocked", () => {
  const report = buildOpenClawCompatibilityLabReport({
    generatedAt: new Date("2026-06-17T10:00:00.000Z"),
    targetVersion: "2026.9.0",
    currentCertifiedBaseline: "2026.6.1",
    installedOpenClawVersion: "2026.6.1",
    manifestDecision: createDecision({
      version: "2026.9.0",
      status: "unknown",
      allowed: false,
      reason: "Unknown OpenClaw versions are hidden from the default update path."
    }),
    preflightReport: null,
    compatibilityReport: null,
    capabilityMatrix: null,
    compatibilitySmokeReport: null,
    runtimeIssues: []
  });

  assert.equal(report.targetOpenClawVersion, "2026.9.0");
  assert.equal(report.manifestDecision.status, "unknown");
  assert.equal(report.certificationBlocked, true);
  assert.equal(report.areas.find((area) => area.id === "manifest-policy")?.status, "warning");
  assert.match(report.summary.recommendedNextAction, /Do not certify/);
});

test("compatibility lab maps payload shape failures to parser modules", () => {
  const report = buildOpenClawCompatibilityLabReport({
    generatedAt: new Date("2026-06-17T10:00:00.000Z"),
    targetVersion: "2026.6.6",
    currentCertifiedBaseline: "2026.6.1",
    installedOpenClawVersion: "2026.6.6",
    manifestDecision: createDecision({
      version: "2026.6.6",
      status: "candidate",
      allowed: false,
      reason: "Preview validation in progress."
    }),
    preflightReport: null,
    compatibilityReport: createCompatibilityReportWithInvalidModelShape(),
    capabilityMatrix: null,
    compatibilitySmokeReport: null,
    runtimeIssues: []
  });
  const payloadArea = report.areas.find((area) => area.id === "payload-shapes");

  assert.equal(payloadArea?.status, "failed");
  assert.equal(payloadArea?.blocksCertification, true);
  assert.equal(
    payloadArea?.affectedAgentOsFiles.includes("lib/openclaw/client/native-ws-gateway-payloads.ts"),
    true
  );
  assert.match(JSON.stringify(payloadArea?.actualBehaviorOrShape), /Models List/);
});

test("compatibility lab redacts runtime issue evidence", () => {
  const report = buildOpenClawCompatibilityLabReport({
    generatedAt: new Date("2026-06-17T10:00:00.000Z"),
    targetVersion: "2026.6.6",
    currentCertifiedBaseline: "2026.6.1",
    installedOpenClawVersion: "2026.6.6",
    manifestDecision: createDecision({
      version: "2026.6.6",
      status: "candidate",
      allowed: false,
      reason: "Preview validation in progress."
    }),
    preflightReport: null,
    compatibilityReport: null,
    capabilityMatrix: null,
    compatibilitySmokeReport: null,
    runtimeIssues: [{
      id: "model_auth_required:model_auth:global",
      type: "model_auth_required",
      source: "model_auth",
      severity: "action_required",
      title: "Model authentication required",
      message: "Provider token expired.",
      rawOutput: "OPENAI_API_KEY=sk-secret-value",
      createdAt: "2026-06-17T09:00:00.000Z",
      updatedAt: "2026-06-17T09:00:00.000Z",
      status: "open"
    }]
  });

  assert.doesNotMatch(JSON.stringify(report), /sk-secret-value/);
  assert.match(JSON.stringify(report), /OPENAI_API_KEY=\[redacted\]/);
});

function createDecision(input: {
  version: string;
  status: OpenClawUpdateDecision["status"];
  allowed: boolean;
  reason: string;
}): OpenClawUpdateDecision {
  return {
    version: input.version,
    status: input.status,
    allowed: input.allowed,
    defaultVisible: input.status === "certified",
    requiresExplicitOptIn: input.status === "candidate" || input.status === "unknown",
    requiresAgentOsUpdate: false,
    minRequiredAgentOsVersion: null,
    reason: input.reason,
    notes: null
  };
}

function createCompatibilityReportWithInvalidModelShape() {
  return {
    status: "incompatible",
    gateway: {
      health: "healthy",
      protocolStatus: "compatible",
      protocolVersion: "4",
      protocolRange: { min: 4, max: 4 },
      healthReason: "Gateway status reports RPC ready."
    },
    summary: {
      nativeGatewayCoverageLabel: "2/2 operations",
      nativeGatewayCoveragePercent: 100
    },
    contracts: [{
      operation: "models",
      label: "Models List",
      status: "failed",
      required: true,
      baseline: "required",
      supportedMethod: "models.list",
      responseShapeStatus: "invalid",
      responseShapeValid: false,
      missingScopes: [],
      reason: "Models List advertised models.list, but the response shape did not match AgentOS' contract.",
      suggestedRecovery: "Update AgentOS payload parsing or OpenClaw so the response matches the contract."
    }]
  } as unknown as OpenClawCompatibilityReport;
}
