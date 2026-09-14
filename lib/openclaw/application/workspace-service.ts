import "server-only";

import { lstat, readFile, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_AGENT_PRESET,
  formatAgentPresetLabel,
  resolveAgentPolicy
} from "@/lib/openclaw/agent-presets";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { readAgentBootstrapProfile } from "@/lib/openclaw/adapter/agent-profile-adapter";
import {
  buildWorkspaceBootstrapProfileCache
} from "@/lib/openclaw/adapter/workspace-inspector-adapter";
import {
  clearMissionControlCaches,
  getMissionControlSnapshot,
  invalidateMissionControlSnapshotCache
} from "@/lib/openclaw/application/mission-control-service";
import {
  createAgent,
  deleteAgent,
  formatPostCreateAgentConfigSyncWarning,
  updateAgent
} from "@/lib/openclaw/application/agent-service";
import { disconnectWorkspaceChannel } from "@/lib/openclaw/application/channel-service";
import {
  clearRuntimeHistoryCache
} from "@/lib/openclaw/application/runtime-service";
import { isOpenClawAgentModelReady } from "@/lib/openclaw/application/model-provider-state-service";
import {
  buildWorkspaceCreateProgressTemplate,
  createOperationProgressTracker
} from "@/lib/openclaw/operation-progress";
import {
  buildWorkspaceScaffoldDocuments
} from "@/lib/openclaw/workspace-docs";
import { normalizeWorkspaceDocOverrides } from "@/lib/openclaw/workspace-docs";
import {
  DEFAULT_WORKSPACE_RULES,
  buildDefaultWorkspaceAgents,
  getWorkspaceTemplateMeta
} from "@/lib/openclaw/workspace-presets";
import {
  describeWorkspaceSourceActivity,
  describeWorkspaceSourceCompletion,
  describeWorkspaceSourceStart,
  detectWorkspaceToolExamples,
  extractKickoffProgressMessages,
  buildWorkspaceKickoffPrompt,
  materializeWorkspaceSource,
  resolveWorkspaceBootstrapInput,
  resolveWorkspaceCreationTargetDir,
  scaffoldWorkspaceContents,
  writeTextFileEnsured
} from "@/lib/openclaw/domains/workspace-bootstrap";
import {
  areWorkspaceAgentsEqual,
  areWorkspaceCreateRulesEqual,
  collectWorkspaceEditableDocPaths,
  createWorkspaceProjectFromEditSeed
} from "@/lib/openclaw/domains/workspace-edit";
import {
  assertWorkspaceBootstrapAgentIdsAvailable as assertWorkspaceBootstrapAgentIdsAvailableFromProvisioning,
  canonicalizeWorkspaceAgentId,
  createBootstrappedWorkspaceAgent as createBootstrappedWorkspaceAgentFromProvisioning,
  createWorkspaceAgentId as createWorkspaceAgentIdFromProvisioning,
  ensureAgentPolicySkill as ensureAgentPolicySkillFromProvisioning
} from "@/lib/openclaw/domains/agent-provisioning";
import {
  filterAgentPolicySkills,
  removeWorkspaceAgentConfigEntries,
  readAgentConfigList,
  writeAgentConfigList,
  upsertAgentConfigEntry
} from "@/lib/openclaw/domains/agent-config";
import {
  readWorkspaceProjectManifest,
  serializeWorkspaceProjectManifestRecord
} from "@/lib/openclaw/domains/workspace-manifest";
import {
  materializationToWorkspaceSourceMode,
  workspaceMaterializationsEqual
} from "@/lib/agentos/domains/workspace-materialization";
import type { WorkspaceProjectManifestAgent } from "@/lib/openclaw/domains/workspace-manifest";
import {
  migrateWorkspaceFilesystemOwnership,
  readWorkspaceFilesystemOwnership,
  readWorkspaceDirectoryIdentity,
  writeWorkspaceFilesystemOwnership,
  type WorkspaceFilesystemOwnershipRecord
} from "@/lib/openclaw/domains/workspace-filesystem-ownership";
import {
  createOrReadLifecycleOperation,
  lifecycleWorkspaceResourceKey,
  updateLifecycleOperation,
  withLifecycleOperationLock,
  type StoredLifecycleOperation
} from "@/lib/openclaw/application/lifecycle-operation-store";
import { reconcileLifecycleState } from "@/lib/openclaw/application/lifecycle-reconciliation";
import { executeNativeMutationWithVerification } from "@/lib/openclaw/application/native-mutation-service";
import {
  decideWorkspaceFilesystemCleanup,
  resolveWorkspaceFilesystemOwnership
} from "@/lib/openclaw/domains/workspace-filesystem-ownership";
import { runLifecycleSidecarSteps } from "@/lib/openclaw/application/lifecycle-sidecar-service";
import { syncWorkspaceAgentsMarkdown } from "@/lib/openclaw/domains/workspace-agents-document-sync";
import {
  completeWorkspaceCreateAudit,
  failWorkspaceCreateAudit,
  readCompletedWorkspaceCreateResult,
  startWorkspaceCreateAudit
} from "@/lib/openclaw/domains/workspace-create-audit";
import { normalizeOptionalValue } from "@/lib/openclaw/domains/control-plane-normalization";
import {
  getConfiguredWorkspaceRoot
} from "@/lib/openclaw/domains/control-plane-settings";
import {
  resolveWorkspaceCreationReadinessErrorWithNativeAgentEvidence
} from "@/lib/openclaw/readiness";
import {
  resolveWorkspaceIdForPath,
  workspacePathMatchesId
} from "@/lib/openclaw/domains/workspace-id";
import type {
  MissionControlSnapshot,
  OpenClawAgent,
  OperationProgressSnapshot,
  WorkspaceCreateInput,
  WorkspaceCreateAgentProjection,
  WorkspaceCreateRules,
  WorkspaceCreateResult,
  WorkspaceDeleteInput,
  WorkspaceDocOverride,
  WorkspaceEditSeed,
  WorkspacePlan,
  WorkspaceProject,
  OpenClawThinkingLevel,
  WorkspaceModelProfile,
  WorkspaceTeamPreset,
  WorkspaceTemplate,
  WorkspaceUpdateInput,
  WorkspaceAgentBlueprintInput,
  WorkspaceDeleteResult,
  WorkspaceUpdateResult,
  LifecycleOperationOutcome
} from "@/lib/openclaw/types";
import type { OpenClawCommandOptions } from "@/lib/openclaw/client/types";
import { redactSecretText } from "@/lib/security/redaction";

type WorkspaceCreateOptions = {
  onProgress?: (snapshot: OperationProgressSnapshot) => Promise<void> | void;
  gatewayOptions?: OpenClawCommandOptions;
};

type KickoffProgressHandler = (update: {
  message: string;
  percent: number;
}) => Promise<void> | void;

function invalidateSnapshotCache() {
  invalidateMissionControlSnapshotCache();
}

export async function createWorkspaceProject(
  input: WorkspaceCreateInput,
  options: WorkspaceCreateOptions = {}
): Promise<WorkspaceCreateResult> {
  const existingResult = await readCompletedWorkspaceCreateResult(input);

  if (existingResult) {
    return existingResult;
  }

  let audit: Awaited<ReturnType<typeof startWorkspaceCreateAudit>> | null = null;

  try {
    audit = await startWorkspaceCreateAudit(input);
    const result = await createWorkspaceProjectInternal(input, options);
    const correlatedResult = {
      ...result,
      operationId: audit.audit.id
    } satisfies WorkspaceCreateResult;
    await completeWorkspaceCreateAudit(audit.auditPath, audit.audit, correlatedResult);
    return correlatedResult;
  } catch (error) {
    if (audit) {
      await failWorkspaceCreateAudit(audit.auditPath, audit.audit, error).catch(() => undefined);
    }
    throw error;
  }
}

