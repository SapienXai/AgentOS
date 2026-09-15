import "server-only";

import {
  getChannelConnectOverview,
  getChannelConnectRuntimeEvidence,
  type ChannelConnectProviderView,
  type ChannelConnectOverview
} from "@/lib/openclaw/application/channel-connect-service";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { normalizeChannelConnectAccounts } from "@/lib/openclaw/domains/channel-connect-status";
import { readChannelAccounts } from "@/lib/openclaw/domains/channels";
import { getSurfaceKind } from "@/lib/openclaw/surface-catalog";
import type { OpenClawChannelStatusPayload } from "@/lib/openclaw/client/types";

export type ChannelProviderCapabilities = {
  supportsAccounts: boolean;
  supportsMultiAccount: boolean;
  supportsStart: boolean;
  supportsStop: boolean;
  supportsRestart: boolean;
  supportsLogout: boolean;
  supportsQrLogin: boolean;
  supportsTokenSetup: boolean;
  supportsDirectoryPeers: boolean;
  supportsDirectoryGroups: boolean;
  supportsDirectoryMembers: boolean;
  supportsDirectoryHierarchy: boolean;
  supportsThreads: boolean;
  supportsRoles: boolean;
  supportsDirectMessages: boolean;
  supportsTopics: boolean;
  supportsGroupPolicy: boolean;
  supportsMentionPolicy: boolean;
  supportsNativeBindings: boolean;
  supportsPluginInstall: boolean;
  supportsPluginDisable: boolean;
  supportsPluginReload: boolean;
};

export type ChannelProviderState = {
  availability: "ready" | "not-installed" | "not-configured" | "degraded" | "unknown";
  pluginInstalled: boolean;
  pluginEnabled: boolean;
  configured: boolean;
  connected: boolean;
  running: boolean;
  accountCount: number;
  accountIds: string[];
  source: "openclaw-status" | "openclaw-plugin" | "agentos-presentation";
  error: string | null;
};

export type ChannelCenterProvider = Omit<ChannelConnectProviderView, "id"> & {
  id: string;
  inventorySource: "openclaw-status" | "openclaw-plugin" | "agentos-presentation";
  capabilities: ChannelProviderCapabilities;
  state: ChannelProviderState;
};

export type ChannelCenterSnapshot = Omit<ChannelConnectOverview, "providers"> & {
  providers: ChannelCenterProvider[];
  plugins: Array<{
    id: string;
    name: string;
    status: string | null;
    enabled: boolean | null;
    channelIds: string[];
  }>;
};

export async function getChannelCenterSnapshot(): Promise<ChannelCenterSnapshot> {
  const runtimeEvidence = await getChannelConnectRuntimeEvidence();
  const overview = await getChannelConnectOverview(runtimeEvidence);
  const adapter = getOpenClawAdapter();
  const providerIds = Array.from(new Set([
    "telegram",
    "discord",
    "slack",
    "whatsapp",
    ...overview.providers.map((provider) => provider.id)
  ]));
  const activeProviderIds = providerIds.filter((provider) => (
    runtimeEvidence.status?.channelOrder?.includes(provider)
      || runtimeEvidence.status?.channelAccounts?.[provider] !== undefined
      || runtimeEvidence.status?.channels?.[provider] !== undefined
      || runtimeEvidence.configAccounts.some((account) => account.type === provider)
      || runtimeEvidence.plugins.some((plugin) => plugin.id === provider || plugin.channelIds?.includes(provider))
  ));
  const [bindingsResult, bindingsSchemaResult, providerEvidence] = await Promise.all([
    adapter.getConfig<unknown[]>("bindings", { timeoutMs: 10_000 }).catch(() => null),
    adapter.lookupConfigSchema
      ? adapter.lookupConfigSchema({ path: "bindings" }, { timeoutMs: 10_000 }).catch(() => null)
      : Promise.resolve(null),
    Promise.all(activeProviderIds.map(async (provider) => {
      const [config, schema] = await Promise.all([
        adapter.getConfig<Record<string, unknown>>(`channels.${provider}`, { timeoutMs: 10_000 }).catch(() => null),
        adapter.lookupConfigSchema
          ? adapter.lookupConfigSchema({ path: `channels.${provider}` }, { timeoutMs: 10_000 }).catch(() => null)
          : Promise.resolve(null)
      ]);
      return [provider, { config, schema }] as const;
    }))
  ]);

  const status = runtimeEvidence.status;
  const plugins = runtimeEvidence.plugins;
  const configAccounts = runtimeEvidence.configAccounts;
  const providers = buildProviderInventory(overview, status, plugins, configAccounts, {
    adapter,
    nativeBindingsAvailable: Array.isArray(bindingsResult) || hasNativeBindingSchema(bindingsSchemaResult),
    telegramConfig: providerEvidence.find(([provider]) => provider === "telegram")?.[1].config ?? null,
    providerConfigs: Object.fromEntries(providerEvidence.map(([provider, evidence]) => [provider, evidence.config])),
    providerSchemas: Object.fromEntries(providerEvidence.map(([provider, evidence]) => [provider, evidence.schema]))
  });

  return {
    ...overview,
    statusError: overview.statusError ?? runtimeEvidence.statusError,
    providers,
    plugins: plugins.map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      status: plugin.status ?? null,
      enabled: typeof plugin.enabled === "boolean" ? plugin.enabled : null,
      channelIds: plugin.channelIds ?? []
    }))
  };
}

