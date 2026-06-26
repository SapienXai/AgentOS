import { spawn } from "node:child_process";

import { NextResponse } from "next/server";
import { z } from "zod";

import {
  formatModelProviderLabel,
  getModelProviderDescriptor,
  isAddModelsProviderId,
  isBuiltInAddModelsProviderId
} from "@/lib/openclaw/model-provider-registry";
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
  addOpenClawExplicitProviderModelsToConfig,
  buildOpenClawFileBasedProviderConnectionStatus,
  readOpenClawCodexPluginReady,
  readOpenClawExplicitProviderConfig,
  persistOpenClawExplicitProviderConfig,
  readOpenClawOpenAiProviderConfig,
  persistOpenClawOpenAiProviderConfig,
  persistOpenClawProviderToken,
  readOpenClawConfiguredModelIds,
  readOpenClawExplicitProviderSummaries,
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
  ModelsStatusPayload,
  OpenClawModelScanPayload as OpenClawModelScanPayloadFromClient
} from "@/lib/openclaw/client/gateway-client";
import type {
  OpenClawProviderModelEntry,
  OpenClawProviderModelsEntry
} from "@/lib/openclaw/application/model-provider-state-service";
import { redactErrorMessage, redactSecretText, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addModelsDocsUrl = "https://docs.openclaw.ai/cli/models";
const codexDiscoveryTimeoutMs = 15_000;
const ollamaListTimeoutMs = 5_000;
const explicitProviderIdSchema = z.string().trim().min(2).max(63).refine(
  (value) => isAddModelsProviderId(value),
  "Provider ID must use lowercase letters, numbers, hyphen, or underscore."
);
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
    provider: explicitProviderIdSchema,
    includeSnapshot: z.boolean().optional()
  }),
  z.object({
    action: z.literal("connect"),
    provider: explicitProviderIdSchema,
    providerName: optionalInputString,
    apiKey: optionalInputString,
    endpoint: optionalInputString,
    modelId: optionalInputString,
    force: z.boolean().optional()
  }),
  z.object({
    action: z.literal("switch-account"),
    provider: explicitProviderIdSchema
  }),
  z.object({
    action: z.literal("discover"),
    provider: explicitProviderIdSchema
  }),
  z.object({
    action: z.literal("add-models"),
    provider: explicitProviderIdSchema,
    modelIds: z.array(z.string().trim().min(1)).min(1)
  }),
  z.object({
    action: z.literal("set-default"),
    provider: explicitProviderIdSchema,
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

export async function GET() {
  try {
    const providers = await readOpenClawExplicitProviderSummaries();

    return NextResponse.json(redactSecrets({ providers }), { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Model providers could not be loaded.")
      },
      { status: 500 }
    );
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
    if (!isBuiltInAddModelsProviderId(input.provider)) {
      return connectExplicitProvider(input);
    }

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
      if (input.provider === "openai") {
        await persistOpenClawOpenAiProviderConfig(apiKey, {
          endpoint: input.endpoint
        });
      } else {
        await persistOpenClawProviderToken(input.provider, apiKey, {
          endpoint: input.endpoint
        });
      }
    } catch (error) {
      const statusContext = await readProviderConnectionContext(input.provider);
      const tokenHandoff = resolveProviderTokenAuthHandoff(input.provider, commandBin, error);

      if (tokenHandoff) {
        return buildActionResult({
          ok: true,
          action: input.action,
          provider: input.provider,
          message: tokenHandoff.continueMessage,
          connection: statusContext.connection,
          models: [],
          manualCommand: tokenHandoff.command,
          docsUrl: addModelsDocsUrl
        });
      }

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
    const connectedLabel =
      input.provider === "openai" && input.endpoint
        ? "custom OpenAI-compatible endpoint"
        : getModelProviderDescriptor(input.provider).shortLabel;

    return buildActionResult({
      ok: true,
      action: input.action,
      provider: input.provider,
      message: `Connected ${connectedLabel}. Discovering available models is next.`,
      snapshot,
      connection: statusContext.connection,
      models: [],
      docsUrl: addModelsDocsUrl
    });
  }

  if (input.action === "switch-account") {
    const statusContext = await readProviderConnectionContext(input.provider);

    if (input.provider !== "openai-codex") {
      return buildActionResult({
        ok: false,
        action: input.action,
        provider: input.provider,
        message: `${getModelProviderDescriptor(input.provider).shortLabel} account switching is not available in OpenClaw yet.`,
        connection: statusContext.connection,
        models: [],
        docsUrl: addModelsDocsUrl
      });
    }

    const codexPluginReady = await readOpenClawCodexPluginReady().catch(() => false);
    const authHandoff = resolveOpenAiCodexAuthHandoff(commandBin, codexPluginReady, {
      force: true,
      intent: "switch-account"
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

  if (input.action === "discover") {
    if (!isBuiltInAddModelsProviderId(input.provider)) {
      return discoverExplicitProviderModels(input.provider);
    }

    return discoverProviderModels(input.provider, commandBin);
  }

  if (input.action === "set-default") {
    return setProviderDefaultModel(input.provider, input.modelId, commandBin);
  }

  let repairedGatewayAuth = false;

  if (!isBuiltInAddModelsProviderId(input.provider)) {
    return addExplicitProviderModels(input.provider, input.modelIds);
  }

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

async function connectExplicitProvider(
  input: Extract<AddModelsProviderActionRequest, { action: "connect" }>
): Promise<AddModelsProviderActionResult> {
  const providerName = input.providerName?.trim() || getModelProviderDescriptor(input.provider).label;
  const baseUrl = input.endpoint?.trim();
  const apiKey = input.apiKey?.trim();
  const manualModelId = input.modelId?.trim();

  if (!baseUrl || !apiKey) {
    const statusContext = await readProviderConnectionContext(input.provider);

    return buildActionResult({
      ok: false,
      action: input.action,
      provider: input.provider,
      message: "Enter a base URL and API key to continue.",
      connection: statusContext.connection,
      models: [],
      docsUrl: addModelsDocsUrl
    });
  }

  const discoveredModels = await discoverOpenAiCompatibleEndpointModels(baseUrl, apiKey).catch(() => []);
  const manualModels = manualModelId ? [toExplicitProviderModelEntry(manualModelId)] : [];

  await persistOpenClawExplicitProviderConfig(input.provider, {
    providerName,
    baseUrl,
    apiKey,
    api: "openai-completions",
    models: [...manualModels, ...discoveredModels]
  });

  const snapshot = await getMissionControlSnapshot({ force: true }).catch(() => undefined);
  const statusContext = await readProviderConnectionContext(input.provider);
  const models = await readExplicitProviderCatalog(input.provider, statusContext.configuredModelIds);

  return buildActionResult({
    ok: true,
    action: input.action,
    provider: input.provider,
    message: `Connected ${providerName}. ${models.length > 0 ? "Select models to add next." : "Discovery returned no models; add a model ID manually."}`,
    snapshot,
    connection: statusContext.connection,
    models,
    emptyState: models.length === 0
      ? {
          kind: "no-models",
          title: "No models found",
          description: "The endpoint is configured, but model discovery did not return selectable models. Enter a model ID manually and reconnect."
        }
      : null,
    docsUrl: addModelsDocsUrl
  });
}

async function discoverExplicitProviderModels(
  provider: AddModelsProviderId
): Promise<AddModelsProviderActionResult> {
  const statusContext = await readProviderConnectionContext(provider);
  const models = await readExplicitProviderCatalog(provider, statusContext.configuredModelIds);

  return buildActionResult({
    ok: true,
    action: "discover",
    provider,
    message: models.length > 0
      ? `Found ${models.length} configured model${models.length === 1 ? "" : "s"}.`
      : "No models were returned for this provider.",
    connection: statusContext.connection,
    models,
    emptyState:
      models.length === 0
        ? {
            kind: "no-models",
            title: "No models found",
            description: "This provider is configured, but no model metadata is stored yet. Enter a model ID manually."
          }
        : null,
    docsUrl: addModelsDocsUrl
  });
}

async function addExplicitProviderModels(
  provider: AddModelsProviderId,
  modelIds: string[]
): Promise<AddModelsProviderActionResult> {
  const statusContext = await readProviderConnectionContext(provider);
  const catalogModels = await readExplicitProviderCatalog(provider, statusContext.configuredModelIds);
  const catalogById = new Map(catalogModels.map((model) => [model.id, model] as const));
  const metadata = modelIds
    .map((modelId) => catalogById.get(modelId))
    .filter((model): model is AddModelsCatalogModel => Boolean(model))
    .map((model) => {
      const metadata: OpenClawProviderModelEntry = {
        id: model.id.startsWith(`${provider}/`) ? model.id.slice(`${provider}/`.length) : model.id,
        name: model.name,
        input: model.input
      };

      if (typeof model.contextWindow === "number") {
        metadata.contextWindow = model.contextWindow;
      }

      return metadata;
    });

  await addOpenClawExplicitProviderModelsToConfig(provider, modelIds, metadata);

  const refreshedSnapshot = await getMissionControlSnapshot({ force: true }).catch(() => undefined);
  const refreshedStatus = await readProviderConnectionContext(provider);
  const refreshedModels = await readExplicitProviderCatalog(provider, refreshedStatus.configuredModelIds);

  return buildActionResult({
    ok: true,
    action: "add-models",
    provider,
    message: `Added ${modelIds.length} model${modelIds.length === 1 ? "" : "s"} to AgentOS.`,
    snapshot: refreshedSnapshot,
    connection: refreshedStatus.connection,
    models: refreshedModels,
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
  const isCustomOpenAiEndpoint = provider === "openai" && isCustomOpenAiEndpointConnection(connection);
  let models: AddModelsCatalogModel[];
  let fallbackMessage: string | null = null;

  try {
    models = await readProviderCatalog(provider, configuredModelIds, commandBin, {
      preferScan: isCustomOpenAiEndpoint
    });
    if (isCustomOpenAiEndpoint) {
      models = models.filter((model) => !model.alreadyAdded);
    }
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
  commandBin = "openclaw",
  options: { preferScan?: boolean } = {}
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

  if (options.preferScan) {
    const scanPayload = await scanProviderModels(provider, commandBin);
    const scanModels = normalizeScanModels(provider, scanPayload, configuredModelIds);

    if (scanModels.length > 0) {
      return scanModels;
    }
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

async function readExplicitProviderCatalog(
  provider: AddModelsProviderId,
  configuredModelIds: Set<string>
): Promise<AddModelsCatalogModel[]> {
  const providerConfig = await readOpenClawExplicitProviderConfig(provider);
  const configuredModels = normalizeExplicitProviderCatalogModels(provider, providerConfig, configuredModelIds);

  if (configuredModels.length > 0) {
    return configuredModels;
  }

  const baseUrl = readProviderBaseUrl(providerConfig);
  const apiKey = readProviderApiKey(providerConfig);

  if (!baseUrl || !apiKey) {
    return [];
  }

  const discoveredModels = await discoverOpenAiCompatibleEndpointModels(baseUrl, apiKey).catch(() => []);

  if (discoveredModels.length === 0) {
    return [];
  }

  await persistOpenClawExplicitProviderConfig(provider, {
    providerName: readProviderName(providerConfig) ?? formatModelProviderLabel(provider),
    baseUrl,
    apiKey,
    api: "openai-completions",
    models: discoveredModels
  });

  const refreshedProviderConfig = await readOpenClawExplicitProviderConfig(provider);
  return normalizeExplicitProviderCatalogModels(provider, refreshedProviderConfig, configuredModelIds);
}

function normalizeExplicitProviderCatalogModels(
  provider: AddModelsProviderId,
  providerConfig: OpenClawProviderModelsEntry | null,
  configuredModelIds: Set<string>
): AddModelsCatalogModel[] {
  return (providerConfig?.models ?? [])
    .filter((model) => typeof model.id === "string" && model.id.trim())
    .map((model) => {
      const scopedId = `${provider}/${model.id?.trim()}`;
      const input = normalizeExplicitProviderInput(model.input);

      return {
        id: scopedId,
        name: model.name?.trim() || model.id?.trim() || scopedId,
        provider,
        input,
        contextWindow: typeof model.contextWindow === "number" ? model.contextWindow : null,
        local: false,
        available: true,
        missing: false,
        alreadyAdded: configuredModelIds.has(scopedId),
        recommended: false,
        supportsTools: input.includes("text"),
        isFree: false,
        tags: ["explicit-provider"]
      };
    });
}

async function discoverOpenAiCompatibleEndpointModels(baseUrl: string, apiKey: string) {
  const modelsUrl = `${baseUrl.replace(/\/$/, "")}/models`;
  const response = await fetch(modelsUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Model discovery failed with HTTP ${response.status}.`);
  }

  const payload = await response.json().catch(() => null) as
    | {
        data?: Array<Record<string, unknown>>;
      }
    | null;

  if (!Array.isArray(payload?.data)) {
    return [];
  }

  return payload.data
    .map((entry) => {
      const id = typeof entry.id === "string" ? entry.id.trim() : "";

      return id ? toExplicitProviderModelEntry(id) : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function toExplicitProviderModelEntry(modelId: string): OpenClawProviderModelEntry {
  return {
    id: modelId.trim(),
    name: modelId.trim()
  };
}

function normalizeExplicitProviderInput(input: OpenClawProviderModelEntry["input"]) {
  if (Array.isArray(input)) {
    const normalizedInput = input.map((entry) => entry.trim()).filter(Boolean).join(",");

    return normalizedInput || "text";
  }

  return typeof input === "string" && input.trim() ? input.trim() : "text";
}

function readProviderBaseUrl(providerConfig: OpenClawProviderModelsEntry | null) {
  const rawBaseUrl = providerConfig?.baseUrl ?? providerConfig?.baseURL;

  return typeof rawBaseUrl === "string" && rawBaseUrl.trim() ? rawBaseUrl.trim() : null;
}

function readProviderApiKey(providerConfig: OpenClawProviderModelsEntry | null) {
  const rawApiKey = providerConfig?.apiKey;

  return typeof rawApiKey === "string" && rawApiKey.trim() ? rawApiKey.trim() : null;
}

function readProviderName(providerConfig: OpenClawProviderModelsEntry | null) {
  const rawName = providerConfig?.label ?? providerConfig?.name;

  return typeof rawName === "string" && rawName.trim() ? rawName.trim() : null;
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

  if (!isBuiltInAddModelsProviderId(provider)) {
    return {
      connection: await buildExplicitProviderConnectionStatus(provider, configuredModelIds),
      configuredModelIds,
      ollamaState: null
    };
  }

  const fileBasedStatus = await buildOpenClawFileBasedProviderConnectionStatus(provider, configuredModelIds);

  return {
    connection: await applyProviderRuntimeFailure(
      provider,
      await resolveProviderConnectionStatus(provider, modelStatus, configuredModelIds, fileBasedStatus)
    ),
    configuredModelIds,
    ollamaState: null
  };
}

async function buildExplicitProviderConnectionStatus(
  provider: AddModelsProviderId,
  configuredModelIds: Set<string>
): Promise<AddModelsProviderConnectionStatus> {
  const providerConfig = await readOpenClawExplicitProviderConfig(provider);
  const baseUrl = readProviderBaseUrl(providerConfig);
  const apiKey = readProviderApiKey(providerConfig);
  const modelCount = providerConfig?.models?.length ?? 0;
  const configuredCount = [...configuredModelIds].filter((modelId) => modelMatchesProvider(provider, modelId)).length;

  return {
    provider,
    connected: Boolean(baseUrl && apiKey && (modelCount > 0 || configuredCount > 0)),
    canConnect: true,
    needsTerminal: false,
    source: "explicit-provider-config",
    detail: baseUrl
      ? `${configuredCount} configured model${configuredCount === 1 ? "" : "s"} in AgentOS. Endpoint: ${baseUrl}.`
      : "Configure this explicit OpenAI-compatible provider before discovery."
  };
}

async function resolveProviderConnectionStatus(
  provider: AddModelsProviderId,
  modelStatus: ModelsStatusPayload | null,
  configuredModelIds: Set<string>,
  fileBasedStatus: AddModelsProviderConnectionStatus
) {
  const openAiGatewayConfig = provider === "openai"
    ? await readOpenClawOpenAiProviderConfig()
    : null;
  const modelStatusConnection = buildModelStatusConnectionStatus(provider, modelStatus, configuredModelIds);
  const customOpenAiConnection = provider === "openai"
    ? buildCustomOpenAiEndpointConnectionStatus(openAiGatewayConfig, configuredModelIds)
    : null;

  if (customOpenAiConnection) {
    return customOpenAiConnection;
  }

  return modelStatusConnection ?? fileBasedStatus;
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

function isCustomOpenAiEndpointConnection(connection: AddModelsProviderConnectionStatus | null) {
  return Boolean(connection?.provider === "openai" && connection.detail?.includes("Custom endpoint:"));
}

function buildCustomOpenAiEndpointConnectionStatus(
  providerConfig: OpenClawProviderModelsEntry | null,
  configuredModelIds: Set<string>
): AddModelsProviderConnectionStatus | null {
  const customEndpoint = readOpenAiBaseUrlFromProviderConfig(providerConfig);

  if (!customEndpoint) {
    return null;
  }

  const configuredCount = [...configuredModelIds].filter((modelId) => modelMatchesProvider("openai", modelId)).length;
  const hasApiKey = Boolean(readOpenAiApiKeyFromProviderConfig(providerConfig));

  return {
    provider: "openai",
    connected: hasApiKey,
    canConnect: true,
    needsTerminal: false,
    detail: hasApiKey
      ? `${configuredCount} configured model${configuredCount === 1 ? "" : "s"} in AgentOS. Custom endpoint: ${customEndpoint}.`
      : `Custom endpoint: ${customEndpoint}. Connect OpenAI to use it.`
  };
}

function readOpenAiBaseUrlFromProviderConfig(providerConfig: OpenClawProviderModelsEntry | null) {
  const rawBaseUrl = providerConfig?.baseUrl ?? providerConfig?.baseURL;
  const trimmed = typeof rawBaseUrl === "string" ? rawBaseUrl.trim() : "";

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return trimmed;
  }
}

function readOpenAiApiKeyFromProviderConfig(providerConfig: OpenClawProviderModelsEntry | null) {
  const rawApiKey = providerConfig?.apiKey;

  return typeof rawApiKey === "string" && rawApiKey.trim() ? rawApiKey.trim() : null;
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

function resolveProviderTokenAuthHandoff(
  provider: AddModelsProviderId,
  commandBin: string,
  error: unknown
) {
  if (provider !== "openrouter" || !isProviderTokenPersistenceUnavailable(error)) {
    return null;
  }

  const label = getModelProviderDescriptor(provider).shortLabel;

  return {
    command: formatOpenClawCommand(commandBin, ["models", "auth", "paste-token", "--provider", "openrouter"]),
    continueMessage:
      `OpenClaw does not expose native ${label} token persistence to AgentOS yet. Continue in Terminal to paste your ${label} API key, then return here and refresh this provider.`
  };
}

function isProviderTokenPersistenceUnavailable(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");

  return /Gateway-native provider token persistence is not available yet/i.test(message) ||
    /Legacy OpenClaw provider file writes are disabled by default/i.test(message);
}
