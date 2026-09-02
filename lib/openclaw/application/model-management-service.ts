import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { listOpenClawModels } from "@/lib/openclaw/application/catalog-service";
import type {
  OpenClawModelAuthLogoutPayload,
  OpenClawModelAuthStatusPayload
} from "@/lib/openclaw/client/types";
import { formatModelProviderLabel, modelProviderPresentationRegistry } from "@/lib/openclaw/model-provider-registry";
import { normalizeOpenAiModelId } from "@/lib/openclaw/domains/model-provider-connection";
import type {
  ModelManagementAuthProfile,
  ModelManagementModel,
  ModelManagementProvider,
  ModelManagementReadOptions,
  ModelManagementSnapshot
} from "@/lib/openclaw/domains/model-management";

type JsonRecord = Record<string, unknown>;

export type {
  ModelManagementAuthProfile,
  ModelManagementModel,
  ModelManagementProvider,
  ModelManagementReadOptions,
  ModelManagementSnapshot
} from "@/lib/openclaw/domains/model-management";

type SetupMetadata = {
  manualProviders: Array<{
    id: string;
    brandId?: string;
    groupLabel?: string;
    label: string;
    hint?: string;
    icon?: string;
    website?: string;
  }>;
  authOptions: Array<{
    id: string;
    brandId?: string;
    label: string;
    hint?: string;
    groupLabel?: string;
    icon?: string;
    website?: string;
    featured?: boolean;
    kind: "oauth" | "device-code";
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
};

export async function readModelManagementState(
  options: ModelManagementReadOptions = {}
): Promise<ModelManagementSnapshot> {
  const view = options.view ?? "default";
  const adapter = getOpenClawAdapter();
  const [catalogResult, authResult, configResult, agentsResult, setupResult] = await Promise.all([
    listOpenClawModels(
      {
        view,
        refresh: options.refresh,
        includeProviderCapabilities: true
      },
      { timeoutMs: view === "all" ? 20_000 : 8_000 }
    ).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error })),
    adapter.call<OpenClawModelAuthStatusPayload>(
      "models.authStatus",
      { refresh: options.refresh === true },
      { timeoutMs: 8_000 }
    ).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error })),
    readDefaultsConfig(adapter),
    adapter.listAgents({ timeoutMs: 8_000 }).then((value) => ({ ok: true as const, value })).catch((error) => ({ ok: false as const, error })),
    options.includeSetup
      ? readSetupMetadata(adapter)
      : Promise.resolve({ ok: true as const, value: null })
  ]);

  if (!catalogResult.ok) {
    throw new Error("OpenClaw model catalog is temporarily unavailable.");
  }

  const defaults = configResult.ok ? configResult.value : emptyDefaults();
  const auth = authResult.ok ? authResult.value : null;
  const setup = setupResult.ok ? setupResult.value : null;
  const defaultModel = normalizeOptionalModelRef(defaults.model?.primary);
  const fallbackModels = normalizeModelRefs(defaults.model?.fallbacks);
  const fallbackById = new Map(fallbackModels.map((id, index) => [id.toLowerCase(), index + 1]));
  const configuredModelIds = new Set([
    ...Object.keys(defaults.models),
    ...(defaultModel ? [defaultModel] : []),
    ...fallbackModels
  ].map((id) => normalizeOpenAiModelId(id).toLowerCase()));
  const linkedAgents = new Map<string, number>();

  if (agentsResult.ok) {
    for (const agent of agentsResult.value.agents ?? []) {
      const modelIds = [agent.model?.primary, ...(agent.model?.fallbacks ?? [])]
        .map(normalizeOptionalModelRef)
        .filter((id): id is string => Boolean(id));
      for (const modelId of modelIds) {
        const key = modelId.toLowerCase();
        linkedAgents.set(key, (linkedAgents.get(key) ?? 0) + 1);
      }
    }
  }

  const models = catalogResult.value.models.map((model) => {
    const id = normalizeOpenAiModelId(model.key);
    const key = id.toLowerCase();
    const fallbackPosition = fallbackById.get(key);
    const isDefault = Boolean(defaultModel && defaultModel.toLowerCase() === key) || model.tags.includes("default");
    const available = model.available;
    const unavailable = available === false || model.missing || model.disabled === true || model.deprecated === true;
    return {
      id,
      name: model.name || id,
      provider: model.provider ?? id.split("/", 1)[0] ?? "unknown",
      providerName: formatModelProviderLabel(model.provider ?? id.split("/", 1)[0] ?? "unknown"),
      input: model.input,
      contextWindow: model.contextWindow,
      ...(model.contextWindows ? { contextWindows: model.contextWindows } : {}),
      available,
      ...(model.unavailableReason ? { unavailableReason: model.unavailableReason } : {}),
      ...(model.reasoning !== undefined ? { reasoning: model.reasoning } : {}),
      ...(model.supportsTools !== undefined ? { supportsTools: model.supportsTools } : {}),
      tags: model.tags,
      ...(model.alias ? { alias: model.alias } : {}),
      role: unavailable ? "unavailable" : isDefault ? "default" : fallbackPosition ? "fallback" : "available",
      ...(fallbackPosition ? { fallbackPosition } : {}),
      linkedAgents: linkedAgents.get(key) ?? 0,
      advanced: {
        rawId: id,
        providerId: model.provider ?? id.split("/", 1)[0] ?? "unknown",
        ...(model.agentRuntime?.id ? { runtimeRoute: model.agentRuntime.id } : {}),
        deprecated: model.deprecated === true,
        disabled: model.disabled === true
      }
    } satisfies ModelManagementModel;
  });

  for (const id of configuredModelIds) {
    if (models.some((model) => model.id.toLowerCase() === id)) {
      continue;
    }
    const rawId = [...configuredModelIds].find((candidate) => candidate === id) ?? id;
    const fallbackPosition = fallbackById.get(id);
    const isDefault = Boolean(defaultModel && defaultModel.toLowerCase() === id);
    const provider = rawId.split("/", 1)[0] ?? "unknown";
    models.push({
      id: rawId,
      name: rawId.split("/").at(-1) ?? rawId,
      provider,
      providerName: formatModelProviderLabel(provider),
      input: "text",
      contextWindow: null,
      available: null,
      tags: ["configured", "unknown"],
      role: isDefault ? "default" : fallbackPosition ? "fallback" : "unavailable",
      ...(fallbackPosition ? { fallbackPosition } : {}),
      linkedAgents: linkedAgents.get(id) ?? 0,
      advanced: {
        rawId,
        providerId: provider,
        deprecated: false,
        disabled: false
      }
    });
  }

  const providers = buildProviders({
    models,
    auth,
    setup,
    outcomes: catalogResult.value.providerOutcomes ?? [],
    configuredProviderIds: readConfiguredProviderIds(configResult.ok ? configResult.value.providers : null)
  });

  return {
    source: "openclaw",
    view,
    checkedAt: new Date().toISOString(),
    defaultModel,
    fallbackModels,
    modelPolicy: { allow: defaults.modelPolicy.allow },
    models,
    providers,
    diagnostics: {
      authStatusAvailable: authResult.ok,
      setupMetadataAvailable: Boolean(setup),
      catalogWarning: null,
      configWarning: configResult.ok ? null : "OpenClaw configuration could not be read; defaults may be incomplete."
    }
  };
}