function buildProviderInventory(
  overview: ChannelConnectOverview,
  status: OpenClawChannelStatusPayload | null,
  plugins: Array<{ id: string; name: string; status?: string; enabled?: boolean; channelIds?: string[]; dependencyStatus?: { installed?: boolean } }>,
  configAccounts: Awaited<ReturnType<typeof readChannelAccounts>>,
  runtime: {
    adapter: ReturnType<typeof getOpenClawAdapter>;
    nativeBindingsAvailable: boolean;
    telegramConfig: Record<string, unknown> | null;
    providerConfigs?: Record<string, Record<string, unknown> | null>;
    providerSchemas?: Record<string, unknown>;
  }
) {
  const known = new Map<string, ChannelConnectProviderView>(overview.providers.map((provider) => [provider.id, provider]));
  const providerIds = new Set<string>([
    ...overview.providers.map((provider) => provider.id),
    ...(status?.channelOrder ?? []),
    ...Object.keys(status?.channelAccounts ?? {}),
    ...configAccounts.filter((account) => getSurfaceKind(account.type) === "chat").map((account) => account.type),
    ...plugins.flatMap((plugin) => plugin.channelIds ?? [])
  ]);

  return Array.from(providerIds).map((id) => {
    const existing = known.get(id);
    if (existing) {
      return {
        ...existing,
        id,
        inventorySource: status?.channelOrder?.includes(id) || status?.channelAccounts?.[id] !== undefined
          ? "openclaw-status" as const
          : plugins.some((plugin) => plugin.id === id || plugin.channelIds?.includes(id))
            ? "openclaw-plugin" as const
            : "agentos-presentation" as const,
        capabilities: inferProviderCapabilities(status, id, plugins, runtime, existing.setupMode),
        state: buildProviderState(existing, id, status, plugins, configAccounts, runtime)
      };
    }

    const plugin = plugins.find((candidate) => candidate.id === id || candidate.channelIds?.includes(id));
    const accounts = normalizeChannelConnectAccounts(status, id, configAccounts);
    const pluginInstalled = Boolean(plugin) || accounts.length > 0;
    const pluginEnabled = accounts.length > 0 || plugin?.enabled === true || plugin?.status === "loaded" || plugin?.status === "enabled";

    return {
      id,
      label: status?.channelLabels?.[id] ?? humanize(id),
      description: plugin?.name ? `${plugin.name} channel capability reported by OpenClaw.` : "Channel capability reported by OpenClaw.",
      setupMode: "external-cli" as const,
      setupLabel: "OpenClaw setup",
      pluginInstalled,
      pluginEnabled,
      pluginStateSource: "gateway" as const,
      pluginStateError: null,
      configured: accounts.some((account) => account.configured),
      connected: accounts.some((account) => account.connected),
      running: accounts.some((account) => account.running),
      available: pluginInstalled,
      availabilityReason: pluginInstalled ? null : "OpenClaw reported this provider, but no account or installed plugin is available.",
      address: null,
      accounts,
      inventorySource: status?.channelOrder?.includes(id) ? "openclaw-status" as const : "openclaw-plugin" as const,
      capabilities: inferProviderCapabilities(status, id, plugins, runtime, "external-cli"),
      state: buildProviderState({
        pluginInstalled,
        pluginEnabled,
        configured: accounts.some((account) => account.configured),
        connected: accounts.some((account) => account.connected),
        running: accounts.some((account) => account.running),
        pluginStateError: null
      }, id, status, plugins, configAccounts, runtime)
    };
  }).sort((left, right) => left.label.localeCompare(right.label));
}

