import { spawn } from "node:child_process";

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
  isOpenAiCodexProviderPluginMissing,
  isOpenAiCodexDiscoveryTimeout,
  resolveOpenAiCodexAuthRecoveryMessage,
  buildOpenAiCodexAuthRepairCommand,
  resolveOpenAiCodexAuthHandoff,
  resolveOpenAiCodexProviderPluginRecoveryMessage
} from "@/lib/openclaw/model-auth-errors";
import {
  clearOpenAiCodexAuthRuntimeSmokeFailures,
  getLatestOpenAiCodexAuthRuntimeSmokeFailure,
  readMissionControlSettings
} from "@/lib/openclaw/domains/control-plane-settings";
import {
  buildModelStatusConnectionStatus,
  isKnownOpenAiCodexModelId,
  normalizeOpenAiCodexModelId
} from "@/lib/openclaw/domains/model-provider-connection";
import {
  mergeOllamaCatalogModels,
  parseOllamaListModelNames
} from "@/lib/openclaw/domains/model-provider-catalog";
import { clearMissionControlCaches, getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import {
  addOpenClawModelsToConfig,
  buildOpenClawFileBasedProviderConnectionStatus,
  readOpenClawCodexPluginReady,
  persistOpenClawProviderToken,
  readOpenClawConfiguredModelIds,
  readOpenClawProviderModelStatus,
  setOpenClawDefaultModel
} from "@/lib/openclaw/application/model-provider-state-service";
import {
  isGatewayAuthSetupRecoveryError,
  runWithGatewayAuthSetupRecovery
} from "@/lib/openclaw/model-setup-recovery";
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
import { redactErrorMessage, redactSecretText, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addModelsDocsUrl = "https://docs.openclaw.ai/cli/models";
const codexDiscoveryTimeoutMs = 15_000;
const ollamaListTimeoutMs = 5_000;
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
    provider: providerIdSchema,
    includeSnapshot: z.boolean().optional()
  }),
  z.object({
    action: z.literal("connect"),
    provider: providerIdSchema,
    apiKey: optionalInputString,
    endpoint: optionalInputString,
    force: z.boolean().optional()
  }),
  z.object({
    action: z.literal("discover"),
    provider: providerIdSchema
  }),
  z.object({
    action: z.literal("add-models"),
    provider: providerIdSchema,
    modelIds: z.array(z.string().trim().min(1)).min(1)
  }),
  z.object({
    action: z.literal("set-default"),
    provider: providerIdSchema,
    modelId: z.string().trim().min(1)
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
        error: redactErrorMessage(error, "Model provider action is required.")
      },
      { status: 400 }
    );
  }

  try {
    const result = await handleProviderAction(input);
    return NextResponse.json(redactSecrets(result), { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Add Models request failed.")
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
    const snapshot = input.includeSnapshot && statusContext.connection.connected
      ? await getMissionControlSnapshot({ force: true }).catch(() => undefined)
      : undefined;

    return buildActionResult({
      ok: true,
      action: input.action,
      provider: input.provider,
      message: resolveProviderStatusMessage(input.provider, statusContext.connection),
      snapshot,
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

      if (statusContext.connection.connected) {
        return buildActionResult({
          ok: true,
          action: input.action,
          provider: input.provider,
          message: "Codex app-server is already connected. Discover models to refresh the catalog.",
          connection: statusContext.connection,
          models: [],
          manualCommand: null,
          docsUrl: addModelsDocsUrl
        });
      }

      const codexPluginReady = await readOpenClawCodexPluginReady().catch(() => false);
      const authHandoff = resolveOpenAiCodexAuthHandoff(commandBin, codexPluginReady, {
        force: input.force === true
      });

      return buildActionResult({
        ok: true,
        action: input.action,
        provider: input.provider,
        message: authHandoff.continueMessage,
        connection: statusContext.connection,
        models: [],
        manualCommand: authHandoff.command,
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
    try {
      await persistOpenClawProviderToken(input.provider, apiKey);
    } catch (error) {
      const statusContext = await readProviderConnectionContext(input.provider);

      return buildActionResult({
        ok: false,
        action: input.action,
        provider: input.provider,
        message: readProviderActionError(error),
        connection: statusContext.connection,
        models: [],
        docsUrl: addModelsDocsUrl
      });
    }

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

  if (input.action === "set-default") {
    return setProviderDefaultModel(input.provider, input.modelId, commandBin);
  }

  let repairedGatewayAuth = false;

  try {
    const result = await runWithGatewayAuthSetupRecovery(
      () => addOpenClawModelsToConfig(input.provider, input.modelIds),
      {
        operationLabel: "adding models"
      }
    );
    repairedGatewayAuth = Boolean(result.repaired);
  } catch (error) {
    const statusContext = await readProviderConnectionContext(input.provider);
    const providerModels = await readProviderCatalog(input.provider, statusContext.configuredModelIds, commandBin)
      .catch(() => []);

    return buildActionResult({
      ok: false,
      action: input.action,
      provider: input.provider,
      message: readProviderActionError(error),
      connection: statusContext.connection,
      models: providerModels,
      manualCommand: isGatewayAuthSetupRecoveryError(error)
        ? formatOpenClawCommand(commandBin, ["gateway", "status", "--json"])
        : null,
      docsUrl: addModelsDocsUrl
    });
  }

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
    message: repairedGatewayAuth
      ? `Gateway auth was repaired and ${input.modelIds.length} model${input.modelIds.length === 1 ? " was" : "s were"} added to AgentOS.`
      : `Added ${input.modelIds.length} model${input.modelIds.length === 1 ? "" : "s"} to AgentOS.`,
    snapshot: refreshedSnapshot,
    connection: statusContext.connection,
    models: providerModels,
    docsUrl: addModelsDocsUrl
  });
}

async function setProviderDefaultModel(
  provider: AddModelsProviderId,
  modelId: string,
  commandBin = "openclaw"
): Promise<AddModelsProviderActionResult> {
  if (!modelIdMatchesProviderRequest(provider, modelId)) {
    const statusContext = await readProviderConnectionContext(provider);

    return buildActionResult({
      ok: false,
      action: "set-default",
      provider,
      message: `${getModelProviderDescriptor(provider).shortLabel} cannot set ${modelId} as its default model.`,
      connection: statusContext.connection,
      models: [],
      docsUrl: addModelsDocsUrl
    });
  }

  let repairedGatewayAuth = false;
  let savedDefault: Awaited<ReturnType<typeof setOpenClawDefaultModel>>;

  try {
    const result = await runWithGatewayAuthSetupRecovery(
      () => setOpenClawDefaultModel(modelId, { provider }),
      {
        operationLabel: "setting the default model"
      }
    );
    repairedGatewayAuth = Boolean(result.repaired);
    savedDefault = result.value;
  } catch (error) {
    const statusContext = await readProviderConnectionContext(provider);
    const providerModels = await readProviderCatalog(provider, statusContext.configuredModelIds, commandBin)
      .catch(() => []);

    return buildActionResult({
      ok: false,
      action: "set-default",
      provider,
      message: readProviderActionError(error),
      connection: statusContext.connection,
      models: providerModels,
      manualCommand: isGatewayAuthSetupRecoveryError(error)
        ? formatOpenClawCommand(commandBin, ["gateway", "status", "--json"])
        : null,
      docsUrl: addModelsDocsUrl
    });
  }

  if (provider === "openai-codex" && await clearOpenAiCodexAuthRuntimeSmokeFailures()) {
    clearMissionControlCaches();
  }
  const refreshedSnapshot = await getMissionControlSnapshot({ force: true });
  const statusContext = await readProviderConnectionContext(provider);
  const providerModels = await readProviderCatalog(provider, statusContext.configuredModelIds, commandBin);

  return buildActionResult({
    ok: true,
    action: "set-default",
    provider,
    message: repairedGatewayAuth
      ? `Gateway auth was repaired and ${savedDefault.modelId} was saved as the default model.`
      : `${savedDefault.modelId} was saved as the default model.`,
    snapshot: refreshedSnapshot,
    connection: statusContext.connection,
    models: providerModels,
    docsUrl: addModelsDocsUrl,
    defaultModel: {
      id: savedDefault.modelId,
      provider: savedDefault.provider ?? provider,
      via: savedDefault.via
    }
  });
}

async function discoverProviderModels(
  provider: AddModelsProviderId,
  commandBin = "openclaw"
): Promise<AddModelsProviderActionResult> {
  const { connection, ollamaState, configuredModelIds } = await readProviderConnectionContext(provider);
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
      const providerModels = normalizeCatalogModels(provider, providerPayload.models, configuredModelIds)
        .filter((model) => isKnownOpenAiCodexModelId(model.id) || model.tags.some(isCodexModelTag));

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
    return provider === "ollama"
      ? mergeOllamaCatalogModels(providerModels, await readLocalOllamaCatalog(configuredModelIds))
      : providerModels;
  }

  const globalPayload = await readProviderModelPayload(provider, { all: true }, commandBin);
  const globalModels = normalizeCatalogModels(provider, globalPayload.models, configuredModelIds);

  if (globalModels.length > 0) {
    return provider === "ollama"
      ? mergeOllamaCatalogModels(globalModels, await readLocalOllamaCatalog(configuredModelIds))
      : globalModels;
  }

  if (provider === "ollama") {
    return readLocalOllamaCatalog(configuredModelIds);
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
    isOpenAiCodexProviderPluginMissing(message)
  ) {
    const command = buildOpenAiCodexAuthRepairCommand(commandBin);

    return new ProviderAuthActionError(
      resolveOpenAiCodexProviderPluginRecoveryMessage(command),
      command
    );
  }

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
    return redactSecretText(error.message);
  }

  if (error && typeof error === "object") {
    const stdout = "stdout" in error && typeof error.stdout === "string" ? error.stdout : "";
    const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    return redactSecretText([message, stdout, stderr].filter(Boolean).join("\n"));
  }

  return redactSecretText(String(error || ""));
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
  docsUrl = null,
  defaultModel
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
  defaultModel?: AddModelsProviderActionResult["defaultModel"];
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
    defaultModel,
    snapshot
  };
}

function readProviderActionError(error: unknown) {
  if (isGatewayAuthSetupRecoveryError(error)) {
    return error.message;
  }

  return redactErrorMessage(error, "Model provider action failed.");
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
    connection: await applyProviderRuntimeFailure(
      provider,
      buildModelStatusConnectionStatus(provider, modelStatus, configuredModelIds) ??
        await buildOpenClawFileBasedProviderConnectionStatus(provider, configuredModelIds)
    ),
    configuredModelIds,
    ollamaState: null
  };
}

