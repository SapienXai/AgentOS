import type { ModelsStatusPayload } from "@/lib/openclaw/client/gateway-client";
import { getModelProviderDescriptor } from "@/lib/openclaw/model-provider-registry";
import type {
  AddModelsProviderConnectionStatus,
  AddModelsProviderId
} from "@/lib/openclaw/types";

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
  const connected = provider === "ollama"
    ? visibleCount > 0
    : oauthProfiles
      ? usableOauthProfileCount > 0 || oauthStatus === "ok"
      : oauthStatus === "ok" ||
        profileCount > 0 ||
        Boolean(effectiveKind && ["ok", "profiles", "token", "apikey", "api-key", "oauth"].includes(effectiveKind));

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

export function modelMatchesAddModelsProvider(provider: AddModelsProviderId, modelId: string) {
  const modelProvider = modelId.split("/", 1)[0] || "";

  if (provider === "openai-codex") {
    return modelProvider === "openai" || modelProvider === "openai-codex";
  }

  return modelProvider === provider;
}

export function resolveModelRecordProvider(modelId: string, modelStatus?: ModelsStatusPayload) {
  const modelProvider = modelId.split("/", 1)[0] || "unknown";

  if (modelProvider === "openai" && shouldDisplayOpenAiModelAsCodex(modelId, modelStatus)) {
    return "openai-codex";
  }

  return modelProvider;
}

export function isOpenAiCodexBackedModel(modelId: string, modelStatus?: ModelsStatusPayload) {
  const modelProvider = modelId.split("/", 1)[0] || "";

  if (modelProvider === "openai-codex") {
    return true;
  }

  return modelProvider === "openai" && (/^openai\/gpt-/i.test(modelId) || shouldDisplayOpenAiModelAsCodex(modelId, modelStatus));
}

function shouldDisplayOpenAiModelAsCodex(modelId: string, modelStatus?: ModelsStatusPayload) {
  if (/^openai\/.*codex/i.test(modelId)) {
    return true;
  }

  if (!modelStatus) {
    return false;
  }

  const codexStatus = buildModelStatusConnectionStatus("openai-codex", modelStatus, []);
  const openAiStatus = buildModelStatusConnectionStatus("openai", modelStatus, []);

  return Boolean(codexStatus?.connected && !openAiStatus?.connected);
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
  return entries?.find((entry) => readString(entry.provider) === provider);
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
