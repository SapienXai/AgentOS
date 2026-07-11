import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOpenClawCronAddParams,
  normalizeOpenClawOperationJob,
  normalizeOpenClawOperationRuns
} from "@/lib/agentos/application/operations-service";
import { buildOperationTaskProjections, mergeOperationTaskProjections } from "@/lib/openclaw/domains/operation-task-projection";

test("operations maps timezone-aware cron definitions to documented Gateway fields", () => {
  const params = buildOpenClawCronAddParams({
    name: "DST-safe brief", agentId: "ops", workspaceId: "workspace-a", prompt: "Report status.",
    trigger: { kind: "cron", expression: "0 9 * * 1-5", timezone: "America/New_York" }, safety: { concurrency: "forbid" }
  });
  assert.deepEqual(params.schedule, { kind: "cron", expr: "0 9 * * 1-5", tz: "America/New_York" });
  assert.equal((params.payload as { kind: string }).kind, "agentTurn");
  assert.equal(params.sessionTarget, "isolated");
});

test("operations keeps a one-shot job visible after success", () => {
  const params = buildOpenClawCronAddParams({
    name: "One time", agentId: "ops", workspaceId: "workspace-a", prompt: "Run once.",
    trigger: { kind: "at", at: "2026-11-01T14:00:00.000Z" }
  });
  assert.equal(params.deleteAfterRun, false);
  assert.deepEqual(params.schedule, { kind: "at", at: "2026-11-01T14:00:00.000Z" });
});

test("operations projects runtime job state without becoming a scheduler", () => {
  const job = normalizeOpenClawOperationJob({
    jobId: "job-1", name: "Nightly", enabled: true, status: "running", agentId: "ops",
    schedule: { kind: "every", everyMs: 60_000 }, state: { runningAtMs: 1_700_000_000_000 }, payload: { message: "check" }
  }, {}, true, true);
  assert.equal(job.status, "running");
  assert.equal(job.trigger?.kind, "every");
  assert.equal(job.capabilities.mutable, true);
});

test("recurring jobs remain scheduled after an individual run succeeds", () => {
  const job = normalizeOpenClawOperationJob({
    jobId: "job-recurring", name: "Recurring", enabled: true, status: "ok", agentId: "ops",
    schedule: { kind: "every", everyMs: 60_000 }, state: { lastRunStatus: "ok" }, payload: { message: "check" }
  }, {}, true, true);
  assert.equal(job.status, "scheduled");
});

test("operations normalizes retry, error, and recovery evidence from cron.runs", () => {
  const runs = normalizeOpenClawOperationRuns({ runs: [
    { runId: "run-error", status: "error", startedAtMs: 1_700_000_000_000, endedAtMs: 1_700_000_030_000, error: "network timeout" },
    { runId: "run-ok", status: "ok", startedAtMs: 1_700_000_040_000, endedAtMs: 1_700_000_050_000, summary: "Recovered" }
  ] }, "job-1");
  assert.equal(runs[0].status, "error");
  assert.equal(runs[0].durationMs, 30_000);
  assert.equal(runs[1].output, "Recovered");
});

test("scheduled OpenClaw jobs become read-only task cards with a visible cadence", () => {
  const tasks = buildOperationTaskProjections({
    generatedAt: "2026-07-11T00:00:00.000Z", source: "openclaw.cron", scheduler: { enabled: true, nextWakeAt: null, state: "available" }, runs: [], audit: [], notices: [],
    jobs: [{ id: "job-1", name: "Morning brief", description: null, enabled: true, status: "scheduled", agentId: "ops", workspaceId: "workspace-a", prompt: "Brief", model: null, thinking: null, trigger: { kind: "cron", expression: "0 9 * * 1-5", timezone: "Europe/Istanbul" }, nextRunAt: "2026-07-13T06:00:00.000Z", lastRunAt: null, lastRunStatus: null, safety: null, health: { consecutiveFailures: 0, successRate: null, degraded: false }, capabilities: { readable: true, mutable: true, runHistory: true, reason: null } }]
  }, [{ id: "ops", name: "Ops", workspaceId: "workspace-a" } as never]);
  assert.equal(tasks[0].metadata.source, "openclaw-cron");
  assert.equal(tasks[0].metadata.cronExpression, "0 9 * * 1-5");
  assert.match(String(tasks[0].metadata.scheduleLabel), /Europe\/Istanbul/);
});

