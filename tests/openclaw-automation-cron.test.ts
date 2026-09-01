import assert from "node:assert/strict";
import test from "node:test";

import { buildOpenClawCronAddParams, normalizeOpenClawOperationRuns } from "@/lib/agentos/application/operations-service";
import { automationExecutionIdentityFromCron } from "@/lib/openclaw/domains/execution-identity";

test("native cron add parameters preserve AgentOS idempotency without custom legacy fields", () => {
  const params = buildOpenClawCronAddParams({
    name: "Hourly digest",
    agentId: "main",
    workspaceId: "workspace-a",
    prompt: "Summarize the workspace.",
    idempotencyKey: "planner-hourly",
    trigger: { kind: "every", everyMs: 3_600_000 },
    context: { sessionTarget: "isolated" }
  });

  assert.equal(params.declarationKey, "agentos:automation:planner-hourly");
  assert.deepEqual(params.schedule, { kind: "every", everyMs: 3_600_000 });
  assert.deepEqual(params.payload, {
    kind: "agentTurn",
    message: "Summarize the workspace.",
    model: undefined,
    thinking: undefined,
    lightContext: false
  });
  assert.equal(params.sessionTarget, "isolated");
});

test("cron run normalization preserves exact run/session identity and provenance", () => {
  const [run] = normalizeOpenClawOperationRuns({ entries: [{
    jobId: "job-1",
    runId: "run-1",
    status: "ok",
    completionStatus: "succeeded",
    sessionKey: "agent:main:cron:job-1:run:session-1",
    sessionId: "session-1",
    runAtMs: 1_700_000_000_000,
    ts: 1_700_000_001_000
  }] }, "job-1");

  assert.equal(run.id, "run-1");
  assert.equal(run.cronRunId, "run-1");
  assert.equal(run.sessionKey, "agent:main:cron:job-1:run:session-1");
  assert.equal(run.sessionId, "session-1");
  assert.equal(run.identityProvenance, "authoritative");
  assert.equal(run.sourceOfTruth, "openclaw.cron.runs");
  assert.equal(run.completionStatus, "succeeded");
});

test("automation execution identity never treats an AgentOS key as an OpenClaw run", () => {
  const identity = automationExecutionIdentityFromCron({
    automationId: "agentos:automation:one",
    cronJobId: "job-1",
    sessionKey: "agent:main:cron:job-1:run:session-1",
    sessionId: "session-1"
  });

  assert.equal(identity.automationId, "agentos:automation:one");
  assert.equal(identity.cronJobId, "job-1");
  assert.equal(identity.cronRunId, null);
  assert.equal(identity.runId, null);
  assert.equal(identity.sourceOfTruth, "openclaw.cron.job");
  assert.equal(identity.provenance, "correlated");
});
