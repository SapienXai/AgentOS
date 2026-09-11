import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { composeWorkspaceComposition, applyWorkspaceCompositionPlan } from "@/lib/agentos/application/workspace-composer";
import { generateWorkspaceBlueprint } from "@/lib/agentos/application/workspace-architect";
import { WORKSPACE_COMPOSITION_MARKER_START, WORKSPACE_COMPOSITION_MARKER_END } from "@/lib/agentos/application/workspace-composer";
import { normalizeWorkspaceCompositionProposal, validateWorkspaceCompositionPlan } from "@/lib/agentos/domains/workspace-composition";
import { runStructuredProjectIntelligenceAgent, runStructuredWorkspaceComposerAgent } from "@/lib/openclaw/application/structured-agent-service";
import { buildPlannerRuntimeAgentId, PLANNER_RUNTIME_SYSTEM_TAG, PLANNER_RUNTIME_WORKSPACE_PATH, type PlannerRuntimeEnsureDependencies } from "@/lib/openclaw/application/planner-runtime-service";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type { WorkspaceProjectManifest } from "@/lib/openclaw/domains/workspace-manifest";

async function blueprint() {
  return (await generateWorkspaceBlueprint({ brief: "Build a generic workspace", materialization: { mode: "empty" } }, {
    runId: "composer-blueprint",
    modelExecutor: async () => ({ text: JSON.stringify({ workforce: { specialists: [] } }), runtime: "model-runtime" as const })
  })).blueprint;
}

test("composition proposals are content-only, allowlisted, and produce a deterministic plan", async () => {
  const value = await blueprint();
  const result = await composeWorkspaceComposition({
    blueprint: value,
    operatorIntent: { brief: value.brief, constraints: [] },
    existingFiles: []
  }, {
    runId: "composer-plan",
    modelExecutor: async () => ({
      text: JSON.stringify({
        schemaVersion: 1,
        policyVersion: "phase7-safe-workspace-composition-v1",
        artifacts: [{ artifactId: "project-profile", title: "Project profile", sections: ["Overview"], body: "# Project Profile\n\nA bounded project profile.", sourceRefs: { factIds: [], resourceIds: [], evidenceRefIds: [] }, blueprintRefs: [] }],
        warnings: []
      }),
      runId: "remote-composer",
      sessionKey: "composer-session",
      runtime: "model-runtime" as const
    })
  });
  assert.equal(result.plan.status, "ready");
  assert.equal(result.plan.artifacts[0]?.path, "docs/project-profile.md");
  assert.equal(result.plan.artifacts[0]?.operation, "create");
  assert.equal(result.plan.provenance.modelExecutionOccurred, true);
  const adversarial = await composeWorkspaceComposition({ blueprint: value, operatorIntent: { brief: value.brief, constraints: [] } }, {
    runId: "composer-adversarial",
    modelExecutor: async () => ({ text: JSON.stringify({ schemaVersion: 1, policyVersion: "phase7-safe-workspace-composition-v1", artifacts: [{ artifactId: "project-profile", path: "/tmp/escape", title: "Bad", sections: [], body: "bad", sourceRefs: { factIds: [], resourceIds: [], evidenceRefIds: [] }, blueprintRefs: [] }], warnings: [] }), runtime: "model-runtime" as const, runId: null, sessionKey: null })
  });
  assert.equal(adversarial.plan.provenance.source, "fallback");
});

