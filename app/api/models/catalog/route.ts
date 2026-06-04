import { NextResponse } from "next/server";
import { z } from "zod";

import { listOpenClawModels } from "@/lib/openclaw/application/catalog-service";
import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { buildModelRecords } from "@/lib/openclaw/adapter/model-adapter";
import { addOpenClawModelsToConfig } from "@/lib/openclaw/application/model-provider-state-service";
import { normalizeOpenAiCodexModelId } from "@/lib/openclaw/domains/model-provider-connection";
import {
  isGatewayAuthSetupRecoveryError,
  runWithGatewayAuthSetupRecovery
} from "@/lib/openclaw/model-setup-recovery";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import type { AddModelsCatalogModel, MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { ModelsPayload, ModelsStatusPayload } from "@/lib/openclaw/client/gateway-client";
import type { AddModelsProviderId } from "@/lib/openclaw/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GlobalCatalogModel = Omit<AddModelsCatalogModel, "alreadyAdded">;
const catalogAddSchema = z.object({
  provider: z.string().trim().min(1),
  modelIds: z.array(z.string().trim().min(1)).min(1)
});

export async function GET() {
  try {
    const models = await readGlobalCatalog();
    return NextResponse.json(redactSecrets({ models }), { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "OpenClaw catalog could not be loaded.")
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  let input: z.infer<typeof catalogAddSchema>;

  try {
    input = catalogAddSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Catalog model selection is required.")
      },
      { status: 400 }
    );
  }

  try {
    const provider = normalizeCatalogProvider(input.provider);
    const modelIds = input.modelIds.map((modelId) => normalizeCatalogModelId(provider, modelId));

    const addResult = await runWithGatewayAuthSetupRecovery(
      () => addCatalogModelsToConfig(provider, modelIds),
      {
        operationLabel: "adding catalog models"
      }
    );

    const snapshot = await getMissionControlSnapshot({ force: true });

    return NextResponse.json(
      {
        ok: true,
        provider,
        message: addResult.repaired
          ? `Gateway auth was repaired and ${modelIds.length} model${modelIds.length === 1 ? " was" : "s were"} added to AgentOS.`
          : `Added ${modelIds.length} model${modelIds.length === 1 ? "" : "s"} to AgentOS.`,
        snapshot: redactSecrets(snapshot)
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: isGatewayAuthSetupRecoveryError(error)
          ? error.message
          : redactErrorMessage(error, "Catalog models could not be added.")
      },
      { status: 500 }
    );
  }
}

async function readGlobalCatalog(): Promise<GlobalCatalogModel[]> {
  try {
    const [payload, modelStatus] = await Promise.all([
      listOpenClawModels({ all: true }),
      readModelStatus()
    ]);
    return normalizeCatalogModels(payload.models, modelStatus);
  } catch {
    const snapshot = await getMissionControlSnapshot();
    return normalizeSnapshotModels(snapshot);
  }
}

async function readModelStatus(): Promise<ModelsStatusPayload | null> {
  try {
    return await getOpenClawAdapter().getModelStatus({ timeoutMs: 8_000 });
  } catch {
    return null;
  }
}

function normalizeCatalogModels(
  models: ModelsPayload["models"],
  modelStatus: ModelsStatusPayload | null
): GlobalCatalogModel[] {
  return buildModelRecords(models || [], [], modelStatus ?? undefined).map((model) => ({
    id: model.id,
    name: model.name,
    provider: model.provider,
    input: model.input,
    contextWindow: model.contextWindow ?? null,
    local: Boolean(model.local),
    available: model.available !== false,
    missing: Boolean(model.missing),
    recommended: isRecommendedModel(model.provider, model.id),
    supportsTools: model.input.includes("text"),
    isFree: /:free$/i.test(model.id) || /\(free\)/i.test(model.name),
    tags: Array.isArray(model.tags) ? model.tags : []
  }));
}

function normalizeSnapshotModels(
  snapshot: MissionControlSnapshot
): GlobalCatalogModel[] {
  return snapshot.models
    .map((model) => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      input: model.input,
      contextWindow: model.contextWindow,
      local: Boolean(model.local),
      available: model.available !== false,
      missing: Boolean(model.missing),
      recommended: isRecommendedModel(model.provider, model.id),
      supportsTools: model.input.includes("text"),
      isFree: /:free$/i.test(model.id) || /\(free\)/i.test(model.name),
      tags: Array.isArray(model.tags) ? model.tags : []
    }));
}

async function addCatalogModelsToConfig(provider: string, normalizedModelIds: string[]) {
  await addOpenClawModelsToConfig(normalizeCatalogProvider(provider), normalizedModelIds);
}

function normalizeCatalogProvider(provider: string): AddModelsProviderId {
  const normalized = provider.trim().toLowerCase();

  if (normalized === "gemini") {
    return "google";
  }

  if (isAddModelsProviderId(normalized)) {
    return normalized;
  }

  throw new Error(`Unsupported OpenClaw model provider: ${provider}`);
}

function normalizeCatalogModelId(provider: AddModelsProviderId, modelId: string) {
  if (provider === "openai-codex") {
    return normalizeOpenAiCodexModelId(modelId);
  }

  if (modelId.startsWith("gemini/")) {
    return `google/${modelId.slice("gemini/".length)}`;
  }

  return modelId;
}

function isAddModelsProviderId(value: string): value is AddModelsProviderId {
  return [
    "openai-codex",
    "openrouter",
    "ollama",
    "openai",
    "anthropic",
    "xai",
    "google",
    "deepseek",
    "mistral"
  ].includes(value);
}

function isRecommendedModel(provider: string, modelId: string) {
  const normalized = modelId.toLowerCase();

  if (provider === "openrouter") {
    return /gpt-5|claude-sonnet|gemini-2\.5|gemini-3|qwen3-coder|codestral|openrouter\/auto/.test(normalized);
  }

  if (provider === "openai-codex") {
    return /gpt-5\.4|gpt-5\.3-codex|codex/.test(normalized);
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
