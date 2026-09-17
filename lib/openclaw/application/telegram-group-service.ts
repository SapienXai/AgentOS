import "server-only";

import { getOpenClawAdapter, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  readConfigMutationOutcome,
  type OpenClawConfigMutationOutcome
} from "@/lib/openclaw/application/config-mutation-result";
import {
  getChannelRouteBinding,
  setChannelRouteBinding,
  type ChannelRouteBindingResolution,
  type ChannelRouteBindingMutation
} from "@/lib/openclaw/application/channel-route-binding-service";
import { buildChannelRouteIdentity, type ChannelRouteIdentity } from "@/lib/openclaw/domains/channel-center";
import { redactErrorMessage } from "@/lib/security/redaction";

const TELEGRAM_PROVIDER = "telegram" as const;

export type TelegramGroupRegistration = {
  accountId: string;
  groupId: string;
  route: ChannelRouteIdentity;
  configPath: string;
  changed: boolean;
  mutation: OpenClawConfigMutationOutcome | null;
  verification: {
    verified: boolean;
    source: "openclaw-config";
    accountScope: "root" | "account";
  };
};

export type TelegramGroupConnection = {
  registration: TelegramGroupRegistration;
  binding: ChannelRouteBindingMutation;
  bindingVerification: {
    verified: boolean;
    effectiveAgentId: string | null;
    explicitAgentId: string | null;
    match: ChannelRouteBindingResolution["effectiveMatch"];
  };
};

export class TelegramGroupIdError extends Error {
  constructor() {
    super("Enter a valid Telegram group ID, such as -1001234567890.");
    this.name = "TelegramGroupIdError";
  }
}

export class TelegramGroupVerificationError extends Error {
  readonly groupId: string;
  readonly configPath: string;

  constructor(input: { groupId: string; configPath: string }) {
    super("The group was saved, but OpenClaw has not confirmed it yet. Refresh to check again.");
    this.name = "TelegramGroupVerificationError";
    this.groupId = input.groupId;
    this.configPath = input.configPath;
  }
}

export class TelegramGroupBindingConflictError extends Error {
  readonly route: ChannelRouteIdentity;
  readonly existingAgentId: string;
  readonly resolution: ChannelRouteBindingResolution;

  constructor(input: {
    route: ChannelRouteIdentity;
    existingAgentId: string;
    resolution: ChannelRouteBindingResolution;
  }) {
    super(`This Telegram group is already connected to agent ${input.existingAgentId}. Reassign it explicitly before connecting it to another agent.`);
    this.name = "TelegramGroupBindingConflictError";
    this.route = input.route;
    this.existingAgentId = input.existingAgentId;
    this.resolution = input.resolution;
  }
}

export class TelegramGroupConnectionError extends Error {
  readonly registration: TelegramGroupRegistration;
  readonly cause: unknown;

  constructor(input: { registration: TelegramGroupRegistration; cause: unknown }) {
    super("The group was saved, but it could not be connected to this agent. Retry the connection from this agent.");
    this.name = "TelegramGroupConnectionError";
    this.registration = input.registration;
    this.cause = input.cause;
  }
}