test("composition materialization preserves operator content, is idempotent, and blocks stale edits", async () => {
  const value = await blueprint();
  const operatorContent = "# Operator notes\n\nKeep this paragraph.\n";
  const composed = await composeWorkspaceComposition({
    blueprint: value,
    operatorIntent: { brief: value.brief, constraints: [] },
    existingFiles: [{ path: "docs/project-profile.md", content: operatorContent }]
  }, {
    runId: "composer-materialize",
    modelExecutor: async () => ({ text: JSON.stringify({ schemaVersion: 1, policyVersion: "phase7-safe-workspace-composition-v1", artifacts: [{ artifactId: "project-profile", title: "Project profile", sections: ["Overview"], body: "# Generated profile", sourceRefs: { factIds: [], resourceIds: [], evidenceRefIds: [] }, blueprintRefs: [] }], warnings: [] }), runtime: "model-runtime" as const, runId: null, sessionKey: null })
  });
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-composer-"));
  try {
    const target = path.join(root, "docs", "project-profile.md");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, operatorContent);
    const applied = await applyWorkspaceCompositionPlan({ workspacePath: root, plan: composed.plan });
    assert.equal(applied.results[0]?.status, "updated");
    const content = await readFile(target, "utf8");
    assert.match(content, /Keep this paragraph/);
    assert.equal(content.split(WORKSPACE_COMPOSITION_MARKER_START).length - 1, 1);
    assert.equal(content.split(WORKSPACE_COMPOSITION_MARKER_END).length - 1, 1);
    const replay = await applyWorkspaceCompositionPlan({ workspacePath: root, plan: composed.plan });
    assert.equal(replay.results[0]?.status, "unchanged");
    await writeFile(target, `${content}\noperator changed\n`);
    const stale = await applyWorkspaceCompositionPlan({ workspacePath: root, plan: composed.plan });
    assert.equal(stale.results[0]?.status, "conflict");
    assert.match(await readFile(target, "utf8"), /operator changed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("composition trust boundaries reject unknown proposal fields and content/hash drift", async () => {
  const proposal = {
    schemaVersion: 1,
    policyVersion: "phase7-safe-workspace-composition-v1",
    artifacts: [{
      artifactId: "project-profile",
      title: "Project profile",
      sections: [],
      body: "# Project Profile",
      sourceRefs: { factIds: [], resourceIds: [], evidenceRefIds: [] },
      blueprintRefs: []
    }],
    warnings: []
  };
  assert.throws(() => normalizeWorkspaceCompositionProposal({ ...proposal, unexpected: true }));
  const value = await blueprint();
  const result = await composeWorkspaceComposition({ blueprint: value, operatorIntent: { brief: value.brief, constraints: [] } }, {
    runId: "composer-integrity",
    modelExecutor: async () => ({ text: JSON.stringify(proposal), runtime: "model-runtime" as const, runId: null, sessionKey: null })
  });
  const tampered = structuredClone(result.plan);
  const artifact = tampered.artifacts[0];
  if (!artifact) throw new Error("Expected a composition artifact.");
  artifact.content = `${artifact.content}\nchanged`;
  assert.equal(validateWorkspaceCompositionPlan(tampered), false);
});

test("composition never follows an allowlisted workspace path through a symlink", async () => {
  const value = await blueprint();
  const result = await composeWorkspaceComposition({ blueprint: value, operatorIntent: { brief: value.brief, constraints: [] } }, {
    runId: "composer-symlink",
    modelExecutor: async () => ({ text: JSON.stringify({
      schemaVersion: 1,
      policyVersion: "phase7-safe-workspace-composition-v1",
      artifacts: [{ artifactId: "project-profile", title: "Project profile", sections: [], body: "# Profile", sourceRefs: { factIds: [], resourceIds: [], evidenceRefIds: [] }, blueprintRefs: [] }],
      warnings: []
    }), runtime: "model-runtime" as const, runId: null, sessionKey: null })
  });
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-composer-link-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "agentos-composer-outside-"));
  try {
    await symlink(outside, path.join(root, "docs"), "dir");
    await assert.rejects(() => applyWorkspaceCompositionPlan({ workspacePath: root, plan: result.plan }), /symbolic-link/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("native Project Intelligence execution uses the high-reasoning OpenClaw contract and isolated identity", async () => {
  let call: Record<string, unknown> | null = null;
  const workspaceId = "planner-runtime-workspace";
  const runtimeDependencies = {
    getSnapshot: async () => ({
      workspaces: [{ id: workspaceId, path: PLANNER_RUNTIME_WORKSPACE_PATH }],
      agents: [{ id: buildPlannerRuntimeAgentId("architect"), workspaceId }]
    }),
    createWorkspaceProject: async () => { throw new Error("unexpected runtime creation"); },
    createAgent: async () => { throw new Error("unexpected runtime agent creation"); },
    readManifest: async () => ({ hidden: true, systemTag: PLANNER_RUNTIME_SYSTEM_TAG } as WorkspaceProjectManifest),
    configureWorkspace: async () => undefined
  } as unknown as PlannerRuntimeEnsureDependencies;
  const adapter = {
    runAgentTurn: async (input: Record<string, unknown>) => {
      call = input;
      return { summary: "{}", runId: "remote-project-intelligence" };
    }
  } as unknown as OpenClawAdapter;
  await runStructuredProjectIntelligenceAgent({
    runId: "pi-contract",
    attempt: 1,
    signal: new AbortController().signal,
    timeoutMs: 30_000,
    systemPrompt: "system",
    userPrompt: "user"
  }, { adapter, runtimeDependencies });
  assert.ok(call);
  assert.equal(call["thinking"], "high");
  assert.equal(call["idempotencyKey"], "project-intelligence:pi-contract:1");
  assert.match(String(call["sessionKey"]), /project-intelligence:pi-contract$/);
  await runStructuredWorkspaceComposerAgent({
    runId: "composer-contract",
    attempt: 2,
    signal: new AbortController().signal,
    timeoutMs: 30_000,
    systemPrompt: "system",
    userPrompt: "user"
  }, { adapter, runtimeDependencies });
  assert.equal(call["thinking"], "high");
  assert.equal(call["idempotencyKey"], "workspace-composer:composer-contract:2");
  assert.match(String(call["sessionKey"]), /workspace-composer:composer-contract$/);
});
