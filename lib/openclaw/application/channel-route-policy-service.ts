import "server-only";

import { getOpenClawAdapter, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  readConfigMutationOutcome,
  type OpenClawConfigMutationOutcome
} from "@/lib/openclaw/application/config-mutation-result";
import {
  buildChannelRouteIdentity,
  type ChannelRouteIdentity
} from "@/lib/openclaw/domains/channel-center";
import type { MissionControlSurfaceProvider } from "@/lib/openclaw/types";
import { redactErrorMessage } from "@/lib/security/redaction";

export type ChannelRoutePolicyPatch = {
  enabled?: boolean | null;
  requireMention?: boolean | null;
  groupPolicy?: "open" | "allowlist" | "disabled" | null;
  allowFrom?: string[] | null;
  /** Telegram topic agent routing is native topic config, not a binding. */
  agentId?: string | null;
};

export type TelegramRoutePolicyPatch = ChannelRoutePolicyPatch;

export type ChannelRoutePolicyMutation = {
  provider: MissionControlSurfaceProvider;
  accountId: string;
  route: ChannelRouteIdentity;
  groupId: string | null;
  topicId: string | null;
  /** The exact native route-scope object that was read and mutated. */
  configPath: string;
  changedFields: string[];
  mutations: OpenClawConfigMutationOutcome[];
  applyMode: OpenClawConfigMutationOutcome["applyMode"];
  reloadKind: OpenClawConfigMutationOutcome["reloadKind"];
  restartRequired: boolean;
  hotReloaded: boolean;
  appliedVia: OpenClawConfigMutationOutcome["appliedVia"];
  pending: boolean;
  baseHash: string | null;
  changedPaths: string[];
};

export type TelegramRoutePolicyMutation = ChannelRoutePolicyMutation & {
  provider: "telegram";
  groupId: string;
};

export async function updateChannelRoutePolicy(input: {
  route: ChannelRouteIdentity;
  patch: ChannelRoutePolicyPatch;
  adapter?: OpenClawAdapter;
}): Promise<ChannelRoutePolicyMutation> {
  const route = input.route;
  const accountId = normalizeRequired(route.accountId, "A channel account is required.");
  const adapter = input.adapter ?? getOpenClawAdapter();

  validateAccountId(accountId);
  if (route.kind === "thread") {
    throw new Error(
      "This route inherits its parent OpenClaw route. Thread-specific policy is not supported by the native channel schema."
    );
  }
  if (route.kind === "role") {
    throw new Error("Role selectors are routing constraints, not independent route policy scopes.");
  }
  if (input.patch.agentId !== undefined && !(route.provider === "telegram" && route.kind === "topic")) {
    throw new Error("Agent routing is managed through native OpenClaw bindings for this route.");
  }

  const snapshot = await readProviderConfig(adapter, route.provider);
  const scope = resolveRoutePolicyScope(snapshot.config, {
    ...route,
    accountId
  });
  const nextScope = { ...scope.current };
  const changedFields: string[] = [];

  for (const field of ["enabled", "requireMention", "groupPolicy", "allowFrom", "agentId"] as const) {
    const requested = input.patch[field];
    if (requested === undefined) continue;

    const configField = resolveConfigField(field, scope.current);
    if (!isPolicyFieldSupported(route, field, scope.current)) {
      throw new Error(`${route.provider} does not expose ${field} for this route scope.`);
    }

    const normalized = normalizePolicyValue(field, requested);
    const current = scope.current[configField];
    if (normalized === null) {
      if (Object.prototype.hasOwnProperty.call(scope.current, configField)) {
        delete nextScope[configField];
        changedFields.push(field);
      }
      continue;
    }
    if (!sameValue(current, normalized)) {
      nextScope[configField] = normalized;
      changedFields.push(field);
    }
  }

  if (changedFields.length === 0) {
    return createNoopMutation(route, scope.configPath);
  }

  // The native adapter reads the same current path, emits one merge patch,
  // and checks baseHash before applying. The copied object preserves unknown
  // provider-owned siblings without rewriting the provider or account.
  const result = await adapter.setConfig(scope.configPath, nextScope, {
    strictJson: true,
    ...(snapshot.baseHash ? { baseHash: snapshot.baseHash } : {}),
    replacePaths: [scope.configPath],
    timeoutMs: 15_000
  });
  const mutation = readConfigMutationOutcome(result, scope.configPath);

  return {
    provider: route.provider,
    accountId,
    route,
    groupId: route.kind === "topic" ? route.parentRouteId : route.kind === "group" ? route.routeId : null,
    topicId: route.kind === "topic" ? route.routeId : null,
    configPath: scope.configPath,
    changedFields,
    mutations: [mutation],
    applyMode: mutation.applyMode,
    reloadKind: mutation.reloadKind,
    restartRequired: mutation.restartRequired,
    hotReloaded: mutation.hotReloaded,
    appliedVia: mutation.appliedVia,
    pending: mutation.pending,
    baseHash: mutation.baseHash ?? snapshot.baseHash,
    changedPaths: mutation.changedPaths
  };
}

