import "server-only";

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  isGatewayConfigRateLimitError,
  readGatewayConfigRateLimitRetryAfterMs
} from "@/lib/openclaw/client/native-ws-gateway-config";
import { normalizeClientError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import { isKnownOpenAiCodexModelId } from "@/lib/openclaw/domains/model-provider-connection";
import { getModelProviderDescriptor, isAddModelsProviderId } from "@/lib/openclaw/model-provider-registry";
import { redactSecretText } from "@/lib/security/redaction";
import type {
  AddModelsProviderConnectionStatus,
  AddModelsProviderId
} from "@/lib/openclaw/types";
import type { ModelsStatusPayload } from "@/lib/openclaw/client/gateway-client";

type OpenClawConfigPayload = {
  meta?: {
    lastTouchedVersion?: string;
    lastTouchedAt?: string;
  };
  auth?: {
    profiles?: Record<string, { provider?: string; mode?: string }>;
  };
  plugins?: {
    allow?: string[];
    entries?: Record<string, Record<string, unknown>>;
  };
  agents?: {
    defaults?: {
      model?: {
        primary?: string;
      };
      models?: Record<string, OpenClawModelDefaultsEntry>;
    };
  };
  models?: {
    providers?: Record<string, OpenClawProviderModelsEntry>;
  };
};

type OpenClawModelDefaultsEntry = Record<string, unknown> & {
  agentRuntime?: {
    id?: string;
  };
};

type OpenClawProviderModelsEntry = Record<string, unknown> & {
  models?: OpenClawProviderModelEntry[];
};

type OpenClawProviderModelEntry = Record<string, unknown> & {
  id?: string;
  name?: string;
};

type OpenClawAuthProfilesPayload = {
  version?: number;
  profiles?: Record<
    string,
    {
      type?: string;
      provider?: string;
      token?: string;
    }
  >;
  usageStats?: Record<
    string,
    {
      errorCount?: number;
      lastUsed?: number;
    }
  >;
};

const openClawConfigPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
const openClawAuthProfilesPath = path.join(
  os.homedir(),
  ".openclaw",
  "agents",
  "main",
  "agent",
  "auth-profiles.json"
);
const legacyProviderFileFallbackEnv = "AGENTOS_OPENCLAW_LEGACY_PROVIDER_FILE_FALLBACK";
const gatewayConfigPatchRetryDelaysMs = [750, 1_500, 3_000];
const maxInlineGatewayConfigRateLimitRetryMs = 3_000;

type OpenClawAgentDefaultsConfig = NonNullable<NonNullable<OpenClawConfigPayload["agents"]>["defaults"]>;

export async function readOpenClawConfiguredModelIds() {
  try {
    const configuredModels = await getOpenClawAdapter().getConfig<Record<string, unknown>>(
      "agents.defaults.models",
      { timeoutMs: 5_000 }
    );

    if (isRecord(configuredModels)) {
      return new Set(Object.keys(configuredModels));
    }
  } catch {
    // Local file read remains an offline recovery fallback when Gateway config is unavailable.
  }

  const config = await readJsonFile<OpenClawConfigPayload>(openClawConfigPath, {});
  const modelEntries = config.agents?.defaults?.models ?? {};

  return new Set(Object.keys(modelEntries));
}

export async function readOpenClawProviderModelStatus(): Promise<ModelsStatusPayload | null> {
  try {
    return await getOpenClawAdapter().getModelStatus({ timeoutMs: 8_000 });
  } catch {
    return null;
  }
}

export async function readOpenClawCodexPluginReady(): Promise<boolean> {
  const plugins = await getOpenClawAdapter().listPlugins({ timeoutMs: 5_000 });

  return plugins.plugins.some(isReadyCodexPlugin);
}

export async function buildOpenClawFileBasedProviderConnectionStatus(
  provider: AddModelsProviderId,
  configuredModelIds: Set<string>
): Promise<AddModelsProviderConnectionStatus> {
  const [config, authProfiles] = await Promise.all([
    readJsonFile<OpenClawConfigPayload>(openClawConfigPath, {}),
    readJsonFile<OpenClawAuthProfilesPayload>(openClawAuthProfilesPath, {
      version: 1
    })
  ]);
  const descriptor = getModelProviderDescriptor(provider);
  const configuredCount = [...configuredModelIds].filter(
    (modelId) => modelMatchesProvider(provider, modelId)
  ).length;
  const providerAuthCount = [
    ...Object.values(config.auth?.profiles ?? {}),
    ...Object.values(authProfiles.profiles ?? {})
  ].filter((entry) => providerAuthEntryMatchesAddModelsProvider(entry, provider)).length;
  const connected = providerAuthCount > 0 ||
    (provider === "openai-codex" && configuredCount > 0 && isCodexHarnessEnabled(config));

  return {
    provider,
    connected,
    canConnect: true,
    needsTerminal: descriptor.connectKind === "oauth",
    detail:
      connected
        ? `${configuredCount} configured model${configuredCount === 1 ? "" : "s"} in AgentOS.`
        : configuredCount > 0
          ? `${configuredCount} configured model${configuredCount === 1 ? "" : "s"} are already saved in AgentOS. Connect ${descriptor.shortLabel} to use them.`
          : descriptor.helperText
  };
}

export async function persistOpenClawProviderToken(provider: AddModelsProviderId, token: string) {
  assertLegacyProviderFileFallbackEnabled(
    "Gateway-native provider token persistence is not available yet."
  );

  const config = await readJsonFile<OpenClawConfigPayload>(openClawConfigPath, {});
  const authProfiles = await readJsonFile<OpenClawAuthProfilesPayload>(openClawAuthProfilesPath, {
    version: 1
  });
  const profileId = `${provider}:manual`;

  config.meta = {
    ...config.meta,
    lastTouchedAt: new Date().toISOString()
  };
  config.auth = config.auth || {};
  config.auth.profiles = config.auth.profiles || {};
  config.auth.profiles[profileId] = {
    provider,
    mode: "token"
  };

  authProfiles.version = 1;
  authProfiles.profiles = authProfiles.profiles || {};
  authProfiles.profiles[profileId] = {
    type: "token",
    provider,
    token
  };
  authProfiles.usageStats = authProfiles.usageStats || {};
  authProfiles.usageStats[profileId] = {
    errorCount: authProfiles.usageStats[profileId]?.errorCount ?? 0,
    lastUsed: Date.now()
  };

  await writeJsonFile(openClawConfigPath, config);
  await writeJsonFile(openClawAuthProfilesPath, authProfiles);
}

export async function addOpenClawModelsToConfig(provider: AddModelsProviderId, modelIds: string[]) {
  const normalizedModelIds = modelIds.map((modelId) => normalizeModelIdForProvider(provider, modelId));

  try {
    await addModelsToConfigViaGateway(provider, normalizedModelIds);
    return;
  } catch (error) {
    if (!isLegacyProviderFileFallbackEnabled()) {
      throw new Error(buildGatewayConfigMutationFailureMessage("adding models", error));
    }
  }

  const config = await readJsonFile<OpenClawConfigPayload>(openClawConfigPath, {});

  config.meta = {
    ...config.meta,
    lastTouchedAt: new Date().toISOString()
  };
  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {};
  config.agents.defaults.models = config.agents.defaults.models || {};

  if (provider === "openai-codex") {
    enableCodexHarness(config);
  }

  applyProviderModelRegistry(config, provider, normalizedModelIds);

  for (const modelId of normalizedModelIds) {
    config.agents.defaults.models[modelId] = config.agents.defaults.models[modelId] || {};
    applyModelRuntimePolicyToModelEntries(config.agents.defaults.models, modelId, provider);
  }

  if (!config.agents.defaults.model?.primary && normalizedModelIds[0]) {
    config.agents.defaults.model = {
      ...(config.agents.defaults.model || {}),
      primary: normalizedModelIds[0]
    };
  }

  stripLegacyAgentRuntimeFromDefaults(config.agents.defaults);
  await writeJsonFile(openClawConfigPath, config);
}

export async function ensureOpenClawModelRuntimeConfig(
  modelId: string,
  options: { provider?: AddModelsProviderId | null } = {}
) {
  const requestedModelId = modelId.trim();
  const provider = options.provider ?? resolveProviderFromModelIdForRuntime(requestedModelId);

  if (!requestedModelId || !provider) {
    return {
      modelId: requestedModelId,
      provider,
      via: "skipped" as const
    };
  }

  const normalizedModelId = normalizeModelIdForProvider(provider, requestedModelId);

  try {
    await ensureModelRuntimeConfigViaGateway(provider, normalizedModelId);
    return {
      modelId: normalizedModelId,
      provider,
      via: "gateway" as const
    };
  } catch (error) {
    if (!isLegacyProviderFileFallbackEnabled()) {
      throw new Error(buildGatewayConfigMutationFailureMessage("preparing the model runtime", error));
    }
  }

  const config = await readJsonFile<OpenClawConfigPayload>(openClawConfigPath, {});

  config.meta = {
    ...config.meta,
    lastTouchedAt: new Date().toISOString()
  };
  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {};
  config.agents.defaults.models = config.agents.defaults.models || {};
  config.agents.defaults.models[normalizedModelId] =
    config.agents.defaults.models[normalizedModelId] || {};
  applyProviderModelRegistry(config, provider, [normalizedModelId]);
  applyDefaultModelRuntime(config, provider, normalizedModelId);
  stripLegacyAgentRuntimeFromDefaults(config.agents.defaults);

  await writeJsonFile(openClawConfigPath, config);

  return {
    modelId: normalizedModelId,
    provider,
    via: "legacy-file" as const
  };
}

export async function setOpenClawDefaultModel(
  modelId: string,
  options: { provider?: AddModelsProviderId | null } = {}
) {
  const requestedModelId = modelId.trim();
  const provider = options.provider ?? resolveProviderFromModelId(requestedModelId);
  const normalizedModelId = provider ? normalizeModelIdForProvider(provider, requestedModelId) : requestedModelId;

  try {
    await setDefaultModelViaGateway(provider, normalizedModelId);
    return {
      modelId: normalizedModelId,
      provider,
      via: "gateway" as const
    };
  } catch (error) {
    if (!isLegacyProviderFileFallbackEnabled()) {
      throw new Error(buildGatewayConfigMutationFailureMessage("setting the default model", error));
    }
  }

  const config = await readJsonFile<OpenClawConfigPayload>(openClawConfigPath, {});

  config.meta = {
    ...config.meta,
    lastTouchedAt: new Date().toISOString()
  };
  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {};
  config.agents.defaults.models = config.agents.defaults.models || {};
  config.agents.defaults.models[normalizedModelId] =
    config.agents.defaults.models[normalizedModelId] || {};
  config.agents.defaults.model = {
    ...(config.agents.defaults.model || {}),
    primary: normalizedModelId
  };
  applyProviderModelRegistry(config, provider, [normalizedModelId]);
  applyDefaultModelRuntime(config, provider, normalizedModelId);
  stripLegacyAgentRuntimeFromDefaults(config.agents.defaults);

  await writeJsonFile(openClawConfigPath, config);

  return {
    modelId: normalizedModelId,
    provider,
    via: "legacy-file" as const
  };
}

async function addModelsToConfigViaGateway(provider: AddModelsProviderId, normalizedModelIds: string[]) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= gatewayConfigPatchRetryDelaysMs.length; attempt += 1) {
    try {
      await addModelsToConfigViaGatewayOnce(provider, normalizedModelIds);
      return;
    } catch (error) {
      lastError = error;
      const retryDelayMs = resolveGatewayConfigPatchRetryDelayMs(error, attempt);

      if (retryDelayMs === null) {
        throw error;
      }

      await tryStartGatewayAfterTransientConfigFailure(error);
      await delay(retryDelayMs);
    }
  }

  throw lastError;
}

