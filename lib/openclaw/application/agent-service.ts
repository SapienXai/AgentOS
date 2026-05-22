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
  clearMissionControlRuntimeHistoryCache,
  getMissionControlSnapshot,
  invalidateMissionControlSnapshotCache
} from "@/lib/openclaw/application/mission-control-service";
import {
  buildAgentPolicySkillId,
  buildWorkspaceAgentStatePath,
  filterAgentPolicySkills,
  mapAgentHeartbeatToInput,
  normalizeDeclaredAgentSkills,
  normalizeDeclaredAgentTools,
  readAgentConfigList,
  removeLegacyAgentContextFiles,
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
  type WorkspaceProjectManifestAgent
} from "@/lib/openclaw/domains/workspace-manifest";
import { syncWorkspaceAgentsMarkdown } from "@/lib/openclaw/domains/workspace-agents-document-sync";
import { normalizeOptionalValue } from "@/lib/openclaw/domains/control-plane-normalization";
import { writeTextFileEnsured } from "@/lib/openclaw/domains/workspace-bootstrap";
import { workspaceIdFromPath, workspacePathMatchesId } from "@/lib/openclaw/domains/workspace-id";
import { resolveAgentCreationReadinessError } from "@/lib/openclaw/readiness";
import type {
  AgentCreateInput,
  AgentDeleteInput,
  AgentPolicy,
  AgentUpdateInput,
  MissionControlSnapshot,
  OpenClawAgent
} from "@/lib/openclaw/types";

const LEGACY_CUSTOM_PRESET_SKILL_IDS = ["project-researcher", "project-builder", "project-analyst"];

