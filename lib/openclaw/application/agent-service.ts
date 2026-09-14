import "server-only";

import { readFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_AGENT_PRESET,
  filterKnownOpenClawSkillIds,
  filterKnownOpenClawToolIds,
  formatAgentPresetLabel,
  getAgentPresetMeta,
  resolveAgentPolicy
} from "@/lib/openclaw/agent-presets";
import {
  resolveHeartbeatDraft,
  serializeHeartbeatConfig
} from "@/lib/openclaw/agent-heartbeat";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  AGENTOS_WORKER_PROFILE_SCHEMA_VERSION,
  mergeAgentOSWorkerProfile,
  type AgentOSWorkerProfileInput
} from "@/lib/agentos/worker-profile";
import {
  clearMissionControlRuntimeHistoryCache,
  getMissionControlSnapshot,
  invalidateMissionControlSnapshotCache
} from "@/lib/openclaw/application/mission-control-service";
import { assertGatewayNativeConfigMutationAccess } from "@/lib/openclaw/application/settings-service";
import {
  buildAgentPolicySkillId,
  buildWorkspaceAgentStatePath,
  filterAgentPolicySkills,
  mapAgentHeartbeatToInput,
  normalizeDeclaredAgentSkills,
  normalizeDeclaredAgentTools,
  readAgentConfigList,
  preserveLegacyAgentContextFiles,
  upsertAgentConfigEntry,
  writeAgentConfigList
} from "@/lib/openclaw/domains/agent-config";
import {
  ensureAgentPolicySkill as ensureAgentPolicySkillFromProvisioning,
  ensureWorkspaceSkillMarkdown as ensureWorkspaceSkillMarkdownFromProvisioning,
  pruneUnreferencedGeneratedWorkspaceSkills
} from "@/lib/openclaw/domains/agent-provisioning";
import {
  parseWorkspaceProjectManifestAgent,
  serializeWorkspaceProjectManifestRecord,
  type WorkspaceProjectManifestAgent
} from "@/lib/openclaw/domains/workspace-manifest";
import { syncWorkspaceAgentsMarkdown } from "@/lib/openclaw/domains/workspace-agents-document-sync";
import { normalizeOptionalValue } from "@/lib/openclaw/domains/control-plane-normalization";
import {
  isOpenAiBackedModel,
  normalizeOpenAiModelId
} from "@/lib/openclaw/domains/model-provider-connection";
import { buildUniqueAgentName } from "@/lib/openclaw/agent-naming";
import { isOpenClawAgentModelReady } from "@/lib/openclaw/application/model-provider-state-service";
import { runWithGatewayAuthSetupRecovery } from "@/lib/openclaw/model-setup-recovery";
import { writeTextFileEnsured } from "@/lib/openclaw/domains/workspace-bootstrap";
import {
  bindWorkspaceChannelAgent,
  unbindWorkspaceChannelAgent
} from "@/lib/openclaw/application/channel-service";
import { executeNativeMutationWithVerification } from "@/lib/openclaw/application/native-mutation-service";
import { reconcileLifecycleState } from "@/lib/openclaw/application/lifecycle-reconciliation";
import { runLifecycleSidecarSteps } from "@/lib/openclaw/application/lifecycle-sidecar-service";
import {
  createOrReadLifecycleOperation,
  lifecycleAgentResourceKey,
  lifecycleWorkspaceResourceKey,
  readLifecycleOperation,
  updateLifecycleOperation,
  withLifecycleOperationLock
} from "@/lib/openclaw/application/lifecycle-operation-store";
import { workspaceIdFromPath, workspacePathMatchesId } from "@/lib/openclaw/domains/workspace-id";
import {
  resolveAgentCreationReadinessError,
  resolveAgentCreationReadinessErrorWithNativeAgentEvidence
} from "@/lib/openclaw/readiness";
import type {
  AgentCreateInput,
  AgentCreateResult,
  AgentDeleteInput,
  AgentDeleteResult,
  AgentPolicy,
  AgentUpdateInput,
  MissionControlSnapshot,
  OpenClawAgent,
  LifecycleOperationOutcome
} from "@/lib/openclaw/types";
import type {
  OpenClawCommandOptions,
  OpenClawUpdateAgentInput
} from "@/lib/openclaw/client/types";

const LEGACY_CUSTOM_PRESET_SKILL_IDS = ["project-researcher", "project-builder", "project-analyst"];

export async function createAgent(input: AgentCreateInput, gatewayOptions: OpenClawCommandOptions = {}) {
  const agentId = slugify(input.id.trim());
  if (!agentId) {
    throw new Error("Agent id is required.");
  }

  const workspaceResourceId = await resolveWorkspaceLifecycleWorkspaceId(input.workspaceId);
  return withLifecycleOperationLock({
    kind: "agent.create",
    targetId: `${input.workspaceId}:${agentId}`,
    resourceKeys: [
      lifecycleWorkspaceResourceKey(workspaceResourceId ?? input.workspaceId),
      lifecycleAgentResourceKey(agentId)
    ],
    run: () => createAgentInternal(input, gatewayOptions)
  });
}