export async function setModelManagementDefault(modelId: string) {
  const primary = requiredModelRef(modelId);
  const adapter = getOpenClawAdapter();
  const current = await adapter.getConfig<JsonRecord>("agents.defaults", { timeoutMs: 8_000 });
  const defaults = normalizeDefaults(current);
  const fallbacks = defaults.model.fallbacks.filter((fallback) => fallback.toLowerCase() !== primary.toLowerCase());
  await updateDefaultsModel(
    { primary, fallbacks },
    ["agents.defaults.model.primary", "agents.defaults.model.fallbacks"]
  );
}

export async function setModelManagementFallbacks(modelIds: string[]) {
  const adapter = getOpenClawAdapter();
  const current = await adapter.getConfig<JsonRecord>("agents.defaults", { timeoutMs: 8_000 });
  const defaults = normalizeDefaults(current);
  const primary = defaults.model.primary?.toLowerCase();
  const fallbacks = normalizeModelRefs(modelIds).filter((modelId) => modelId.toLowerCase() !== primary);
  await updateDefaultsModel({ fallbacks }, ["agents.defaults.model.fallbacks"]);
}

export async function setModelManagementPolicy(allow: string[] | null) {
  const adapter = getOpenClawAdapter();
  const current = await adapter.getConfig<JsonRecord>("agents.defaults", { timeoutMs: 8_000 });
  const next = isRecord(current) ? structuredClone(current) : {};
  const currentPolicy = isRecord(next.modelPolicy) ? next.modelPolicy : {};
  if (allow?.length) {
    next.modelPolicy = { ...currentPolicy, allow: normalizeModelRefs(allow) };
  } else {
    delete currentPolicy.allow;
    if (Object.keys(currentPolicy).length > 0) {
      next.modelPolicy = currentPolicy;
    } else {
      delete next.modelPolicy;
    }
  }
  await adapter.setConfig("agents.defaults", next, { timeoutMs: 8_000, replacePaths: ["agents.defaults.modelPolicy.allow"] });
}

