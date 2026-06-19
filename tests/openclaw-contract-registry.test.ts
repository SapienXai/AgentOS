import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { AGENTOS_OPENCLAW_CONTRACT } from "@/lib/openclaw/contracts/agentos-openclaw-contract";
import {
  buildAgentOsOpenClawContractComparison,
  filterAgentOsOpenClawContractRows
} from "@/lib/openclaw/contracts/contract-diff-service";
import { probeAgentOsOpenClawContract } from "@/lib/openclaw/contracts/contract-probe-service";
import type { GatewayDiagnostics } from "@/lib/openclaw/types";

test("AgentOS OpenClaw Contract Registry exposes baseline operations with ownership metadata", () => {
  const health = AGENTOS_OPENCLAW_CONTRACT.operations.find((operation) => operation.id === "health");
  const agentUpdate = AGENTOS_OPENCLAW_CONTRACT.operations.find((operation) => operation.id === "agentUpdate");

  assert.equal(AGENTOS_OPENCLAW_CONTRACT.schemaVersion, 1);
  assert.ok(AGENTOS_OPENCLAW_CONTRACT.certifiedOpenClawBaseline);
  assert.ok(AGENTOS_OPENCLAW_CONTRACT.operations.length > 10);
  assert.equal(health?.requirement, "required");
  assert.equal(health?.areaId, "gateway-protocol");
  assert.ok(health?.affectedAgentOsFiles.length);
  assert.ok(health?.regressionTests.length);
  assert.equal(agentUpdate?.cliFallbackAllowed, false);
  assert.equal(agentUpdate?.blocksCertification, true);
});

test("contract probe treats missing evidence as unknown instead of passing", () => {
  const result = probeAgentOsOpenClawContract({
    contract: AGENTOS_OPENCLAW_CONTRACT,
    diagnostics: null,
    targetVersion: "2026.6.8"
  });

  assert.equal(result.status, "unknown");
  assert.equal(result.summary.passed, 0);
  assert.ok(result.summary.unknown > 0);
});

test("contract comparison derives blocker rows from required operation results", () => {
  const diagnostics = createDiagnostics({
    operations: {
      health: {
        label: "Gateway health",
        mode: "disabled",
        methods: ["health", "status"],
        events: [],
        fallbackAllowed: false,
        baseline: "required",
        reason: "Gateway health methods are unavailable."
      }
    }
  });
  const comparison = buildAgentOsOpenClawContractComparison({
    diagnostics
  });
  const blockers = filterAgentOsOpenClawContractRows(comparison.rows, "blockers");

  assert.ok(comparison.summary.certificationBlockers > 0);
  assert.ok(blockers.some((row) => row.operationId === "health" && row.status === "failed"));
});

test("Capabilities page renders registry-backed contract comparison without direct OpenClaw calls", () => {
  const source = readFileSync(
    path.join(process.cwd(), "components/mission-control/settings-control-center.tsx"),
    "utf8"
  );

  assert.match(source, /Contract comparison/);
  assert.match(source, /buildAgentOsOpenClawContractComparison/);
  assert.match(source, /filterAgentOsOpenClawContractRows/);
  assert.match(source, /Baseline/);
  assert.match(source, /Installed/);
  assert.match(source, /Target/);
  assert.doesNotMatch(source, /getOpenClawAdapter|getOpenClawGatewayClient|new NativeWsOpenClawGatewayClient|openclaw gateway/);
});

function createDiagnostics(input: {
  operations: NonNullable<NonNullable<GatewayDiagnostics["capabilityMatrix"]>["operations"]>;
}): GatewayDiagnostics {
  return {
    version: "2026.6.8",
    updateCompatibility: {
      manifestSource: "local-fallback",
      agentOsVersion: "0.7.2",
      currentVersion: "2026.6.8",
      recommendedVersion: "2026.6.8",
      recommendedDecision: {
        version: "2026.6.8",
        status: "certified",
        allowed: true,
        defaultVisible: true,
        requiresExplicitOptIn: false,
        requiresAgentOsUpdate: false,
        minRequiredAgentOsVersion: "0.7.2",
        reason: "Certified baseline.",
        notes: null
      },
      latestDecision: null,
      certifiedVersions: [],
      candidateVersions: [],
      blockedVersions: [],
      unknownVersions: []
    },
    capabilityMatrix: {
      openClawVersion: "2026.6.8",
      recommendedVersion: "2026.6.8",
      protocolVersion: 4,
      gatewayProtocolVersion: 4,
      requestedProtocolRange: "4",
      authMode: "unknown",
      configSchema: "unknown",
      configPatch: "unknown",
      chatEvents: "unknown",
      cronRead: "unknown",
      channels: "unknown",
      skills: "unknown",
      approvals: "unknown",
      updates: "unknown",
      nativeMissionDispatch: "unknown",
      nativeAgentLifecycle: "unknown",
      eventBridge: "unknown",
      unsupportedGatewayMethods: [],
      diagnostics: [],
      operations: input.operations
    }
  } as unknown as GatewayDiagnostics;
}