async function addModelsToConfigViaGatewayOnce(provider: AddModelsProviderId, normalizedModelIds: string[]) {
  const adapter = getOpenClawAdapter();
  await ensureProviderModelRegistryViaGateway(adapter, provider, normalizedModelIds);

  const existingDefaults = await adapter.getConfig<OpenClawAgentDefaultsConfig>(
    "agents.defaults",
    { timeoutMs: 5_000 }
  );
  const nextDefaults = cloneAgentDefaults(existingDefaults);
  const nextModels = cloneModelEntries(nextDefaults.models);

  for (const modelId of normalizedModelIds) {
    nextModels[modelId] = isRecord(nextModels[modelId]) ? nextModels[modelId] : {};
    applyModelRuntimePolicyToModelEntries(nextModels, modelId, provider);
  }

  nextDefaults.models = nextModels;

  if (!nextDefaults.model?.primary && normalizedModelIds[0]) {
    nextDefaults.model = {
      ...(nextDefaults.model || {}),
      primary: normalizedModelIds[0]
    };
  }

  stripLegacyAgentRuntimeFromDefaults(nextDefaults);
  await adapter.setConfig("agents.defaults", nextDefaults, { timeoutMs: 5_000 });

  if (provider === "openai-codex") {
    await adapter.setConfig("plugins.entries.codex.enabled", true, { timeoutMs: 5_000 });
  }
}