async function createWorkspaceProjectInternal(
  input: WorkspaceCreateInput,
  options: WorkspaceCreateOptions = {}
): Promise<WorkspaceCreateResult> {
  const normalized = resolveWorkspaceBootstrapInput(input);
  const enabledAgents = normalized.agents.filter((agent) => agent.enabled);
  const progress = createOperationProgressTracker({
    template: buildWorkspaceCreateProgressTemplate({
      sourceMode: normalized.sourceMode,
      agentCount: enabledAgents.length,
      kickoffMission: normalized.rules.kickoffMission
    }),
    onProgress: options.onProgress
  });

  if (enabledAgents.length === 0) {
    throw new Error("Enable at least one agent for the workspace.");
  }

  await progress.startStep(
    "validate",
    "Resolving workspace settings and reserving the target directory."
  );
  await progress.addActivity("validate", `Validated workspace name "${normalized.name}".`);

  const targetDir = await resolveWorkspaceCreationTargetDir(
    normalized,
    resolveWorkspaceRoot(await getConfiguredWorkspaceRoot())
  );
  await progress.updateStep("validate", {
    percent: 38,
    detail: `Reserved target directory at ${targetDir}.`
  });
  await progress.addActivity("validate", `Reserved target directory ${targetDir}.`, "done");

  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const configuredWorkspaceModelId =
    normalized.modelId ??
    resolveWorkspaceBlueprintModelId(snapshot, enabledAgents) ??
    resolveSnapshotDefaultAgentModelId(snapshot) ??
    resolveRecommendedWorkspaceModelId(snapshot);
  const workspaceReadinessModelId =
    configuredWorkspaceModelId ??
    resolveWorkspaceModelCandidateId(snapshot, enabledAgents);
  const readinessError = await resolveWorkspaceCreationReadinessErrorWithNativeAgentEvidence(snapshot, {
    requestedModelId: workspaceReadinessModelId,
    candidateAgentIds: resolveWorkspaceNativeReadinessAgentIds(snapshot, workspaceReadinessModelId),
    verifyAgentModel: isOpenClawAgentModelReady
  });

  if (readinessError) {
    throw new Error(readinessError);
  }

  // A native agent-scoped check can prove a model that the global snapshot
  // marked unavailable. Preserve that verified model when provisioning the
  // new OpenClaw-owned agents instead of writing an unassigned model.
  const workspaceModelId = configuredWorkspaceModelId ?? workspaceReadinessModelId;

  await progress.updateStep("validate", {
    percent: 72,
    detail: "Checking current OpenClaw snapshot and agent ids."
  });
  assertWorkspaceBootstrapAgentIdsAvailableFromProvisioning(snapshot, normalized.slug, enabledAgents, {
    workspaceId: resolveWorkspaceIdForSnapshotPath(snapshot.workspaces, targetDir),
    workspacePath: targetDir
  });
  await progress.completeStep(
    "validate",
    `Workspace input and ${enabledAgents.length} agent configuration${enabledAgents.length === 1 ? "" : "s"} are ready.`
  );

  const existingWorkspaceResult = await resolveExistingWorkspaceCreateResult(targetDir, snapshot, normalized.slug);

  if (existingWorkspaceResult) {
    await progress.startStep("source", describeWorkspaceSourceStart(normalized.sourceMode, targetDir));
    await progress.addActivity("source", "Workspace already exists. Reusing the existing folder.", "done");
    await progress.completeStep("source", "Existing workspace folder reused.");
    await progress.startStep("scaffold", "Writing the initial workspace scaffold and local metadata.");
    await progress.addActivity("scaffold", "Workspace scaffold already exists. Reusing existing files.", "done");
    await progress.completeStep("scaffold", "Workspace files and starter docs are already in place.");
    await progress.startStep(
      "agents",
      existingWorkspaceResult.agentIds.length === 1
        ? "Reusing the existing workspace agent."
        : `Reusing ${existingWorkspaceResult.agentIds.length} workspace agents.`
    );
    await progress.addActivity(
      "agents",
      `${existingWorkspaceResult.agentIds.length} agent${existingWorkspaceResult.agentIds.length === 1 ? "" : "s"} already linked to the workspace.`,
      "done"
    );
    await progress.completeStep(
      "agents",
      `${existingWorkspaceResult.agentIds.length} agent${existingWorkspaceResult.agentIds.length === 1 ? "" : "s"} already linked to the workspace.`
    );
    await progress.startStep("kickoff", "Finalizing workspace bootstrap.");
    await progress.addActivity("kickoff", "Kickoff was already handled by the existing workspace.", "done");
    await progress.completeStep("kickoff", "Workspace bootstrap is already complete.");

    invalidateSnapshotCache();
    clearRuntimeHistoryCache();

    return existingWorkspaceResult;
  }

  await progress.startStep("source", describeWorkspaceSourceStart(normalized.sourceMode, targetDir));
  await progress.addActivity("source", describeWorkspaceSourceActivity(normalized.sourceMode, normalized), "active");
  const materializationResult = await materializeWorkspaceSource({
    targetDir,
    materialization: normalized.materialization
  });
  await writeWorkspaceFilesystemOwnership(targetDir, {
    ownership: materializationResult.ownership,
    materialization: normalized.materialization.mode
  });
  await progress.completeStep("source", describeWorkspaceSourceCompletion(normalized.sourceMode, targetDir));

  await progress.startStep("scaffold", "Writing the initial workspace scaffold and local metadata.");
  await progress.addActivity("scaffold", "Generating workspace docs, memory, and configuration files.");
  await scaffoldWorkspaceContents(targetDir, {
    name: normalized.name,
    brief: normalized.brief,
    template: normalized.template,
    teamPreset: normalized.teamPreset,
    modelProfile: normalized.modelProfile,
    rules: normalized.rules,
    docOverrides: normalized.docOverrides,
    materialization: normalized.materialization,
    sourceMode: normalized.sourceMode,
    agents: enabledAgents,
    knowledgeSources: normalized.knowledgeSources
  });
  await progress.completeStep("scaffold", "Workspace files and starter docs are in place.");

  const createdAgentIds: string[] = [];
  const syncWarnings: string[] = [];

  await progress.startStep(
    "agents",
    enabledAgents.length === 1
      ? "Provisioning the first workspace agent."
      : `Provisioning ${enabledAgents.length} workspace agents.`
  );

  for (const agent of enabledAgents) {
    const createdCount = createdAgentIds.length;
    const nextIndex = createdCount + 1;
    await progress.updateStep("agents", {
      percent: Math.round((createdCount / enabledAgents.length) * 100),
      detail: `Creating agent ${nextIndex} of ${enabledAgents.length}: ${agent.name}.`
    });
    await progress.addActivity("agents", `Creating ${agent.name} (${agent.role}).`);

    const expectedAgentId = createWorkspaceAgentIdFromProvisioning(normalized.slug, agent.id);
    let createdAgentId: string;
    let agentSyncWarning: string | null = null;

    try {
      createdAgentId = await createBootstrappedWorkspaceAgentFromProvisioning({
        workspacePath: targetDir,
        workspaceSlug: normalized.slug,
        workspaceModelId,
        agent,
        gatewayOptions: options.gatewayOptions
      });
    } catch (error) {
      agentSyncWarning = assertWorkspacePostCreateConfigSyncWarning(error);
      syncWarnings.push(agentSyncWarning);
      createdAgentId = expectedAgentId;
    }
    createdAgentIds.push(createdAgentId);

    await progress.addActivity(
      "agents",
      agentSyncWarning
        ? `Created ${agent.name} as ${createdAgentId}; config sync needs a Gateway refresh.`
        : `Created ${agent.name} as ${createdAgentId}.`,
      "done"
    );
    await progress.updateStep("agents", {
      percent: Math.round((createdAgentIds.length / enabledAgents.length) * 100),
      detail: `${createdAgentIds.length} of ${enabledAgents.length} agent${enabledAgents.length === 1 ? "" : "s"} ready.`
    });
  }
  await progress.completeStep(
    "agents",
    `${createdAgentIds.length} agent${createdAgentIds.length === 1 ? "" : "s"} linked to the workspace.`
  );

  invalidateSnapshotCache();
  try {
    await syncWorkspaceAgentPolicySkills(targetDir, options.gatewayOptions);
  } catch (error) {
    syncWarnings.push(assertWorkspacePostCreateConfigSyncWarning(error));
    await progress.addActivity("agents", "Agent policy config sync needs a Gateway refresh.", "done");
  }
  await syncWorkspaceAgentsMarkdown(targetDir);

  const primaryAgentId =
    createdAgentIds.find((agentId) =>
      enabledAgents.some(
        (agent) => agent.isPrimary && createWorkspaceAgentIdFromProvisioning(normalized.slug, agent.id) === agentId
      )
    ) ?? createdAgentIds[0];

  let kickoffRunId: string | undefined;
  let kickoffStatus: string | undefined;
  let kickoffError: string | undefined;

  if (normalized.rules.kickoffMission) {
    await progress.startStep("kickoff", `Dispatching the kickoff mission to ${primaryAgentId}.`);
    await progress.addActivity("kickoff", `Selected ${primaryAgentId} as the primary agent.`);

    try {
      const kickoffResult = await runWorkspaceKickoffMission({
        agentId: primaryAgentId,
        brief: normalized.brief,
        modelProfile: normalized.modelProfile,
        thinking: normalized.thinking,
        template: normalized.template,
        rules: normalized.rules
      }, {
        gatewayOptions: options.gatewayOptions,
        onProgress: async ({ message, percent }) => {
          await progress.updateStep("kickoff", {
            percent,
            detail: message
          });
          await progress.addActivity(
            "kickoff",
            message,
            percent >= 100 ? "done" : "active"
          );
        }
      });
      kickoffRunId = kickoffResult.runId;
      kickoffStatus = kickoffResult.status;
      await progress.completeStep("kickoff", `Kickoff mission finished with status ${kickoffStatus || "unknown"}.`);
    } catch (error) {
      kickoffError =
        error instanceof Error ? error.message : "Kickoff mission could not be started.";
      await progress.addActivity("kickoff", kickoffError, "error");
      await progress.failStep("kickoff", kickoffError);
    }
  } else {
    await progress.startStep("kickoff", "Finalizing workspace bootstrap.");
    await progress.addActivity("kickoff", "Kickoff mission is disabled for this workspace.", "done");
    await progress.completeStep("kickoff", "Workspace bootstrap finished without kickoff.");
  }

  const finalNativeSnapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const workspaceId = resolveWorkspaceIdForSnapshotPath(snapshot.workspaces, targetDir);
  const nativeWorkspaceConfirmed = finalNativeSnapshot.workspaces.some((workspace) =>
    workspace.id === workspaceId || path.resolve(workspace.path) === path.resolve(targetDir)
  );
  const nativeConfirmed = createdAgentIds.every((agentId) =>
    finalNativeSnapshot.agents.some((agent) =>
      agent.id === agentId && path.resolve(agent.workspacePath) === path.resolve(targetDir)
    )
  ) && nativeWorkspaceConfirmed;
  if (!nativeConfirmed) {
    syncWarnings.push("AgentOS could not confirm the complete workspace and agent state in the live OpenClaw snapshot.");
  }
  const finalWarnings = uniqueStrings(syncWarnings);
  const outcome = !nativeConfirmed ? "unknown" : finalWarnings.length > 0 ? "partial" : "ready";

  invalidateSnapshotCache();
  clearRuntimeHistoryCache();

  return {
    workspaceId,
    workspaceName: normalized.name,
    workspacePath: targetDir,
    agentIds: createdAgentIds,
    primaryAgentId,
    agentProjections: buildWorkspaceCreateAgentProjections(createdAgentIds, enabledAgents, workspaceModelId),
    kickoffRunId,
    kickoffStatus,
    kickoffError,
    warnings: finalWarnings,
    outcome,
    nativeAccepted: true,
    nativeConfirmed,
    sidecarSynchronized: finalWarnings.length === 0
  };
}

export function formatPostCreateWorkspaceConfigSyncWarning(error: unknown) {
  const agentWarning = formatPostCreateAgentConfigSyncWarning(error);

  if (!agentWarning) {
    return null;
  }

  return "AgentOS created the workspace, but OpenClaw could not finish the agent config sync in time. Restart or refresh the OpenClaw Gateway if the workspace agent profile looks incomplete, then refresh AgentOS.";
}

function assertWorkspacePostCreateConfigSyncWarning(error: unknown) {
  const warning = formatPostCreateWorkspaceConfigSyncWarning(error);

  if (!warning) {
    throw error;
  }

  return warning;
}

export async function updateWorkspaceProject(
  input: WorkspaceUpdateInput,
  gatewayOptions: OpenClawCommandOptions = {}
) {
  const workspaceId = input.workspaceId.trim();

  if (!workspaceId) {
    throw new Error("Workspace id is required.");
  }

  const workspaceResourceId = await resolveWorkspaceLockId(workspaceId);
  return withLifecycleOperationLock({
    kind: "workspace.move",
    targetId: workspaceResourceId,
    resourceKeys: [lifecycleWorkspaceResourceKey(workspaceResourceId)],
    run: () => updateWorkspaceProjectInternal(input, gatewayOptions)
  });
}

async function resolveWorkspaceLockId(workspaceId: string) {
  try {
    const snapshot = await getMissionControlSnapshot({ includeHidden: true });
    return findWorkspaceById(snapshot.workspaces, workspaceId)?.id ?? workspaceId;
  } catch {
    return workspaceId;
  }
}

async function updateWorkspaceProjectInternal(
  input: WorkspaceUpdateInput,
  gatewayOptions: OpenClawCommandOptions = {}
) {
  const workspaceId = input.workspaceId.trim();

  if (input.plan) {
    const baseline = input.baseline ?? (await readWorkspaceEditSeed(workspaceId));
    const workspace = createWorkspaceProjectFromEditSeed(baseline);
    return applyWorkspacePlanEdits(workspace, input.plan, {
      name: input.name,
      directory: input.directory,
      baseline,
      gatewayOptions,
      recoveryGeneration: input.recoveryGeneration
    });
  }

  const snapshot = await getMissionControlSnapshot({ force: true });
  const workspace = findWorkspaceById(snapshot.workspaces, workspaceId);

  if (!workspace) {
    throw new Error("Workspace was not found.");
  }

  const targetPath = resolveWorkspaceTargetPath(workspace.path, input.name, input.directory);

  if (targetPath !== workspace.path) {
    const moved = await moveWorkspaceProjectLifecycle({
      workspace,
      snapshot,
      targetPath,
      gatewayOptions,
      recoveryGeneration: input.recoveryGeneration
    });
    if (moved.outcome !== "ready" && moved.outcome !== "partial") {
      return moved;
    }
    invalidateSnapshotCache();
    clearRuntimeHistoryCache();
    return moved;
  }

  invalidateSnapshotCache();
  clearRuntimeHistoryCache();

  return {
    workspaceId: resolveWorkspaceIdForSnapshotPath(snapshot.workspaces, targetPath, workspace.path),
    previousWorkspaceId: workspace.id,
    workspacePath: targetPath,
    outcome: "ready" as const,
    nativeAccepted: false,
    nativeConfirmed: true,
    sidecarSynchronized: true,
    warnings: []
  } satisfies WorkspaceUpdateResult;
}

