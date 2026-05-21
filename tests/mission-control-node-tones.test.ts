import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FRESH_NODE_BADGE_CLASSES,
  resolveRuntimeNodeBadgeVariant,
  resolveRuntimeNodeStatusDotTone,
  resolveRuntimeNodeTokenTone,
  resolveTaskNodeBadgeVariant,
  resolveTaskNodeTokenTone,
  resolveTaskNodeToneKey,
  resolveTaskNodeVisualTone
} from "@/components/mission-control/node-visual-tones";

test("task node tone resolver maps aborted tasks to the danger tone", () => {
  const input = { isAborted: true, status: "running" as const };
  const tone = resolveTaskNodeVisualTone(input);

  assert.equal(resolveTaskNodeToneKey(input), "aborted");
  assert.equal(tone.key, "aborted");
  assert.equal(tone.dot, "bg-rose-300");
  assert.equal(tone.resultBorder, "border-rose-300/20");
  assert.equal(resolveTaskNodeBadgeVariant(input), "danger");
  assert.equal(resolveTaskNodeTokenTone(input), "text-rose-200");
});

test("task node tone resolver maps completed tasks needing review to the warning tone", () => {
  const input = { completedNeedsReview: true, status: "completed" as const };
  const tone = resolveTaskNodeVisualTone(input);

  assert.equal(tone.key, "review");
  assert.equal(tone.dot, "bg-amber-300");
  assert.match(tone.outer, /border-amber-300/);
  assert.equal(resolveTaskNodeBadgeVariant(input), "warning");
  assert.equal(resolveTaskNodeTokenTone(input), "text-amber-200");
});

test("task node tone resolver maps live task states to the live tone", () => {
  const liveInputs = [
    { status: "running" as const },
    { status: "queued" as const },
    { isPendingCreation: true, status: "idle" as const }
  ];

  for (const input of liveInputs) {
    const tone = resolveTaskNodeVisualTone(input);

    assert.equal(tone.key, "live");
    assert.equal(tone.dot, "bg-cyan-300");
    assert.equal(tone.resultBorder, "border-cyan-300/[0.22]");
  }

  assert.equal(resolveTaskNodeBadgeVariant(liveInputs[2]), "warning");
});

test("task node tone resolver maps completed and accepted states to success", () => {
  const completedInput = { status: "completed" as const };
  const acceptedInput = { status: "idle" as const, visibleReviewStatus: "accepted" as const };

  assert.equal(resolveTaskNodeVisualTone(completedInput).key, "success");
  assert.equal(resolveTaskNodeVisualTone(acceptedInput).key, "success");
  assert.equal(resolveTaskNodeBadgeVariant(acceptedInput), "success");
  assert.equal(resolveTaskNodeTokenTone(acceptedInput), "text-emerald-200");
});

test("task node tone resolver maps just-created fallback tasks to the fresh tone", () => {
  const input = { isJustCreated: true, status: "idle" as const };
  const tone = resolveTaskNodeVisualTone(input);

  assert.equal(tone.key, "fresh");
  assert.equal(tone.dot, "bg-sky-300");
  assert.equal(FRESH_NODE_BADGE_CLASSES, "gap-1 border-cyan-100/20 bg-cyan-100/12 text-cyan-50");
});

test("task node tone resolver maps unspecified task states to the default tone", () => {
  const input = { status: "idle" as const };
  const tone = resolveTaskNodeVisualTone(input);

  assert.equal(tone.key, "default");
  assert.equal(tone.dot, "bg-slate-400");
  assert.equal(resolveTaskNodeBadgeVariant(input), "muted");
  assert.equal(resolveTaskNodeTokenTone(input), "text-slate-400");
});

test("task node tone resolver is deterministic", () => {
  const input = { status: "queued" as const };

  assert.equal(resolveTaskNodeToneKey(input), resolveTaskNodeToneKey(input));
  assert.strictEqual(resolveTaskNodeVisualTone(input), resolveTaskNodeVisualTone(input));
});

test("runtime node status dot resolver keeps existing runtime tones", () => {
  assert.equal(resolveRuntimeNodeStatusDotTone({ isPendingCreation: true, status: "idle" }), "bg-cyan-300");
  assert.equal(resolveRuntimeNodeStatusDotTone({ status: "running" }), "bg-cyan-300");
  assert.equal(resolveRuntimeNodeStatusDotTone({ status: "queued" }), "bg-amber-200");
  assert.equal(resolveRuntimeNodeStatusDotTone({ status: "completed" }), "bg-emerald-300");
  assert.equal(resolveRuntimeNodeStatusDotTone({ status: "cancelled" }), "bg-rose-300");
});

test("runtime node badge and token tone resolvers keep existing runtime status styling", () => {
  assert.equal(resolveRuntimeNodeBadgeVariant({ isPendingCreation: true, status: "idle" }), "warning");
  assert.equal(resolveRuntimeNodeBadgeVariant({ status: "completed" }), "success");
  assert.equal(resolveRuntimeNodeBadgeVariant({ status: "queued" }), "muted");
  assert.equal(resolveRuntimeNodeTokenTone({ status: "running" }), "text-cyan-300");
});