async function setDefaultModelViaGateway(
  provider: AddModelsProviderId | null,
  normalizedModelId: string
) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= gatewayConfigPatchRetryDelaysMs.length; attempt += 1) {
    try {
      await setDefaultModelViaGatewayOnce(provider, normalizedModelId);
      return;
    } catch (error) {
      lastError = error;
      const retryDelayMs = resolveGatewayConfigPatchRetryDelayMs(error, attempt);

      if (retryDelayMs === null) {
        throw error;
      }

      await tryStartGatewayAfterTransientConfigFailure(error);
      await delay(retryDelayMs);
    }
  }

  throw lastError;
}

async function ensureModelRuntimeConfigViaGateway(provider: AddModelsProviderId, normalizedModelId: string) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= gatewayConfigPatchRetryDelaysMs.length; attempt += 1) {
    try {
      await ensureModelRuntimeConfigViaGatewayOnce(provider, normalizedModelId);
      return;
    } catch (error) {
      lastError = error;
      const retryDelayMs = resolveGatewayConfigPatchRetryDelayMs(error, attempt);

      if (retryDelayMs === null) {
        throw error;
      }

      await tryStartGatewayAfterTransientConfigFailure(error);
      await delay(retryDelayMs);
    }
  }

  throw lastError;
}

async function ensureModelRuntimeConfigViaGatewayOnce(provider: AddModelsProviderId, normalizedModelId: string) {
  const adapter = getOpenClawAdapter();
  await ensureProviderModelRegistryViaGateway(adapter, provider, [normalizedModelId]);

  const existingDefaults = await adapter.getConfig<OpenClawAgentDefaultsConfig>(
    "agents.defaults",
    { timeoutMs: 5_000 }
  );

  if (isModelRuntimePrepared(existingDefaults, normalizedModelId, provider)) {
    return;
  }

  const nextDefaults = cloneAgentDefaults(existingDefaults);
  const nextModels = cloneModelEntries(nextDefaults.models);

  nextModels[normalizedModelId] = isRecord(nextModels[normalizedModelId])
    ? nextModels[normalizedModelId]
    : {};
  applyModelRuntimePolicyToModelEntries(nextModels, normalizedModelId, provider);
  nextDefaults.models = nextModels;
  stripLegacyAgentRuntimeFromDefaults(nextDefaults);
  await adapter.setConfig("agents.defaults", nextDefaults, { timeoutMs: 5_000 });

  if (provider === "openai-codex") {
    await adapter.setConfig("plugins.entries.codex.enabled", true, { timeoutMs: 5_000 });
  }
}