export function inferProviderCapabilities(
  status: OpenClawChannelStatusPayload | null,
  provider: string,
  plugins: Array<{ id: string; channelIds?: string[]; enabled?: boolean; status?: string; dependencyStatus?: { installed?: boolean } }>,
  runtime: {
    adapter: ReturnType<typeof getOpenClawAdapter>;
    nativeBindingsAvailable: boolean;
    telegramConfig: Record<string, unknown> | null;
    providerConfigs?: Record<string, Record<string, unknown> | null>;
    providerSchemas?: Record<string, unknown>;
  },
  setupMode: ChannelConnectProviderView["setupMode"] = "external-cli"
): ChannelProviderCapabilities {
  const accounts = status?.channelAccounts?.[provider] ?? [];
  const plugin = plugins.find((candidate) => candidate.id === provider || candidate.channelIds?.includes(provider));
  const runtimeReported = Boolean(
    status?.channelOrder?.includes(provider)
      || status?.channelAccounts?.[provider] !== undefined
      || status?.channels?.[provider] !== undefined
      || plugin
  );
  const declared = new Set([
    ...readCapabilityTokens(status?.channels?.[provider]),
    ...accounts.flatMap((account) => readCapabilityTokens(account))
  ].map(normalizeCapabilityToken));
  const hasDeclared = (name: string) => declared.has(normalizeCapabilityToken(name)) || declared.has(normalizeCapabilityToken(name.replace(/^supports/, "")));
  const providerConfig = runtime.providerConfigs?.[provider] ?? (provider === "telegram" ? runtime.telegramConfig : null);
  const providerSchema = runtime.providerSchemas?.[provider] ?? null;
  const hasSchemaProperty = (name: string) => schemaContainsProperty(providerSchema, name);
  const hasConfigProperty = (name: string) => isRecord(providerConfig) && Object.prototype.hasOwnProperty.call(providerConfig, name);
  const supportsLifecycle = (operation: "start" | "stop" | "restart" | "logout") => {
    const declaredValue = hasDeclared(`supports${operation[0]!.toUpperCase()}${operation.slice(1)}`);
    if (declaredValue) return true;
    if (!runtimeReported) return false;
    if (operation === "start") return typeof runtime.adapter.startChannel === "function";
    if (operation === "stop") return typeof runtime.adapter.stopChannel === "function";
    if (operation === "restart") return typeof runtime.adapter.startChannel === "function" && typeof runtime.adapter.stopChannel === "function";
    return typeof runtime.adapter.logoutChannel === "function";
  };
  const runtimeAccountsReported = status?.channelAccounts?.[provider] !== undefined;
  const telegramRouteEvidence = provider === "telegram" && (hasConfigProperty("groups") || hasConfigProperty("accounts"));
  const supportsAccounts = hasDeclared("supportsAccounts")
    || hasSchemaProperty("accounts")
    || hasConfigProperty("accounts")
    || (runtimeAccountsReported && (accounts.length > 0 || declared.size > 0));
  const directoryEvidence = runtimeReported && (hasDeclared("supportsDirectoryGroups") || hasSchemaProperty("groups") || hasSchemaProperty("guilds") || hasSchemaProperty("channels") || telegramRouteEvidence);
  const directEvidence = runtimeReported && (hasDeclared("supportsDirectMessages") || hasSchemaProperty("direct") || hasSchemaProperty("dm") || hasSchemaProperty("dms"));

  return {
    supportsAccounts,
    supportsMultiAccount: hasDeclared("supportsMultiAccount") || hasSchemaProperty("accounts") || hasConfigProperty("accounts") || accounts.length > 1,
    supportsStart: supportsLifecycle("start"),
    supportsStop: supportsLifecycle("stop"),
    supportsRestart: supportsLifecycle("restart"),
    supportsLogout: supportsLifecycle("logout"),
    // Setup mode is presentation guidance only. It becomes an actionable
    // capability after OpenClaw reports the provider or explicitly declares
    // the operation.
    supportsQrLogin: hasDeclared("supportsQrLogin") || runtimeReported && setupMode === "qr",
    supportsTokenSetup: hasDeclared("supportsTokenSetup") || runtimeReported && (setupMode === "bot-token" || setupMode === "app-tokens"),
    supportsDirectoryPeers: hasDeclared("supportsDirectoryPeers") || directEvidence || (runtimeReported && supportsAccounts),
    supportsDirectoryGroups: hasDeclared("supportsDirectoryGroups") || directoryEvidence,
    supportsDirectoryMembers: hasDeclared("supportsDirectoryMembers") || runtimeReported && (hasSchemaProperty("users") || hasSchemaProperty("roles")),
    supportsDirectoryHierarchy: hasDeclared("supportsDirectoryHierarchy") || runtimeReported && (hasSchemaProperty("guilds") || hasSchemaProperty("channels") || hasSchemaProperty("groups")),
    supportsThreads: hasDeclared("supportsThreads") || runtimeReported && (hasSchemaProperty("thread") || hasSchemaProperty("threadBindings") || hasDeclared("threads")),
    supportsRoles: hasDeclared("supportsRoles") || provider === "discord" && runtimeReported && hasSchemaProperty("roles"),
    supportsDirectMessages: hasDeclared("supportsDirectMessages") || directEvidence,
    supportsTopics: hasDeclared("supportsTopics") || provider === "telegram" && runtimeReported && (schemaContainsProperty(providerSchema, "topics") || hasTelegramTopics(providerConfig)),
    supportsGroupPolicy: hasDeclared("supportsGroupPolicy") || runtimeReported && (hasSchemaProperty("groupPolicy") || telegramRouteEvidence),
    supportsMentionPolicy: hasDeclared("supportsMentionPolicy") || runtimeReported && (hasSchemaProperty("requireMention") || telegramRouteEvidence),
    supportsNativeBindings: hasDeclared("supportsNativeBindings") || runtimeReported && runtime.nativeBindingsAvailable,
    supportsPluginInstall: Boolean(plugin?.dependencyStatus?.installed === false),
    supportsPluginDisable: Boolean(plugin),
    supportsPluginReload: Boolean(plugin)
  };
}

