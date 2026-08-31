import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { getOpenClawLifecycleService } from "@/lib/openclaw/lifecycle/service";
import {
  isPluginApiVersionMismatch,
  resolveChannelPluginActivation
} from "@/lib/openclaw/application/channel-plugin-compat";
import { resolveOpenClawVersion, runOpenClaw, runOpenClawJson } from "@/lib/openclaw/cli";
import type { OpenClawChannelStatusPayload } from "@/lib/openclaw/client/types";
import { OPENCLAW_RECOMMENDED_VERSION, OPENCLAW_SUPPORTED_BASELINE_VERSION } from "@/lib/openclaw/versions";
import { redactErrorMessage } from "@/lib/security/redaction";
import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import {
  isVerifiedNativeAuthorizationProof,
  resolveRequiredScopes
} from "@/lib/openclaw/identity/authorization";
import type { OpenClawCommandOptions } from "@/lib/openclaw/client/types";

export const CHANNEL_CONNECT_PROVIDERS = [
  "whatsapp",
  "telegram",
  "discord",
  "slack",
  "googlechat",
  "imessage",
  "signal"
] as const;

export type ChannelConnectProviderId = (typeof CHANNEL_CONNECT_PROVIDERS)[number];
export type ChannelConnectSetupMode = "qr" | "bot-token" | "app-tokens" | "cloud" | "local-mac" | "external-cli";

export type ChannelConnectProviderView = {
  id: ChannelConnectProviderId;
  label: string;
  description: string;
  setupMode: ChannelConnectSetupMode;
  setupLabel: string;
  pluginInstalled: boolean;
  pluginEnabled: boolean;
  pluginStateSource: "gateway" | "cli-fallback" | "inferred";
  pluginStateError: string | null;
  configured: boolean;
  connected: boolean;
  running: boolean;
  available: boolean;
  availabilityReason: string | null;
  address: string | null;
  accounts: Array<{
    accountId: string;
    name: string;
    configured: boolean;
    linked: boolean;
    running: boolean;
    connected: boolean;
    lastError: string | null;
  }>;
};

export type ChannelConnectOverview = {
  installedOpenClawVersion: string | null;
  recommendedOpenClawVersion: string;
  supportedBaselineVersion: string;
  gatewayAvailable: boolean;
  statusError: string | null;
  pluginDiscoveryError: string | null;
  providers: ChannelConnectProviderView[];
};

type ProviderDefinition = {
  id: ChannelConnectProviderId;
  label: string;
  description: string;
  setupMode: ChannelConnectSetupMode;
  setupLabel: string;
  installPackage?: string;
  bundledPluginId?: string;
  implemented: boolean;
  availabilityReason?: string;
};

const PROVIDERS: ProviderDefinition[] = [
  {
    id: "whatsapp",
    label: "WhatsApp",
    description: "Link a dedicated WhatsApp account with OpenClaw's secure QR flow.",
    setupMode: "qr",
    setupLabel: "QR code",
    installPackage: "@openclaw/whatsapp",
    implemented: true
  },
  {
    id: "telegram",
    label: "Telegram",
    description: "Connect a Telegram bot created with BotFather.",
    setupMode: "bot-token",
    setupLabel: "Bot token",
    bundledPluginId: "telegram",
    implemented: true
  },
  {
    id: "discord",
    label: "Discord",
    description: "Connect a Discord application bot for servers, channels, and DMs.",
    setupMode: "bot-token",
    setupLabel: "Bot token",
    installPackage: "@openclaw/discord",
    implemented: true
  },
  {
    id: "slack",
    label: "Slack",
    description: "Connect a Slack app using Socket Mode credentials.",
    setupMode: "app-tokens",
    setupLabel: "App tokens",
    installPackage: "@openclaw/slack",
    implemented: true
  },
  {
    id: "googlechat",
    label: "Google Chat",
    description: "Connect a Google Cloud Chat app backed by a service account and public HTTPS webhook.",
    setupMode: "cloud",
    setupLabel: "Cloud setup",
    implemented: false,
    availabilityReason: "Google Cloud service-account upload and public webhook verification are not available in AgentOS yet."
  },
  {
    id: "imessage",
    label: "iMessage",
    description: "Use the signed-in Messages account on a macOS OpenClaw host.",
    setupMode: "local-mac",
    setupLabel: "Local Mac",
    bundledPluginId: "imessage",
    implemented: false,
    availabilityReason: "iMessage requires imsg, Full Disk Access, and macOS Automation permissions on the Gateway host."
  },
  {
    id: "signal",
    label: "Signal",
    description: "Connect a dedicated Signal account through signal-cli.",
    setupMode: "external-cli",
    setupLabel: "External CLI",
    implemented: false,
    availabilityReason: "Signal requires a separately installed and registered signal-cli runtime."
  }
];