export async function logoutModelProvider(provider: string, profileIds?: string[]) {
  const payload = await getOpenClawAdapter().call<OpenClawModelAuthLogoutPayload>(
    "models.authLogout",
    {
      provider: requiredText(provider, "Provider is required."),
      ...(profileIds?.length ? { profileIds: profileIds.map((id) => requiredText(id, "Auth profile is required.")) } : {})
    },
    { timeoutMs: 15_000 }
  );
  return {
    provider: payload.provider ?? provider,
    removedProfiles: Array.isArray(payload.removedProfiles) ? payload.removedProfiles : [],
    abortedRunIds: Array.isArray(payload.abortedRunIds) ? payload.abortedRunIds : []
  };
}

async function updateDefaultsModel(patch: { primary?: string; fallbacks?: string[] }, replacePaths: string[] = []) {
  const adapter = getOpenClawAdapter();
  const current = await adapter.getConfig<JsonRecord>("agents.defaults", { timeoutMs: 8_000 });
  const next = isRecord(current) ? structuredClone(current) : {};
  const currentModel = isRecord(next.model) ? next.model : {};
  next.model = {
    ...currentModel,
    ...(patch.primary !== undefined ? { primary: patch.primary } : {}),
    ...(patch.fallbacks !== undefined ? { fallbacks: patch.fallbacks } : {})
  };
  await adapter.setConfig("agents.defaults", next, { timeoutMs: 8_000, ...(replacePaths.length ? { replacePaths } : {}) });
}

async function readDefaultsConfig(adapter: ReturnType<typeof getOpenClawAdapter>) {
  try {
    const [defaults, providers] = await Promise.all([
      adapter.getConfig<JsonRecord>("agents.defaults", { timeoutMs: 8_000 }),
      adapter.getConfig<JsonRecord>("models.providers", { timeoutMs: 8_000 })
    ]);
    return { ok: true as const, value: { ...normalizeDefaults(defaults), providers } };
  } catch (error) {
    return { ok: false as const, error, value: { ...emptyDefaults(), providers: null } };
  }
}

async function readSetupMetadata(adapter: ReturnType<typeof getOpenClawAdapter>) {
  try {
    const payload = await adapter.call<JsonRecord>("openclaw.setup.detect", {}, { timeoutMs: 12_000 });
    return { ok: true as const, value: normalizeSetupMetadata(payload) };
  } catch (error) {
    return { ok: false as const, error, value: null };
  }
}

