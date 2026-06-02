export type AccountAccessPermission = "no_access" | "use_browser_profile" | "requires_approval";

export type AccountAccessRuleView = {
  id: string;
  workspaceId: string;
  targetId: string;
  agentId: string;
  agentName: string;
  permission: AccountAccessPermission;
  permissionLabel: string;
  approvalRequired: boolean;
  notes: string | null;
  source: "agentos.account-access-policy";
  createdAt: string;
  updatedAt: string;
};

export type AccountAccessRulesResponse = {
  ok: boolean;
  generatedAt: string;
  source: "agentos.account-access-policy";
  rules: AccountAccessRuleView[];
  error?: string;
};

export type AccountAccessDecision = {
  ok: boolean;
  allowed: boolean;
  approvalRequired: boolean;
  rule: AccountAccessRuleView | null;
  error?: string;
};
