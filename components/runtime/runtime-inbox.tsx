"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Eye,
  Inbox,
  KeyRound,
  LoaderCircle,
  RotateCcw,
  TerminalSquare,
  X
} from "lucide-react";

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
import type { MissionControlSnapshot, OpenClawUpdateStreamEvent, RuntimeIssue } from "@/lib/agentos/contracts";
import { useDeploymentCapabilities } from "@/hooks/use-deployment-capabilities";
import { cn } from "@/lib/utils";
import type { AgentOsSurfaceTheme } from "@/components/ui/design-system";

type SurfaceTheme = AgentOsSurfaceTheme;
type RuntimeAction =
  | "reviewDevices"
  | "approveRequest"
  | "approveLatest"
  | "openRecovery"
  | "restartManagedGateway"
  | "retryConnection"
  | "repairLegacyState"
  | "restoreRollback"
  | "dismiss";

type RuntimeActionResponse = {
  snapshot?: MissionControlSnapshot;
  review?: RuntimeDeviceReview;
  error?: string;
};

type RuntimeDeviceReview = {
  command: string;
  rawOutput: string;
  pendingRequests: Array<{
    deviceId: string | null;
    requestId: string | null;
    status: string | null;
    requestedScopes: string[];
    approvedScopes: string[];
    createdAt: string | null;
    age: string | null;
    recoveryCommand: string | null;
  }>;
};

export function RuntimeIssueIndicator({
  snapshot,
  surfaceTheme,
  onSnapshotChange,
  onRefresh
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  onSnapshotChange?: (snapshot: MissionControlSnapshot) => void;
  onRefresh?: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const summary = summarizeRuntimeIssues(snapshot.diagnostics.runtimeIssues);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-full border px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/45",
          summary.actionCount > 0
            ? surfaceTheme === "light"
              ? "border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100"
              : "border-amber-300/24 bg-amber-300/10 text-amber-100 hover:bg-amber-300/14"
            : surfaceTheme === "light"
              ? "border-border bg-card text-muted-foreground hover:bg-muted"
              : "border-white/10 bg-[#121d2d] text-slate-300 hover:bg-[#182538]"
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            summary.actionCount > 0 ? "bg-amber-500" : "bg-emerald-500"
          )}
        />
        {summary.actionCount > 0 ? `Action required · ${summary.actionCount}` : summary.openCount > 0 ? `Runtime · ${summary.openCount}` : "Runtime"}
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Runtime Inbox"
          className={cn(
            "absolute right-0 top-10 z-[70] isolate max-h-[calc(100vh-96px)] w-[min(92vw,380px)] overflow-hidden rounded-[14px] border p-2.5 shadow-[0_28px_84px_rgba(0,0,0,0.52)]",
            surfaceTheme === "light"
              ? "border-[#d8c7b8] bg-[#fffaf3] text-foreground shadow-[0_28px_70px_rgba(70,48,32,0.22)]"
              : "border-white/[0.12] bg-[#07111f] text-slate-100 ring-1 ring-black/[0.45]"
          )}
        >
          <RuntimeInboxPanel
            snapshot={snapshot}
            surfaceTheme={surfaceTheme}
            variant="dropdown"
            onSnapshotChange={onSnapshotChange}
            onRefresh={onRefresh}
          />
        </div>
      ) : null}
    </div>
  );
}

export function RuntimeIssuesCard({
  snapshot,
  surfaceTheme,
  onSnapshotChange,
  onRefresh
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  onSnapshotChange?: (snapshot: MissionControlSnapshot) => void;
  onRefresh?: () => Promise<void> | void;
}) {
  return (
    <RuntimeInboxPanel
      snapshot={snapshot}
      surfaceTheme={surfaceTheme}
      variant="card"
      maxIssues={3}
      onSnapshotChange={onSnapshotChange}
      onRefresh={onRefresh}
    />
  );
}