function buildProviders(input: {
  models: ModelManagementModel[];
  auth: OpenClawModelAuthStatusPayload | null;
  setup: SetupMetadata | null;
  outcomes: Array<{ provider: string; profileId?: string; status: string }>;
  configuredProviderIds: string[];
}): ModelManagementProvider[] {
  const providerIds = new Set<string>();
  for (const model of input.models) providerIds.add(model.provider);
  for (const outcome of input.auth?.providers ?? []) if (outcome.provider) providerIds.add(outcome.provider);
  for (const capability of input.auth?.providerCapabilities ?? []) if (capability.provider) providerIds.add(capability.provider);
  for (const provider of input.configuredProviderIds) providerIds.add(provider);
  for (const outcome of input.outcomes) if (outcome.provider) providerIds.add(outcome.provider);
  for (const choice of input.setup?.manualProviders ?? []) if (choice.brandId || choice.id) providerIds.add(choice.brandId ?? choice.id.split("-", 1)[0] ?? choice.id);
  for (const option of input.setup?.authOptions ?? []) if (option.brandId) providerIds.add(option.brandId);
  for (const option of input.setup?.prepareOptions ?? []) providerIds.add(option.brandId ?? option.id);

  const authByProvider = new Map((input.auth?.providers ?? []).map((entry) => [entry.provider ?? "", entry]));
  const capabilityByProvider = new Map((input.auth?.providerCapabilities ?? []).map((entry) => [entry.provider ?? "", entry]));
  const outcomeByProvider = new Map(input.outcomes.map((outcome) => [outcome.provider, outcome.status]));

  const providers = [...providerIds].filter(Boolean).map((id) => {
    const models = input.models.filter((model) => model.provider === id);
    const auth = authByProvider.get(id);
    const profiles = (auth?.profiles ?? []).flatMap((profile) => profile.profileId ? [{
      id: profile.profileId,
      type: profile.type ?? "other",
      status: profile.status ?? "unknown",
      ...(profile.reasonCode ? { reasonCode: profile.reasonCode } : {}),
      ...(profile.expiry?.at ? { expiryAt: profile.expiry.at } : {}),
      logoutSupported: profile.logoutSupported === true
    }] : []);
    const setupMethods = resolveSetupMethods(id, input.setup);
    const prepareOptions = resolvePrepareOptions(id, input.setup);
    const status = resolveProviderStatus(auth?.status, outcomeByProvider.get(id), models, profiles, id);
    return {
      id,
      name: modelProviderPresentationRegistry[id]?.displayName || auth?.displayName || formatModelProviderLabel(id),
      status,
      authMethods: setupMethods.length ? setupMethods : profiles.map((profile) => ({
        id: profile.type,
        label: formatAuthType(profile.type),
        kind: toAuthKind(profile.type)
      })),
      prepareOptions,
      profiles,
      modelCount: models.length,
      availableModelCount: models.filter((model) => model.available === true).length,
      local: models.length > 0 && models.every((model) => model.advanced.providerId === "ollama" || model.tags.includes("local")),
      source: "openclaw" as const,
      setupAvailable: setupMethods.length > 0 || prepareOptions.length > 0 || capabilityByProvider.has(id),
      canLogout: profiles.some((profile) => profile.logoutSupported),
      presentation: {
        ...(modelProviderPresentationRegistry[id]?.accent ? { accent: modelProviderPresentationRegistry[id].accent } : {})
      }
    };
  });

  return providers.sort((left, right) => left.name.localeCompare(right.name));
}

function resolveSetupMethods(providerId: string, setup: SetupMetadata | null) {
  if (!setup) return [];
  const methods = new Map<string, { id: string; label: string; kind: "api-key" | "oauth" | "device-code" | "other"; hint?: string; brandId?: string; groupLabel?: string; icon?: string; website?: string; featured?: boolean }>();
  for (const choice of setup.manualProviders) {
    const choiceProvider = choice.brandId ?? choice.id.split("-", 1)[0] ?? choice.id;
    if (choiceProvider !== providerId && !choice.id.startsWith(`${providerId}-`)) continue;
    methods.set(choice.id, { id: choice.id, label: choice.label, ...(choice.brandId ? { brandId: choice.brandId } : {}), ...(choice.groupLabel ? { groupLabel: choice.groupLabel } : {}), ...(choice.hint ? { hint: choice.hint } : {}), ...(choice.icon ? { icon: choice.icon } : {}), ...(choice.website ? { website: choice.website } : {}), kind: "api-key" });
  }
  for (const option of setup.authOptions) {
    if (option.brandId !== providerId && !option.id.startsWith(`${providerId}-`)) continue;
    methods.set(option.id, { id: option.id, label: option.label, ...(option.brandId ? { brandId: option.brandId } : {}), ...(option.groupLabel ? { groupLabel: option.groupLabel } : {}), ...(option.hint ? { hint: option.hint } : {}), ...(option.icon ? { icon: option.icon } : {}), ...(option.website ? { website: option.website } : {}), ...(option.featured !== undefined ? { featured: option.featured } : {}), kind: option.kind });
  }
  return [...methods.values()];
}

function resolvePrepareOptions(providerId: string, setup: SetupMetadata | null) {
  if (!setup) return [];
  return setup.prepareOptions.filter((option) => {
    const optionProvider = option.brandId ?? option.id;
    return optionProvider === providerId || option.id.startsWith(`${providerId}-`);
  });
}

