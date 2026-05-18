import { NextResponse } from "next/server";
import { z } from "zod";

import { getModelProviderDescriptor, isAddModelsProviderId } from "@/lib/openclaw/model-provider-registry";
import { formatOpenClawCommand, resolveOpenClawBin } from "@/lib/openclaw/cli";
import {
  listOpenClawModels,
  scanOpenClawModels
} from "@/lib/openclaw/application/catalog-service";
import {
  buildOpenAiCodexAuthLoginCommand,
  isOpenAiCodexAuthRefreshFailure,
  isOpenAiCodexDiscoveryTimeout,
  resolveOpenAiCodexAuthRecoveryMessage
} from "@/lib/openclaw/model-auth-errors";
import { clearOpenAiCodexAuthRuntimeSmokeFailures } from "@/lib/openclaw/domains/control-plane-settings";
import { buildModelStatusConnectionStatus } from "@/lib/openclaw/domains/model-provider-connection";
import { clearMissionControlCaches, getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import {
  addOpenClawModelsToConfig,
  buildOpenClawFileBasedProviderConnectionStatus,
  persistOpenClawProviderToken,
  readOpenClawConfiguredModelIds,
  readOpenClawProviderModelStatus
} from "@/lib/openclaw/application/model-provider-state-service";
import type {
  AddModelsCatalogModel,
  AddModelsEmptyState,
  AddModelsProviderActionRequest,
  AddModelsProviderActionResult,
  AddModelsProviderConnectionStatus,
  AddModelsProviderId,
  MissionControlSnapshot
} from "@/lib/agentos/contracts";
import type {
  ModelsPayload,
  OpenClawModelScanPayload as OpenClawModelScanPayloadFromClient
} from "@/lib/openclaw/client/gateway-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addModelsDocsUrl = "https://docs.openclaw.ai/cli/models";
const codexDiscoveryTimeoutMs = 15_000;
const providerIdSchema = z.enum([
  "openai-codex",
  "openrouter",
  "ollama",
  "openai",
  "anthropic",
  "xai",
  "google",
  "deepseek",
  "mistral"
]);
const optionalInputString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().trim().min(1).optional());

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("status"),
    provider: providerIdSchema
  }),
  z.object({
    action: z.literal("connect"),
    provider: providerIdSchema,
    apiKey: optionalInputString,
    endpoint: optionalInputString
  }),
  z.object({
    action: z.literal("discover"),
    provider: providerIdSchema
  }),
  z.object({
    action: z.literal("add-models"),
    provider: providerIdSchema,
    modelIds: z.array(z.string().trim().min(1)).min(1)
  })
]);

type OpenClawModelsListPayload = ModelsPayload;
type OpenClawModelScanPayload = OpenClawModelScanPayloadFromClient;

type OllamaState =
  | {
      installed: false;
      models: string[];
    }
  | {
      installed: true;
      models: string[];
    };

const providerTokenRules: Partial<Record<AddModelsProviderId, RegExp>> = {
  openrouter: /^sk-or-/i,
  openai: /^sk-/i,
  anthropic: /^sk-ant-/i
};

class ProviderAuthActionError extends Error {
  constructor(
    message: string,
    readonly manualCommand: string
  ) {
    super(message);
    this.name = "ProviderAuthActionError";
  }
}

class ProviderCatalogFallbackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderCatalogFallbackError";
  }
}

export async function POST(request: Request) {
  let input: AddModelsProviderActionRequest;

  try {
    input = requestSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Model provider action is required."
      },
      { status: 400 }
    );
  }

  try {
    const result = await handleProviderAction(input);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Add Models request failed."
      },
      { status: 500 }
    );
  }
}