async function createAgentInternal(input: AgentCreateInput, gatewayOptions: OpenClawCommandOptions = {}) {
  const agentId = slugify(input.id.trim());

  if (!agentId) {
    throw new Error("Agent id is required.");
  }

  let snapshot = await getMissionControlSnapshot({ includeHidden: true });
  let resolvedWorkspace = findWorkspaceById(snapshot, input.workspaceId);
  let resolvedWorkspacePath =
    normalizeOptionalValue(input.workspacePath) ??
    resolvedWorkspace?.path;

  if (!resolvedWorkspacePath) {
    snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    resolvedWorkspace = findWorkspaceById(snapshot, input.workspaceId);
    resolvedWorkspacePath =
      normalizeOptionalValue(input.workspacePath) ??
      resolvedWorkspace?.path;
  }

  const resolvedWorkspaceId =
    resolvedWorkspace?.id ?? (resolvedWorkspacePath ? workspaceIdFromPath(resolvedWorkspacePath) : input.workspaceId || null);

  if (!resolvedWorkspacePath || !resolvedWorkspaceId) {
    throw new Error("Workspace was not found for this agent.");
  }

  const requestedModelId = normalizeOptionalValue(input.modelId);
  const fallbackModelId =
    resolveSnapshotDefaultAgentModelId(snapshot) ??
    resolveWorkspaceAgentModelId(snapshot, resolvedWorkspaceId) ??
    resolveRecommendedAgentModelId(snapshot) ??
    resolveWorkspaceAgentModelCandidateId(snapshot, resolvedWorkspaceId) ??
    resolveConfiguredAgentModelCandidateId(snapshot);
  const modelSelection = resolveAgentCreateModelSelection(snapshot, requestedModelId, fallbackModelId);
  const agentModelId = modelSelection.modelId;

  const readinessError = await resolveAgentCreationReadinessErrorWithNativeAgentEvidence(snapshot, {
    requestedModelId: agentModelId,
    candidateAgentIds: resolveAgentNativeReadinessAgentIds(snapshot, resolvedWorkspaceId, agentModelId),
    verifyAgentModel: isOpenClawAgentModelReady
  });

  if (readinessError) {
    throw new Error(readinessError);
  }

  let lifecycleOperation = (await createOrReadLifecycleOperation({
    kind: "agent.create",
    targetId: `${resolvedWorkspaceId}:${agentId}`,
    metadata: {
      workspaceId: resolvedWorkspaceId,
      workspacePath: resolvedWorkspacePath
    }
  })).operation;

  if (lifecycleOperation.state === "ready" && lifecycleOperation.result) {
    const currentSnapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    if (currentSnapshot.agents.some((entry) =>
      entry.id === agentId &&
      (entry.workspaceId === resolvedWorkspaceId || path.resolve(entry.workspacePath) === path.resolve(resolvedWorkspacePath))
    )) {
      return lifecycleOperation.result as unknown as AgentCreateResult;
    }
    snapshot = currentSnapshot;
    lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
      state: "requested",
      stage: "requested",
      nativeAccepted: false,
      nativeConfirmed: false,
      sidecarSynchronized: false,
      warnings: [],
      error: null,
      result: null,
      items: {}
    });
  }

  if (lifecycleOperation.state === "failed" && !lifecycleOperation.nativeAccepted) {
    if (!isExplicitLifecycleRecovery(input.recoveryGeneration, lifecycleOperation.recoveryGeneration)) {
      if (lifecycleOperation.result) {
        return lifecycleOperation.result as unknown as AgentCreateResult;
      }
      throw new Error(
        "The previous AgentOS create attempt failed. An explicit recovery attempt is required before AgentOS can issue a new create request."
      );
    }

    lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
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

  let existingAgent = snapshot.agents.find((entry) => entry.id === agentId);
  if (lifecycleOperation.nativeAccepted && !existingAgent) {
    const reconciliation = await reconcileLifecycleState({
      read: () => getMissionControlSnapshot({ force: true, includeHidden: true }),
      isConfirmed: (current) => current.agents.some((entry) =>
        entry.id === agentId &&
        (entry.workspaceId === resolvedWorkspaceId || path.resolve(entry.workspacePath) === path.resolve(resolvedWorkspacePath))
      )
    });
    snapshot = reconciliation.value ?? snapshot;
    existingAgent = snapshot.agents.find((entry) => entry.id === agentId);
    if (!existingAgent) {
      const recoveryAuthorized = reconciliation.outcome === "not-confirmed" &&
        isExplicitLifecycleRecovery(input.recoveryGeneration, lifecycleOperation.recoveryGeneration);
      if (recoveryAuthorized) {
        lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
          state: "requested",
          stage: "recovering",
          recoveryGeneration: input.recoveryGeneration,
          lastReconciledAt: new Date().toISOString(),
          warnings: [],
          error: null,
          result: null,
          metadata: { recoveryProof: "authoritative-absence" },
          sidecars: {}
        });
      } else {
        const warning = reconciliation.outcome === "not-confirmed"
          ? "OpenClaw shows no agent at the expected target after bounded authoritative rereads, but an explicit recovery attempt is required before AgentOS can issue a new create request."
          : "AgentOS will not repeat an ambiguous OpenClaw create request while authoritative native state is unreadable.";
        const result = {
          agentId,
          workspaceId: resolvedWorkspaceId,
          outcome: "unknown",
          operationId: lifecycleOperation.operationId,
          recoveryGeneration: lifecycleOperation.recoveryGeneration,
          nativeAccepted: true,
          nativeConfirmed: false,
          sidecarSynchronized: false,
          warnings: [warning]
        } satisfies AgentCreateResult;
        await updateLifecycleOperation(lifecycleOperation, {
          state: "unknown",
          stage: "reconciling-native-state",
          nativeAccepted: true,
          nativeConfirmed: false,
          lastReconciledAt: new Date().toISOString(),
          warnings: [warning],
          error: { code: "native-agent-creation-uncertain", message: warning },
          result
        });
        return result;
      }
    }
  }
  const isRecoveryOfAcceptedNativeAgent = Boolean(
    existingAgent &&
    (existingAgent.workspaceId === resolvedWorkspaceId || path.resolve(existingAgent.workspacePath) === path.resolve(resolvedWorkspacePath)) &&
    lifecycleOperation.nativeAccepted
  );
  if (existingAgent && !isRecoveryOfAcceptedNativeAgent) {
    lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
      state: "failed",
      error: {
        code: "agent-id-conflict",
        message: `Agent id "${agentId}" already exists in workspace "${describeAgentWorkspace(snapshot, existingAgent)}".`
      }
    });
    assertAgentIdAvailable(snapshot, agentId, resolvedWorkspaceId);
  }

  const policy = resolveAgentPolicy(input.policy?.preset ?? DEFAULT_AGENT_PRESET, input.policy);
  const presetMeta = getAgentPresetMeta(policy.preset);
  const presetSkillIds = filterKnownOpenClawSkillIds(presetMeta.skillIds);
  const presetToolIds = filterKnownOpenClawToolIds(presetMeta.tools);
  const declaredSkillIds =
    input.skills === undefined
      ? presetSkillIds
      : normalizeDeclaredAgentSkills(input.skills);
  const declaredToolIds =
    input.tools === undefined
      ? presetToolIds
      : normalizeDeclaredAgentTools(input.tools);
  const displayName =
    normalizeOptionalValue(input.name) ??
    buildUniqueAgentName(snapshot.agents, resolvedWorkspaceId ?? undefined, policy.preset);
  const emoji =
    normalizeOptionalValue(input.emoji) ??
    presetMeta.defaultEmoji;
  const theme =
    normalizeOptionalValue(input.theme) ??
    presetMeta.defaultTheme;
  const avatar = normalizeOptionalValue(input.avatar);
  const heartbeat = serializeHeartbeatConfig(resolveHeartbeatDraft(policy.preset, input.heartbeat));
  const workerProfile = mergeAgentOSWorkerProfile(null, input.workerProfile, {
    name: displayName,
    role: formatAgentPresetLabel(policy.preset),
    emoji,
    theme,
    avatar
  });
  const toolPolicy = resolveAgentToolPolicyInput(input.toolPolicy, policy.fileAccess, null);
  const setupAgentId =
    snapshot.agents.find((entry) => entry.workspaceId === resolvedWorkspaceId && entry.policy.preset === "setup")?.id ?? null;
  const agentDir = buildWorkspaceAgentStatePath(resolvedWorkspacePath, agentId);
  const syncWarnings: string[] = [...modelSelection.warnings];
  lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
    stage: "creating-native-agent",
    state: "running",
    metadata: { workspaceId: resolvedWorkspaceId, workspacePath: resolvedWorkspacePath }
  });

  let nativeAccepted = lifecycleOperation.nativeAccepted;
  let nativeConfirmed = isRecoveryOfAcceptedNativeAgent;
  if (!isRecoveryOfAcceptedNativeAgent) {
    lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
      stage: "native-mutation",
      mutationAttemptCount: lifecycleOperation.mutationAttemptCount + 1,
      lastMutationAt: new Date().toISOString()
    });
    const nativeExecution = await executeNativeMutationWithVerification({
      operation: "agent.create",
      mutate: () => getOpenClawAdapter().addAgent({
        id: agentId,
        workspace: resolvedWorkspacePath,
        agentDir,
        model: agentModelId,
        name: displayName,
        emoji,
        avatar
      }, gatewayOptions),
      verify: async () => {
        const reconciliation = await reconcileLifecycleState({
          read: () => getMissionControlSnapshot({ force: true, includeHidden: true }),
          isConfirmed: (current) => current.agents.some((agent) =>
            agent.id === agentId &&
            (agent.workspaceId === resolvedWorkspaceId || path.resolve(agent.workspacePath) === path.resolve(resolvedWorkspacePath))
          )
        });
        return reconciliation.outcome === "confirmed";
      }
    });

    nativeAccepted = lifecycleOperation.nativeAccepted ||
      nativeExecution.outcome !== "failed" ||
      nativeExecution.classification.requestSent === true;
    if (nativeExecution.outcome !== "succeeded") {
      const warning = nativeExecution.classification.message || "OpenClaw did not confirm the new agent.";
      const result = {
        agentId,
        workspaceId: resolvedWorkspaceId,
        outcome: nativeExecution.outcome,
        operationId: lifecycleOperation.operationId,
        recoveryGeneration: lifecycleOperation.recoveryGeneration,
        nativeAccepted,
        nativeConfirmed: false,
        sidecarSynchronized: false,
        warnings: [warning]
      } satisfies AgentCreateResult;
      await updateLifecycleOperation(lifecycleOperation, {
        state: nativeExecution.outcome,
        stage: "reconciling-native-state",
        nativeAccepted,
        nativeConfirmed: false,
        lastReconciledAt: new Date().toISOString(),
        warnings: result.warnings,
        error: { code: nativeExecution.outcome === "unknown" ? "native-agent-creation-uncertain" : "native-agent-creation-failed", message: warning },
        result
      });
      return result;
    }
    nativeConfirmed = true;
  }

  lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
    stage: "syncing-profile-config",
    nativeAccepted,
    nativeConfirmed,
    lastReconciledAt: new Date().toISOString(),
    lastConfirmedNativeStateAt: nativeConfirmed ? new Date().toISOString() : lifecycleOperation.lastConfirmedNativeStateAt
  });

  let policySkillId = buildAgentPolicySkillId(agentId);
  const profileSidecarResult = await runLifecycleSidecarSteps([
    {
      id: "agent-policy",
      label: "prepare the agent policy",
      formatError: formatPostCreateAgentConfigSyncWarning,
      run: async () => {
        policySkillId = await ensureAgentPolicySkillFromProvisioning({
          workspacePath: resolvedWorkspacePath,
          agentId,
          agentName: displayName,
          policy,
          behaviorInstructions: workerProfile.employment.behaviorInstructions,
          setupAgentId,
          snapshot
        });
      }
    },
    ...declaredSkillIds.map((skillId) => ({
      id: `skill:${skillId}`,
      label: `prepare skill ${skillId}`,
      formatError: formatPostCreateAgentConfigSyncWarning,
      run: () => ensureWorkspaceSkillMarkdownFromProvisioning(resolvedWorkspacePath, skillId)
    })),
    {
      id: "agent-config",
      label: "sync the agent config",
      formatError: formatPostCreateAgentConfigSyncWarning,
      run: () => upsertAgentConfigEntryWithRecovery(
        agentId,
        resolvedWorkspacePath,
        {
          agentDir,
          name: displayName,
          description: workerProfile.employment.mission,
          model: agentModelId,
          heartbeat,
          skills: uniqueStrings([...declaredSkillIds, policySkillId]),
          tools: toolPolicy,
          sandbox: input.sandbox,
          memorySearch: input.memorySearch,
          identity: {
            name: displayName,
            emoji,
            theme,
            avatar
          }
        },
        snapshot,
        undefined,
        gatewayOptions
      )
    },
    {
      id: "workspace-agent-metadata",
      label: "record the workspace agent metadata",
      formatError: formatPostCreateAgentConfigSyncWarning,
      run: () => upsertWorkspaceProjectAgentMetadata(resolvedWorkspacePath, {
        id: agentId,
        name: displayName,
        role: workerProfile.employment.role ?? formatAgentPresetLabel(policy.preset),
        emoji,
        theme,
        enabled: true,
        skillId: declaredSkillIds[0] ?? null,
        skillIds: declaredSkillIds,
        toolIds: declaredToolIds,
        modelId: agentModelId,
        isPrimary: false,
        policy,
        channelIds: input.channelIds ?? [],
        workerProfile
      })
    },
    {
      id: "workspace-agent-document",
      label: "sync the workspace agent document",
      formatError: formatPostCreateAgentConfigSyncWarning,
      run: () => syncWorkspaceAgentsMarkdown(resolvedWorkspacePath)
    },
    {
      id: "workspace-generated-skills",
      label: "prune generated workspace skills",
      formatError: formatPostCreateAgentConfigSyncWarning,
      run: () => pruneUnreferencedGeneratedWorkspaceSkills(
        resolvedWorkspacePath,
        collectWorkspaceSkillReferences(snapshot, resolvedWorkspacePath, new Map([[agentId, declaredSkillIds]]))
      )
    },
    {
      id: "legacy-agent-context",
      label: "preserve legacy agent context",
      formatError: formatPostCreateAgentConfigSyncWarning,
      run: () => preserveLegacyAgentContextFiles(agentId, resolvedWorkspacePath, agentDir)
    },
    {
      id: "workspace-policy-skills",
      label: "sync workspace policy skills",
      formatError: formatPostCreateAgentConfigSyncWarning,
      run: () => syncWorkspaceAgentPolicySkills(resolvedWorkspacePath, gatewayOptions)
    }
  ], {
    completed: lifecycleOperation.sidecars,
    onSuccess: async (stepId) => {
      lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
        sidecars: { [stepId]: "confirmed" }
      });
    },
    onFailure: async (stepId) => {
      lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
        sidecars: { [stepId]: "failed" }
      });
    }
  });
  syncWarnings.push(...profileSidecarResult.warnings);
  lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, { stage: "binding-channels" });
  const channelSidecarResult = await runLifecycleSidecarSteps(
    uniqueStrings(input.channelIds ?? []).map((channelId) => ({
      id: `channel:${channelId}`,
      label: `bind channel ${channelId}`,
      formatError: formatPostCreateAgentConfigSyncWarning,
      run: () => bindWorkspaceChannelAgent({
        channelId,
        workspaceId: resolvedWorkspaceId,
        workspacePath: resolvedWorkspacePath,
        agentId
      })
    })),
    {
      completed: lifecycleOperation.sidecars,
      onSuccess: async (stepId) => {
        lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
          sidecars: { [stepId]: "confirmed" }
        });
      },
      onFailure: async (stepId) => {
        lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
          sidecars: { [stepId]: "failed" }
        });
      }
    }
  );
  syncWarnings.push(...channelSidecarResult.warnings);

  invalidateMissionControlSnapshotCache();
  const warnings = uniqueStrings(syncWarnings);
  const outcome: LifecycleOperationOutcome = warnings.length > 0 ? "partial" : "ready";
  const result = {
    agentId,
    workspaceId: resolvedWorkspaceId,
    outcome,
    operationId: lifecycleOperation.operationId,
    recoveryGeneration: lifecycleOperation.recoveryGeneration,
    nativeAccepted,
    nativeConfirmed,
    sidecarSynchronized: warnings.length === 0,
    warnings
  } satisfies AgentCreateResult;
  await updateLifecycleOperation(lifecycleOperation, {
    state: outcome,
    stage: outcome === "partial" ? "cleanup-partial" : "complete",
    nativeAccepted,
    nativeConfirmed,
    sidecarSynchronized: warnings.length === 0,
    warnings,
    result,
    error: null
  });
  return result;
}

