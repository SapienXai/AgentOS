"use client";

import { useCallback, useMemo, useState } from "react";
import { AlertTriangle, KeyRound } from "lucide-react";

import { AccountsSurfaceSection } from "@/components/mission-control/accounts-surface-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { useWorkspaceAccountAccess } from "@/components/mission-control/use-workspace-account-access";
import type { MissionControlSnapshot, SurfaceBindingRepairResult } from "@/lib/agentos/contracts";
import type { AccountAccessRuleView } from "@/lib/agentos/account-access-policy-types";
import type { AccountLoginTargetView } from "@/lib/agentos/account-login-target-types";

/**
 * Workspace account access remains useful for browser-profile permissions.
 * Channel connections intentionally live in AgentConnectionsDialog instead of
 * keeping a disabled workspace routing surface alive here.
 */
export function WorkspaceAccountsDialog({
  snapshot,
  workspaceId,
  accountTargets = [],
  accountAccessRules = [],
  initialAgentId = null,
  open,
  onOpenChange,
  onRefresh,
  onAccountAccessRulesChange,
  onAccountTargetsChange,
  onConnectAccount,
  surfaceTheme = "dark"
}: {
  snapshot: MissionControlSnapshot;
  workspaceId: string | null;
  accountTargets?: AccountLoginTargetView[];
  accountAccessRules?: AccountAccessRuleView[];
  initialAgentId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<void>;
  onAccountAccessRulesChange?: (rules: AccountAccessRuleView[]) => void;
  onAccountTargetsChange?: (targets: AccountLoginTargetView[]) => void;
  onConnectAccount?: () => void;
  surfaceTheme?: "dark" | "light";
}) {
  const workspace = useMemo(
    () => snapshot.workspaces.find((entry) => entry.id === workspaceId) ?? null,
    [snapshot.workspaces, workspaceId]
  );
  const workspaceAgents = useMemo(
    () => snapshot.agents.filter((agent) => agent.workspaceId === workspace?.id),
    [snapshot.agents, workspace?.id]
  );
  const [isSaving, setIsSaving] = useState(false);
  const [repairPreview, setRepairPreview] = useState<SurfaceBindingRepairResult | null>(null);
  const [repairBusy, setRepairBusy] = useState(false);

  const beginSaving = useCallback(() => setIsSaving(true), []);
  const endSaving = useCallback(() => setIsSaving(false), []);
  const {
    accountRulesByTargetId,
    refreshAccounts,
    selectedAccountAgentId,
    setSelectedAccountAgentId,
    updateAgentAccountAccess,
    workspaceAccountTargets
  } = useWorkspaceAccountAccess({
    open,
    workspaceId: workspace?.id ?? null,
    workspaceAgents,
    accountTargets,
    accountAccessRules,
    initialAgentId,
    beginSaving,
    endSaving,
    onAccountAccessRulesChange,
    onAccountTargetsChange
  });

  const handleRefreshAccounts = useCallback(async () => {
    beginSaving();
    try {
      await refreshAccounts();
      await onRefresh();
    } catch (error) {
      toast.error("Accounts refresh failed.", {
        description: error instanceof Error ? error.message : "Account access could not be refreshed."
      });
    } finally {
      endSaving();
    }
  }, [beginSaving, endSaving, onRefresh, refreshAccounts]);

  const handleConnectAccount = useCallback(() => {
    if (onConnectAccount) {
      onConnectAccount();
      return;
    }

    toast.info("Account setup is unavailable.", {
      description: "Choose a workspace account setup action from the Accounts page."
    });
  }, [onConnectAccount]);

  const handleRepairSurfaceDrift = useCallback(async () => {
    if (!workspace) return;
    setRepairBusy(true);
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace.id)}/surfaces/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "workspace", dryRun: true })
      });
      const result = await response.json() as { error?: string; repair?: SurfaceBindingRepairResult };
      if (!response.ok || result.error || !result.repair?.auditId) {
        throw new Error(result.error ?? "OpenClaw binding repair preview could not be created.");
      }
      setRepairPreview(result.repair);
      toast.info("Binding repair preview created.", {
        description: `Audit ${result.repair.auditId} was written without changing OpenClaw config.`
      });
    } catch (error) {
      toast.error("Binding repair preview failed.", {
        description: error instanceof Error ? error.message : "OpenClaw binding repair could not be previewed."
      });
    } finally {
      setRepairBusy(false);
    }
  }, [workspace]);

  const handleApplySurfaceRepairPreview = useCallback(async () => {
    if (!workspace || !repairPreview?.auditId) return;
    setRepairBusy(true);
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace.id)}/surfaces/reconcile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: "workspace",
          dryRun: false,
          confirm: "apply-surface-reconcile",
          previewAuditId: repairPreview.auditId
        })
      });
      const result = await response.json() as { error?: string; repair?: SurfaceBindingRepairResult };
      if (!response.ok || result.error) {
        throw new Error(result.error ?? "OpenClaw bindings could not be reconciled.");
      }
      setRepairPreview(null);
      toast.success("OpenClaw bindings repaired.", {
        description: result.repair
          ? `${result.repair.addedBindingCount} added, ${result.repair.removedBindingCount} removed. Backup ${result.repair.backupId ?? "recorded"}.`
          : "Managed bindings were rewritten from the AgentOS registry."
      });
      await onRefresh();
    } catch (error) {
      toast.error("Binding repair failed.", {
        description: error instanceof Error ? error.message : "OpenClaw bindings could not be reconciled."
      });
    } finally {
      setRepairBusy(false);
    }
  }, [onRefresh, repairPreview, workspace]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={surfaceTheme === "light"
          ? "w-[calc(100vw-1.5rem)] max-w-4xl rounded-[22px] bg-background text-foreground"
          : "w-[calc(100vw-1.5rem)] max-w-4xl rounded-[22px] bg-slate-950 text-slate-100"}
      >
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <KeyRound className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle>Workspace accounts</DialogTitle>
              <DialogDescription className="mt-1">
                Manage browser-profile account access for agents in {workspace?.name ?? "this workspace"}. Channel connections are managed from the selected Agent.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <AccountsSurfaceSection
          workspaceAgents={workspaceAgents}
          selectedAgentId={selectedAccountAgentId}
          onSelectedAgentIdChange={setSelectedAccountAgentId}
          accountTargets={workspaceAccountTargets}
          accountRulesByTargetId={accountRulesByTargetId}
          isSaving={isSaving}
          onToggleAccountAccess={(target, linked) => void updateAgentAccountAccess(target, linked)}
          onRefreshAccounts={() => void handleRefreshAccounts()}
          onConnectAccount={handleConnectAccount}
        />

        <section className="rounded-xl border border-border bg-muted/20 p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">OpenClaw binding diagnostics</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Preview a bounded workspace repair when the native OpenClaw binding projection has drifted. Preview does not change OpenClaw config.</p>
            </div>
            <Button type="button" variant="secondary" size="sm" className="h-8 shrink-0 rounded-lg px-2.5 text-xs" onClick={() => void handleRepairSurfaceDrift()} disabled={!workspace || isSaving || repairBusy}>
              {repairBusy ? "Preparing…" : "Preview binding repair"}
            </Button>
          </div>
        </section>

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(repairPreview)}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !repairBusy) setRepairPreview(null);
        }}
      >
        <DialogContent className="h-dvh max-h-dvh w-screen max-w-none flex-col overflow-hidden rounded-none border-0 p-4 pt-[max(1rem,env(safe-area-inset-top))] sm:h-auto sm:w-auto sm:max-w-2xl sm:rounded-lg sm:border">
          <DialogHeader className="pr-10">
            <DialogTitle>Apply OpenClaw binding repair</DialogTitle>
            <DialogDescription>Confirm the previewed repair before AgentOS writes a bounded OpenClaw config patch.</DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border border-amber-300/35 bg-amber-50/70 p-3 dark:border-amber-300/20 dark:bg-amber-400/[0.07]">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-200" />
              <p className="text-xs leading-5 text-amber-900/80 dark:text-amber-100/80">AgentOS writes a redacted backup before changing only the approved OpenClaw config paths shown here.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <RepairMetric label="Bindings added" value={String(repairPreview?.addedBindingCount ?? 0)} />
            <RepairMetric label="Bindings removed" value={String(repairPreview?.removedBindingCount ?? 0)} />
          </div>
          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Preview audit</p>
            <p className="mt-1 break-all font-mono text-[11px] leading-5 text-foreground">{repairPreview?.auditId ?? "unknown"}</p>
          </div>
          <div className="rounded-xl border border-border bg-muted/20 p-3">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Approved config paths</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {(repairPreview?.restorePlan?.configPaths ?? []).length > 0
                ? repairPreview?.restorePlan?.configPaths.map((configPath) => <Badge key={configPath} variant="muted" className="h-6 rounded-full px-2 text-[10px]">{configPath}</Badge>)
                : <Badge variant="muted" className="h-6 rounded-full px-2 text-[10px]">no config changes</Badge>}
            </div>
          </div>
          <DialogFooter className="pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:pb-0">
            <Button type="button" variant="secondary" disabled={repairBusy} onClick={() => setRepairPreview(null)}>Cancel</Button>
            <Button type="button" disabled={repairBusy || !repairPreview?.auditId} onClick={() => void handleApplySurfaceRepairPreview()}>{repairBusy ? "Applying…" : "Apply repair"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RepairMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2">
      <p className="truncate text-[9px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-[11px] text-foreground">{value}</p>
    </div>
  );
}
