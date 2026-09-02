import type { AddModelsCatalogModel } from "@/lib/openclaw/types";
import type { OpenClawModelsListView } from "@/lib/openclaw/client/types";

export type ModelManagementAuthProfile = {
  id: string;
  type: string;
  status: string;
  reasonCode?: string;
  expiryAt?: number;
  logoutSupported: boolean;
};

export type ModelManagementProvider = {
  id: string;
  name: string;
  status: "connected" | "needs-attention" | "not-connected" | "unavailable" | "unknown";
  authMethods: Array<{
    id: string;
    label: string;
    hint?: string;
    brandId?: string;
    groupLabel?: string;
    icon?: string;
    website?: string;
    featured?: boolean;
    kind: "api-key" | "oauth" | "device-code" | "other";
  }>;
  prepareOptions: Array<{
    id: string;
    brandId?: string;
    label: string;
    hint?: string;
    actionLabel?: string;
    icon?: string;
    website?: string;
  }>;
  profiles: ModelManagementAuthProfile[];
  modelCount: number;
  availableModelCount: number;
  local: boolean;
  source: "openclaw";
  setupAvailable: boolean;
  canLogout: boolean;
  presentation: {
    accent?: string;
  };
};

export type ModelManagementModel = {
  id: string;
  name: string;
  provider: string;
  providerName: string;
  input: string;
  contextWindow: number | null;
  contextWindows?: Array<{ id: string; label: string; contextWindow: number }>;
  available: boolean | null;
  unavailableReason?: string;
  reasoning?: boolean;
  supportsTools?: boolean;
  tags: string[];
  alias?: string;
  role: "default" | "fallback" | "available" | "unavailable";
  fallbackPosition?: number;
  linkedAgents: number;
  advanced: {
    rawId: string;
    providerId: string;
    runtimeRoute?: string;
    deprecated: boolean;
    disabled: boolean;
  };
};

export type ModelManagementSnapshot = {
  source: "openclaw";
  view: OpenClawModelsListView;
  checkedAt: string;
  defaultModel: string | null;
  fallbackModels: string[];
  modelPolicy: {
    allow: string[] | null;
  };
  models: ModelManagementModel[];
  providers: ModelManagementProvider[];
  diagnostics: {
    authStatusAvailable: boolean;
    setupMetadataAvailable: boolean;
    catalogWarning: string | null;
    configWarning: string | null;
  };
  permissions?: {
    canManageModels: boolean;
    canManageSecrets: boolean;
  };
};

export type ModelManagementReadOptions = {
  view?: OpenClawModelsListView;
  refresh?: boolean;
  includeSetup?: boolean;
};

/**
 * Keep provider-owned setup hints useful without turning normal connection UI
 * into a terminal-command surface. The raw hint remains available to the
 * advanced/server diagnostics boundary; this is presentation-only filtering.
 */
export function presentModelProviderSetupHint(hint: string | undefined) {
  const normalized = hint?.trim();
  if (!normalized) return undefined;
  if (/\b(?:terminal|shell|command)\b|`[^`]+`/i.test(normalized)) {
    return "Requires a provider credential prepared outside AgentOS.";
  }
  return normalized;
}

export function modelManagementModelToCatalogModel(model: ModelManagementModel): AddModelsCatalogModel {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    input: model.input,
    contextWindow: model.contextWindow,
    local: model.provider === "ollama" || model.tags.includes("local"),
    available: model.available,
    missing: model.available === false && model.unavailableReason === "missing-auth",
    alreadyAdded: model.role === "default" || model.role === "fallback" || model.tags.includes("configured"),
    recommended: model.tags.some((tag) => ["recommended", "featured", "default"].includes(tag.toLowerCase())),
    supportsTools: model.supportsTools ?? null,
    isFree: model.tags.some((tag) => tag.toLowerCase() === "free"),
    tags: model.tags
  };
}