function isModelRuntimePrepared(
  defaults: OpenClawAgentDefaultsConfig | null,
  modelId: string,
  provider: AddModelsProviderId
) {
  const expectedRuntimeId = resolveModelScopedRuntimeId(provider);

  if (!expectedRuntimeId) {
    return true;
  }

  if (!defaults) {
    return false;
  }

  return defaults.models?.[modelId]?.agentRuntime?.id === expectedRuntimeId;
}

async function setDefaultModelViaGatewayOnce(
  provider: AddModelsProviderId | null,
  normalizedModelId: string
) {
  const adapter = getOpenClawAdapter();
  await ensureProviderModelRegistryViaGateway(adapter, provider, [normalizedModelId]);

  const existingDefaults = await adapter.getConfig<OpenClawAgentDefaultsConfig>(
    "agents.defaults",
    { timeoutMs: 5_000 }
  );
  const nextDefaults = cloneAgentDefaults(existingDefaults);
  const nextModels = cloneModelEntries(nextDefaults.models);
  nextModels[normalizedModelId] = isRecord(nextModels[normalizedModelId])
    ? nextModels[normalizedModelId]
    : {};

  nextDefaults.models = nextModels;
  nextDefaults.model = {
    ...(nextDefaults.model || {}),
    primary: normalizedModelId
  };
  applyModelRuntimePolicyToModelEntries(nextModels, normalizedModelId, provider);
  stripLegacyAgentRuntimeFromDefaults(nextDefaults);
  await adapter.setConfig("agents.defaults", nextDefaults, { timeoutMs: 5_000 });

  if (provider === "openai-codex") {
    await adapter.setConfig("plugins.entries.codex.enabled", true, { timeoutMs: 5_000 });
  }
}

