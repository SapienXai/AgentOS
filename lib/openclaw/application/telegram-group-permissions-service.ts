import "server-only";

import { getOpenClawAdapter, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  readConfigMutationOutcome,
  type OpenClawConfigMutationOutcome
} from "@/lib/openclaw/application/config-mutation-result";
import type {
  OpenClawSkillListPayload,
  OpenClawToolCatalogEntry,
  OpenClawToolsCatalogPayload
} from "@/lib/openclaw/client/types";
import { redactErrorMessage } from "@/lib/security/redaction";

export type TelegramGroupAccessMode = "anyone" | "selected" | "nobody";
export type TelegramCapabilityPreset = "agent-defaults" | "chat-only" | "research" | "selected-tools" | "custom";

type TelegramGroupToolPolicy = {
  allow?: string[];
  alsoAllow?: string[];
  deny?: string[];
};

export type TelegramGroupPermissionPatch = {
  access?: {
    mode: TelegramGroupAccessMode;
    senderIds?: string[];
  };
  requireMention?: boolean | null;
  capabilities?: {
    preset: Exclude<TelegramCapabilityPreset, "custom">;
    toolIds?: string[];
  };
  memberOverrides?: Record<string, TelegramGroupToolPolicy> | null;
  skills?: string[] | null;
  systemPrompt?: string | null;
};

export type TelegramGroupPermissions = {
  accountId: string;
  groupId: string;
  agentId: string;
  access: {
    mode: TelegramGroupAccessMode;
    senderIds: string[];
    source: "group" | "account" | "provider-default";
    inherited: boolean;
  };
  response: {
    requireMention: boolean;
    source: "group" | "wildcard" | "provider-default";
    inherited: boolean;
  };
  capabilities: {
    preset: TelegramCapabilityPreset;
    policy: TelegramGroupToolPolicy | null;
    source: "group" | "wildcard" | "agent-defaults";
    inherited: boolean;
    selectedToolIds: string[];
  };
  memberOverrides: Array<{
    key: string;
    policy: TelegramGroupToolPolicy;
    preset: TelegramCapabilityPreset;
  }>;
  skills: {
    selected: string[];
    source: "group" | "wildcard" | "agent-defaults";
    inherited: boolean;
  };
  instructions: {
    text: string;
    source: "group" | "wildcard" | "none";
    inherited: boolean;
  };
  topics: Array<{
    id: string;
    requireMention: boolean | null;
    skills: string[];
    hasInstructions: boolean;
    groupPolicy: "open" | "allowlist" | "disabled" | null;
  }>;
  inheritance: {
    groupScope: "root" | "account";
    groupConfig: "direct" | "wildcard" | "none";
    configPath: string;
    groupPath: string;
  };
  toolCatalog: {
    source: "openclaw-gateway" | "unavailable";
    groups: Array<{
      id: string;
      label: string;
      tools: OpenClawToolCatalogEntry[];
    }>;
    error: string | null;
  };
  skillsCatalog: {
    source: "openclaw-gateway" | "unavailable";
    skills: Array<{
      name: string;
      description?: string;
      emoji?: string;
      source?: string;
    }>;
    error: string | null;
  };
  agent: {
    id: string;
    label: string;
    profile: string | null;
    toolPolicy: {
      profile?: string;
      allow?: string[];
      deny?: string[];
    } | null;
  };
  warnings: string[];
};

export type TelegramGroupPermissionsMutation = {
  accountId: string;
  groupId: string;
  configPath: string;
  groupPath: string;
  changedFields: string[];
  mutation: OpenClawConfigMutationOutcome;
  permissions: TelegramGroupPermissions;
};

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

type GroupResolution = {
  scope: GroupScope;
  directGroup: Record<string, unknown> | null;
  selectedGroup: Record<string, unknown> | null;
  selectedSource: "direct" | "wildcard" | "none";
  wildcardGroup: Record<string, unknown> | null;
  account: Record<string, unknown> | null;
};

const TELEGRAM_GROUP_ID_PATTERN = /^-?\d+$/;
const TELEGRAM_SENDER_ID_PATTERN = /^\d+$/;
const MAX_TOOL_IDS = 200;
const MAX_SENDER_IDS = 200;

