"use client";

import type { ReactNode } from "react";
import { KeyRound, RefreshCw } from "lucide-react";

import { AccountIcon } from "@/components/mission-control/account-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { agentHasBrowserAccess } from "@/components/mission-control/workspace-channels-dialog.utils";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { AccountLoginTargetView } from "@/lib/agentos/account-login-target-types";
import type { SecureBrowserAccountView } from "@/components/operations/accounts/secure-browser-connect-client";
import { inferBrowserServiceId } from "@/lib/agentos/browser-accounts/service-registry";

export function AccountsSurfaceSection({
  workspaceAgents,
  selectedAgentId,
  onSelectedAgentIdChange,
  secureBrowserAccounts,
  accountTargets,
  isSaving,
  onToggleSecureAccountAccess,
  onRefreshAccounts,
  onConnectAccount
}: {
  workspaceAgents: MissionControlSnapshot["agents"];
  selectedAgentId: string;
  onSelectedAgentIdChange: (agentId: string) => void;
  secureBrowserAccounts: SecureBrowserAccountView[];
  accountTargets: AccountLoginTargetView[];
  isSaving: boolean;
  onToggleSecureAccountAccess: (account: SecureBrowserAccountView, linked: boolean) => void;
  onRefreshAccounts: () => void;
  onConnectAccount: () => void;
}) {
  const selectedAgent = workspaceAgents.find((agent) => agent.id === selectedAgentId) ?? null;
  const selectedAgentCanUseBrowser = selectedAgent ? agentHasBrowserAccess(selectedAgent) : false;
  const legacyTargets = accountTargets.filter((target) => !secureBrowserAccounts.some((account) =>
    account.workspaceId === target.workspaceId &&
    (
      account.browserProfileId === target.browserProfileName ||
      (
        account.serviceId === inferBrowserServiceId({
          serviceId: target.serviceId,
          serviceName: target.serviceName,
          primaryDomain: target.primaryDomain
        }) &&
        account.primaryDomain === target.primaryDomain
      )
    )
  ));

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-border bg-card p-3.5 shadow-sm dark:border-white/10 dark:bg-white/[0.025] dark:shadow-none">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium text-foreground dark:text-white">Accounts</p>
              <Badge variant="muted" className="h-5 rounded-full px-2 text-[10px]">
                {secureBrowserAccounts.length} account{secureBrowserAccounts.length === 1 ? "" : "s"}
              </Badge>
              {legacyTargets.length > 0 ? (
                <Badge variant="muted" className="h-5 rounded-full px-2 text-[10px]">
                  {legacyTargets.length} legacy
                </Badge>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground dark:text-slate-500">
              Grant an agent identity-specific access to a persistent browser account. AgentOS enforces the grant and bound profile before task launch.
            </p>
          </div>
          <div className="flex gap-2 sm:flex-wrap sm:items-center sm:justify-end">
            <Button type="button" variant="default" size="sm" className="h-9 min-w-0 flex-1 rounded-full px-3 text-[11px] sm:h-8 sm:flex-none" onClick={onConnectAccount}>
              <KeyRound className="mr-1.5 h-3.5 w-3.5" />
              Connect Account
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="h-9 min-w-0 flex-1 rounded-full px-3 text-[11px] sm:h-8 sm:flex-none"
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
              AgentOS carries the selected identity into mission context and the policy layer forces the bound profile. Agent-provided profile overrides are ignored.
            </p>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-3.5 shadow-sm dark:border-white/10 dark:bg-white/[0.025] dark:shadow-none">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-medium text-foreground dark:text-white">Browser accounts</p>
          <Badge variant="muted" className="h-6 max-w-[52%] truncate rounded-full px-2 text-[10px]">
            {selectedAgent ? formatAgentDisplayName(selectedAgent) : "No agent"}
          </Badge>
        </div>

        {secureBrowserAccounts.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-border bg-muted/30 px-3 py-3 text-sm leading-5 text-muted-foreground dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-500">
            No canonical browser accounts are connected for this workspace. Use Connect Account to create a persistent identity and sign in manually.
          </div>
        ) : (
          <div className="mt-3 space-y-2.5">
            {secureBrowserAccounts.map((account) => {
              const grant = account.accessGrants.find((entry) => entry.agentId === selectedAgentId);
              const linked = Boolean(grant);
              const disabledReason = !selectedAgent
                ? "Select an agent before attaching this account."
                : !selectedAgentCanUseBrowser
                  ? "Enable browser/chrome tools for this agent before attaching accounts."
                  : account.connectionStatus === "revoked"
                    ? "This browser account has been revoked."
                    : "";

              return (
                <div
                  key={account.id}
                  className="flex flex-col gap-3 rounded-xl border border-border/80 bg-muted/30 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between dark:border-white/8 dark:bg-white/[0.02]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <AccountIcon
                      serviceId={account.serviceId}
                      serviceName={account.serviceName}
                      primaryDomain={account.primaryDomain}
                      className="h-8 w-8 shrink-0"
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground dark:text-white">{account.identityLabel}</p>
                        <Badge variant="muted" className="h-5 rounded-full px-2 text-[10px]">
                          {formatConnectionStatus(account.connectionStatus)}
                        </Badge>
                        <Badge variant="muted" className="h-5 rounded-full px-2 text-[10px]">
                          {linked ? "Granted" : "Not granted"}
                        </Badge>
                      </div>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground dark:text-slate-500">
                        {account.serviceName} · {account.primaryDomain}
                      </p>
                      <p className="mt-1 truncate text-[11px] text-muted-foreground dark:text-slate-500">
                        Capabilities: {formatCapabilities(grant?.capabilities ?? account.capabilities)} · {account.accessGrants.length} assigned agent{account.accessGrants.length === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={linked ? "secondary" : "default"}
                    className="h-9 w-full rounded-full px-3 text-[11px] sm:h-8 sm:w-auto sm:shrink-0"
                    disabled={isSaving || Boolean(disabledReason)}
                    title={disabledReason || (linked ? "Remove this account from the selected agent." : "Grant read access to this account identity.")}
                    onClick={() => onToggleSecureAccountAccess(account, linked)}
                  >
                    {linked ? "Remove" : (
                      "Grant access"
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {legacyTargets.length > 0 ? (
        <section className="rounded-2xl border border-amber-300/35 bg-amber-50 p-3.5 dark:border-amber-300/15 dark:bg-amber-400/[0.06]">
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm font-medium text-amber-950 dark:text-amber-50">Legacy login targets</p>
            <Badge variant="muted" className="h-6 rounded-full px-2 text-[10px]">Reconnect required</Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-amber-900/80 dark:text-amber-100/75">
            Older target records remain visible for compatibility, but they cannot authorize agent tasks without a canonical Browser Account backing.
          </p>
          <div className="mt-3 space-y-2">
            {legacyTargets.map((target) => (
              <div key={target.id} className="flex flex-col gap-3 rounded-xl border border-amber-300/30 bg-white/60 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between dark:border-amber-200/15 dark:bg-black/10">
                <div className="flex min-w-0 items-center gap-3">
                  <AccountIcon
                    serviceId={target.serviceId}
                    serviceName={target.serviceName}
                    primaryDomain={target.primaryDomain}
                    className="h-8 w-8 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-amber-950 dark:text-amber-50">{target.serviceName}</p>
                    <p className="mt-1 truncate text-[11px] text-amber-900/70 dark:text-amber-100/65">{target.primaryDomain} · legacy record only</p>
                  </div>
                </div>
                <Button type="button" size="sm" variant="secondary" className="h-9 w-full rounded-full px-3 text-[11px] sm:h-8 sm:w-auto sm:shrink-0" onClick={onConnectAccount}>
                  Reconnect account
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function formatConnectionStatus(status: string) {
  if (status === "connected") return "Connected";
  if (status === "expired") return "Re-authentication required";
  if (status === "needs_verification") return "Verification required";
  if (status === "recovery_required") return "Recovery required";
  return status.replaceAll("_", " ");
}

function formatCapabilities(capabilities: string[]) {
  return capabilities.length ? capabilities.join(", ") : "read";
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