export async function registerTelegramGroup(input: {
  accountId: string;
  groupId: string;
  adapter?: OpenClawAdapter;
}): Promise<TelegramGroupRegistration> {
  const accountId = normalizeRequired(input.accountId, "A Telegram account is required.");
  const groupId = normalizeTelegramGroupId(input.groupId);
  const adapter = input.adapter ?? getOpenClawAdapter();
  const initial = await readTelegramProviderConfig(adapter);
  const scope = resolveGroupScope(initial.config, accountId, groupId);
  const existingGroup = scope.groups && Object.prototype.hasOwnProperty.call(scope.groups, groupId)
    ? scope.groups[groupId]
    : undefined;
  const route = buildChannelRouteIdentity({
    provider: TELEGRAM_PROVIDER,
    accountId,
    kind: "group",
    routeId: groupId
  });

  if (existingGroup !== undefined) {
    const verification = await verifyTelegramGroup(adapter, accountId, groupId);
    if (!verification.verified) {
      throw new TelegramGroupVerificationError({ groupId, configPath: scope.configPath });
    }
    return {
      accountId,
      groupId,
      route,
      configPath: scope.groupPath,
      changed: false,
      mutation: null,
      verification
    };
  }

  const result = await adapter.setConfig(scope.groupPath, { requireMention: true }, {
    strictJson: true,
    ...(initial.baseHash ? { baseHash: initial.baseHash } : {}),
    replacePaths: [scope.groupPath],
    timeoutMs: 15_000
  });
  const mutation = readConfigMutationOutcome(result, scope.groupPath);
  const verification = await verifyTelegramGroup(adapter, accountId, groupId);
  if (!verification.verified) {
    throw new TelegramGroupVerificationError({ groupId, configPath: scope.configPath });
  }

  return {
    accountId,
    groupId,
    route,
    configPath: scope.groupPath,
    changed: true,
    mutation,
    verification
  };
}

export async function registerAndConnectTelegramGroup(input: {
  accountId: string;
  groupId: string;
  agentId: string;
  adapter?: OpenClawAdapter;
}): Promise<TelegramGroupConnection> {
  const accountId = normalizeRequired(input.accountId, "A Telegram account is required.");
  const agentId = normalizeRequired(input.agentId, "An agent is required to connect a Telegram group.");
  const groupId = normalizeTelegramGroupId(input.groupId);
  const adapter = input.adapter ?? getOpenClawAdapter();
  const route = buildChannelRouteIdentity({
    provider: TELEGRAM_PROVIDER,
    accountId,
    kind: "group",
    routeId: groupId
  });

  await assertTelegramRouteCanBeClaimed(route, agentId, adapter);
  const registration = await registerTelegramGroup({ accountId, groupId, adapter });

  try {
    await assertTelegramRouteCanBeClaimed(route, agentId, adapter);
    const binding = await setChannelRouteBinding({ route, agentId, adapter });
    const resolved = await getChannelRouteBinding(route, { adapter });
    const verified = resolved.agentId === agentId
      && resolved.explicitAgentId === agentId
      && !resolved.editingAmbiguity;

    if (!verified) {
      throw new Error(
        resolved.agentId
          ? `OpenClaw still resolves this Telegram group to agent ${resolved.agentId}.`
          : "OpenClaw did not confirm the Telegram route binding."
      );
    }

    return {
      registration,
      binding,
      bindingVerification: {
        verified,
        effectiveAgentId: resolved.agentId,
        explicitAgentId: resolved.explicitAgentId,
        match: resolved.effectiveMatch
      }
    };
  } catch (error) {
    if (error instanceof TelegramGroupBindingConflictError) throw error;
    throw new TelegramGroupConnectionError({ registration, cause: error });
  }
}

export function normalizeTelegramGroupId(value: string) {
  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized)) {
    throw new TelegramGroupIdError();
  }
  return normalized;
}

export function formatTelegramGroupError(error: unknown) {
  if (error instanceof TelegramGroupConnectionError) {
    return `${error.message} ${redactErrorMessage(error.cause, "OpenClaw returned no additional detail.")}`;
  }
  if (error instanceof TelegramGroupBindingConflictError) {
    return error.message;
  }
  if (error instanceof TelegramGroupVerificationError || error instanceof TelegramGroupIdError) {
    return error.message;
  }
  return redactErrorMessage(error, "OpenClaw could not update the Telegram group.");
}

type ProviderConfigRead = {
  config: Record<string, unknown>;
  baseHash: string | null;
};

type GroupScope = {
  accountScope: "root" | "account";
  groups: Record<string, unknown>;
  configPath: string;
  groupPath: string;
};

