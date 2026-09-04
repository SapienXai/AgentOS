import type { AddModelsCatalogModel } from "@/lib/openclaw/types";
import type { OpenClawModelsListView } from "@/lib/openclaw/client/types";

export type ModelAvailabilityStatus =
  | "ready"
  | "needs-auth"
  | "auth-failed"
  | "cooldown"
  | "unavailable"
  | "unknown";

export type ModelSelectionScope = "default" | "worker" | "session";

export type ModelSelectionProjection = {
  scope: ModelSelectionScope;
  agentId?: string;
  sessionKey?: string;
  configuredModelId: string | null;
  effectiveModelId: string | null;
  effectiveProvider: string | null;
  effectiveStatus: "known" | "unknown";
  source: "native-default" | "native-agent" | "native-session" | "unknown";
  inherited: boolean;
  fallbackModels: string[];
  overrideSource?: "user" | "auto" | null;
  explanation: string;
};

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
  nativeOutcome?: "ready" | "auth-rejected" | "unavailable" | string;
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
  availability: ModelAvailabilityStatus;
  missing?: boolean;
  unavailableReason?: string;
  unavailableUntil?: number;
  reasoning?: boolean;
  supportsTools?: boolean;
  tags: string[];
  alias?: string;
  role: "default" | "fallback" | "available" | "unavailable" | "unknown";
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
  selection?: ModelSelectionProjection;
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
  agentId?: string;
  sessionKey?: string;
};

export function resolveModelAvailability(model: Pick<ModelManagementModel, "available" | "unavailableReason"> & { disabled?: boolean; deprecated?: boolean; missing?: boolean }): ModelAvailabilityStatus {
  if (model.available === true) return "ready";
  if (model.unavailableReason === "missing-auth") return "needs-auth";
  if (model.unavailableReason === "auth-failed") return "auth-failed";
  if (model.unavailableReason === "cooldown") return "cooldown";
  if (model.available === false || model.disabled === true || model.deprecated === true || model.missing === true) return "unavailable";
  return "unknown";
}

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
    missing: model.missing === true || (model.available === false && model.unavailableReason === "missing-auth"),
    alreadyAdded: model.role === "default" || model.role === "fallback" || model.tags.includes("configured"),
    recommended: model.tags.some((tag) => ["recommended", "featured", "default"].includes(tag.toLowerCase())),
    supportsTools: model.supportsTools ?? null,
    isFree: model.tags.some((tag) => tag.toLowerCase() === "free"),
    tags: model.tags
  };
}