export async function getChannelConnectOverview(): Promise<ChannelConnectOverview> {
  const adapter = getOpenClawAdapter();
  const [version, statusResult, pluginsResult] = await Promise.all([
    resolveOpenClawVersion(),
    adapter.getChannelStatus({ probe: false, timeoutMs: 8_000 }, { timeoutMs: 12_000 }).then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error: redactErrorMessage(error, "OpenClaw channel status is unavailable.") })
    ),
    adapter.listPlugins({ timeoutMs: 15_000 }).then(
      (value) => ({ value, error: null }),
      (error) => ({ value: null, error: redactErrorMessage(error, "OpenClaw plugin discovery is unavailable.") })
    )
  ]);

  const status = statusResult.value;
  const plugins = pluginsResult.value?.plugins ?? [];
  const bundledPluginInspections = new Map<ChannelConnectProviderId, BundledPluginInspection>();
  const bundledProvidersMissingFromGateway = PROVIDERS.filter(
    (definition) => definition.implemented
      && definition.bundledPluginId
      && !plugins.some(
        (candidate) => candidate.id === definition.id || candidate.channelIds?.includes(definition.id)
      )
  );

  await Promise.all(bundledProvidersMissingFromGateway.map(async (definition) => {
    bundledPluginInspections.set(definition.id, await inspectBundledPlugin(definition.bundledPluginId!));
  }));

  return {
    installedOpenClawVersion: version,
    recommendedOpenClawVersion: OPENCLAW_RECOMMENDED_VERSION,
    supportedBaselineVersion: OPENCLAW_SUPPORTED_BASELINE_VERSION,
    gatewayAvailable: Boolean(status),
    statusError: statusResult.error,
    pluginDiscoveryError: pluginsResult.error,
    providers: PROVIDERS.map((definition) => {
      const plugin = plugins.find(
        (candidate) => candidate.id === definition.id || candidate.channelIds?.includes(definition.id)
      );
      const bundledInspection = bundledPluginInspections.get(definition.id);
      const inspectedPlugin = bundledInspection?.plugin ?? null;
      const accounts = normalizeAccounts(status, definition.id);
      const pluginInstalled = Boolean(plugin || inspectedPlugin || definition.bundledPluginId) || accounts.length > 0;
      const pluginEnabled = Boolean(
        accounts.length > 0
          || plugin?.enabled
          || plugin?.status === "loaded"
          || plugin?.status === "enabled"
          || inspectedPlugin?.enabled
          || inspectedPlugin?.status === "loaded"
          || inspectedPlugin?.status === "enabled"
      );

      return {
        id: definition.id,
        label: definition.label,
        description: definition.description,
        setupMode: definition.setupMode,
        setupLabel: definition.setupLabel,
        pluginInstalled,
        pluginEnabled,
        pluginStateSource: plugin ? "gateway" : inspectedPlugin ? "cli-fallback" : "inferred",
        pluginStateError: bundledInspection?.error ?? null,
        configured: accounts.some((account) => account.configured),
        connected: accounts.some((account) => account.connected || account.linked),
        running: accounts.some((account) => account.running),
        available: definition.implemented,
        availabilityReason: definition.implemented ? null : definition.availabilityReason ?? "This setup is not available yet.",
        address: resolveProviderAddress(status, definition.id),
        accounts
      };
    })
  };
}