export function formatPostCreateAgentConfigSyncWarning(error: unknown) {
  const message = readErrorMessage(error);

  if (!isTransientGatewayConfigSyncFailure(message)) {
    return null;
  }

  return "AgentOS created the agent, but OpenClaw could not finish the config sync in time. Restart or refresh the OpenClaw Gateway if the agent profile looks incomplete, then refresh AgentOS.";
}

function isTransientGatewayConfigSyncFailure(message: string) {
  if (!message) {
    return false;
  }

  if (
    /Refusing to write a redacted OpenClaw secret|path traversal|Workspace was not found|already exists/i.test(message)
  ) {
    return false;
  }

  return /Timed out waiting for OpenClaw Gateway method "config\.(?:patch|apply|set)"|UNAVAILABLE:.*config\.(?:patch|apply|set)|Gateway-native operation failed; CLI fallback disabled/i.test(message);
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return typeof error === "string" ? error : "";
}

function normalizeAgentModelIdForUpdate(modelId: string | null | undefined): string | null {
  if (modelId === null || modelId === undefined) {
    return null;
  }

  const normalized = normalizeOptionalValue(modelId);
  if (!normalized) {
    return null;
  }

  return isOpenAiBackedModel(normalized)
    ? normalizeOpenAiModelId(normalized)
    : normalized;
}

function resolveAgentToolPolicyInput(
  requested: AgentUpdateInput["toolPolicy"] | AgentCreateInput["toolPolicy"],
  fileAccess: AgentPolicy["fileAccess"],
  current: OpenClawAgent["toolPolicy"]
) {
  const baseline = requested === undefined ? current ?? {} : requested ?? {};

  return {
    ...baseline,
    fs: {
      ...(baseline.fs ?? {}),
      workspaceOnly: fileAccess === "workspace-only"
    }
  };
}

