import type { ModelsStatusPayload } from "@/lib/openclaw/client/types";
import { getModelProviderDescriptor } from "@/lib/openclaw/model-provider-registry";
import type {
  AddModelsProviderConnectionStatus,
  AddModelsProviderId
} from "@/lib/openclaw/types";

type ModelProviderMetadata = {
  provider?: string | null;
  tags?: string[] | null;
};

/**
 * OpenClaw models.status reports auth profiles, but config-backed provider
 * apiKeys are intentionally redacted from that payload. Project only the
 * presence of a Gateway-stored credential into normalized status so operator
 * UI can accurately mark those model routes usable without exposing a secret.
 */
export function mergeModelStatusWithGatewayCredentials(
  modelStatus: ModelsStatusPayload | null | undefined,
  credentialProviders: Iterable<AddModelsProviderId>
): ModelsStatusPayload | null {
  const providersWithCredentials = new Set(credentialProviders);

  if (providersWithCredentials.size === 0) {
    return modelStatus ?? null;
  }

  const status: ModelsStatusPayload = modelStatus ? structuredClone(modelStatus) : {};
  const existingProviders = status.auth?.providers ?? [];
  const byProvider = new Map(
    existingProviders
      .filter((entry): entry is NonNullable<typeof entry> & { provider: string } => Boolean(entry.provider))
      .map((entry) => [entry.provider, entry])
  );

  for (const provider of providersWithCredentials) {
    const existing = byProvider.get(provider);
    byProvider.set(provider, {
      ...existing,
      provider,
      effective: existing?.effective ?? { kind: "api-key", detail: "Gateway config credential" },
      profiles: {
        ...existing?.profiles,
        count: Math.max(existing?.profiles?.count ?? 0, 1)
      }
    });
  }

  status.auth = {
    ...status.auth,
    providers: Array.from(byProvider.values())
  };

  return status;
}

export function buildModelStatusConnectionStatus(
  provider: AddModelsProviderId,
  modelStatus: ModelsStatusPayload | null,
  configuredModelIds: Iterable<string>
): AddModelsProviderConnectionStatus | null {
  if (!modelStatus) {
    return null;
  }

  const descriptor = getModelProviderDescriptor(provider);
  const configuredCount = Array.from(configuredModelIds).filter((modelId) =>
    modelMatchesAddModelsProvider(provider, modelId)
  ).length;
  const visibleModelCount = (modelStatus.allowed ?? []).filter((modelId) =>
    modelMatchesAddModelsProvider(provider, modelId)
  ).length;
  const visibleCount = Math.max(configuredCount, visibleModelCount);
  const authProvider = findProviderRecord(modelStatus.auth?.providers, provider);
  const oauthProvider = findProviderRecord(modelStatus.auth?.oauth?.providers, provider);
  const oauthProviderRecord: Record<string, unknown> | null = isRecord(oauthProvider)
    ? oauthProvider as Record<string, unknown>
    : null;
  const oauthProfiles = Array.isArray(oauthProviderRecord?.profiles) ? oauthProviderRecord.profiles : null;
  const usableOauthProfileCount = oauthProfiles ? countUsableAuthProfiles(oauthProfiles) : 0;
  const oauthStatus = readString(oauthProvider?.status)?.toLowerCase();
  const profileSummary: Record<string, unknown> = isRecord(authProvider?.profiles)
    ? authProvider.profiles as Record<string, unknown>
    : {};
  const profileCount = readNumber(profileSummary.count) ?? 0;
  const tokenProfileCount = readNumber(profileSummary.token) ?? 0;
  const apiKeyProfileCount = readNumber(profileSummary.apiKey) ?? 0;
  const oauthProfileCount = readNumber(profileSummary.oauth) ?? 0;
  const effectiveKind = readString(authProvider?.effective?.kind)?.toLowerCase();
  const syntheticAuthValue = readString(authProvider?.syntheticAuth?.value);
  const hasUsableRuntimeAuthRoute = hasUsableOpenAiCodexRuntimeAuthRoute(modelStatus);
  const connected = resolveProviderConnected({
    provider,
    visibleCount,
    oauthProfiles,
    usableOauthProfileCount,
    oauthStatus,
    profileCount,
    tokenProfileCount,
    apiKeyProfileCount,
    oauthProfileCount,
    effectiveKind,
    syntheticAuthValue,
    hasUsableRuntimeAuthRoute
  });

  return {
    provider,
    connected,
    verification: connected ? "credential-stored" : "not-configured",
    canConnect: true,
    needsTerminal: descriptor.connectKind === "oauth",
    source: "gateway",
    degraded: false,
    stale: false,
    recovery: connected ? null : `Connect ${descriptor.shortLabel} in OpenClaw, then refresh model discovery.`,
    detail: resolveConnectionDetail({
      provider,
      descriptor,
      connected,
      visibleCount,
      profileCount,
      usableOauthProfileCount,
      oauthStatus,
      hasUsableRuntimeAuthRoute
    })
  };
}

