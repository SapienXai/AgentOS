import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AGENT_NODE_ATTENTION_CLASSES,
  AGENT_NODE_CREATION_PULSE_CLASSES,
  AGENT_NODE_SELECTED_CLASSES,
  FRESH_NODE_BADGE_CLASSES,
  RUNTIME_NODE_SELECTED_CLASSES,
  resolveAgentStatusBadgeVariant,
  resolveAgentStatusDotTone,
  resolveRuntimeNodeBadgeVariant,
  resolveRuntimeNodeShellTone,
  resolveRuntimeNodeShellToneKey,
  resolveRuntimeNodeStatusDotTone,
  resolveRuntimeNodeTokenTone,
  resolveSurfaceRoleDotClasses,
  resolveTaskNodeBadgeVariant,
  resolveTaskNodeTokenTone,
  resolveTaskNodeToneKey,
  resolveTaskNodeVisualTone,
  resolveWorkspaceHealthBadgeClasses
} from "@/components/mission-control/node-visual-tones";
import {
  resolveDiagnosticHealthBadgeClasses,
  resolveDiagnosticHealthDotClasses,
  resolveGatewayModeBadgeClasses
} from "@/components/mission-control/surface-visual-tones";

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

test("runtime node shell tone resolver preserves state precedence and selected styling", () => {
  assert.equal(
    resolveRuntimeNodeShellToneKey({ isPendingCreation: true, isJustCreated: true, status: "cancelled" }),
    "pendingCreation"
  );
  assert.equal(
    resolveRuntimeNodeShellToneKey({ isJustCreated: true, status: "cancelled" }),
    "fresh"
  );
  assert.equal(resolveRuntimeNodeShellToneKey({ status: "cancelled" }), "cancelled");
  assert.equal(resolveRuntimeNodeShellToneKey({ status: "completed" }), "completed");
  assert.equal(resolveRuntimeNodeShellToneKey({ status: "idle" }), "default");

  const selectedTone = resolveRuntimeNodeShellTone({ selected: true, status: "idle" });

  assert.equal(selectedTone.selected, RUNTIME_NODE_SELECTED_CLASSES);
  assert.equal(selectedTone.state, "");
  assert.match(resolveRuntimeNodeShellTone({ isPendingCreation: true, status: "idle" }).state, /border-cyan-300\/30/);
  assert.match(resolveRuntimeNodeShellTone({ isJustCreated: true, status: "idle" }).state, /border-cyan-200\/40/);
  assert.match(resolveRuntimeNodeShellTone({ status: "cancelled" }).state, /border-rose-300\/30/);
  assert.match(resolveRuntimeNodeShellTone({ status: "completed" }).state, /opacity-\[0\.86\]/);
});

test("agent status resolvers preserve status dot and badge styling", () => {
  assert.equal(resolveAgentStatusDotTone("engaged"), "bg-cyan-300");
  assert.equal(resolveAgentStatusDotTone("monitoring"), "bg-emerald-300");
  assert.equal(resolveAgentStatusDotTone("ready"), "bg-amber-200");
  assert.equal(resolveAgentStatusDotTone("offline"), "bg-rose-300");
  assert.equal(resolveAgentStatusDotTone("standby"), "bg-slate-500");

  assert.equal(resolveAgentStatusBadgeVariant("engaged"), "default");
  assert.equal(resolveAgentStatusBadgeVariant("monitoring"), "success");
  assert.equal(resolveAgentStatusBadgeVariant("ready"), "warning");
  assert.equal(resolveAgentStatusBadgeVariant("offline"), "danger");
  assert.equal(resolveAgentStatusBadgeVariant("standby"), "muted");

  assert.match(AGENT_NODE_SELECTED_CLASSES, /border-cyan-300/);
  assert.match(AGENT_NODE_CREATION_PULSE_CLASSES, /border-cyan-200\/50/);
  assert.match(AGENT_NODE_ATTENTION_CLASSES, /border-cyan-200\/\[0\.54\]/);
});

test("workspace and surface role resolvers preserve existing node styling", () => {
  assert.equal(resolveWorkspaceHealthBadgeClasses("engaged"), "border-cyan-300/30 bg-cyan-300/14 text-cyan-50");
  assert.equal(resolveWorkspaceHealthBadgeClasses("monitoring"), "border-emerald-300/30 bg-emerald-300/14 text-emerald-50");
  assert.equal(resolveWorkspaceHealthBadgeClasses("ready"), "border-amber-300/30 bg-amber-300/14 text-amber-50");
  assert.equal(resolveWorkspaceHealthBadgeClasses("offline"), "border-rose-300/30 bg-rose-300/14 text-rose-50");
  assert.equal(resolveWorkspaceHealthBadgeClasses("standby"), "border-white/12 bg-white/[0.07] text-slate-100");

  assert.equal(resolveSurfaceRoleDotClasses("primary"), "bg-cyan-100 shadow-[0_0_12px_rgba(103,232,249,0.9)]");
  assert.equal(resolveSurfaceRoleDotClasses("owner"), "bg-emerald-100 shadow-[0_0_12px_rgba(52,211,153,0.9)]");
  assert.equal(resolveSurfaceRoleDotClasses("delegate"), "bg-amber-100 shadow-[0_0_12px_rgba(251,191,36,0.9)]");
  assert.equal(resolveSurfaceRoleDotClasses("mixed"), "bg-violet-100 shadow-[0_0_12px_rgba(196,181,253,0.9)]");
});

test("topbar surface tone resolvers preserve health and gateway theme styling", () => {
  assert.equal(resolveDiagnosticHealthDotClasses("healthy"), "bg-emerald-400");
  assert.equal(resolveDiagnosticHealthDotClasses("degraded"), "bg-amber-300");
  assert.equal(resolveDiagnosticHealthDotClasses("offline"), "bg-rose-300");

  assert.equal(
    resolveDiagnosticHealthBadgeClasses("healthy", "light"),
    "border-emerald-300/80 bg-emerald-50 text-emerald-700"
  );
  assert.equal(
    resolveDiagnosticHealthBadgeClasses("healthy", "dark"),
    "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
  );
  assert.equal(
    resolveDiagnosticHealthBadgeClasses("degraded", "light"),
    "border-amber-300/90 bg-amber-50 text-amber-700"
  );
  assert.equal(
    resolveDiagnosticHealthBadgeClasses("offline", "dark"),
    "border-rose-300/25 bg-rose-300/10 text-rose-200"
  );

  assert.equal(
    resolveGatewayModeBadgeClasses("success", "light"),
    "border-emerald-300/80 bg-emerald-50 text-emerald-700"
  );
  assert.equal(
    resolveGatewayModeBadgeClasses("danger", "dark"),
    "border-rose-300/25 bg-rose-300/10 text-rose-200"
  );
  assert.equal(
    resolveGatewayModeBadgeClasses("warning", "light"),
    "border-amber-300/80 bg-amber-50 text-amber-700"
  );
  assert.equal(
    resolveGatewayModeBadgeClasses("neutral", "dark"),
    "border-white/12 bg-white/[0.08] text-slate-300"
  );
});
