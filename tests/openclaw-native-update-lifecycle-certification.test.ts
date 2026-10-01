import assert from "node:assert/strict";
import { test } from "node:test";

import { assessOpenClawCertificationArtifact } from "@/scripts/openclaw-current-final-certification";
import {
  OPENCLAW_CERTIFICATION_TARGET_AGENT_SCHEMA,
  OPENCLAW_CERTIFICATION_TARGET_BUILD,
  OPENCLAW_CERTIFICATION_TARGET_COMMIT,
  OPENCLAW_CERTIFICATION_TARGET_STATE_SCHEMA,
  OPENCLAW_CERTIFICATION_TARGET_VERSION
} from "@/lib/openclaw/certification-target";
import { OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL } from "@/lib/openclaw/identity/contract";
import { OPENCLAW_SUPPORTED_BASELINE_VERSION } from "@/lib/openclaw/versions";

const TARGET_VERSION = OPENCLAW_CERTIFICATION_TARGET_VERSION;

function validArtifact() {
  return {
    artifactType: `openclaw-${TARGET_VERSION}-native-update-lifecycle-certification`,
    success: true,
    target: {
      version: TARGET_VERSION,
      sourceCommit: OPENCLAW_CERTIFICATION_TARGET_COMMIT,
      buildId: OPENCLAW_CERTIFICATION_TARGET_BUILD,
      gatewayProtocol: OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL,
      stateSchema: OPENCLAW_CERTIFICATION_TARGET_STATE_SCHEMA,
      agentSchema: OPENCLAW_CERTIFICATION_TARGET_AGENT_SCHEMA
    },
    update: {
      mutationOwner: "OpenClaw native updater",
      agentOsInvokedUpdateMutation: false,
      nativeCliRun: { status: "succeeded", target: TARGET_VERSION, after: TARGET_VERSION, recoveryVersion: TARGET_VERSION },
      restart: { gatewayFreshlyReconnected: true }
    },
    runtime: {
      health: "PASS",
      installedVersion: TARGET_VERSION,
      updateStatus: "current",
      activeUpdateRun: false,
      configuration: "valid"
    },
    checks: { exactTargetPackage: true, nativePackageUpdateCompleted: true }
  };
}

test("final certification requires OpenClaw-owned update execution and fresh post-restart truth", () => {
  assert.equal(assessOpenClawCertificationArtifact("native-update", validArtifact()).status, "PASS");
  const agentOsUpdater = validArtifact();
  agentOsUpdater.update.agentOsInvokedUpdateMutation = true;
  assert.equal(assessOpenClawCertificationArtifact("native-update", agentOsUpdater).status, "FAIL");
  const staleRuntime = validArtifact();
  staleRuntime.runtime.installedVersion = OPENCLAW_SUPPORTED_BASELINE_VERSION;
  assert.equal(assessOpenClawCertificationArtifact("native-update", staleRuntime).status, "FAIL");
});