async function handleProviderAction(
  input: AddModelsProviderActionRequest
): Promise<AddModelsProviderActionResult> {
  const commandBin = await resolveOpenClawBin().catch(() => "openclaw");

  if (input.action === "status") {
    const statusContext = await readProviderConnectionContext(input.provider);
    await clearConnectedProviderWarnings(input.provider, statusContext.connection);

    return buildActionResult({
      ok: true,
      action: input.action,
      provider: input.provider,
      message: resolveProviderStatusMessage(input.provider, statusContext.connection),
      connection: statusContext.connection,
      models: [],
      emptyState: statusContext.ollamaState ? resolveOllamaEmptyState(statusContext.ollamaState) : null,
      docsUrl: addModelsDocsUrl
    });
  }

  if (input.action === "connect") {
    if (input.provider === "ollama") {
      return discoverProviderModels(input.provider, commandBin);
    }

    if (input.provider === "openai-codex") {
      const statusContext = await readProviderConnectionContext(input.provider);

      return buildActionResult({
        ok: true,
        action: input.action,
        provider: input.provider,
        message: "Continue in Terminal to connect your ChatGPT account, then come back to discover models.",
        connection: statusContext.connection,
        models: [],
        manualCommand: formatOpenClawCommand(commandBin, [
          "models",
          "auth",
          "login",
          "--provider",
          "openai-codex",
          "--set-default"
        ]),
        docsUrl: addModelsDocsUrl
      });
    }

    const apiKey = input.apiKey?.trim();

    if (!apiKey) {
      const statusContext = await readProviderConnectionContext(input.provider);

      return buildActionResult({
        ok: false,
        action: input.action,
        provider: input.provider,
        message: "Enter an API key to continue.",
        connection: statusContext.connection,
        models: [],
        docsUrl: addModelsDocsUrl
      });
    }

    validateApiKey(input.provider, apiKey);
    await persistOpenClawProviderToken(input.provider, apiKey);

    const snapshot = await getMissionControlSnapshot({ force: true });
    const statusContext = await readProviderConnectionContext(input.provider);

    return buildActionResult({
      ok: true,
      action: input.action,
      provider: input.provider,
      message: `Connected ${getModelProviderDescriptor(input.provider).shortLabel}. Discovering available models is next.`,
      snapshot,
      connection: statusContext.connection,
      models: [],
      docsUrl: addModelsDocsUrl
    });
  }

  if (input.action === "discover") {
    return discoverProviderModels(input.provider, commandBin);
  }

  await addOpenClawModelsToConfig(input.provider, input.modelIds);
  if (input.provider === "openai-codex" && await clearOpenAiCodexAuthRuntimeSmokeFailures()) {
    clearMissionControlCaches();
  }
  const refreshedSnapshot = await getMissionControlSnapshot({ force: true });
  const statusContext = await readProviderConnectionContext(input.provider);
  const providerModels = await readProviderCatalog(input.provider, statusContext.configuredModelIds, commandBin);

  return buildActionResult({
    ok: true,
    action: input.action,
    provider: input.provider,
    message: `Added ${input.modelIds.length} model${input.modelIds.length === 1 ? "" : "s"} to AgentOS.`,
    snapshot: refreshedSnapshot,
    connection: statusContext.connection,
    models: providerModels,
    docsUrl: addModelsDocsUrl
  });
}

async function discoverProviderModels(
  provider: AddModelsProviderId,
  commandBin = "openclaw"
): Promise<AddModelsProviderActionResult> {
  const { connection, ollamaState, configuredModelIds } = await readProviderConnectionContext(provider);
  await clearConnectedProviderWarnings(provider, connection);
  let models: AddModelsCatalogModel[];
  let fallbackMessage: string | null = null;

  try {
    models = await readProviderCatalog(provider, configuredModelIds, commandBin);
  } catch (error) {
    if (provider === "openai-codex" && (error instanceof ProviderAuthActionError || error instanceof ProviderCatalogFallbackError)) {
      fallbackMessage = error instanceof ProviderAuthActionError
        ? "OpenClaw still reported a Codex auth issue, so AgentOS is showing known Codex routes. Runtime verification will re-check ChatGPT auth."
        : error.message;
      models = buildFallbackCodexCatalog(configuredModelIds);
    } else if (error instanceof ProviderAuthActionError) {
      return buildActionResult({
        ok: false,
        action: "discover",
        provider,
        message: error.message,
        connection: {
          ...connection,
          connected: false,
          detail: "Reconnect ChatGPT to refresh the OpenAI Codex OAuth session."
        },
        models: [],
        emptyState: {
          kind: "no-models",
          title: "Reconnect ChatGPT",
          description: error.message
        },
        manualCommand: error.manualCommand,
        docsUrl: addModelsDocsUrl
      });
    }

    throw error;
  }
  const snapshot = provider === "openai-codex"
    ? await getMissionControlSnapshot({ force: true, loadProfile: "system" }).catch(() => undefined)
    : undefined;

  return buildActionResult({
    ok: true,
    action: "discover",
    provider,
    message: fallbackMessage ??
      (provider === "openai-codex"
        ? `Showing ${models.length} ChatGPT/Codex model route${models.length === 1 ? "" : "s"}. Runtime verification will re-check ChatGPT auth.`
        : models.length
          ? `Found ${models.length} model${models.length === 1 ? "" : "s"}.`
          : "No models were returned for this provider."),
    connection,
    models,
    emptyState:
      models.length === 0
        ? provider === "ollama"
          ? resolveOllamaEmptyState(ollamaState)
          : {
              kind: "no-models",
              title: "No models found",
              description: "This provider connected, but no selectable models were returned yet."
            }
        : null,
    snapshot,
    docsUrl: addModelsDocsUrl
  });
}