async function moveWorkspaceProjectLifecycle(input: {
  workspace: WorkspaceProject;
  snapshot: MissionControlSnapshot;
  targetPath: string;
  gatewayOptions: OpenClawCommandOptions;
  recoveryGeneration?: number;
}): Promise<WorkspaceUpdateResult> {
  const previousWorkspacePath = path.resolve(input.workspace.path);
  const targetWorkspacePath = path.resolve(input.targetPath);
  const workspaceId = input.workspace.id;
  const agentIds = uniqueStrings([
    ...input.workspace.agentIds,
    ...input.snapshot.agents
      .filter((agent) => agent.workspaceId === workspaceId || path.resolve(agent.workspacePath) === previousWorkspacePath)
      .map((agent) => agent.id)
  ]);
  const initialOwnership = await readWorkspaceFilesystemOwnership(previousWorkspacePath);
  let operation = (await createOrReadLifecycleOperation({
    kind: "workspace.move",
    targetId: workspaceId,
    metadata: {
      workspaceId,
      workspacePath: previousWorkspacePath,
      previousWorkspacePath,
      targetWorkspacePath,
      filesystemOwnership: initialOwnership?.ownership ?? null,
      materialization: initialOwnership?.materialization ?? null,
      ownershipRecordedAt: initialOwnership?.recordedAt ?? null,
      directoryIdentity: initialOwnership?.directoryIdentity ?? null,
      agentIds
    }
  })).operation;

  const storedTargetPath = operation.metadata.targetWorkspacePath;
  if (storedTargetPath && path.resolve(storedTargetPath) !== targetWorkspacePath) {
    if (operation.state === "ready" && operation.result) {
      operation = await updateLifecycleOperation(operation, {
        state: "requested",
        stage: "requested",
        nativeAccepted: false,
        nativeConfirmed: false,
        sidecarSynchronized: false,
        warnings: [],
        error: null,
        result: null,
        metadata: {
          workspaceId,
          workspacePath: previousWorkspacePath,
          previousWorkspacePath,
          targetWorkspacePath,
          agentIds
        },
        items: {},
        sidecars: {}
      });
    } else {
      return finishWorkspaceMoveOperation(operation, buildWorkspaceMoveResult({
        operation,
        workspaceId,
        previousWorkspaceId: workspaceId,
        previousWorkspacePath,
        workspacePath: targetWorkspacePath,
        outcome: "unknown",
        nativeAccepted: operation.nativeAccepted,
        nativeConfirmed: false,
        sidecarSynchronized: false,
        warnings: ["A previous workspace move is still unresolved; reconcile it before requesting another target path."],
        error: { code: "workspace-move-target-conflict", message: "A previous workspace move is still unresolved." }
      }));
    }
  }

  if (operation.state === "failed" && !operation.nativeAccepted) {
    if (!isExplicitWorkspaceRecovery(input.recoveryGeneration, operation.recoveryGeneration)) {
      if (operation.result) return operation.result as WorkspaceUpdateResult;
      return finishWorkspaceMoveOperation(operation, buildWorkspaceMoveResult({
        operation,
        workspaceId,
        previousWorkspaceId: workspaceId,
        previousWorkspacePath,
        workspacePath: targetWorkspacePath,
        outcome: "failed",
        nativeAccepted: false,
        nativeConfirmed: false,
        sidecarSynchronized: false,
        warnings: ["The previous workspace move failed. An explicit recovery attempt is required before AgentOS can issue a new move request."],
        error: { code: "workspace-move-recovery-required", message: "Explicit workspace move recovery is required." }
      }));
    }
    operation = await updateLifecycleOperation(operation, {
      state: "requested",
      stage: "recovering",
      recoveryGeneration: input.recoveryGeneration,
      warnings: [],
      error: null,
      result: null,
      items: {},
      sidecars: {}
    });
  }

  if (operation.state === "ready" && operation.result) {
    const proof = await verifyWorkspaceMoveNative({
      previousWorkspacePath,
      targetWorkspacePath,
      agentIds,
      gatewayOptions: input.gatewayOptions
    });
    if (proof.confirmed) {
      return operation.result as WorkspaceUpdateResult;
    }
    return finishWorkspaceMoveOperation(operation, buildWorkspaceMoveResult({
      operation,
      workspaceId,
      previousWorkspaceId: workspaceId,
      previousWorkspacePath,
      workspacePath: targetWorkspacePath,
      outcome: "unknown",
      nativeAccepted: operation.nativeAccepted,
      nativeConfirmed: false,
      sidecarSynchronized: false,
      warnings: [proof.error ?? "OpenClaw could not re-confirm the completed workspace move."],
      error: { code: "workspace-move-state-drift", message: proof.error ?? "Workspace move state drifted." }
    }));
  }

  const requiresNativeMoveReconciliation = operation.state === "unknown" ||
    (operation.state === "failed" && operation.nativeAccepted);

  const ownershipRecord = initialOwnership ?? ownershipRecordFromLifecycleOperation(operation);
  let ownershipMigration: Awaited<ReturnType<typeof migrateWorkspaceFilesystemOwnership>> = {
    record: ownershipRecord,
    migrated: false,
    oldEvidenceRemoved: false
  };
  const warnings: string[] = [];

  const sourceStat = await lstat(previousWorkspacePath).catch(() => null);
  const targetStat = await lstat(targetWorkspacePath).catch(() => null);
  if (targetStat && !targetStat.isDirectory()) {
    return finishWorkspaceMoveOperation(operation, buildWorkspaceMoveResult({
      operation,
      workspaceId,
      previousWorkspaceId: workspaceId,
      previousWorkspacePath,
      workspacePath: targetWorkspacePath,
      outcome: "failed",
      nativeAccepted: operation.nativeAccepted,
      nativeConfirmed: false,
      sidecarSynchronized: false,
      warnings: ["The requested workspace target exists but is not a directory."],
      error: { code: "workspace-target-not-directory", message: "The requested workspace target is not a directory." }
    }));
  }

  if (sourceStat && targetStat) {
    return finishWorkspaceMoveOperation(operation, buildWorkspaceMoveResult({
      operation,
      workspaceId,
      previousWorkspaceId: workspaceId,
      previousWorkspacePath,
      workspacePath: targetWorkspacePath,
      outcome: "unknown",
      nativeAccepted: operation.nativeAccepted,
      nativeConfirmed: false,
      sidecarSynchronized: false,
      warnings: ["Both the old and target workspace directories exist; AgentOS will not guess which one is authoritative."],
      error: { code: "workspace-move-ambiguous-filesystem", message: "Both workspace move paths exist." }
    }));
  }

  if (!sourceStat && !targetStat) {
    return finishWorkspaceMoveOperation(operation, buildWorkspaceMoveResult({
      operation,
      workspaceId,
      previousWorkspaceId: workspaceId,
      previousWorkspacePath,
      workspacePath: targetWorkspacePath,
      outcome: "unknown",
      nativeAccepted: operation.nativeAccepted,
      nativeConfirmed: false,
      sidecarSynchronized: false,
      warnings: ["Neither the old nor target workspace directory exists; AgentOS will not recreate or guess the move."],
      error: { code: "workspace-move-path-missing", message: "Workspace move paths are missing." }
    }));
  }

  if (sourceStat && !targetStat) {
    operation = await updateLifecycleOperation(operation, {
      state: "running",
      stage: "moving-filesystem",
      metadata: {
        workspaceId,
        workspacePath: previousWorkspacePath,
        previousWorkspacePath,
        targetWorkspacePath,
        filesystemOwnership: ownershipRecord?.ownership ?? null,
        materialization: ownershipRecord?.materialization ?? null,
        ownershipRecordedAt: ownershipRecord?.recordedAt ?? null,
        directoryIdentity: ownershipRecord?.directoryIdentity ?? null,
        agentIds
      }
    });

    try {
      await rename(previousWorkspacePath, targetWorkspacePath);
    } catch (error) {
      const message = error instanceof Error
        ? `Unable to move workspace directory. ${safeLifecycleError(error)}`
        : "Unable to move workspace directory.";
      return finishWorkspaceMoveOperation(operation, buildWorkspaceMoveResult({
        operation,
        workspaceId,
        previousWorkspaceId: workspaceId,
        previousWorkspacePath,
        workspacePath: targetWorkspacePath,
        outcome: "failed",
        nativeAccepted: false,
        nativeConfirmed: false,
        sidecarSynchronized: false,
        warnings: [message],
        error: { code: "workspace-filesystem-move-failed", message }
      }));
    }
  } else if (!ownershipRecord) {
    const directoryIdentity = await readWorkspaceDirectoryIdentity(targetWorkspacePath).catch(() => null);
    if (
      !directoryIdentity ||
      !operation.metadata.directoryIdentity ||
      directoryIdentity.device !== operation.metadata.directoryIdentity.device ||
      directoryIdentity.inode !== operation.metadata.directoryIdentity.inode
    ) {
      return finishWorkspaceMoveOperation(operation, buildWorkspaceMoveResult({
        operation,
        workspaceId,
        previousWorkspaceId: workspaceId,
        previousWorkspacePath,
        workspacePath: targetWorkspacePath,
        outcome: "unknown",
        nativeAccepted: operation.nativeAccepted,
        nativeConfirmed: false,
        sidecarSynchronized: false,
        warnings: ["The target directory exists without enough persisted identity evidence to prove this move."],
        error: { code: "workspace-move-identity-unknown", message: "Workspace move identity could not be proven." }
      }));
    }
  }

  if (ownershipRecord) {
    try {
      ownershipMigration = await migrateWorkspaceFilesystemOwnership({
        fromPath: previousWorkspacePath,
        toPath: targetWorkspacePath,
        record: ownershipRecord
      });
      operation = await updateLifecycleOperation(operation, {
        sidecars: { "filesystem-ownership": "confirmed" },
        metadata: {
          filesystemOwnership: ownershipMigration.record?.ownership ?? null,
          materialization: ownershipMigration.record?.materialization ?? null,
          ownershipRecordedAt: ownershipMigration.record?.recordedAt ?? null,
          directoryIdentity: ownershipMigration.record?.directoryIdentity ?? operation.metadata.directoryIdentity
        }
      });
    } catch (error) {
      warnings.push(`AgentOS could not migrate workspace ownership evidence: ${safeLifecycleError(error)}.`);
      operation = await updateLifecycleOperation(operation, {
        sidecars: { "filesystem-ownership": "failed" }
      });
    }
  } else {
    operation = await updateLifecycleOperation(operation, {
      sidecars: { "filesystem-ownership": "skipped" }
    });
    warnings.push("AgentOS could not prove ownership of the moved workspace directory; it will remain conservatively preserved during cleanup.");
  }

  let nativeAccepted = operation.nativeAccepted;
  let nativeConfirmed = false;
  if (requiresNativeMoveReconciliation) {
    const proof = await verifyWorkspaceMoveNative({
      previousWorkspacePath,
      targetWorkspacePath,
      agentIds,
      gatewayOptions: input.gatewayOptions
    });
    if (!proof.confirmed) {
      const message = proof.error ?? "OpenClaw did not confirm the previous workspace configuration move.";
      return finishWorkspaceMoveOperation(operation, buildWorkspaceMoveResult({
        operation,
        workspaceId,
        previousWorkspaceId: workspaceId,
        previousWorkspacePath,
        workspacePath: targetWorkspacePath,
        outcome: "unknown",
        nativeAccepted: operation.nativeAccepted,
        nativeConfirmed: false,
        sidecarSynchronized: false,
        warnings: uniqueStrings([...warnings, message]),
        error: { code: "workspace-config-move-uncertain", message }
      }));
    }
    nativeAccepted = true;
    nativeConfirmed = true;
  }

  operation = await updateLifecycleOperation(operation, {
    state: "running",
    stage: "syncing-workspace-config",
    metadata: {
      workspaceId,
      workspacePath: targetWorkspacePath,
      previousWorkspacePath,
      targetWorkspacePath,
      agentIds
    }
  });

  const configList = await readAgentConfigList(input.snapshot, input.gatewayOptions);
  const agentIdSet = new Set(agentIds);
  const updatedConfig = configList.map((entry) => {
    const belongsToWorkspace = path.resolve(entry.workspace) === previousWorkspacePath || agentIdSet.has(entry.id);
    if (!belongsToWorkspace) return entry;
    return {
      ...entry,
      workspace: targetWorkspacePath,
      agentDir:
        typeof entry.agentDir === "string" && entry.agentDir.startsWith(`${previousWorkspacePath}${path.sep}`)
          ? path.join(targetWorkspacePath, path.relative(previousWorkspacePath, entry.agentDir))
          : entry.agentDir
    };
  });
  const configChanged = updatedConfig.some((entry, index) => JSON.stringify(entry) !== JSON.stringify(configList[index]));

  if (requiresNativeMoveReconciliation) {
    nativeAccepted = true;
    nativeConfirmed = true;
  } else if (configChanged) {
    operation = await updateLifecycleOperation(operation, {
      stage: "native-mutation",
      mutationAttemptCount: operation.mutationAttemptCount + 1,
      lastMutationAt: new Date().toISOString()
    });
    const execution = await executeNativeMutationWithVerification({
      operation: "workspace.move.config",
      mutate: () => writeAgentConfigList(updatedConfig, input.gatewayOptions),
      verify: async () => (await verifyWorkspaceMoveNative({
        previousWorkspacePath,
        targetWorkspacePath,
        agentIds,
        gatewayOptions: input.gatewayOptions
      })).confirmed
    });
    nativeAccepted = execution.outcome !== "failed" || execution.classification.requestSent === true;
    if (execution.outcome !== "succeeded") {
      const message = execution.classification.message || "OpenClaw did not confirm the workspace configuration move.";
      const outcome = execution.outcome;
      return finishWorkspaceMoveOperation(operation, buildWorkspaceMoveResult({
        operation,
        workspaceId,
        previousWorkspaceId: workspaceId,
        previousWorkspacePath,
        workspacePath: targetWorkspacePath,
        outcome,
        nativeAccepted,
        nativeConfirmed: false,
        sidecarSynchronized: false,
        warnings: uniqueStrings([...warnings, message]),
        error: { code: outcome === "unknown" ? "workspace-config-move-uncertain" : "workspace-config-move-failed", message }
      }));
    }
    nativeConfirmed = true;
  } else {
    const proof = await verifyWorkspaceMoveNative({
      previousWorkspacePath,
      targetWorkspacePath,
      agentIds,
      gatewayOptions: input.gatewayOptions
    });
    if (!proof.confirmed) {
      const message = proof.error ?? "OpenClaw did not confirm the workspace configuration move.";
      if (operation.nativeAccepted || operation.state === "unknown") {
        return finishWorkspaceMoveOperation(operation, buildWorkspaceMoveResult({
          operation,
          workspaceId,
          previousWorkspaceId: workspaceId,
          previousWorkspacePath,
          workspacePath: targetWorkspacePath,
          outcome: "unknown",
          nativeAccepted: operation.nativeAccepted,
          nativeConfirmed: false,
          sidecarSynchronized: false,
          warnings: uniqueStrings([...warnings, message]),
          error: { code: "workspace-config-move-uncertain", message }
        }));
      }
      return finishWorkspaceMoveOperation(operation, buildWorkspaceMoveResult({
        operation,
        workspaceId,
        previousWorkspaceId: workspaceId,
        previousWorkspacePath,
        workspacePath: targetWorkspacePath,
        outcome: "failed",
        nativeAccepted: false,
        nativeConfirmed: false,
        sidecarSynchronized: false,
        warnings: uniqueStrings([...warnings, message]),
        error: { code: "workspace-config-move-not-confirmed", message }
      }));
    }
    nativeAccepted = true;
    nativeConfirmed = true;
  }

  operation = await updateLifecycleOperation(operation, {
    state: "running",
    stage: "workspace-move-confirmed",
    nativeAccepted,
    nativeConfirmed,
    lastReconciledAt: new Date().toISOString(),
    lastConfirmedNativeStateAt: new Date().toISOString()
  });

  const finalSnapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const finalAgentPaths = finalSnapshot.agents.filter((agent) => agentIds.includes(agent.id));
  if (agentIds.length > 0 && (finalAgentPaths.length !== agentIds.length || finalAgentPaths.some((agent) => path.resolve(agent.workspacePath) !== targetWorkspacePath))) {
    const message = "OpenClaw did not retain the moved workspace path in its authoritative snapshot.";
    return finishWorkspaceMoveOperation(operation, buildWorkspaceMoveResult({
      operation,
      workspaceId,
      previousWorkspaceId: workspaceId,
      previousWorkspacePath,
      workspacePath: targetWorkspacePath,
      outcome: "unknown",
      nativeAccepted,
      nativeConfirmed: false,
      sidecarSynchronized: false,
      warnings: uniqueStrings([...warnings, message]),
      error: { code: "workspace-move-state-regressed", message }
    }));
  }

  const finalWarnings = uniqueStrings(warnings);
  const outcome: LifecycleOperationOutcome = finalWarnings.length > 0 ? "partial" : "ready";
  const result = buildWorkspaceMoveResult({
    operation,
    workspaceId: resolveWorkspaceIdForSnapshotPath(finalSnapshot.workspaces, targetWorkspacePath, previousWorkspacePath),
    previousWorkspaceId: workspaceId,
    previousWorkspacePath,
    workspacePath: targetWorkspacePath,
    outcome,
    nativeAccepted,
    nativeConfirmed: true,
    sidecarSynchronized: finalWarnings.length === 0,
    warnings: finalWarnings,
    filesystem: {
      ownership: resolveWorkspaceFilesystemOwnership(ownershipMigration.record ?? ownershipRecord),
      migrated: ownershipMigration.migrated
    }
  });
  return finishWorkspaceMoveOperation(operation, result);
}

