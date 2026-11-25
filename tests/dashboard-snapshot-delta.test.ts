import assert from "node:assert/strict";
import { test } from "node:test";

import type { ControlPlaneSnapshot } from "@/lib/agentos/contracts";
import { applyDashboardSnapshotDelta, buildDashboardSnapshotDelta } from "@/lib/agentos/dashboard-snapshot-delta";

test("dashboard patches retain runtime order, removals, and unchanged data", () => {
  const baseline = {
    revision: 2,
    generatedAt: "before",
    diagnostics: { capabilityMatrix: { longLabel: "capability ".repeat(200) }, version: "old", message: "remove" },
    runtimes: [
      { id: "removed", status: "idle" },
      { id: "changed", ageMs: 1, detail: "detail ".repeat(200), error: "remove" },
      { id: "same", title: "same" }
    ]
  } as unknown as ControlPlaneSnapshot;
  const next = {
    revision: 3,
    generatedAt: "after",
    diagnostics: { capabilityMatrix: baseline.diagnostics.capabilityMatrix, version: "new" },
    runtimes: [baseline.runtimes[2], { id: "added", status: "active" }, {
      id: "changed", ageMs: 2, detail: "detail ".repeat(200)
    }]
  } as unknown as ControlPlaneSnapshot;
  const delta = buildDashboardSnapshotDelta(baseline, next);
  assert.ok(delta?.diagnostics && delta.runtimes);
  assert.deepEqual(applyDashboardSnapshotDelta(baseline, JSON.parse(JSON.stringify(delta))), next);
  assert.equal(applyDashboardSnapshotDelta({ ...baseline, generatedAt: "elsewhere" }, delta), null);
  assert.equal(applyDashboardSnapshotDelta(baseline, delta)?.runtimes[0], baseline.runtimes[2]);
});
