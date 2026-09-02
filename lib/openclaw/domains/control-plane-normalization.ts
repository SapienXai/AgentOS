import type {
  AddModelsProviderAuthMethod,
  AgentStatus,
  ModelReadiness,
  RuntimeRecord
} from "@/lib/openclaw/types";
import { isUnsupportedLegacyProviderId } from "@/lib/openclaw/model-provider-registry";

type RuntimeLike = {
  status?: RuntimeRecord["status"] | string;
  taskId?: string | null;
};

type AgentLike = {
  id: string;
  status: AgentStatus;
};

type ModelLike = {
  key: string;
  local?: boolean | null;
  available?: boolean | null;
  missing?: boolean | null;
};

type ModelAuthProvider = {
  provider?: string | null;
  profiles?: {
    count?: number | null;
    oauth?: number | null;
    token?: number | null;
    apiKey?: number | null;
  } | null;
  effective?: {
    kind?: string | null;
  } | null;
  syntheticAuth?: {
    value?: string | null;
    source?: string | null;
    credential?: string | null;
    mode?: string | null;
  } | null;
};

type ModelOauthProvider = {
  provider?: string | null;
  status?: string | null;
  profiles?: unknown[] | null;
  effectiveProfiles?: unknown[] | null;
};

type ModelAuthProviderLike = ModelAuthProvider | null;

type ModelOauthProviderLike = ModelOauthProvider | null;

type ModelStatusLike = {
  resolvedDefault?: string | null;
  defaultModel?: string | null;
  auth?: {
    providers?: ModelAuthProviderLike[] | null;
    runtimeAuthRoutes?: Array<{
      provider?: string | null;
      runtime?: string | null;
      authProvider?: string | null;
      status?: string | null;
    }> | null;
    oauth?: {
      providers?: ModelOauthProviderLike[] | null;
    } | null;
    missingProvidersInUse?: Array<string | null | undefined> | null;
    unusableProfiles?: Array<unknown> | null;
  } | null;
};

type UpdateInfoParams = {
  currentVersion?: string;
  latestVersion?: string;
  updateError?: string;
  legacyInfo?: string;
};

type DiagnosticHealthParams = {
  rpcOk: boolean | undefined;
  warningCount: number;
  runtimeIssueCount: number;
  hasOpenClawSignal: boolean;
};

export function resolveRuntimeStatus(
  stage: string | undefined,
  key: string | undefined,
  ageMs: number | undefined
): RuntimeRecord["status"] {
  if (stage === "in_progress") {
    return "running";
  }

  if (key?.endsWith(":main") && typeof ageMs === "number" && ageMs < 60 * 60 * 1000) {
    return "running";
  }

  if (stage === "completed" || stage === "done") {
    return "completed";
  }

  if (stage === "failed" || stage === "error") {
    return "stalled";
  }

  return "idle";
}

export function resolveAgentStatus(params: {
  rpcOk: boolean;
  activeRuntime: RuntimeRecord | undefined;
  heartbeatEnabled: boolean;
  lastActiveAt: number | null;
}): AgentStatus {
  if (!params.rpcOk) {
    return "offline";
  }

  if (params.activeRuntime?.status === "running" || params.activeRuntime?.status === "queued") {
    return "engaged";
  }

  if (params.heartbeatEnabled) {
    return "monitoring";
  }

  if (params.lastActiveAt) {
    return "ready";
  }

  return "standby";
}