async function verifyWorkspaceMoveNative(input: {
  previousWorkspacePath: string;
  targetWorkspacePath: string;
  agentIds: string[];
  gatewayOptions: OpenClawCommandOptions;
}) {
  try {
    const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    const configList = await readAgentConfigList(undefined, input.gatewayOptions);
    const agentIdSet = new Set(input.agentIds);
    const relevantConfig = configList.filter((entry) =>
      agentIdSet.has(entry.id) ||
      path.resolve(entry.workspace) === path.resolve(input.previousWorkspacePath) ||
      path.resolve(entry.workspace) === path.resolve(input.targetWorkspacePath)
    );
    const configConfirmed = relevantConfig.every((entry) => path.resolve(entry.workspace) === path.resolve(input.targetWorkspacePath));
    const nativeAgents = snapshot.agents.filter((agent) => input.agentIds.includes(agent.id));
    const nativeConfirmed = input.agentIds.length === 0 || (
      nativeAgents.length === input.agentIds.length &&
      nativeAgents.every((agent) => path.resolve(agent.workspacePath) === path.resolve(input.targetWorkspacePath))
    );
    return {
      confirmed: configConfirmed && nativeConfirmed,
      error: configConfirmed && nativeConfirmed
        ? null
        : "OpenClaw's authoritative config or agent snapshot still references the previous workspace path."
    };
  } catch (error) {
    return {
      confirmed: false,
      error: safeLifecycleError(error)
    };
  }
}

function ownershipRecordFromLifecycleOperation(operation: StoredLifecycleOperation): WorkspaceFilesystemOwnershipRecord | null {
  const ownership = operation.metadata.filesystemOwnership;
  const directoryIdentity = operation.metadata.directoryIdentity;
  const materialization = operation.metadata.materialization;
  if (
    !isKnownWorkspaceFilesystemOwnership(ownership) ||
    !directoryIdentity ||
    typeof directoryIdentity.device !== "string" ||
    typeof directoryIdentity.inode !== "string" ||
    !isKnownWorkspaceMaterialization(materialization) ||
    typeof operation.metadata.previousWorkspacePath !== "string"
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    workspacePath: path.resolve(operation.metadata.previousWorkspacePath),
    ownership,
    materialization,
    directoryIdentity,
    recordedAt: operation.metadata.ownershipRecordedAt ?? operation.createdAt
  };
}

function isKnownWorkspaceFilesystemOwnership(value: string | null | undefined): value is Exclude<WorkspaceFilesystemOwnershipRecord["ownership"], "unknown"> {
  return value === "agentos-created-empty" || value === "agentos-created-clone" || value === "user-selected-existing" || value === "external-imported";
}

function isKnownWorkspaceMaterialization(value: string | null | undefined): value is WorkspaceFilesystemOwnershipRecord["materialization"] {
  return value === "empty" || value === "clone" || value === "existing";
}

function buildWorkspaceMoveResult(input: {
  operation: StoredLifecycleOperation;
  workspaceId: string;
  previousWorkspaceId: string;
  previousWorkspacePath: string;
  workspacePath: string;
  outcome: LifecycleOperationOutcome;
  nativeAccepted: boolean;
  nativeConfirmed: boolean;
  sidecarSynchronized: boolean;
  warnings: string[];
  error?: { code: string; message: string };
  filesystem?: WorkspaceUpdateResult["filesystem"];
}): WorkspaceUpdateResult {
  return {
    workspaceId: input.workspaceId,
    previousWorkspaceId: input.previousWorkspaceId,
    previousWorkspacePath: input.previousWorkspacePath,
    workspacePath: input.workspacePath,
    outcome: input.outcome,
    operationId: input.operation.operationId,
    recoveryGeneration: input.operation.recoveryGeneration,
    nativeAccepted: input.nativeAccepted,
    nativeConfirmed: input.nativeConfirmed,
    sidecarSynchronized: input.sidecarSynchronized,
    warnings: uniqueStrings(input.warnings),
    ...(input.error ? { error: input.error } : {}),
    ...(input.filesystem ? { filesystem: input.filesystem } : {})
  };
}

async function finishWorkspaceMoveOperation(
  operation: StoredLifecycleOperation,
  result: WorkspaceUpdateResult
) {
  await updateLifecycleOperation(operation, {
    state: result.outcome,
    stage: result.outcome === "ready" ? "complete" : result.outcome === "partial" ? "cleanup-partial" : "reconciling-native-state",
    nativeAccepted: result.nativeAccepted ?? operation.nativeAccepted,
    nativeConfirmed: result.nativeConfirmed ?? operation.nativeConfirmed,
    sidecarSynchronized: result.sidecarSynchronized ?? false,
    warnings: result.warnings ?? [],
    result,
    error: result.error ?? null
  });
  return result;
}

export async function deleteWorkspaceProject(
  input: WorkspaceDeleteInput,
  gatewayOptions: OpenClawCommandOptions = {}
): Promise<WorkspaceDeleteResult> {
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) {
    throw new Error("Workspace id is required.");
  }

  const workspaceResourceId = await resolveWorkspaceLockId(workspaceId);
  return withLifecycleOperationLock({
    kind: "workspace.delete",
    targetId: workspaceResourceId,
    resourceKeys: [lifecycleWorkspaceResourceKey(workspaceResourceId)],
    run: () => deleteWorkspaceProjectInternal(input, gatewayOptions)
  });
}

