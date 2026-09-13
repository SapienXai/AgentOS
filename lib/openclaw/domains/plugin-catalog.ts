import type {
  OpenClawPluginCatalogBrowseInput,
  OpenClawPluginCatalogCategory,
  OpenClawPluginCatalogDetail,
  OpenClawPluginCatalogEntry,
  OpenClawPluginCatalogGetPayload,
  OpenClawPluginCatalogIntent
} from "@/lib/openclaw/client/types";
import type { OpenClawAgent, WorkspaceProject } from "@/lib/openclaw/types";

export const OPENCLAW_PLUGIN_CATALOG_METHODS = [
  "plugins.catalog.browse",
  "plugins.catalog.categories",
  "plugins.catalog.get"
] as const;

export type PluginCatalogProjectionState = "ready" | "degraded" | "unsupported" | "unknown" | "denied" | "failed";
export type PluginCatalogRelevanceState = "relevant" | "unknown";

export type PluginCatalogContext = {
  workspaceName?: string;
  workspaceSlug?: string;
  agentName?: string;
  agentPurpose?: string;
};

export type PluginCatalogRelevance = {
  state: PluginCatalogRelevanceState;
  evidence: string[];
};

export type PluginCatalogProjectionEntry = OpenClawPluginCatalogEntry & {
  relevance: PluginCatalogRelevance;
};

export type PluginCatalogProjection = {
  source: "openclaw-gateway";
  generatedAt: string;
  state: PluginCatalogProjectionState;
  liveProof: false;
  items: PluginCatalogProjectionEntry[];
  categories: OpenClawPluginCatalogCategory[];
  nextCursor: string | null;
  remoteError: string | null;
  detail: {
    plugin: PluginCatalogProjectionEntry;
    detail: OpenClawPluginCatalogDetail;
  } | null;
  detailError: PluginCatalogProjectionFailure | null;
  failures: PluginCatalogProjectionFailure[];
  context: PluginCatalogContext | null;
  recovery: string;
};

export type PluginCatalogProjectionFailure = {
  operation: "browse" | "categories" | "detail";
  state: Exclude<PluginCatalogProjectionState, "ready" | "degraded">;
  message: string;
  recovery: string;
};

export function createPluginCatalogContext(
  workspace?: Pick<WorkspaceProject, "name" | "slug"> | null,
  agent?: Pick<OpenClawAgent, "name" | "profile"> | null
): PluginCatalogContext | null {
  const workspaceName = normalizeContextValue(workspace?.name);
  const workspaceSlug = normalizeContextValue(workspace?.slug);
  const agentName = normalizeContextValue(agent?.name);
  const agentPurpose = normalizeContextValue(agent?.profile?.purpose);
  const context: PluginCatalogContext = {
    ...(workspaceName ? { workspaceName } : {}),
    ...(workspaceSlug ? { workspaceSlug } : {}),
    ...(agentName ? { agentName } : {}),
    ...(agentPurpose ? { agentPurpose } : {})
  };

  return Object.keys(context).length > 0 ? context : null;
}

export function normalizePluginCatalogBrowseInput(input: OpenClawPluginCatalogBrowseInput = {}) {
  const query = normalizeBoundedText(input.query, 200);
  const category = normalizeBoundedText(input.category, 64);
  const cursor = normalizeBoundedText(input.cursor, 4096);
  const pageSize = typeof input.pageSize === "number" && Number.isFinite(input.pageSize)
    ? Math.min(Math.max(Math.trunc(input.pageSize), 1), 100)
    : 24;
  const intent = isPluginCatalogIntent(input.intent) ? input.intent : undefined;

  return {
    ...(query ? { query } : {}),
    ...(category ? { category } : {}),
    ...(cursor ? { cursor } : {}),
    ...(intent ? { intent } : {}),
    pageSize
  } satisfies OpenClawPluginCatalogBrowseInput;
}

export function projectPluginCatalogEntries(
  entries: OpenClawPluginCatalogEntry[],
  context: PluginCatalogContext | null
): PluginCatalogProjectionEntry[] {
  return entries.map((entry) => ({
    ...entry,
    relevance: resolvePluginCatalogRelevance(entry, context)
  }));
}

export function projectPluginCatalogDetail(
  payload: OpenClawPluginCatalogGetPayload,
  context: PluginCatalogContext | null
) {
  return {
    plugin: {
      ...payload.plugin,
      relevance: resolvePluginCatalogRelevance(payload.plugin, context)
    },
    detail: payload.detail
  };
}

export function resolvePluginCatalogRelevance(
  entry: OpenClawPluginCatalogEntry,
  context: PluginCatalogContext | null
): PluginCatalogRelevance {
  if (!context) {
    return { state: "unknown", evidence: [] };
  }

  const searchable = new Set(tokenize([
    entry.catalog.name,
    entry.catalog.packageName,
    entry.catalog.summary,
    entry.catalog.author,
    ...entry.catalog.categories
  ].filter((value): value is string => Boolean(value))));
  const evidence: string[] = [];

  for (const [label, value] of [
    ["workspace", context.workspaceName],
    ["workspace", context.workspaceSlug],
    ["agent", context.agentName],
    ["agent purpose", context.agentPurpose]
  ] as const) {
    const matches = tokenize(value ? [value] : []).filter((token) => searchable.has(token));
    if (matches.length > 0) {
      evidence.push(`Matches ${label} context: ${matches.slice(0, 3).join(", ")}`);
    }
  }

  return evidence.length > 0
    ? { state: "relevant", evidence: Array.from(new Set(evidence)) }
    : { state: "unknown", evidence: [] };
}

export function createPluginCatalogProjectionFailure(
  operation: PluginCatalogProjectionFailure["operation"],
  state: PluginCatalogProjectionFailure["state"],
  message: string
): PluginCatalogProjectionFailure {
  const recovery = state === "denied"
    ? "Ask an OpenClaw operator to grant operator.read, then retry."
    : state === "unsupported"
      ? "Update the OpenClaw Gateway/runtime to certified 2026.9.4 or newer."
      : "Retry the native OpenClaw catalog request and inspect Gateway diagnostics if it continues.";

  return { operation, state, message, recovery };
}

export function resolvePluginCatalogFailureState(kind: string): PluginCatalogProjectionFailure["state"] {
  if (kind === "auth" || kind === "scope-limited") {
    return "denied";
  }

  if (kind === "unsupported" || kind === "protocol-mismatch") {
    return "unsupported";
  }

  if (kind === "unknown" || kind === "unreachable" || kind === "timeout") {
    return "unknown";
  }

  return "failed";
}

function isPluginCatalogIntent(value: unknown): value is OpenClawPluginCatalogIntent {
  return value === "all" || value === "bundled" || value === "trending" || value === "official" || value === "featured";
}

function normalizeContextValue(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized : null;
}

function normalizeBoundedText(value: string | undefined, maxLength: number) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized.slice(0, maxLength) : null;
}

function tokenize(values: string[]) {
  return Array.from(new Set(
    values
      .flatMap((value) => value.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? [])
      .filter((token) => !new Set(["the", "and", "for", "with", "agent", "workspace", "plugin"]).has(token))
  ));
}
