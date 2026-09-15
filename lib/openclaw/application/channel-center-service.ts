import "server-only";

import {
  getChannelConnectOverview,
  type ChannelConnectProviderView,
  type ChannelConnectOverview
} from "@/lib/openclaw/application/channel-connect-service";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { normalizeChannelConnectAccounts } from "@/lib/openclaw/domains/channel-connect-status";
import { readChannelAccounts } from "@/lib/openclaw/domains/channels";
import type { OpenClawChannelStatusPayload } from "@/lib/openclaw/client/types";
import { redactErrorMessage } from "@/lib/security/redaction";

const CHANNEL_PROVIDER_IDS = new Set(["whatsapp", "telegram", "discord", "slack", "googlechat", "imessage", "signal"]);

export type ChannelCenterProvider = Omit<ChannelConnectProviderView, "id"> & {
  id: string;
  inventorySource: "openclaw-status" | "openclaw-plugin" | "agentos-presentation";
  capabilities: string[];
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
  const [statusResult, pluginsResult, configAccounts] = await Promise.all([
    adapter.getChannelStatus({ probe: false, timeoutMs: 8_000 }, { timeoutMs: 12_000 }).then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error: redactErrorMessage(error, "OpenClaw channel inventory is unavailable.") })
    ),
    adapter.listPlugins({ timeoutMs: 15_000 }).then(
      (value) => ({ value, error: null }),
      () => ({ value: null, error: null })
    ),
    readChannelAccounts()
  ]);

  const status = statusResult.value;
  const plugins = pluginsResult.value?.plugins ?? [];
  const providers = buildProviderInventory(overview, status, plugins, configAccounts);

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
  plugins: Array<{ id: string; name: string; status?: string; enabled?: boolean; channelIds?: string[] }>,
  configAccounts: Awaited<ReturnType<typeof readChannelAccounts>>
) {
  const known = new Map<string, ChannelConnectProviderView>(overview.providers.map((provider) => [provider.id, provider]));
  const providerIds = new Set<string>([
    ...overview.providers.map((provider) => provider.id),
    ...(status?.channelOrder ?? []),
    ...Object.keys(status?.channelAccounts ?? {}),
    ...configAccounts.filter((account) => CHANNEL_PROVIDER_IDS.has(account.type)).map((account) => account.type),
    ...plugins.flatMap((plugin) => plugin.channelIds ?? [])
  ]);

  return Array.from(providerIds).map((id) => {
    const existing = known.get(id);
    if (existing) {
      return {
        ...existing,
        id,
        inventorySource: "agentos-presentation" as const,
        capabilities: inferProviderCapabilities(status, id, plugins)
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
      capabilities: inferProviderCapabilities(status, id, plugins)
    };
  }).sort((left, right) => left.label.localeCompare(right.label));
}

function inferProviderCapabilities(
  status: OpenClawChannelStatusPayload | null,
  provider: string,
  plugins: Array<{ id: string; channelIds?: string[] }>
) {
  const capabilities = new Set<string>();
  if (status?.channelAccounts?.[provider]) capabilities.add("accounts");
  if (plugins.some((plugin) => plugin.id === provider || plugin.channelIds?.includes(provider))) capabilities.add("plugin");
  if (provider === "telegram") capabilities.add("topics");
  return Array.from(capabilities).sort();
}

function humanize(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