export function resolveAgentAction(params: {
  runtime: RuntimeLike | undefined;
  heartbeatEvery: string | null;
  status: AgentStatus;
}) {
  if (params.runtime) {
    if (params.runtime.taskId) {
      if (params.runtime.status === "running" || params.runtime.status === "queued") {
        return `Tracking task ${params.runtime.taskId.slice(0, 8)}`;
      }

      if (params.runtime.status === "completed") {
        return `Recent task ${params.runtime.taskId.slice(0, 8)} completed`;
      }

      if (params.runtime.status === "cancelled") {
        return `Recent task ${params.runtime.taskId.slice(0, 8)} cancelled`;
      }

      if (params.runtime.status === "stalled") {
        return `Recent task ${params.runtime.taskId.slice(0, 8)} waiting for output`;
      }

      return `Recent task ${params.runtime.taskId.slice(0, 8)}`;
    }

    return params.runtime.status === "running" || params.runtime.status === "queued"
      ? "Maintaining main session context"
      : "Main session recently updated";
  }

  if (params.heartbeatEvery) {
    return `Heartbeat on ${params.heartbeatEvery}`;
  }

  if (params.status === "standby") {
    return "Waiting for assignment";
  }

  return "Ready for next turn";
}

export function resolveWorkspaceHealth(agentIds: string[], agents: AgentLike[]): AgentStatus {
  const workspaceAgents = agents.filter((agent) => agentIds.includes(agent.id));
  if (workspaceAgents.some((agent) => agent.status === "engaged")) {
    return "engaged";
  }
  if (workspaceAgents.some((agent) => agent.status === "monitoring")) {
    return "monitoring";
  }
  if (workspaceAgents.some((agent) => agent.status === "ready")) {
    return "ready";
  }
  if (workspaceAgents.some((agent) => agent.status === "offline")) {
    return "offline";
  }
  return "standby";
}

