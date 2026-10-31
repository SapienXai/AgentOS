import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { matchesUpdateAttempt, mergeUpdateProgress, parseUpdateAttempt } from "@/lib/openclaw/update-progress";
import type { OpenClawUpdateProgress } from "@/lib/openclaw/application/update-progress-service";

const attempt = {startedAtMs: 10_000, targetVersion: "2026.10.9", beforeVersion: "2026.10.6", previousRunIds: ["previous"]};
const progress = {observedAt: "2026-10-30T10:00:00.000Z", connected: true, currentVersion: "2026.10.6", run: {runId: "current", createdAtMs: 11_000, updatedAtMs: 12_000, status: "running", phase: "activating", targetVersion: "2026.10.9"}, verification: {status: "unknown", message: "Waiting", connectionGeneration: 1}} as OpenClawUpdateProgress;

test("a Gateway outage retains the native run and phase without pretending it completed", () => {
  const next = mergeUpdateProgress(progress, {...progress, observedAt: "2026-10-30T10:00:02.000Z", connected: false, currentVersion: null, run: null});
  assert.equal(next.connected, false);
  assert.equal(next.run?.runId, "current");
  assert.equal(next.run?.phase, "activating");
  assert.equal(next.currentVersion, "2026.10.6");
  assert.equal(next.verification.status, "unknown");
  assert.equal(matchesUpdateAttempt(next.run, attempt), true);
});

test("late snapshots cannot rewind progress or replace a newer phase", () => {
  assert.equal(mergeUpdateProgress(progress, {...progress, observedAt: "2026-10-30T09:59:59.000Z", run: null}), progress);
  const next = mergeUpdateProgress(progress, {...progress, observedAt: "2026-10-30T10:00:02.000Z", run: {...progress.run!, updatedAtMs: 11_000, phase: "requested"}});
  assert.equal(next.run?.phase, "activating");
});

test("reload correlation rejects previous and unrelated runs and follows the bound run ID", () => {
  assert.equal(matchesUpdateAttempt(progress.run, attempt), true);
  assert.equal(matchesUpdateAttempt({...progress.run!, runId: "previous"}, attempt), false);
  assert.equal(matchesUpdateAttempt({...progress.run!, targetVersion: "2026.10.8"}, attempt), false);
  assert.equal(matchesUpdateAttempt({...progress.run!, createdAtMs: 1}, attempt), false);
  assert.equal(matchesUpdateAttempt(progress.run, {...attempt, runId: "current"}), true);
  assert.equal(matchesUpdateAttempt({...progress.run!, runId: "unrelated"}, {...attempt, runId: "current"}), false);
});

test("persisted tracking metadata expires and malformed values never hydrate", () => {
  assert.deepEqual(parseUpdateAttempt(JSON.stringify(attempt), 11_000), attempt);
  for (const value of ["invalid", "null", JSON.stringify({...attempt, startedAtMs: 12_000}), JSON.stringify({...attempt, beforeVersion: {secret: "x"}}), JSON.stringify({...attempt, previousRunIds: [null]})]) {
    assert.equal(parseUpdateAttempt(value, 11_000), null);
  }
  assert.equal(parseUpdateAttempt(JSON.stringify(attempt), 90_000_000), null);
});

test("progress stream retains authenticated read access and has no mutation admission", () => {
  const route = readFileSync("app/api/openclaw/update-progress/route.ts", "utf8");
  assert.match(route, /requireAgentOsProductPermission\(request, "runtime.use"\)/);
  assert.match(route, /current.actor.actorId !== permission.actor.actorId/);
  assert.match(route, /request.signal.removeEventListener/);
  assert.match(route, /cancel\(\) \{ cleanup\(\); \}/);
  assert.match(route, /redactSecrets/);
  assert.doesNotMatch(route, /executeNativeDoctorMutation|runNativeUpdate|update\.run"/);
});