async function readProviderCatalog(
  provider: AddModelsProviderId,
  configuredModelIds: Set<string>,
  commandBin = "openclaw"
): Promise<AddModelsCatalogModel[]> {
  if (provider === "openai-codex") {
    try {
      const providerPayload = await readProviderModelPayload(provider, { all: true, provider: "openai" }, commandBin);
      const providerModels = normalizeCatalogModels(provider, providerPayload.models, configuredModelIds);

      if (providerModels.length > 0) {
        return providerModels;
      }
    } catch {
      // Fall through to known canonical Codex routes below.
    }

    return buildFallbackCodexCatalog(configuredModelIds);
  }

  const providerPayload = await readProviderModelPayload(provider, { all: true, provider }, commandBin);
  const providerModels = normalizeCatalogModels(provider, providerPayload.models, configuredModelIds);

  if (providerModels.length > 0) {
    return providerModels;
  }

  const globalPayload = await readProviderModelPayload(provider, { all: true }, commandBin);
  const globalModels = normalizeCatalogModels(provider, globalPayload.models, configuredModelIds);

  if (globalModels.length > 0 || provider === "ollama") {
    return globalModels;
  }

  const scanPayload = await scanProviderModels(provider, commandBin);

  return normalizeScanModels(provider, scanPayload, configuredModelIds);
}

async function readProviderModelPayload(
  provider: AddModelsProviderId,
  input: Parameters<typeof listOpenClawModels>[0],
  commandBin = "openclaw"
) {
  try {
    return await listOpenClawModels(input, {
      timeoutMs: provider === "openai-codex" ? codexDiscoveryTimeoutMs : undefined
    });
  } catch (error) {
    throw normalizeProviderCatalogError(provider, error, commandBin);
  }
}

async function scanProviderModels(provider: AddModelsProviderId, commandBin = "openclaw") {
  try {
    return await scanOpenClawModels({
      yes: true,
      noInput: true,
      noProbe: true,
      timeoutMs: provider === "openai-codex" ? codexDiscoveryTimeoutMs : undefined
    });
  } catch (error) {
    throw normalizeProviderCatalogError(provider, error, commandBin);
  }
}

function normalizeProviderCatalogError(provider: AddModelsProviderId, error: unknown, commandBin = "openclaw") {
  const message = stringifyProviderError(error);

  if (
    provider === "openai-codex" &&
    isOpenAiCodexAuthRefreshFailure(message)
  ) {
    const command = buildOpenAiCodexAuthLoginCommand(commandBin);

    return new ProviderAuthActionError(
      resolveOpenAiCodexAuthRecoveryMessage(command),
      command
    );
  }

  if (provider === "openai-codex" && isOpenAiCodexDiscoveryTimeout(message)) {
    return new ProviderCatalogFallbackError(
      "OpenClaw Codex model discovery timed out, so AgentOS is showing known Codex routes without extending the timeout."
    );
  }

  return error;
}

function stringifyProviderError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object") {
    const stdout = "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
    const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    return [message, stdout, stderr].filter(Boolean).join("\n");
  }

  return String(error || "");
}

function normalizeCatalogModels(
  provider: AddModelsProviderId,
  models: OpenClawModelsListPayload["models"],
  configuredModelIds: Set<string>
) {
  const uniqueModels = new Map<string, typeof models[number]>();
  for (const model of models || []) {
    const modelKey = normalizeModelIdForProvider(provider, model.key);

    if (!modelMatchesProvider(provider, modelKey)) {
      continue;
    }

    if (!uniqueModels.has(modelKey)) {
      uniqueModels.set(modelKey, {
        ...model,
        key: modelKey
      });
    }
  }

  return Array.from(uniqueModels.values()).map((model) => ({
    id: model.key,
    name: model.name,
    provider,
    input: model.input,
    contextWindow: model.contextWindow ?? null,
    local: Boolean(model.local),
    available: model.available !== false,
    missing: Boolean(model.missing),
    alreadyAdded: configuredModelIds.has(model.key),
    recommended: isRecommendedModel(provider, model.key),
    supportsTools: model.input.includes("text"),
    isFree: /:free$/i.test(model.key) || /\(free\)/i.test(model.name),
    tags: Array.isArray(model.tags) ? model.tags : []
  }));
}