export function resolveModelReadiness(
  models: ModelLike[],
  modelStatus?: ModelStatusLike,
  configuredModelIds?: Iterable<string>
): ModelReadiness {
  const configuredModelIdSet = new Set(
    Array.from(configuredModelIds ?? [])
      .map((modelId) => normalizeOptionalValue(modelId)?.toLowerCase())
      .filter((modelId): modelId is string => Boolean(modelId))
  );
  const readyModels = models.filter((model) => isReadyModelRecord(model));
  const legacyModelIds = models
    .map((model) => model.key)
    .filter((modelId) => isUnsupportedLegacyProviderId(resolveAuthProviderIdForModel(modelId)));
  const providerIds = unique(
    [
      ...models.map((model) => resolveAuthProviderIdForModel(model.key)),
      ...((modelStatus?.auth?.providers ?? []).map((entry) => entry?.provider).filter(isNonEmptyString)),
      ...((modelStatus?.auth?.oauth?.providers ?? []).map((entry) => entry?.provider).filter(isNonEmptyString))
    ].filter(isNonEmptyString)
  ).filter((provider) => !isUnsupportedLegacyProviderId(provider));
  const authProviderMap = new Map(
    (modelStatus?.auth?.providers ?? [])
      .filter((entry): entry is ModelAuthProvider & { provider: string } =>
        isNonEmptyString(entry?.provider) && !isUnsupportedLegacyProviderId(entry.provider)
      )
      .map((entry) => [entry.provider, entry])
  );
  const oauthProviderMap = new Map(
    (modelStatus?.auth?.oauth?.providers ?? [])
      .filter((entry): entry is ModelOauthProvider & { provider: string } =>
        isNonEmptyString(entry?.provider) && !isUnsupportedLegacyProviderId(entry.provider)
      )
      .map((entry) => [entry.provider, entry])
  );
  const resolvedDefaultModel = normalizeOptionalValue(modelStatus?.resolvedDefault ?? undefined);
  const defaultModel = normalizeOptionalValue(modelStatus?.defaultModel ?? undefined);
  const defaultModelId = resolvedDefaultModel ?? defaultModel;
  const hasExplicitDefaultModel = Boolean(
    defaultModelId &&
      (configuredModelIds === undefined || configuredModelIdSet.has(defaultModelId.toLowerCase()))
  );
  const defaultProvider = defaultModelId ? resolveModelProviderId(defaultModelId) : null;
  const defaultModelReady = Boolean(
    hasExplicitDefaultModel &&
      defaultModelId &&
      readyModels.some((model) => model.key === defaultModelId) &&
      isModelProviderAuthenticated(defaultProvider, defaultModelId, models, authProviderMap, oauthProviderMap, modelStatus)
  );
  const recommendedModelId = defaultModelReady
    ? defaultModelId
    : configuredModelIds === undefined
      ? readyModels[0]?.key ?? null
      : readyModels.find((model) => configuredModelIdSet.has(model.key.toLowerCase()))?.key ?? null;
  const authProviders = providerIds.map((provider) => {
    const providerModels = models.filter((model) => modelMatchesAuthProvider(provider, model.key));
    const hasRemoteRoute = providerModels.some((model) => model.local !== true);
    const canLogin = provider !== "ollama" && hasRemoteRoute;
    const providerAuth = authProviderMap.get(provider);
    const oauthStatus = oauthProviderMap.get(provider);
    const connected =
      provider === "ollama"
        ? providerModels.some((model) => model.local)
        : provider === "openai"
          ? isOpenAiAuthConnected(providerAuth, oauthStatus, modelStatus)
          : (providerAuth?.profiles?.count ?? 0) > 0 || oauthStatus?.status === "ok";
    let detail: string | null = null;

    if (provider === "openai" && isUsableOpenAiOauthStatus(oauthStatus)) {
      detail = "ChatGPT OAuth connected";
    } else if (
      providerAuth &&
      (providerAuth.profiles?.count ?? 0) > 0
    ) {
      detail = `${providerAuth?.profiles?.count} auth profile${providerAuth?.profiles?.count === 1 ? "" : "s"}`;
    } else if (provider === "ollama" && connected) {
      detail = "Local Ollama model detected.";
    } else if (provider === "ollama") {
      detail = "Install or pull a local model to unlock this route.";
    } else if (hasRemoteRoute) {
      detail = resolveProviderSetupDetail(provider);
    }

    return {
      provider,
      authMethod: provider === "openai" ? resolveOpenAiAuthMethod(providerAuth, oauthStatus, modelStatus) : null,
      availableAuthMethods: provider === "openai"
        ? ["api-key", "chatgpt-oauth"] as AddModelsProviderAuthMethod[]
        : [],
      connected,
      canLogin,
      detail
    };
  });
  const missingProvidersInUse = (modelStatus?.auth?.missingProvidersInUse ?? []).filter(isNonEmptyString);
  const missingProviderSet = new Set(missingProvidersInUse);
  const unusableProfileCount = modelStatus?.auth?.unusableProfiles?.length ?? 0;
  const issues: string[] = [];

  if (readyModels.length === 0) {
    issues.push("No available models were detected yet.");
  }

  if (readyModels.length > 0 && !hasExplicitDefaultModel) {
    issues.push("Choose a default model to finish setup.");
  }

  if (hasExplicitDefaultModel && defaultModelId && !defaultModelReady) {
    if (defaultProvider && missingProviderSet.has(defaultProvider)) {
      issues.push(`Default model is set, but ${formatProviderLabel(defaultProvider)} auth is still missing.`);
    } else if (missingProvidersInUse.length > 0) {
      issues.push(`Default model is set, but auth is still missing for: ${missingProvidersInUse.join(", ")}.`);
    } else {
      issues.push("The selected default model is not ready yet.");
    }
  }

  if (missingProvidersInUse.length > 0 && !defaultModelId) {
    issues.push(`Auth is still missing for: ${missingProvidersInUse.join(", ")}.`);
  }

  if (unusableProfileCount > 0) {
    issues.push("Some stored model auth profiles are not usable.");
  }

  if (legacyModelIds.length > 0) {
    issues.push("OpenClaw reported a stale legacy model route. Use OpenClaw's supported migration flow, then refresh AgentOS.");
  }

  const preferredLoginProvider = resolvePreferredLoginProvider({
    defaultProvider,
    defaultModelId: defaultModelId ?? null,
    authProviders,
    missingProvidersInUse,
    providerIds,
    readyModels
  });

  return {
    ready: readyModels.length > 0 && defaultModelReady,
    defaultModel: defaultModel ?? null,
    resolvedDefaultModel: resolvedDefaultModel ?? null,
    defaultModelReady,
    recommendedModelId: recommendedModelId ?? null,
    preferredLoginProvider,
    totalModelCount: models.length,
    availableModelCount: readyModels.length,
    localModelCount: readyModels.filter((model) => model.local).length,
    remoteModelCount: readyModels.filter((model) => model.local !== true).length,
    missingModelCount: models.filter((model) => model.missing || model.available === false).length,
    authProviders,
    issues: unique(issues)
  };
}

