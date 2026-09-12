import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  getWorkspaceCreationRun,
  startWorkspaceCreationRun,
  cancelWorkspaceCreationRun,
  ensureCreationRunExecution,
  waitForWorkspaceCreationRunIdle,
  refreshWorkspaceCreationRun,
  reviseWorkspaceCreationRun,
  listResumableWorkspaceCreationRuns,
  getWorkspaceCreationReviewReadiness,
  abandonWorkspaceCreationRun,
  type WorkspaceCreationRunDependencies
} from "@/lib/agentos/application/workspace-creation-run-service";
import {
  createWorkspaceCreationRunAtomically,
  mutateWorkspaceCreationRun,
  readWorkspaceCreationRunFile,
  updateWorkspaceCreationRun,
  workspaceCreationActorHash,
  workspaceCreationStorageKey
} from "@/lib/agentos/application/workspace-creation-run-store";
import {
  appendWorkspaceCreationEvent,
  createInitialWorkspaceCreationSnapshot,
  validateWorkspaceCreationRun,
  WORKSPACE_CREATION_MAX_EVENTS,
  type WorkspaceCreationRun
} from "@/lib/agentos/domains/workspace-creation-run";
import { createWorkspaceKnowledgeSource } from "@/lib/agentos/domains/workspace-knowledge";
import { generateWorkspaceBlueprint } from "@/lib/agentos/application/workspace-architect";
import type { WorkspaceArchitectResult } from "@/lib/agentos/domains/workspace-blueprint";
import { composeWorkspaceComposition, createDeterministicWorkspaceComposition } from "@/lib/agentos/application/workspace-composer";
import type { StoredWorkspaceProvisioningRun } from "@/lib/agentos/application/workspace-provisioning-store";

const source = createWorkspaceKnowledgeSource({
  id: "project-file",
  kind: "file",
  label: "Project brief",
  summary: "A project brief.",
  locator: { kind: "file", path: "staged-upload:project-file" },
  provenance: "operator"
});