function resolveGatewayConfigPatchRetryDelayMs(error: unknown, attempt: number) {
  if (attempt >= gatewayConfigPatchRetryDelaysMs.length) {
    return null;
  }

  const retryAfterMs = readGatewayConfigRateLimitRetryAfterMs(error);

  if (retryAfterMs !== null) {
    return retryAfterMs <= maxInlineGatewayConfigRateLimitRetryMs ? retryAfterMs : null;
  }

  const message = readErrorMessage(error);

  if (isGatewayConfigSettleError(error) ||
      /1012|service restart|connection closed|closed before|gateway closed|websocket|failed to connect|could not connect|unreachable|not reachable|ECONNREFUSED|ECONNRESET|socket hang up|timed out|timeout/i.test(message)) {
    return gatewayConfigPatchRetryDelaysMs[attempt] ?? null;
  }

  return null;
}

async function tryStartGatewayAfterTransientConfigFailure(error: unknown) {
  if (!isGatewayConfigSettleError(error)) {
    return;
  }

  const adapter = getOpenClawAdapter() as {
    controlGateway?: (action: "start", options?: { timeoutMs?: number }) => Promise<unknown>;
  };

  if (typeof adapter.controlGateway !== "function") {
    return;
  }

  await adapter.controlGateway("start", { timeoutMs: 10_000 }).catch(() => {});
}

function isGatewayTransportSettleError(error: unknown) {
  const kind = normalizeClientError(error).kind;
  return kind === "timeout" || kind === "unreachable";
}

function isGatewayConfigSettleError(error: unknown) {
  return isGatewayTransportSettleError(error) ||
    /gateway starting|retry shortly/i.test(readErrorMessage(error));
}

function buildGatewayConfigMutationFailureMessage(action: string, error: unknown) {
  if (isGatewayConfigRateLimitError(error)) {
    const retryAfterMs = readGatewayConfigRateLimitRetryAfterMs(error);
    const retryHint = retryAfterMs !== null
      ? ` Wait about ${formatRetryAfter(retryAfterMs)} before retrying.`
      : " Wait for the Gateway config cooldown, then retry.";

    return `OpenClaw Gateway is rate limiting config updates while ${action}.${retryHint} AgentOS did not use CLI or legacy file fallback for this model change.`;
  }

  if (isGatewayConfigSettleError(error)) {
    return `OpenClaw Gateway was not reachable while ${action}. AgentOS retried the Gateway config update and attempted to start the Gateway. Start or repair the Gateway from system setup, then retry model setup. AgentOS did not use CLI or legacy file fallback for this model change. ${readErrorMessage(error)}`;
  }

  return `OpenClaw Gateway config update failed while ${action}. Legacy file fallback is disabled; set ${legacyProviderFileFallbackEnv}=1 only for explicit recovery. ${readErrorMessage(error)}`;
}

function formatRetryAfter(ms: number) {
  if (ms >= 60_000) {
    return `${Math.ceil(ms / 60_000)} minute${Math.ceil(ms / 60_000) === 1 ? "" : "s"}`;
  }

  return `${Math.ceil(ms / 1_000)} second${Math.ceil(ms / 1_000) === 1 ? "" : "s"}`;
}

function cloneAgentDefaults(value: unknown): OpenClawAgentDefaultsConfig {
  if (!isRecord(value)) {
    return {};
  }

  const output = {
    ...value,
    models: cloneModelEntries(value.models)
  } as OpenClawAgentDefaultsConfig;

  if (isRecord(value.model)) {
    output.model = { ...value.model };
  } else if (value.model === undefined) {
    delete output.model;
  }

  stripLegacyAgentRuntimeFromDefaults(output);

  return output;
}

function cloneModelEntries(value: unknown) {
  const output: Record<string, OpenClawModelDefaultsEntry> = {};

  if (!isRecord(value)) {
    return output;
  }

  for (const [modelId, entry] of Object.entries(value)) {
    output[modelId] = cloneModelDefaultsEntry(entry);
  }

  return output;
}

