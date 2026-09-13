import "server-only";

import {
  getOpenClawAdapter,
  type OpenClawGatewaySurfacePort
} from "@/lib/openclaw/adapter/openclaw-adapter";
import { normalizeClientError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import type {
  OpenClawCommandOptions,
  OpenClawPluginCatalogBrowseInput,
  OpenClawPluginCatalogBrowsePayload,
  OpenClawPluginCatalogCategoriesPayload,
  OpenClawPluginCatalogGetPayload,
  OpenClawListModelsInput,
  OpenClawToolsCatalogInput,
  OpenClawToolsCatalogPayload
} from "@/lib/openclaw/client/types";
import {
  createPluginCatalogProjectionFailure,
  normalizePluginCatalogBrowseInput,
  projectPluginCatalogDetail,
  projectPluginCatalogEntries,
  resolvePluginCatalogFailureState,
  type PluginCatalogContext,
  type PluginCatalogProjection,
  type PluginCatalogProjectionFailure
} from "@/lib/openclaw/domains/plugin-catalog";
import type { OpenClawToolCatalogEntry } from "@/lib/openclaw/tool-catalog";

export type OpenClawCapabilityToolEntry = OpenClawToolCatalogEntry & {
  pluginId?: string;
  pluginName?: string;
};

export function listOpenClawSkills(options: OpenClawCommandOptions & { eligible?: boolean } = {}) {
  return getOpenClawAdapter().listSkills(options);
}

export function listOpenClawPlugins(options: OpenClawCommandOptions = {}) {
  return getOpenClawAdapter().listPlugins(options);
}

export type OpenClawPluginCatalogQuery = OpenClawPluginCatalogBrowseInput & {
  pluginId?: string;
  version?: string;
  context?: PluginCatalogContext | null;
};

/**
 * Read-only native plugin discovery. This intentionally uses the adapter's
 * native Gateway surface port, so catalog reads never silently fall back to
 * the CLI or create AgentOS-owned installed state.
 */
export async function getOpenClawPluginCatalog(
  input: OpenClawPluginCatalogQuery = {},
  options: OpenClawCommandOptions = {},
  gatewaySurface?: OpenClawGatewaySurfacePort
): Promise<PluginCatalogProjection> {
  const generatedAt = new Date().toISOString();
  const context = input.context ?? null;
  const surface = gatewaySurface ?? getOpenClawAdapter().getGatewaySurfacePort?.();
  const browseInput = normalizePluginCatalogBrowseInput(input);
  const pluginId = normalizeCatalogIdentifier(input.pluginId, 512);
  const version = normalizeCatalogIdentifier(input.version, 128);

  if (!surface || !surface.canProbeNativeGateway()) {
    const failure = createPluginCatalogProjectionFailure(
      "browse",
      "unsupported",
      "OpenClaw native plugin catalog methods are unavailable in this runtime."
    );
    return createPluginCatalogProjection({
      generatedAt,
      context,
      browse: null,
      categories: null,
      detail: null,
      failures: [failure],
      detailError: null
    });
  }

  const [browseResult, categoriesResult, detailResult] = await Promise.all([
    readNativeCatalogOperation<OpenClawPluginCatalogBrowsePayload>(
      "browse",
      () => surface.probeNativeGateway("plugins.catalog.browse", browseInput, options)
    ),
    readNativeCatalogOperation<OpenClawPluginCatalogCategoriesPayload>(
      "categories",
      () => surface.probeNativeGateway("plugins.catalog.categories", {}, options)
    ),
    pluginId
      ? readNativeCatalogOperation<OpenClawPluginCatalogGetPayload>(
          "detail",
          () => surface.probeNativeGateway("plugins.catalog.get", { id: pluginId, ...(version ? { version } : {}) }, options)
        )
      : Promise.resolve({ value: null, failure: null })
  ]);

  const failures = [browseResult.failure, categoriesResult.failure].filter(
    (failure): failure is PluginCatalogProjectionFailure => Boolean(failure)
  );
  const detailError = detailResult.failure;
  if (detailError) {
    failures.push(detailError);
  }

  return createPluginCatalogProjection({
    generatedAt,
    context,
    browse: browseResult.value,
    categories: categoriesResult.value,
    detail: detailResult.value,
    failures,
    detailError
  });
}

export function listOpenClawTools(
  input: OpenClawToolsCatalogInput = {},
  options: OpenClawCommandOptions = {}
) {
  return getOpenClawAdapter().getToolsCatalog(input, options);
}

/**
 * Normalize live OpenClaw tool discovery for AgentOS operator surfaces.
 * The static tool catalog is intentionally not consulted here; callers decide
 * whether to use it only when this live Gateway capability is unavailable.
 */
export function normalizeOpenClawToolsCatalog(payload: OpenClawToolsCatalogPayload): OpenClawCapabilityToolEntry[] {
  const entries = new Map<string, OpenClawCapabilityToolEntry>();
  const groups = Array.isArray(payload?.groups) ? payload.groups : [];

  for (const group of groups) {
    const groupSource = group?.source === "plugin" ? "plugin" : "builtin";
    const groupPluginId = normalizeCatalogText(group?.pluginId);

    for (const tool of Array.isArray(group?.tools) ? group.tools : []) {
      const name = normalizeCatalogText(tool?.id);
      if (!name || entries.has(name)) {
        continue;
      }

      const category = tool?.source === "plugin" || groupSource === "plugin" ? "plugin" : "builtin";
      const pluginId = normalizeCatalogText(tool?.pluginId) ?? groupPluginId;
      const pluginName = category === "plugin" ? normalizeCatalogText(group?.label) : null;
      const entry: OpenClawCapabilityToolEntry = {
        name,
        description:
          normalizeCatalogText(tool?.description) ??
          normalizeCatalogText(tool?.label) ??
          "No description available.",
        source: category === "plugin" ? pluginName ?? "OpenClaw plugin" : "OpenClaw Gateway",
        category,
        ...(pluginId ? { pluginId } : {}),
        ...(pluginName ? { pluginName } : {})
      };

      entries.set(name, entry);
    }
  }

  return Array.from(entries.values());
}

export function listOpenClawModels(
  input: OpenClawListModelsInput = {},
  options: OpenClawCommandOptions = {}
) {
  return getOpenClawAdapter().listModels(input, options);
}

export function scanOpenClawModels(options: OpenClawCommandOptions & {
  yes?: boolean;
  noInput?: boolean;
  noProbe?: boolean;
} = {}) {
  return getOpenClawAdapter().scanModels(options);
}

function normalizeCatalogText(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

async function readNativeCatalogOperation<TPayload>(
  operation: PluginCatalogProjectionFailure["operation"],
  read: () => Promise<TPayload>
) {
  try {
    return { value: await read(), failure: null } as const;
  } catch (error) {
    const normalized = normalizeClientError(error);
    return {
      value: null,
      failure: createPluginCatalogProjectionFailure(
        operation,
        resolvePluginCatalogFailureState(normalized.kind),
        normalized.message
      )
    } as const;
  }
}

function createPluginCatalogProjection(input: {
  generatedAt: string;
  context: PluginCatalogContext | null;
  browse: OpenClawPluginCatalogBrowsePayload | null;
  categories: OpenClawPluginCatalogCategoriesPayload | null;
  detail: OpenClawPluginCatalogGetPayload | null;
  failures: PluginCatalogProjectionFailure[];
  detailError: PluginCatalogProjectionFailure | null;
}): PluginCatalogProjection {
  const hasRead = Boolean(input.browse || input.categories || input.detail);
  const state = input.failures.length === 0
    ? input.browse?.remoteError ? "degraded" : "ready"
    : hasRead ? "degraded" : input.failures[0]?.state ?? "unknown";
  const remoteError = normalizeCatalogText(input.browse?.remoteError) ?? null;
  const items = projectPluginCatalogEntries(input.browse?.items ?? [], input.context);

  return {
    source: "openclaw-gateway",
    generatedAt: input.generatedAt,
    state,
    liveProof: false,
    items,
    categories: input.categories?.categories ?? [],
    nextCursor: input.browse?.nextCursor ?? null,
    remoteError,
    detail: input.detail ? projectPluginCatalogDetail(input.detail, input.context) : null,
    detailError: input.detailError,
    failures: input.failures,
    context: input.context,
    recovery: resolvePluginCatalogRecovery(state)
  };
}

function normalizeCatalogIdentifier(value: string | undefined, maxLength: number) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized.slice(0, maxLength) : null;
}

function resolvePluginCatalogRecovery(state: PluginCatalogProjection["state"]) {
  if (state === "ready") {
    return "OpenClaw native catalog data is available for inspection. Installed and enabled state remains OpenClaw-owned.";
  }

  if (state === "denied") {
    return "Ask an OpenClaw operator to grant operator.read, then retry.";
  }

  if (state === "unsupported") {
    return "Update the OpenClaw Gateway/runtime to certified 2026.9.4 or newer.";
  }

  return "Retry the native OpenClaw catalog request and inspect Gateway diagnostics if it continues.";
}
