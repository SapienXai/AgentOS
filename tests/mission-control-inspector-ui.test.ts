import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveInspectorSummaryAction,
  resolveInspectorSurfaceTone
} from "@/components/mission-control/inspector-visuals";

test("inspector visual tones provide distinct light and dark compact surfaces", () => {
  const light = resolveInspectorSurfaceTone("light");
  const dark = resolveInspectorSurfaceTone("dark");

  assert.match(light.shell, /255,253,251/);
  assert.match(light.title, /#30251f/);
  assert.match(light.primaryButton, /text-\[#fffaf4\]/);
  assert.doesNotMatch(light.primaryButton, /text-white/);
  assert.match(dark.shell, /7,14,25/);
  assert.match(dark.title, /text-white/);
});

test("inspector summary actions preserve task status priority", () => {
  assert.equal(resolveInspectorSummaryAction({ entity: "task", status: "running" }), "steer-task");
  assert.equal(resolveInspectorSummaryAction({ entity: "task", status: "completed", needsReview: true }), "review-result");
  assert.equal(resolveInspectorSummaryAction({ entity: "task", status: "completed" }), "view-result");
  assert.equal(resolveInspectorSummaryAction({ entity: "agent" }), "open-chat");
  assert.equal(resolveInspectorSummaryAction({ entity: "runtime" }), "view-activity");
});