async function updateAgentGatewayMetadataOrDeferToConfig(
  input: OpenClawUpdateAgentInput,
  operationLabel: string,
  gatewayOptions: OpenClawCommandOptions = {}
) {
  try {
    await runAgentGatewayMutation(operationLabel, () =>
      getOpenClawAdapter().updateAgent(input, { ...gatewayOptions, timeoutMs: 15_000 })
    );
    return true;
  } catch (error) {
    if (isRecoverableAgentUpdateGatewayDrift(error)) {
      return false;
    }

    throw error;
  }
}

function isRecoverableAgentUpdateGatewayDrift(error: unknown) {
  const message = readErrorMessage(error);

  return /INVALID_REQUEST:\s*agent\s+"[^"]+"\s+not found/i.test(message) &&
    /Gateway-native operation failed;\s*CLI fallback disabled/i.test(message);
}

export async function updateAgent(input: AgentUpdateInput, gatewayOptions: OpenClawCommandOptions = {}) {
  const agentId = input.id.trim();

  if (!agentId) {
    throw new Error("Agent id is required.");
  }

  let snapshot = await getMissionControlSnapshot({ includeHidden: true });
  let agent = snapshot.agents.find((entry) => entry.id === agentId);

  if (!agent) {
    snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    agent = snapshot.agents.find((entry) => entry.id === agentId);
  }

  if (!agent) {
    throw new Error("Agent was not found.");
  }

  const resolvedWorkspace = findWorkspaceById(snapshot, input.workspaceId || agent.workspaceId);
  const resolvedWorkspacePath =
    normalizeOptionalValue(input.workspacePath) ??
    resolvedWorkspace?.path ??
    agent.workspacePath;
  const resolvedWorkspaceId =
    resolvedWorkspace?.id ?? (resolvedWorkspacePath ? workspaceIdFromPath(resolvedWorkspacePath) : input.workspaceId || agent.workspaceId);

  if (!resolvedWorkspacePath || !resolvedWorkspaceId) {
    throw new Error("Workspace was not found for this agent.");
  }

  const policy = resolveAgentPolicy(input.policy?.preset ?? agent.policy.preset, input.policy ?? agent.policy);
  const presetMeta = getAgentPresetMeta(policy.preset);
  const presetSkillIds = filterKnownOpenClawSkillIds(presetMeta.skillIds);
  const presetToolIds = filterKnownOpenClawToolIds(presetMeta.tools);
  const currentName = normalizeOptionalValue(agent.name);
  const currentEmoji = normalizeOptionalValue(agent.identity.emoji);
  const currentTheme = normalizeOptionalValue(agent.identity.theme);
  const heartbeat = serializeHeartbeatConfig(
    resolveHeartbeatDraft(
      policy.preset,
      input.heartbeat ?? mapAgentHeartbeatToInput(agent.heartbeat)
    )
  );
  const workerProfile = mergeAgentOSWorkerProfile(agent.workerProfile, resolveWorkerProfileUpdatePatch(input), {
    name: normalizeOptionalValue(input.name) ?? currentName ?? agent.id,
    role: formatAgentPresetLabel(policy.preset),
    emoji: normalizeOptionalValue(input.emoji) ?? currentEmoji,
    theme: normalizeOptionalValue(input.theme) ?? currentTheme,
    avatar: normalizeOptionalValue(input.avatar) ?? agent.identity.avatar
  });
  const setupAgentId =
    snapshot.agents.find((entry) => entry.workspaceId === resolvedWorkspaceId && entry.policy.preset === "setup" && entry.id !== agentId)?.id ??
    null;
  const nextModelId: string | null =
    input.modelId !== undefined
      ? normalizeAgentModelIdForUpdate(input.modelId)
      : agent.modelId === "unassigned"
        ? resolveSnapshotDefaultAgentModelId(snapshot) ?? null
        : agent.modelId ?? null;

  if (input.modelId !== undefined && nextModelId !== null) {
    const readinessError = await resolveAgentCreationReadinessErrorWithNativeAgentEvidence(snapshot, {
      requestedModelId: nextModelId,
      candidateAgentIds: [agentId],
      verifyAgentModel: isOpenClawAgentModelReady
    });

    if (readinessError) {
      throw new Error(readinessError);
    }
  }

  const onlyModelChanged =
    input.modelId !== undefined &&
    input.name === undefined &&
    input.emoji === undefined &&
    input.theme === undefined &&
    input.avatar === undefined &&
    input.policy === undefined &&
    input.heartbeat === undefined &&
    input.channelIds === undefined &&
    input.skills === undefined &&
    input.tools === undefined &&
    input.workerProfile === undefined &&
    input.toolPolicy === undefined &&
    input.sandbox === undefined &&
    input.memorySearch === undefined;

  if (input.skills !== undefined) {
    await runAgentGatewayMutation(
      "checking agent skill configuration access",
      assertGatewayNativeConfigMutationAccess
    );
  }

  if (onlyModelChanged) {
    const updatedViaGateway = await updateAgentGatewayMetadataOrDeferToConfig(
      {
        id: agentId,
        workspace: resolvedWorkspacePath,
        model: nextModelId
      },
      "updating the agent model",
      gatewayOptions
    );

    if (!updatedViaGateway) {
      await upsertAgentConfigEntryWithRecovery(
        agentId,
        resolvedWorkspacePath,
        {
          agentDir: agent.agentDir ?? buildWorkspaceAgentStatePath(resolvedWorkspacePath, agentId),
          description: workerProfile.employment.mission,
          model: nextModelId
        },
        snapshot,
        undefined,
        gatewayOptions
      );
    }

    await upsertWorkspaceProjectAgentMetadata(resolvedWorkspacePath, {
      id: agentId,
      name: currentName ?? agent.name ?? agentId,
      emoji: currentEmoji,
      theme: currentTheme,
      enabled: true,
      modelId: nextModelId,
      isPrimary: agent.isDefault,
      policy,
      workerProfile
    });
    await syncWorkspaceAgentsMarkdown(resolvedWorkspacePath);
    await preserveLegacyAgentContextFiles(
      agentId,
      resolvedWorkspacePath,
      agent.agentDir ?? buildWorkspaceAgentStatePath(resolvedWorkspacePath, agentId)
    );

    invalidateMissionControlSnapshotCache();

    return {
      agentId,
      workspaceId: resolvedWorkspaceId
    };
  }

  const policySkillId = await ensureAgentPolicySkillFromProvisioning({
    workspacePath: resolvedWorkspacePath,
    agentId,
    agentName: normalizeOptionalValue(input.name) ?? currentName ?? agentId,
    policy,
    behaviorInstructions: workerProfile.employment.behaviorInstructions,
    setupAgentId,
    snapshot
  });
  const currentDeclaredSkills = filterAgentPolicySkills(agent.skills);
  const currentDeclaredTools = normalizeDeclaredAgentTools(agent.tools);
  const shouldResetSkills = policy.preset !== agent.policy.preset || currentDeclaredSkills.length === 0;
  const shouldResetTools = policy.preset !== agent.policy.preset || currentDeclaredTools.length === 0;
  const shouldClearLegacyCustomSkills =
    input.skills === undefined &&
    policy.preset === "custom" &&
    areSameStringSet(currentDeclaredSkills, LEGACY_CUSTOM_PRESET_SKILL_IDS);
  const nextDeclaredSkills =
    input.skills === undefined
      ? shouldClearLegacyCustomSkills
        ? []
        : shouldResetSkills
        ? presetSkillIds
        : currentDeclaredSkills
      : normalizeDeclaredAgentSkills(input.skills);
  for (const skillId of nextDeclaredSkills) {
    await ensureWorkspaceSkillMarkdownFromProvisioning(resolvedWorkspacePath, skillId);
  }

  await updateAgentGatewayMetadataOrDeferToConfig(
    {
      id: agentId,
      workspace: resolvedWorkspacePath,
      model: nextModelId
    },
    "updating the agent",
    gatewayOptions
  );

  const configEntry = await upsertAgentConfigEntryWithRecovery(
    agentId,
    resolvedWorkspacePath,
    {
      agentDir: agent.agentDir ?? buildWorkspaceAgentStatePath(resolvedWorkspacePath, agentId),
      name: workerProfile.identity.displayName ?? currentName ?? agentId,
      description: workerProfile.employment.mission,
      model: nextModelId,
      heartbeat,
      skills: uniqueStrings([...nextDeclaredSkills, policySkillId]),
      tools: resolveAgentToolPolicyInput(input.toolPolicy, policy.fileAccess, agent.toolPolicy),
      sandbox: input.sandbox,
      memorySearch: input.memorySearch,
      identity: {
        name: workerProfile.identity.displayName ?? currentName ?? agentId,
        emoji: workerProfile.identity.emoji ?? currentEmoji,
        theme: workerProfile.identity.theme ?? currentTheme,
        avatar: workerProfile.identity.avatar ?? agent.identity.avatar
      }
    },
    snapshot,
    undefined,
    gatewayOptions
  );
  if (input.skills !== undefined) {
    await assertAgentSkillConfigPersisted(agentId, nextDeclaredSkills, gatewayOptions);
  }
  const nextDeclaredTools =
    input.tools === undefined
      ? shouldResetTools
        ? presetToolIds
        : undefined
      : normalizeDeclaredAgentTools(input.tools);

  await upsertWorkspaceProjectAgentMetadata(resolvedWorkspacePath, {
    id: agentId,
    name: workerProfile.identity.displayName ?? currentName ?? configEntry.name ?? agentId,
    role: workerProfile.employment.role ?? formatAgentPresetLabel(policy.preset),
    emoji: workerProfile.identity.emoji ?? currentEmoji,
    theme: workerProfile.identity.theme ?? currentTheme,
    enabled: true,
    modelId: nextModelId,
    isPrimary: agent.isDefault,
    policy,
    channelIds: input.channelIds,
    skillId: nextDeclaredSkills[0] ?? null,
    skillIds: nextDeclaredSkills,
    toolIds: nextDeclaredTools,
    workerProfile
  });
  await syncWorkspaceAgentsMarkdown(resolvedWorkspacePath);
  await pruneUnreferencedGeneratedWorkspaceSkills(
    resolvedWorkspacePath,
    collectWorkspaceSkillReferences(snapshot, resolvedWorkspacePath, new Map([[agentId, nextDeclaredSkills]]))
  );
  await preserveLegacyAgentContextFiles(
    agentId,
    resolvedWorkspacePath,
    agent.agentDir ?? buildWorkspaceAgentStatePath(resolvedWorkspacePath, agentId)
  );

  invalidateMissionControlSnapshotCache();

  return {
    agentId,
    workspaceId: resolvedWorkspaceId
  };
}

