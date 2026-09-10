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
  type WorkspaceCreationRunDependencies
} from "@/lib/agentos/application/workspace-creation-run-service";
import {
  createWorkspaceCreationRunAtomically,
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

const source = createWorkspaceKnowledgeSource({
  id: "project-file",
  kind: "file",
  label: "Project brief",
  summary: "A project brief.",
  locator: { kind: "file", path: "staged-upload:project-file" },
  provenance: "operator"
});

async function waitForTerminal(actorId: string, runId: string, dependencies: WorkspaceCreationRunDependencies) {
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
    remoteExecution: { idempotencyKey: "run:1", runId: null, sessionKey: null, outcome: "not-started" }
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
      materialization: { mode: "empty" },
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

    const completedCreated = await createWorkspaceCreationRunAtomically(rootPath, workspaceCreationStorageKey(actorId, "completed"), {
      actorHash: workspaceCreationActorHash(actorId),
      idempotencyKeyHash: "key-2",
      attempt: 1,
      input,
      draftContextId: null,
      snapshot: { ...createInitialWorkspaceCreationSnapshot(0), state: "running", stage: "architect-reasoning" },
      result: { blueprint: { status: "draft" } }
    });
    const completedRun = {
      ...completedCreated.run,
      remoteExecution: { ...completedCreated.run.remoteExecution, outcome: "completed" as const }
    };
    await updateWorkspaceCreationRun(completedCreated.filePath, completedRun, { remoteExecution: completedRun.remoteExecution, snapshot: completedRun.snapshot });
    await ensureCreationRunExecution({ actorId, runId: completedRun.runId }, { rootPath });
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
