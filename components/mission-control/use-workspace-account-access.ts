"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  mergeAccountAccessRules,
  mergeAccountTargets
} from "@/components/mission-control/workspace-account-access.utils";
import { toast } from "@/components/ui/sonner";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type {
  AccountAccessRuleView,
  AccountAccessRulesResponse
} from "@/lib/agentos/account-access-policy-types";
import type {
  AccountLoginTargetsResponse,
  AccountLoginTargetView
} from "@/lib/agentos/account-login-target-types";
import type { SecureBrowserAccountView } from "@/components/operations/accounts/secure-browser-connect-client";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";

export function useWorkspaceAccountAccess({
  open,
  workspaceId,
  workspaceAgents,
  accountTargets,
  accountAccessRules,
  secureBrowserAccounts,
  initialAgentId,
  beginSaving,
  endSaving,
  onAccountAccessRulesChange,
  onAccountTargetsChange,
  onSecureBrowserAccountsChange
}: {
  open: boolean;
  workspaceId: string | null;
  workspaceAgents: MissionControlSnapshot["agents"];
  accountTargets: AccountLoginTargetView[];
  accountAccessRules: AccountAccessRuleView[];
  secureBrowserAccounts: SecureBrowserAccountView[];
  initialAgentId: string | null;
  beginSaving: (message: string) => void;
  endSaving: () => void;
  onAccountAccessRulesChange?: (rules: AccountAccessRuleView[]) => void;
  onAccountTargetsChange?: (targets: AccountLoginTargetView[]) => void;
  onSecureBrowserAccountsChange?: (accounts: SecureBrowserAccountView[]) => void;
}) {
  const [selectedAccountAgentId, setSelectedAccountAgentId] = useState("");

  const workspaceAccountTargets = useMemo(
    () => (workspaceId ? accountTargets.filter((target) => target.workspaceId === workspaceId) : []),
    [accountTargets, workspaceId]
  );
  const workspaceAccountAccessRules = useMemo(
    () => (workspaceId ? accountAccessRules.filter((rule) => rule.workspaceId === workspaceId) : []),
    [accountAccessRules, workspaceId]
  );
  const accountRulesByTargetId = useMemo(() => {
    const rulesByTargetId = new Map<string, AccountAccessRuleView[]>();

    for (const rule of workspaceAccountAccessRules) {
      const current = rulesByTargetId.get(rule.targetId) ?? [];
      current.push(rule);
      rulesByTargetId.set(rule.targetId, current);
    }

    return rulesByTargetId;
  }, [workspaceAccountAccessRules]);
  const selectedAccountAgent = useMemo(
    () => workspaceAgents.find((agent) => agent.id === selectedAccountAgentId) ?? null,
    [selectedAccountAgentId, workspaceAgents]
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    if (!selectedAccountAgentId || (initialAgentId && selectedAccountAgentId !== initialAgentId)) {
      setSelectedAccountAgentId(initialAgentId ?? workspaceAgents[0]?.id ?? "");
    }
  }, [initialAgentId, open, selectedAccountAgentId, workspaceAgents]);

  const refreshAccounts = useCallback(async () => {
    const workspaceQuery = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
    const [targetsResponse, rulesResponse] = await Promise.all([
      fetch(`/api/accounts/login-targets${workspaceQuery}`, { cache: "no-store" }),
      fetch(`/api/accounts/access-rules${workspaceQuery}`, { cache: "no-store" })
    ]);
    const targetsPayload = await targetsResponse.json().catch(() => null) as AccountLoginTargetsResponse | null;
    const rulesPayload = await rulesResponse.json().catch(() => null) as AccountAccessRulesResponse | null;

    if (!targetsResponse.ok || !targetsPayload?.ok) {
      throw new Error(targetsPayload?.error ?? "Account targets could not be loaded.");
    }

    if (!rulesResponse.ok || !rulesPayload?.ok) {
      throw new Error(rulesPayload?.error ?? "Account access rules could not be loaded.");
    }

    const secureResponse = await fetch(`/api/accounts/browser-accounts${workspaceQuery}`, { cache: "no-store" });
    const securePayload = await secureResponse.json().catch(() => null) as {
      ok?: boolean;
      accounts?: SecureBrowserAccountView[];
      error?: string;
    } | null;
    if (!secureResponse.ok || !securePayload?.ok) {
      throw new Error(securePayload?.error ?? "Browser accounts could not be loaded.");
    }

    onAccountTargetsChange?.(mergeAccountTargets(accountTargets, targetsPayload.targets, workspaceId));
    onAccountAccessRulesChange?.(mergeAccountAccessRules(accountAccessRules, rulesPayload.rules, workspaceId));
    onSecureBrowserAccountsChange?.(securePayload.accounts ?? []);
  }, [
    accountAccessRules,
    accountTargets,
    onAccountAccessRulesChange,
    onAccountTargetsChange,
    onSecureBrowserAccountsChange,
    workspaceId
  ]);

  const updateAgentSecureBrowserAccountAccess = useCallback(
    async (account: SecureBrowserAccountView, linked: boolean) => {
      if (!workspaceId || !selectedAccountAgent) {
        return;
      }

      beginSaving(linked ? "Removing browser account access..." : "Granting browser account access...");

      try {
        const nextGrants = linked
          ? account.accessGrants.filter((grant) => grant.agentId !== selectedAccountAgent.id)
          : [
              ...account.accessGrants.filter((grant) => grant.agentId !== selectedAccountAgent.id),
              {
                agentId: selectedAccountAgent.id,
                capabilities: ["read" as const],
                approvalPolicy: account.approvalPolicy,
                updatedAt: new Date().toISOString()
              }
            ];
        const response = await fetch("/api/accounts/browser-accounts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action: "update-access",
            accountId: account.id,
            workspaceId: account.workspaceId,
            allowedAgentIds: nextGrants.map((grant) => grant.agentId),
            allowedDomains: account.allowedDomains,
            capabilities: account.capabilities,
            accessGrants: nextGrants,
            approvalPolicy: account.approvalPolicy
          })
        });
        const result = await response.json().catch(() => null) as {
          ok?: boolean;
          result?: SecureBrowserAccountView;
          error?: string;
        } | null;

        if (!response.ok || !result?.ok || !result.result) {
          throw new Error(result?.error ?? "Browser account access could not be updated.");
        }

        onSecureBrowserAccountsChange?.(
          secureBrowserAccounts.map((entry) => entry.id === account.id ? result.result! : entry)
        );
        toast.success(linked ? "Browser account access removed." : "Browser account access granted.", {
          description: `${formatAgentDisplayName(selectedAccountAgent)} ${linked ? "can no longer use" : "can use"} ${account.identityLabel}.`
        });
      } catch (error) {
        toast.error("Browser account access update failed.", {
          description: error instanceof Error ? error.message : "Unknown browser account error."
        });
      } finally {
        endSaving();
      }
    },
    [beginSaving, endSaving, onSecureBrowserAccountsChange, secureBrowserAccounts, selectedAccountAgent, workspaceId]
  );

  const updateAgentAccountAccess = useCallback(
    async (target: AccountLoginTargetView, linked: boolean) => {
      if (!workspaceId || !selectedAccountAgent) {
        return;
      }

      beginSaving(linked ? "Removing account access..." : "Adding account access...");

      try {
        const currentRules = accountRulesByTargetId.get(target.id) ?? [];
        const nextRules = [
          ...currentRules
            .filter((rule) => rule.agentId !== selectedAccountAgent.id)
            .map((rule) => ({
              agentId: rule.agentId,
              agentName: rule.agentName,
              permission: rule.permission,
              notes: rule.notes
            })),
          ...(linked
            ? []
            : [{
                agentId: selectedAccountAgent.id,
                agentName: formatAgentDisplayName(selectedAccountAgent),
                permission: "use_browser_profile" as const,
                notes: `Granted from Workspace Integrations for ${target.serviceName}.`
              }])
        ];
        const response = await fetch("/api/accounts/access-rules", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            workspaceId,
            targetId: target.id,
            rules: nextRules
          })
        });
        const result = await response.json().catch(() => null) as AccountAccessRulesResponse | null;

        if (!response.ok || !result?.ok) {
          throw new Error(result?.error ?? "Account access could not be updated.");
        }

        onAccountAccessRulesChange?.(mergeAccountAccessRules(accountAccessRules, result.rules, workspaceId));
        toast.success(linked ? "Account access removed." : "Account access added.", {
          description: `${formatAgentDisplayName(selectedAccountAgent)} ${linked ? "can no longer use" : "can use"} ${target.serviceName}.`
        });
      } catch (error) {
        toast.error("Account access update failed.", {
          description: error instanceof Error ? error.message : "Unknown account access error."
        });
      } finally {
        endSaving();
      }
    },
    [
      accountAccessRules,
      accountRulesByTargetId,
      beginSaving,
      endSaving,
      onAccountAccessRulesChange,
      selectedAccountAgent,
      workspaceId
    ]
  );

  return {
    accountRulesByTargetId,
    refreshAccounts,
    selectedAccountAgentId,
    setSelectedAccountAgentId,
    updateAgentAccountAccess,
    updateAgentSecureBrowserAccountAccess,
    secureBrowserAccounts,
    workspaceAccountTargets
  };
}