export async function installChannelPlugin(
  provider: ChannelConnectProviderId,
  options: OpenClawCommandOptions = {}
) {
  const definition = requireProvider(provider);
  const adapter = getOpenClawAdapter();
  const [runtimeVersion, pluginsPayload] = await Promise.all([
    resolveOpenClawVersion(),
    adapter.listPlugins({ timeoutMs: 15_000 })
  ]);
  const plugin = pluginsPayload.plugins.find(
    (candidate) => candidate.id === provider || candidate.channelIds?.includes(provider)
  );
  const pluginEnabled = Boolean(
    plugin?.enabled || plugin?.status === "loaded" || plugin?.status === "enabled"
  );

  const activation = resolveChannelPluginActivation({
    pluginId: plugin?.id ?? definition.bundledPluginId ?? null,
    pluginEnabled,
    installPackage: definition.installPackage ?? null,
    runtimeVersion
  });

  if (activation.action === "already-enabled") {
    return {
      provider,
      installed: true,
      transport: "cli-fallback" as const,
      action: "already-enabled" as const,
      runtimeVersion,
      command: null,
      restarted: false,
      restartError: null
    };
  }

  let action: "enable" | "install";
  let commandArgs: string[];
  let commandLabel: string;

  if (activation.action === "enable") {
    action = "enable";
    commandArgs = ["plugins", "enable", activation.spec];
    commandLabel = `openclaw plugins enable ${activation.spec}`;
  } else {
    if (activation.action !== "install") {
      throw new Error(
        runtimeVersion
          ? `No installable ${definition.label} plugin is defined for OpenClaw ${runtimeVersion}.`
          : `OpenClaw version could not be detected, so AgentOS will not install an unpinned ${definition.label} plugin.`
      );
    }

    action = "install";
    commandArgs = ["plugins", "install", activation.spec];
    commandLabel = `openclaw plugins install ${activation.spec}`;
  }

  try {
    await assertVerifiedCliMutationFallback("plugins.install", { provider }, options);
    await runOpenClaw(commandArgs, { ...options, timeoutMs: 4 * 60_000 });
  } catch (error) {
    if (isPluginApiVersionMismatch(error)) {
      throw new Error(
        `${definition.label} has no plugin build compatible with OpenClaw ${runtimeVersion ?? "this runtime"}. Update OpenClaw, then retry.`
      );
    }
    throw error;
  }

  let restarted = false;
  let restartError: string | null = null;

  try {
    await getOpenClawLifecycleService().restart();
    restarted = true;
  } catch (error) {
    restartError = redactErrorMessage(error, "The plugin was installed, but the Gateway could not be restarted.");
  }

  return {
    provider,
    installed: true,
    transport: "cli-fallback" as const,
    action,
    runtimeVersion,
    command: commandLabel,
    restarted,
    restartError
  };
}

export async function startChannelWebLogin(
  input: { provider: ChannelConnectProviderId; accountId?: string; force?: boolean },
  options: OpenClawCommandOptions = {}
) {
  if (input.provider !== "whatsapp") {
    throw new Error(`${requireProvider(input.provider).label} does not support the OpenClaw web QR login flow.`);
  }

  const adapter = getOpenClawAdapter();
  if (!adapter.startWebLogin) {
    throw new Error("This OpenClaw adapter does not support native web login.");
  }
  return adapter.startWebLogin(
    { accountId: normalizeAccountId(input.accountId), force: input.force ?? true, timeoutMs: 35_000 },
    { ...options, timeoutMs: 45_000 }
  );
}

export async function waitForChannelWebLogin(input: {
  provider: ChannelConnectProviderId;
  accountId?: string;
  currentQrDataUrl?: string;
}, options: OpenClawCommandOptions = {}) {
  if (input.provider !== "whatsapp") {
    throw new Error(`${requireProvider(input.provider).label} does not support the OpenClaw web QR login flow.`);
  }

  const adapter = getOpenClawAdapter();
  if (!adapter.waitForWebLogin) {
    throw new Error("This OpenClaw adapter does not support native web login wait.");
  }
  return adapter.waitForWebLogin(
    {
      accountId: normalizeAccountId(input.accountId),
      currentQrDataUrl: input.currentQrDataUrl,
      timeoutMs: 30_000
    },
    { ...options, timeoutMs: 40_000 }
  );
}