async function waitForTerminal(actorId: string, runId: string, dependencies: WorkspaceCreationRunDependencies) {
  const settled = await waitForWorkspaceCreationRunIdle({ actorId, runId }, dependencies);
  if (settled && ["review-ready", "failed", "cancelled"].includes(settled.snapshot.state)) return settled;
  for (let index = 0; index < 100; index += 1) {
    const run = await getWorkspaceCreationRun({ actorId, runId }, dependencies);
    if (run && ["review-ready", "failed", "cancelled"].includes(run.snapshot.state)) return run;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Workspace creation run did not finish in time.");
}

function dependencies(rootPath: string, overrides: Partial<WorkspaceCreationRunDependencies> = {}): WorkspaceCreationRunDependencies {
  return {
    rootPath,
    persistIntake: async () => ({ draftContextId: "11111111-1111-4111-8111-111111111111", sources: [source], fingerprint: "f".repeat(64) }),
    ...overrides
  };
}

test("creation events retain a bounded tail while the current snapshot remains available", () => {
  let run: WorkspaceCreationRun = {
    schemaVersion: 1,
    runId: "run",
    actorHash: "actor",
    idempotencyKeyHash: "key",
    createdAt: "2026-09-11T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
    attempt: 1,
    input: { brief: "Build a workspace", mode: "automatic", operatorConstraints: [], materialization: { mode: "empty" }, sources: [] },
    draftContextId: null,
    snapshot: createInitialWorkspaceCreationSnapshot(0),
    result: null,
    events: [],
    oldestRetainedSequence: 1,
    cancelRequestedAt: null,
    remoteExecution: { idempotencyKey: "run:1", runId: null, sessionKey: null, outcome: "not-started" },
    intelligenceExecution: { idempotencyKey: "run:intelligence:1", runId: null, sessionKey: null, outcome: "not-started" }
    , compositionExecution: { idempotencyKey: "workspace-composer:run:1", runId: null, sessionKey: null, outcome: "not-started" }
  };
  for (let index = 0; index < WORKSPACE_CREATION_MAX_EVENTS + 4; index += 1) {
    run = appendWorkspaceCreationEvent(run, {
      schemaVersion: 1,
      createdAt: new Date(Date.parse(run.createdAt) + index + 1).toISOString(),
      kind: "warning",
      stage: "intake",
      snapshot: run.snapshot,
      attempt: 1,
      maxAttempts: 3,
      elapsedMs: index,
      sourceId: null,
      warningCode: "test-warning",
      failure: null
    });
  }
  assert.equal(run.events.length, WORKSPACE_CREATION_MAX_EVENTS);
  assert.equal(run.oldestRetainedSequence, 5);
  assert.equal(run.snapshot.state, "pending");
  assert.equal(validateWorkspaceCreationRun({ ...run, untrustedField: "ignored" }), false);
  assert.equal(validateWorkspaceCreationRun({ ...run, events: [{ ...run.events[0], untrustedField: "ignored" }, ...run.events.slice(1)] }), false);
});

test("a usable partial context is preserved in the durable snapshot and Architect can review it", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-creation-run-"));
  try {
    const deps = dependencies(rootPath, {
      stageContext: async () => ({
        draftContextId: "11111111-1111-4111-8111-111111111111",
        generationId: "knowledge-generation-1",
        runStatus: "partial",
        reused: false,
        sources: [source],
        sourceReports: [{ sourceId: source.id, sourceKind: "file", status: "partial", support: "partial", discoveredItems: 2, fetchedItems: 1, storedDocuments: 1, warningCount: 1, warnings: ["One document was skipped."], error: null }],
        warnings: ["Knowledge ingestion reached its shared analysis budget."]
      }),
      readContext: async () => ({
        draftContextId: "11111111-1111-4111-8111-111111111111",
        generationId: "knowledge-generation-1",
        runStatus: "partial",
        reused: false,
        sources: [source],
        sourceReports: [],
        warnings: [],
        knowledge: { generationId: "knowledge-generation-1", sources: [source], documents: [{ sourceId: source.id, title: "Brief", content: "Use one operator.", contentLength: 15 }], warnings: [] }
      }),
      generateArchitect: async (input, options) => generateWorkspaceBlueprint(input, {
        ...options,
        nativeSearch: async () => ({ status: "unavailable", results: [] }),
        modelExecutor: async () => ({ text: JSON.stringify({ workforce: { specialists: [] } }), runtime: "model-runtime" })
      })
    });
    const started = await startWorkspaceCreationRun({ actorId: "partial-actor", idempotencyKey: "partial-run", brief: "Build a workspace", sources: [source] }, deps);
    const finished = await waitForTerminal("partial-actor", started.runId, deps);
    assert.equal(finished.snapshot.state, "review-ready");
    assert.equal(finished.snapshot.context.status, "partial");
    assert.equal(finished.snapshot.context.usableEvidence, true);
    assert.equal(finished.snapshot.architect.partialContext, true);
    assert.ok(finished.events.some((event) => event.warningCode === "partial-context"));
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("recovery fails closed for ambiguous Architect execution and resumes only durable results", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-creation-recovery-"));
  try {
    const actorId = "recovery-actor";
    const input = {
      brief: "Build a workspace",
      mode: "automatic" as const,
      operatorConstraints: [],
      materialization: { mode: "empty" as const },
      sources: []
    };
    const ambiguousCreated = await createWorkspaceCreationRunAtomically(rootPath, workspaceCreationStorageKey(actorId, "ambiguous"), {
      actorHash: workspaceCreationActorHash(actorId),
      idempotencyKeyHash: "key",
      attempt: 1,
      input,
      draftContextId: null,
      snapshot: { ...createInitialWorkspaceCreationSnapshot(0), state: "running", stage: "architect-reasoning" },
      result: null
    });
    const ambiguousRun = {
      ...ambiguousCreated.run,
      remoteExecution: { ...ambiguousCreated.run.remoteExecution, outcome: "in-flight" as const }
    };
    await updateWorkspaceCreationRun(ambiguousCreated.filePath, ambiguousRun, { remoteExecution: ambiguousRun.remoteExecution, snapshot: ambiguousRun.snapshot });
    await ensureCreationRunExecution({ actorId, runId: ambiguousRun.runId }, { rootPath });
    const failed = await waitForTerminal(actorId, ambiguousRun.runId, { rootPath });
    assert.equal(failed.snapshot.state, "failed");
    assert.equal(failed.snapshot.architect.failure?.code, "remote-execution-ambiguous");

    const durableArchitectResult = await generateWorkspaceBlueprint({
      brief: input.brief,
      mode: input.mode,
      materialization: input.materialization,
      operatorConstraints: input.operatorConstraints
    }, {
      runId: "durable-architect-result",
      nativeSearch: async () => ({ status: "unavailable", results: [] }),
      modelExecutor: async () => ({ text: JSON.stringify({ workforce: { specialists: [] } }), runtime: "model-runtime" })
    });
    const completedCreated = await createWorkspaceCreationRunAtomically(rootPath, workspaceCreationStorageKey(actorId, "completed"), {
      actorHash: workspaceCreationActorHash(actorId),
      idempotencyKeyHash: "key-2",
      attempt: 1,
      input,
      draftContextId: null,
      snapshot: { ...createInitialWorkspaceCreationSnapshot(0), state: "running", stage: "architect-reasoning" },
      result: durableArchitectResult
    });
    const completedRun = {
      ...completedCreated.run,
      remoteExecution: { ...completedCreated.run.remoteExecution, outcome: "completed" as const }
    };
    await updateWorkspaceCreationRun(completedCreated.filePath, completedRun, { remoteExecution: completedRun.remoteExecution, snapshot: completedRun.snapshot });
    await ensureCreationRunExecution({ actorId, runId: completedRun.runId }, {
      rootPath,
      composeWorkspace: async (compositionInput) => composeWorkspaceComposition(compositionInput, {
        runId: "recovery-composition",
        modelExecutor: async () => ({ text: JSON.stringify({ schemaVersion: 1, policyVersion: "phase7-safe-workspace-composition-v1", artifacts: [], warnings: [] }), runtime: "model-runtime" as const, runId: null, sessionKey: null })
      })
    });
    const resumed = await waitForTerminal(actorId, completedRun.runId, { rootPath });
    assert.equal(resumed.snapshot.state, "review-ready");
    assert.deepEqual(resumed.result, completedRun.result);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("cancellation is durable and does not fall through to Architect", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-creation-cancel-"));
  let architectCalls = 0;
  try {
    const deps = dependencies(rootPath, {
      stageContext: async ({ signal }) => {
        await new Promise<void>((resolve) => signal?.addEventListener("abort", () => resolve(), { once: true }));
        return { draftContextId: "11111111-1111-4111-8111-111111111111", generationId: null, runStatus: "cancelled", reused: false, sources: [source], sourceReports: [], warnings: [] };
      },
      generateArchitect: async () => {
        architectCalls += 1;
        throw new Error("Architect must not run after cancellation.");
      }
    });
    const started = await startWorkspaceCreationRun({ actorId: "cancel-actor", idempotencyKey: "cancel-run", brief: "Build a workspace", sources: [source] }, deps);
    await cancelWorkspaceCreationRun({ actorId: "cancel-actor", runId: started.runId }, deps);
    const finished = await waitForTerminal("cancel-actor", started.runId, deps);
    assert.equal(finished.snapshot.state, "cancelled");
    assert.equal(architectCalls, 0);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("creation idempotency covers normalized intent and upload content", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-creation-idempotency-"));
  const stableInput = {
    actorId: "idempotency-actor",
    idempotencyKey: "creation-key",
    brief: "Build a workspace",
    mode: "automatic" as const,
    operatorConstraints: ["Keep the workspace minimal"],
    materialization: { mode: "empty" },
    sources: [source],
    uploads: [{ sourceId: source.id, relativePath: "brief.md", fileName: "brief.md", bytes: Buffer.from("same content") }]
  };
  const deps = dependencies(rootPath, {
    stageContext: async () => ({ draftContextId: "11111111-1111-4111-8111-111111111111", generationId: null, runStatus: "ready", reused: false, sources: [source], sourceReports: [], warnings: [] }),
    generateArchitect: async (input, options) => generateWorkspaceBlueprint(input, {
      ...options,
      modelExecutor: async () => ({ text: JSON.stringify({ workforce: { specialists: [] } }), runtime: "model-runtime" })
    })
  });
  try {
    const first = await startWorkspaceCreationRun(stableInput, deps);
    const replay = await startWorkspaceCreationRun({ ...stableInput, brief: "  Build a workspace  " }, deps);
    assert.equal(replay.runId, first.runId);
    await waitForTerminal(stableInput.actorId, first.runId, deps);

    for (const changed of [
      { brief: "Build a different workspace" },
      { mode: "review" as const },
      { operatorConstraints: ["Use two operators"] },
      { materialization: { mode: "existing", existingPath: "/tmp/workspace" } },
      { sources: [] },
      { uploads: [{ sourceId: source.id, relativePath: "brief.md", fileName: "brief.md", bytes: Buffer.from("changed content") }] }
    ]) {
      await assert.rejects(() => startWorkspaceCreationRun({ ...stableInput, ...changed }, deps), /different creation intent/);
    }
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("reanalysis uses one deterministic child context and never mutates the accepted parent", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-creation-reanalysis-"));
  const actorId = "reanalysis-actor";
  const parentContextId = "22222222-2222-4222-8222-222222222222";
  const cloneTargets: string[] = [];
  try {
    const architectResult = await generateWorkspaceBlueprint({ brief: "Build a workspace", materialization: { mode: "empty" }, operatorConstraints: [] }, {
      runId: "parent-architect",
      modelExecutor: async () => ({ text: JSON.stringify({ workforce: { specialists: [] } }), runtime: "model-runtime" })
    });
    const parent = await createWorkspaceCreationRunAtomically(rootPath, workspaceCreationStorageKey(actorId, "parent"), {
      actorHash: workspaceCreationActorHash(actorId),
      idempotencyKeyHash: "parent-key",
      attempt: 1,
      input: { brief: "Build a workspace", mode: "automatic", operatorConstraints: [], materialization: { mode: "empty" }, sources: [] },
      draftContextId: parentContextId,
      snapshot: { ...createInitialWorkspaceCreationSnapshot(0), state: "review-ready", stage: "review-preparation" },
      result: architectResult,
      lineage: { rootRunId: "parent", parentRunId: null, relation: "initial" }
    });
    const deps = dependencies(rootPath, {
      cloneContext: async ({ targetDraftContextId }) => {
        cloneTargets.push(targetDraftContextId);
        return { draftContextId: targetDraftContextId, sources: [], fingerprint: "f".repeat(64) };
      },
      persistIntake: async ({ draftContextId }) => ({ draftContextId: draftContextId!, sources: [], fingerprint: "f".repeat(64) }),
      stageContext: async ({ draftContextId }) => ({ draftContextId: draftContextId!, generationId: null, runStatus: "ready", reused: false, sources: [], sourceReports: [], warnings: [] }),
      readContextMetadata: async ({ draftContextId }) => ({ draftContextId, generationId: null, runStatus: "ready", reused: false, sources: [], sourceReports: [], warnings: [], knowledge: { generationId: null, sources: [], documents: [], warnings: [] } }),
      readIntelligencePack: async () => null,
      readIntelligenceSummary: async () => null,
      readCompositionPlan: async () => null,
      persistCompositionPlan: async ({ plan }) => ({ planId: plan.planId, inputFingerprint: plan.inputFingerprint, status: plan.status }),
      generateArchitect: async () => architectResult,
      composeWorkspace: async (input, options) => createDeterministicWorkspaceComposition(input, { runId: options?.runId ?? "reanalysis-composition" })
    });

    const refreshed = await Promise.all(Array.from({ length: 4 }, () => refreshWorkspaceCreationRun({ actorId, runId: parent.run.runId }, deps)));
    const childIds = new Set(refreshed.map((run) => run?.runId));
    const childContextIds = new Set(refreshed.map((run) => run?.draftContextId));
    assert.equal(childIds.size, 1);
    assert.equal(childContextIds.size, 1);
    assert.equal(cloneTargets.length, 4);
    assert.equal(new Set(cloneTargets).size, 1);
    const child = refreshed[0];
    assert.ok(child);
    let finished = await waitForTerminal(actorId, child.runId, deps);
    for (let index = 0; index < 100 && !finished.snapshot.drift; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished = await getWorkspaceCreationRun({ actorId, runId: child.runId }, deps) ?? finished;
    }
    assert.equal(finished.snapshot.state, "review-ready");
    const unchangedParent = await readWorkspaceCreationRunFile(parent.filePath);
    assert.equal(unchangedParent?.draftContextId, parentContextId);
    assert.equal(unchangedParent?.lineage?.parentRunId, null);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("concurrent run mutations serialize against the latest durable snapshot", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-creation-mutation-"));
  try {
    const created = await createWorkspaceCreationRunAtomically(rootPath, workspaceCreationStorageKey("mutation-actor", "mutation-key"), {
      actorHash: workspaceCreationActorHash("mutation-actor"),
      idempotencyKeyHash: "mutation-key",
      attempt: 1,
      input: { brief: "Build a workspace", mode: "automatic", operatorConstraints: [], materialization: { mode: "empty" }, sources: [] },
      draftContextId: null,
      snapshot: createInitialWorkspaceCreationSnapshot(0),
      result: null
    });
    await Promise.all(Array.from({ length: 12 }, (_, index) => mutateWorkspaceCreationRun(created.filePath, (current) => appendWorkspaceCreationEvent(current, {
      schemaVersion: 1,
      createdAt: new Date(Date.parse(current.updatedAt) + index + 1).toISOString(),
      kind: "warning",
      stage: current.snapshot.stage,
      snapshot: current.snapshot,
      attempt: current.attempt,
      maxAttempts: 3,
      elapsedMs: index,
      sourceId: null,
      warningCode: `mutation-${index}`,
      failure: null,
      activityCode: null,
      activityData: null
    }))));
    const final = await readWorkspaceCreationRunFile(created.filePath);
    assert.ok(final);
    assert.equal(final.events.length, 12);
    assert.deepEqual(final.events.map((event) => event.sequence), Array.from({ length: 12 }, (_, index) => index + 1));
    assert.equal(validateWorkspaceCreationRun(final), true);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("server-authoritative revision creates a new composition lineage without accepting a client blueprint", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-creation-revision-"));
  const actorId = "revision-actor";
  try {
    const initialResult = await generateWorkspaceBlueprint({
      brief: "Build a workspace for a small software team.",
      mode: "automatic",
      materialization: { mode: "empty" },
      operatorConstraints: []
    }, {
      runId: "revision-initial-architect",
      nativeSearch: async () => ({ status: "unavailable", results: [] }),
      modelExecutor: async () => ({
        text: JSON.stringify({ identity: { name: "Initial Workspace", purpose: "Operate the project", projectType: "general" }, workforce: { specialists: [] } }),
        runtime: "model-runtime"
      })
    });
    assert.equal(initialResult.validation.valid, true);
    const created = await createWorkspaceCreationRunAtomically(rootPath, workspaceCreationStorageKey(actorId, "revision-key"), {
      actorHash: workspaceCreationActorHash(actorId),
      idempotencyKeyHash: "revision-key",
      attempt: 1,
      input: { brief: "Build a workspace for a small software team.", mode: "automatic", operatorConstraints: [], materialization: { mode: "empty" }, sources: [] },
      draftContextId: null,
      snapshot: { ...createInitialWorkspaceCreationSnapshot(0), state: "review-ready", stage: "review-preparation" },
      result: initialResult,
      lineage: { rootRunId: "pending", parentRunId: null, relation: "initial" }
    });
    await updateWorkspaceCreationRun(created.filePath, created.run, {
      snapshot: {
        ...created.run.snapshot,
        state: "review-ready",
        stage: "review-preparation",
        revision: {
          number: 0,
          previousBlueprintFingerprint: null,
          blueprintFingerprint: null,
          compositionPlanId: null
        }
      },
      result: initialResult
    });

    const revised = await reviseWorkspaceCreationRun({
      actorId,
      runId: created.run.runId,
      instruction: "Use the name Revised Workspace."
    }, {
      rootPath,
      reviseArchitect: async (blueprint) => {
        const next = structuredClone(initialResult);
        next.blueprint = {
          ...blueprint,
          identity: { ...blueprint.identity, name: "Revised Workspace" },
          updatedAt: "2026-09-11T00:01:00.000Z"
        };
        return next;
      },
      composeWorkspace: async (compositionInput, options) => createDeterministicWorkspaceComposition(compositionInput, { runId: options?.runId, warning: "Deterministic revision test draft." })
    }) as WorkspaceCreationRun | null;

    if (!revised) throw new Error("The revised run was not returned.");
    const revisedResult = revised.result as WorkspaceArchitectResult;
    assert.equal(revisedResult.blueprint.identity.name, "Revised Workspace");
    assert.equal(revised.snapshot.revision?.number, 1);
    assert.notEqual(revised.snapshot.revision?.previousBlueprintFingerprint, revised.snapshot.revision?.blueprintFingerprint);
    assert.match(revised.snapshot.revision?.compositionPlanId ?? "", /revision:1/);
    assert.equal(revised.snapshot.state, "review-ready");

    const resumable = await listResumableWorkspaceCreationRuns(actorId, { rootPath });
    assert.deepEqual(resumable.map((run) => run.runId), [created.run.runId]);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("review readiness repairs a mismatched canonical composition before provisioning", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-creation-readiness-"));
  const actorId = "readiness-actor";
  const draftContextId = "33333333-3333-4333-8333-333333333333";
  const plans = new Map<string, ReturnType<typeof createDeterministicWorkspaceComposition>["plan"]>();
  try {
    const result = await generateWorkspaceBlueprint({
      brief: "Build a small workspace.",
      mode: "automatic",
      materialization: { mode: "empty" },
      operatorConstraints: []
    }, {
      runId: "readiness-architect",
      nativeSearch: async () => ({ status: "unavailable", results: [] }),
      modelExecutor: async () => ({ text: JSON.stringify({ workforce: { specialists: [] } }), runtime: "model-runtime" })
    });
    const mismatched = createDeterministicWorkspaceComposition({
      blueprint: result.blueprint,
      operatorIntent: { brief: "A different brief.", constraints: [] },
      materializationMode: "empty"
    }, { runId: "old-plan" }).plan;
    plans.set(draftContextId, mismatched);
    const created = await createWorkspaceCreationRunAtomically(rootPath, workspaceCreationStorageKey(actorId, "readiness-key"), {
      actorHash: workspaceCreationActorHash(actorId),
      idempotencyKeyHash: "readiness-key",
      attempt: 1,
      input: { brief: "Build a small workspace.", mode: "automatic", operatorConstraints: [], materialization: { mode: "empty" }, sources: [] },
      draftContextId,
      snapshot: { ...createInitialWorkspaceCreationSnapshot(0), state: "review-ready", stage: "review-preparation" },
      result
    });

    const certified = await getWorkspaceCreationReviewReadiness({ actorId, runId: created.run.runId }, {
      rootPath,
      readCompositionPlan: async ({ draftContextId: currentContextId }) => plans.get(currentContextId) ?? null,
      persistCompositionPlan: async ({ draftContextId: currentContextId, plan }) => {
        plans.set(currentContextId, plan);
        return { planId: plan.planId, inputFingerprint: plan.inputFingerprint, status: plan.status };
      }
    });
    assert.ok(certified);
    assert.equal(certified.readiness.status, "ready");
    assert.equal(certified.readiness.provisionable, true);
    assert.equal(plans.get(draftContextId)?.workspaceBlueprintFingerprint, certified.readiness.blueprintFingerprint);
    assert.equal(certified.run.snapshot.reviewReadiness?.reasonCode, "ready");
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("review draft abandonment is durable, idempotent, and actor-scoped", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-creation-abandon-"));
  const actorId = "abandon-actor";
  try {
    const created = await createWorkspaceCreationRunAtomically(rootPath, workspaceCreationStorageKey(actorId, "abandon-key"), {
      actorHash: workspaceCreationActorHash(actorId),
      idempotencyKeyHash: "abandon-key",
      attempt: 1,
      input: { brief: "Build a workspace.", mode: "automatic", operatorConstraints: [], materialization: { mode: "empty" }, sources: [] },
      draftContextId: null,
      snapshot: { ...createInitialWorkspaceCreationSnapshot(0), state: "review-ready", stage: "review-preparation" },
      result: null
    });
    await updateWorkspaceCreationRun(created.filePath, created.run, { snapshot: { ...created.run.snapshot, state: "review-ready" } });
    assert.deepEqual((await listResumableWorkspaceCreationRuns(actorId, { rootPath })).map((run) => run.runId), [created.run.runId]);

    const abandoned = await abandonWorkspaceCreationRun({ actorId, runId: created.run.runId }, { rootPath, now: () => new Date("2026-09-12T00:00:00.000Z") });
    assert.equal(abandoned?.abandonedAt, "2026-09-12T00:00:00.000Z");
    const repeated = await abandonWorkspaceCreationRun({ actorId, runId: created.run.runId }, { rootPath, now: () => new Date("2026-09-12T00:01:00.000Z") });
    assert.equal(repeated?.abandonedAt, abandoned?.abandonedAt);
    assert.equal(await abandonWorkspaceCreationRun({ actorId: "other-actor", runId: created.run.runId }, { rootPath }), null);
    assert.deepEqual((await listResumableWorkspaceCreationRuns(actorId, { rootPath })).map((run) => run.runId), []);
    assert.equal((await readWorkspaceCreationRunFile(created.filePath))?.abandonedAt, abandoned?.abandonedAt);

    const active = await createWorkspaceCreationRunAtomically(rootPath, workspaceCreationStorageKey(actorId, "active-abandon-key"), {
      actorHash: workspaceCreationActorHash(actorId),
      idempotencyKeyHash: "active-abandon-key",
      attempt: 1,
      input: { brief: "Build another workspace.", mode: "automatic", operatorConstraints: [], materialization: { mode: "empty" }, sources: [] },
      draftContextId: null,
      snapshot: { ...createInitialWorkspaceCreationSnapshot(0), state: "review-ready", stage: "review-preparation", provisioningHandoffReady: true, provisioningRunId: "provisioning-run" },
      result: null
    });
    await assert.rejects(() => abandonWorkspaceCreationRun({ actorId, runId: active.run.runId }, { rootPath }), /handed off for provisioning/);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("completed provisioning handoffs are not returned as resumable creation drafts", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-creation-provisioning-filter-"));
  const actorId = "provisioning-filter-actor";
  const completedStates: Record<string, "ready" | "partial"> = {
    "provisioning-ready": "ready",
    "provisioning-partial": "partial"
  };
  const findProvisioningRunById = async (_provisioningRootPath: string, _actor: string, runId: string) => {
    const state = completedStates[runId];
    return state
      ? { filePath: `${runId}.json`, run: { state } as StoredWorkspaceProvisioningRun }
      : null;
  };

  try {
    const createDraft = (idempotencyKey: string, provisioningRunId: string | null) => createWorkspaceCreationRunAtomically(
      rootPath,
      workspaceCreationStorageKey(actorId, idempotencyKey),
      {
        actorHash: workspaceCreationActorHash(actorId),
        idempotencyKeyHash: idempotencyKey,
        attempt: 1,
        input: { brief: `Build ${idempotencyKey}.`, mode: "automatic", operatorConstraints: [], materialization: { mode: "empty" }, sources: [] },
        draftContextId: null,
        snapshot: {
          ...createInitialWorkspaceCreationSnapshot(0),
          state: "review-ready",
          stage: "review-preparation",
          provisioningHandoffReady: provisioningRunId !== null,
          provisioningRunId
        },
        result: null
      }
    );

    const ready = await createDraft("ready", "provisioning-ready");
    const partial = await createDraft("partial", "provisioning-partial");
    const retryable = await createDraft("retryable", "provisioning-failed");
    const resumable = await listResumableWorkspaceCreationRuns(actorId, { rootPath, findProvisioningRunById });

    assert.deepEqual(resumable.map((run) => run.runId), [retryable.run.runId]);
    assert.notEqual(ready.run.runId, retryable.run.runId);
    assert.notEqual(partial.run.runId, retryable.run.runId);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("review readiness fails closed when canonical composition repair cannot persist", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-creation-readiness-failure-"));
  const actorId = "readiness-failure-actor";
  const draftContextId = "44444444-4444-4444-8444-444444444444";
  try {
    const result = await generateWorkspaceBlueprint({ brief: "Build a workspace.", mode: "automatic", materialization: { mode: "empty" }, operatorConstraints: [] }, {
      runId: "readiness-failure-architect",
      nativeSearch: async () => ({ status: "unavailable", results: [] }),
      modelExecutor: async () => ({ text: JSON.stringify({ workforce: { specialists: [] } }), runtime: "model-runtime" })
    });
    const oldPlan = createDeterministicWorkspaceComposition({ blueprint: result.blueprint, operatorIntent: { brief: "Old intent", constraints: [] }, materializationMode: "empty" }, { runId: "old-plan" }).plan;
    const created = await createWorkspaceCreationRunAtomically(rootPath, workspaceCreationStorageKey(actorId, "readiness-failure-key"), {
      actorHash: workspaceCreationActorHash(actorId),
      idempotencyKeyHash: "readiness-failure-key",
      attempt: 1,
      input: { brief: "Build a workspace.", mode: "automatic", operatorConstraints: [], materialization: { mode: "empty" }, sources: [] },
      draftContextId,
      snapshot: { ...createInitialWorkspaceCreationSnapshot(0), state: "review-ready", stage: "review-preparation" },
      result
    });
    const certified = await getWorkspaceCreationReviewReadiness({ actorId, runId: created.run.runId }, {
      rootPath,
      readCompositionPlan: async () => oldPlan,
      persistCompositionPlan: async () => { throw new Error("plan storage unavailable"); }
    });
    assert.ok(certified);
    assert.equal(certified.readiness.reasonCode, "composition-rebuild-failed");
    assert.equal(certified.readiness.provisionable, false);
    assert.equal(certified.readiness.requiredAction, "rebuild-plan");
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});