export function modelMatchesAddModelsProvider(
  provider: AddModelsProviderId,
  modelId: string,
  modelProviderHint?: string | null
) {
  const modelProvider = modelProviderHint || modelId.split("/", 1)[0] || "";

  if (provider === "openai-codex") {
    return modelProvider === "codex" ||
      modelProvider === "openai-codex" ||
      isKnownOpenAiCodexModelId(modelId);
  }

  return modelProvider === provider;
}

export function resolveModelRecordProvider(
  modelId: string,
  modelStatus?: ModelsStatusPayload,
  metadata: ModelProviderMetadata = {}
) {
  const modelProvider = modelId.split("/", 1)[0] || "unknown";
  const metadataProvider = metadata.provider?.trim() || null;

  if (metadataProvider === "codex" || metadataProvider === "openai-codex" || modelProvider === "codex") {
    return "openai-codex";
  }

  if (modelProvider === "openai" && shouldDisplayOpenAiModelAsCodex(modelId, modelStatus, metadata)) {
    return "openai-codex";
  }

  return modelProvider;
}

export function normalizeOpenAiCodexModelId(modelId: string) {
  const normalized = modelId.trim();
  const aliasMatch = /^(?:codex|openai-codex)\/(.+)$/i.exec(normalized);

  if (aliasMatch) {
    return `openai/${aliasMatch[1]}`;
  }

  return normalized;
}

export function modelRecordIdentityKey(
  modelId: string,
  provider: string
) {
  const canonicalModelId = normalizeOpenAiCodexModelId(modelId);

  if (
    provider === "openai-codex" ||
    /^codex\//i.test(modelId) ||
    /^openai-codex\//i.test(modelId) ||
    isKnownOpenAiCodexModelId(canonicalModelId)
  ) {
    return `openai-codex:${canonicalModelId.toLowerCase()}`;
  }

  return `${provider}:${canonicalModelId.toLowerCase()}`;
}

export function isOpenAiCodexBackedModel(
  modelId: string,
  modelStatus?: ModelsStatusPayload,
  metadata: ModelProviderMetadata = {}
) {
  const modelProvider = modelId.split("/", 1)[0] || "";
  const metadataProvider = metadata.provider?.trim() || null;

  if (metadataProvider === "openai-codex" || modelProvider === "openai-codex") {
    return true;
  }

  if (metadataProvider === "codex" || modelProvider === "codex") {
    return true;
  }

  return modelProvider === "openai" && shouldDisplayOpenAiModelAsCodex(modelId, modelStatus, metadata);
}

export function isKnownOpenAiCodexModelId(modelId: string) {
  return /^openai\/(?:gpt-5\.5|gpt-5\.4-mini)$/i.test(modelId) || /^openai\/.*codex/i.test(modelId);
}

function shouldDisplayOpenAiModelAsCodex(
  modelId: string,
  modelStatus?: ModelsStatusPayload,
  metadata: ModelProviderMetadata = {}
) {
  if (/^openai\/.*codex/i.test(modelId)) {
    return true;
  }

  if (metadata.tags?.some(isCodexModelTag)) {
    return true;
  }

  if (!isKnownOpenAiCodexModelId(modelId)) {
    return false;
  }

  if (!modelStatus) {
    return true;
  }

  const codexStatus = buildModelStatusConnectionStatus("openai-codex", modelStatus, []);
  const openAiStatus = buildModelStatusConnectionStatus("openai", modelStatus, []);

  return Boolean(codexStatus?.connected && !openAiStatus?.connected);
}

function resolveProviderConnected({
  provider,
  visibleCount,
  oauthProfiles,
  usableOauthProfileCount,
  oauthStatus,
  profileCount,
  tokenProfileCount,
  apiKeyProfileCount,
  oauthProfileCount,
  effectiveKind,
  syntheticAuthValue,
  hasUsableRuntimeAuthRoute
}: {
  provider: AddModelsProviderId;
  visibleCount: number;
  oauthProfiles: unknown[] | null;
  usableOauthProfileCount: number;
  oauthStatus?: string;
  profileCount: number;
  tokenProfileCount: number;
  apiKeyProfileCount: number;
  oauthProfileCount: number;
  effectiveKind?: string;
  syntheticAuthValue: string | null;
  hasUsableRuntimeAuthRoute: boolean;
}) {
  if (provider === "ollama") {
    return visibleCount > 0;
  }

  if (provider === "openai-codex") {
    return Boolean(
      (oauthProfiles && usableOauthProfileCount > 0) ||
      oauthStatus === "ok" ||
      syntheticAuthValue ||
      hasUsableRuntimeAuthRoute ||
      effectiveKind === "oauth" ||
      effectiveKind === "synthetic"
    );
  }

  if (provider === "openai") {
    const credentialProfileCount = tokenProfileCount + apiKeyProfileCount;

    return Boolean(
      credentialProfileCount > 0 ||
      (effectiveKind && ["token", "apikey", "api-key"].includes(effectiveKind)) ||
      (effectiveKind === "profiles" && profileCount > 0 && oauthProfileCount === 0)
    );
  }

  return oauthStatus === "ok" ||
    profileCount > 0 ||
    Boolean(syntheticAuthValue) ||
    Boolean(effectiveKind && ["ok", "profiles", "token", "apikey", "api-key", "oauth", "synthetic"].includes(effectiveKind));
}

