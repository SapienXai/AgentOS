import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { getWorkspaceIntelligenceStatus } from "@/lib/agentos/application/workspace-intelligence-status-service";
import { persistWorkspaceIntelligenceBinding } from "@/lib/agentos/application/workspace-intelligence-binding-store";
import { createWorkspaceCompositionBlueprintFingerprint } from "@/lib/agentos/application/workspace-composer";
import { createRunAtomically, updateStoredRun } from "@/lib/agentos/application/workspace-provisioning-store";
import {
  createWorkspaceCreationRunAtomically,
  updateWorkspaceCreationRun,
  workspaceCreationActorHash,
  workspaceCreationStorageKey
} from "@/lib/agentos/application/workspace-creation-run-store";
import { createInitialWorkspaceCreationSnapshot } from "@/lib/agentos/domains/workspace-creation-run";
import { generateWorkspaceBlueprint } from "@/lib/agentos/application/workspace-architect";

test("live workspace status compares an immutable candidate against the accepted binding", async () => {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "agentos-intelligence-status-"));
  const provisioningRootPath = path.join(rootPath, "provisioning");
  const creationRootPath = path.join(rootPath, "creation");
  const bindingRootPath = path.join(rootPath, "bindings");
  const actorId = "intelligence-status-actor";
  const workspaceId = "workspace-status";
  try {
    const architect = await generateWorkspaceBlueprint({ brief: "Build a workspace for a support product.", materialization: { mode: "empty" }, operatorConstraints: [] }, {
      runId: "status-architect",
      modelExecutor: async () => ({ text: JSON.stringify({ workforce: { specialists: [] } }), runtime: "model-runtime" })
    });
    const blueprintFingerprint = createWorkspaceCompositionBlueprintFingerprint(architect.blueprint);
    const provisioning = await createRunAtomically(provisioningRootPath, "status-provisioning-key", {
      actorId,
      blueprint: architect.blueprint,
      blueprintFingerprint,
      draftContextId: null,
      expectedKnowledgeGenerationId: null
    });
    const provisioningFile = path.join(provisioningRootPath, `${provisioning.run.idempotencyKeyHash}.json`);
    const liveRun = await updateStoredRun(provisioningFile, provisioning.run, { workspaceId, workspacePath: path.join(rootPath, "workspace"), result: { workspaceId, workspaceName: architect.blueprint.identity.name, workspacePath: path.join(rootPath, "workspace"), agentIds: [], primaryAgentId: "" } });
    await persistWorkspaceIntelligenceBinding({
      rootPath: bindingRootPath,
      actorId,
      workspaceId,
      sourceGenerationId: null,
      projectIntelligencePackId: null,
      projectIntelligenceGenerationId: null,
      blueprintId: architect.blueprint.id,
      blueprintFingerprint,
      provisioningRunId: liveRun.runId,
      status: "current"
    });

    const current = await getWorkspaceIntelligenceStatus({ actorId, workspaceId }, { creationRootPath, provisioningRootPath, bindingRootPath });
    assert.equal(current.status, "current");
    assert.equal(current.live?.provisioningRunId, liveRun.runId);

    const changedResult = {
      ...architect,
      blueprint: { ...architect.blueprint, identity: { ...architect.blueprint.identity, purpose: "Operate a changed support product." } }
    };
    const candidate = await createWorkspaceCreationRunAtomically(creationRootPath, workspaceCreationStorageKey(actorId, "status-candidate"), {
      actorHash: workspaceCreationActorHash(actorId),
      idempotencyKeyHash: "status-candidate",
      attempt: 1,
      input: { brief: "Build a workspace for a support product.", mode: "automatic", operatorConstraints: [], materialization: { mode: "empty" }, sources: [] },
      draftContextId: null,
      snapshot: { ...createInitialWorkspaceCreationSnapshot(0), state: "review-ready", stage: "review-preparation" },
      result: changedResult,
      lineage: { rootRunId: "candidate", parentRunId: null, relation: "initial" }
    });
    await updateWorkspaceCreationRun(candidate.filePath, candidate.run, { snapshot: { ...candidate.run.snapshot, state: "review-ready", stage: "review-preparation" }, result: changedResult });
    const update = await getWorkspaceIntelligenceStatus({ actorId, workspaceId, candidateCreationRunId: candidate.run.runId }, { creationRootPath, provisioningRootPath, bindingRootPath });
    assert.equal(update.status, "update-available");
    assert.deepEqual(update.drift?.categories, ["blueprint"]);
  } finally {
    await rm(rootPath, { recursive: true, force: true });
  }
});

test("live workspace status is unknown without a verified accepted binding", async () => {
  const status = await getWorkspaceIntelligenceStatus({ actorId: "status-actor", workspaceId: "unbound-workspace" }, {
    creationRootPath: path.join(os.tmpdir(), "agentos-no-creation"),
    provisioningRootPath: path.join(os.tmpdir(), "agentos-no-provisioning"),
    bindingRootPath: path.join(os.tmpdir(), "agentos-no-binding")
  });
  assert.equal(status.status, "unknown");
  assert.equal(status.binding, null);
  assert.equal(status.drift, null);
});