test("completed operations expose the Gateway transcript result on their task card", () => {
  const [task] = buildOperationTaskProjections({
    generatedAt: "2026-07-11T00:00:00.000Z", source: "openclaw.cron", scheduler: { enabled: true, nextWakeAt: null, state: "available" }, runs: [], audit: [], notices: [],
    jobs: [{ id: "job-result", name: "Rate", description: null, enabled: false, status: "completed", agentId: "ops", workspaceId: "workspace-a", prompt: "Rate", model: null, thinking: null, trigger: { kind: "at", at: "2026-07-11T00:00:00.000Z" }, nextRunAt: null, lastRunAt: "2026-07-11T00:01:00.000Z", lastRunStatus: "ok", latestOutput: "1 GBP is 62.99 TRY", recentResults: [{ id: "answer-1", timestamp: "2026-07-11T00:01:00.000Z", text: "1 GBP is 62.99 TRY" }], sessionKey: "agent:ops:cron:job-result", sessionId: "session-1", safety: null, health: { consecutiveFailures: 0, successRate: 1, degraded: false }, capabilities: { readable: true, mutable: true, runHistory: true, reason: null } }]
  }, [{ id: "ops", name: "Ops", workspaceId: "workspace-a" } as never]);
  assert.equal(task.metadata.resultPreview, "1 GBP is 62.99 TRY");
  assert.equal(task.metadata.openClawSessionKey, "agent:ops:cron:job-result");
  assert.deepEqual(task.metadata.operationFeed, [{ id: "operation:job-result:answer-1", kind: "assistant", timestamp: "2026-07-11T00:01:00.000Z", title: "Scheduled result", detail: "1 GBP is 62.99 TRY" }]);
});

test("operation task cards retain Gateway run failure evidence for their timeline", () => {
  const [task] = buildOperationTaskProjections({
    generatedAt: "2026-07-11T00:00:00.000Z", source: "openclaw.cron", scheduler: { enabled: true, nextWakeAt: null, state: "available" }, audit: [], notices: [],
    jobs: [{ id: "job-error", name: "Check", description: null, enabled: true, status: "failed", agentId: "ops", workspaceId: "workspace-a", prompt: "Check", model: null, thinking: null, trigger: { kind: "every", everyMs: 60_000 }, nextRunAt: "2026-07-11T00:02:00.000Z", lastRunAt: "2026-07-11T00:01:00.000Z", lastRunStatus: "error", safety: null, health: { consecutiveFailures: 1, successRate: 0, degraded: true }, capabilities: { readable: true, mutable: true, runHistory: true, reason: null } }],
    runs: [{ id: "run-error", jobId: "job-error", status: "error", startedAt: "2026-07-11T00:00:55.000Z", endedAt: "2026-07-11T00:01:00.000Z", durationMs: 5_000, sessionId: null, output: null, error: "provider timeout", tokens: null, cost: null, artifacts: [] }]
  }, [{ id: "ops", name: "Ops", workspaceId: "workspace-a" } as never]);
  assert.deepEqual(task.metadata.operationRunHistory, [{ id: "run-error", timestamp: "2026-07-11T00:01:00.000Z", status: "error", output: null, error: "provider timeout", durationMs: 5_000 }]);
});

test("a cron runtime and its schedule projection reconcile into one terminal task card", () => {
  const snapshot = {
    generatedAt: "2026-07-11T00:00:00.000Z", source: "openclaw.cron" as const, scheduler: { enabled: true, nextWakeAt: null, state: "available" as const }, audit: [], notices: [],
    jobs: [{ id: "job-1", name: "Exchange rate", description: null, enabled: true, status: "failed" as const, agentId: "ops", workspaceId: "workspace-a", prompt: "Rate", model: null, thinking: null, trigger: { kind: "at" as const, at: "2026-07-11T00:00:00.000Z" }, nextRunAt: null, lastRunAt: "2026-07-11T00:00:00.000Z", lastRunStatus: "error", safety: null, health: { consecutiveFailures: 1, successRate: 0, degraded: true }, capabilities: { readable: true, mutable: true, runHistory: true, reason: null } }],
    runs: [{ id: "cron:job-1:run", jobId: "job-1", status: "error" as const, startedAt: "2026-07-11T00:00:00.000Z", endedAt: "2026-07-11T00:00:03.000Z", durationMs: 3000, sessionId: null, output: null, error: "provider timeout", tokens: null, cost: null, artifacts: [] }]
  };
  const runtime = { id: "task:1", key: "task:1", title: "Exchange rate", mission: "Rate", subtitle: "running", status: "running" as const, updatedAt: null, ageMs: null, runtimeIds: [], agentIds: ["ops"], sessionIds: [], runIds: ["cron:job-1:run"], runtimeCount: 1, updateCount: 0, liveRunCount: 1, artifactCount: 0, warningCount: 0, metadata: { openClawRunId: "cron:job-1:run" } };
  const tasks = mergeOperationTaskProjections(snapshot, [runtime], [{ id: "ops", name: "Ops" } as never]);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].status, "stalled");
  assert.equal(tasks[0].metadata.operationJobId, "job-1");
  assert.match(tasks[0].subtitle, /provider timeout/);
});
