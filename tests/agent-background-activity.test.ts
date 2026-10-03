import assert from "node:assert/strict";
import test from "node:test";
import { backgroundActivityNeedsAttention, backgroundActivityLabel } from "@/components/mission-control/agent-background-activity";
import type { WorkItemRecord } from "@/lib/agentos/contracts";

function monitor(overrides: Record<string, unknown> = {}) {
  return {status:"queued",metadata:{systemOwnedMonitor:"skill-collection-review",...overrides}} as unknown as WorkItemRecord;
}
test("quiet background schedules do not produce attention badges", () => {
  assert.equal(backgroundActivityNeedsAttention(monitor()), false);
  assert.equal(backgroundActivityNeedsAttention(monitor({lastRunStatus:"ok"})), false);
  assert.equal(backgroundActivityLabel(monitor()), "Skill Workshop");
  assert.equal(backgroundActivityLabel(monitor({systemOwnedMonitor:"heartbeat"})), "Heartbeat");
});
test("background errors and unreviewed results remain discoverable", () => {
  assert.equal(backgroundActivityNeedsAttention(monitor({lastRunStatus:"error"})), true);
  assert.equal(backgroundActivityNeedsAttention(monitor({resultPreview:"New skills available"})), true);
  assert.equal(backgroundActivityNeedsAttention({...monitor(),status:"stalled"}), true);
  assert.equal(backgroundActivityNeedsAttention(monitor({resultPreview:"   "})), false);
});
test("reviewed monitor results and user-authored jobs are not background alerts", () => {
  assert.equal(backgroundActivityNeedsAttention(monitor({resultPreview:"Reviewed",reviewStatus:"accepted"})), false);
  assert.equal(backgroundActivityNeedsAttention(monitor({systemOwnedMonitor:null,lastRunStatus:"error"})), false);
});
test("a new native run restores attention after a previous result was reviewed", () => {
  const task = monitor({ lastRunStatus: "error", reviewStatus: "accepted", reviewedAt: "2026-10-03T07:00:00Z" });
  task.updatedAt = Date.parse("2026-10-03T07:01:00Z");
  assert.equal(backgroundActivityNeedsAttention(task), true);
  task.updatedAt = Date.parse("2026-10-03T06:59:00Z");
  assert.equal(backgroundActivityNeedsAttention(task), false);
});
