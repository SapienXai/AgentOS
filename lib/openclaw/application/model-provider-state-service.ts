import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { getModelProviderDescriptor, isAddModelsProviderId } from "@/lib/openclaw/model-provider-registry";
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
      agentRuntime?: {
        id?: string;
      };
      models?: Record<string, Record<string, never>>;
    };
  };
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
const gatewayConfigPatchRetryDelaysMs = [500, 1_250, 2_500];

export async function readOpenClawConfiguredModelIds() {
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
  ].filter((entry) => entry.provider === provider).length;
  const connected = providerAuthCount > 0;

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
      throw new Error(
        `OpenClaw Gateway config.patch failed while adding models. Legacy file fallback is disabled; set ${legacyProviderFileFallbackEnv}=1 only for explicit recovery. ${readErrorMessage(error)}`
      );
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

  for (const modelId of normalizedModelIds) {
    config.agents.defaults.models[modelId] = config.agents.defaults.models[modelId] || {};
  }

  if (!config.agents.defaults.model?.primary && normalizedModelIds[0]) {
    config.agents.defaults.model = {
      ...(config.agents.defaults.model || {}),
      primary: normalizedModelIds[0]
    };

    if (provider === "openai-codex") {
      config.agents.defaults.agentRuntime = {
        ...(config.agents.defaults.agentRuntime || {}),
        id: "codex"
      };
    } else if (provider === "openai") {
      config.agents.defaults.agentRuntime = {
        ...(config.agents.defaults.agentRuntime || {}),
        id: "pi"
      };
    }
  }

  await writeJsonFile(openClawConfigPath, config);
}

async function addModelsToConfigViaGateway(provider: AddModelsProviderId, normalizedModelIds: string[]) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= gatewayConfigPatchRetryDelaysMs.length; attempt += 1) {
    try {
      await addModelsToConfigViaGatewayOnce(provider, normalizedModelIds);
      return;
    } catch (error) {
      lastError = error;

      if (attempt >= gatewayConfigPatchRetryDelaysMs.length || !isRetryableGatewayConfigPatchError(error)) {
        throw error;
      }

      await delay(gatewayConfigPatchRetryDelaysMs[attempt] ?? 0);
    }
  }

  throw lastError;
}

async function addModelsToConfigViaGatewayOnce(provider: AddModelsProviderId, normalizedModelIds: string[]) {
  const snapshot = await getOpenClawAdapter().call<Record<string, unknown>>("config.get", {}, { timeoutMs: 5_000 });
  const config = isRecord(snapshot.config) ? snapshot.config : {};
  const patch: Record<string, unknown> = {
    agents: {
      defaults: {
        models: Object.fromEntries(normalizedModelIds.map((modelId) => [modelId, {}]))
      }
    }
  };
  const defaultsPatch = (patch.agents as { defaults: Record<string, unknown> }).defaults;

  if (!readConfigPath(config, "agents.defaults.model.primary") && normalizedModelIds[0]) {
    defaultsPatch.model = {
      primary: normalizedModelIds[0]
    };

    if (provider === "openai-codex") {
      defaultsPatch.agentRuntime = {
        id: "codex"
      };
    } else if (provider === "openai") {
      defaultsPatch.agentRuntime = {
        id: "pi"
      };
    }
  }

  if (provider === "openai-codex") {
    patch.plugins = {
      entries: {
        codex: {
          enabled: true
        }
      }
    };
  }

  const params: Record<string, unknown> = {
    raw: JSON.stringify(patch)
  };
  const baseHash = typeof snapshot.hash === "string" && snapshot.hash.trim() ? snapshot.hash : null;

  if (baseHash) {
    params.baseHash = baseHash;
  }

  await getOpenClawAdapter().call("config.patch", params, { timeoutMs: 5_000 });
}

function isRetryableGatewayConfigPatchError(error: unknown) {
  const message = readErrorMessage(error);

  return /1012|service restart|connection closed|closed before|gateway closed|websocket|ECONNREFUSED|ECONNRESET|socket hang up|timed out|timeout/i.test(message);
}

function normalizeModelIdForProvider(provider: AddModelsProviderId, modelId: string) {
  if (provider === "openai-codex" && modelId.startsWith("openai-codex/")) {
    return `openai/${modelId.slice("openai-codex/".length)}`;
  }

  return modelId;
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
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
  return error instanceof Error ? error.message : String(error || "Unknown Gateway error.");
}

function readConfigPath(source: unknown, configPath: string) {
  let current = source;

  for (const segment of configPath.split(".")) {
    if (!isRecord(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function modelMatchesProvider(provider: AddModelsProviderId, modelId: string) {
  const modelProvider = modelId.split("/")[0] as AddModelsProviderId;

  if (provider === "openai-codex") {
    return modelProvider === "openai" || modelProvider === "openai-codex";
  }

  return modelProvider === provider && isAddModelsProviderId(modelProvider);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