export async function readTelegramGroupPermissions(input: {
  accountId: string;
  groupId: string;
  agentId: string;
  adapter?: OpenClawAdapter;
}): Promise<TelegramGroupPermissions> {
  const accountId = normalizeRequired(input.accountId, "A Telegram account is required.");
  const groupId = normalizeTelegramGroupId(input.groupId);
  const agentId = normalizeRequired(input.agentId, "An AgentOS agent is required.");
  const adapter = input.adapter ?? getOpenClawAdapter();
  const provider = await readTelegramProviderConfig(adapter);
  return buildPermissions({
    provider,
    accountId,
    groupId,
    agentId,
    adapter
  });
}

export async function updateTelegramGroupPermissions(input: {
  accountId: string;
  groupId: string;
  agentId: string;
  patch: TelegramGroupPermissionPatch;
  adapter?: OpenClawAdapter;
}): Promise<TelegramGroupPermissionsMutation> {
  const accountId = normalizeRequired(input.accountId, "A Telegram account is required.");
  const groupId = normalizeTelegramGroupId(input.groupId);
  const agentId = normalizeRequired(input.agentId, "An AgentOS agent is required.");
  const patch = normalizePermissionPatch(input.patch);
  const adapter = input.adapter ?? getOpenClawAdapter();
  const initial = await readTelegramProviderConfig(adapter);
  const resolved = resolveGroup(initial.config, accountId, groupId);
  const nextGroup = cloneRecord(resolved.directGroup ?? {});
  const changedFields: string[] = [];

  if (patch.access) {
    if (patch.access.mode === "selected") {
      const senderIds = normalizeSenderIds(patch.access.senderIds ?? []);
      if (senderIds.length === 0) {
        throw new Error("Selected people access requires at least one Telegram sender ID.");
      }
      setIfChanged(nextGroup, "groupPolicy", "allowlist", changedFields, "access");
      setIfChanged(nextGroup, "allowFrom", senderIds, changedFields, "access");
    } else if (patch.access.mode === "anyone") {
      setIfChanged(nextGroup, "groupPolicy", "open", changedFields, "access");
      // Telegram evaluates a group-level allowFrom override before
      // groupPolicy. Remove it or "Anyone" would still be sender-filtered.
      if (hasOwn(nextGroup, "allowFrom")) {
        delete nextGroup.allowFrom;
        changedFields.push("access");
      }
    } else {
      setIfChanged(nextGroup, "groupPolicy", "disabled", changedFields, "access");
    }
  }

  if (patch.requireMention !== undefined) {
    updateOrDeleteField(nextGroup, "requireMention", patch.requireMention, changedFields, "requireMention");
  }

  if (patch.capabilities) {
    const nextTools = await buildCapabilityPolicy({
      patch: patch.capabilities,
      current: asRecord(nextGroup.tools),
      adapter,
      agentId
    });
    if (nextTools === null) {
      if (Object.prototype.hasOwnProperty.call(nextGroup, "tools")) {
        delete nextGroup.tools;
        changedFields.push("capabilities");
      }
    } else if (!sameJson(nextGroup.tools, nextTools)) {
      nextGroup.tools = nextTools;
      changedFields.push("capabilities");
    }
  }

  if (patch.memberOverrides !== undefined) {
    const nextOverrides = patch.memberOverrides === null
      ? null
      : normalizeMemberOverrides(patch.memberOverrides);
    updateOrDeleteField(nextGroup, "toolsBySender", nextOverrides, changedFields, "memberOverrides");
  }

  if (patch.skills !== undefined) {
    const skills = patch.skills === null ? null : normalizeStringArray(patch.skills, 200, "skills");
    updateOrDeleteField(nextGroup, "skills", skills, changedFields, "skills");
  }

  if (patch.systemPrompt !== undefined) {
    const prompt = patch.systemPrompt === null ? null : normalizePrompt(patch.systemPrompt);
    updateOrDeleteField(nextGroup, "systemPrompt", prompt, changedFields, "systemPrompt");
  }

  if (changedFields.length === 0) {
    return {
      accountId,
      groupId,
      configPath: resolved.scope.configPath,
      groupPath: resolved.scope.groupPath,
      changedFields: [],
      mutation: {
        path: resolved.scope.groupPath,
        applyMode: "live",
        reloadKind: "none",
        restartRequired: false,
        hotReloaded: false,
        appliedVia: "noop",
        pending: false,
        changedPaths: [],
        baseHash: initial.baseHash
      },
      permissions: await buildPermissions({ provider: initial, accountId, groupId, agentId, adapter })
    };
  }

  const result = await adapter.setConfig(resolved.scope.groupPath, nextGroup, {
    strictJson: true,
    ...(initial.baseHash ? { baseHash: initial.baseHash } : {}),
    replacePaths: [resolved.scope.groupPath],
    timeoutMs: 15_000
  });
  const mutation = readConfigMutationOutcome(result, resolved.scope.groupPath);
  const after = await readTelegramProviderConfig(adapter);
  const permissions = await buildPermissions({
    provider: after,
    accountId,
    groupId,
    agentId,
    adapter
  });
  verifyPermissionReadback(permissions, patch);

  return {
    accountId,
    groupId,
    configPath: resolved.scope.configPath,
    groupPath: resolved.scope.groupPath,
    changedFields: [...new Set(changedFields)],
    mutation,
    permissions
  };
}

