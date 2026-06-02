import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  AccountAccessDecision,
  AccountAccessPermission,
  AccountAccessRuleView,
  AccountAccessRulesResponse
} from "@/lib/agentos/account-access-policy-types";
import { missionControlRootPath } from "@/lib/openclaw/state/paths";

type AccountAccessPolicyRegistry = {
  version: 1;
  rules: AccountAccessRuleView[];
};

const accountAccessPolicyPath = path.join(missionControlRootPath, "account-access-policy.json");

export async function listAccountAccessRules(input: {
  workspaceId?: string | null;
  targetId?: string | null;
} = {}): Promise<AccountAccessRulesResponse> {
  const registry = await readAccountAccessPolicyRegistry();
  const workspaceId = normalizeOptionalString(input.workspaceId);
  const targetId = normalizeOptionalString(input.targetId);
  const rules = registry.rules.filter((rule) => {
    if (workspaceId && rule.workspaceId !== workspaceId) {
      return false;
    }

    if (targetId && rule.targetId !== targetId) {
      return false;
    }

    return true;
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    source: "agentos.account-access-policy",
    rules: rules.sort(sortAccountAccessRules)
  };
}

export async function replaceAccountAccessRulesForTarget(input: {
  workspaceId: string;
  targetId: string;
  rules: Array<{
    agentId: string;
    agentName: string;
    permission: AccountAccessPermission;
    notes?: string | null;
  }>;
}): Promise<AccountAccessRulesResponse> {
  const now = new Date().toISOString();
  const workspaceId = normalizeRequiredString(input.workspaceId, "Workspace id");
  const targetId = normalizeRequiredString(input.targetId, "Login target id");
  const registry = await readAccountAccessPolicyRegistry();
  const existingByAgent = new Map(
    registry.rules
      .filter((rule) => rule.workspaceId === workspaceId && rule.targetId === targetId)
      .map((rule) => [rule.agentId, rule])
  );
  const nextRules = input.rules
    .map((rule) => normalizeWritableAccessRule({
      ...rule,
      workspaceId,
      targetId,
      now,
      existing: existingByAgent.get(rule.agentId)
    }))
    .filter(isAccountAccessRuleView);

  const rules = [
    ...registry.rules.filter((rule) => rule.workspaceId !== workspaceId || rule.targetId !== targetId),
    ...nextRules
  ].sort(sortAccountAccessRules);

  await writeAccountAccessPolicyRegistry({ version: 1, rules });
  return listAccountAccessRules({ workspaceId });
}

export async function deleteAccountAccessRulesForTarget(input: {
  workspaceId?: string | null;
  targetId: string;
}): Promise<AccountAccessRulesResponse> {
  const workspaceId = normalizeOptionalString(input.workspaceId);
  const targetId = normalizeRequiredString(input.targetId, "Login target id");
  const registry = await readAccountAccessPolicyRegistry();
  const rules = registry.rules.filter((rule) => {
    if (rule.targetId !== targetId) {
      return true;
    }

    return Boolean(workspaceId && rule.workspaceId !== workspaceId);
  });

  await writeAccountAccessPolicyRegistry({ version: 1, rules });
  return listAccountAccessRules({ workspaceId });
}

export async function resolveAccountAccessDecision(input: {
  workspaceId: string;
  targetId: string;
  agentId: string;
}): Promise<AccountAccessDecision> {
  const workspaceId = normalizeRequiredString(input.workspaceId, "Workspace id");
  const targetId = normalizeRequiredString(input.targetId, "Login target id");
  const agentId = normalizeRequiredString(input.agentId, "Agent id");
  const registry = await readAccountAccessPolicyRegistry();
  const rule = registry.rules.find(
    (entry) => entry.workspaceId === workspaceId && entry.targetId === targetId && entry.agentId === agentId
  ) ?? null;

  if (!rule || rule.permission === "no_access") {
    return {
      ok: true,
      allowed: false,
      approvalRequired: false,
      rule,
      error: "This agent is not allowed to use the selected account target."
    };
  }

  return {
    ok: true,
    allowed: true,
    approvalRequired: rule.approvalRequired,
    rule
  };
}

async function readAccountAccessPolicyRegistry(): Promise<AccountAccessPolicyRegistry> {
  try {
    const content = await readFile(accountAccessPolicyPath, "utf8");
    const parsed = JSON.parse(content) as Partial<AccountAccessPolicyRegistry>;
    const rules = Array.isArray(parsed.rules)
      ? parsed.rules.map(normalizeAccountAccessRule).filter(isAccountAccessRuleView)
      : [];

    return {
      version: 1,
      rules
    };
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;

    if (code === "ENOENT") {
      return { version: 1, rules: [] };
    }

    throw error;
  }
}

async function writeAccountAccessPolicyRegistry(registry: AccountAccessPolicyRegistry) {
  await mkdir(path.dirname(accountAccessPolicyPath), { recursive: true });
  await writeFile(accountAccessPolicyPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

function normalizeWritableAccessRule(input: {
  workspaceId: string;
  targetId: string;
  agentId: string;
  agentName: string;
  permission: AccountAccessPermission;
  notes?: string | null;
  now: string;
  existing?: AccountAccessRuleView;
}): AccountAccessRuleView | null {
  const agentId = normalizeRequiredString(input.agentId, "Agent id");
  const permission = normalizePermission(input.permission);

  if (permission === "no_access") {
    return null;
  }

  const id = buildAccessRuleId({
    workspaceId: input.workspaceId,
    targetId: input.targetId,
    agentId
  });

  return {
    id,
    workspaceId: input.workspaceId,
    targetId: input.targetId,
    agentId,
    agentName: normalizeRequiredString(input.agentName, "Agent name").slice(0, 120),
    permission,
    permissionLabel: formatPermissionLabel(permission),
    approvalRequired: permission === "requires_approval",
    notes: normalizeOptionalString(input.notes)?.slice(0, 400) ?? null,
    source: "agentos.account-access-policy",
    createdAt: input.existing?.createdAt ?? input.now,
    updatedAt: input.now
  };
}

function normalizeAccountAccessRule(value: unknown): AccountAccessRuleView | null {
  if (!isRecord(value)) {
    return null;
  }

  const workspaceId = normalizeOptionalString(value.workspaceId);
  const targetId = normalizeOptionalString(value.targetId);
  const agentId = normalizeOptionalString(value.agentId);
  const agentName = normalizeOptionalString(value.agentName);
  const permission = normalizePermission(value.permission);
  const updatedAt = normalizeIsoDate(value.updatedAt) ?? new Date().toISOString();
  const createdAt = normalizeIsoDate(value.createdAt) ?? updatedAt;

  if (!workspaceId || !targetId || !agentId || !agentName) {
    return null;
  }

  return {
    id: normalizeOptionalString(value.id) ?? buildAccessRuleId({ workspaceId, targetId, agentId }),
    workspaceId,
    targetId,
    agentId,
    agentName,
    permission,
    permissionLabel: formatPermissionLabel(permission),
    approvalRequired: permission === "requires_approval",
    notes: normalizeOptionalString(value.notes),
    source: "agentos.account-access-policy",
    createdAt,
    updatedAt
  };
}

function buildAccessRuleId(input: {
  workspaceId: string;
  targetId: string;
  agentId: string;
}) {
  return `${input.workspaceId}:${input.targetId}:${input.agentId}`;
}

function sortAccountAccessRules(left: AccountAccessRuleView, right: AccountAccessRuleView) {
  return left.agentName.localeCompare(right.agentName) ||
    left.targetId.localeCompare(right.targetId);
}

function normalizePermission(value: unknown): AccountAccessPermission {
  return value === "requires_approval" || value === "use_browser_profile" ? value : "no_access";
}

function formatPermissionLabel(permission: AccountAccessPermission) {
  switch (permission) {
    case "use_browser_profile":
      return "Can use browser profile";
    case "requires_approval":
      return "Requires approval";
    case "no_access":
      return "No access";
  }
}

function normalizeRequiredString(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized.slice(0, 240);
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeIsoDate(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isAccountAccessRuleView(value: AccountAccessRuleView | null): value is AccountAccessRuleView {
  return value !== null;
}