function readCapabilityTokens(value: unknown) {
  if (!isRecord(value)) return [] as string[];
  const candidates = [value.capabilities, value.operations, value.features];
  return candidates.flatMap((candidate) => Array.isArray(candidate)
    ? candidate.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim().toLowerCase())
    : []);
}

function normalizeCapabilityToken(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildProviderState(
  provider: Pick<ChannelConnectProviderView, "pluginInstalled" | "pluginEnabled" | "configured" | "connected" | "running" | "pluginStateError">,
  id: string,
  status: OpenClawChannelStatusPayload | null,
  plugins: Array<{ id: string; channelIds?: string[] }>,
  configAccounts: Awaited<ReturnType<typeof readChannelAccounts>>,
  runtime: { providerConfigs?: Record<string, Record<string, unknown> | null> }
): ChannelProviderState {
  const accounts = normalizeChannelConnectAccounts(status, id, configAccounts);
  const inventorySource = status?.channelOrder?.includes(id) || status?.channelAccounts?.[id] !== undefined
    ? "openclaw-status" as const
    : plugins.some((plugin) => plugin.id === id || plugin.channelIds?.includes(id))
      ? "openclaw-plugin" as const
      : "agentos-presentation" as const;
  const configured = provider.configured || accounts.some((account) => account.configured);
  const connected = provider.connected || accounts.some((account) => account.connected);
  const running = provider.running || accounts.some((account) => account.running);
  const availability: ChannelProviderState["availability"] = provider.pluginStateError
    ? "degraded"
    : !provider.pluginInstalled
      ? "not-installed"
      : !configured
        ? "not-configured"
        : status || provider.pluginEnabled
          ? "ready"
          : "unknown";
  const accountIds = accounts.map((account) => account.accountId);
  if (accountIds.length === 0 && isRecord(runtime.providerConfigs?.[id]?.accounts)) {
    accountIds.push(...Object.keys(runtime.providerConfigs[id]!.accounts as Record<string, unknown>));
  }
  return {
    availability,
    pluginInstalled: provider.pluginInstalled,
    pluginEnabled: provider.pluginEnabled,
    configured,
    connected,
    running,
    accountCount: accountIds.length,
    accountIds,
    source: inventorySource,
    error: provider.pluginStateError ?? null
  };
}

function schemaContainsProperty(value: unknown, propertyName: string, seen = new Set<unknown>()): boolean {
  if (!value || typeof value !== "object" || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((entry) => schemaContainsProperty(entry, propertyName, seen));
  const record = value as Record<string, unknown>;
  const properties = isRecord(record.properties);
  if (properties && Object.prototype.hasOwnProperty.call(properties, propertyName)) return true;
  return Object.values(record).some((entry) => schemaContainsProperty(entry, propertyName, seen));
}

function hasTelegramTopics(config: Record<string, unknown> | null) {
  if (!config) return false;
  const rootGroups = isRecord(config.groups) ? config.groups : {};
  if (Object.values(rootGroups).some((group) => isRecord(group) && isRecord(group.topics))) return true;
  const accounts = isRecord(config.accounts) ? config.accounts : {};
  return Object.values(accounts).some((account) => {
    const groups = isRecord(account) && isRecord(account.groups) ? account.groups : {};
    return Object.values(groups).some((group) => isRecord(group) && isRecord(group.topics));
  });
}

function hasNativeBindingSchema(value: unknown) {
  return isRecord(value) && isRecord(value.schema) && value.schema.type === "array";
}

function humanize(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
