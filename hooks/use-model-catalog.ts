"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";

import type { AddModelsCatalogModel, MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { ModelManagementSnapshot, ModelSelectionProjection } from "@/lib/openclaw/domains/model-management";
import {
  MODEL_SELECTION_CATALOG_VIEW,
  modelManagementModelToCatalogModel
} from "@/lib/openclaw/domains/model-management";
import { mergeCatalogWithConfiguredModels } from "@/lib/openclaw/domains/model-catalog-projection";

type ModelCatalogPayload = {
  models: AddModelsCatalogModel[];
  source: "openclaw" | "openclaw-cache" | "snapshot";
  age: number | null;
  checkedAt: string;
  warning?: string;
  selection?: ModelSelectionProjection;
};

export type ModelCatalogView = "default" | "all";

const MODEL_CATALOG_TIMEOUT_MS = 20_000;
const MODEL_CATALOG_RECONCILE_INTERVAL_MS = 60_000;
const cachedPayloads = new Map<string, ModelCatalogPayload>();
const catalogRequests = new Map<string, Promise<ModelCatalogPayload>>();

async function loadModelCatalog(view: ModelCatalogView, force = false, agentId?: string, sessionKey?: string) {
  const cacheKey = `${view}:${agentId ?? "global"}:${sessionKey ?? "global"}`;
  const cachedPayload = cachedPayloads.get(cacheKey);
  if (cachedPayload && !force) {
    return cachedPayload;
  }

  const catalogRequest = catalogRequests.get(cacheKey);
  if (catalogRequest && !force) {
    return catalogRequest;
  }

  const endpoint = view === "all" ? "/api/models/catalog" : "/api/models/management";
  const query = view === "all"
    ? ""
    : `?view=${MODEL_SELECTION_CATALOG_VIEW}${agentId ? `&agentId=${encodeURIComponent(agentId)}` : ""}${sessionKey ? `&sessionKey=${encodeURIComponent(sessionKey)}` : ""}`;
  const request = fetch(`${endpoint}${query}`, {
    signal: AbortSignal.timeout(MODEL_CATALOG_TIMEOUT_MS)
  }).then(async (response) => {
    const payload = (await response.json().catch(() => null)) as
      | (ModelCatalogPayload & { error?: string })
      | ModelManagementSnapshot
      | null;

    if (!response.ok || !payload) {
      throw new Error((payload && "error" in payload ? payload.error : undefined) || "OpenClaw catalog could not be loaded.");
    }

    const managementPayload = view === "default" ? payload as ModelManagementSnapshot : null;
    const normalizedPayload: ModelCatalogPayload = managementPayload
      ? {
          models: Array.isArray(managementPayload.models) ? managementPayload.models.map(modelManagementModelToCatalogModel) : [],
          source: "openclaw",
          age: null,
          checkedAt: managementPayload.checkedAt,
          warning: managementPayload.diagnostics.catalogWarning || managementPayload.diagnostics.configWarning || undefined,
          selection: managementPayload.selection
        }
      : {
          models: Array.isArray((payload as ModelCatalogPayload).models) ? (payload as ModelCatalogPayload).models : [],
          source: (payload as ModelCatalogPayload).source,
          age: typeof (payload as ModelCatalogPayload).age === "number" ? (payload as ModelCatalogPayload).age : null,
          checkedAt: (payload as ModelCatalogPayload).checkedAt,
          warning: (payload as ModelCatalogPayload).warning
        };

    cachedPayloads.set(cacheKey, normalizedPayload);
    return normalizedPayload;
  }).finally(() => {
    catalogRequests.delete(cacheKey);
  });
  catalogRequests.set(cacheKey, request);
  return request;
}

export function useModelCatalog({
  enabled,
  snapshot,
  view = "default",
  agentId,
  sessionKey
}: {
  enabled: boolean;
  snapshot: MissionControlSnapshot;
  view?: ModelCatalogView;
  agentId?: string | null;
  sessionKey?: string | null;
}) {
  const cacheKey = `${view}:${agentId ?? "global"}:${sessionKey ?? "global"}`;
  const [payload, setPayload] = useState<ModelCatalogPayload | null>(() => cachedPayloads.get(cacheKey) ?? null);
  const [isLoading, setIsLoading] = useState(enabled && !cachedPayloads.has(cacheKey));
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
      const nextPayload = await loadModelCatalog(view, force, agentId ?? undefined, sessionKey ?? undefined);
      setPayload(nextPayload);
      return nextPayload;
    } catch (error) {
      // Configured snapshot models remain usable when the optional global catalog is unavailable.
      setError(error instanceof Error ? error.message : "OpenClaw catalog could not be loaded.");
      return null;
    } finally {
      setIsLoading(false);
    }
  }
  const reconcileCatalog = useEffectEvent(() => {
    void refresh(true);
  });

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void refresh();
    // Catalog loading is intentionally keyed only by visibility; snapshot updates are merged below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, enabled, sessionKey, view]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const interval = window.setInterval(() => {
      reconcileCatalog();
    }, MODEL_CATALOG_RECONCILE_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [agentId, enabled, sessionKey, view]);

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
    age: payload?.age ?? null,
    checkedAt: payload?.checkedAt ?? null,
    selection: payload?.selection ?? null,
    stale: typeof payload?.age === "number" && payload.age > MODEL_CATALOG_RECONCILE_INTERVAL_MS * 5,
    refresh
  };
}