async function deleteWorkspaceProjectInternal(
  input: WorkspaceDeleteInput,
  gatewayOptions: OpenClawCommandOptions = {}
): Promise<WorkspaceDeleteResult> {
  const workspaceId = input.workspaceId.trim();

  if (!workspaceId) {
    throw new Error("Workspace id is required.");
  }

  let operation = (await createOrReadLifecycleOperation({
    kind: "workspace.delete",
    targetId: workspaceId,
    metadata: { workspaceId }
  })).operation;

  const failedItemIds = Object.entries(operation.items)
    .filter(([, state]) => state === "failed")
    .map(([agentId]) => agentId);
  if (
    (operation.state === "failed" && !operation.nativeAccepted) ||
    (failedItemIds.length > 0 && !operation.nativeAccepted)
  ) {
    if (!isExplicitWorkspaceRecovery(input.recoveryGeneration, operation.recoveryGeneration)) {
      if (operation.result) return operation.result as WorkspaceDeleteResult;
      throw new Error(
        "The previous AgentOS workspace deletion failed. An explicit recovery attempt is required before AgentOS can issue a new delete request."
      );
    }
    const retainedItems = Object.fromEntries(
      Object.entries(operation.items).filter(([, state]) => state === "confirmed" || state === "skipped")
    );
    operation = await updateLifecycleOperation(operation, {
      state: "requested",
      stage: "recovering",
      recoveryGeneration: input.recoveryGeneration,
      warnings: [],
      error: null,
      result: null,
      items: retainedItems,
      sidecars: {}
    });
  }

  if (operation.state === "ready" && operation.result) {
    const liveSnapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    const storedResult = operation.result as unknown as WorkspaceDeleteResult;
    const stillRegistered = liveSnapshot.workspaces.some((entry) =>
      entry.id === workspaceId || path.resolve(entry.path) === path.resolve(storedResult.workspacePath)
    ) || liveSnapshot.agents.some((agent) => storedResult.deletedAgentIds.includes(agent.id));
    if (!stillRegistered) {
      return storedResult;
    }
    operation = await updateLifecycleOperation(operation, {
      state: "requested",
      stage: "requested",
      nativeAccepted: false,
      nativeConfirmed: false,
      sidecarSynchronized: false,
      warnings: [],
      error: null,
      result: null,
      metadata: {
        workspaceId,
        workspacePath: null,
        agentIds: [],
        channelIds: []
      },
      items: {}
    });
  }

  operation = await updateLifecycleOperation(operation, {
    state: "running",
    stage: "reading-native-state"
  });

  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const workspace = findWorkspaceById(snapshot.workspaces, workspaceId);
  const workspacePath = workspace?.path ?? operation.metadata.workspacePath ?? null;

  if (!workspace && !workspacePath) {
    operation = await updateLifecycleOperation(operation, {
      state: "failed",
      error: { code: "workspace-not-found", message: "Workspace was not found." }
    });
    throw new Error("Workspace was not found.");
  }

  const resolvedWorkspaceId = workspace?.id ?? operation.metadata.workspaceId ?? workspaceId;
  const workspaceAgents = workspace
    ? snapshot.agents.filter((agent) => agent.workspaceId === workspace.id)
    : snapshot.agents.filter((agent) => agent.workspaceId === resolvedWorkspaceId || path.resolve(agent.workspacePath) === path.resolve(workspacePath!));
  const storedAgentIds = operation.metadata.agentIds ?? [];
  const agentIds = uniqueStrings([...storedAgentIds, ...workspaceAgents.map((agent) => agent.id)]);
  const runtimeCount = workspace
    ? snapshot.runtimes.filter((runtime) => runtime.workspaceId === workspace.id).length
    : 0;
  const workspaceChannelIds = uniqueStrings([
    ...(operation.metadata.channelIds ?? []),
    ...snapshot.channelRegistry.channels
      .filter((channel) => channel.workspaces.some((binding) => binding.workspaceId === resolvedWorkspaceId))
      .map((channel) => channel.id)
  ]);
  const adapter = getOpenClawAdapter();
  const warnings: string[] = [];

  operation = await updateLifecycleOperation(operation, {
    stage: "deleting-agents",
    metadata: {
      workspaceId: resolvedWorkspaceId,
      workspacePath,
      agentIds,
      channelIds: workspaceChannelIds
    }
  });

  for (const agentId of agentIds) {
    if (operation.items[agentId] === "confirmed" || operation.items[agentId] === "skipped") {
      continue;
    }

    if (operation.items[agentId] === "failed") {
      if (!operation.nativeAccepted) {
        return finalizeWorkspaceDeleteOperation(operation, {
          workspaceId: resolvedWorkspaceId,
          workspacePath: workspacePath!,
          deletedAgentIds: agentIds.filter((id) => operation.items[id] === "confirmed"),
          deletedRuntimeCount: runtimeCount,
          filesystem: { ownership: "unknown", action: "preserved" },
          outcome: "failed",
          nativeAccepted: false,
          nativeConfirmed: false,
          sidecarSynchronized: false,
          warnings: [...warnings, `Deletion of agent ${agentId} requires explicit recovery.`],
          error: { code: "native-agent-removal-failed", message: `Deletion of agent ${agentId} requires explicit recovery.` }
        });
      }
      operation = await updateLifecycleOperation(operation, {
        items: { [agentId]: "unknown" }
      });
    }

    if (operation.items[agentId] !== "unknown") {
      const currentSnapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
      if (!currentSnapshot.agents.some((agent) => agent.id === agentId)) {
        operation = await updateLifecycleOperation(operation, {
          items: { [agentId]: "confirmed" },
          nativeConfirmed: true,
          lastReconciledAt: new Date().toISOString(),
          lastConfirmedNativeStateAt: new Date().toISOString()
        });
        continue;
      }
    }

    if (operation.items[agentId] === "unknown") {
      const reread = await reconcileLifecycleState({
        read: () => getMissionControlSnapshot({ force: true, includeHidden: true }),
        isConfirmed: (current) => !current.agents.some((agent) => agent.id === agentId)
      });
      if (reread.outcome !== "confirmed") {
        return finalizeWorkspaceDeleteOperation(operation, {
          workspaceId: resolvedWorkspaceId,
          workspacePath: workspacePath!,
          deletedAgentIds: agentIds.filter((id) => operation.items[id] === "confirmed"),
          deletedRuntimeCount: runtimeCount,
          filesystem: { ownership: "unknown", action: "preserved" },
          outcome: "unknown",
          nativeAccepted: operation.nativeAccepted,
          nativeConfirmed: false,
          sidecarSynchronized: false,
          warnings: [...warnings, `OpenClaw has not confirmed removal of agent ${agentId}.`],
          error: { code: "native-agent-removal-uncertain", message: "OpenClaw still reports an agent for this workspace." }
        });
      }
      operation = await updateLifecycleOperation(operation, {
        items: { [agentId]: "confirmed" },
        lastReconciledAt: new Date().toISOString(),
        lastConfirmedNativeStateAt: new Date().toISOString()
      });
      continue;
    }

    operation = await updateLifecycleOperation(operation, {
      stage: "native-mutation",
      mutationAttemptCount: operation.mutationAttemptCount + 1,
      lastMutationAt: new Date().toISOString()
    });
    const execution = await executeNativeMutationWithVerification({
      operation: "workspace.delete.agent",
      mutate: () => adapter.deleteAgent(agentId, gatewayOptions),
      verify: async () => {
        const reread = await reconcileLifecycleState({
          read: () => getMissionControlSnapshot({ force: true, includeHidden: true }),
          isConfirmed: (current) => !current.agents.some((agent) => agent.id === agentId)
        });
        return reread.outcome === "confirmed";
      }
    });

    const mutationAccepted = execution.outcome !== "failed" || execution.classification.requestSent === true;
    if (execution.outcome === "succeeded") {
      operation = await updateLifecycleOperation(operation, {
        items: { [agentId]: "confirmed" },
        nativeAccepted: mutationAccepted || operation.nativeAccepted,
        nativeConfirmed: true,
        lastReconciledAt: new Date().toISOString(),
        lastConfirmedNativeStateAt: new Date().toISOString()
      });
      continue;
    }

    const message = execution.classification.message || `OpenClaw could not confirm removal of agent ${agentId}.`;
    operation = await updateLifecycleOperation(operation, {
      state: execution.outcome === "unknown" ? "unknown" : "failed",
      stage: "reconciling-native-state",
      nativeAccepted: mutationAccepted || operation.nativeAccepted,
      nativeConfirmed: false,
      lastReconciledAt: new Date().toISOString(),
      items: { [agentId]: execution.outcome === "unknown" ? "unknown" : "failed" },
      error: { code: execution.outcome === "unknown" ? "native-agent-removal-uncertain" : "native-agent-removal-failed", message }
    });
    return finalizeWorkspaceDeleteOperation(operation, {
      workspaceId: resolvedWorkspaceId,
      workspacePath: workspacePath!,
      deletedAgentIds: agentIds.filter((id) => operation.items[id] === "confirmed"),
      deletedRuntimeCount: runtimeCount,
      filesystem: { ownership: "unknown", action: "preserved" },
      outcome: execution.outcome,
      nativeAccepted: mutationAccepted || operation.nativeAccepted,
      nativeConfirmed: false,
      sidecarSynchronized: false,
      warnings: [...warnings, message],
      error: { code: execution.outcome === "unknown" ? "native-agent-removal-uncertain" : "native-agent-removal-failed", message }
    });
  }

  operation = await updateLifecycleOperation(operation, {
    stage: "reconciling-native-state",
    nativeAccepted: agentIds.length > 0 || operation.nativeAccepted
  });
  const nativeRemoval = await reconcileLifecycleState({
    read: () => getMissionControlSnapshot({ force: true, includeHidden: true }),
    isConfirmed: (current) =>
      !current.workspaces.some((entry) => entry.id === resolvedWorkspaceId || (workspacePath && path.resolve(entry.path) === path.resolve(workspacePath))) &&
      !current.agents.some((agent) => agentIds.includes(agent.id))
  });

  if (nativeRemoval.outcome !== "confirmed") {
    const message = nativeRemoval.error ?? "OpenClaw still reports this workspace in the live workspace registry.";
    operation = await updateLifecycleOperation(operation, {
      state: "unknown",
      stage: "reconciling-native-state",
      nativeConfirmed: false,
      error: { code: "native-workspace-removal-uncertain", message }
    });
    return finalizeWorkspaceDeleteOperation(operation, {
      workspaceId: resolvedWorkspaceId,
      workspacePath: workspacePath!,
      deletedAgentIds: agentIds.filter((id) => operation.items[id] === "confirmed"),
      deletedRuntimeCount: runtimeCount,
      filesystem: { ownership: "unknown", action: "preserved" },
      outcome: "unknown",
      nativeAccepted: operation.nativeAccepted,
      nativeConfirmed: false,
      sidecarSynchronized: false,
      warnings: [...warnings, message],
      error: { code: "native-workspace-removal-uncertain", message }
    });
  }

  operation = await updateLifecycleOperation(operation, {
    stage: "native-removal-confirmed",
    nativeConfirmed: true
  });

  operation = await updateLifecycleOperation(operation, { stage: "disconnecting-bindings" });
  const sidecarResult = await runLifecycleSidecarSteps([
    ...workspaceChannelIds.map((channelId) => ({
      id: `channel:${channelId}`,
      label: `disconnect channel ${channelId}`,
      run: () => disconnectWorkspaceChannel({
        workspaceId: resolvedWorkspaceId,
        channelId
      })
    })),
    {
      id: "workspace-agent-config",
      label: "finish workspace config cleanup",
      run: () => removeWorkspaceAgentConfigEntries(workspacePath!, new Set(agentIds), gatewayOptions)
    }
  ], {
    completed: operation.sidecars,
    onSuccess: async (stepId) => {
      operation = await updateLifecycleOperation(operation, {
        sidecars: { [stepId]: "confirmed" }
      });
    },
    onFailure: async (stepId) => {
      operation = await updateLifecycleOperation(operation, {
        sidecars: { [stepId]: "failed" }
      });
    }
  });
  warnings.push(...sidecarResult.warnings);

  operation = await updateLifecycleOperation(operation, { stage: "sidecar-sync" });

  clearMissionControlCaches();
  const verifiedSnapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const workspaceStillRegistered = verifiedSnapshot.workspaces.some(
    (entry) => entry.id === resolvedWorkspaceId || path.resolve(entry.path) === path.resolve(workspacePath!)
  );
  const agentStillRegistered = verifiedSnapshot.agents.some((agent) => agentIds.includes(agent.id));

  if (workspaceStillRegistered || agentStillRegistered) {
    const message = "OpenClaw still reports this workspace or one of its agents after cleanup.";
    operation = await updateLifecycleOperation(operation, {
      state: "unknown",
      stage: "reconciling-native-state",
      nativeConfirmed: false,
      error: { code: "native-state-regressed", message }
    });
    return finalizeWorkspaceDeleteOperation(operation, {
      workspaceId: resolvedWorkspaceId,
      workspacePath: workspacePath!,
      deletedAgentIds: agentIds.filter((id) => operation.items[id] === "confirmed"),
      deletedRuntimeCount: runtimeCount,
      filesystem: { ownership: "unknown", action: "preserved" },
      outcome: "unknown",
      nativeAccepted: operation.nativeAccepted,
      nativeConfirmed: false,
      sidecarSynchronized: false,
      warnings: [...warnings, message],
      error: { code: "native-state-regressed", message }
    });
  }

  operation = await updateLifecycleOperation(operation, {
    stage: "filesystem-cleanup",
    nativeConfirmed: true
  });
  const ownershipRecord = await readWorkspaceFilesystemOwnership(workspacePath!);
  const ownership = resolveWorkspaceFilesystemOwnership(ownershipRecord);
  const filesystemDecision = decideWorkspaceFilesystemCleanup({
    nativeConfirmed: true,
    ownership
  });
  let filesystemAction: WorkspaceDeleteResult["filesystem"]["action"] = "preserved";

  if (filesystemDecision.action === "delete") {
    try {
      await rm(workspacePath!, { recursive: true, force: true });
      filesystemAction = "deleted";
    } catch (error) {
      filesystemAction = "failed";
      warnings.push(`AgentOS could not remove its owned workspace files: ${safeLifecycleError(error)}.`);
    }
  } else {
    warnings.push(
      filesystemDecision.reason === "native-state-not-confirmed"
        ? "The workspace folder was preserved because OpenClaw removal was not confirmed."
        : "The workspace folder was preserved because AgentOS could not prove that it owns the directory."
    );
  }

  clearMissionControlCaches();
  const outcome = warnings.length > 0 ? "partial" : "ready";
  const result = {
    workspaceId: resolvedWorkspaceId,
    workspacePath: workspacePath!,
    deletedAgentIds: agentIds,
    deletedRuntimeCount: runtimeCount,
    filesystem: { ownership, action: filesystemAction },
    outcome,
    operationId: operation.operationId,
    nativeAccepted: operation.nativeAccepted,
    nativeConfirmed: true,
    sidecarSynchronized: warnings.length === 0,
    warnings
  } satisfies WorkspaceDeleteResult;
  await updateLifecycleOperation(operation, {
    state: outcome,
    stage: outcome === "partial" ? "cleanup-partial" : "complete",
    nativeConfirmed: true,
    sidecarSynchronized: warnings.length === 0,
    warnings,
    result: result as unknown,
    error: null
  });
  return result;
}