function resolvePreferredLoginProvider(input: {
  defaultProvider: string | null;
  defaultModelId: string | null;
  authProviders: Array<{ provider: string; connected: boolean; canLogin: boolean }>;
  missingProvidersInUse: string[];
  providerIds: string[];
  readyModels: ModelLike[];
}) {
  const defaultProviderCandidates = input.defaultProvider
    ? resolveAuthProvidersForModel(input.defaultProvider)
    : [];

  if (
    defaultProviderCandidates.some((provider) =>
      input.authProviders.some((entry) => entry.provider === provider && entry.connected)
    )
  ) {
    return null;
  }

  for (const provider of defaultProviderCandidates) {
    const candidate = input.authProviders.find(
      (entry) => entry.provider === provider && !entry.connected && entry.canLogin
    );

    if (candidate) {
      return candidate.provider;
    }
  }

  const missingProvider = input.missingProvidersInUse.find((provider) =>
    input.authProviders.some((entry) => entry.provider === provider && !entry.connected && entry.canLogin)
  );

  if (missingProvider) {
    return missingProvider;
  }

  return input.authProviders.find((provider) => !provider.connected && provider.canLogin)?.provider ??
    (input.providerIds.includes("openai") || input.readyModels.length === 0 ? "openai" : null);
}

function isModelProviderAuthenticated(
  provider: string | null,
  modelId: string | null,
  models: ModelLike[],
  authProviderMap: Map<string, ModelAuthProvider & { provider: string }>,
  oauthProviderMap: Map<string, ModelOauthProvider & { provider: string }>,
  modelStatus?: ModelStatusLike
) {
  if (!provider) {
    return false;
  }

  if (provider === "ollama") {
    return models.some((model) => modelMatchesAuthProvider(provider, model.key) && model.local === true);
  }

  return resolveAuthProvidersForModel(provider).some((authProvider) =>
    isAuthProviderConnected(authProvider, authProviderMap, oauthProviderMap, modelStatus)
  );
}

function isAuthProviderConnected(
  provider: string,
  authProviderMap: Map<string, ModelAuthProvider & { provider: string }>,
  oauthProviderMap: Map<string, ModelOauthProvider & { provider: string }>,
  modelStatus?: ModelStatusLike
) {
  if (provider === "openai") {
    return isOpenAiAuthConnected(authProviderMap.get(provider), oauthProviderMap.get(provider), modelStatus);
  }

  const providerAuth = authProviderMap.get(provider);
  const oauthStatus = oauthProviderMap.get(provider);
  return (providerAuth?.profiles?.count ?? 0) > 0 || oauthStatus?.status === "ok";
}

function isOpenAiAuthConnected(
  providerAuth: ModelAuthProvider | undefined,
  oauthStatus: ModelOauthProvider | undefined,
  modelStatus?: ModelStatusLike
) {
  const effectiveKind = providerAuth?.effective?.kind?.trim().toLowerCase();
  const usableOauthStatus = isUsableOpenAiOauthStatus(oauthStatus);
  const oauthProfileCount = Math.max(
    oauthStatus?.profiles
      ? countUsableOpenAiOauthProfiles(oauthStatus.profiles)
      : usableOauthStatus || !oauthStatus
        ? providerAuth?.profiles?.oauth ?? 0
        : 0,
    0
  );
  const apiKeyProfileCount = (providerAuth?.profiles?.token ?? 0) + (providerAuth?.profiles?.apiKey ?? 0);

  return Boolean(
    usableOauthStatus ||
    oauthProfileCount > 0 ||
    hasUsableOpenAiRuntimeAuthRoute(modelStatus) ||
    effectiveKind === "oauth" ||
    apiKeyProfileCount > 0 ||
    (effectiveKind && ["token", "apikey", "api-key"].includes(effectiveKind)) ||
    (!oauthStatus && (providerAuth?.profiles?.count ?? 0) > 0)
  );
}