export async function updateTelegramRoutePolicy(input: {
  accountId: string;
  groupId: string;
  topicId?: string | null;
  patch: TelegramRoutePolicyPatch;
  adapter?: OpenClawAdapter;
}): Promise<TelegramRoutePolicyMutation> {
  const accountId = normalizeRequired(input.accountId, "A Telegram account is required.");
  const groupId = normalizeRequired(input.groupId, "A Telegram group is required.");
  const topicId = normalizeOptional(input.topicId);
  const route = buildChannelRouteIdentity({
    provider: "telegram",
    accountId,
    kind: topicId ? "topic" : "group",
    routeId: topicId ?? groupId,
    ...(topicId ? { parentRouteId: groupId } : {})
  });
  const result = await updateChannelRoutePolicy({ route, patch: input.patch, adapter: input.adapter });
  return {
    ...result,
    provider: "telegram",
    groupId,
    topicId
  };
}

type ProviderConfigSnapshot = {
  config: Record<string, unknown>;
  baseHash: string | null;
};

type RoutePolicyScope = {
  configPath: string;
  current: Record<string, unknown>;
};

async function readProviderConfig(
  adapter: OpenClawAdapter,
  provider: MissionControlSurfaceProvider
): Promise<ProviderConfigSnapshot> {
  if (adapter.getConfigSnapshot) {
    try {
      const snapshot = await adapter.getConfigSnapshot({ timeoutMs: 10_000 });
      const root = isRecord(snapshot.config) ? snapshot.config : {};
      const channels = isRecord(root.channels) ? root.channels : null;
      const providerConfig = channels && isRecord(channels[provider])
        ? channels[provider]
        : isProviderConfigShape(root)
          ? root
          : {};
      return {
        config: providerConfig,
        baseHash: normalizeString(snapshot.hash ?? snapshot.configRevisionHash ?? snapshot.appliedConfigHash)
      };
    } catch {
      // Older/CLI adapters may not expose config.get snapshots. Use their
      // provider-scoped read without pretending it has an optimistic hash.
    }
  }

  const config = await adapter.getConfig<Record<string, unknown>>(`channels.${provider}`, { timeoutMs: 10_000 });
  return { config: isRecord(config) ? config : {}, baseHash: null };
}

function resolveRoutePolicyScope(
  providerConfig: Record<string, unknown>,
  route: ChannelRouteIdentity
): RoutePolicyScope {
  const provider = route.provider.toLowerCase();
  const accountId = route.accountId;
  const routeMapKey = provider === "discord"
    ? "guilds"
    : provider === "slack"
      ? "channels"
      : route.kind === "dm"
        ? "direct"
        : "groups";
  const accounts = isRecord(providerConfig.accounts) ? providerConfig.accounts : {};
  const accountConfig = isRecord(accounts[accountId]) ? accounts[accountId] : null;
  const useAccountScope = Boolean(accountConfig && (
    accountId !== "default"
      || Object.prototype.hasOwnProperty.call(accountConfig, routeMapKey)
  ));
  const root = useAccountScope ? accountConfig ?? {} : providerConfig;
  const basePath = useAccountScope
    ? `channels.${provider}.accounts[${JSON.stringify(accountId)}]`
    : `channels.${provider}`;

  if (route.kind === "topic") {
    if (provider !== "telegram" || !route.parentRouteId) {
      throw new Error("Only Telegram topics have a native child policy scope.");
    }
    const groupPath = appendConfigKeyPath(appendConfigKeyPath(`${basePath}.groups`, route.parentRouteId), "topics");
    const topics = nestedRecord(root, ["groups", route.parentRouteId, "topics"]);
    return {
      configPath: appendConfigKeyPath(groupPath, route.routeId),
      current: asRecord(topics[route.routeId])
    };
  }

  if (provider === "discord") {
    if (route.kind === "group") {
      const path = appendConfigKeyPath(`${basePath}.guilds`, route.routeId);
      return { configPath: path, current: asRecord(nestedRecord(root, ["guilds"])[route.routeId]) };
    }
    if (route.kind === "channel" && route.parentRouteId) {
      const path = appendConfigKeyPath(
        appendConfigKeyPath(`${basePath}.guilds`, route.parentRouteId),
        "channels"
      );
      const channelMap = nestedRecord(root, ["guilds", route.parentRouteId, "channels"]);
      return { configPath: appendConfigKeyPath(path, route.routeId), current: asRecord(channelMap[route.routeId]) };
    }
  }

  if (provider === "slack" && route.kind === "channel") {
    const path = appendConfigKeyPath(`${basePath}.channels`, route.routeId);
    return { configPath: path, current: asRecord(nestedRecord(root, ["channels"])[route.routeId]) };
  }

  if ((provider === "telegram" || provider === "whatsapp") && route.kind === "group") {
    const path = appendConfigKeyPath(`${basePath}.groups`, route.routeId);
    return { configPath: path, current: asRecord(nestedRecord(root, ["groups"])[route.routeId]) };
  }

  throw new Error(`${route.provider} does not expose an editable native policy scope for this route.`);
}