function cloneModelDefaultsEntry(value: unknown): OpenClawModelDefaultsEntry {
  if (!isRecord(value)) {
    return {};
  }

  const output = { ...value } as OpenClawModelDefaultsEntry;

  if (isRecord(value.agentRuntime)) {
    output.agentRuntime = { ...value.agentRuntime };
  } else {
    delete output.agentRuntime;
  }

  return output;
}

function applyModelRuntimePolicyToModelEntries(
  models: Record<string, OpenClawModelDefaultsEntry>,
  modelId: string,
  provider: AddModelsProviderId | null
) {
  const runtimeId = resolveModelScopedRuntimeId(provider);

  if (!runtimeId) {
    return;
  }

  const entry = models[modelId] || {};
  const existingRuntime = isRecord(entry.agentRuntime) ? entry.agentRuntime : {};

  models[modelId] = {
    ...entry,
    agentRuntime: {
      ...existingRuntime,
      id: runtimeId
    }
  };
}

async function ensureProviderModelRegistryViaGateway(
  adapter: ReturnType<typeof getOpenClawAdapter>,
  provider: AddModelsProviderId | null,
  normalizedModelIds: string[]
) {
  if (provider !== "ollama") {
    return;
  }

  const modelEntries = normalizedModelIds
    .map((modelId) => toProviderScopedModelId(provider, modelId))
    .filter(Boolean);

  if (modelEntries.length === 0) {
    return;
  }

  let existingProviderConfig: unknown = null;

  try {
    existingProviderConfig = await adapter.getConfig<OpenClawProviderModelsEntry>(
      "models.providers.ollama",
      { timeoutMs: 5_000 }
    );
  } catch {
    existingProviderConfig = null;
  }

  const nextProviderConfig = cloneProviderModelsEntry(existingProviderConfig);
  const existingIds = new Set(
    nextProviderConfig.models
      ?.map((entry) => entry.id?.trim())
      .filter((id): id is string => Boolean(id)) ?? []
  );
  let changed = false;

  for (const id of modelEntries) {
    if (!existingIds.has(id)) {
      nextProviderConfig.models = [...(nextProviderConfig.models ?? []), { id, name: id }];
      existingIds.add(id);
      changed = true;
    }
  }

  if (changed) {
    await adapter.setConfig("models.providers.ollama", nextProviderConfig, { timeoutMs: 5_000 });
  }
}

function applyProviderModelRegistry(
  config: OpenClawConfigPayload,
  provider: AddModelsProviderId | null,
  normalizedModelIds: string[]
) {
  if (provider !== "ollama") {
    return;
  }

  config.models = config.models || {};
  config.models.providers = config.models.providers || {};

  const nextProviderConfig = cloneProviderModelsEntry(config.models.providers.ollama);
  const existingIds = new Set(
    nextProviderConfig.models
      ?.map((entry) => entry.id?.trim())
      .filter((id): id is string => Boolean(id)) ?? []
  );

  for (const modelId of normalizedModelIds) {
    const id = toProviderScopedModelId(provider, modelId);

    if (id && !existingIds.has(id)) {
      nextProviderConfig.models = [...(nextProviderConfig.models ?? []), { id, name: id }];
      existingIds.add(id);
    }
  }

  config.models.providers.ollama = nextProviderConfig;
}

function cloneProviderModelsEntry(value: unknown): OpenClawProviderModelsEntry {
  if (!isRecord(value)) {
    return { models: [] };
  }

  const models = Array.isArray(value.models)
    ? value.models
        .filter(isRecord)
        .map((entry) => ({ ...entry } as OpenClawProviderModelEntry))
    : [];

  return {
    ...value,
    models
  } as OpenClawProviderModelsEntry;
}

