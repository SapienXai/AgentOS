import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveOpenClawCertificationTargetSchemas } from "@/lib/openclaw/certification-target";

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