async function buildPermissions(input: {
  provider: ProviderConfigRead;
  accountId: string;
  groupId: string;
  agentId: string;
  adapter: OpenClawAdapter;
}): Promise<TelegramGroupPermissions> {
  const resolved = resolveGroup(input.provider.config, input.accountId, input.groupId);
  const selected = resolved.selectedGroup;
  const accountPolicy = readGroupPolicy(resolved.account?.groupPolicy);
  const providerPolicy = readGroupPolicy(input.provider.config.groupPolicy);
  const groupPolicy = readGroupPolicy(selected?.groupPolicy) ?? accountPolicy ?? providerPolicy ?? "allowlist";
  const groupAllowFrom = readAllowFrom(
    hasOwn(selected, "allowFrom")
      ? selected?.allowFrom
      : resolved.account?.groupAllowFrom
        ?? resolved.account?.allowFrom
        ?? input.provider.config.groupAllowFrom
        ?? input.provider.config.allowFrom
  );
  const access: TelegramGroupAccessMode = groupPolicy === "disabled"
    ? "nobody"
    : groupPolicy === "open"
      ? "anyone"
      : groupAllowFrom.length > 0
        ? "selected"
        : "nobody";

  const requireMention = readBoolean(selected?.requireMention) ?? true;
  const promptSource = hasOwn(selected, "systemPrompt")
    ? "group"
    : hasOwn(resolved.wildcardGroup, "systemPrompt")
      ? "wildcard"
      : "none";
  const skillsSource = hasOwn(selected, "skills")
    ? "group"
    : hasOwn(resolved.wildcardGroup, "skills")
      ? "wildcard"
      : "agent-defaults";
  const toolsSource = hasOwn(selected, "tools")
    ? "group"
    : hasOwn(resolved.wildcardGroup, "tools")
      ? "wildcard"
      : "agent-defaults";
  const toolPolicy = readToolPolicy(selected?.tools ?? resolved.wildcardGroup?.tools);
  const [catalogResult, skillsResult, agentResult] = await Promise.all([
    readToolCatalog(input.adapter, input.agentId),
    readSkills(input.adapter),
    readAgent(input.adapter, input.agentId)
  ]);
  const selectedToolIds = uniqueStrings([
    ...(toolPolicy?.allow ?? []),
    ...(toolPolicy?.alsoAllow ?? [])
  ]).filter((toolId) => toolId !== "*");
  const memberOverrides = Object.entries(readRecord(selected?.toolsBySender ?? resolved.wildcardGroup?.toolsBySender))
    .map(([key, policy]) => ({
      key,
      policy: readToolPolicy(policy) ?? {},
      preset: classifyCapabilityPreset(readToolPolicy(policy), catalogResult.groups)
    }));
  const topics = Object.entries(readRecord(selected?.topics)).map(([id, value]) => {
    const topic = asRecord(value);
    return {
      id,
      requireMention: readBoolean(topic?.requireMention),
      skills: normalizeStringArray(topic?.skills, 200, "topic skills", false),
      hasInstructions: typeof topic?.systemPrompt === "string" && topic.systemPrompt.trim().length > 0,
      groupPolicy: readGroupPolicy(topic?.groupPolicy) ?? null
    };
  });

  const warnings: string[] = [];
  if (resolved.selectedSource === "wildcard") {
    warnings.push("This group currently inherits a wildcard OpenClaw policy. A direct group override will take precedence.");
  }
  if (catalogResult.source === "unavailable") {
    warnings.push("Live OpenClaw tool catalog is unavailable; tool selection is read-only until the Gateway is reachable.");
  }
  if (skillsResult.source === "unavailable") {
    warnings.push("Live OpenClaw skill discovery is unavailable; existing skill configuration is preserved.");
  }

  return {
    accountId: input.accountId,
    groupId: input.groupId,
    agentId: input.agentId,
    access: {
      mode: access,
      senderIds: groupAllowFrom,
      source: hasOwn(selected, "allowFrom") || hasOwn(selected, "groupPolicy")
        ? "group"
        : resolved.account?.groupAllowFrom !== undefined || resolved.account?.allowFrom !== undefined || resolved.account?.groupPolicy !== undefined
          ? "account"
          : "provider-default",
      inherited: !hasOwn(selected, "allowFrom") && !hasOwn(selected, "groupPolicy")
    },
    response: {
      requireMention,
      source: hasOwn(selected, "requireMention") ? "group" : hasOwn(resolved.wildcardGroup, "requireMention") ? "wildcard" : "provider-default",
      inherited: !hasOwn(selected, "requireMention")
    },
    capabilities: {
      preset: classifyCapabilityPreset(toolPolicy, catalogResult.groups),
      policy: toolPolicy,
      source: toolsSource,
      inherited: toolsSource !== "group",
      selectedToolIds
    },
    memberOverrides,
    skills: {
      selected: normalizeStringArray(selected?.skills ?? resolved.wildcardGroup?.skills, 200, "skills", false),
      source: skillsSource,
      inherited: skillsSource !== "group"
    },
    instructions: {
      text: typeof (selected?.systemPrompt ?? resolved.wildcardGroup?.systemPrompt) === "string"
        ? String(selected?.systemPrompt ?? resolved.wildcardGroup?.systemPrompt)
        : "",
      source: promptSource,
      inherited: promptSource !== "group"
    },
    topics,
    inheritance: {
      groupScope: resolved.scope.accountScope,
      groupConfig: resolved.selectedSource,
      configPath: resolved.scope.configPath,
      groupPath: resolved.scope.groupPath
    },
    toolCatalog: catalogResult,
    skillsCatalog: skillsResult,
    agent: {
      id: input.agentId,
      label: agentResult.label,
      profile: agentResult.profile,
      toolPolicy: agentResult.toolPolicy
    },
    warnings
  };
}

