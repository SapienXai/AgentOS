"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  mergeAccountAccessRules,
  mergeAccountTargets
} from "@/components/mission-control/workspace-channels-dialog.utils";
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
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";

export function useWorkspaceAccountAccess({
  open,
  workspaceId,
  workspaceAgents,
  accountTargets,
  accountAccessRules,
  initialAgentId,
  beginSaving,
  endSaving,
  onAccountAccessRulesChange,
  onAccountTargetsChange
}: {
  open: boolean;
  workspaceId: string | null;
  workspaceAgents: MissionControlSnapshot["agents"];
  accountTargets: AccountLoginTargetView[];
  accountAccessRules: AccountAccessRuleView[];
  initialAgentId: string | null;
  beginSaving: (message: string) => void;
  endSaving: () => void;
  onAccountAccessRulesChange?: (rules: AccountAccessRuleView[]) => void;
  onAccountTargetsChange?: (targets: AccountLoginTargetView[]) => void;
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

    onAccountTargetsChange?.(mergeAccountTargets(accountTargets, targetsPayload.targets, workspaceId));
    onAccountAccessRulesChange?.(mergeAccountAccessRules(accountAccessRules, rulesPayload.rules, workspaceId));
  }, [
    accountAccessRules,
    accountTargets,
    onAccountAccessRulesChange,
    onAccountTargetsChange,
    workspaceId
  ]);

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
    workspaceAccountTargets
  };
}
