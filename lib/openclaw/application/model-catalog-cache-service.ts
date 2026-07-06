import "server-only";

import type { AddModelsCatalogModel } from "@/lib/agentos/contracts";

export type ModelCatalogCacheSource = "openclaw" | "openclaw-cache" | "snapshot";
export type GlobalCatalogModel = Omit<AddModelsCatalogModel, "alreadyAdded">;

export interface ModelCatalogCacheEntry {
  models: GlobalCatalogModel[];
  storedAt: number;
}

let lastSuccessfulCatalog: ModelCatalogCacheEntry | null = null;

export function readModelCatalogCache() {
  return lastSuccessfulCatalog;
}

export function writeModelCatalogCache(models: GlobalCatalogModel[]) {
  lastSuccessfulCatalog = {
    models,
    storedAt: Date.now()
  };
}

export function clearModelCatalogCache() {
  lastSuccessfulCatalog = null;
}

export function resolveModelCatalogCacheAgeMs() {
  return lastSuccessfulCatalog ? Date.now() - lastSuccessfulCatalog.storedAt : null;
}