async function buildCapabilityPolicy(input: {
  patch: NonNullable<TelegramGroupPermissionPatch["capabilities"]>;
  current: Record<string, unknown>;
  adapter: OpenClawAdapter;
  agentId: string;
}): Promise<TelegramGroupToolPolicy | null> {
  // An empty direct tools object intentionally shadows a wildcard group
  // policy while leaving the effective ceiling to Agent-level OpenClaw
  // policy. Omitting the field would continue inheriting wildcard tools.
  if (input.patch.preset === "agent-defaults") return {};
  if (input.patch.preset === "chat-only") return mergeToolPolicy(input.current, { deny: ["*"] });

  const catalog = await readToolCatalog(input.adapter, input.agentId);
  if (catalog.source === "unavailable") {
    throw new Error("OpenClaw's live tool catalog is unavailable. Reconnect the Gateway before changing tool permissions.");
  }

  if (input.patch.preset === "research") {
    const researchTools = catalog.groups.find((group) => group.id === "web")?.tools.map((tool) => tool.id) ?? [];
    if (researchTools.length === 0) {
      throw new Error("OpenClaw did not expose a native Web tool group, so the Research preset is unavailable.");
    }
    return mergeToolPolicy(input.current, { allow: researchTools });
  }

  const toolIds = uniqueStrings(input.patch.toolIds ?? []);
  if (toolIds.length === 0) throw new Error("Selected tools requires at least one OpenClaw tool.");
  if (toolIds.length > MAX_TOOL_IDS) throw new Error(`Select no more than ${MAX_TOOL_IDS} OpenClaw tools.`);
  const available = new Set(catalog.groups.flatMap((group) => group.tools.map((tool) => tool.id)));
  const unknown = toolIds.filter((toolId) => !available.has(toolId));
  if (unknown.length > 0) throw new Error(`OpenClaw did not expose these selected tools: ${unknown.join(", ")}.`);
  return mergeToolPolicy(input.current, { allow: toolIds });
}

