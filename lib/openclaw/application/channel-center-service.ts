import "server-only";

import {
  getChannelConnectOverview,
  type ChannelConnectProviderView,
  type ChannelConnectOverview
} from "@/lib/openclaw/application/channel-connect-service";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { normalizeChannelConnectAccounts } from "@/lib/openclaw/domains/channel-connect-status";
import { readChannelAccounts } from "@/lib/openclaw/domains/channels";
import { getSurfaceKind } from "@/lib/openclaw/surface-catalog";
import type { OpenClawChannelStatusPayload } from "@/lib/openclaw/client/types";
import { redactErrorMessage } from "@/lib/security/redaction";

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
  supportsTopics: boolean;
  supportsGroupPolicy: boolean;
  supportsMentionPolicy: boolean;
  supportsNativeBindings: boolean;
  supportsPluginInstall: boolean;
  supportsPluginDisable: boolean;
  supportsPluginReload: boolean;
};

export type ChannelCenterProvider = Omit<ChannelConnectProviderView, "id"> & {
  id: string;
  inventorySource: "openclaw-status" | "openclaw-plugin" | "agentos-presentation";
  capabilities: ChannelProviderCapabilities;
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
  const overview = await getChannelConnectOverview();
  const adapter = getOpenClawAdapter();
  const [statusResult, pluginsResult, configAccounts, bindingsResult, bindingsSchemaResult, telegramConfigResult] = await Promise.all([
    adapter.getChannelStatus({ probe: false, timeoutMs: 8_000 }, { timeoutMs: 12_000 }).then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error: redactErrorMessage(error, "OpenClaw channel inventory is unavailable.") })
    ),
    adapter.listPlugins({ timeoutMs: 15_000 }).then(
      (value) => ({ value, error: null }),
      () => ({ value: null, error: null })
    ),
    readChannelAccounts(),
    adapter.getConfig<unknown[]>("bindings", { timeoutMs: 10_000 }).catch(() => null),
    adapter.lookupConfigSchema
      ? adapter.lookupConfigSchema({ path: "bindings" }, { timeoutMs: 10_000 }).catch(() => null)
      : Promise.resolve(null),
    adapter.getConfig<Record<string, unknown>>("channels.telegram", { timeoutMs: 10_000 }).catch(() => null)
  ]);

  const status = statusResult.value;
  const plugins = pluginsResult.value?.plugins ?? [];
  const providers = buildProviderInventory(overview, status, plugins, configAccounts, {
    adapter,
    nativeBindingsAvailable: Array.isArray(bindingsResult) || hasNativeBindingSchema(bindingsSchemaResult),
    telegramConfig: telegramConfigResult
  });

  return {
    ...overview,
    statusError: overview.statusError ?? statusResult.error,
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
        capabilities: inferProviderCapabilities(status, id, plugins, runtime, existing.setupMode)
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
      capabilities: inferProviderCapabilities(status, id, plugins, runtime, "external-cli")
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
  const supportsLifecycle = (operation: "start" | "stop" | "restart" | "logout") => {
    const declaredValue = hasDeclared(`supports${operation[0]!.toUpperCase()}${operation.slice(1)}`);
    if (declaredValue) return true;
    if (!runtimeReported) return false;
    if (operation === "start") return typeof runtime.adapter.startChannel === "function";
    if (operation === "stop") return typeof runtime.adapter.stopChannel === "function";
    if (operation === "restart") return typeof runtime.adapter.startChannel === "function" && typeof runtime.adapter.stopChannel === "function";
    return typeof runtime.adapter.logoutChannel === "function";
  };
  const supportsAccounts = accounts.length > 0 || status?.channelAccounts?.[provider] !== undefined;
  const telegramGroupsConfigured = provider === "telegram" && hasTelegramGroups(runtime.telegramConfig);

  return {
    supportsAccounts,
    supportsMultiAccount: accounts.length > 1,
    supportsStart: supportsLifecycle("start"),
    supportsStop: supportsLifecycle("stop"),
    supportsRestart: supportsLifecycle("restart"),
    supportsLogout: supportsLifecycle("logout"),
    supportsQrLogin: hasDeclared("supportsQrLogin") || setupMode === "qr",
    supportsTokenSetup: hasDeclared("supportsTokenSetup") || setupMode === "bot-token" || setupMode === "app-tokens",
    supportsDirectoryPeers: hasDeclared("supportsDirectoryPeers") || supportsAccounts,
    supportsDirectoryGroups: hasDeclared("supportsDirectoryGroups") || telegramGroupsConfigured,
    supportsDirectoryMembers: hasDeclared("supportsDirectoryMembers") || telegramGroupsConfigured,
    supportsTopics: hasDeclared("supportsTopics") || telegramGroupsConfigured && hasTelegramTopics(runtime.telegramConfig),
    supportsGroupPolicy: hasDeclared("supportsGroupPolicy") || telegramGroupsConfigured,
    supportsMentionPolicy: hasDeclared("supportsMentionPolicy") || telegramGroupsConfigured,
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

function hasTelegramGroups(config: Record<string, unknown> | null) {
  if (!config) return false;
  return isRecord(config.groups) || isRecord(config.accounts);
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