function resolveProviderStatus(
  authStatus: string | undefined,
  outcome: string | undefined,
  models: ModelManagementModel[],
  profiles: ModelManagementAuthProfile[],
  providerId: string
): ModelManagementProvider["status"] {
  const auth = authStatus?.toLowerCase();
  if (auth === "expired" || auth === "missing" || auth === "expiring") return "needs-attention";
  if (outcome === "auth-rejected") return "needs-attention";
  if (outcome === "unavailable") return "unavailable";
  if (outcome === "ready") return "connected";
  if (auth === "ok" || auth === "static" || profiles.some((profile) => ["ok", "static", "expiring"].includes(profile.status))) return "connected";
  if (providerId === "ollama" && models.some((model) => model.available === true)) return "connected";
  if (models.length > 0 && models.every((model) => model.available === false)) return "unavailable";
  return "not-connected";
}

function normalizeSetupMetadata(payload: JsonRecord): SetupMetadata {
  return {
    manualProviders: readArray(payload.manualProviders).flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.label !== "string") return [];
      return [{ id: entry.id, ...(typeof entry.brandId === "string" ? { brandId: entry.brandId } : {}), ...(typeof entry.groupLabel === "string" ? { groupLabel: entry.groupLabel } : {}), label: entry.label, ...(typeof entry.hint === "string" ? { hint: entry.hint } : {}), ...(typeof entry.icon === "string" ? { icon: entry.icon } : {}), ...(typeof entry.website === "string" ? { website: entry.website } : {}) }];
    }),
    authOptions: readArray(payload.authOptions).flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.label !== "string" || (entry.kind !== "oauth" && entry.kind !== "device-code")) return [];
      return [{ id: entry.id, ...(typeof entry.brandId === "string" ? { brandId: entry.brandId } : {}), label: entry.label, ...(typeof entry.hint === "string" ? { hint: entry.hint } : {}), ...(typeof entry.groupLabel === "string" ? { groupLabel: entry.groupLabel } : {}), ...(typeof entry.icon === "string" ? { icon: entry.icon } : {}), ...(typeof entry.website === "string" ? { website: entry.website } : {}), ...(typeof entry.featured === "boolean" ? { featured: entry.featured } : {}), kind: entry.kind }];
    }),
    prepareOptions: readArray(payload.prepareOptions).flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.label !== "string") return [];
      return [{
        id: entry.id,
        ...(typeof entry.brandId === "string" ? { brandId: entry.brandId } : {}),
        label: entry.label,
        ...(typeof entry.hint === "string" ? { hint: entry.hint } : {}),
        ...(typeof entry.actionLabel === "string" ? { actionLabel: entry.actionLabel } : {}),
        ...(typeof entry.icon === "string" ? { icon: entry.icon } : {}),
        ...(typeof entry.website === "string" ? { website: entry.website } : {})
      }];
    })
  };
}

function normalizeDefaults(value: JsonRecord | null) {
  const defaults = isRecord(value) ? value : {};
  const model = isRecord(defaults.model) ? defaults.model : {};
  return {
    model: {
      primary: normalizeOptionalModelRef(model.primary),
      fallbacks: normalizeModelRefs(model.fallbacks)
    },
    models: isRecord(defaults.models) ? defaults.models : {},
    modelPolicy: isRecord(defaults.modelPolicy)
      ? { allow: Array.isArray(defaults.modelPolicy.allow) ? normalizeModelRefs(defaults.modelPolicy.allow) : null }
      : { allow: null }
  };
}

function emptyDefaults() {
  return { model: { primary: null, fallbacks: [] as string[] }, models: {}, modelPolicy: { allow: null } };
}

function readConfiguredProviderIds(value: JsonRecord | null) {
  return isRecord(value) ? Object.keys(value) : [];
}

function normalizeModelRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const modelId = normalizeOpenAiModelId(entry);
    const key = modelId.toLowerCase();
    if (!modelId || seen.has(key)) continue;
    seen.add(key);
    normalized.push(modelId);
  }
  return normalized;
}

function normalizeOptionalModelRef(value: unknown) {
  return typeof value === "string" && value.trim() ? normalizeOpenAiModelId(value) : null;
}

function requiredModelRef(value: string) {
  return requiredText(value, "Model is required.");
}

function requiredText(value: string, message: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(message);
  return normalized;
}

function formatAuthType(value: string) {
  return value === "api_key" ? "API key" : value === "oauth" ? "OAuth" : value === "token" ? "Token" : value;
}

function toAuthKind(value: string): "api-key" | "oauth" | "device-code" | "other" {
  if (value === "api_key") return "api-key";
  if (value === "oauth") return "oauth";
  if (value === "device-code") return "device-code";
  return "other";
}

function readArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
