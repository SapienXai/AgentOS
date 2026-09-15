import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  combineConfigMutationOutcomes,
  readConfigMutationOutcome,
  type OpenClawConfigMutationOutcome
} from "@/lib/openclaw/application/config-mutation-result";
import { redactErrorMessage } from "@/lib/security/redaction";

export type TelegramRoutePolicyPatch = {
  enabled?: boolean | null;
  requireMention?: boolean | null;
  groupPolicy?: "open" | "allowlist" | "disabled" | null;
  allowFrom?: string[] | null;
  agentId?: string | null;
};

export type TelegramRoutePolicyMutation = {
  provider: "telegram";
  accountId: string;
  groupId: string;
  topicId: string | null;
  /** The effective route scope. Individual fields are mutated below this path. */
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

export async function updateTelegramRoutePolicy(input: {
  accountId: string;
  groupId: string;
  topicId?: string | null;
  patch: TelegramRoutePolicyPatch;
}): Promise<TelegramRoutePolicyMutation> {
  const accountId = normalizeRequired(input.accountId, "A Telegram account is required.");
  const groupId = normalizeRequired(input.groupId, "A Telegram group is required.");
  const topicId = normalizeOptional(input.topicId);
  validateAccountId(accountId);

  if (!topicId && input.patch.agentId !== undefined) {
    throw new Error("Telegram group agent routing is managed through native OpenClaw bindings.");
  }

  const adapter = getOpenClawAdapter();
  const config = await adapter.getConfig<Record<string, unknown>>("channels.telegram", { timeoutMs: 10_000 });
  const scope = resolveTelegramGroupsScope(config, accountId);
  const currentGroup = isRecord(scope.groups[groupId]) ? scope.groups[groupId] : {};
  const writes: PlannedConfigWrite[] = [];

  if (topicId) {
    const topics = isRecord(currentGroup.topics) ? currentGroup.topics : {};
    const currentTopic = isRecord(topics[topicId]) ? topics[topicId] : {};
    planTopicPatch(currentTopic, input.patch, appendConfigKeyPath(appendConfigKeyPath(scope.configPath, groupId), topicId), writes);
  } else {
    planGroupPatch(currentGroup, input.patch, appendConfigKeyPath(scope.configPath, groupId), writes);
  }

  if (writes.length === 0) {
    return createNoopMutation({ accountId, groupId, topicId, configPath: scope.configPath });
  }

  const mutations: OpenClawConfigMutationOutcome[] = [];
  for (const write of writes) {
    const result = await adapter.setConfig(write.path, write.value, {
      strictJson: true,
      ...(Array.isArray(write.value) ? { replacePaths: [write.path] } : {}),
      timeoutMs: 15_000
    });
    mutations.push(readConfigMutationOutcome(result, write.path));
  }

  const outcome = combineConfigMutationOutcomes(mutations, scope.configPath);
  return {
    provider: "telegram",
    accountId,
    groupId,
    topicId,
    configPath: scope.configPath,
    changedFields: writes.map((write) => write.field),
    mutations,
    ...outcome
  };
}

type PlannedConfigWrite = {
  field: string;
  path: string;
  value: unknown;
};

function planGroupPatch(
  current: Record<string, unknown>,
  patch: TelegramRoutePolicyPatch,
  groupPath: string,
  writes: PlannedConfigWrite[]
) {
  planValue(current, "enabled", patch.enabled, appendConfigKeyPath(groupPath, "enabled"), writes);
  planValue(current, "requireMention", patch.requireMention, appendConfigKeyPath(groupPath, "requireMention"), writes);
  planValue(current, "groupPolicy", patch.groupPolicy, appendConfigKeyPath(groupPath, "groupPolicy"), writes);
  planValue(current, "groupAllowFrom", patch.allowFrom, appendConfigKeyPath(groupPath, "groupAllowFrom"), writes);
}

function planTopicPatch(
  current: Record<string, unknown>,
  patch: TelegramRoutePolicyPatch,
  topicPath: string,
  writes: PlannedConfigWrite[]
) {
  planValue(current, "enabled", patch.enabled, appendConfigKeyPath(topicPath, "enabled"), writes);
  planValue(current, "requireMention", patch.requireMention, appendConfigKeyPath(topicPath, "requireMention"), writes);
  planValue(current, "groupPolicy", patch.groupPolicy, appendConfigKeyPath(topicPath, "groupPolicy"), writes);
  planValue(current, "allowFrom", patch.allowFrom, appendConfigKeyPath(topicPath, "allowFrom"), writes);
  planValue(current, "agentId", patch.agentId, appendConfigKeyPath(topicPath, "agentId"), writes);
}

function planValue(
  current: Record<string, unknown>,
  field: string,
  value: unknown,
  path: string,
  writes: PlannedConfigWrite[]
) {
  if (value === undefined) return;

  if (value === null) {
    if (Object.prototype.hasOwnProperty.call(current, field)) {
      writes.push({ field, path, value: null });
    }
    return;
  }

  const nextValue = Array.isArray(value)
    ? value.map((entry) => String(entry).trim()).filter(Boolean)
    : value;
  if (!sameValue(current[field], nextValue)) {
    writes.push({ field, path, value: nextValue });
  }
}

function resolveTelegramGroupsScope(config: Record<string, unknown> | null, accountId: string) {
  const root = isRecord(config) ? config : {};
  const accounts = isRecord(root.accounts) ? root.accounts : {};
  const accountConfig = isRecord(accounts[accountId]) ? accounts[accountId] : null;
  const accountHasGroups = Boolean(accountConfig && Object.prototype.hasOwnProperty.call(accountConfig, "groups"));
  const shouldWriteAccountScope = accountHasGroups || Boolean(accountConfig && accountId !== "default");
  const groups = accountHasGroups ? accountConfig?.groups : root.groups;

  return {
    groups: isRecord(groups) ? groups : {},
    configPath: shouldWriteAccountScope
      ? `channels.telegram.accounts[${JSON.stringify(accountId)}].groups`
      : "channels.telegram.groups"
  };
}

function createNoopMutation(input: {
  accountId: string;
  groupId: string;
  topicId: string | null;
  configPath: string;
}): TelegramRoutePolicyMutation {
  return {
    provider: "telegram",
    ...input,
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
    throw new Error("The Telegram account identifier is invalid.");
  }
}

export function formatTelegramRoutePolicyError(error: unknown) {
  return redactErrorMessage(error, "OpenClaw Telegram route policy could not be updated.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
