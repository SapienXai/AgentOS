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
import { createWorkspaceKnowledgeSource } from "@/lib/agentos/domains/workspace-knowledge";
import { generateWorkspaceBlueprint } from "@/lib/agentos/application/workspace-architect";
import { createDeterministicWorkspaceComposition } from "@/lib/agentos/application/workspace-composer";

const source = createWorkspaceKnowledgeSource({
  id: "project-file",
  kind: "file",
  label: "Project brief",
  summary: "A project brief.",
  locator: { kind: "file", path: "staged-upload:project-file" },
  provenance: "operator"
});

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

test("Fast keeps its bounded Architect budget when execution dependencies are resolved twice", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-creation-fast-budget-"));
  let architectOptions: { deterministicSafe?: boolean; maxRetries?: number; timeoutMs?: number } | undefined;
  let intelligenceCalls = 0;
  let architectModelCalls = 0;
  try {
    const actorId = "fast-budget-actor";
    const dependencies: WorkspaceCreationRunDependencies = {
      rootPath,
      persistIntake: async () => ({ draftContextId: "11111111-1111-4111-8111-111111111111", sources: [], fingerprint: "f".repeat(64) }),
      stageContext: async ({ draftContextId }) => ({
        draftContextId: draftContextId!,
        generationId: null,
        runStatus: "ready",
        reused: false,
        sources: [],
        sourceReports: [],
        warnings: []
      }),
      readContextMetadata: async ({ draftContextId }) => ({
        draftContextId,
        generationId: null,
        runStatus: "ready",
        reused: false,
        sources: [],
        sourceReports: [],
        warnings: [],
        extraction: {} as never,
        knowledge: { generationId: null, sources: [], documents: [], warnings: [] }
      }),
      synthesizeIntelligence: async () => {
        intelligenceCalls += 1;
        throw new Error("Brief-only Fast setup must not synthesize project intelligence.");
      },
      readIntelligencePack: async () => null,
      readIntelligenceSummary: async () => null,
      readCompositionPlan: async () => null,
      persistCompositionPlan: async ({ plan }) => ({ planId: plan.planId, inputFingerprint: plan.inputFingerprint, status: plan.status }),
      generateArchitect: async (input, options) => {
        architectOptions = { deterministicSafe: options?.deterministicSafe, maxRetries: options?.maxRetries, timeoutMs: options?.timeoutMs };
        return generateWorkspaceBlueprint(input, {
          ...options,
          modelExecutor: async () => {
            architectModelCalls += 1;
            return { text: JSON.stringify({ workforce: { specialists: [] } }), runtime: "model-runtime" };
          }
        });
      },
      composeWorkspace: async (input, options) => createDeterministicWorkspaceComposition(input, { runId: options?.runId ?? "fast-budget-composition" })
    };
    const started = await startWorkspaceCreationRun({ actorId, idempotencyKey: "fast-budget", brief: "Build a workspace", profile: "fast" }, dependencies);
    const finished = await waitForWorkspaceCreationRunIdle({ actorId, runId: started.runId }, dependencies);
    assert.equal(finished?.snapshot.state, "review-ready");
    assert.equal(architectOptions?.deterministicSafe, true);
    assert.equal(architectOptions?.maxRetries, 0);
    assert.ok((architectOptions?.timeoutMs ?? 0) <= 8_000);
    assert.equal(intelligenceCalls, 0);
    assert.equal(architectModelCalls, 0);
    assert.equal(finished?.snapshot.intelligence.modelExecutionOccurred, false);
    assert.equal(finished?.snapshot.architect.modelExecutionOccurred, false);
    assert.ok(finished?.events.some((event) => event.activityCode === "intelligence-skipped"));
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
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
      input: { brief: "Build a workspace", mode: "automatic", operatorConstraints: [], materialization: { mode: "empty" }, sources: [source], profile: "quick", continueLearningAfterCreation: true },
      draftContextId: "22222222-2222-4222-8222-222222222222",
      snapshot: {
        ...createInitialWorkspaceCreationSnapshot(1),
        state: "review-ready",
        stage: "review-preparation",
        context: { ...createInitialWorkspaceCreationSnapshot(1).context, status: "ready", sourceCount: 1, usableEvidence: true }
      },
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
    assert.equal(first?.input.profile, "high");
    assert.equal(first?.input.trigger, "post-create-enrichment");
    assert.equal(first?.lineage?.parentRunId, parent.run.runId);
    assert.equal(first?.lineage?.trigger, "post-create-enrichment");
    if (first) await waitForWorkspaceCreationRunIdle({ actorId, runId: first.runId }, dependencies);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("post-create enrichment skips a Fast run with no project context", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-creation-empty-enrichment-"));
  try {
    const actorId = "empty-enrichment-actor";
    const created = await createWorkspaceCreationRunAtomically(rootPath, workspaceCreationStorageKey(actorId, "empty-parent"), {
      actorHash: workspaceCreationActorHash(actorId),
      idempotencyKeyHash: "empty-parent-key",
      attempt: 1,
      input: { brief: "faros", mode: "automatic", operatorConstraints: [], materialization: { mode: "empty" }, sources: [], profile: "fast", continueLearningAfterCreation: true },
      draftContextId: null,
      snapshot: { ...createInitialWorkspaceCreationSnapshot(0), state: "review-ready", stage: "review-preparation" },
      result: null
    });
    const enrichment = await startWorkspacePostCreateEnrichment({ actorId, parentRunId: created.run.runId }, { rootPath });
    assert.equal(enrichment, null);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
