import type { ModelsStatusPayload } from "@/lib/openclaw/client/gateway-client";
import { getModelProviderDescriptor } from "@/lib/openclaw/model-provider-registry";
import type {
  AddModelsProviderConnectionStatus,
  AddModelsProviderId
} from "@/lib/openclaw/types";

type ModelProviderMetadata = {
  provider?: string | null;
  tags?: string[] | null;
};

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
  const profileCount = readNumber(authProvider?.profiles?.count) ?? 0;
  const effectiveKind = readString(authProvider?.effective?.kind)?.toLowerCase();
  const syntheticAuthValue = readString(authProvider?.syntheticAuth?.value);
  const connected = resolveProviderConnected({
    provider,
    visibleCount,
    oauthProfiles,
    usableOauthProfileCount,
    oauthStatus,
    profileCount,
    effectiveKind,
    syntheticAuthValue
  });

  return {
    provider,
    connected,
    canConnect: true,
    needsTerminal: descriptor.connectKind === "oauth",
    detail: resolveConnectionDetail({
      provider,
      descriptor,
      connected,
      visibleCount,
      profileCount,
      usableOauthProfileCount,
      oauthStatus
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
    return false;
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
  effectiveKind,
  syntheticAuthValue
}: {
  provider: AddModelsProviderId;
  visibleCount: number;
  oauthProfiles: unknown[] | null;
  usableOauthProfileCount: number;
  oauthStatus?: string;
  profileCount: number;
  effectiveKind?: string;
  syntheticAuthValue: string | null;
}) {
  if (provider === "ollama") {
    return visibleCount > 0;
  }

  if (provider === "openai-codex") {
    return Boolean(
      (oauthProfiles && usableOauthProfileCount > 0) ||
      oauthStatus === "ok" ||
      syntheticAuthValue ||
      effectiveKind === "oauth" ||
      effectiveKind === "synthetic"
    );
  }

  if (provider === "openai") {
    return Boolean(
      (profileCount > 0 && effectiveKind !== "oauth") ||
      (effectiveKind && ["ok", "profiles", "token", "apikey", "api-key"].includes(effectiveKind)) ||
      (syntheticAuthValue && effectiveKind !== "oauth")
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
  oauthStatus
}: {
  provider: AddModelsProviderId;
  descriptor: ReturnType<typeof getModelProviderDescriptor>;
  connected: boolean;
  visibleCount: number;
  profileCount: number;
  usableOauthProfileCount: number;
  oauthStatus?: string;
}) {
  if (provider === "ollama") {
    return visibleCount > 0
      ? `${visibleCount} local model${visibleCount === 1 ? "" : "s"} detected.`
      : "Install or pull a local model to unlock this route.";
  }

  if (connected) {
    if (usableOauthProfileCount > 0 || oauthStatus === "ok") {
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
