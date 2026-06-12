"use client";

import type { ReactNode } from "react";
import { KeyRound, Link2, RefreshCw } from "lucide-react";

import { AccountIcon } from "@/components/mission-control/account-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { agentHasBrowserAccess, formatLinkedAccountAgents } from "@/components/mission-control/workspace-channels-dialog.utils";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { AccountAccessRuleView } from "@/lib/agentos/account-access-policy-types";
import type { AccountLoginTargetView } from "@/lib/agentos/account-login-target-types";
import { cn } from "@/lib/utils";

export function AccountsSurfaceSection({
  workspaceAgents,
  selectedAgentId,
  onSelectedAgentIdChange,
  accountTargets,
  accountRulesByTargetId,
  isSaving,
  onToggleAccountAccess,
  onRefreshAccounts,
  onConnectAccount
}: {
  workspaceAgents: MissionControlSnapshot["agents"];
  selectedAgentId: string;
  onSelectedAgentIdChange: (agentId: string) => void;
  accountTargets: AccountLoginTargetView[];
  accountRulesByTargetId: Map<string, AccountAccessRuleView[]>;
  isSaving: boolean;
  onToggleAccountAccess: (target: AccountLoginTargetView, linked: boolean) => void;
  onRefreshAccounts: () => void;
  onConnectAccount: () => void;
}) {
  const selectedAgent = workspaceAgents.find((agent) => agent.id === selectedAgentId) ?? null;
  const selectedAgentCanUseBrowser = selectedAgent ? agentHasBrowserAccess(selectedAgent) : false;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-card p-3.5 shadow-sm dark:border-white/10 dark:bg-white/[0.025] dark:shadow-none">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-foreground dark:text-white">Accounts</p>
              <Badge variant="muted" className="h-5 rounded-full px-2 text-[10px]">
                {accountTargets.length} target{accountTargets.length === 1 ? "" : "s"}
              </Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground dark:text-slate-500">
              Attach saved browser-profile account targets to an agent. AgentOS enforces these bindings before account-target task launch.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
            <Button type="button" variant="default" size="sm" className="h-8 rounded-full px-3 text-[11px]" onClick={onConnectAccount}>
              <KeyRound className="mr-1.5 h-3.5 w-3.5" />
              Connect Account
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-8 rounded-full px-3 text-[11px]"
              disabled={isSaving}
              onClick={onRefreshAccounts}
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div className="rounded-xl border border-border/80 bg-muted/30 p-3 dark:border-white/8 dark:bg-white/[0.02]">
            <FormField label="Agent" htmlFor="account-agent">
              <select
                id="account-agent"
                value={selectedAgentId}
                disabled={isSaving || workspaceAgents.length === 0}
                onChange={(event) => onSelectedAgentIdChange(event.target.value)}
                className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground outline-none disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-white/5 dark:text-white"
              >
                <option value="">Select agent</option>
                {workspaceAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {formatAgentDisplayName(agent)}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="mt-3 rounded-xl border border-border/80 bg-background px-3 py-2 dark:border-white/8 dark:bg-black/15">
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground dark:text-slate-500">Browser capability</p>
              <p className="mt-1 text-xs text-foreground/80 dark:text-slate-300">
                {selectedAgent
                  ? selectedAgentCanUseBrowser
                    ? "This agent has browser-capable tools."
                    : "This agent needs browser/chrome tools before it can use account sessions."
                  : "Select an agent to manage account access."}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-amber-300/35 bg-amber-50 p-3 dark:border-amber-300/15 dark:bg-amber-400/[0.06]">
            <p className="text-xs font-medium text-amber-950 dark:text-amber-50">OpenClaw limitation</p>
            <p className="mt-1 text-[11px] leading-5 text-amber-900/80 dark:text-amber-100/75">
              OpenClaw does not expose a direct browser-profile dispatch parameter to AgentOS yet. These bindings are real AgentOS access rules and are shown on the canvas, but task launch still passes the selected profile as account context.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-3.5 shadow-sm dark:border-white/10 dark:bg-white/[0.025] dark:shadow-none">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-medium text-foreground dark:text-white">Workspace account targets</p>
          <Badge variant="muted" className="h-6 rounded-full px-2 text-[10px]">
            {selectedAgent ? formatAgentDisplayName(selectedAgent) : "No agent"}
          </Badge>
        </div>

        {accountTargets.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-border bg-muted/30 px-3 py-3 text-sm leading-5 text-muted-foreground dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-500">
            No account targets are connected for this workspace. Use Connect Account to open a real OpenClaw browser login target first.
          </div>
        ) : (
          <div className="mt-3 space-y-2.5">
            {accountTargets.map((target) => {
              const targetRules = accountRulesByTargetId.get(target.id) ?? [];
              const linked = targetRules.some(
                (rule) => rule.agentId === selectedAgentId && rule.permission === "use_browser_profile"
              );
              const linkedAgents = targetRules.filter((rule) => rule.permission === "use_browser_profile");
              const disabledReason = !selectedAgent
                ? "Select an agent before attaching this account."
                : !selectedAgentCanUseBrowser
                  ? "Enable browser/chrome tools for this agent before attaching accounts."
                  : "";

              return (
                <div
                  key={target.id}
                  className="flex flex-col gap-3 rounded-xl border border-border/80 bg-muted/30 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between dark:border-white/8 dark:bg-white/[0.02]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <AccountIcon
                      serviceId={target.serviceId}
                      serviceName={target.serviceName}
                      primaryDomain={target.primaryDomain}
                      className="h-8 w-8 shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground dark:text-white">{target.serviceName}</p>
                        <Badge
                          variant="muted"
                          className={cn(
                            "h-5 rounded-full px-2 text-[10px]",
                            linked
                              ? "border-emerald-300/45 bg-emerald-50 text-emerald-700 dark:border-emerald-300/25 dark:bg-emerald-400/10 dark:text-emerald-100"
                              : "border-border bg-muted text-muted-foreground dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300"
                          )}
                        >
                          {linked ? "Linked to agent" : "Not linked"}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground dark:text-slate-500">
                        {target.primaryDomain} · profile {target.browserProfileName}
                      </p>
                      {linkedAgents.length > 0 ? (
                        <p className="mt-1 text-[11px] leading-4 text-muted-foreground dark:text-slate-500">
                          Linked agents: {formatLinkedAccountAgents(linkedAgents)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={linked ? "secondary" : "default"}
                    className="h-8 rounded-full px-3 text-[11px] sm:shrink-0"
                    disabled={isSaving || Boolean(disabledReason)}
                    title={disabledReason || (linked ? "Remove this account from the selected agent." : "Attach this account to the selected agent.")}
                    onClick={() => onToggleAccountAccess(target, linked)}
                  >
                    {linked ? "Remove" : (
                      <>
                        <Link2 className="mr-1.5 h-3.5 w-3.5" />
                        Add to agent
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function FormField({
  label,
  htmlFor,
  children
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground dark:text-slate-400">
        {label}
      </Label>
      {children}
    </div>
  );
}
