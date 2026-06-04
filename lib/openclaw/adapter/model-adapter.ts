import type {
  AgentConfigPayload,
  ModelsPayload,
  ModelsStatusPayload
} from "@/lib/openclaw/client/gateway-client";
import {
  buildModelStatusConnectionStatus,
  modelRecordIdentityKey,
  normalizeOpenAiCodexModelId,
  resolveModelRecordProvider
} from "@/lib/openclaw/domains/model-provider-connection";
import type { AddModelsProviderId, ModelRecord, OpenClawAgent } from "@/lib/openclaw/types";

type AgentModelDefaultLike = {
  model?: string | null;
  modelId?: string | null;
  isDefault?: boolean | null;
};

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function buildModelsPayloadFromFallbackSources(
  agentConfig: AgentConfigPayload,
  modelStatus?: ModelsStatusPayload
): ModelsPayload {
  const modelIds = uniqueStrings([
    ...agentConfig.map((entry) => entry.model ?? "").filter(Boolean),
    ...(modelStatus?.allowed ?? []).filter(Boolean),
    modelStatus?.resolvedDefault ?? "",
    modelStatus?.defaultModel ?? ""
  ]);

  return {
    models: modelIds.map((modelId) => {
      const fallbackMetadata = inferFallbackModelMetadata(modelId);

      return {
        key: modelId,
        name: modelId,
        input: "text",
        contextWindow: fallbackMetadata.contextWindow,
        local: fallbackMetadata.local,
        available: true,
        tags: [],
        missing: false
      };
    })
  };
}

export function inferFallbackModelMetadata(modelId: string): {
  contextWindow: number | null;
  local: boolean | null;
} {
  const normalized = modelId.trim().toLowerCase();
  const provider = normalized.split("/", 1)[0] || "";
  const route = normalized.includes("/") ? normalized.slice(provider.length + 1) : normalized;

  if (provider === "ollama") {
    return {
      contextWindow: inferOllamaContextWindow(route),
      local: true
    };
  }

  if (provider === "openai" || provider === "openai-codex") {
    return {
      contextWindow: route.startsWith("gpt-5") ? 272000 : null,
      local: false
    };
  }

  if (provider === "anthropic") {
    return {
      contextWindow: 200000,
      local: false
    };
  }

  if (provider === "google" || provider === "gemini") {
    return {
      contextWindow: 1000000,
      local: false
    };
  }

  if (provider === "deepseek") {
    return {
      contextWindow: 64000,
      local: false
    };
  }

  if (provider === "mistral") {
    return {
      contextWindow: 128000,
      local: false
    };
  }

  if (provider === "openrouter" || provider === "xai") {
    return {
      contextWindow: null,
      local: false
    };
  }

  return {
    contextWindow: null,
    local: null
  };
}

function inferOllamaContextWindow(route: string) {
  if (route.includes("qwen3.5")) {
    return 262144;
  }

  if (
    route.includes("qwen") ||
    route.includes("llama3.2") ||
    route.includes("llama3.3") ||
    route.includes("deepseek-r1")
  ) {
    return 131072;
  }

  return 131072;
}

export function buildModelStatusFromAgentConfig(
  agentConfig: AgentConfigPayload,
  agents: AgentModelDefaultLike[] = []
): ModelsStatusPayload | undefined {
  const defaultModel =
    readAgentModel(agents.find((entry) => entry.isDefault)) ||
    readAgentModel(agents.find((entry) => Boolean(readAgentModel(entry)))) ||
    agentConfig.find((entry) => entry.default)?.model ||
    agentConfig.find((entry) => Boolean(entry.model))?.model ||
    null;

  if (!defaultModel) {
    return undefined;
  }

  return {
    defaultModel,
    resolvedDefault: defaultModel
  };
}