export async function createAgent(input: AgentCreateInput) {
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
  assertAgentIdAvailable(snapshot, agentId, resolvedWorkspaceId);

  if (!resolvedWorkspacePath || !resolvedWorkspaceId) {
    throw new Error("Workspace was not found for this agent.");
  }

  const requestedModelId = normalizeOptionalValue(input.modelId);
  const agentModelId =
    requestedModelId ??
    resolveSnapshotDefaultAgentModelId(snapshot) ??
    resolveWorkspaceAgentModelId(snapshot, resolvedWorkspaceId) ??
    resolveRecommendedAgentModelId(snapshot);

  const readinessError = resolveAgentCreationReadinessError(snapshot, agentModelId);

  if (readinessError) {
    throw new Error(readinessError);
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
    presetMeta.defaultName;
  const emoji =
    normalizeOptionalValue(input.emoji) ??
    presetMeta.defaultEmoji;
  const theme =
    normalizeOptionalValue(input.theme) ??
    presetMeta.defaultTheme;
  const avatar = normalizeOptionalValue(input.avatar);
  const heartbeat = serializeHeartbeatConfig(resolveHeartbeatDraft(policy.preset, input.heartbeat));
  const setupAgentId =
    snapshot.agents.find((entry) => entry.workspaceId === resolvedWorkspaceId && entry.policy.preset === "setup")?.id ?? null;
  const agentDir = buildWorkspaceAgentStatePath(resolvedWorkspacePath, agentId);

  await getOpenClawAdapter().addAgent({
    id: agentId,
    workspace: resolvedWorkspacePath,
    agentDir,
    model: agentModelId,
    name: displayName,
    emoji,
    avatar
  });

  const policySkillId = await ensureAgentPolicySkillFromProvisioning({
    workspacePath: resolvedWorkspacePath,
    agentId,
    agentName: displayName,
    policy,
    setupAgentId,
    snapshot
  });
  for (const skillId of declaredSkillIds) {
    await ensureWorkspaceSkillMarkdownFromProvisioning(resolvedWorkspacePath, skillId);
  }

  await upsertAgentConfigEntry(
    agentId,
    resolvedWorkspacePath,
    {
      agentDir,
      name: displayName,
      model: agentModelId,
      heartbeat,
      skills: uniqueStrings([...declaredSkillIds, policySkillId]),
      tools:
        policy.fileAccess === "workspace-only"
          ? {
              fs: {
                workspaceOnly: true
              }
            }
          : null,
      identity: {
        name: displayName,
        emoji,
        theme,
        avatar
      }
    },
    snapshot
  );

  await upsertWorkspaceProjectAgentMetadata(resolvedWorkspacePath, {
    id: agentId,
    name: displayName,
    role: formatAgentPresetLabel(policy.preset),
    emoji,
    theme,
    enabled: true,
    skillId: declaredSkillIds[0] ?? null,
    skillIds: declaredSkillIds,
    toolIds: declaredToolIds,
    modelId: agentModelId,
    isPrimary: false,
    policy,
    channelIds: input.channelIds ?? []
  });
  await syncWorkspaceAgentsMarkdown(resolvedWorkspacePath);
  await pruneUnreferencedGeneratedWorkspaceSkills(
    resolvedWorkspacePath,
    collectWorkspaceSkillReferences(snapshot, resolvedWorkspacePath, new Map([[agentId, declaredSkillIds]]))
  );
  await removeLegacyAgentContextFiles(agentId, resolvedWorkspacePath, agentDir);

  invalidateMissionControlSnapshotCache();
  await syncWorkspaceAgentPolicySkills(resolvedWorkspacePath);

  return {
    agentId,
    workspaceId: resolvedWorkspaceId
  };
}

export async function updateAgent(input: AgentUpdateInput) {
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
  const setupAgentId =
    snapshot.agents.find((entry) => entry.workspaceId === resolvedWorkspaceId && entry.policy.preset === "setup" && entry.id !== agentId)?.id ??
    null;
  const nextModelId =
    input.modelId !== undefined
      ? normalizeOptionalValue(input.modelId)
      : agent.modelId === "unassigned"
        ? resolveSnapshotDefaultAgentModelId(snapshot)
        : agent.modelId;
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
    input.tools === undefined;

  if (onlyModelChanged) {
    await getOpenClawAdapter().updateAgent({
      id: agentId,
      workspace: resolvedWorkspacePath,
      model: nextModelId
    }, { timeoutMs: 15_000 });

    await upsertAgentConfigEntry(
      agentId,
      resolvedWorkspacePath,
      {
        agentDir: agent.agentDir ?? buildWorkspaceAgentStatePath(resolvedWorkspacePath, agentId),
        model: nextModelId
      },
      snapshot
    );

    await upsertWorkspaceProjectAgentMetadata(resolvedWorkspacePath, {
      id: agentId,
      name: currentName ?? agent.name ?? agentId,
      emoji: currentEmoji,
      theme: currentTheme,
      enabled: true,
      modelId: nextModelId,
      isPrimary: agent.isDefault,
      policy
    });
    await syncWorkspaceAgentsMarkdown(resolvedWorkspacePath);
    await removeLegacyAgentContextFiles(
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

  await getOpenClawAdapter().updateAgent({
    id: agentId,
    workspace: resolvedWorkspacePath,
    model: nextModelId
  }, { timeoutMs: 15_000 });

  const configEntry = await upsertAgentConfigEntry(
    agentId,
    resolvedWorkspacePath,
    {
      agentDir: agent.agentDir ?? buildWorkspaceAgentStatePath(resolvedWorkspacePath, agentId),
      name: input.name !== undefined ? normalizeOptionalValue(input.name) : undefined,
      model: nextModelId,
      heartbeat,
      skills: uniqueStrings([...nextDeclaredSkills, policySkillId]),
      tools:
        policy.fileAccess === "workspace-only"
          ? {
              fs: {
                workspaceOnly: true
              }
            }
          : null,
      identity: {
        name: normalizeOptionalValue(input.name) ?? currentName ?? agentId,
        emoji: normalizeOptionalValue(input.emoji) ?? currentEmoji,
        theme: normalizeOptionalValue(input.theme) ?? currentTheme,
        avatar: normalizeOptionalValue(input.avatar)
      }
    },
    snapshot
  );
  const nextDeclaredTools =
    input.tools === undefined
      ? shouldResetTools
        ? presetToolIds
        : undefined
      : normalizeDeclaredAgentTools(input.tools);

  await upsertWorkspaceProjectAgentMetadata(resolvedWorkspacePath, {
    id: agentId,
    name: normalizeOptionalValue(input.name) ?? currentName ?? configEntry.name ?? agentId,
    emoji: normalizeOptionalValue(input.emoji) ?? currentEmoji,
    theme: normalizeOptionalValue(input.theme) ?? currentTheme,
    enabled: true,
    modelId: nextModelId,
    isPrimary: agent.isDefault,
    policy,
    channelIds: input.channelIds,
    skillId: nextDeclaredSkills[0] ?? null,
    skillIds: nextDeclaredSkills,
    toolIds: nextDeclaredTools
  });
  await syncWorkspaceAgentsMarkdown(resolvedWorkspacePath);
  await pruneUnreferencedGeneratedWorkspaceSkills(
    resolvedWorkspacePath,
    collectWorkspaceSkillReferences(snapshot, resolvedWorkspacePath, new Map([[agentId, nextDeclaredSkills]]))
  );
  await removeLegacyAgentContextFiles(
    agentId,
    resolvedWorkspacePath,
    agent.agentDir ?? buildWorkspaceAgentStatePath(resolvedWorkspacePath, agentId)
  );

  invalidateMissionControlSnapshotCache();
  await syncWorkspaceAgentPolicySkills(resolvedWorkspacePath);

  return {
    agentId,
    workspaceId: resolvedWorkspaceId
  };
}

export async function deleteAgent(input: AgentDeleteInput) {
  const agentId = input.agentId.trim();

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

  const workspace = snapshot.workspaces.find((entry) => entry.id === agent.workspaceId) ?? null;
  const runtimeCount = snapshot.runtimes.filter((runtime) => runtime.agentId === agent.id).length;

  await getOpenClawAdapter().deleteAgent(agent.id);

  try {
    const configList = await readAgentConfigList(snapshot);
    const nextConfigList = configList.filter((entry) => entry.id !== agent.id);

    if (nextConfigList.length !== configList.length) {
      await writeAgentConfigList(nextConfigList);
    }
  } catch {
    // Ignore config cleanup failures if the CLI delete already removed the entry.
  }

  if (workspace) {
    await removeWorkspaceProjectAgentMetadata(workspace.path, agent.id);
    await syncWorkspaceAgentsMarkdown(workspace.path);
    await pruneUnreferencedGeneratedWorkspaceSkills(
      workspace.path,
      collectWorkspaceSkillReferences(snapshot, workspace.path, new Map([[agent.id, []]]))
    );
    await removeLegacyAgentContextFiles(agent.id, workspace.path, agent.agentDir);

    try {
      await rm(path.join(workspace.path, "skills", buildAgentPolicySkillId(agent.id)), {
        recursive: true,
        force: true
      });
    } catch {
      // Ignore skill cleanup failures for already-pruned workspaces.
    }

    invalidateMissionControlSnapshotCache();
    await syncWorkspaceAgentPolicySkills(workspace.path);
  }

  clearMissionControlRuntimeHistoryCache();

  return {
    agentId: agent.id,
    workspaceId: agent.workspaceId,
    workspacePath: agent.workspacePath,
    deletedRuntimeCount: runtimeCount
  };
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
    .filter((agent) => agent.workspaceId === workspaceId)
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

function isSnapshotModelUsable(snapshot: MissionControlSnapshot, modelId: string) {
  const model = snapshot.models.find((entry) => entry.id === modelId);

  if (!model) {
    return false;
  }

  return model.missing !== true && model.available !== false;
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

async function syncAgentPolicySkills(agentIds: string[], snapshot?: MissionControlSnapshot) {
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

    await upsertAgentConfigEntry(
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
      nextSnapshot
    );
  }
}

async function syncWorkspaceAgentPolicySkills(workspacePath: string, snapshot?: MissionControlSnapshot) {
  const nextSnapshot = snapshot ?? (await getMissionControlSnapshot({ includeHidden: true }));
  const agentIds = nextSnapshot.agents
    .filter((entry) => entry.workspacePath === workspacePath)
    .map((entry) => entry.id);

  await syncAgentPolicySkills(agentIds, nextSnapshot);
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
    channelIds: Array.isArray(agent.channelIds)
      ? Array.from(new Set(agent.channelIds.filter((entry) => typeof entry === "string" && entry.trim())))
      : existingAgent?.channelIds ?? []
  };
  const agents = Array.isArray(parsed.agents)
    ? parsed.agents.filter((entry) => isObjectRecord(entry) && typeof entry.id === "string" && entry.id !== agent.id)
    : [];

  agents.push(nextAgent);
  parsed.version = typeof parsed.version === "number" ? parsed.version : 1;
  parsed.slug = typeof parsed.slug === "string" ? parsed.slug : slugify(path.basename(workspacePath));
  parsed.name = typeof parsed.name === "string" ? parsed.name : path.basename(workspacePath);
  parsed.updatedAt = new Date().toISOString();
  parsed.agents = agents;

  await writeTextFileEnsured(projectFilePath, `${JSON.stringify(parsed, null, 2)}\n`);
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

  parsed.updatedAt = new Date().toISOString();
  parsed.agents = nextAgents;

  await writeTextFileEnsured(projectFilePath, `${JSON.stringify(parsed, null, 2)}\n`);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
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