function resolveOpenAiAuthMethod(
  providerAuth: ModelAuthProvider | undefined,
  oauthStatus: ModelOauthProvider | undefined,
  modelStatus?: ModelStatusLike
) {
  const effectiveKind = providerAuth?.effective?.kind?.trim().toLowerCase();
  const usableOauthStatus = isUsableOpenAiOauthStatus(oauthStatus);
  const oauthProfileCount = Math.max(
    oauthStatus?.profiles
      ? countUsableOpenAiOauthProfiles(oauthStatus.profiles)
      : usableOauthStatus || !oauthStatus
        ? providerAuth?.profiles?.oauth ?? 0
        : 0,
    0
  );
  const hasOauth = Boolean(
    usableOauthStatus ||
    oauthProfileCount > 0 ||
    hasUsableOpenAiRuntimeAuthRoute(modelStatus) ||
    effectiveKind === "oauth"
  );

  if (hasOauth) {
    return "chatgpt-oauth" as const;
  }

  const apiKeyProfileCount = (providerAuth?.profiles?.token ?? 0) + (providerAuth?.profiles?.apiKey ?? 0);
  return apiKeyProfileCount > 0 || ["token", "apikey", "api-key"].includes(effectiveKind ?? "")
    ? "api-key" as const
    : null;
}

function countUsableOpenAiOauthProfiles(profiles: unknown[] | null | undefined) {
  return (profiles ?? []).filter((entry) => {
    if (!isRecord(entry)) {
      return false;
    }

    const profileId = normalizeOptionalValue(
      typeof entry.profileId === "string" ? entry.profileId :
        typeof entry.id === "string" ? entry.id : undefined
    );
    const status = normalizeOptionalValue(typeof entry.status === "string" ? entry.status : undefined)?.toLowerCase();

    return Boolean(profileId?.toLowerCase().startsWith("openai:")) &&
      !["expired", "missing", "invalid", "error", "disabled", "revoked"].includes(status ?? "");
  }).length;
}

