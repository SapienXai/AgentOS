import type { AddModelsCatalogModel } from "@/lib/agentos/contracts";

export function mergeOllamaCatalogModels(
  openClawModels: AddModelsCatalogModel[],
  localModels: AddModelsCatalogModel[]
) {
  const merged = new Map<string, AddModelsCatalogModel>();

  for (const model of openClawModels) {
    merged.set(model.id, model);
  }

  for (const model of localModels) {
    const existing = merged.get(model.id);

    merged.set(model.id, existing
      ? {
          ...existing,
          name: existing.name || model.name,
          input: existing.input || model.input,
          contextWindow: existing.contextWindow ?? model.contextWindow,
          local: true,
          available: existing.available || model.available,
          missing: existing.missing && model.missing,
          alreadyAdded: existing.alreadyAdded || model.alreadyAdded,
          recommended: existing.recommended || model.recommended,
          supportsTools: existing.supportsTools || model.supportsTools,
          isFree: existing.isFree || model.isFree,
          tags: Array.from(new Set([...existing.tags, ...model.tags]))
        }
      : model);
  }

  return Array.from(merged.values());
}

export function parseOllamaListModelNames(output: string) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^NAME\s+ID\s+SIZE\s+MODIFIED\b/i.test(line))
    .map((line) => line.split(/\s+/)[0]?.trim() ?? "")
    .filter((modelName, index, entries) => modelName && entries.indexOf(modelName) === index);
}