function isCodexModelTag(tag: string) {
  return /^(codex|openai-codex|chatgpt|app-server|codex-app-server)$/i.test(tag.trim());
}

function resolveConnectionDetail({
  provider,
  descriptor,
  connected,
  visibleCount,
  profileCount,
  usableOauthProfileCount,
  oauthStatus,
  hasUsableRuntimeAuthRoute
}: {
  provider: AddModelsProviderId;
  descriptor: ReturnType<typeof getModelProviderDescriptor>;
  connected: boolean;
  visibleCount: number;
  profileCount: number;
  usableOauthProfileCount: number;
  oauthStatus?: string;
  hasUsableRuntimeAuthRoute: boolean;
}) {
  if (provider === "ollama") {
    return visibleCount > 0
      ? `${visibleCount} local model${visibleCount === 1 ? "" : "s"} detected.`
      : "Install or pull a local model to unlock this route.";
  }

  if (connected) {
    if (usableOauthProfileCount > 0 || oauthStatus === "ok" || hasUsableRuntimeAuthRoute) {
      return "OAuth connected";
    }

    if (profileCount > 0) {
      return `${profileCount} auth profile${profileCount === 1 ? "" : "s"}`;
    }

    if (provider === "openai-codex" && visibleCount > 0) {
      return `Codex app-server connected with ${visibleCount} available model${visibleCount === 1 ? "" : "s"}.`;
    }

    return visibleCount > 0
      ? `${visibleCount} configured model${visibleCount === 1 ? "" : "s"} in AgentOS.`
      : `${descriptor.shortLabel} is connected.`;
  }

  return visibleCount > 0
    ? `${visibleCount} configured model${visibleCount === 1 ? "" : "s"} are already saved in AgentOS. Connect ${descriptor.shortLabel} to use them.`
    : descriptor.helperText;
}

function findProviderRecord<T extends { provider?: unknown }>(
  entries: T[] | undefined,
  provider: AddModelsProviderId
) {
  return entries?.find((entry) => providerRecordMatchesAddModelsProvider(readString(entry.provider), provider));
}

function providerRecordMatchesAddModelsProvider(recordProvider: string | null, provider: AddModelsProviderId) {
  if (!recordProvider) {
    return false;
  }

  if (provider === "openai-codex") {
    return recordProvider === "openai" || recordProvider === "codex" || recordProvider === "openai-codex";
  }

  return recordProvider === provider;
}

function hasUsableOpenAiCodexRuntimeAuthRoute(modelStatus: ModelsStatusPayload) {
  return (modelStatus.auth?.runtimeAuthRoutes ?? []).some((entry) => {
    if (!isRecord(entry)) {
      return false;
    }

    const provider = readString(entry.provider)?.toLowerCase();
    const runtime = readString(entry.runtime)?.toLowerCase();
    const authProvider = readString(entry.authProvider)?.toLowerCase();
    const status = readString(entry.status)?.toLowerCase();

    const codexRuntime =
      runtime === "codex" ||
      runtime === "openai-codex" ||
      runtime === "app-server" ||
      runtime === "codex-app-server";
    const openAiRoute = provider === "openai" || provider === "codex" || provider === "openai-codex";
    const openAiAuth = !authProvider || authProvider === "openai" || authProvider === "codex" || authProvider === "openai-codex";
    const usableStatus = !status || ["ok", "usable", "ready", "connected"].includes(status);

    return codexRuntime && openAiRoute && openAiAuth && usableStatus;
  });
}

function countUsableAuthProfiles(value: unknown[]) {
  return value.filter((entry) => {
    if (!isRecord(entry)) {
      return false;
    }

    const status = readString(entry.status)?.toLowerCase();
    return !status || !["expired", "missing", "invalid", "error", "disabled", "revoked"].includes(status);
  }).length;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