function isUsableOpenAiOauthStatus(oauthStatus: ModelOauthProvider | undefined) {
  if (!oauthStatus || oauthStatus.status?.trim().toLowerCase() !== "ok") {
    return false;
  }

  return !oauthStatus.profiles || countUsableOpenAiOauthProfiles(oauthStatus.profiles) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasUsableOpenAiRuntimeAuthRoute(modelStatus?: ModelStatusLike) {
  return (modelStatus?.auth?.runtimeAuthRoutes ?? []).some((entry) => {
    const provider = entry?.provider?.trim().toLowerCase();
    const runtime = entry?.runtime?.trim().toLowerCase();
    const authProvider = entry?.authProvider?.trim().toLowerCase();
    const status = entry?.status?.trim().toLowerCase();

    const codexRuntime = runtime === "codex";
    const openAiRoute = provider === "openai";
    const openAiAuth = authProvider === "openai";
    const usableStatus = !status || ["ok", "usable", "ready", "connected"].includes(status);

    return codexRuntime && openAiRoute && openAiAuth && usableStatus;
  });
}

function resolveAuthProviderIdForModel(modelId: string) {
  return modelId.split("/")[0] || "unknown";
}

function modelMatchesAuthProvider(provider: string, modelId: string) {
  const modelProvider = resolveModelProviderId(modelId) ?? "unknown";

  return modelProvider === provider;
}

function resolveAuthProvidersForModel(provider: string) {
  return [provider];
}

export function isReadyModelRecord(model: ModelLike) {
  return model.available !== false && !model.missing;
}

export function resolveModelProviderId(modelId: string) {
  const [provider] = modelId.split("/", 1);
  return provider || null;
}

export function formatProviderLabel(provider: string) {
  const normalized = provider.trim().toLowerCase();

  if (normalized === "openrouter") {
    return "OpenRouter";
  }

  if (normalized === "openai") {
    return "OpenAI";
  }

  if (normalized === "anthropic") {
    return "Anthropic";
  }

  if (normalized === "ollama") {
    return "Ollama";
  }

  if (normalized === "xai") {
    return "xAI";
  }

  if (normalized === "google" || normalized === "gemini") {
    return "Gemini";
  }

  if (normalized === "deepseek") {
    return "DeepSeek";
  }

  if (normalized === "mistral") {
    return "Mistral";
  }

  return provider
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function resolveProviderSetupDetail(provider: string) {
  const normalized = provider.trim().toLowerCase();

  if (
    normalized === "openrouter" ||
    normalized === "openai" ||
    normalized === "anthropic" ||
    normalized === "xai" ||
    normalized === "google" ||
    normalized === "gemini" ||
    normalized === "deepseek" ||
    normalized === "mistral"
  ) {
    return normalized === "openai"
      ? "Connect an OpenAI API key or ChatGPT account through AgentOS to use this route."
      : `Add your ${formatProviderLabel(provider)} API key in terminal to use this route.`;
  }

  return `Connect ${formatProviderLabel(provider)} auth in terminal to use this route.`;
}

export function resolveDiagnosticHealth(params: DiagnosticHealthParams) {
  if (!params.rpcOk && !params.hasOpenClawSignal) {
    return "offline";
  }

  if (!params.rpcOk || params.warningCount > 0 || params.runtimeIssueCount > 0) {
    return "degraded";
  }

  return "healthy";
}

export function collectIssues(results: Record<string, PromiseSettledResult<unknown>>) {
  return Object.entries(results)
    .flatMap(([key, result]) => {
      if (result.status !== "rejected") {
        return [];
      }

      return [`${key}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`];
    });
}

export function resolveUpdateInfo(params: UpdateInfoParams) {
  const legacyInfo = normalizeOptionalValue(params.legacyInfo);

  if (params.latestVersion && params.currentVersion) {
    const comparison = compareVersionStrings(params.latestVersion, params.currentVersion);

    if (comparison > 0) {
      return `Update available: v${params.latestVersion} is ready. Current version: v${params.currentVersion}.`;
    }

    if (comparison === 0) {
      return `OpenClaw is up to date on v${params.currentVersion}.`;
    }

    return `Running v${params.currentVersion}. Registry currently reports v${params.latestVersion}.`;
  }

  if (params.latestVersion) {
    return `Latest available version: v${params.latestVersion}. Current version could not be determined.`;
  }

  if (legacyInfo) {
    return legacyInfo;
  }

  if (params.updateError) {
    return `Update registry check failed: ${params.updateError}`;
  }

  if (params.currentVersion) {
    return `Running v${params.currentVersion}. Update registry status is still loading.`;
  }

  return undefined;
}

export function compareVersionStrings(left: string, right: string) {
  const leftParts = tokenizeVersion(left);
  const rightParts = tokenizeVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;

    if (typeof leftPart === "number" && typeof rightPart === "number") {
      if (leftPart !== rightPart) {
        return leftPart - rightPart;
      }

      continue;
    }

    const leftText = String(leftPart);
    const rightText = String(rightPart);

    if (leftText !== rightText) {
      return leftText.localeCompare(rightText);
    }
  }

  return 0;
}

export function tokenizeVersion(value: string) {
  return value
    .trim()
    .replace(/^v/i, "")
    .split(/[^0-9a-zA-Z]+/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()));
}

export function normalizeOptionalValue(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeUpdateError(value: string | undefined) {
  const normalized = normalizeOptionalValue(value);

  if (!normalized) {
    return undefined;
  }

  return normalized.split(/\r?\n/, 1)[0]?.trim() || normalized;
}

export function unique(values: string[]) {
  return Array.from(new Set(values));
}

export function isNonEmptyString(value: string | null | undefined): value is string {
  return Boolean(value);
}