function buildFallbackCodexCatalog(configuredModelIds: Set<string>): AddModelsCatalogModel[] {
  return [
    {
      id: "openai/gpt-5.5",
      name: "GPT-5.5",
      contextWindow: 272000,
      recommended: true
    },
    {
      id: "openai/gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      contextWindow: 272000,
      recommended: true
    },
    {
      id: "openai/gpt-5.5-pro",
      name: "GPT-5.5 Pro",
      contextWindow: null,
      recommended: false
    }
  ].map((model) => ({
    id: model.id,
    name: model.name,
    provider: "openai-codex",
    input: "text+tools",
    contextWindow: model.contextWindow,
    local: false,
    available: true,
    missing: false,
    alreadyAdded: configuredModelIds.has(model.id),
    recommended: model.recommended,
    supportsTools: true,
    isFree: false,
    tags: ["known-route"]
  }));
}

function normalizeScanModels(
  provider: AddModelsProviderId,
  models: OpenClawModelScanPayload,
  configuredModelIds: Set<string>
): AddModelsCatalogModel[] {
  const uniqueModels = new Map<string, OpenClawModelScanPayload[number]>();

  for (const candidate of models || []) {
    const modelId = normalizeModelIdForProvider(provider, resolveDiscoveredModelId(candidate));
    if (!modelId) {
      continue;
    }

    if (
      !modelMatchesProvider(provider, modelId) ||
      uniqueModels.has(modelId)
    ) {
      continue;
    }

    uniqueModels.set(modelId, candidate);
  }

  return Array.from(uniqueModels.values()).map((candidate) => {
    const modelId = normalizeModelIdForProvider(provider, resolveDiscoveredModelId(candidate));

    return {
      id: modelId,
      name: candidate.name.trim(),
      provider,
      input: candidate.supportsToolsMeta ? "text+tools" : "text",
      contextWindow: candidate.contextLength ?? null,
      local: false,
      available: true,
      missing: false,
      alreadyAdded: configuredModelIds.has(modelId),
      recommended: isRecommendedModel(provider, modelId),
      supportsTools: candidate.supportsToolsMeta === true,
      isFree: candidate.isFree === true,
      tags: []
    };
  });
}

function resolveDiscoveredModelId(candidate: OpenClawModelScanPayload[number]) {
  const modelRef = candidate.modelRef?.trim();

  if (modelRef) {
    return modelRef;
  }

  const provider = candidate.provider.trim();
  const id = candidate.id.trim();

  if (!provider || !id) {
    return "";
  }

  return `${provider}/${id}`;
}

function buildActionResult({
  ok,
  action,
  provider,
  message,
  snapshot,
  connection,
  models,
  emptyState = null,
  manualCommand = null,
  docsUrl = null
}: {
  ok: boolean;
  action: AddModelsProviderActionResult["action"];
  provider: AddModelsProviderId;
  message: string;
  snapshot?: MissionControlSnapshot;
  connection: AddModelsProviderConnectionStatus;
  models: AddModelsCatalogModel[];
  emptyState?: AddModelsEmptyState | null;
  manualCommand?: string | null;
  docsUrl?: string | null;
}): AddModelsProviderActionResult {
  return {
    ok,
    action,
    provider,
    message,
    connection,
    models,
    emptyState,
    manualCommand,
    docsUrl,
    snapshot
  };
}

async function readProviderConnectionContext(provider: AddModelsProviderId) {
  const [configuredModelIds, modelStatus] = await Promise.all([
    readOpenClawConfiguredModelIds(),
    readOpenClawProviderModelStatus()
  ]);

  if (provider === "ollama") {
    const ollamaState = await readOllamaState();

    return {
      connection: buildOllamaConnectionStatus(ollamaState),
      configuredModelIds,
      ollamaState
    };
  }

  return {
    connection:
      buildModelStatusConnectionStatus(provider, modelStatus, configuredModelIds) ??
      await buildOpenClawFileBasedProviderConnectionStatus(provider, configuredModelIds),
    configuredModelIds,
    ollamaState: null
  };
}

function buildOllamaConnectionStatus(ollamaState: OllamaState): AddModelsProviderConnectionStatus {
  return {
    provider: "ollama",
    connected: Boolean(ollamaState.installed),
    canConnect: true,
    needsTerminal: false,
    detail: !ollamaState.installed
      ? "Ollama is not installed on this machine."
      : ollamaState.models.length > 0
        ? `${ollamaState.models.length} local model${ollamaState.models.length === 1 ? "" : "s"} detected.`
        : "Ollama is installed, but no local models were found yet."
  };
}