export function mergeModelStatusWithAgentConfigDefaults(
  modelStatus: ModelsStatusPayload | undefined,
  agentConfig: AgentConfigPayload,
  agents: AgentModelDefaultLike[] = []
): ModelsStatusPayload | undefined {
  const fallbackStatus = buildModelStatusFromAgentConfig(agentConfig, agents);

  if (!modelStatus) {
    return fallbackStatus;
  }

  const defaultModel = normalizeModelId(modelStatus.defaultModel) ??
    normalizeModelId(fallbackStatus?.defaultModel) ??
    null;
  const resolvedDefault = normalizeModelId(modelStatus.resolvedDefault) ??
    normalizeModelId(fallbackStatus?.resolvedDefault) ??
    defaultModel;

  return {
    ...modelStatus,
    defaultModel,
    resolvedDefault
  };
}

export function buildModelRecords(
  models: ModelsPayload["models"],
  agents: OpenClawAgent[],
  modelStatus?: ModelsStatusPayload
): ModelRecord[] {
  const modelUsage = new Map<string, number>();

  for (const agent of agents) {
    const canonicalModelId = normalizeOpenAiCodexModelId(agent.modelId);
    modelUsage.set(canonicalModelId, (modelUsage.get(canonicalModelId) ?? 0) + 1);
  }

  const recordsByIdentity = new Map<string, ModelRecord>();

  for (const model of models) {
    const provider = resolveModelRecordProvider(model.key, modelStatus, model);
    const id = normalizeOpenAiCodexModelId(model.key);
    const record: ModelRecord = {
      id,
      name: model.name,
      provider,
      input: model.input,
      contextWindow: model.contextWindow,
      local: model.local,
      available: resolveModelRecordAvailability(model, provider, modelStatus),
      missing: model.missing,
      tags: model.tags,
      usageCount: modelUsage.get(id) ?? 0
    };
    const identityKey = modelRecordIdentityKey(model.key, provider);
    const existing = recordsByIdentity.get(identityKey);

    recordsByIdentity.set(identityKey, existing ? mergeModelRecords(existing, record) : record);
  }

  return Array.from(recordsByIdentity.values());
}

function mergeModelRecords(existing: ModelRecord, candidate: ModelRecord): ModelRecord {
  const preferred = scoreModelRecord(candidate) > scoreModelRecord(existing) ? candidate : existing;
  const fallback = preferred === candidate ? existing : candidate;

  return {
    ...preferred,
    contextWindow: preferred.contextWindow ?? fallback.contextWindow,
    local: preferred.local ?? fallback.local,
    available: preferred.available === true || fallback.available === true
      ? true
      : preferred.available ?? fallback.available,
    missing: preferred.missing && fallback.missing,
    tags: uniqueStrings([...preferred.tags, ...fallback.tags]),
    usageCount: Math.max(preferred.usageCount, fallback.usageCount)
  };
}

function scoreModelRecord(record: ModelRecord) {
  let score = 0;

  if (record.available === true) {
    score += 100;
  }

  if (!record.missing) {
    score += 50;
  }

  if (record.provider === "openai-codex") {
    score += 10;
  }

  if (record.usageCount > 0) {
    score += 5;
  }

  return score;
}

function resolveModelRecordAvailability(
  model: ModelsPayload["models"][number],
  provider: string,
  modelStatus?: ModelsStatusPayload
) {
  if (model.available === false || model.missing || model.local === true || !modelStatus || !isAddModelsProviderId(provider)) {
    return model.available;
  }

  const connection = buildModelStatusConnectionStatus(provider, modelStatus, [normalizeOpenAiCodexModelId(model.key)]);
  return connection?.connected ? model.available : false;
}

function isAddModelsProviderId(provider: string): provider is AddModelsProviderId {
  return [
    "openai-codex",
    "openrouter",
    "ollama",
    "openai",
    "anthropic",
    "xai",
    "google",
    "deepseek",
    "mistral"
  ].includes(provider);
}

function normalizeModelId(value: string | null | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readAgentModel(agent: AgentModelDefaultLike | undefined) {
  return normalizeModelId(agent?.modelId) ?? normalizeModelId(agent?.model);
}
