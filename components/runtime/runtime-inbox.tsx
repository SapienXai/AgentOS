"use client";

import { useMemo, useState } from "react";
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
import type { MissionControlSnapshot, RuntimeIssue } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";
type RuntimeAction = "reviewDevices" | "approveRequest" | "approveLatest" | "openRecovery" | "dismiss";

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
  const summary = summarizeRuntimeIssues(snapshot.diagnostics.runtimeIssues);

  return (
    <div className="relative">
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
            "absolute right-0 top-10 z-[70] isolate w-[min(92vw,420px)] rounded-[16px] border p-3 shadow-[0_28px_84px_rgba(0,0,0,0.52)]",
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
  const issues = useMemo(() => {
    const all = snapshot.diagnostics.runtimeIssues ?? [];
    const visible = variant === "full"
      ? all
      : all.filter((issue) => issue.status !== "resolved" && issue.status !== "dismissed");
    return typeof maxIssues === "number" ? visible.slice(0, maxIssues) : visible;
  }, [maxIssues, snapshot.diagnostics.runtimeIssues, variant]);

  return (
    <div className="min-w-0">
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
        <div className="mt-3 space-y-2">
          {issues.map((issue) => (
            <RuntimeIssueRow
              key={issue.id}
              issue={issue}
              surfaceTheme={surfaceTheme}
              showDetails={variant === "full"}
              onSnapshotChange={onSnapshotChange}
              onRefresh={onRefresh}
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
  showDetails,
  onSnapshotChange,
  onRefresh
}: {
  issue: RuntimeIssue;
  surfaceTheme: SurfaceTheme;
  showDetails?: boolean;
  onSnapshotChange?: (snapshot: MissionControlSnapshot) => void;
  onRefresh?: () => Promise<void> | void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn("rounded-[13px] border p-3", issueRowClassName(surfaceTheme, issue))}>
      <div className="flex items-start gap-2.5">
        <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", severityDotClassName(issue.severity))} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="min-w-0 text-sm font-semibold leading-5 text-current">{issue.title}</p>
            <RuntimePill>{formatSeverity(issue.severity)}</RuntimePill>
            <RuntimePill>{issue.status}</RuntimePill>
          </div>
          <p className="mt-1 text-xs leading-5 opacity-80">{issue.message}</p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] uppercase tracking-[0.12em] opacity-70">
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
        onSnapshotChange={onSnapshotChange}
        onRefresh={onRefresh}
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
  onRefresh
}: {
  issue: RuntimeIssue;
  surfaceTheme: SurfaceTheme;
  compact?: boolean;
  onSnapshotChange?: (snapshot: MissionControlSnapshot) => void;
  onRefresh?: () => Promise<void> | void;
}) {
  const [busyAction, setBusyAction] = useState<RuntimeAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<RuntimeDeviceReview | null>(null);
  const isScopeUpgrade = issue.type === "scope_upgrade_pending";
  const recoveryCommand = issue.recoveryCommand?.trim() || null;
  const canOpenRecovery = Boolean(recoveryCommand && !isScopeUpgrade);

  const runAction = async (action: RuntimeAction) => {
    setBusyAction(action);
    setError(null);

    try {
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
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Runtime issue action failed.");
      await onRefresh?.();
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="mt-3">
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
      {canOpenRecovery ? (
        <p className="mt-2 break-words font-mono text-[10px] leading-4 text-muted-foreground">
          {recoveryCommand}
        </p>
      ) : null}
      {review ? <RuntimeDeviceReviewPanel review={review} surfaceTheme={surfaceTheme} /> : null}
    </div>
  );
}

function resolveRecoveryActionLabel(issue: RuntimeIssue) {
  if (issue.type === "openclaw_rollback_needed") {
    return "Restore last working";
  }

  if (issue.type === "gateway_unreachable") {
    return "Restart gateway";
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
