import "server-only";

import { clearMissionControlCaches, getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { clearModelCatalogCache } from "@/lib/openclaw/application/model-catalog-cache-service";
import { updateAgent } from "@/lib/openclaw/application/agent-service";
import {
  readOpenClawConfiguredModelIds,
  removeOpenClawConfiguredModelFromConfig,
  removeOpenClawProviderConfiguration,
  setOpenClawDefaultModel
} from "@/lib/openclaw/application/model-provider-state-service";
import { modelMatchesAddModelsProvider } from "@/lib/openclaw/domains/model-provider-connection";
import { setModelProviderDisconnected } from "@/lib/openclaw/domains/control-plane-settings";
import { normalizeAddModelsProviderId } from "@/lib/openclaw/model-provider-registry";
import type {
  AddModelsModelRemoveImpact,
  AddModelsProviderDisconnectImpact,
  AddModelsProviderId,
  MissionControlSnapshot,
  ModelRecord
} from "@/lib/agentos/contracts";

type DisconnectDependencies = {
  getSnapshot: () => Promise<MissionControlSnapshot>;
  readConfiguredModelIds: () => Promise<Set<string>>;
  setDefaultModel: typeof setOpenClawDefaultModel;
  updateAgentModel: (agentId: string, modelId: string) => Promise<unknown>;
  removeModel: typeof removeOpenClawConfiguredModelFromConfig;
  removeProviderConfiguration: typeof removeOpenClawProviderConfiguration;
  markDisconnected: (provider: string) => Promise<unknown>;
  clearCaches: () => void;
};

const defaultDependencies: DisconnectDependencies = {
  getSnapshot: () => getMissionControlSnapshot({ force: true, includeHidden: true }),
  readConfiguredModelIds: readOpenClawConfiguredModelIds,
  setDefaultModel: setOpenClawDefaultModel,
  updateAgentModel: (agentId, modelId) => updateAgent({ id: agentId, modelId }),
  removeModel: removeOpenClawConfiguredModelFromConfig,
  removeProviderConfiguration: removeOpenClawProviderConfiguration,
  markDisconnected: (provider) => setModelProviderDisconnected(provider, true),
  clearCaches: () => {
    clearMissionControlCaches();
    clearModelCatalogCache();
  }
};

export async function inspectModelProviderDisconnect(
  provider: AddModelsProviderId,
  dependencyOverrides: Partial<DisconnectDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const [snapshot, configuredModelIds] = await Promise.all([
    dependencies.getSnapshot(),
    dependencies.readConfiguredModelIds()
  ]);

  return buildModelProviderDisconnectImpact(snapshot, provider, configuredModelIds);
}

export async function disconnectModelProvider(
  provider: AddModelsProviderId,
  dependencyOverrides: Partial<DisconnectDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const [snapshot, configuredModelIds] = await Promise.all([
    dependencies.getSnapshot(),
    dependencies.readConfiguredModelIds()
  ]);
  const impact = buildModelProviderDisconnectImpact(snapshot, provider, configuredModelIds);

  if (impact.blockedReason) {
    throw new Error(impact.blockedReason);
  }

  if (impact.defaultModelAffected && impact.replacementModelId) {
    await dependencies.setDefaultModel(impact.replacementModelId, {
      provider: resolveModelProvider(snapshot, impact.replacementModelId)
    });
  }

  if (impact.replacementModelId) {
    for (const agent of impact.affectedAgents) {
      await dependencies.updateAgentModel(agent.id, impact.replacementModelId);
    }
  }

  for (const modelId of impact.providerModelIds) {
    await dependencies.removeModel(modelId, { provider });
  }

  const cleanup = await dependencies.removeProviderConfiguration(provider);
  await dependencies.markDisconnected(provider);
  dependencies.clearCaches();
  const refreshedSnapshot = await dependencies.getSnapshot();

  return {
    impact: {
      ...impact,
      credentialCleanup: cleanup.credentialCleanup
    },
    snapshot: refreshedSnapshot
  };
}

export async function inspectModelRemoval(
  provider: AddModelsProviderId,
  modelId: string,
  dependencyOverrides: Partial<DisconnectDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const [snapshot, configuredModelIds] = await Promise.all([
    dependencies.getSnapshot(),
    dependencies.readConfiguredModelIds()
  ]);

  return buildModelRemoveImpact(snapshot, provider, modelId, configuredModelIds);
}

export async function removeModelSafely(
  provider: AddModelsProviderId,
  modelId: string,
  dependencyOverrides: Partial<DisconnectDependencies> = {}
) {
  const dependencies = { ...defaultDependencies, ...dependencyOverrides };
  const [snapshot, configuredModelIds] = await Promise.all([
    dependencies.getSnapshot(),
    dependencies.readConfiguredModelIds()
  ]);
  const impact = buildModelRemoveImpact(snapshot, provider, modelId, configuredModelIds);

  if (impact.blockedReason) {
    throw new Error(impact.blockedReason);
  }

  if (impact.defaultModelAffected && impact.replacementModelId) {
    await dependencies.setDefaultModel(impact.replacementModelId, {
      provider: resolveModelProvider(snapshot, impact.replacementModelId)
    });
  }

  if (impact.replacementModelId) {
    for (const agent of impact.affectedAgents) {
      await dependencies.updateAgentModel(agent.id, impact.replacementModelId);
    }
  }

  await dependencies.removeModel(modelId, { provider });
  dependencies.clearCaches();
  const refreshedSnapshot = await dependencies.getSnapshot();

  return {
    impact,
    snapshot: refreshedSnapshot
  };
}

export function buildModelProviderDisconnectImpact(
  snapshot: MissionControlSnapshot,
  provider: AddModelsProviderId,
  configuredModelIds: Set<string>
): AddModelsProviderDisconnectImpact {
  const providerModelIds = [...configuredModelIds]
    .filter((modelId) => modelBelongsToProvider(snapshot, provider, modelId))
    .sort();
  const affectedAgents = snapshot.agents
    .filter((agent) => modelBelongsToProvider(snapshot, provider, agent.modelId))
    .map((agent) => ({ id: agent.id, name: agent.name || agent.id, modelId: agent.modelId }));
  const activeAgentIds = affectedAgents
    .filter((agent) => snapshot.agents.find((candidate) => candidate.id === agent.id)?.activeRuntimeIds.length)
    .map((agent) => agent.id);
  const currentDefaultModelId = snapshot.diagnostics.modelReadiness.resolvedDefaultModel ??
    snapshot.diagnostics.modelReadiness.defaultModel ??
    null;
  const defaultModelAffected = Boolean(
    currentDefaultModelId && modelBelongsToProvider(snapshot, provider, currentDefaultModelId)
  );
  const needsReplacement = defaultModelAffected || affectedAgents.length > 0;
  const replacementModelId = needsReplacement
    ? resolveProviderDisconnectReplacement(snapshot, provider, currentDefaultModelId)
    : null;
  const blockedReason = activeAgentIds.length > 0
    ? `Disconnect is blocked while ${activeAgentIds.length} affected agent${activeAgentIds.length === 1 ? " is" : "s are"} running. Wait for active work to finish and retry.`
    : needsReplacement && !replacementModelId
      ? "Disconnect is blocked because no ready replacement model is available. Connect another provider first."
      : null;

  return {
    providerModelIds,
    affectedAgents,
    activeAgentIds,
    defaultModelAffected,
    currentDefaultModelId,
    replacementModelId,
    blockedReason,
    credentialCleanup: resolveExpectedCredentialCleanup(provider)
  };
}

export function buildModelRemoveImpact(
  snapshot: MissionControlSnapshot,
  provider: AddModelsProviderId,
  modelId: string,
  configuredModelIds: Set<string>
): AddModelsModelRemoveImpact {
  const canonicalModelId = modelId.trim();
  const modelIsConfigured = configuredModelIds.has(canonicalModelId);
  const modelBelongs = modelBelongsToProvider(snapshot, provider, canonicalModelId);
  const affectedAgents = snapshot.agents
    .filter((agent) => agent.modelId === canonicalModelId)
    .map((agent) => ({ id: agent.id, name: agent.name || agent.id, modelId: agent.modelId }));
  const activeAgentIds = affectedAgents
    .filter((agent) => snapshot.agents.find((candidate) => candidate.id === agent.id)?.activeRuntimeIds.length)
    .map((agent) => agent.id);
  const currentDefaultModelId = snapshot.diagnostics.modelReadiness.resolvedDefaultModel ??
    snapshot.diagnostics.modelReadiness.defaultModel ??
    null;
  const defaultModelAffected = currentDefaultModelId === canonicalModelId;
  const needsReplacement = defaultModelAffected || affectedAgents.length > 0;
  const replacementModelId = needsReplacement
    ? resolveModelRemovalReplacement(snapshot, canonicalModelId, currentDefaultModelId)
    : null;
  const blockedReason = !modelIsConfigured || !modelBelongs
    ? `Model removal is blocked because ${canonicalModelId} is not a configured ${provider} model.`
    : activeAgentIds.length > 0
      ? `Model removal is blocked while ${activeAgentIds.length} affected agent${activeAgentIds.length === 1 ? " is" : "s are"} running. Wait for active work to finish and retry.`
      : needsReplacement && !replacementModelId
        ? "Model removal is blocked because no ready replacement model is available. Connect or add another ready model first."
        : null;

  return {
    modelId: canonicalModelId,
    provider,
    affectedAgents,
    activeAgentIds,
    defaultModelAffected,
    currentDefaultModelId,
    replacementModelId,
    blockedReason
  };
}

function resolveModelRemovalReplacement(
  snapshot: MissionControlSnapshot,
  modelId: string,
  currentDefaultModelId: string | null
) {
  const usableModels = snapshot.models.filter(
    (model) => isUsableReplacement(model) && model.id !== modelId
  );
  const usableIds = new Set(usableModels.map((model) => model.id));

  if (currentDefaultModelId && currentDefaultModelId !== modelId && usableIds.has(currentDefaultModelId)) {
    return currentDefaultModelId;
  }

  const recommendedModelId = snapshot.diagnostics.modelReadiness.recommendedModelId;
  if (recommendedModelId && recommendedModelId !== modelId && usableIds.has(recommendedModelId)) {
    return recommendedModelId;
  }

  return usableModels.toSorted(compareReplacementModels)[0]?.id ?? null;
}

function resolveProviderDisconnectReplacement(
  snapshot: MissionControlSnapshot,
  provider: AddModelsProviderId,
  currentDefaultModelId: string | null
) {
  const usableModels = snapshot.models.filter(
    (model) => isUsableReplacement(model) && !modelBelongsToProvider(snapshot, provider, model.id)
  );
  const usableIds = new Set(usableModels.map((model) => model.id));

  if (currentDefaultModelId && usableIds.has(currentDefaultModelId)) {
    return currentDefaultModelId;
  }

  const recommendedModelId = snapshot.diagnostics.modelReadiness.recommendedModelId;
  if (recommendedModelId && usableIds.has(recommendedModelId)) {
    return recommendedModelId;
  }

  return usableModels.toSorted(compareReplacementModels)[0]?.id ?? null;
}

function compareReplacementModels(left: ModelRecord, right: ModelRecord) {
  return scoreReplacementModel(right) - scoreReplacementModel(left) || left.id.localeCompare(right.id);
}

function scoreReplacementModel(model: ModelRecord) {
  return (model.available === true ? 1_000_000 : 0) +
    (model.tags.includes("configured") ? 100_000 : 0) +
    Math.min(model.usageCount, 10_000) * 10 +
    Math.min(model.contextWindow ?? 0, 2_000_000) / 1_000;
}

function isUsableReplacement(model: ModelRecord) {
  return model.id !== "unassigned" && !model.missing && model.available !== false;
}

function modelBelongsToProvider(
  snapshot: MissionControlSnapshot,
  provider: AddModelsProviderId,
  modelId: string
) {
  const model = snapshot.models.find((candidate) => candidate.id === modelId);
  return modelMatchesAddModelsProvider(provider, modelId, model?.provider);
}

function resolveModelProvider(snapshot: MissionControlSnapshot, modelId: string) {
  const provider = snapshot.models.find((model) => model.id === modelId)?.provider ?? modelId.split("/", 1)[0];
  return normalizeAddModelsProviderId(provider);
}

function resolveExpectedCredentialCleanup(
  provider: AddModelsProviderId
): AddModelsProviderDisconnectImpact["credentialCleanup"] {
  if (provider === "ollama") {
    return "not-required";
  }

  if (provider === "openai" || !["openai-codex", "openrouter", "anthropic", "xai", "google", "deepseek", "mistral"].includes(provider)) {
    return "removed";
  }

  return "retained-unsupported";
}
