import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeWorkspaceCreationProfile, resolveWorkspaceCreationPolicy, WORKSPACE_CREATION_FILES } from "@/lib/agentos/domains/workspace-creation-policy";
import { createDeterministicWorkspaceComposition, composeWorkspaceComposition } from "@/lib/agentos/application/workspace-composer";
import { generateWorkspaceBlueprint } from "@/lib/agentos/application/workspace-architect";
import { validateWorkspaceCompositionPlan } from "@/lib/agentos/domains/workspace-composition";
import { buildWorkspaceScaffoldDocumentPaths } from "@/lib/openclaw/workspace-docs";
import { presentWorkspaceCreationDisplay } from "@/lib/agentos/ui/workspace-creation-display";
import { createInitialWorkspaceCreationSnapshot, type WorkspaceCreationRun } from "@/lib/agentos/domains/workspace-creation-run";

test("creation depth defaults and legacy mappings are deterministic", () => {
  assert.equal(normalizeWorkspaceCreationProfile(undefined), "fast");
  assert.equal(normalizeWorkspaceCreationProfile("quick"), "fast");
  assert.equal(normalizeWorkspaceCreationProfile("deep"), "high");
  assert.equal(normalizeWorkspaceCreationProfile("medium"), "medium");
  assert.throws(() => normalizeWorkspaceCreationProfile("maximum"));
  assert.ok(resolveWorkspaceCreationPolicy("medium").budget.overallAnalysisBudgetMs > resolveWorkspaceCreationPolicy("fast").budget.overallAnalysisBudgetMs);
  assert.ok(resolveWorkspaceCreationPolicy("medium").budget.overallAnalysisBudgetMs < resolveWorkspaceCreationPolicy("high").budget.overallAnalysisBudgetMs);
});

test("each depth materializes exactly its required intelligence; legacy plans retain old paths", async () => {
  const { blueprint } = await generateWorkspaceBlueprint({ brief: "Build a useful project workspace", materialization: { mode: "empty" } }, {
    modelExecutor: async () => ({ text: JSON.stringify({ workforce: { specialists: [] } }), runtime: "model-runtime" })
  });
  const fingerprints = new Set<string>();
  for (const profile of ["fast", "medium", "high"] as const) {
    const input = { profile, blueprint, operatorIntent: { brief: blueprint.brief, constraints: ["Prefer concise updates"] } };
    const { plan } = createDeterministicWorkspaceComposition(input);
    assert.equal(validateWorkspaceCompositionPlan(plan), true);
    assert.deepEqual(plan.artifacts.map((item) => item.path).sort(), [...WORKSPACE_CREATION_FILES[profile]].sort());
    assert.ok(plan.artifacts.every((item) => !/BOOTSTRAP|TOOLS|memory\//.test(item.path)));
    fingerprints.add(plan.inputFingerprint);
    // Sparse model output must not omit required artifacts or add higher-depth files.
    const composed = await composeWorkspaceComposition(input, { modelExecutor: async () => ({
      text: JSON.stringify({ schemaVersion: 1, policyVersion: "phase7-safe-workspace-composition-v1", artifacts: [], warnings: [] }),
      runtime: "model-runtime", runId: null, sessionKey: null
    }) });
    assert.deepEqual(composed.plan.artifacts.map((item) => item.path).sort(), [...WORKSPACE_CREATION_FILES[profile]].sort());
  }
  assert.equal(fingerprints.size, 3);
  const legacy = createDeterministicWorkspaceComposition({ blueprint, operatorIntent: { brief: blueprint.brief, constraints: [] } });
  assert.ok(legacy.plan.artifacts.some((item) => item.path === "docs/project-profile.md"));
});

test("composition-owned scaffold does not generate unrelated starter or memory documents", () => {
  const files = buildWorkspaceScaffoldDocumentPaths("frontend", { workspaceOnly: true, generateStarterDocs: true, generateMemory: true, kickoffMission: false, compositionManaged: true });
  assert.deepEqual(files, ["AGENTS.md", "SOUL.md", "IDENTITY.md"]);
});

test("display projection never forwards internal activity text and only claims completed artifacts", () => {
  const run = {
    input: { profile: "fast", sources: [] }, events: [],
    snapshot: { ...createInitialWorkspaceCreationSnapshot(0), stage: "architect-reasoning" }
  } as unknown as WorkspaceCreationRun;
  const preparing = presentWorkspaceCreationDisplay(run, { state: "applying-composition", steps: [{ id: "applying-composition", status: "active" }] });
  assert.equal(preparing.events.length, 0);
  assert.doesNotMatch(preparing.activity, /architect|composition|model|token|attempt/i);
  const finished = presentWorkspaceCreationDisplay(run, { state: "ready", steps: [{ id: "applying-composition", status: "complete" }] });
  assert.deepEqual(finished.events.map((item) => item.label), ["Identity", "Instructions", "Workspace"]);
  assert.equal(new Set(finished.events.map((item) => item.label)).size, finished.events.length);
  assert.ok(finished.events.every((item) => item.label.split(/\s+/).length <= 3));
});