function resolveProviderStatusMessage(
  provider: AddModelsProviderId,
  connection: AddModelsProviderConnectionStatus
) {
  if (provider === "ollama" && !connection.connected) {
    return "Ollama is not available on this machine yet.";
  }

  if (connection.connected) {
    return connection.detail || `${getModelProviderDescriptor(provider).shortLabel} is ready to use.`;
  }

  return `Connect ${getModelProviderDescriptor(provider).shortLabel} to start discovering models.`;
}

async function clearConnectedProviderWarnings(
  provider: AddModelsProviderId,
  connection: AddModelsProviderConnectionStatus
) {
  if (
    provider === "openai-codex" &&
    connection.connected &&
    await clearOpenAiCodexAuthRuntimeSmokeFailures()
  ) {
    clearMissionControlCaches();
  }
}

function resolveOllamaEmptyState(ollamaState: OllamaState | null): AddModelsEmptyState | null {
  if (!ollamaState) {
    return null;
  }

  if (!ollamaState.installed) {
    return {
      kind: "ollama-missing",
      title: "Ollama not found",
      description: "Install Ollama locally, then return here and retry discovery.",
      commands: ["brew install ollama", "ollama serve"]
    };
  }

  if (ollamaState.models.length === 0) {
    return {
      kind: "ollama-empty",
      title: "No local models yet",
      description: "Ollama is running, but there are no pulled models on this machine yet.",
      commands: ["ollama pull qwen3.5:9b", "ollama pull llama3:8b", "ollama list"]
    };
  }

  return null;
}

async function readOllamaState(): Promise<OllamaState> {
  try {
    const models = await readProviderCatalog("ollama", new Set());

    return {
      installed: true,
      models: models
        .map((model) => (model.id.startsWith("ollama/") ? model.id.slice("ollama/".length) : model.id))
        .filter((modelName) => modelName.length > 0)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (/ollama/i.test(message) && (/spawn/i.test(message) || /not found/i.test(message) || /enoent/i.test(message))) {
      return {
        installed: false,
        models: []
      };
    }

    return {
      installed: true,
      models: []
    };
  }
}

function normalizeModelIdForProvider(provider: AddModelsProviderId, modelId: string) {
  if (provider === "openai-codex" && modelId.startsWith("openai-codex/")) {
    return `openai/${modelId.slice("openai-codex/".length)}`;
  }

  return modelId;
}

function validateApiKey(provider: AddModelsProviderId, token: string) {
  const expectedPattern = providerTokenRules[provider];

  if (token.length < 8) {
    throw new Error("That API key looks too short.");
  }

  if (expectedPattern && !expectedPattern.test(token)) {
    if (provider === "openrouter") {
      throw new Error("OpenRouter keys usually start with sk-or-.");
    }

    if (provider === "openai") {
      throw new Error("OpenAI API keys usually start with sk-.");
    }

    if (provider === "anthropic") {
      throw new Error("Anthropic keys usually start with sk-ant-.");
    }
  }
}

function resolveProviderFromModelId(modelId: string) {
  return modelId.split("/")[0] as AddModelsProviderId;
}

function modelMatchesProvider(provider: AddModelsProviderId, modelId: string) {
  const modelProvider = resolveProviderFromModelId(modelId);

  if (provider === "openai-codex") {
    return modelProvider === "openai" || modelProvider === "openai-codex";
  }

  return modelProvider === provider && isAddModelsProviderId(modelProvider);
}

function isRecommendedModel(provider: AddModelsProviderId, modelId: string) {
  const normalized = modelId.toLowerCase();

  if (provider === "openrouter") {
    return /gpt-5|claude-sonnet|gemini-2\.5|gemini-3|qwen3-coder|codestral|openrouter\/auto/.test(normalized);
  }

  if (provider === "openai-codex") {
    return /openai\/gpt-5\.5|openai\/gpt-5\.4-mini|codex/.test(normalized);
  }

  if (provider === "ollama") {
    return /qwen|llama3/.test(normalized);
  }

  if (provider === "anthropic") {
    return /claude-sonnet|claude-opus/.test(normalized);
  }

  if (provider === "openai") {
    return /gpt-5|o3|o4/.test(normalized);
  }

  if (provider === "xai") {
    return /grok-4|grok-code/.test(normalized);
  }

  if (provider === "google") {
    return /gemini-2\.|gemini-3/.test(normalized);
  }

  if (provider === "deepseek") {
    return /deepseek-(chat|reasoner|coder|r1|v3)/.test(normalized);
  }

  if (provider === "mistral") {
    return /mistral-(large|small|medium|tiny)|codestral|pixtral|ministral/.test(normalized);
  }

  return false;
}
