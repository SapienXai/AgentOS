"use client";

import { useEffect, useMemo, useState } from "react";

import type { AddModelsCatalogModel, MissionControlSnapshot } from "@/lib/agentos/contracts";
import { mergeCatalogWithConfiguredModels } from "@/lib/openclaw/domains/model-catalog-projection";

type ModelCatalogPayload = {
  models: AddModelsCatalogModel[];
  source: "openclaw" | "openclaw-cache" | "snapshot";
  warning?: string;
};

const MODEL_CATALOG_TIMEOUT_MS = 20_000;
let cachedPayload: ModelCatalogPayload | null = null;
let catalogRequest: Promise<ModelCatalogPayload> | null = null;

async function loadModelCatalog(force = false) {
  if (cachedPayload && !force) {
    return cachedPayload;
  }

  if (catalogRequest && !force) {
    return catalogRequest;
  }

  catalogRequest = fetch("/api/models/catalog", {
    signal: AbortSignal.timeout(MODEL_CATALOG_TIMEOUT_MS)
  }).then(async (response) => {
    const payload = (await response.json().catch(() => null)) as (ModelCatalogPayload & { error?: string }) | null;

    if (!response.ok || !payload) {
      throw new Error(payload?.error || "OpenClaw catalog could not be loaded.");
    }

    cachedPayload = {
      models: Array.isArray(payload.models) ? payload.models : [],
      source: payload.source,
      warning: payload.warning
    };
    return cachedPayload;
  }).finally(() => {
    catalogRequest = null;
  });

  return catalogRequest;
}

export function useModelCatalog({
  enabled,
  snapshot
}: {
  enabled: boolean;
  snapshot: MissionControlSnapshot;
}) {
  const [payload, setPayload] = useState<ModelCatalogPayload | null>(cachedPayload);
  const [isLoading, setIsLoading] = useState(enabled && !cachedPayload);
  const [error, setError] = useState<string | null>(null);
  const recommendedModelIds = useMemo(
    () => [
      snapshot.diagnostics.modelReadiness.recommendedModelId,
      snapshot.diagnostics.modelReadiness.resolvedDefaultModel,
      snapshot.diagnostics.modelReadiness.defaultModel
    ].filter((modelId): modelId is string => Boolean(modelId)),
    [
      snapshot.diagnostics.modelReadiness.defaultModel,
      snapshot.diagnostics.modelReadiness.recommendedModelId,
      snapshot.diagnostics.modelReadiness.resolvedDefaultModel
    ]
  );

  async function refresh(force = false) {
    setIsLoading(true);
    setError(null);

    try {
      const nextPayload = await loadModelCatalog(force);
      setPayload(nextPayload);
      return nextPayload;
    } catch (loadError) {
      const message =
        loadError instanceof DOMException && loadError.name === "TimeoutError"
          ? "OpenClaw catalog request timed out. Check Gateway status and try again."
          : loadError instanceof Error
            ? loadError.message
            : "OpenClaw catalog could not be loaded.";
      setError(message);
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void refresh();
    // Catalog loading is intentionally keyed only by visibility; snapshot updates are merged below.
  }, [enabled]);

  const models = useMemo(
    () => mergeCatalogWithConfiguredModels(payload?.models ?? [], snapshot.models, recommendedModelIds),
    [payload?.models, recommendedModelIds, snapshot.models]
  );

  return {
    models,
    isLoading,
    error,
    source: payload?.source ?? null,
    warning: payload?.warning ?? null,
    refresh
  };
}
