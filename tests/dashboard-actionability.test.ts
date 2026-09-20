import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildTaskViews } from "@/components/operations/operations-data";

test("task warnings remain warnings instead of becoming approvals", () => {
  const [task] = buildTaskViews({
    generatedAt: "2026-09-21T00:00:00.000Z",
    tasks: [{
      id: "task-warning",
      key: "task-warning",
      title: "Degraded monitor",
      mission: "Review runtime health",
      subtitle: "OpenClaw reported a warning.",
      status: "queued",
      updatedAt: Date.parse("2026-09-21T00:00:00.000Z"),
      ageMs: 0,
      primaryAgentId: "agent-1",
      primaryAgentName: "Monitor",
      runtimeIds: [],
      agentIds: ["agent-1"],
      sessionIds: [],
      runIds: [],
      runtimeCount: 0,
      updateCount: 0,
      liveRunCount: 0,
      artifactCount: 0,
      warningCount: 1,
      metadata: {}
    }]
  } as never);

  assert.equal(task?.status, "queued");
  assert.equal(task?.statusLabel, "Warning");
  assert.equal(task?.statusTone, "warning");
});

test("dashboard exposes real destinations for queue, runtime checks, and diagnostics", async () => {
  const source = await readFile("components/operations/dashboard/dashboard-page-content.tsx", "utf8");

  assert.match(source, /prefetch/);
  assert.match(source, /onSummaryChange/);
  assert.match(source, /Recheck native Gateway/);
  assert.match(source, /Refresh now/);
  assert.match(source, /Inspect diagnostics/);
  assert.match(source, /href=\"\/tasks\"/);
});