function mergeToolPolicy(current: Record<string, unknown>, next: { allow?: string[]; deny?: string[] }) {
  const result = cloneRecord(current);
  delete result.allow;
  delete result.alsoAllow;
  delete result.deny;
  if (next.allow) result.allow = next.allow;
  if (next.deny) result.deny = next.deny;
  return result as TelegramGroupToolPolicy;
}

function verifyPermissionReadback(permissions: TelegramGroupPermissions, patch: TelegramGroupPermissionPatch) {
  if (patch.access && permissions.access.mode !== patch.access.mode) {
    throw new Error("OpenClaw readback did not confirm the requested Telegram group access policy.");
  }
  if (patch.access?.mode === "selected" && !sameJson(permissions.access.senderIds, normalizeSenderIds(patch.access.senderIds ?? []))) {
    throw new Error("OpenClaw readback did not confirm the requested Telegram sender allowlist.");
  }
  if (patch.requireMention !== undefined && permissions.response.requireMention !== (patch.requireMention ?? true)) {
    throw new Error("OpenClaw readback did not confirm the requested mention policy.");
  }
  if (patch.capabilities && permissions.capabilities.preset !== patch.capabilities.preset) {
    throw new Error("OpenClaw readback did not confirm the requested group tool policy.");
  }
}

function resolveGroup(config: Record<string, unknown>, accountId: string, groupId: string): GroupResolution {
  const scope = resolveGroupScope(config, accountId, groupId);
  const directGroup = asRecord(scope.groups[groupId]);
  const wildcardGroup = asRecord(scope.groups["*"]);
  return {
    scope,
    directGroup,
    wildcardGroup,
    selectedGroup: directGroup ?? wildcardGroup,
    selectedSource: directGroup ? "direct" : wildcardGroup ? "wildcard" : "none",
    account: resolveAccount(config, accountId)
  };
}

function resolveGroupScope(config: Record<string, unknown>, accountId: string, groupId: string): GroupScope {
  const accounts = asRecord(config.accounts);
  const accountKey = findAccountKey(accounts, accountId);
  const account = accountKey ? asRecord(accounts[accountKey]) : null;
  const accountHasExplicitGroups = Boolean(account && hasOwn(account, "groups"));
  const basePath = accountHasExplicitGroups
    ? `channels.telegram.accounts[${JSON.stringify(accountKey)}]`
    : "channels.telegram";
  const configPath = `${basePath}.groups`;
  const groups = accountHasExplicitGroups ? asRecord(account?.groups) : asRecord(config.groups);
  return {
    accountScope: accountHasExplicitGroups ? "account" : "root",
    groups,
    configPath,
    groupPath: `${configPath}[${JSON.stringify(groupId)}]`
  };
}

async function readTelegramProviderConfig(adapter: OpenClawAdapter): Promise<ProviderConfigRead> {
  if (adapter.getConfigSnapshot) {
    try {
      const snapshot = await adapter.getConfigSnapshot({ timeoutMs: 10_000 });
      const root = asRecord(snapshot.config);
      const channels = asRecord(root.channels);
      const provider = asRecord(channels.telegram) ?? (isProviderConfigShape(root) ? root : null);
      if (provider) {
        return {
          config: provider,
          baseHash: normalizeOptionalString(snapshot.hash ?? snapshot.configRevisionHash ?? snapshot.appliedConfigHash)
        };
      }
    } catch {
      // Older CLI-only adapters may not expose config.get snapshots.
    }
  }
  const config = await adapter.getConfig<Record<string, unknown>>("channels.telegram", { timeoutMs: 10_000 });
  return { config: asRecord(config), baseHash: null };
}