function finalizeWorkspaceDeleteOperation(
  operation: StoredLifecycleOperation,
  result: WorkspaceDeleteResult
) {
  return updateLifecycleOperation(operation, {
    state: result.outcome === "ready" ? "ready" : result.outcome,
    stage: result.outcome === "ready"
      ? "complete"
      : result.outcome === "partial"
        ? "cleanup-partial"
        : "reconciling-native-state",
    nativeAccepted: result.nativeAccepted ?? operation.nativeAccepted,
    nativeConfirmed: result.nativeConfirmed ?? operation.nativeConfirmed,
    sidecarSynchronized: result.sidecarSynchronized ?? false,
    warnings: result.warnings ?? operation.warnings,
    result,
    error: result.outcome === "ready" ? null : operation.error
  }).then(() => result);
}

function safeLifecycleError(error: unknown) {
  return error instanceof Error ? redactSecretText(error.message).replace(/[\r\n]+/g, " ").slice(0, 240) : "unknown error";
}

export async function readWorkspaceEditSeed(workspaceId: string): Promise<WorkspaceEditSeed> {
  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const workspace = findWorkspaceById(snapshot.workspaces, workspaceId);

  if (!workspace) {
    throw new Error("Workspace was not found.");
  }

  const manifest = await readWorkspaceProjectManifest(workspace.path);
  const displayName = manifest.name ?? workspace.name;
  const workspaceAgents = snapshot.agents.filter((agent) => agent.workspaceId === workspace.id);
  const configuredSkills = uniqueStrings(workspaceAgents.flatMap((agent) => agent.skills));
  const configuredTools = uniqueStrings(workspaceAgents.flatMap((agent) => agent.tools));
  const template = manifest.template ?? workspace.bootstrap.template ?? "software";
  const materialization = manifest.materialization ?? { mode: "empty" as const };
  const sourceMode = materializationToWorkspaceSourceMode(materialization);
  const teamPreset = manifest.teamPreset ?? (workspaceAgents.length <= 1 ? "solo" : "core");
  const modelProfile = manifest.modelProfile ?? "balanced";
  const rules = manifest.rules ?? DEFAULT_WORKSPACE_RULES;
  const bootstrapProfileCache = await buildWorkspaceBootstrapProfileCache(
    workspace.path,
    manifest.template,
    manifest.rules ?? DEFAULT_WORKSPACE_RULES
  );
  const bootstrapProfile = await readAgentBootstrapProfile(workspace.path, {
    agentId: workspaceAgents[0]?.id ?? workspace.id,
    agentName: workspaceAgents[0]?.name ?? displayName,
    configuredSkills,
    configuredTools,
    template,
    rules,
    workspaceBootstrapProfile: bootstrapProfileCache
  });
  const agents =
    manifest.agents.length > 0
      ? manifest.agents.map((entry) => {
          const currentAgent = findMatchingWorkspaceAgent(workspaceAgents, workspace.slug, entry.id);
          const resolvedPolicy = resolveAgentPolicy(
            entry.policy?.preset ?? currentAgent?.policy.preset ?? DEFAULT_AGENT_PRESET,
            entry.policy ?? currentAgent?.policy
          );

          return {
            id: entry.id,
            role: entry.role ?? formatAgentPresetLabel(resolvedPolicy.preset),
            name: entry.name ?? currentAgent?.name ?? entry.role ?? entry.id,
            enabled: entry.enabled,
            emoji: entry.emoji ?? currentAgent?.identity.emoji,
            theme: entry.theme ?? currentAgent?.identity.theme,
            skillId: entry.skillId ?? undefined,
            modelId:
              entry.modelId ??
              (currentAgent?.modelId && currentAgent.modelId !== "unassigned" ? currentAgent.modelId : undefined),
            isPrimary: entry.isPrimary,
            policy: resolvedPolicy,
            channelIds: entry.channelIds ?? [],
            heartbeat: {
              enabled: currentAgent?.heartbeat.enabled ?? false,
              ...(currentAgent?.heartbeat.every ? { every: currentAgent.heartbeat.every } : {})
            }
          } satisfies WorkspaceAgentBlueprintInput;
        })
      : buildDefaultWorkspaceAgents(template, teamPreset, displayName);
  const scaffoldDocuments = buildWorkspaceScaffoldDocuments({
    name: displayName,
    brief: bootstrapProfile.purpose || displayName,
    template,
    sourceMode,
    materialization,
    rules,
    agents,
    toolExamples: await detectWorkspaceToolExamples(workspace.path),
    docOverrides: [],
    knowledgeSources: manifest.knowledgeSources
  });
  const docOverrides: WorkspaceDocOverride[] = [];
  const scaffoldPathSet = new Set(scaffoldDocuments.map((document) => document.path));
  const editableDocPaths = await collectWorkspaceEditableDocPaths(workspace.path);

  for (const document of scaffoldDocuments) {
    const filePath = path.join(workspace.path, document.path);

    try {
      const currentContent = await readFile(filePath, "utf8");

      if (currentContent !== document.baseContent) {
        docOverrides.push({
          path: document.path,
          content: currentContent
        });
      }
    } catch {
      continue;
    }
  }

  for (const relativePath of editableDocPaths) {
    if (scaffoldPathSet.has(relativePath)) {
      continue;
    }

    const filePath = path.join(workspace.path, relativePath);

    try {
      const currentContent = await readFile(filePath, "utf8");
      docOverrides.push({
        path: relativePath,
        content: currentContent
      });
    } catch {
      continue;
    }
  }

  return {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    name: displayName,
    directory: workspace.path,
    template,
    materialization,
    sourceMode,
    teamPreset,
    modelProfile,
    modelId: workspace.modelIds[0] && workspace.modelIds[0] !== "unassigned" ? workspace.modelIds[0] : undefined,
    rules,
    docOverrides,
    agents,
    brief: bootstrapProfile.purpose || displayName,
    knowledgeSources: manifest.knowledgeSources
  };
}