export async function deleteAgent(input: AgentDeleteInput, gatewayOptions: OpenClawCommandOptions = {}) {
  const agentId = input.agentId.trim();
  if (!agentId) {
    throw new Error("Agent id is required.");
  }

  const workspaceId = await resolveAgentLifecycleWorkspaceId(agentId);
  return withLifecycleOperationLock({
    kind: "agent.delete",
    targetId: agentId,
    resourceKeys: [
      lifecycleAgentResourceKey(agentId),
      ...(workspaceId ? [lifecycleWorkspaceResourceKey(workspaceId)] : [])
    ],
    run: () => deleteAgentInternal(input, gatewayOptions)
  });
}

async function resolveAgentLifecycleWorkspaceId(agentId: string) {
  try {
    const snapshot = await getMissionControlSnapshot({ includeHidden: true });
    const liveWorkspaceId = snapshot.agents.find((entry) => entry.id === agentId)?.workspaceId;
    if (liveWorkspaceId) return liveWorkspaceId;
  } catch {
    // Fall through to the durable operation metadata.
  }
  try {
    const operation = await readLifecycleOperation("agent.delete", agentId);
    return operation.metadata.workspaceId ?? null;
  } catch {
    return null;
  }
}

async function resolveWorkspaceLifecycleWorkspaceId(workspaceId: string) {
  try {
    const snapshot = await getMissionControlSnapshot({ includeHidden: true });
    return findWorkspaceById(snapshot, workspaceId)?.id ?? null;
  } catch {
    return null;
  }
}

