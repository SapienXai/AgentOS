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
    kind: "api-key" | "oauth" | "device-code" | "other";
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
};

export type ModelManagementReadOptions = {
  view?: OpenClawModelsListView;
  refresh?: boolean;
  includeSetup?: boolean;
};

export function modelManagementModelToCatalogModel(model: ModelManagementModel): AddModelsCatalogModel {
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    input: model.input,
    contextWindow: model.contextWindow,
    local: model.provider === "ollama" || model.tags.includes("local"),
    available: model.available !== false,
    missing: model.available === false && model.unavailableReason === "missing-auth",
    alreadyAdded: model.role === "default" || model.role === "fallback" || model.tags.includes("configured"),
    recommended: model.tags.some((tag) => ["recommended", "featured", "default"].includes(tag.toLowerCase())),
    supportsTools: model.supportsTools ?? (model.tags.includes("tools") || model.input.includes("text")),
    isFree: model.tags.some((tag) => tag.toLowerCase() === "free"),
    tags: model.tags
  };
}
