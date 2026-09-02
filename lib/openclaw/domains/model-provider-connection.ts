import type { ModelsStatusPayload } from "@/lib/openclaw/client/types";
import {
  getModelProviderDescriptor,
  isUnsupportedLegacyProviderId
} from "@/lib/openclaw/model-provider-registry";
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
  const usableOauthStatus = oauthStatus === "ok" && (oauthProfiles === null || usableOauthProfileCount > 0);
  const profileSummary: Record<string, unknown> = isRecord(authProvider?.profiles)
    ? authProvider.profiles as Record<string, unknown>
    : {};
  const profileCount = readNumber(profileSummary.count) ?? 0;
  const tokenProfileCount = readNumber(profileSummary.token) ?? 0;
  const apiKeyProfileCount = readNumber(profileSummary.apiKey) ?? 0;
  const oauthProfileCount = readNumber(profileSummary.oauth) ?? 0;
  const effectiveKind = readString(authProvider?.effective?.kind)?.toLowerCase();
  const syntheticAuthValue = readString(authProvider?.syntheticAuth?.value);
  const hasUsableRuntimeAuthRoute = hasUsableOpenAiRuntimeAuthRoute(modelStatus);
  const connected = resolveProviderConnected({
    provider,
    visibleCount,
    oauthProfiles,
    usableOauthProfileCount,
    oauthStatus,
    usableOauthStatus,
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
    authMethod: resolveAuthMethod({
      provider,
      oauthProfiles,
      usableOauthProfileCount,
      usableOauthStatus,
      effectiveKind,
      hasUsableRuntimeAuthRoute,
      tokenProfileCount,
      apiKeyProfileCount
    }),
    availableAuthMethods: descriptor.authMethods ? [...descriptor.authMethods] : undefined,
    connected,
    verification: connected ? "credential-stored" : "not-configured",
    canConnect: true,
    needsTerminal: false,
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
      usableOauthStatus,
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

  return modelProvider === provider;
}

export function resolveModelRecordProvider(
  modelId: string,
  modelStatus?: ModelsStatusPayload,
  metadata: ModelProviderMetadata = {}
) {
  const modelProvider = modelId.split("/", 1)[0] || "unknown";
  const metadataProvider = metadata.provider?.trim() || null;

  if (modelProvider === "openai" && (!metadataProvider || metadataProvider === "openai")) {
    return "openai";
  }

  return metadataProvider || modelProvider;
}

export function normalizeOpenAiModelId(modelId: string) {
  return modelId.trim();
}

export function modelRecordIdentityKey(
  modelId: string,
  provider: string
) {
  const canonicalModelId = normalizeOpenAiModelId(modelId);
  return `${provider}:${canonicalModelId.toLowerCase()}`;
}

export function isOpenAiBackedModel(
  modelId: string,
  modelStatus?: ModelsStatusPayload,
  metadata: ModelProviderMetadata = {}
) {
  const modelProvider = modelId.split("/", 1)[0] || "";
  const metadataProvider = metadata.provider?.trim() || null;

  return modelProvider === "openai" && (!metadataProvider || metadataProvider === "openai");
}

export function isKnownOpenAiModelId(modelId: string) {
  return /^openai\/[a-z0-9][a-z0-9._:-]*$/i.test(modelId.trim());
}

export function isUnsupportedLegacyModelId(modelId: string) {
  const provider = modelId.trim().split("/", 1)[0] ?? "";
  return isUnsupportedLegacyProviderId(provider);
}

function resolveProviderConnected({
  provider,
  visibleCount,
  oauthProfiles,
  usableOauthProfileCount,
  oauthStatus,
  usableOauthStatus,
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
  usableOauthStatus: boolean;
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

  if (provider === "openai") {
    const credentialProfileCount = tokenProfileCount + apiKeyProfileCount;

    return Boolean(
      credentialProfileCount > 0 ||
      (oauthProfiles && usableOauthProfileCount > 0) ||
      usableOauthStatus ||
      hasUsableRuntimeAuthRoute ||
      effectiveKind === "oauth" ||
      (effectiveKind && ["token", "apikey", "api-key"].includes(effectiveKind)) ||
      (!oauthStatus && effectiveKind === "profiles" && profileCount > 0 && oauthProfileCount === 0)
    );
  }

  return oauthStatus === "ok" ||
    profileCount > 0 ||
    Boolean(syntheticAuthValue) ||
    Boolean(effectiveKind && ["ok", "profiles", "token", "apikey", "api-key", "oauth", "synthetic"].includes(effectiveKind));
}

function resolveConnectionDetail({
  provider,
  descriptor,
  connected,
  visibleCount,
  profileCount,
  usableOauthProfileCount,
  usableOauthStatus,
  hasUsableRuntimeAuthRoute
}: {
  provider: AddModelsProviderId;
  descriptor: ReturnType<typeof getModelProviderDescriptor>;
  connected: boolean;
  visibleCount: number;
  profileCount: number;
  usableOauthProfileCount: number;
  usableOauthStatus: boolean;
  hasUsableRuntimeAuthRoute: boolean;
}) {
  if (provider === "ollama") {
    return visibleCount > 0
      ? `${visibleCount} local model${visibleCount === 1 ? "" : "s"} detected.`
      : "Install or pull a local model to unlock this route.";
  }

  if (connected) {
    if (usableOauthProfileCount > 0 || usableOauthStatus || hasUsableRuntimeAuthRoute) {
      return provider === "openai" ? "ChatGPT OAuth connected" : "OAuth connected";
    }

    if (profileCount > 0) {
      return `${profileCount} auth profile${profileCount === 1 ? "" : "s"}`;
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

  return recordProvider === provider;
}

function hasUsableOpenAiRuntimeAuthRoute(modelStatus: ModelsStatusPayload) {
  return (modelStatus.auth?.runtimeAuthRoutes ?? []).some((entry) => {
    if (!isRecord(entry)) {
      return false;
    }

    const provider = readString(entry.provider)?.toLowerCase();
    const runtime = readString(entry.runtime)?.toLowerCase();
    const authProvider = readString(entry.authProvider)?.toLowerCase();
    const status = readString(entry.status)?.toLowerCase();

    const codexRuntime = runtime === "codex";
    const openAiRoute = provider === "openai";
    const openAiAuth = authProvider === "openai";
    const usableStatus = !status || ["ok", "usable", "ready", "connected"].includes(status);

    return codexRuntime && openAiRoute && openAiAuth && usableStatus;
  });
}

function resolveAuthMethod({
  provider,
  oauthProfiles,
  usableOauthProfileCount,
  usableOauthStatus,
  effectiveKind,
  hasUsableRuntimeAuthRoute,
  tokenProfileCount,
  apiKeyProfileCount
}: {
  provider: AddModelsProviderId;
  oauthProfiles: unknown[] | null;
  usableOauthProfileCount: number;
  usableOauthStatus: boolean;
  effectiveKind?: string;
  hasUsableRuntimeAuthRoute: boolean;
  tokenProfileCount: number;
  apiKeyProfileCount: number;
}) {
  if (provider !== "openai") {
    return null;
  }

  if (
    (oauthProfiles && usableOauthProfileCount > 0) ||
    usableOauthStatus ||
    hasUsableRuntimeAuthRoute ||
    effectiveKind === "oauth"
  ) {
    return "chatgpt-oauth" as const;
  }

  if (tokenProfileCount > 0 || apiKeyProfileCount > 0 || ["token", "apikey", "api-key"].includes(effectiveKind ?? "")) {
    return "api-key" as const;
  }

  return null;
}

function countUsableAuthProfiles(value: unknown[]) {
  return value.filter((entry) => {
    if (!isRecord(entry)) {
      return false;
    }

    const profileId = readString(entry.profileId) ?? readString(entry.id);
    if (profileId && !profileId.toLowerCase().startsWith("openai:")) {
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