async function readToolCatalog(adapter: OpenClawAdapter, agentId: string): Promise<TelegramGroupPermissions["toolCatalog"]> {
  try {
    const payload = await adapter.getToolsCatalog({ agentId, includePlugins: true }, { timeoutMs: 15_000 });
    return {
      source: "openclaw-gateway",
      groups: normalizeToolGroups(payload),
      error: null
    };
  } catch (error) {
    return {
      source: "unavailable",
      groups: [],
      error: redactErrorMessage(error, "OpenClaw did not return a live tool catalog.")
    };
  }
}

async function readSkills(adapter: OpenClawAdapter): Promise<TelegramGroupPermissions["skillsCatalog"]> {
  try {
    const payload = await adapter.listSkills({ eligible: true, timeoutMs: 15_000 });
    return {
      source: "openclaw-gateway",
      skills: normalizeSkills(payload),
      error: null
    };
  } catch (error) {
    return {
      source: "unavailable",
      skills: [],
      error: redactErrorMessage(error, "OpenClaw did not return live skill discovery.")
    };
  }
}

async function readAgent(adapter: OpenClawAdapter, agentId: string) {
  try {
    const payload = await adapter.listAgents({ timeoutMs: 15_000 });
    const agent = payload.agents.find((candidate) => candidate.id === agentId);
    return {
      label: agent?.name || agent?.identity?.name || agentId,
      profile: null,
      // The native Gateway applies the Agent-level policy independently of
      // the group policy. The lightweight agents.list projection does not
      // expose that policy, so do not infer or duplicate it here.
      toolPolicy: null
    };
  } catch {
    return { label: agentId, profile: null, toolPolicy: null };
  }
}

function normalizeToolGroups(payload: OpenClawToolsCatalogPayload) {
  return (Array.isArray(payload?.groups) ? payload.groups : []).map((group) => ({
    id: String(group.id),
    label: String(group.label || group.id),
    tools: Array.isArray(group.tools) ? group.tools : []
  }));
}

function normalizeSkills(payload: OpenClawSkillListPayload) {
  return (Array.isArray(payload?.skills) ? payload.skills : []).map((skill) => ({
    name: String(skill.name),
    ...(skill.description ? { description: String(skill.description) } : {}),
    ...(skill.emoji ? { emoji: String(skill.emoji) } : {}),
    ...(skill.source ? { source: String(skill.source) } : {})
  }));
}

function classifyCapabilityPreset(policy: TelegramGroupToolPolicy | null, catalog: TelegramGroupPermissions["toolCatalog"]["groups"]): TelegramCapabilityPreset {
  if (!policy) return "agent-defaults";
  if (Object.keys(policy).length === 0) return "agent-defaults";
  if (hasOnlyPolicy(policy, { deny: ["*"] })) return "chat-only";
  const researchIds = catalog.find((group) => group.id === "web")?.tools.map((tool) => tool.id) ?? [];
  const allowIds = uniqueStrings([...(policy.allow ?? []), ...(policy.alsoAllow ?? [])]);
  if (allowIds.length > 0 && researchIds.length > 0 && sameJson(allowIds.slice().sort(), researchIds.slice().sort()) && !(policy.deny?.length)) {
    return "research";
  }
  if (allowIds.length > 0 && !policy.deny?.length && !policy.alsoAllow?.length) return "selected-tools";
  return "custom";
}

function hasOnlyPolicy(policy: TelegramGroupToolPolicy, expected: TelegramGroupToolPolicy) {
  return sameJson(policy.allow ?? [], expected.allow ?? [])
    && sameJson(policy.alsoAllow ?? [], expected.alsoAllow ?? [])
    && sameJson(policy.deny ?? [], expected.deny ?? []);
}

function normalizePermissionPatch(patch: TelegramGroupPermissionPatch): TelegramGroupPermissionPatch {
  if (!patch || typeof patch !== "object") throw new Error("A Telegram group permission patch is required.");
  return patch;
}