export async function logoutConnectedChannel(
  input: { provider: ChannelConnectProviderId; accountId?: string },
  options: OpenClawCommandOptions = {}
) {
  requireProvider(input.provider);
  const adapter = getOpenClawAdapter();
  if (!adapter.logoutChannel) {
    throw new Error("This OpenClaw adapter does not support channel logout.");
  }
  return adapter.logoutChannel(
    { channel: input.provider, accountId: normalizeAccountId(input.accountId) },
    { ...options, timeoutMs: 30_000 }
  );
}

export async function approveChannelPairing(input: {
  provider: ChannelConnectProviderId;
  code: string;
  accountId?: string;
}, options: OpenClawCommandOptions = {}) {
  const definition = requireProvider(input.provider);
  const code = input.code.trim();

  if (input.provider !== "whatsapp") {
    throw new Error(`${definition.label} pairing approval is not available in this flow.`);
  }
  if (!/^[A-Za-z0-9-]{4,32}$/.test(code)) {
    throw new Error("Enter the pairing code sent by OpenClaw in WhatsApp.");
  }

  const args = ["pairing", "approve", "whatsapp", code];
  const accountId = normalizeAccountId(input.accountId);
  if (accountId) {
    args.push("--account", accountId);
  }
  args.push("--notify");

  await assertVerifiedCliMutationFallback("channels.pairing.approve", {
    provider: input.provider,
    accountId,
    code
  }, options);
  await runOpenClaw(args, { ...options, timeoutMs: 30_000 });

  return {
    provider: input.provider,
    accountId: accountId ?? "default",
    approved: true,
    transport: "cli-fallback" as const
  };
}

function requireProvider(provider: ChannelConnectProviderId) {
  const definition = PROVIDERS.find((candidate) => candidate.id === provider);
  if (!definition) {
    throw new Error("Unsupported OpenClaw channel provider.");
  }
  return definition;
}

async function assertVerifiedCliMutationFallback(
  method: string,
  params: Record<string, unknown>,
  options: OpenClawCommandOptions
) {
  const identity = await getOpenClawGatewayClient().getOperatorIdentity?.();
  if (identity && isVerifiedNativeAuthorizationProof(options.authorizationProof, identity, method, params)) {
    return;
  }

  const requiredScopes = resolveRequiredScopes(method, params);
  throw new Error(
    `CLI fallback for OpenClaw mutation ${method} requires a current native Gateway authorization proof for ${requiredScopes.join(", ")}.`
  );
}

function normalizeAccountId(value?: string) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeAccounts(status: OpenClawChannelStatusPayload | null, provider: ChannelConnectProviderId) {
  return (status?.channelAccounts?.[provider] ?? []).map((account) => ({
    accountId: account.accountId,
    name: account.name?.trim() || account.accountId,
    configured: account.configured === true,
    linked: account.linked === true,
    running: account.running === true,
    connected: account.connected === true,
    lastError: typeof account.lastError === "string" && account.lastError.trim()
      ? redactErrorMessage(account.lastError, "OpenClaw reported a channel error.")
      : null
  }));
}

function resolveProviderAddress(status: OpenClawChannelStatusPayload | null, provider: ChannelConnectProviderId) {
  if (provider !== "whatsapp") return null;

  const channel = status?.channels?.[provider];
  if (!isRecord(channel) || !isRecord(channel.self)) return null;

  const e164 = channel.self.e164;
  return typeof e164 === "string" && e164.trim() ? e164.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type BundledPluginInspection = {
  plugin: {
    enabled?: boolean;
    status?: string;
  } | null;
  error: string | null;
};

async function inspectBundledPlugin(pluginId: string): Promise<BundledPluginInspection> {
  try {
    const payload = await runOpenClawJson<{
      plugin?: {
        enabled?: boolean;
        status?: string;
      };
    }>(["plugins", "inspect", pluginId, "--json"], { timeoutMs: 15_000 });

    return {
      plugin: payload.plugin ?? null,
      error: null
    };
  } catch (error) {
    return {
      plugin: null,
      error: redactErrorMessage(error, `OpenClaw could not inspect the bundled ${pluginId} plugin.`)
    };
  }
}