function findMatchingWorkspaceAgent(
  agents: OpenClawAgent[],
  workspaceSlug: string,
  agentKey: string
) {
  const normalizedKey = slugify(agentKey);
  const workspacePrefix = `${workspaceSlug}-`;

  return (
    agents.find((agent) => agent.id === createWorkspaceAgentIdFromProvisioning(workspaceSlug, agentKey)) ??
    agents.find((agent) => agent.id === `${workspacePrefix}${normalizedKey}`) ??
    agents.find((agent) => normalizedKey.length > 0 && agent.id.endsWith(`-${normalizedKey}`)) ??
    agents.find((agent) => agent.id === normalizedKey) ??
    null
  );
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isExplicitWorkspaceRecovery(requestedGeneration: number | undefined, currentGeneration: number) {
  return Number.isInteger(requestedGeneration) && requestedGeneration === currentGeneration + 1;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function applyWorkspacePlanEdits(
  workspace: WorkspaceProject,
  plan: WorkspacePlan,
  input: {
    name?: string;
    directory?: string;
    baseline: WorkspaceEditSeed;
    gatewayOptions?: OpenClawCommandOptions;
    recoveryGeneration?: number;
  }
) {
  const desiredName = normalizeOptionalValue(input.name) ?? normalizeOptionalValue(plan.workspace.name) ?? workspace.name;
  const requestedDirectory = normalizeOptionalValue(input.directory);
  const baselineDirectory = normalizeOptionalValue(input.baseline.directory) ?? workspace.path;
  const baselineName = normalizeOptionalValue(input.baseline.name) ?? workspace.name;
  const baselineBrief = normalizeOptionalValue(input.baseline.brief) ?? "";
  const desiredBrief = normalizeOptionalValue(plan.company.mission) ?? normalizeOptionalValue(plan.product.offer) ?? "";
  const currentDocOverrides = normalizeWorkspaceDocOverrides(plan.workspace.docOverrides);
  const baselineDocOverrides = normalizeWorkspaceDocOverrides(input.baseline.docOverrides);
  const currentDocOverrideMap = new Map(currentDocOverrides.map((entry) => [entry.path, entry.content]));
  const baselineDocOverrideMap = new Map(baselineDocOverrides.map((entry) => [entry.path, entry.content]));
  const currentEnabledAgents = plan.team.persistentAgents.filter((agent) => agent.enabled);
  const baselineEnabledAgents = input.baseline.agents.filter((agent) => agent.enabled);
  const nameChanged = desiredName.trim() !== baselineName.trim();
  const scaffoldInputsChanged =
    nameChanged ||
    desiredBrief !== baselineBrief ||
    plan.workspace.template !== input.baseline.template ||
    !workspaceMaterializationsEqual(plan.workspace.materialization, input.baseline.materialization) ||
    !areWorkspaceCreateRulesEqual(plan.workspace.rules, input.baseline.rules) ||
    !areWorkspaceAgentsEqual(currentEnabledAgents, baselineEnabledAgents);
  const directoryChanged = Boolean(requestedDirectory && requestedDirectory !== baselineDirectory);
  const targetPath = directoryChanged
    ? resolveWorkspaceTargetPath(workspace.path, undefined, requestedDirectory)
    : nameChanged
      ? resolveWorkspaceTargetPath(workspace.path, desiredName, undefined)
      : workspace.path;
  const workspaceRelocated = targetPath !== workspace.path;
  const snapshot = workspaceRelocated
    ? await getMissionControlSnapshot({ force: true, includeHidden: true })
    : null;
  let moveLifecycle: WorkspaceUpdateResult | null = null;

  if (workspaceRelocated) {
    moveLifecycle = await moveWorkspaceProjectLifecycle({
      workspace,
      snapshot: snapshot ?? await getMissionControlSnapshot({ force: true, includeHidden: true }),
      targetPath,
      gatewayOptions: input.gatewayOptions ?? {},
      recoveryGeneration: input.recoveryGeneration
    });
    if (moveLifecycle.outcome !== "ready" && moveLifecycle.outcome !== "partial") {
      return moveLifecycle;
    }
  }

  const currentWorkspacePath = targetPath;
  const projectManifestPath = path.join(currentWorkspacePath, ".openclaw", "project.json");
  let existingManifest: unknown = {};
  let createdAt = new Date().toISOString();
  let hidden = false;
  let systemTag: string | null = null;

  try {
    const raw = await readFile(projectManifestPath, "utf8");
    const parsed = JSON.parse(raw);
    existingManifest = parsed;

    if (isObjectRecord(parsed)) {
      createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : createdAt;
      hidden = parsed.hidden === true;
      systemTag = typeof parsed.systemTag === "string" ? parsed.systemTag : null;
    }
  } catch {
    // Ignore missing or unreadable metadata and write a fresh manifest below.
  }

  const manifestAgents = plan.team.persistentAgents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    enabled: agent.enabled,
    emoji: normalizeOptionalValue(agent.emoji) ?? null,
    theme: normalizeOptionalValue(agent.theme) ?? null,
    isPrimary: Boolean(agent.isPrimary),
    skillId: normalizeOptionalValue(agent.skillId) ?? null,
    modelId: normalizeOptionalValue(agent.modelId) ?? null,
    policy: agent.policy ?? null,
    channelIds: Array.from(
      new Set(
        (agent.channelIds ?? [])
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter((entry) => Boolean(entry))
      )
    )
  }));
  const teamPreset: WorkspaceTeamPreset =
    manifestAgents.length <= 1
      ? "solo"
      : manifestAgents.every((agent) => agent.enabled)
        ? "core"
        : "custom";
  const projectManifest = serializeWorkspaceProjectManifestRecord(existingManifest, {
    slug: slugify(path.basename(currentWorkspacePath)),
    name: desiredName,
    directory: currentWorkspacePath,
    icon: getWorkspaceTemplateMeta(plan.workspace.template).icon,
    createdAt,
    updatedAt: new Date().toISOString(),
    materialization: plan.workspace.materialization,
    knowledgeSources: plan.knowledge.sources,
    template: plan.workspace.template,
    teamPreset,
    modelProfile: plan.workspace.modelProfile,
    agentTemplate: teamPreset === "solo" ? "solo" : "core-team",
    rules: {
      workspaceOnly: plan.workspace.rules.workspaceOnly,
      generateStarterDocs: plan.workspace.rules.generateStarterDocs,
      generateMemory: plan.workspace.rules.generateMemory,
      kickoffMission: plan.workspace.rules.kickoffMission
    },
    hidden,
    systemTag,
    agents: manifestAgents
  });

  if (scaffoldInputsChanged) {
    const scaffoldDocuments = buildWorkspaceScaffoldDocuments({
      name: desiredName,
      brief: desiredBrief || desiredName,
      template: plan.workspace.template,
      sourceMode: plan.workspace.materialization.mode,
      materialization: plan.workspace.materialization,
      rules: plan.workspace.rules,
      agents: currentEnabledAgents,
      toolExamples: await detectWorkspaceToolExamples(currentWorkspacePath),
      docOverrides: currentDocOverrides,
      knowledgeSources: plan.knowledge.sources
    });
    const scaffoldPathSet = new Set(scaffoldDocuments.map((document) => document.path));

    for (const document of scaffoldDocuments) {
      await writeTextFileEnsured(path.join(currentWorkspacePath, document.path), document.content);
    }

    for (const override of currentDocOverrides) {
      if (scaffoldPathSet.has(override.path)) {
        continue;
      }

      await writeTextFileEnsured(path.join(currentWorkspacePath, override.path), override.content);
    }
  } else {
    const scaffoldDocuments = buildWorkspaceScaffoldDocuments({
      name: baselineName,
      brief: baselineBrief || baselineName,
      template: input.baseline.template,
      sourceMode: input.baseline.sourceMode,
      materialization: input.baseline.materialization,
      rules: input.baseline.rules,
      agents: baselineEnabledAgents,
      toolExamples: [],
      docOverrides: [],
      knowledgeSources: input.baseline.knowledgeSources
    });
    const scaffoldPathSet = new Set(scaffoldDocuments.map((document) => document.path));

    for (const override of currentDocOverrides) {
      const baselineContent = baselineDocOverrideMap.get(override.path);

      if (baselineContent === override.content) {
        continue;
      }

      await writeTextFileEnsured(path.join(currentWorkspacePath, override.path), override.content);
    }

    for (const baselineOverride of baselineDocOverrides) {
      if (currentDocOverrideMap.has(baselineOverride.path)) {
        continue;
      }

      const scaffoldDocument = scaffoldDocuments.find((document) => document.path === baselineOverride.path);

      if (!scaffoldDocument || !scaffoldPathSet.has(scaffoldDocument.path)) {
        continue;
      }

      await writeTextFileEnsured(path.join(currentWorkspacePath, scaffoldDocument.path), scaffoldDocument.baseContent);
    }
  }

  if (workspaceRelocated || !areWorkspaceAgentsEqual(currentEnabledAgents, baselineEnabledAgents)) {
    const currentWorkspaceId = workspaceRelocated
      ? resolveWorkspaceIdForSnapshotPath(snapshot?.workspaces ?? [], currentWorkspacePath, workspace.path)
      : workspace.id;
    const currentWorkspace = {
      ...workspace,
      id: currentWorkspaceId,
      path: currentWorkspacePath
    };

    await syncWorkspaceAgentsToPlan({
      currentWorkspace,
      desiredAgents: plan.team.persistentAgents,
      workspaceSlug: slugify(path.basename(currentWorkspacePath)),
      previousWorkspaceId: input.baseline.workspaceId,
      previousWorkspacePath: input.baseline.workspacePath,
      gatewayOptions: input.gatewayOptions
    });
  }

  await writeTextFileEnsured(projectManifestPath, `${JSON.stringify(projectManifest, null, 2)}\n`);
  await syncWorkspaceAgentsMarkdown(currentWorkspacePath);

  invalidateSnapshotCache();
  clearRuntimeHistoryCache();

  return {
    workspaceId: workspaceRelocated
      ? moveLifecycle?.workspaceId ?? resolveWorkspaceIdForSnapshotPath(snapshot?.workspaces ?? [], currentWorkspacePath, workspace.path)
      : workspace.id,
    previousWorkspaceId: workspace.id,
    previousWorkspacePath: workspaceRelocated ? workspace.path : undefined,
    workspacePath: currentWorkspacePath,
    outcome: moveLifecycle?.outcome ?? "ready",
    operationId: moveLifecycle?.operationId,
    recoveryGeneration: moveLifecycle?.recoveryGeneration,
    nativeAccepted: moveLifecycle?.nativeAccepted ?? false,
    nativeConfirmed: moveLifecycle?.nativeConfirmed ?? true,
    sidecarSynchronized: moveLifecycle?.sidecarSynchronized ?? true,
    warnings: moveLifecycle?.warnings ?? [],
    error: moveLifecycle?.error,
    filesystem: moveLifecycle?.filesystem
  } satisfies WorkspaceUpdateResult;
}

function findWorkspaceById(workspaces: WorkspaceProject[], workspaceId: string) {
  return (
    workspaces.find((entry) => entry.id === workspaceId) ??
    workspaces.find((entry) => workspacePathMatchesId(entry.path, workspaceId))
  );
}

function resolveWorkspaceIdForSnapshotPath(
  workspaces: WorkspaceProject[],
  workspacePath: string,
  previousWorkspacePath?: string
) {
  const previousWorkspacePathKey = previousWorkspacePath ? path.resolve(previousWorkspacePath) : null;
  const paths = [
    ...workspaces
      .map((workspace) => workspace.path)
      .filter((entry) => !previousWorkspacePathKey || path.resolve(entry) !== previousWorkspacePathKey),
    workspacePath
  ];

  return resolveWorkspaceIdForPath(workspacePath, paths);
}

async function syncWorkspaceAgentsToPlan(input: {
  currentWorkspace: WorkspaceProject;
  desiredAgents: WorkspaceAgentBlueprintInput[];
  workspaceSlug: string;
  previousWorkspaceId?: string;
  previousWorkspacePath?: string;
  gatewayOptions?: OpenClawCommandOptions;
}) {
  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const currentAgents = Array.from(
    new Map(
      snapshot.agents
        .filter((agent) => {
          if (agent.workspaceId === input.currentWorkspace.id) {
            return true;
          }

          if (input.previousWorkspaceId && agent.workspaceId === input.previousWorkspaceId) {
            return true;
          }

          return Boolean(input.previousWorkspacePath && agent.workspacePath === input.previousWorkspacePath);
        })
        .map((agent) => [agent.id, agent])
    ).values()
  );
  const matchedAgentIds = new Set<string>();

  for (const desiredAgent of input.desiredAgents) {
    const currentAgent = findMatchingWorkspaceAgent(currentAgents, input.workspaceSlug, desiredAgent.id);

    if (!desiredAgent.enabled) {
      if (currentAgent) {
        matchedAgentIds.add(currentAgent.id);
        await deleteAgent({ agentId: currentAgent.id }, input.gatewayOptions);
      }

      continue;
    }

    if (currentAgent) {
      matchedAgentIds.add(currentAgent.id);
      await updateAgent({
        id: currentAgent.id,
        workspaceId: input.currentWorkspace.id,
        workspacePath: input.currentWorkspace.path,
        name: normalizeOptionalValue(desiredAgent.name) ?? currentAgent.name,
        emoji: normalizeOptionalValue(desiredAgent.emoji) ?? currentAgent.identity.emoji,
        theme: normalizeOptionalValue(desiredAgent.theme) ?? currentAgent.identity.theme,
        modelId: normalizeOptionalValue(desiredAgent.modelId) ?? (currentAgent.modelId === "unassigned" ? undefined : currentAgent.modelId),
        policy: desiredAgent.policy,
        heartbeat: desiredAgent.heartbeat,
        channelIds: desiredAgent.channelIds
      }, input.gatewayOptions);
      continue;
    }

    const createdAgentId = await createAgent({
      id: createWorkspaceAgentIdFromProvisioning(input.workspaceSlug, desiredAgent.id),
      workspaceId: input.currentWorkspace.id,
      workspacePath: input.currentWorkspace.path,
      name: normalizeOptionalValue(desiredAgent.name) ?? undefined,
      emoji: normalizeOptionalValue(desiredAgent.emoji) ?? undefined,
      theme: normalizeOptionalValue(desiredAgent.theme) ?? undefined,
      modelId: normalizeOptionalValue(desiredAgent.modelId) ?? undefined,
      policy: desiredAgent.policy,
      heartbeat: desiredAgent.heartbeat,
      channelIds: desiredAgent.channelIds
    }, input.gatewayOptions);

    matchedAgentIds.add(createdAgentId.agentId);
  }

  for (const currentAgent of currentAgents) {
    if (!matchedAgentIds.has(currentAgent.id)) {
      await deleteAgent({ agentId: currentAgent.id }, input.gatewayOptions);
    }
  }
}

function resolveSnapshotDefaultAgentModelId(snapshot: MissionControlSnapshot) {
  if (!snapshot.diagnostics.modelReadiness.defaultModelReady) {
    return undefined;
  }

  return (
    normalizeOptionalValue(snapshot.diagnostics.modelReadiness.resolvedDefaultModel) ??
    normalizeOptionalValue(snapshot.diagnostics.modelReadiness.defaultModel) ??
    undefined
  );
}

function resolveWorkspaceBlueprintModelId(
  snapshot: MissionControlSnapshot,
  agents: WorkspaceAgentBlueprintInput[]
) {
  return agents
    .map((agent) => normalizeOptionalValue(agent.modelId))
    .find((modelId) => modelId && isSnapshotModelUsable(snapshot, modelId));
}

function resolveWorkspaceModelCandidateId(
  snapshot: MissionControlSnapshot,
  agents: WorkspaceAgentBlueprintInput[]
) {
  return [
    ...agents.map((agent) => normalizeWorkspaceModelReference(agent.modelId)),
    normalizeWorkspaceModelReference(snapshot.diagnostics.modelReadiness.resolvedDefaultModel),
    normalizeWorkspaceModelReference(snapshot.diagnostics.modelReadiness.defaultModel),
    ...snapshot.agents
      .filter((agent) => agent.kind !== "system")
      .map((agent) => normalizeWorkspaceModelReference(agent.modelId)),
    normalizeWorkspaceModelReference(snapshot.diagnostics.modelReadiness.recommendedModelId),
    ...snapshot.models.map((model) => normalizeWorkspaceModelReference(model.id))
  ].find((modelId): modelId is string => Boolean(modelId));
}

function resolveWorkspaceNativeReadinessAgentIds(
  snapshot: MissionControlSnapshot,
  modelId: string | undefined
) {
  const normalizedModelId = normalizeWorkspaceModelReference(modelId)?.toLowerCase();

  if (!normalizedModelId) {
    return [];
  }

  const eligibleAgents = snapshot.agents.filter((agent) => agent.kind !== "system");
  const matchingAgents = eligibleAgents.filter(
    (agent) => normalizeWorkspaceModelReference(agent.modelId)?.toLowerCase() === normalizedModelId
  );
  const defaultAgents = eligibleAgents.filter((agent) => agent.isDefault);

  return uniqueStrings([
    ...matchingAgents.map((agent) => agent.id),
    ...defaultAgents.map((agent) => agent.id),
    ...eligibleAgents.map((agent) => agent.id)
  ]).slice(0, 3);
}

function normalizeWorkspaceModelReference(value: string | null | undefined) {
  const normalized = normalizeOptionalValue(value);
  return normalized && normalized !== "unassigned" ? normalized : undefined;
}