async function readTelegramProviderConfig(adapter: OpenClawAdapter): Promise<ProviderConfigRead> {
  if (adapter.getConfigSnapshot) {
    try {
      const snapshot = await adapter.getConfigSnapshot({ timeoutMs: 10_000 });
      const root = isRecord(snapshot.config) ? snapshot.config : {};
      const channels = isRecord(root.channels) ? root.channels : null;
      const providerConfig = channels && isRecord(channels.telegram)
        ? channels.telegram
        : isProviderConfigShape(root)
          ? root
          : null;
      if (providerConfig) {
        return {
          config: providerConfig,
          baseHash: normalizeHash(snapshot.hash ?? snapshot.configRevisionHash ?? snapshot.appliedConfigHash)
        };
      }
    } catch {
      // The adapter may be backed by an older CLI-only OpenClaw surface.
      // Continue with its provider-scoped read without inventing a hash.
    }
  }

  const config = await adapter.getConfig<Record<string, unknown>>("channels.telegram", { timeoutMs: 10_000 });
  return { config: isRecord(config) ? config : {}, baseHash: null };
}

function resolveGroupScope(config: Record<string, unknown>, accountId: string, groupId: string): GroupScope {
  const accounts = isRecord(config.accounts) ? config.accounts : {};
  const accountKey = findAccountKey(accounts, accountId);
  const account = accountKey && isRecord(accounts[accountKey]) ? accounts[accountKey] : null;
  const accountHasExplicitGroups = Boolean(account && Object.prototype.hasOwnProperty.call(account, "groups"));
  const basePath = accountHasExplicitGroups
    ? `channels.telegram.accounts[${JSON.stringify(accountKey)}]`
    : "channels.telegram";
  const configPath = `${basePath}.groups`;
  const groups = accountHasExplicitGroups && account
    ? isRecord(account.groups) ? account.groups : {}
    : isRecord(config.groups) ? config.groups : {};

  return {
    accountScope: accountHasExplicitGroups ? "account" : "root",
    groups,
    configPath,
    groupPath: `${configPath}[${JSON.stringify(groupId)}]`
  };
}

async function verifyTelegramGroup(
  adapter: OpenClawAdapter,
  accountId: string,
  groupId: string
): Promise<TelegramGroupRegistration["verification"]> {
  const readback = await readTelegramProviderConfig(adapter);
  const scope = resolveGroupScope(readback.config, accountId, groupId);
  const verified = Object.prototype.hasOwnProperty.call(scope.groups, groupId);
  return {
    verified,
    source: "openclaw-config",
    accountScope: scope.accountScope
  };
}

async function assertTelegramRouteCanBeClaimed(
  route: ChannelRouteIdentity,
  agentId: string,
  adapter: OpenClawAdapter
) {
  const resolution = await getChannelRouteBinding(route, { adapter });
  if (resolution.editingAmbiguity) {
    throw new TelegramGroupBindingConflictError({
      route,
      existingAgentId: resolution.agentId ?? "another agent",
      resolution
    });
  }

  // A broad account/channel/default route is a fallback, not ownership of the
  // concrete group. An exact peer binding may safely override it. Only refuse
  // to claim a group when OpenClaw already has an exact native peer binding for
  // another agent.
  if (resolution.agentId && resolution.agentId !== agentId && resolution.effectiveMatch === "exact") {
    throw new TelegramGroupBindingConflictError({
      route,
      existingAgentId: resolution.agentId,
      resolution
    });
  }
}

function findAccountKey(accounts: Record<string, unknown>, accountId: string) {
  return Object.keys(accounts).find((key) => key === accountId)
    ?? Object.keys(accounts).find((key) => key.toLowerCase() === accountId.toLowerCase())
    ?? null;
}

function normalizeRequired(value: string, message: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(message);
  return normalized;
}

function normalizeHash(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isProviderConfigShape(value: Record<string, unknown>) {
  return ["accounts", "groups", "enabled", "groupPolicy", "botToken"].some((key) => key in value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
