import assert from "node:assert/strict";
import { test } from "node:test";

import {
  OPENCLAW_CERTIFICATION_TARGET_VERSION,
  resolveOpenClawCertificationTargetSchemas
} from "@/lib/openclaw/certification-target";
import { OPENCLAW_NATIVE_CONTRACT_VERSION, OPENCLAW_RECOMMENDED_VERSION } from "@/lib/openclaw/versions";

test("certification targets the candidate native contract before policy promotion", () => {
  assert.equal(OPENCLAW_CERTIFICATION_TARGET_VERSION, OPENCLAW_NATIVE_CONTRACT_VERSION);
  assert.equal(OPENCLAW_CERTIFICATION_TARGET_VERSION, "2026.10.6");
  assert.equal(OPENCLAW_RECOMMENDED_VERSION, "2026.9.7");
});

test("certification schemas come from the exact promoted identity", () => {
  assert.deepEqual(resolveOpenClawCertificationTargetSchemas({
    targetVersion: "2026.9.4",
    identityVersion: "2026.9.4",
    identityStateSchema: 17,
    identityAgentSchema: 19
  }), { stateSchema: 17, agentSchema: 19 });
});

test("candidate release schema identity is unknown until supplied from exact upstream evidence", () => {
  const unresolved = resolveOpenClawCertificationTargetSchemas({
    targetVersion: "2026.9.7",
    identityVersion: "2026.9.4",
    identityStateSchema: 17,
    identityAgentSchema: 19
  });
  assert.equal(Number.isNaN(unresolved.stateSchema), true);
  assert.equal(Number.isNaN(unresolved.agentSchema), true);

  assert.deepEqual(resolveOpenClawCertificationTargetSchemas({
    targetVersion: "2026.9.7",
    identityVersion: "2026.9.4",
    identityStateSchema: 17,
    identityAgentSchema: 19,
    candidateStateSchema: "19",
    candidateAgentSchema: "24"
  }), { stateSchema: 19, agentSchema: 24 });
});

test("malformed candidate schema values remain unresolved", () => {
  const result = resolveOpenClawCertificationTargetSchemas({
    targetVersion: "2026.9.7",
    identityVersion: "2026.9.4",
    identityStateSchema: 17,
    identityAgentSchema: 19,
    candidateStateSchema: "0",
    candidateAgentSchema: "unknown"
  });
  assert.equal(Number.isNaN(result.stateSchema), true);
  assert.equal(Number.isNaN(result.agentSchema), true);
});