export function RuntimeGatewayInlineWarning({
  snapshot,
  surfaceTheme,
  onSnapshotChange,
  onRefresh
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  onSnapshotChange?: (snapshot: MissionControlSnapshot) => void;
  onRefresh?: () => Promise<void> | void;
}) {
  const issue = snapshot.diagnostics.runtimeIssues.find(
    (entry) => entry.type === "scope_upgrade_pending" && entry.status !== "resolved" && entry.status !== "dismissed"
  );

  if (!issue) {
    return null;
  }

  return (
    <div
      className={cn(
        "mt-4 rounded-[14px] border p-3",
        surfaceTheme === "light"
          ? "border-amber-300/70 bg-amber-50/80 text-amber-950"
          : "border-amber-300/24 bg-amber-300/10 text-amber-100"
      )}
    >
      <div className="flex items-start gap-2.5">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Gateway is running, but this device needs permission approval.</p>
          <p className="mt-1 text-xs leading-5 opacity-80">{issue.message}</p>
        </div>
      </div>
      <RuntimeIssueActions
        issue={issue}
        surfaceTheme={surfaceTheme}
        compact
        onSnapshotChange={onSnapshotChange}
        onRefresh={onRefresh}
      />
    </div>
  );
}

export function RuntimeInboxPanel({
  snapshot,
  surfaceTheme,
  variant = "full",
  maxIssues,
  onSnapshotChange,
  onRefresh
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  variant?: "full" | "dropdown" | "card";
  maxIssues?: number;
  onSnapshotChange?: (snapshot: MissionControlSnapshot) => void;
  onRefresh?: () => Promise<void> | void;
}) {
  const [hiddenIssueIds, setHiddenIssueIds] = useState<Set<string>>(() => new Set());
  const [exitingIssueIds, setExitingIssueIds] = useState<Set<string>>(() => new Set());
  const dismissTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const isDropdown = variant === "dropdown";
  const issues = useMemo(() => {
    const all = snapshot.diagnostics.runtimeIssues ?? [];
    const visible = all.filter((issue) => {
      const active = issue.status !== "resolved" && issue.status !== "dismissed";
      return (active || exitingIssueIds.has(issue.id)) && !hiddenIssueIds.has(issue.id);
    });
    return typeof maxIssues === "number" ? visible.slice(0, maxIssues) : visible;
  }, [exitingIssueIds, hiddenIssueIds, maxIssues, snapshot.diagnostics.runtimeIssues]);

  useEffect(() => () => {
    dismissTimersRef.current.forEach(clearTimeout);
    dismissTimersRef.current = [];
  }, []);

  const dismissOptimistically = (issueId: string) => {
    const dismissedAt = new Date().toISOString();
    setExitingIssueIds((current) => new Set(current).add(issueId));
    onSnapshotChange?.({
      ...snapshot,
      diagnostics: {
        ...snapshot.diagnostics,
        runtimeIssues: snapshot.diagnostics.runtimeIssues.map((issue) =>
          issue.id === issueId
            ? {
                ...issue,
                status: "dismissed",
                updatedAt: dismissedAt
              }
            : issue
        )
      }
    });

    const timer = setTimeout(() => {
      setHiddenIssueIds((current) => new Set(current).add(issueId));
      setExitingIssueIds((current) => {
        const next = new Set(current);
        next.delete(issueId);
        return next;
      });
    }, 180);
    dismissTimersRef.current.push(timer);
  };

  return (
    <div className={cn("min-w-0", isDropdown && "flex max-h-[calc(100vh-116px)] flex-col overflow-hidden")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Runtime Inbox</p>
          <h2 className="mt-1 text-sm font-semibold text-current">Runtime Issues</h2>
        </div>
        <span className={cn("rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.14em]", issueCountClassName(surfaceTheme, issues))}>
          {issues.length ? `${issues.length} visible` : "Healthy"}
        </span>
      </div>

      {issues.length === 0 ? (
        <div className={cn("mt-3 rounded-[12px] border p-3", insetClassName(surfaceTheme))}>
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <p className="text-xs leading-5 text-muted-foreground">
              No runtime issues. AgentOS and OpenClaw look healthy.
            </p>
          </div>
        </div>
      ) : (
        <div
          className={cn(
            "mt-3 space-y-2",
            isDropdown && "-mx-1 min-h-0 overflow-y-auto overscroll-contain px-1 pr-2 [scrollbar-width:thin]"
          )}
        >
          {issues.map((issue) => (
            <RuntimeIssueRow
              key={issue.id}
              issue={issue}
              surfaceTheme={surfaceTheme}
              compact={isDropdown}
              exiting={exitingIssueIds.has(issue.id)}
              showDetails={variant === "full"}
              onSnapshotChange={onSnapshotChange}
              onRefresh={onRefresh}
              onOptimisticDismiss={dismissOptimistically}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RuntimeIssueRow({
  issue,
  surfaceTheme,
  compact,
  exiting,
  showDetails,
  onSnapshotChange,
  onRefresh,
  onOptimisticDismiss
}: {
  issue: RuntimeIssue;
  surfaceTheme: SurfaceTheme;
  compact?: boolean;
  exiting?: boolean;
  showDetails?: boolean;
  onSnapshotChange?: (snapshot: MissionControlSnapshot) => void;
  onRefresh?: () => Promise<void> | void;
  onOptimisticDismiss?: (issueId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        "rounded-[13px] border transition-all duration-200 ease-out",
        compact ? "p-2.5" : "p-3",
        exiting ? "max-h-0 scale-[0.98] overflow-hidden border-transparent p-0 opacity-0" : "max-h-[520px] animate-in fade-in-0 slide-in-from-top-1 opacity-100",
        issueRowClassName(surfaceTheme, issue)
      )}
    >
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", severityDotClassName(issue.severity))} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className={cn("min-w-0 font-semibold text-current", compact ? "text-[13px] leading-4" : "text-sm leading-5")}>
              {issue.title}
            </p>
            {compact ? null : <RuntimePill>{formatSeverity(issue.severity)}</RuntimePill>}
            {compact ? null : <RuntimePill>{issue.status}</RuntimePill>}
          </div>
          <p className={cn("mt-1 text-xs opacity-80", compact ? "line-clamp-2 leading-4" : "leading-5")}>
            {issue.message}
          </p>
          <div className={cn("mt-2 flex flex-wrap gap-1.5 uppercase tracking-[0.12em] opacity-70", compact ? "text-[9px]" : "text-[10px]")}>
            <span>{formatSource(issue.source)}</span>
            <span>·</span>
            <span>{formatTimestamp(issue.createdAt)}</span>
            {issue.requestId ? (
              <>
                <span>·</span>
                <span className="font-mono normal-case tracking-normal">{issue.requestId}</span>
              </>
            ) : null}
          </div>
        </div>
      </div>

      <RuntimeIssueActions
        issue={issue}
        surfaceTheme={surfaceTheme}
        compact={compact}
        onSnapshotChange={onSnapshotChange}
        onRefresh={onRefresh}
        onOptimisticDismiss={onOptimisticDismiss}
      />

      {showDetails || issue.rawOutput || issue.errorMessage ? (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
            Details
          </button>
          {expanded ? (
            <div className="mt-2 space-y-2">
              {issue.requestedScopes?.length ? <ScopeLine label="Requested scopes" values={issue.requestedScopes} /> : null}
              {issue.approvedScopes?.length ? <ScopeLine label="Approved scopes" values={issue.approvedScopes} /> : null}
              {issue.errorMessage ? <DiagnosticText label="Error" value={issue.errorMessage} /> : null}
              {issue.rawOutput ? <DiagnosticText label="Raw output" value={issue.rawOutput} /> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function RuntimeIssueActions({
  issue,
  surfaceTheme,
  compact,
  onSnapshotChange,
  onRefresh,
  onOptimisticDismiss
}: {
  issue: RuntimeIssue;
  surfaceTheme: SurfaceTheme;
  compact?: boolean;
  onSnapshotChange?: (snapshot: MissionControlSnapshot) => void;
  onRefresh?: () => Promise<void> | void;
  onOptimisticDismiss?: (issueId: string) => void;
}) {
  const [busyAction, setBusyAction] = useState<RuntimeAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<RuntimeDeviceReview | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [confirmGatewayRestart, setConfirmGatewayRestart] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const deployment = useDeploymentCapabilities();
  const isScopeUpgrade = issue.type === "scope_upgrade_pending";
  const recoveryCommand = issue.recoveryCommand?.trim() || null;
  const rollbackTargetVersion = readRecoveryTargetVersion(recoveryCommand);
  const isRollbackRecovery = issue.type === "openclaw_rollback_needed" || Boolean(
    rollbackTargetVersion && issue.type === "openclaw_postflight_failed"
  );
  const isLegacyStateRepair = issue.type === "openclaw_doctor_warning";
  const isManagedGatewayRecovery = issue.type === "gateway_unreachable" && deployment.gatewayLifecycle === "external-supervisor";
  const canOpenRecovery = Boolean(
    recoveryCommand &&
    deployment.gatewayLifecycle === "agentos-managed" &&
    !isScopeUpgrade &&
    !isRollbackRecovery &&
    !isLegacyStateRepair
  );

  const runAction = async (action: RuntimeAction) => {
    setBusyAction(action);
    setError(null);
    setActionStatus(null);

    try {
      if (action === "retryConnection") {
        setActionStatus("Refreshing Gateway diagnostics...");
        await onRefresh?.();
        setActionStatus(null);
        return;
      }

      if (action === "restartManagedGateway") {
        setActionStatus("Restarting the managed Gateway and waiting for liveness...");
        const response = await fetch("/api/gateway/control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "restart" })
        });
        const payload = await response.json().catch(() => null) as RuntimeActionResponse & { message?: string } | null;

        if (!response.ok) {
          throw new Error(payload?.error || "The managed Gateway restart failed.");
        }

        if (payload?.snapshot) {
          onSnapshotChange?.(payload.snapshot);
        } else {
          await onRefresh?.();
        }
        setActionStatus(null);
        toast.success("Managed Gateway restarted.", {
          description: payload?.message || "OpenClaw passed its liveness check."
        });
        return;
      }

      if (action === "restoreRollback") {
        const response = await fetch("/api/update", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action: "rollback",
            confirmed: true
          })
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error || "OpenClaw restore request failed.");
        }

        const result = await readUpdateStream(response, setActionStatus);
        if (!result.ok) {
          throw new Error(result.message);
        }

        if (result.snapshot) {
          onSnapshotChange?.(result.snapshot);
        }
        await onRefresh?.();
        toast.success("OpenClaw restored.", { description: result.message });
        return;
      }

      if (action === "openRecovery") {
        if (!recoveryCommand) {
          throw new Error("No recovery command is available for this runtime issue.");
        }

        const response = await fetch("/api/system/open-terminal", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            command: recoveryCommand
          })
        });
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;

        if (!response.ok || payload?.error) {
          throw new Error(payload?.error || "Could not open the recovery command.");
        }

        await onRefresh?.();
        return;
      }

      if (action === "repairLegacyState") {
        const response = await fetch("/api/runtime/issues", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            action,
            issueId: issue.id
          })
        });

        const payload = (await response.json().catch(() => null)) as RuntimeActionResponse | null;

        if (!response.ok) {
          throw new Error(payload?.error || "Legacy state repair failed.");
        }

        if (payload?.snapshot) {
          onSnapshotChange?.(payload.snapshot);
        } else {
          await onRefresh?.();
        }
        toast.success("OpenClaw legacy state archived.");
        return;
      }

      if (action === "dismiss") {
        onOptimisticDismiss?.(issue.id);
      }

      const response = await fetch("/api/runtime/issues", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action,
          issueId: issue.id,
          requestId: action === "approveRequest" ? issue.requestId : undefined
        })
      });

      const payload = (await response.json().catch(() => null)) as RuntimeActionResponse | null;

      if (!response.ok) {
        throw new Error(payload?.error || "Runtime issue action failed.");
      }

      if (payload?.review) {
        setReview(payload.review);
      }

      if (payload?.snapshot) {
        onSnapshotChange?.(payload.snapshot);
      } else {
        await onRefresh?.();
      }

      if (action === "dismiss") {
        toast.success("Runtime issue dismissed.");
      }
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Runtime issue action failed.");
      await onRefresh?.();
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className={cn(compact ? "mt-2" : "mt-3")}>
      <div className={cn("flex flex-wrap gap-1.5", compact && "mt-2")}>
        {isScopeUpgrade ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void runAction("reviewDevices")}
            disabled={busyAction !== null}
            className={buttonClassName(surfaceTheme)}
          >
            {busyAction === "reviewDevices" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
            Review devices
          </Button>
        ) : null}
        {isScopeUpgrade && issue.requestId ? (
          <Button
            type="button"
            size="sm"
            onClick={() => void runAction("approveRequest")}
            disabled={busyAction !== null}
            className="h-8 rounded-lg px-2.5 text-xs"
          >
            {busyAction === "approveRequest" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
            Approve request
          </Button>
        ) : null}
        {isScopeUpgrade && !issue.requestId ? (
          <Button
            type="button"
            size="sm"
            onClick={() => void runAction("approveLatest")}
            disabled={busyAction !== null}
            className="h-8 rounded-lg px-2.5 text-xs"
          >
            {busyAction === "approveLatest" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Approve latest
          </Button>
        ) : null}
        {canOpenRecovery ? (
          <Button
            type="button"
            size="sm"
            onClick={() => void runAction("openRecovery")}
            disabled={busyAction !== null}
            className="h-8 rounded-lg px-2.5 text-xs"
          >
            {busyAction === "openRecovery" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <TerminalSquare className="h-3.5 w-3.5" />}
            {resolveRecoveryActionLabel(issue)}
          </Button>
        ) : null}
        {isManagedGatewayRecovery ? (
          <Button
            type="button"
            size="sm"
            onClick={() => setConfirmGatewayRestart(true)}
            disabled={busyAction !== null}
            className="h-8 rounded-lg px-2.5 text-xs"
          >
            {busyAction === "restartManagedGateway" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Restart managed gateway
          </Button>
        ) : null}
        {isManagedGatewayRecovery ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void runAction("retryConnection")}
            disabled={busyAction !== null}
            className={buttonClassName(surfaceTheme)}
          >
            {busyAction === "retryConnection" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Retry connection
          </Button>
        ) : null}
        {isLegacyStateRepair ? (
          <Button
            type="button"
            size="sm"
            onClick={() => void runAction("repairLegacyState")}
            disabled={busyAction !== null}
            className="h-8 rounded-lg px-2.5 text-xs"
          >
            {busyAction === "repairLegacyState" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <TerminalSquare className="h-3.5 w-3.5" />}
            Archive legacy state
          </Button>
        ) : null}
        {isRollbackRecovery && recoveryCommand ? (
          <Button
            type="button"
            size="sm"
            onClick={() => setConfirmRestore(true)}
            disabled={busyAction !== null}
            className="h-8 rounded-lg px-2.5 text-xs"
          >
            {busyAction === "restoreRollback" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Restore last working
          </Button>
        ) : null}
        {issue.status !== "dismissed" && issue.status !== "resolved" ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void runAction("dismiss")}
            disabled={busyAction !== null}
            className={buttonClassName(surfaceTheme)}
          >
            <X className="h-3.5 w-3.5" />
            Dismiss
          </Button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-xs leading-5 text-rose-500">{error}</p> : null}
      {actionStatus ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{actionStatus}</p> : null}
      {canOpenRecovery && !compact ? (
        <p className="mt-2 break-words font-mono text-[10px] leading-4 text-muted-foreground">
          {recoveryCommand}
        </p>
      ) : null}
      {isManagedGatewayRecovery ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Railway automatically recovers failed Gateway processes. You can also restart only the managed Gateway here without restarting AgentOS.
        </p>
      ) : null}
      {review ? <RuntimeDeviceReviewPanel review={review} surfaceTheme={surfaceTheme} /> : null}
      <Dialog open={confirmRestore} onOpenChange={setConfirmRestore}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore the last working OpenClaw version?</DialogTitle>
            <DialogDescription>
              This mutates the installed OpenClaw version, restores saved configuration when available, restarts the Gateway and verifies health.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <div className="grid gap-2 text-xs sm:grid-cols-2">
              <span className="text-muted-foreground">Restore target</span>
              <strong className="font-mono text-foreground sm:text-right">
                {rollbackTargetVersion ? `v${rollbackTargetVersion}` : "Saved rollback snapshot"}
              </strong>
              <span className="text-muted-foreground">Gateway impact</span>
              <strong className="font-medium text-foreground sm:text-right">Restart and health verification</strong>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirmRestore(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmRestore(false);
                void runAction("restoreRollback");
              }}
            >
              Restore and restart
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmGatewayRestart} onOpenChange={setConfirmGatewayRestart}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restart the managed OpenClaw Gateway?</DialogTitle>
            <DialogDescription>
              Active Gateway-backed tasks may be interrupted briefly. AgentOS will ask the Railway supervisor to restart only the Gateway and wait for liveness. Detailed runtime readiness remains visible in diagnostics.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setConfirmGatewayRestart(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmGatewayRestart(false);
                void runAction("restartManagedGateway");
              }}
            >
              Restart managed gateway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

async function readUpdateStream(
  response: Response,
  onStatus: (message: string) => void
): Promise<Extract<OpenClawUpdateStreamEvent, { type: "done" }>> {
  if (!response.body) {
    throw new Error("OpenClaw restore did not return a readable stream.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: Extract<OpenClawUpdateStreamEvent, { type: "done" }> | null = null;

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const event = JSON.parse(line) as OpenClawUpdateStreamEvent;
      if (event.type === "status") {
        onStatus(event.message);
      } else if (event.type === "done") {
        result = event;
      }
    }

    if (done) {
      break;
    }
  }

  if (!result) {
    throw new Error("OpenClaw restore stream ended unexpectedly.");
  }

  return result;
}

function readRecoveryTargetVersion(command: string | null) {
  return command?.match(/\bupdate\s+--tag\s+v?(\d+(?:\.\d+)+)\b/i)?.[1] ?? null;
}

function resolveRecoveryActionLabel(issue: RuntimeIssue) {
  if (issue.type === "openclaw_rollback_needed") {
    return "Restore last working";
  }

  if (issue.type === "gateway_unreachable") {
    return "Restart gateway";
  }

  if (issue.type === "openclaw_doctor_warning") {
    return "Open doctor fix";
  }

  return "Open recovery";
}

function RuntimeDeviceReviewPanel({ review, surfaceTheme }: { review: RuntimeDeviceReview; surfaceTheme: SurfaceTheme }) {
  return (
    <div className={cn("mt-3 rounded-[12px] border p-3", insetClassName(surfaceTheme))}>
      <div className="flex items-center gap-2">
        <Inbox className="h-3.5 w-3.5" />
        <p className="text-xs font-semibold">Device review</p>
      </div>
      {review.pendingRequests.length ? (
        <div className="mt-2 space-y-2">
          {review.pendingRequests.map((request, index) => (
            <div key={`${request.requestId ?? "request"}:${index}`} className="rounded-lg border border-border bg-background/45 p-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold">{request.status ?? "Pending request"}</span>
                {request.age ? <RuntimePill>{request.age}</RuntimePill> : null}
              </div>
              <div className="mt-2 grid gap-1.5 text-[11px] leading-4 text-muted-foreground">
                <span>Device: <code>{request.deviceId ?? "Unknown"}</code></span>
                <span>Request: <code>{request.requestId ?? "Unknown"}</code></span>
                <span>Requested scopes: {formatScopeList(request.requestedScopes)}</span>
                <span>Approved scopes: {formatScopeList(request.approvedScopes)}</span>
                {request.recoveryCommand ? <span>Recovery: <code>{request.recoveryCommand}</code></span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">No pending device requests were returned by OpenClaw.</p>
      )}
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Raw output</summary>
        <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-black/20 p-2 text-[11px] leading-4 text-muted-foreground">
          {review.rawOutput || "No output."}
        </pre>
      </details>
    </div>
  );
}

function ScopeLine({ label, values }: { label: string; values: string[] }) {
  return <p className="text-xs text-muted-foreground">{label}: {formatScopeList(values)}</p>;
}

function DiagnosticText({ label, value }: { label: string; value: string }) {
  return (
    <details>
      <summary className="cursor-pointer text-xs font-medium text-muted-foreground">{label}</summary>
      <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-black/20 p-2 text-[11px] leading-4 text-muted-foreground">
        {value}
      </pre>
    </details>
  );
}

function RuntimePill({ children }: { children: string }) {
  return (
    <span className="inline-flex rounded-full border border-current/15 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.11em] opacity-75">
      {children}
    </span>
  );
}

function summarizeRuntimeIssues(issues: RuntimeIssue[]) {
  const openIssues = issues.filter((issue) => issue.status === "open" || issue.status === "resolving" || issue.status === "failed");
  return {
    openCount: openIssues.length,
    actionCount: openIssues.filter((issue) => issue.severity === "action_required" || issue.severity === "blocked").length
  };
}

function formatSeverity(value: RuntimeIssue["severity"]) {
  return value.replace(/_/g, " ");
}

function formatSource(value: RuntimeIssue["source"]) {
  return value.replace(/_/g, " ");
}

function formatTimestamp(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "Unknown time";
  }

  return new Date(timestamp).toLocaleString();
}

function formatScopeList(values: string[]) {
  return values.length ? values.join(", ") : "None";
}

function severityDotClassName(severity: RuntimeIssue["severity"]) {
  switch (severity) {
    case "blocked":
      return "bg-rose-500";
    case "action_required":
      return "bg-amber-500";
    case "warning":
      return "bg-yellow-500";
    case "info":
      return "bg-sky-500";
  }
}

function issueRowClassName(surfaceTheme: SurfaceTheme, issue: RuntimeIssue) {
  if (issue.severity === "blocked") {
    return surfaceTheme === "light"
      ? "border-rose-200 bg-rose-50/70"
      : "border-rose-300/20 bg-rose-300/10";
  }

  if (issue.severity === "action_required" || issue.severity === "warning") {
    return surfaceTheme === "light"
      ? "border-amber-200 bg-amber-50/65"
      : "border-amber-300/18 bg-amber-300/[0.08]";
  }

  return insetClassName(surfaceTheme);
}

function issueCountClassName(surfaceTheme: SurfaceTheme, issues: RuntimeIssue[]) {
  const hasAction = issues.some((issue) => issue.severity === "action_required" || issue.severity === "blocked");
  if (hasAction) {
    return surfaceTheme === "light"
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-amber-300/24 bg-amber-300/10 text-amber-100";
  }

  return surfaceTheme === "light"
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-emerald-300/20 bg-emerald-300/[0.08] text-emerald-200";
}

function insetClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light"
    ? "border-border bg-muted/45"
    : "border-white/[0.08] bg-white/[0.035]";
}

function buttonClassName(surfaceTheme: SurfaceTheme) {
  return cn(
    "h-8 rounded-lg px-2.5 text-xs",
    surfaceTheme === "light"
      ? "border-border bg-card text-foreground hover:bg-muted"
      : "border-white/10 bg-[#121d2d] text-slate-200 hover:bg-[#182538]"
  );
}