async function deleteAgentInternal(input: AgentDeleteInput, gatewayOptions: OpenClawCommandOptions = {}) {
  const agentId = input.agentId.trim();

  if (!agentId) {
    throw new Error("Agent id is required.");
  }

  let lifecycleOperation = (await createOrReadLifecycleOperation({
    kind: "agent.delete",
    targetId: agentId,
  })).operation;
  if (lifecycleOperation.state === "ready" && lifecycleOperation.result) {
    const liveSnapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    if (!liveSnapshot.agents.some((entry) => entry.id === agentId)) {
      return lifecycleOperation.result as unknown as AgentDeleteResult;
    }
    lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
      state: "requested",
      stage: "requested",
      nativeAccepted: false,
      nativeConfirmed: false,
      sidecarSynchronized: false,
      warnings: [],
      error: null,
      result: null,
      metadata: { workspaceId: null, workspacePath: null, agentIds: [agentId], channelIds: [] },
      items: {}
    });
  }

  if (lifecycleOperation.state === "failed" && !lifecycleOperation.nativeAccepted) {
    if (!isExplicitLifecycleRecovery(input.recoveryGeneration, lifecycleOperation.recoveryGeneration)) {
      if (lifecycleOperation.result) {
        return lifecycleOperation.result as unknown as AgentDeleteResult;
      }
      throw new Error(
        "The previous AgentOS delete attempt failed. An explicit recovery attempt is required before AgentOS can issue a new delete request."
      );
    }

    lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
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

  let snapshot = await getMissionControlSnapshot({ includeHidden: true });
  let agent = snapshot.agents.find((entry) => entry.id === agentId);
  if (!agent) {
    snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    agent = snapshot.agents.find((entry) => entry.id === agentId);
  }

  const workspace = agent
    ? snapshot.workspaces.find((entry) => entry.id === agent.workspaceId) ?? null
    : null;
  const workspaceId = agent?.workspaceId ?? lifecycleOperation.metadata.workspaceId ?? "";
  const workspacePath = agent?.workspacePath ?? workspace?.path ?? lifecycleOperation.metadata.workspacePath ?? "";
  const runtimeCount = agent
    ? snapshot.runtimes.filter((runtime) => runtime.agentId === agent.id).length
    : 0;
  const channelIds = uniqueStrings([
    ...(lifecycleOperation.metadata.channelIds ?? []),
    ...snapshot.channelRegistry.channels
      .filter((channel) => channel.workspaces.some((binding) =>
        binding.workspaceId === workspaceId &&
        (binding.agentIds.includes(agentId) || binding.groupAssignments.some((assignment) => assignment.agentId === agentId))
      ))
      .map((channel) => channel.id)
  ]);
  const warnings: string[] = [];

  lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
    state: "running",
    stage: "reading-native-state",
    metadata: {
      workspaceId,
      workspacePath,
      agentIds: [agentId],
      channelIds
    }
  });

  let nativeAccepted = lifecycleOperation.nativeAccepted;
  let nativeConfirmed = !agent;
  if (agent) {
    const priorNativeOutcome = lifecycleOperation.nativeAccepted ||
      lifecycleOperation.items[agentId] === "unknown" ||
      lifecycleOperation.items[agentId] === "confirmed";
    if (priorNativeOutcome) {
      const reconciliation = await reconcileLifecycleState({
        read: () => getMissionControlSnapshot({ force: true, includeHidden: true }),
        isConfirmed: (current) => !current.agents.some((entry) => entry.id === agentId)
      });
      if (reconciliation.outcome !== "confirmed") {
        const message = reconciliation.error ?? `OpenClaw still reports agent ${agentId}.`;
        const result = {
          agentId,
          workspaceId,
          workspacePath,
          deletedRuntimeCount: runtimeCount,
          outcome: "unknown",
          operationId: lifecycleOperation.operationId,
          recoveryGeneration: lifecycleOperation.recoveryGeneration,
          nativeAccepted,
          nativeConfirmed: false,
          sidecarSynchronized: false,
          warnings: uniqueStrings([...warnings, message])
        } satisfies AgentDeleteResult;
        await updateLifecycleOperation(lifecycleOperation, {
          state: "unknown",
          stage: "reconciling-native-state",
          nativeConfirmed: false,
          lastReconciledAt: new Date().toISOString(),
          error: { code: "native-agent-removal-uncertain", message: result.warnings[0] ?? message },
          result
        });
        return result;
      }
      nativeConfirmed = true;
      lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
        items: { [agentId]: "confirmed" },
        nativeConfirmed: true
      });
    } else {
      lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
        stage: "native-mutation"
      });
      lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
        mutationAttemptCount: lifecycleOperation.mutationAttemptCount + 1,
        lastMutationAt: new Date().toISOString()
      });
      const nativeExecution = await executeNativeMutationWithVerification({
        operation: "agent.delete",
        mutate: () => getOpenClawAdapter().deleteAgent(agentId, gatewayOptions),
        verify: async () => {
          const reconciliation = await reconcileLifecycleState({
            read: () => getMissionControlSnapshot({ force: true, includeHidden: true }),
            isConfirmed: (current) => !current.agents.some((entry) => entry.id === agentId)
          });
          return reconciliation.outcome === "confirmed";
        }
      });
      nativeAccepted = nativeExecution.outcome !== "failed" || nativeExecution.classification.requestSent === true;
      if (nativeExecution.outcome !== "succeeded") {
        const message = nativeExecution.classification.message || `OpenClaw could not delete agent ${agentId}.`;
        const outcome = nativeExecution.outcome;
        const result = {
          agentId,
          workspaceId,
          workspacePath,
          deletedRuntimeCount: runtimeCount,
          outcome,
          operationId: lifecycleOperation.operationId,
          recoveryGeneration: lifecycleOperation.recoveryGeneration,
          nativeAccepted,
          nativeConfirmed: false,
          sidecarSynchronized: false,
          warnings: uniqueStrings([...warnings, message])
        } satisfies AgentDeleteResult;
        await updateLifecycleOperation(lifecycleOperation, {
          state: outcome,
          stage: "reconciling-native-state",
          nativeAccepted,
          nativeConfirmed: false,
          lastReconciledAt: new Date().toISOString(),
          items: { [agentId]: outcome === "unknown" ? "unknown" : "failed" },
          error: { code: outcome === "unknown" ? "native-agent-removal-uncertain" : "native-agent-removal-failed", message },
          result
        });
        return result;
      }
      nativeConfirmed = true;
      lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
        items: { [agentId]: "confirmed" },
        nativeAccepted,
        nativeConfirmed: true,
        lastReconciledAt: new Date().toISOString(),
        lastConfirmedNativeStateAt: new Date().toISOString()
      });
    }
  }

  lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
    stage: "sidecar-sync",
    nativeAccepted,
    nativeConfirmed
  });
  const sidecarSteps = [
    ...channelIds.map((channelId) => ({
      id: `channel:${channelId}`,
      label: `disconnect channel ${channelId}`,
      run: () => unbindWorkspaceChannelAgent({
        channelId,
        workspaceId,
        agentId
      })
    })),
    {
      id: "agent-config",
      label: "sync the agent config",
      run: async () => {
        const configList = await readAgentConfigList(snapshot, gatewayOptions);
        const nextConfigList = configList.filter((entry) => entry.id !== agentId);
        if (nextConfigList.length !== configList.length) {
          await writeAgentConfigList(nextConfigList, gatewayOptions);
        }
      }
    },
    ...(workspacePath ? [
      {
        id: "workspace-agent-metadata",
        label: "remove workspace agent metadata",
        run: () => removeWorkspaceProjectAgentMetadata(workspacePath, agentId)
      },
      {
        id: "workspace-agent-document",
        label: "sync the workspace agent document",
        run: () => syncWorkspaceAgentsMarkdown(workspacePath)
      },
      {
        id: "workspace-generated-skills",
        label: "prune generated workspace skills",
        run: () => pruneUnreferencedGeneratedWorkspaceSkills(
          workspacePath,
          collectWorkspaceSkillReferences(snapshot, workspacePath, new Map([[agentId, []]]))
        )
      },
      {
        id: "legacy-agent-context",
        label: "preserve legacy agent context",
        run: () => preserveLegacyAgentContextFiles(
          agentId,
          workspacePath,
          agent?.agentDir ?? buildWorkspaceAgentStatePath(workspacePath, agentId)
        )
      },
      {
        id: "agent-policy-skill",
        label: "remove the generated policy skill",
        run: () => rm(path.join(workspacePath, "skills", buildAgentPolicySkillId(agentId)), {
          recursive: true,
          force: true
        })
      },
      {
        id: "workspace-policy-skills",
        label: "sync workspace policy skills",
        run: () => syncWorkspaceAgentPolicySkills(workspacePath, gatewayOptions)
      }
    ] : [])
  ];
  const sidecarResult = await runLifecycleSidecarSteps(sidecarSteps, {
    completed: lifecycleOperation.sidecars,
    onSuccess: async (stepId) => {
      lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
        sidecars: { [stepId]: "confirmed" }
      });
    },
    onFailure: async (stepId) => {
      lifecycleOperation = await updateLifecycleOperation(lifecycleOperation, {
        sidecars: { [stepId]: "failed" }
      });
    }
  });
  warnings.push(...sidecarResult.warnings);

  invalidateMissionControlSnapshotCache();
  const finalReconciliation = await reconcileLifecycleState({
    read: () => getMissionControlSnapshot({ force: true, includeHidden: true }),
    isConfirmed: (current) => !current.agents.some((entry) => entry.id === agentId)
  });
  if (finalReconciliation.outcome !== "confirmed") {
    const message = finalReconciliation.error ?? `OpenClaw still reports agent ${agentId}.`;
    const result = {
      agentId,
      workspaceId,
      workspacePath,
      deletedRuntimeCount: runtimeCount,
      outcome: "unknown",
      operationId: lifecycleOperation.operationId,
      recoveryGeneration: lifecycleOperation.recoveryGeneration,
      nativeAccepted,
      nativeConfirmed: false,
      sidecarSynchronized: false,
      warnings: uniqueStrings([...warnings, message])
    } satisfies AgentDeleteResult;
    await updateLifecycleOperation(lifecycleOperation, {
      state: "unknown",
      stage: "reconciling-native-state",
      nativeConfirmed: false,
      warnings: result.warnings,
      error: { code: "native-agent-removal-uncertain", message },
      result
    });
    return result;
  }

  clearMissionControlRuntimeHistoryCache();
  const finalWarnings = uniqueStrings(warnings);
  const outcome: LifecycleOperationOutcome = finalWarnings.length > 0 ? "partial" : "ready";
  const result = {
    agentId,
    workspaceId,
    workspacePath,
    deletedRuntimeCount: runtimeCount,
    outcome,
    operationId: lifecycleOperation.operationId,
    recoveryGeneration: lifecycleOperation.recoveryGeneration,
    nativeAccepted,
    nativeConfirmed: true,
    sidecarSynchronized: finalWarnings.length === 0,
    warnings: finalWarnings
  } satisfies AgentDeleteResult;
  await updateLifecycleOperation(lifecycleOperation, {
    state: outcome,
    stage: outcome === "partial" ? "cleanup-partial" : "complete",
    nativeAccepted,
    nativeConfirmed: true,
    sidecarSynchronized: finalWarnings.length === 0,
    warnings: finalWarnings,
    error: null,
    result
  });
  return result;
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