function normalizeMemberOverrides(input: Record<string, TelegramGroupToolPolicy>) {
  const entries = Object.entries(input);
  if (entries.length > MAX_SENDER_IDS) throw new Error(`Configure no more than ${MAX_SENDER_IDS} Telegram member overrides.`);
  const result: Record<string, TelegramGroupToolPolicy> = {};
  for (const [rawKey, rawPolicy] of entries) {
    const key = rawKey.trim();
    if (!key || key.length > 256) throw new Error("A Telegram member override key is invalid.");
    const policy = readToolPolicy(rawPolicy);
    if (!policy) throw new Error(`The Telegram member override for ${key} is invalid.`);
    result[key] = policy;
  }
  return result;
}

function updateOrDeleteField(target: Record<string, unknown>, field: string, value: unknown, changedFields: string[], changedField: string) {
  if (value === null) {
    if (hasOwn(target, field)) {
      delete target[field];
      changedFields.push(changedField);
    }
    return;
  }
  if (!sameJson(target[field], value)) {
    target[field] = value;
    changedFields.push(changedField);
  }
}

function setIfChanged(target: Record<string, unknown>, field: string, value: unknown, changedFields: string[], changedField: string) {
  if (!sameJson(target[field], value)) {
    target[field] = value;
    changedFields.push(changedField);
  }
}

function readToolPolicy(value: unknown): TelegramGroupToolPolicy | null {
  const record = asRecord(value);
  if (!record) return null;
  const policy: TelegramGroupToolPolicy = {};
  for (const field of ["allow", "alsoAllow", "deny"] as const) {
    if (Array.isArray(record[field])) policy[field] = normalizeStringArray(record[field], MAX_TOOL_IDS, `tools.${field}`, false);
  }
  return Object.keys(policy).length > 0 ? policy : {};
}

function readGroupPolicy(value: unknown): "open" | "allowlist" | "disabled" | null {
  return value === "open" || value === "allowlist" || value === "disabled" ? value : null;
}

function readAllowFrom(value: unknown) {
  return Array.isArray(value)
    ? uniqueStrings(value.map((entry) => String(entry).trim()).filter(Boolean))
    : [];
}

function normalizeSenderIds(value: unknown) {
  const ids = normalizeStringArray(value, MAX_SENDER_IDS, "sender IDs");
  const invalid = ids.filter((id) => !TELEGRAM_SENDER_ID_PATTERN.test(id));
  if (invalid.length > 0) throw new Error("Telegram sender IDs must be numeric user IDs, not group IDs or usernames.");
  return uniqueStrings(ids);
}

function normalizeStringArray(value: unknown, max: number, label: string, throwOnInvalid = true) {
  if (!Array.isArray(value)) return [];
  if (value.length > max && throwOnInvalid) throw new Error(`${label} contains more than ${max} entries.`);
  return uniqueStrings(value.map((entry) => String(entry).trim()).filter(Boolean)).slice(0, max);
}

function normalizePrompt(value: unknown) {
  if (typeof value !== "string") throw new Error("The group instruction must be text.");
  const prompt = value.trim();
  if (prompt.length > 20_000) throw new Error("Group instructions must be 20,000 characters or fewer.");
  return prompt;
}

function normalizeTelegramGroupId(value: string) {
  const groupId = value.trim();
  if (!TELEGRAM_GROUP_ID_PATTERN.test(groupId) || !groupId.startsWith("-100")) {
    throw new Error("Enter a valid Telegram group ID, such as -1001234567890.");
  }
  return groupId;
}

function normalizeRequired(value: string, message: string) {
  const normalized = value.trim();
  if (!normalized) throw new Error(message);
  return normalized;
}

function resolveAccount(config: Record<string, unknown>, accountId: string) {
  const accounts = asRecord(config.accounts);
  const key = findAccountKey(accounts, accountId);
  return key ? asRecord(accounts[key]) : null;
}

function findAccountKey(accounts: Record<string, unknown>, accountId: string) {
  const normalized = accountId.trim().toLowerCase();
  return Object.keys(accounts).find((key) => key === accountId || key.toLowerCase() === normalized) ?? null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isProviderConfigShape(value: Record<string, unknown>) {
  return hasOwn(value, "groups") || hasOwn(value, "accounts") || hasOwn(value, "groupPolicy");
}

function hasOwn(value: Record<string, unknown> | null | undefined, field: string): boolean {
  return Boolean(value && Object.prototype.hasOwnProperty.call(value, field));
}

function cloneRecord(value: Record<string, unknown>) {
  return structuredClone(value);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function normalizeOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