function isPolicyFieldSupported(
  route: ChannelRouteIdentity,
  field: keyof ChannelRoutePolicyPatch,
  current: Record<string, unknown>
) {
  const provider = route.provider.toLowerCase();
  const configField = resolveConfigField(field, current);
  if (Object.prototype.hasOwnProperty.call(current, configField)) return true;
  if (field === "agentId") return provider === "telegram" && route.kind === "topic";
  if (field === "groupPolicy" || field === "allowFrom") {
    return provider === "telegram" && (route.kind === "group" || route.kind === "topic");
  }
  if (field === "requireMention") {
    return (provider === "telegram" || provider === "whatsapp") && route.kind === "group"
      || (provider === "discord" && (route.kind === "group" || route.kind === "channel"))
      || (provider === "slack" && route.kind === "channel")
      || (provider === "telegram" && route.kind === "topic");
  }
  if (field === "enabled") {
    return (provider === "telegram" && (route.kind === "group" || route.kind === "topic"))
      || ((provider === "discord" || provider === "slack") && route.kind === "channel");
  }
  return false;
}

function resolveConfigField(
  field: keyof ChannelRoutePolicyPatch,
  current: Record<string, unknown>
) {
  if (field === "allowFrom" && Object.prototype.hasOwnProperty.call(current, "groupAllowFrom")) {
    return "groupAllowFrom";
  }
  return field;
}

function normalizePolicyValue(field: keyof ChannelRoutePolicyPatch, value: unknown) {
  if (value === null) return null;
  if (field === "allowFrom") {
    return Array.isArray(value)
      ? value.map((entry) => String(entry).trim()).filter(Boolean)
      : [];
  }
  if (field === "agentId") {
    return typeof value === "string" ? value.trim() || null : null;
  }
  return value;
}

function createNoopMutation(route: ChannelRouteIdentity, configPath: string): ChannelRoutePolicyMutation {
  return {
    provider: route.provider,
    accountId: route.accountId,
    route,
    groupId: route.kind === "group" ? route.routeId : route.parentRouteId,
    topicId: route.kind === "topic" ? route.routeId : null,
    configPath,
    changedFields: [],
    mutations: [],
    applyMode: "live",
    reloadKind: "none",
    restartRequired: false,
    hotReloaded: false,
    appliedVia: "noop",
    pending: false,
    baseHash: null,
    changedPaths: []
  };
}

function nestedRecord(root: Record<string, unknown>, keys: string[]) {
  let value: unknown = root;
  for (const key of keys) {
    value = isRecord(value) ? value[key] : null;
  }
  return isRecord(value) ? value : {};
}

function asRecord(value: unknown) {
  return isRecord(value) ? value : {};
}

function isProviderConfigShape(value: Record<string, unknown>) {
  return ["accounts", "groups", "guilds", "channels", "direct", "enabled", "groupPolicy"].some((key) => key in value);
}

function appendConfigKeyPath(parent: string, key: string) {
  return `${parent}[${JSON.stringify(key)}]`;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeRequired(value: string, message: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(message);
  return normalized;
}

function normalizeOptional(value: string | null | undefined) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function validateAccountId(accountId: string) {
  if (!/^[A-Za-z0-9_.-]{1,128}$/.test(accountId)) {
    throw new Error("The channel account identifier is invalid.");
  }
}

function normalizeString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() || null : null;
}

export function formatChannelRoutePolicyError(error: unknown) {
  return redactErrorMessage(error, "OpenClaw channel route policy could not be updated.");
}

export function formatTelegramRoutePolicyError(error: unknown) {
  return formatChannelRoutePolicyError(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