function resolveWorkspaceAgentModelId(snapshot: MissionControlSnapshot, workspaceId: string) {
  return snapshot.agents
    .filter((agent) => agent.workspaceId === workspaceId && agent.kind !== "system")
    .map((agent) => normalizeOptionalValue(agent.modelId))
    .find((modelId) => modelId && modelId !== "unassigned" && isSnapshotModelUsable(snapshot, modelId));
}

function resolveRecommendedAgentModelId(snapshot: MissionControlSnapshot) {
  const recommendedModelId = normalizeOptionalValue(snapshot.diagnostics.modelReadiness.recommendedModelId);

  if (recommendedModelId && isSnapshotModelUsable(snapshot, recommendedModelId)) {
    return recommendedModelId;
  }

  return snapshot.models
    .map((model) => normalizeOptionalValue(model.id))
    .find((modelId) => modelId && isSnapshotModelUsable(snapshot, modelId));
}

function resolveWorkspaceAgentModelCandidateId(snapshot: MissionControlSnapshot, workspaceId: string) {
  return snapshot.agents
    .filter((agent) => agent.workspaceId === workspaceId && agent.kind !== "system")
    .map((agent) => normalizeOptionalValue(agent.modelId))
    .find((modelId) => modelId && modelId !== "unassigned");
}

function resolveConfiguredAgentModelCandidateId(snapshot: MissionControlSnapshot) {
  return [
    normalizeOptionalValue(snapshot.diagnostics.modelReadiness.resolvedDefaultModel),
    normalizeOptionalValue(snapshot.diagnostics.modelReadiness.defaultModel),
    ...snapshot.agents
      .filter((agent) => agent.kind !== "system")
      .map((agent) => normalizeOptionalValue(agent.modelId)),
    ...snapshot.models.map((model) => normalizeOptionalValue(model.id))
  ].find((modelId) => modelId && modelId !== "unassigned");
}

function resolveAgentNativeReadinessAgentIds(
  snapshot: MissionControlSnapshot,
  workspaceId: string,
  modelId: string | undefined
) {
  const normalizedModelId = normalizeOptionalValue(modelId)?.toLowerCase();

  if (!normalizedModelId) {
    return [];
  }

  const eligibleAgents = snapshot.agents.filter((agent) => agent.kind !== "system");
  const workspaceAgents = eligibleAgents.filter((agent) => agent.workspaceId === workspaceId);
  const matchingAgents = eligibleAgents.filter(
    (agent) => normalizeOptionalValue(agent.modelId)?.toLowerCase() === normalizedModelId
  );
  const defaultAgents = eligibleAgents.filter((agent) => agent.isDefault);

  return uniqueStrings([
    ...workspaceAgents.filter((agent) => normalizeOptionalValue(agent.modelId)?.toLowerCase() === normalizedModelId).map((agent) => agent.id),
    ...matchingAgents.map((agent) => agent.id),
    ...workspaceAgents.map((agent) => agent.id),
    ...defaultAgents.map((agent) => agent.id),
    ...eligibleAgents.map((agent) => agent.id)
  ]).slice(0, 3);
}

export function resolveAgentCreateModelSelection(
  snapshot: MissionControlSnapshot,
  requestedModelId: string | undefined,
  fallbackModelId: string | undefined
) {
  let modelId = requestedModelId ?? fallbackModelId;
  const warnings: string[] = [];

  if (!requestedModelId || !fallbackModelId || fallbackModelId === requestedModelId) {
    return { modelId, warnings };
  }

  const requestedReadinessError = resolveAgentCreationReadinessError(snapshot, requestedModelId);
  const fallbackReadinessError = resolveAgentCreationReadinessError(snapshot, fallbackModelId);

  if (requestedReadinessError && !fallbackReadinessError) {
    modelId = fallbackModelId;
    warnings.push(
      `Requested model ${requestedModelId} is not ready. AgentOS created the agent with ${fallbackModelId}; configure ${requestedModelId} before assigning it.`
    );
  }

  return { modelId, warnings };
}

function isSnapshotModelUsable(snapshot: MissionControlSnapshot, modelId: string) {
  const model = snapshot.models.find((entry) => entry.id === modelId);

  if (!model) {
    return false;
  }

  return model.missing !== true && model.available !== false;
}

export function assertAgentModelReadyForAssignment(
  snapshot: MissionControlSnapshot,
  modelId: string | undefined
) {
  const readinessError = resolveAgentCreationReadinessError(snapshot, modelId);

  if (readinessError) {
    throw new Error(readinessError);
  }
}

function assertAgentIdAvailable(
  snapshot: MissionControlSnapshot,
  agentId: string,
  targetWorkspaceId?: string | null
) {
  const existingAgent = snapshot.agents.find((agent) => agent.id === agentId);

  if (!existingAgent) {
    return;
  }

  const workspaceLabel = describeAgentWorkspace(snapshot, existingAgent);

  if (existingAgent.workspaceId === targetWorkspaceId) {
    throw new Error(`Agent id "${agentId}" already exists in workspace "${workspaceLabel}".`);
  }

  throw new Error(
    `Agent id "${agentId}" is already used by workspace "${workspaceLabel}". Choose a different id.`
  );
}

function describeAgentWorkspace(
  snapshot: MissionControlSnapshot,
  agent: Pick<OpenClawAgent, "workspaceId" | "workspacePath">
) {
  return (
    snapshot.workspaces.find((workspace) => workspace.id === agent.workspaceId)?.name ??
    path.basename(agent.workspacePath)
  );
}

async function syncAgentPolicySkills(
  agentIds: string[],
  snapshot?: MissionControlSnapshot,
  gatewayOptions: OpenClawCommandOptions = {}
) {
  const relevantAgentIds = uniqueStrings(agentIds);

  if (relevantAgentIds.length === 0) {
    return;
  }

  const nextSnapshot = snapshot ?? (await getMissionControlSnapshot({ includeHidden: true }));

  for (const agentId of relevantAgentIds) {
    const agent = nextSnapshot.agents.find((entry) => entry.id === agentId);

    if (!agent) {
      continue;
    }

    const setupAgentId =
      nextSnapshot.agents.find(
        (entry) => entry.workspaceId === agent.workspaceId && entry.policy.preset === "setup" && entry.id !== agent.id
      )?.id ?? null;

    const policySkillId = await ensureAgentPolicySkillFromProvisioning({
      workspacePath: agent.workspacePath,
      agentId: agent.id,
      agentName: agent.name,
      policy: agent.policy,
      setupAgentId,
      snapshot: nextSnapshot
    });

    await upsertAgentConfigEntryWithRecovery(
      agent.id,
      agent.workspacePath,
      {
        agentDir: agent.agentDir ?? buildWorkspaceAgentStatePath(agent.workspacePath, agent.id),
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
          : null,
        identity: {
          name: agent.identityName ?? agent.name,
          emoji: agent.identity.emoji,
          theme: agent.identity.theme,
          avatar: agent.identity.avatar
        }
      },
      nextSnapshot,
      undefined,
      gatewayOptions
    );
  }
}

async function upsertAgentConfigEntryWithRecovery(...args: Parameters<typeof upsertAgentConfigEntry>) {
  return runAgentGatewayMutation("syncing the agent config", () => upsertAgentConfigEntry(...args));
}

async function assertAgentSkillConfigPersisted(
  agentId: string,
  expectedSkills: string[],
  gatewayOptions: OpenClawCommandOptions = {}
) {
  const configList = await readAgentConfigList(undefined, gatewayOptions);
  const persistedAgent = configList.find((entry) => entry.id === agentId);
  const persistedSkills = filterAgentPolicySkills(persistedAgent?.skills ?? []);

  if (!persistedAgent || !areSameStringSet(persistedSkills, expectedSkills)) {
    throw new Error(
      "OpenClaw Gateway did not persist the agent skill configuration. Repair AgentOS device access in Gateway settings, then retry."
    );
  }
}

