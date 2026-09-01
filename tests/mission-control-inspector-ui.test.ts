import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveInspectorSummaryAction,
  resolveInspectorSurfaceTone
} from "@/components/mission-control/inspector-visuals";
import {
  clampInspectorWidth,
  inspectorDetailWidth,
  isInspectorDetailWidth
} from "@/components/mission-control/inspector-resize";

test("inspector visual tones provide distinct light and dark compact surfaces", () => {
  const light = resolveInspectorSurfaceTone("light");
  const dark = resolveInspectorSurfaceTone("dark");

  assert.match(light.shell, /bg-\[#fbf7f3\]/);
  assert.match(light.content, /bg-\[#fffdfa\]/);
  assert.match(light.title, /#30251f/);
  assert.match(light.primaryButton, /text-\[#fffaf4\]/);
  assert.doesNotMatch(light.primaryButton, /text-white/);
  assert.match(dark.shell, /7,14,25/);
  assert.match(dark.title, /text-white/);
  assert.notEqual(light.shell, dark.shell);
  assert.notEqual(light.title, dark.title);
});

test("inspector summary actions preserve task status priority", () => {
  assert.equal(resolveInspectorSummaryAction({ entity: "task", status: "running" }), "steer-task");
  assert.equal(resolveInspectorSummaryAction({ entity: "task", status: "completed", needsReview: true }), "review-result");
  assert.equal(resolveInspectorSummaryAction({ entity: "task", status: "completed" }), "view-result");
  assert.equal(resolveInspectorSummaryAction({ entity: "agent" }), "open-chat");
  assert.equal(resolveInspectorSummaryAction({ entity: "runtime" }), "view-activity");
});

test("inspector width stays within the usable canvas range", () => {
  assert.equal(clampInspectorWidth(120, 1440), 340);
  assert.equal(clampInspectorWidth(1000, 1440), 720);
  assert.equal(clampInspectorWidth(520, 1440), inspectorDetailWidth);
  assert.equal(clampInspectorWidth(720, 420), 340);
  assert.equal(isInspectorDetailWidth(459), false);
  assert.equal(isInspectorDetailWidth(460), true);
});
