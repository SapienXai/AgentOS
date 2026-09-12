import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  continueWorkspaceCreationNow,
  cancelWorkspaceCreationRun,
  startWorkspacePostCreateEnrichment,
  startWorkspaceCreationRun,
  waitForWorkspaceCreationRunIdle,
  type WorkspaceCreationRunDependencies
} from "@/lib/agentos/application/workspace-creation-run-service";
import {
  createWorkspaceCreationRunAtomically,
  workspaceCreationActorHash,
  workspaceCreationStorageKey
} from "@/lib/agentos/application/workspace-creation-run-store";
import { createInitialWorkspaceCreationSnapshot } from "@/lib/agentos/domains/workspace-creation-run";
import { resolveWorkspaceCreationPolicy } from "@/lib/agentos/domains/workspace-creation-policy";
import { generateWorkspaceBlueprint } from "@/lib/agentos/application/workspace-architect";

test("Quick is the bounded default and Deep keeps the full policy", () => {
  const quick = resolveWorkspaceCreationPolicy("quick");
  const deep = resolveWorkspaceCreationPolicy("deep");
  assert.equal(quick.budget.overallAnalysisBudgetMs, 30_000);
  assert.equal(quick.contextLimits.maxPagesPerSource, 6);
  assert.equal(quick.maxSpecialists, 2);
  assert.equal(quick.compositionStrategy, "deterministic-safe");
  assert.equal(quick.stopWhenSufficient, true);
  assert.equal(deep.budget.overallAnalysisBudgetMs, 300_000);
  assert.equal(deep.contextLimits.maxPagesPerSource, undefined);
  assert.equal(deep.compositionStrategy, "model");
  assert.equal(deep.stopWhenSufficient, false);
});

test("invalid creation profiles are rejected before a run is persisted", async () => {
  await assert.rejects(
    () => startWorkspaceCreationRun({ actorId: "profile-validation-actor", idempotencyKey: "invalid-profile", brief: "Build a workspace", profile: "unsupported" as never }),
    /Workspace creation profile is invalid/
  );
});

test("Continue now persists an expedite intent without cancelling the current run", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-creation-continue-"));
  try {
    const actorId = "continue-now-actor";
    const created = await createWorkspaceCreationRunAtomically(rootPath, workspaceCreationStorageKey(actorId, "continue"), {
      actorHash: workspaceCreationActorHash(actorId),
      idempotencyKeyHash: "continue-key",
      attempt: 1,
      input: { brief: "Build a workspace", mode: "automatic", operatorConstraints: [], materialization: { mode: "empty" }, sources: [], profile: "deep" },
      draftContextId: null,
      snapshot: {
        ...createInitialWorkspaceCreationSnapshot(0),
        state: "running",
        stage: "architect-reasoning",
        context: { ...createInitialWorkspaceCreationSnapshot(0).context, status: "ready", usableEvidence: true }
      },
      result: null
    });
    const dependencies: WorkspaceCreationRunDependencies = {
      rootPath,
      stageContext: async ({ signal }) => {
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
        return { draftContextId: "11111111-1111-4111-8111-111111111111", generationId: null, runStatus: "cancelled", reused: false, sources: [], sourceReports: [], warnings: [] };
      }
    };
    const continued = await continueWorkspaceCreationNow({ actorId, runId: created.run.runId }, dependencies);
    assert.equal(continued?.expediteRequestedAt !== null && continued?.expediteRequestedAt !== undefined, true);
    assert.equal(continued?.snapshot.cancelRequested, false);
    assert.ok(continued?.events.some((event) => event.activityCode === "continue-now-requested"));
    await cancelWorkspaceCreationRun({ actorId, runId: created.run.runId }, dependencies);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("post-create enrichment is one immutable Deep child of a Quick run", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-creation-enrichment-"));
  try {
    const actorId = "enrichment-actor";
    const parentResult = await generateWorkspaceBlueprint({ brief: "Build a workspace", materialization: { mode: "empty" }, operatorConstraints: [] }, {
      runId: "enrichment-parent-architect",
      modelExecutor: async () => ({ text: JSON.stringify({ workforce: { specialists: [] } }), runtime: "model-runtime" })
    });
    const parent = await createWorkspaceCreationRunAtomically(rootPath, workspaceCreationStorageKey(actorId, "parent"), {
      actorHash: workspaceCreationActorHash(actorId),
      idempotencyKeyHash: "parent-key",
      attempt: 1,
      input: { brief: "Build a workspace", mode: "automatic", operatorConstraints: [], materialization: { mode: "empty" }, sources: [], profile: "quick", continueLearningAfterCreation: true },
      draftContextId: "22222222-2222-4222-8222-222222222222",
      snapshot: { ...createInitialWorkspaceCreationSnapshot(0), state: "review-ready", stage: "review-preparation" },
      result: parentResult
    });
    const dependencies: WorkspaceCreationRunDependencies = {
      rootPath,
      cloneContext: async ({ targetDraftContextId }) => ({ draftContextId: targetDraftContextId, sources: [], fingerprint: "f".repeat(64) }),
      persistIntake: async ({ draftContextId }) => ({ draftContextId: draftContextId!, sources: [], fingerprint: "f".repeat(64) }),
      stageContext: async ({ draftContextId }) => ({ draftContextId: draftContextId!, generationId: null, runStatus: "ready", reused: false, sources: [], sourceReports: [], warnings: [] }),
      readContextMetadata: async ({ draftContextId }) => ({ draftContextId, generationId: null, runStatus: "ready", reused: false, sources: [], sourceReports: [], warnings: [], knowledge: { generationId: null, sources: [], documents: [], warnings: [] } }),
      readIntelligencePack: async () => null,
      readIntelligenceSummary: async () => null,
      readCompositionPlan: async () => null,
      persistCompositionPlan: async ({ plan }) => ({ planId: plan.planId, inputFingerprint: plan.inputFingerprint, status: plan.status }),
      generateArchitect: async (input, options) => generateWorkspaceBlueprint(input, { ...options, modelExecutor: async () => ({ text: JSON.stringify({ workforce: { specialists: [] } }), runtime: "model-runtime" }) }),
      composeWorkspace: async (input, options) => {
        const { createDeterministicWorkspaceComposition } = await import("@/lib/agentos/application/workspace-composer");
        return createDeterministicWorkspaceComposition(input, { runId: options?.runId ?? "enrichment-composition" });
      }
    };
    const [first, second] = await Promise.all([
      startWorkspacePostCreateEnrichment({ actorId, parentRunId: parent.run.runId }, dependencies),
      startWorkspacePostCreateEnrichment({ actorId, parentRunId: parent.run.runId }, dependencies)
    ]);
    assert.ok(first?.runId);
    assert.equal(second?.runId, first?.runId);
    assert.equal(first?.input.profile, "deep");
    assert.equal(first?.input.trigger, "post-create-enrichment");
    assert.equal(first?.lineage?.parentRunId, parent.run.runId);
    assert.equal(first?.lineage?.trigger, "post-create-enrichment");
    if (first) await waitForWorkspaceCreationRunIdle({ actorId, runId: first.runId }, dependencies);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