async function runAgentGatewayMutation<T>(operationLabel: string, operation: () => Promise<T>) {
  const result = await runWithGatewayAuthSetupRecovery(operation, {
    operationLabel
  });

  return result.value;
}

async function syncWorkspaceAgentPolicySkills(
  workspacePath: string,
  gatewayOptions: OpenClawCommandOptions = {},
  snapshot?: MissionControlSnapshot
) {
  const nextSnapshot = snapshot ?? (await getMissionControlSnapshot({ includeHidden: true }));
  const agentIds = nextSnapshot.agents
    .filter((entry) => entry.workspacePath === workspacePath)
    .map((entry) => entry.id);

  await syncAgentPolicySkills(agentIds, nextSnapshot, gatewayOptions);
}

async function upsertWorkspaceProjectAgentMetadata(
  workspacePath: string,
  agent: {
    id: string;
    name?: string | null;
    role?: string | null;
    isPrimary?: boolean;
    enabled?: boolean;
    emoji?: string | null;
    theme?: string | null;
    skillId?: string | null;
    skillIds?: string[];
    toolIds?: string[];
    modelId?: string | null;
    policy: AgentPolicy;
    channelIds?: string[];
    workerProfile?: OpenClawAgent["workerProfile"];
  }
) {
  const projectFilePath = path.join(workspacePath, ".openclaw", "project.json");
  let parsed: Record<string, unknown> = {};
  let existingAgent: WorkspaceProjectManifestAgent | null = null;

  try {
    const raw = await readFile(projectFilePath, "utf8");
    const candidate = JSON.parse(raw);
    parsed = isObjectRecord(candidate) ? candidate : {};
    if (Array.isArray(parsed.agents)) {
      existingAgent =
        parsed.agents
          .map((entry) => parseWorkspaceProjectManifestAgent(entry))
          .filter((entry): entry is WorkspaceProjectManifestAgent => Boolean(entry))
          .find((entry) => entry.id === agent.id) ?? null;
    }
  } catch {
    parsed = {};
  }

  const nextSkillIds = Array.isArray(agent.skillIds)
    ? uniqueStrings(agent.skillIds.map((skillId) => skillId.trim()).filter(Boolean))
    : agent.skillId !== undefined
      ? [normalizeOptionalValue(agent.skillId)].filter((skillId): skillId is string => Boolean(skillId))
      : existingAgent?.skillIds ?? (existingAgent?.skillId ? [existingAgent.skillId] : []);

  const nextAgent = {
    id: agent.id,
    name: agent.name ?? existingAgent?.name ?? null,
    role: agent.role ?? existingAgent?.role ?? null,
    isPrimary: agent.isPrimary ?? existingAgent?.isPrimary ?? false,
    enabled: agent.enabled ?? existingAgent?.enabled ?? true,
    emoji: agent.emoji ?? existingAgent?.emoji ?? null,
    theme: agent.theme ?? existingAgent?.theme ?? null,
    skillId: nextSkillIds[0] ?? null,
    skillIds: nextSkillIds,
    toolIds: Array.isArray(agent.toolIds)
      ? uniqueStrings(
          agent.toolIds
            .map((toolId) => toolId.trim())
            .filter((toolId) => Boolean(toolId) && toolId !== "fs.workspaceOnly")
        )
      : existingAgent?.toolIds ?? [],
    modelId: agent.modelId ?? existingAgent?.modelId ?? null,
    policy: agent.policy,
    workerProfile: agent.workerProfile ?? existingAgent?.workerProfile ?? null,
    channelIds: Array.isArray(agent.channelIds)
      ? Array.from(new Set(agent.channelIds.filter((entry) => typeof entry === "string" && entry.trim())))
      : existingAgent?.channelIds ?? []
  };
  const agents = Array.isArray(parsed.agents)
    ? parsed.agents.filter((entry) => isObjectRecord(entry) && typeof entry.id === "string" && entry.id !== agent.id)
    : [];

  agents.push(nextAgent);
  parsed.slug = typeof parsed.slug === "string" ? parsed.slug : slugify(path.basename(workspacePath));
  parsed.name = typeof parsed.name === "string" ? parsed.name : path.basename(workspacePath);
  const serialized = serializeWorkspaceProjectManifestRecord(parsed, {
    updatedAt: new Date().toISOString(),
    agents
  });

  await writeTextFileEnsured(projectFilePath, `${JSON.stringify(serialized, null, 2)}\n`);
}

async function removeWorkspaceProjectAgentMetadata(workspacePath: string, agentId: string) {
  const projectFilePath = path.join(workspacePath, ".openclaw", "project.json");
  let parsed: Record<string, unknown> = {};

  try {
    const raw = await readFile(projectFilePath, "utf8");
    const candidate = JSON.parse(raw);
    parsed = isObjectRecord(candidate) ? candidate : {};
  } catch {
    return;
  }

  if (!Array.isArray(parsed.agents)) {
    return;
  }

  const existingAgents = parsed.agents
    .map((entry) => parseWorkspaceProjectManifestAgent(entry))
    .filter((entry): entry is WorkspaceProjectManifestAgent => Boolean(entry));
  const nextAgents = existingAgents.filter((entry) => entry.id !== agentId);

  if (nextAgents.length === existingAgents.length) {
    return;
  }

  if (nextAgents.length > 0 && !nextAgents.some((entry) => entry.isPrimary)) {
    nextAgents[0] = {
      ...nextAgents[0],
      isPrimary: true
    };
  }

  const serialized = serializeWorkspaceProjectManifestRecord(parsed, {
    updatedAt: new Date().toISOString(),
    agents: nextAgents
  });

  await writeTextFileEnsured(projectFilePath, `${JSON.stringify(serialized, null, 2)}\n`);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isExplicitLifecycleRecovery(requestedGeneration: number | undefined, currentGeneration: number) {
  return Number.isInteger(requestedGeneration) && requestedGeneration === currentGeneration + 1;
}

export function resolveWorkerProfileUpdatePatch(input: AgentUpdateInput): AgentOSWorkerProfileInput | undefined {
  const identity = input.workerProfile?.identity;
  const nextIdentity = {
    displayName: identity?.displayName !== undefined ? identity.displayName : input.name,
    emoji: identity?.emoji !== undefined ? identity.emoji : input.emoji,
    theme: identity?.theme !== undefined ? identity.theme : input.theme,
    avatar: identity?.avatar !== undefined ? identity.avatar : input.avatar
  };
  const hasIdentityPatch = Object.values(nextIdentity).some((value) => value !== undefined);

  if (!input.workerProfile && !hasIdentityPatch) {
    return undefined;
  }

  return {
    schemaVersion: AGENTOS_WORKER_PROFILE_SCHEMA_VERSION,
    ...input.workerProfile,
    ...(hasIdentityPatch ? { identity: nextIdentity } : {})
  };
}

function areSameStringSet(left: string[], right: string[]) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);

  if (leftSet.size !== rightSet.size) {
    return false;
  }

  return Array.from(leftSet).every((value) => rightSet.has(value));
}

function collectWorkspaceSkillReferences(
  snapshot: MissionControlSnapshot,
  workspacePath: string,
  overrides: Map<string, string[]>
) {
  return uniqueStrings([
    ...snapshot.agents.flatMap((agent) => {
      if (agent.workspacePath !== workspacePath) {
        return [];
      }

      return overrides.has(agent.id) ? overrides.get(agent.id) ?? [] : agent.skills;
    }),
    ...Array.from(overrides.values()).flat()
  ]);
}

function findWorkspaceById(snapshot: MissionControlSnapshot, workspaceId: string | undefined) {
  if (!workspaceId) {
    return undefined;
  }

  return (
    snapshot.workspaces.find((entry) => entry.id === workspaceId) ??
    snapshot.workspaces.find((entry) => workspacePathMatchesId(entry.path, workspaceId))
  );
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