function resolveRecommendedWorkspaceModelId(snapshot: MissionControlSnapshot) {
  const recommendedModelId = normalizeOptionalValue(snapshot.diagnostics.modelReadiness.recommendedModelId);

  if (recommendedModelId && isSnapshotModelUsable(snapshot, recommendedModelId)) {
    return recommendedModelId;
  }

  return snapshot.models
    .map((model) => normalizeOptionalValue(model.id))
    .find((modelId) => modelId && isSnapshotModelUsable(snapshot, modelId));
}

function isSnapshotModelUsable(snapshot: MissionControlSnapshot, modelId: string) {
  const model = snapshot.models.find((entry) => entry.id === modelId);

  if (!model) {
    return false;
  }

  return model.missing !== true && model.available !== false;
}

function resolveWorkspaceRoot(configuredWorkspaceRoot?: string | null) {
  return configuredWorkspaceRoot || path.join(os.homedir(), "Documents", "Shared", "projects");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveWorkspaceTargetPath(currentPath: string, name?: string, directory?: string) {
  const normalizedDirectory = normalizeOptionalValue(directory);

  if (normalizedDirectory) {
    return path.isAbsolute(normalizedDirectory)
      ? normalizedDirectory
      : path.join(path.dirname(currentPath), normalizedDirectory);
  }

  const normalizedName = normalizeOptionalValue(name);

  if (!normalizedName) {
    return currentPath;
  }

  const nextSlug = slugify(normalizedName);

  if (!nextSlug) {
    throw new Error("Workspace name is required.");
  }

  return path.join(path.dirname(currentPath), nextSlug);
}

async function resolveExistingWorkspaceCreateResult(
  targetDir: string,
  snapshot: MissionControlSnapshot,
  workspaceSlug: string
): Promise<WorkspaceCreateResult | null> {
  const manifest = await readWorkspaceProjectManifest(targetDir);
  const enabledManifestAgents = manifest.agents.filter((agent) => agent.enabled);
  const hasExistingWorkspaceContent =
    Boolean(manifest.name || manifest.template || manifest.materialization || manifest.agentTemplate) ||
    enabledManifestAgents.length > 0 ||
    manifest.channels.length > 0 ||
    manifest.knowledgeSources.length > 0;

  if (!hasExistingWorkspaceContent) {
    return null;
  }

  const expectedWorkspaceId = resolveWorkspaceIdForSnapshotPath(snapshot.workspaces, targetDir);
  const workspace =
    findWorkspaceById(snapshot.workspaces, expectedWorkspaceId) ??
    snapshot.workspaces.find((entry) => path.resolve(entry.path) === path.resolve(targetDir)) ??
    null;
  const workspaceId = workspace?.id ?? expectedWorkspaceId;

  const workspaceAgents = snapshot.agents.filter(
    (agent) => agent.workspaceId === workspaceId || path.resolve(agent.workspacePath) === path.resolve(targetDir)
  );
  const existingAgentIds = new Set(workspaceAgents.map((agent) => agent.id));
  const manifestAgentRefs = enabledManifestAgents.map((agent) =>
    resolveManifestWorkspaceAgentProvisioningRef(workspaceSlug, agent)
  );

  const repairedAgentIds: string[] = [];
  for (const entry of manifestAgentRefs) {
    if (existingAgentIds.has(entry.agentId)) {
      continue;
    }

    const createdAgentId = await createBootstrappedWorkspaceAgentFromProvisioning({
      workspacePath: targetDir,
      workspaceSlug,
      workspaceModelId: entry.agent.modelId,
      agent: entry.agent
    });
    repairedAgentIds.push(createdAgentId);
    existingAgentIds.add(createdAgentId);
  }

  const manifestAgentIds = uniqueStrings(manifestAgentRefs.map((entry) => entry.agentId));
  const resolvedAgentIds = uniqueStrings([
    ...workspaceAgents.map((agent) => agent.id),
    ...repairedAgentIds,
    ...manifestAgentIds
  ]);

  if (resolvedAgentIds.length === 0) {
    return null;
  }

  const manifestPrimaryAgent = manifest.agents.find((agent) => agent.enabled && agent.isPrimary) ?? null;
  const manifestPrimaryAgentRef = manifestPrimaryAgent
    ? resolveManifestWorkspaceAgentProvisioningRef(workspaceSlug, manifestPrimaryAgent)
    : null;
  const primaryAgentId =
    workspaceAgents[0]?.id ??
    manifestPrimaryAgentRef?.agentId ??
    resolvedAgentIds[0];

  return {
    workspaceId: workspace?.id ?? workspaceId,
    workspaceName: workspace?.name ?? manifest.name ?? path.basename(targetDir),
    workspacePath: workspace?.path ?? targetDir,
    agentIds: resolvedAgentIds,
    primaryAgentId,
    agentProjections: buildWorkspaceCreateAgentProjections(
      manifestAgentRefs.map((entry) => entry.agentId),
      manifestAgentRefs.map((entry) => entry.agent),
      undefined
    ),
    kickoffRunId: undefined,
    kickoffStatus: undefined,
    kickoffError: undefined
  };
}

function buildWorkspaceCreateAgentProjections(
  agentIds: string[],
  agents: WorkspaceAgentBlueprintInput[],
  workspaceModelId: string | undefined
): WorkspaceCreateAgentProjection[] {
  const projections: WorkspaceCreateAgentProjection[] = [];

  agents.forEach((agent, index) => {
    const id = agentIds[index];

    if (!id) {
      return;
    }

    const policy = resolveAgentPolicy(agent.policy?.preset ?? DEFAULT_AGENT_PRESET, agent.policy);
    const skillIds = uniqueStrings([
      ...(agent.skillIds ?? []),
      agent.skillId ?? ""
    ]);
    const tools = policy.fileAccess === "workspace-only" ? ["fs.workspaceOnly"] : [];

    projections.push({
      id,
      name: normalizeOptionalValue(agent.name) ?? agent.role ?? id,
      modelId: normalizeOptionalValue(agent.modelId) ?? workspaceModelId,
      emoji: normalizeOptionalValue(agent.emoji) ?? undefined,
      theme: normalizeOptionalValue(agent.theme) ?? undefined,
      policy,
      heartbeat: agent.heartbeat,
      skills: skillIds,
      tools
    });
  });

  return projections;
}

function resolveManifestWorkspaceAgentProvisioningRef(
  workspaceSlug: string,
  manifestAgent: WorkspaceProjectManifestAgent
) {
  const slugPrefix = `${workspaceSlug}-`;
  const agentKey = manifestAgent.id.startsWith(slugPrefix)
    ? manifestAgent.id.slice(slugPrefix.length)
    : manifestAgent.id;
  const normalizedAgentKey = agentKey || manifestAgent.id;

  return {
    agentId: canonicalizeWorkspaceAgentId(workspaceSlug, normalizedAgentKey),
    agent: {
      id: normalizedAgentKey,
      name: manifestAgent.name ?? normalizedAgentKey,
      role: manifestAgent.role ?? "Agent",
      enabled: manifestAgent.enabled,
      emoji: manifestAgent.emoji ?? undefined,
      theme: manifestAgent.theme ?? undefined,
      skillId: manifestAgent.skillId ?? undefined,
      skillIds: manifestAgent.skillIds,
      modelId: manifestAgent.modelId ?? undefined,
      isPrimary: manifestAgent.isPrimary,
      policy: manifestAgent.policy ?? undefined,
      channelIds: manifestAgent.channelIds
    } satisfies WorkspaceAgentBlueprintInput
  };
}

async function syncWorkspaceAgentPolicySkills(
  workspacePath: string,
  gatewayOptions: OpenClawCommandOptions = {}
) {
  const snapshot = await getMissionControlSnapshot({ includeHidden: true });
  const agentIds = snapshot.agents
    .filter((entry) => entry.workspacePath === workspacePath)
    .map((entry) => entry.id);

  for (const agentId of uniqueStrings(agentIds)) {
    const agent = snapshot.agents.find((entry) => entry.id === agentId);

    if (!agent) {
      continue;
    }

    const setupAgentId =
      snapshot.agents.find(
        (entry) => entry.workspaceId === agent.workspaceId && entry.policy.preset === "setup" && entry.id !== agent.id
      )?.id ?? null;

    const policySkillId = await ensureAgentPolicySkillFromProvisioning({
      workspacePath: agent.workspacePath,
      agentId: agent.id,
      agentName: agent.name,
      policy: agent.policy,
      setupAgentId,
      snapshot
    });

    await upsertAgentConfigEntry(
      agent.id,
      agent.workspacePath,
      {
        name: agent.name,
        model: normalizeOptionalValue(agent.modelId),
        heartbeat: agent.heartbeat.enabled && agent.heartbeat.every ? { every: agent.heartbeat.every } : null,
        skills: [...filterAgentPolicySkills(agent.skills), policySkillId],
        tools: agent.tools.includes("fs.workspaceOnly")
          ? {
              fs: {
                workspaceOnly: true
              }
            }
          : null
      },
      snapshot,
      undefined,
      gatewayOptions
    );
  }
}

async function runWorkspaceKickoffMission(
  params: {
    agentId: string;
    brief?: string;
    modelProfile: WorkspaceModelProfile;
    thinking?: OpenClawThinkingLevel;
    template: WorkspaceTemplate;
    rules: WorkspaceCreateRules;
  },
  options: {
    onProgress?: KickoffProgressHandler;
    gatewayOptions?: OpenClawCommandOptions;
  } = {}
) {
  const prompt = buildWorkspaceKickoffPrompt(params.template, params.brief, params.rules);
  const thinking = params.thinking ?? (
    params.modelProfile === "fast"
      ? "low"
      : params.modelProfile === "quality"
        ? "high"
        : "medium"
  );
  const emittedRuntimeMessages = new Set<string>();

  await options.onProgress?.({
    message: "Submitting the kickoff brief to the primary agent.",
    percent: 18
  });

  const result = await getOpenClawAdapter().streamAgentTurn(
    {
      agentId: params.agentId,
      message: prompt,
      thinking,
      timeoutSeconds: 90
    },
    {
      onStdout: async (text: string) => {
        const messages = extractKickoffProgressMessages(text);

        if (messages.length === 0 && text.trim()) {
          await options.onProgress?.({
            message: "Primary agent responded. Finalizing kickoff output.",
            percent: 82
          });
          return;
        }

        for (const message of messages) {
          await options.onProgress?.({
            message,
            percent: 72
          });
        }
      },
      onStderr: async (text: string) => {
        const stderr = text.trim();

        if (!stderr) {
          return;
        }

        const message = resolveKickoffRuntimeProgressMessage(stderr);

        if (!message || emittedRuntimeMessages.has(message)) {
          return;
        }

        emittedRuntimeMessages.add(message);
        await options.onProgress?.({
          message,
          percent: 64
        });
      }
    },
    { ...options.gatewayOptions, timeoutMs: 120000 }
  );

  await options.onProgress?.({
    message: "Kickoff mission completed. Recording the resulting run metadata.",
    percent: 100
  });

  return result;
}

function resolveKickoffRuntimeProgressMessage(output: string) {
  const cleaned = stripAnsiSequences(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  if (!cleaned) {
    return null;
  }

  const normalized = cleaned.toLowerCase();

  if (
    normalized.includes("scope upgrade pending approval") ||
    normalized.includes("pairing required") ||
    normalized.includes("more scopes than currently approved")
  ) {
    return "Gateway permissions need approval; continuing with the embedded runtime.";
  }

  if (normalized.includes("falling back to embedded")) {
    return "Gateway agent is unavailable; continuing with the embedded runtime.";
  }

  if (normalized.includes("gateway connect failed")) {
    return "Gateway connection is not ready; continuing with the embedded runtime.";
  }

  return `Runtime notice: ${summarizeKickoffRuntimeOutput(cleaned)}`;
}

function summarizeKickoffRuntimeOutput(value: string) {
  const redacted = value
    .replace(/\(requestId:\s*[^)]+\)/gi, "")
    .replace(/\brequestId:\s*\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return redacted.length > 160 ? `${redacted.slice(0, 157).trim()}...` : redacted;
}

function stripAnsiSequences(value: string) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}
