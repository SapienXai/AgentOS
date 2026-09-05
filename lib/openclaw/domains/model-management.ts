import type { AddModelsCatalogModel } from "@/lib/openclaw/types";
import type { OpenClawModelsListView } from "@/lib/openclaw/client/types";
import { normalizeOpenAiModelId } from "@/lib/openclaw/domains/model-provider-connection";

export type ModelAvailabilityStatus =
  | "ready"
  | "needs-auth"
  | "auth-failed"
  | "cooldown"
  | "unavailable"
  | "unknown";

export type ModelSelectionScope = "default" | "worker" | "session";

/** The native view shared by model pickers and pre-mutation validation. */
export const MODEL_SELECTION_CATALOG_VIEW: OpenClawModelsListView = "default";

export type ModelSelectionConfiguredStatus = ModelAvailabilityStatus | "not-configured";

export type ModelSelectionProjection = {
  scope: ModelSelectionScope;
  agentId?: string;
  sessionKey?: string;
  configuredModelId: string | null;
  configuredStatus: ModelSelectionConfiguredStatus;
  effectiveModelId: string | null;
  effectiveProvider: string | null;
  effectiveStatus: "known" | "unknown";
  source: "native-default" | "native-agent" | "native-session" | "unknown";
  inherited: boolean | null;
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

export type NativeModelSelectabilityFacts = {
  available?: boolean | null;
  unavailableReason?: string | null;
  missing?: boolean | null;
  disabled?: boolean | null;
  deprecated?: boolean | null;
};

export type ModelSelectabilityReason =
  | "ready"
  | "needs-auth"
  | "auth-failed"
  | "cooldown"
  | "missing"
  | "disabled"
  | "deprecated"
  | "unavailable"
  | "unknown";

export type ModelSelectability = {
  selectable: boolean;
  reason: ModelSelectabilityReason;
};

export type ModelSelectionProjectionInput = {
  agentId?: string;
  sessionKey?: string;
  defaults: {
    model: {
      primary: string | null;
      fallbacks: string[];
    };
  };
  agents: ReadonlyArray<{ id: string; model?: { primary?: string; fallbacks?: string[] } }>;
  sessions: ReadonlyArray<{
    key?: string;
    sessionId?: string;
    model?: string;
    modelProvider?: string;
    modelOverrideSource?: "user" | "auto" | null;
  }>;
  sessionReadOk: boolean;
  models: ReadonlyArray<Pick<ModelManagementModel, "id" | "provider" | "availability">>;
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

export function resolveModelSelectability(model: NativeModelSelectabilityFacts): ModelSelectability {
  const availability = resolveModelAvailability({
    available: model.available ?? null,
    unavailableReason: model.unavailableReason ?? undefined,
    missing: model.missing === true,
    disabled: model.disabled === true,
    deprecated: model.deprecated === true
  });

  switch (availability) {
    case "ready":
      return { selectable: true, reason: "ready" };
    case "needs-auth":
      return { selectable: false, reason: "needs-auth" };
    case "auth-failed":
      return { selectable: false, reason: "auth-failed" };
    case "cooldown":
      return { selectable: false, reason: "cooldown" };
    case "unavailable":
      return {
        selectable: false,
        reason: model.missing === true
          ? "missing"
          : model.disabled === true
            ? "disabled"
            : model.deprecated === true
              ? "deprecated"
              : "unavailable"
      };
    case "unknown":
      return { selectable: false, reason: "unknown" };
  }
}

export function isSelectableModel(model: NativeModelSelectabilityFacts) {
  return resolveModelSelectability(model).selectable;
}

export function buildModelSelectionProjection(
  input: ModelSelectionProjectionInput
): ModelSelectionProjection {
  const defaultModelId = input.defaults.model.primary;
  const agent = input.agentId
    ? input.agents.find((entry) => entry.id === input.agentId)
    : undefined;

  if (input.sessionKey) {
    const session = input.sessions.find((entry) => entry.key === input.sessionKey || entry.sessionId === input.sessionKey);
    const sessionModelId = normalizeSessionModelRef(session?.model, session?.modelProvider);
    const overrideSource = session?.modelOverrideSource;
    const model = sessionModelId
      ? input.models.find((entry) => entry.id.toLowerCase() === sessionModelId.toLowerCase())
      : undefined;
    const configuredModelId = overrideSource === "user" ? sessionModelId : null;

    return {
      scope: "session",
      ...(input.agentId ? { agentId: input.agentId } : {}),
      sessionKey: input.sessionKey,
      configuredModelId,
      configuredStatus: configuredModelId
        ? resolveConfiguredModelStatus(configuredModelId, input.models)
        : overrideSource === "user"
          ? "unknown"
          : "not-configured",
      effectiveModelId: sessionModelId,
      effectiveProvider: session?.modelProvider ?? model?.provider ?? providerFromModelRef(sessionModelId),
      effectiveStatus: input.sessionReadOk && sessionModelId ? "known" : "unknown",
      source: input.sessionReadOk && sessionModelId ? "native-session" : "unknown",
      inherited: overrideSource === "user" ? false : overrideSource === "auto" || overrideSource === null ? true : null,
      fallbackModels: agent?.model?.fallbacks ?? input.defaults.model.fallbacks,
      ...(overrideSource !== undefined ? { overrideSource } : {}),
      explanation: input.sessionReadOk
        ? sessionModelId
          ? overrideSource === "user"
            ? "OpenClaw reports this session model and its native user override provenance."
            : "OpenClaw reports this session model; its current runtime selection is native session evidence."
          : "OpenClaw did not report a model for this session."
        : "OpenClaw session model state could not be read."
    };
  }

  if (input.agentId) {
    const configuredModelId = normalizeOptionalModelRef(agent?.model?.primary);
    const configuredStatus = configuredModelId
      ? resolveConfiguredModelStatus(configuredModelId, input.models)
      : "not-configured";

    return {
      scope: "worker",
      agentId: input.agentId,
      configuredModelId,
      configuredStatus,
      effectiveModelId: null,
      effectiveProvider: null,
      effectiveStatus: "unknown",
      source: "unknown",
      inherited: !configuredModelId,
      fallbackModels: agent?.model?.fallbacks ?? input.defaults.model.fallbacks,
      explanation: configuredModelId
        ? `OpenClaw reports this worker model as configured and ${configuredStatus}; the current runtime model is unknown until a session reports it.`
        : "This worker inherits the OpenClaw default; the current runtime model is unknown until a session reports it."
    };
  }

  const configuredStatus = defaultModelId
    ? resolveConfiguredModelStatus(defaultModelId, input.models)
    : "not-configured";

  return {
    scope: "default",
    configuredModelId: defaultModelId,
    configuredStatus,
    effectiveModelId: null,
    effectiveProvider: null,
    effectiveStatus: "unknown",
    source: "unknown",
    inherited: false,
    fallbackModels: input.defaults.model.fallbacks,
    explanation: defaultModelId
      ? `OpenClaw reports the configured default as ${configuredStatus}; the current runtime model is unknown until a session reports it.`
      : "OpenClaw did not report a default model; the current runtime model is unknown."
  };
}

function resolveConfiguredModelStatus(
  modelId: string,
  models: ReadonlyArray<Pick<ModelManagementModel, "id" | "availability">>
): ModelAvailabilityStatus {
  return models.find((model) => model.id.toLowerCase() === modelId.toLowerCase())?.availability ?? "unknown";
}

function normalizeSessionModelRef(model: unknown, provider: unknown) {
  if (typeof model !== "string" || !model.trim()) return null;
  const normalizedModel = model.trim();
  const normalizedProvider = typeof provider === "string" ? provider.trim() : "";
  return normalizeOpenAiModelId(
    normalizedProvider && !normalizedModel.includes("/")
      ? `${normalizedProvider}/${normalizedModel}`
      : normalizedModel
  );
}

function normalizeOptionalModelRef(value: unknown) {
  return typeof value === "string" && value.trim() ? normalizeOpenAiModelId(value) : null;
}

function providerFromModelRef(modelId: string | null) {
  return modelId?.split("/", 1)[0] || null;
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
    ...(model.advanced.deprecated ? { deprecated: true } : {}),
    ...(model.advanced.disabled ? { disabled: true } : {}),
    missing: model.missing === true || (model.available === false && model.unavailableReason === "missing-auth"),
    alreadyAdded: model.role === "default" || model.role === "fallback" || model.tags.includes("configured"),
    recommended: model.tags.some((tag) => ["recommended", "featured", "default"].includes(tag.toLowerCase())),
    supportsTools: model.supportsTools ?? null,
    isFree: model.tags.some((tag) => tag.toLowerCase() === "free"),
    tags: model.tags
  };
}