function toProviderScopedModelId(provider: AddModelsProviderId, modelId: string) {
  const trimmed = modelId.trim();
  const prefix = `${provider}/`;

  if (!trimmed) {
    return "";
  }

  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

function resolveModelScopedRuntimeId(provider: AddModelsProviderId | null) {
  if (provider === "openai-codex") {
    return "codex";
  }

  if (provider === "openai") {
    return "openclaw";
  }

  return null;
}

function normalizeModelIdForProvider(provider: AddModelsProviderId, modelId: string) {
  if (provider === "openai-codex" && modelId.startsWith("openai-codex/")) {
    return `openai/${modelId.slice("openai-codex/".length)}`;
  }

  return modelId;
}

function resolveProviderFromModelId(modelId: string): AddModelsProviderId | null {
  const modelProvider = modelId.split("/", 1)[0] || null;
  return isAddModelsProviderId(modelProvider) ? modelProvider : null;
}

function resolveProviderFromModelIdForRuntime(modelId: string): AddModelsProviderId | null {
  if (modelMatchesProvider("openai-codex", normalizeModelIdForProvider("openai-codex", modelId))) {
    return "openai-codex";
  }

  return resolveProviderFromModelId(modelId);
}

function applyDefaultModelRuntime(
  config: OpenClawConfigPayload,
  provider: AddModelsProviderId | null,
  modelId: string
) {
  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {};
  config.agents.defaults.models = config.agents.defaults.models || {};
  config.agents.defaults.models[modelId] = config.agents.defaults.models[modelId] || {};

  if (provider === "openai-codex") {
    enableCodexHarness(config);
  }

  applyModelRuntimePolicyToModelEntries(config.agents.defaults.models, modelId, provider);
}

function enableCodexHarness(config: OpenClawConfigPayload) {
  config.plugins = config.plugins || {};
  config.plugins.entries = config.plugins.entries || {};
  config.plugins.entries.codex = {
    ...config.plugins.entries.codex,
    enabled: true
  };

  if (Array.isArray(config.plugins.allow) && !config.plugins.allow.includes("codex")) {
    config.plugins.allow = [...config.plugins.allow, "codex"];
  }
}

function isCodexHarnessEnabled(config: OpenClawConfigPayload) {
  const entry = config.plugins?.entries?.codex;
  const allowed = Array.isArray(config.plugins?.allow) && config.plugins.allow.includes("codex");

  return (Boolean(entry) && entry?.enabled !== false) || allowed;
}

function isReadyCodexPlugin(plugin: { id: string; name: string; status?: string }) {
  const id = plugin.id.trim().toLowerCase();
  const name = plugin.name.trim().toLowerCase();
  const status = plugin.status?.trim().toLowerCase() ?? "";
  const isCodexPlugin = id === "codex" || id === "@openclaw/codex" || name === "codex" || name === "@openclaw/codex";

  return isCodexPlugin && !["disabled", "missing", "error", "failed", "blocked"].includes(status);
}

function stripLegacyAgentRuntimeFromDefaults(defaults: OpenClawAgentDefaultsConfig) {
  delete (defaults as Record<string, unknown>).agentRuntime;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: filePath === openClawAuthProfilesPath ? 0o600 : 0o644
  });

  if (filePath === openClawAuthProfilesPath) {
    await chmod(filePath, 0o600);
  }
}

function assertLegacyProviderFileFallbackEnabled(reason: string) {
  if (isLegacyProviderFileFallbackEnabled()) {
    return;
  }

  throw new Error(
    `${reason} Legacy OpenClaw provider file writes are disabled by default; set ${legacyProviderFileFallbackEnv}=1 only for explicit recovery.`
  );
}

function isLegacyProviderFileFallbackEnabled() {
  const value = process.env[legacyProviderFileFallbackEnv];
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "on";
}

function readErrorMessage(error: unknown) {
  return redactSecretText(error instanceof Error ? error.message : String(error || "Unknown Gateway error."));
}

function modelMatchesProvider(provider: AddModelsProviderId, modelId: string) {
  const modelProvider = modelId.split("/")[0] ?? "";

  if (provider === "openai-codex") {
    return modelProvider === "codex" ||
      modelProvider === "openai-codex" ||
      isKnownOpenAiCodexModelId(modelId);
  }

  return modelProvider === provider && isAddModelsProviderId(modelProvider);
}

function providerAuthEntryMatchesAddModelsProvider(
  entry: { provider?: string; type?: string; mode?: string },
  provider: AddModelsProviderId
) {
  const entryProvider = entry.provider;
  if (!entryProvider) {
    return false;
  }

  if (provider === "openai-codex") {
    return entryProvider === "codex" ||
      entryProvider === "openai-codex" ||
      (entryProvider === "openai" && ["oauth", "app-server", "codex-app-server"].includes(entry.type ?? entry.mode ?? ""));
  }

  return entryProvider === provider;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
