import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOpenClawCodexFixBundle } from "@/lib/openclaw/compatibility-lab/fix-bundle-service";
import type { OpenClawCompatibilityLabReport } from "@/lib/openclaw/compatibility-lab/types";
import type { OpenClawUpdateDecision } from "@/lib/openclaw/types";

test("Codex fix bundle includes non-passing areas with scoped instructions", () => {
  const bundle = buildOpenClawCodexFixBundle(createReport());

  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.reportId, "openclaw-lab-test");
  assert.match(bundle.instruction, /Preserve current AgentOS UX/);
  assert.equal(bundle.failures.length, 1);
  assert.equal(bundle.failures[0]?.areaId, "payload-shapes");
  assert.equal(
    bundle.failures[0]?.affectedFiles.includes("lib/openclaw/client/native-ws-gateway-payloads.ts"),
    true
  );
  assert.match(bundle.failures[0]?.failingCommandOrTest ?? "", /openclaw-compat-report/);
  assert.match(JSON.stringify(bundle.failures[0]?.expectedVsActualPayloadDiff), /models\.list/);
});

test("Codex fix bundle preserves redacted stdout and stderr only", () => {
  const bundle = buildOpenClawCodexFixBundle(createReport({
    stdout: "token=[redacted]",
    stderr: "OPENAI_API_KEY=[redacted]"
  }));

  assert.equal(bundle.failures[0]?.redactedStdout, "token=[redacted]");
  assert.equal(bundle.failures[0]?.redactedStderr, "OPENAI_API_KEY=[redacted]");
  assert.doesNotMatch(JSON.stringify(bundle), /sk-secret/);
});

function createReport(output: { stdout?: string; stderr?: string } = {}): OpenClawCompatibilityLabReport {
  return {
    schemaVersion: 1,
    id: "openclaw-lab-test",
    generatedAt: "2026-06-17T10:00:00.000Z",
    targetOpenClawVersion: "2026.7.0",
    currentCertifiedBaseline: "2026.6.8",
    installedOpenClawVersion: "2026.6.8",
    manifestDecision: createDecision(),
    probeTimestamp: "2026-06-17T10:00:00.000Z",
    status: "failed",
    certificationBlocked: true,
    acceptedWarnings: [],
    summary: {
      passed: 0,
      warnings: 0,
      failed: 1,
      unknown: 0,
      recommendedNextAction: "Do not certify."
    },
    areas: [{
      id: "payload-shapes",
      name: "Gateway payload shapes",
      status: "failed",
      evidence: ["models.list returned an unexpected shape."],
      expectedBehaviorOrShape: { models: "array" },
      actualBehaviorOrShape: { unexpected: true, method: "models.list" },
      affectedAgentOsFiles: [
        "lib/openclaw/client/native-ws-gateway-payloads.ts",
        "lib/openclaw/adapter/gateway-payloads.ts"
      ],
      suggestedFixScope: "Update parsers and normalizers only.",
      recommendedNextAction: "Update payload parsing.",
      blocksCertification: true,
      redactedCommandOutput: output
    }]
  };
}

function createDecision(): OpenClawUpdateDecision {
  return {
    version: "2026.7.0",
    status: "candidate",
    allowed: false,
    defaultVisible: true,
    requiresExplicitOptIn: true,
    requiresAgentOsUpdate: false,
    minRequiredAgentOsVersion: null,
    reason: "Preview validation in progress.",
    notes: null
  };
}