async function applyProviderRuntimeFailure(
  provider: AddModelsProviderId,
  connection: AddModelsProviderConnectionStatus
) {
  if (provider !== "openai-codex") {
    return connection;
  }

  if (connection.connected) {
    if (await clearOpenAiCodexAuthRuntimeSmokeFailures()) {
      clearMissionControlCaches();
    }

    return connection;
  }

  const settings = await readMissionControlSettings().catch(() => ({}));
  const authFailure = getLatestOpenAiCodexAuthRuntimeSmokeFailure(settings);

  if (!authFailure) {
    return connection;
  }

  return {
    ...connection,
    connected: false,
    detail:
      authFailure.error ||
      "Reconnect ChatGPT to refresh the OpenAI Codex OAuth session."
  };
}

function buildOllamaConnectionStatus(ollamaState: OllamaState): AddModelsProviderConnectionStatus {
  return {
    provider: "ollama",
    connected: Boolean(ollamaState.installed && ollamaState.models.length > 0),
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
    return connection.detail || "Ollama is not available on this machine yet.";
  }

  if (connection.connected) {
    return connection.detail || `${getModelProviderDescriptor(provider).shortLabel} is ready to use.`;
  }

  return `Connect ${getModelProviderDescriptor(provider).shortLabel} to start discovering models.`;
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
    const message = error instanceof Error ? redactSecretText(error.message) : "";

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

async function readLocalOllamaCatalog(configuredModelIds: Set<string>): Promise<AddModelsCatalogModel[]> {
  const local = await readLocalOllamaModels();

  if (!local.installed) {
    return [];
  }

  return local.models.map((modelName) => {
    const modelId = `ollama/${modelName}`;

    return {
      id: modelId,
      name: modelName,
      provider: "ollama",
      input: "text",
      contextWindow: null,
      local: true,
      available: true,
      missing: false,
      alreadyAdded: configuredModelIds.has(modelId),
      recommended: isRecommendedModel("ollama", modelId),
      supportsTools: true,
      isFree: false,
      tags: ["local-ollama"]
    };
  });
}

async function readLocalOllamaModels(): Promise<OllamaState> {
  const output = await runLocalOllamaList().catch((error) => {
    const message = error instanceof Error ? error.message : String(error || "");

    if (/spawn|not found|enoent/i.test(message)) {
      return null;
    }

    return "";
  });

  if (output === null) {
    return {
      installed: false,
      models: []
    };
  }

  return {
    installed: true,
    models: parseOllamaListModelNames(output)
  };
}

function runLocalOllamaList() {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("ollama", ["list"], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = globalThis.setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out while running ollama list."));
    }, ollamaListTimeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      globalThis.clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      globalThis.clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(stderr.trim() || `ollama list exited with code ${code ?? "unknown"}.`));
    });
  });
}

function normalizeModelIdForProvider(provider: AddModelsProviderId, modelId: string) {
  if (provider === "openai-codex") {
    return normalizeOpenAiCodexModelId(modelId);
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
  return modelId.split("/")[0] ?? "";
}

function modelMatchesProvider(provider: AddModelsProviderId, modelId: string) {
  const modelProvider = resolveProviderFromModelId(modelId);

  if (provider === "openai-codex") {
    return modelProvider === "codex" ||
      modelProvider === "openai-codex" ||
      isKnownOpenAiCodexModelId(modelId);
  }

  return modelProvider === provider && isAddModelsProviderId(modelProvider);
}

function modelIdMatchesProviderRequest(provider: AddModelsProviderId, modelId: string) {
  if (!modelId.includes("/")) {
    return true;
  }

  return modelMatchesProvider(provider, modelId);
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

function isCodexModelTag(tag: string) {
  return /^(codex|openai-codex|chatgpt|app-server|codex-app-server)$/i.test(tag.trim());
}
