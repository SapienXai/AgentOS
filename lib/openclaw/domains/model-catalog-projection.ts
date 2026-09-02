import type { AddModelsCatalogModel, ModelRecord } from "@/lib/agentos/contracts";
import {
  modelRecordIdentityKey,
  normalizeOpenAiModelId
} from "@/lib/openclaw/domains/model-provider-connection";

function identityKey(model: Pick<AddModelsCatalogModel, "id" | "provider">) {
  return modelRecordIdentityKey(model.id, model.provider);
}

function snapshotModelToCatalogModel(
  model: ModelRecord,
  recommendedModelIds: ReadonlySet<string>
): AddModelsCatalogModel {
  const normalizedId = normalizeOpenAiModelId(model.id);

  return {
    id: normalizedId,
    name: model.name,
    provider: model.provider,
    input: model.input,
    contextWindow: model.contextWindow,
    local: Boolean(model.local),
    available: model.available,
    missing: model.missing,
    alreadyAdded: true,
    recommended: recommendedModelIds.has(normalizedId.toLowerCase()),
    supportsTools: model.supportsTools ?? null,
    isFree: model.tags.includes("free") || /:free$/i.test(normalizedId) || /\(free\)/i.test(model.name),
    tags: model.tags
  };
}

function mergeCatalogModel(
  catalogModel: AddModelsCatalogModel,
  configuredModel: AddModelsCatalogModel
): AddModelsCatalogModel {
  return {
    ...catalogModel,
    id: configuredModel.id,
    contextWindow: configuredModel.contextWindow ?? catalogModel.contextWindow,
    local: configuredModel.local || catalogModel.local,
    available: configuredModel.available,
    missing: configuredModel.missing,
    alreadyAdded: catalogModel.alreadyAdded || configuredModel.alreadyAdded,
    recommended: catalogModel.recommended || configuredModel.recommended,
    supportsTools: mergeNativeBoolean(catalogModel.supportsTools, configuredModel.supportsTools),
    isFree: catalogModel.isFree || configuredModel.isFree,
    tags: Array.from(new Set([...catalogModel.tags, ...configuredModel.tags]))
  };
}

export function mergeCatalogWithConfiguredModels(
  catalogModels: AddModelsCatalogModel[],
  configuredModels: ModelRecord[],
  recommendedModelIds: Iterable<string> = []
) {
  const recommendedIds = new Set(
    Array.from(recommendedModelIds, (modelId) => normalizeOpenAiModelId(modelId).toLowerCase())
  );
  const records = new Map<string, AddModelsCatalogModel>(
    catalogModels.map((model) => [identityKey(model), { ...model, alreadyAdded: false }] as const)
  );

  for (const model of configuredModels) {
    const configuredModel = snapshotModelToCatalogModel(model, recommendedIds);
    const key = identityKey(configuredModel);
    const catalogModel = records.get(key);
    records.set(key, catalogModel ? mergeCatalogModel(catalogModel, configuredModel) : configuredModel);
  }

  return Array.from(records.values());
}

export function enrichCatalogModels(
  models: AddModelsCatalogModel[],
  catalogModels: AddModelsCatalogModel[]
) {
  const catalogByIdentity = new Map(catalogModels.map((model) => [identityKey(model), model] as const));

  return models.map((model) => {
    const catalogModel = catalogByIdentity.get(identityKey(model));

    if (!catalogModel) {
      return model;
    }

    return {
      ...model,
      name: catalogModel.name,
      input: catalogModel.input,
      contextWindow: catalogModel.contextWindow ?? model.contextWindow,
      local: catalogModel.local,
      recommended: catalogModel.recommended || model.recommended,
      supportsTools: mergeNativeBoolean(catalogModel.supportsTools, model.supportsTools),
      isFree: catalogModel.isFree || model.isFree,
      tags: Array.from(new Set([...catalogModel.tags, ...model.tags]))
    };
  });
}

function mergeNativeBoolean(left: boolean | null, right: boolean | null): boolean | null {
  if (left === true || right === true) return true;
  if (left === false || right === false) return false;
  return null;
}

export function markConfiguredCatalogModels(
  models: Omit<AddModelsCatalogModel, "alreadyAdded">[],
  configuredModelIds: Iterable<string>
): AddModelsCatalogModel[] {
  const configuredIds = new Set(
    Array.from(configuredModelIds, (modelId) => normalizeOpenAiModelId(modelId).toLowerCase())
  );

  return models.map((model) => ({
    ...model,
    alreadyAdded: configuredIds.has(normalizeOpenAiModelId(model.id).toLowerCase())
  }));
}
