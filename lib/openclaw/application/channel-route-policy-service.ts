import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
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
  configPath: string;
  changedFields: string[];
  restartRequired: boolean;
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

  const adapter = getOpenClawAdapter();
  const config = await adapter.getConfig<Record<string, unknown>>("channels.telegram", { timeoutMs: 10_000 });
  const scope = resolveTelegramGroupsScope(config, accountId);
  const groups = cloneRecord(scope.groups);
  const currentGroup = isRecord(groups[groupId]) ? cloneRecord(groups[groupId]) : {};
  const changedFields: string[] = [];

  if (topicId) {
    const topics = isRecord(currentGroup.topics) ? cloneRecord(currentGroup.topics) : {};
    const currentTopic = isRecord(topics[topicId]) ? cloneRecord(topics[topicId]) : {};
    applyTopicPatch(currentTopic, input.patch, changedFields);
    topics[topicId] = currentTopic;
    currentGroup.topics = topics;
  } else {
    applyGroupPatch(currentGroup, input.patch, changedFields);
  }

  if (changedFields.length === 0) {
    return {
      provider: "telegram",
      accountId,
      groupId,
      topicId,
      configPath: scope.configPath,
      changedFields: [],
      restartRequired: false
    };
  }

  groups[groupId] = currentGroup;
  await adapter.setConfig(scope.configPath, groups, { strictJson: true, timeoutMs: 15_000 });

  return {
    provider: "telegram",
    accountId,
    groupId,
    topicId,
    configPath: scope.configPath,
    changedFields,
    restartRequired: true
  };
}

function applyGroupPatch(target: Record<string, unknown>, patch: TelegramRoutePolicyPatch, changedFields: string[]) {
  applyValue(target, "enabled", patch.enabled, changedFields);
  applyValue(target, "requireMention", patch.requireMention, changedFields);
  applyValue(target, "groupPolicy", patch.groupPolicy, changedFields);
  applyValue(target, "groupAllowFrom", patch.allowFrom, changedFields);
}

function applyTopicPatch(target: Record<string, unknown>, patch: TelegramRoutePolicyPatch, changedFields: string[]) {
  applyValue(target, "enabled", patch.enabled, changedFields);
  applyValue(target, "requireMention", patch.requireMention, changedFields);
  applyValue(target, "groupPolicy", patch.groupPolicy, changedFields);
  applyValue(target, "allowFrom", patch.allowFrom, changedFields);
  applyValue(target, "agentId", patch.agentId, changedFields);
}

function applyValue(target: Record<string, unknown>, key: string, value: unknown, changedFields: string[]) {
  if (value === undefined) {
    return;
  }
  if (value === null) {
    if (Object.prototype.hasOwnProperty.call(target, key)) {
      delete target[key];
      changedFields.push(key);
    }
    return;
  }
  if (Array.isArray(value)) {
    const next = value.map((entry) => String(entry).trim()).filter(Boolean);
    if (!sameValue(target[key], next)) {
      target[key] = next;
      changedFields.push(key);
    }
    return;
  }
  if (!sameValue(target[key], value)) {
    target[key] = value;
    changedFields.push(key);
  }
}

function resolveTelegramGroupsScope(config: Record<string, unknown> | null, accountId: string) {
  const root = isRecord(config) ? config : {};
  const accounts = isRecord(root.accounts) ? root.accounts : {};
  const accountConfig = isRecord(accounts[accountId]) ? accounts[accountId] : null;
  const accountHasGroups = Boolean(accountConfig && Object.prototype.hasOwnProperty.call(accountConfig, "groups"));
  const shouldWriteAccountScope = accountHasGroups || Boolean(accountConfig && accountId !== "default");
  const groups = accountHasGroups
    ? accountConfig?.groups
    : root.groups;

  return {
    groups: isRecord(groups) ? groups : {},
    configPath: shouldWriteAccountScope
      ? `channels.telegram.accounts[${JSON.stringify(accountId)}].groups`
      : "channels.telegram.groups"
  };
}

function cloneRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeRequired(value: string, message: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(message);
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatTelegramRoutePolicyError(error: unknown) {
  return redactErrorMessage(error, "OpenClaw Telegram route policy could not be updated.");
}

