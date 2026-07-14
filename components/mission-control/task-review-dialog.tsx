"use client";

import {
  AlertTriangle,
  ChevronDown,
  CheckCircle2,
  ClipboardList,
  CornerDownRight,
  Eye,
  Loader2,
  RefreshCw,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { InteractiveContent } from "@/components/mission-control/interactive-content";
import {
  readTaskReviewAction,
  resolveEffectiveTaskReviewStatus,
  resolveTaskReviewBadgeLabel,
  resolveTaskReviewSummary
} from "@/components/mission-control/task-review-state";
import {
  findLatestTaskRuntimeFailure,
  isBrowserTabUnavailableDetail,
  isGatewayWaitTimeoutDetail,
  resolveTaskDispatchIssueDetail,
  resolveTaskReviewPresentation,
  resolveTaskRuntimeFailureSummary
} from "@/components/mission-control/task-node-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useTaskFeed } from "@/hooks/use-task-feed";
import type { MissionControlSnapshot, TaskFeedEvent, WorkItemRecord } from "@/lib/agentos/contracts";
import {
  formatAgentDisplayName,
  formatRelativeTime,
  shortId
} from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type TaskReviewDialogProps = {
  open: boolean;
  task: WorkItemRecord | null;
  snapshot: MissionControlSnapshot;
  surfaceTheme: "dark" | "light";
  onOpenChange: (open: boolean) => void;
  onAccept: (task: WorkItemRecord) => Promise<void> | void;
  onContinue: (
    task: WorkItemRecord,
    capturedOutput: string,
    operatorMessage?: string,
    capturedOutputLabel?: string
  ) => Promise<void> | void;
  onRetry: (task: WorkItemRecord) => Promise<void> | void;
  onDismiss: (task: WorkItemRecord) => Promise<void> | void;
  onOpenEvidence: (task: WorkItemRecord, target: "overview" | "output" | "files") => void;
  onOperationComplete?: () => Promise<void> | void;
};
type TaskReviewPendingAction = "accept" | "continue" | "retry" | "run" | "pause" | "resume" | "dismiss" | null;

export function TaskReviewDialog({
  open,
  task,
  snapshot,
  surfaceTheme,
  onOpenChange,
  onAccept,
  onContinue,
  onRetry,
  onDismiss,
  onOpenEvidence,
  onOperationComplete
}: TaskReviewDialogProps) {
  const [pendingAction, setPendingAction] = useState<TaskReviewPendingAction>(null);
  const [operatorReply, setOperatorReply] = useState("");
  const [activityExpanded, setActivityExpanded] = useState(false);
  const localFeed = useMemo(
    () => readTaskFeedEvents(task?.metadata.optimisticEvents),
    [task?.metadata.optimisticEvents]
  );
  const { detail, loading, error } = useTaskFeed(task?.id ?? "task-review:none", open && Boolean(task), {
    dispatchId: task?.dispatchId,
    optimisticFeed: localFeed
  });
  const currentTask = mergeLocalTaskReviewMetadata(detail?.task, task);
  const integrity = detail?.integrity ?? null;
  const workspace = currentTask
    ? snapshot.workspaces.find((entry) => entry.id === currentTask.workspaceId) ?? null
    : null;
  const agent = currentTask
    ? snapshot.agents.find((entry) => entry.id === currentTask.primaryAgentId) ?? null
    : null;
  const latestEvidenceEvent = findLatestOutputEvidenceEvent(detail?.liveFeed ?? []);
  const latestRuntimeFailure = findLatestTaskRuntimeFailure(detail?.liveFeed ?? []);
  const latestRuntimeFailureDetail = latestRuntimeFailure?.detail.trim() || null;
  const reviewStatus = currentTask
    ? resolveEffectiveTaskReviewStatus(currentTask, {
        hasLiveActivity: currentTask.status === "running" || currentTask.status === "queued" || currentTask.liveRunCount > 0,
        latestEvidenceAt: latestEvidenceEvent?.timestamp ?? null
      })
    : null;
  const reviewAction = currentTask ? readTaskReviewAction(currentTask) : null;
  const capturedTaskOutput = currentTask ? readCapturedTaskOutput(currentTask, integrity?.finalResponseText) : "";
  const hasCapturedOutputEvidence = currentTask
    ? hasExplicitCapturedTaskOutput(currentTask, integrity?.finalResponseText)
    : false;
  const createdFiles = detail?.createdFiles ?? [];
  const originalPrompt = currentTask ? readTaskPromptText(currentTask) : "";
  const issue = integrity?.issues.find((entry) => entry.id === "partial-final-response") ?? integrity?.issues[0] ?? null;
  const dispatchIssueDetail = currentTask ? resolveTaskDispatchIssueDetail(currentTask, integrity) : null;
  const reviewPresentation = currentTask
    ? resolveTaskReviewPresentation(currentTask, integrity)
    : null;
  const isDeliveryUnconfirmed = reviewPresentation?.deliveryUnconfirmed ?? false;
  const browserTabUnavailable = isBrowserTabUnavailableDetail(latestRuntimeFailureDetail);
  const capturedOutput = latestRuntimeFailureDetail || capturedTaskOutput;
  const isVerified = integrity?.status === "verified" && !issue;
  const statusLabel = reviewStatus ? resolveTaskReviewBadgeLabel(reviewStatus) : isVerified ? "verified" : "needs review";
  const issueSummary = latestRuntimeFailureDetail
    ? resolveTaskRuntimeFailureSummary(latestRuntimeFailureDetail)
    : reviewStatus
    ? resolveTaskReviewSummary(reviewStatus)
    : resolveReviewIssueSummary(dispatchIssueDetail, issue?.detail) ||
      (isVerified
        ? "AgentOS recovered a matching completed response and no review issues remain."
        : "The captured task evidence needs an operator decision before AgentOS treats the result as handled.");
  const rawIssueDetail = latestRuntimeFailureDetail || dispatchIssueDetail || issue?.detail || null;
  const shouldShowRawIssueDetail = rawIssueDetail && rawIssueDetail !== issueSummary;
  const reportedFileCount = createdFiles.length || currentTask?.artifactCount || 0;
  const hasAcceptableEvidence = hasCapturedOutputEvidence || reportedFileCount > 0;
  const capturedOutputLabel = latestRuntimeFailureDetail
    ? "Latest runtime error"
    : isDeliveryUnconfirmed
    ? "Last captured response — unverified"
    : "Captured output";
  const browserRecoveryInstruction = browserTabUnavailable
    ? "List the currently available browser tabs first. If the previous tab is gone, reopen the required page and continue from the current task state. Before sending or changing anything, verify whether the requested external action already happened so it is not duplicated."
    : "";
  const taskModel = currentTask && typeof currentTask.metadata.modelId === "string"
    ? currentTask.metadata.modelId
    : currentTask && typeof currentTask.metadata.requestedModelId === "string"
      ? currentTask.metadata.requestedModelId
      : agent?.modelId && agent.modelId !== "unassigned"
        ? agent.modelId
        : "Model unavailable";
  const lastActivity = latestEvidenceEvent?.detail.trim() || capturedOutput || "No meaningful agent or tool activity was captured.";
  const recommendedAction = browserTabUnavailable
    ? "Continue the existing session after refreshing available tabs, and verify the external action was not already completed."
    : isDeliveryUnconfirmed
      ? "Continue the existing session and ask the agent to verify delivery before considering a retry."
      : "Continue with a focused instruction; retry only if the current run cannot be recovered safely.";
  const isLight = surfaceTheme === "light";
  const isActionPending = pendingAction !== null;
  const operationJobId = currentTask && typeof currentTask.metadata.operationJobId === "string"
    ? currentTask.metadata.operationJobId
    : null;
  const isScheduledOperation = Boolean(operationJobId);
  const operationPaused = currentTask?.metadata.operationStatus === "paused";
  const operationFailed = currentTask?.metadata.lastRunStatus === "error" || Boolean(currentTask?.metadata.operationLastError);
  const operationLastError = typeof currentTask?.metadata.operationLastError === "string"
    ? currentTask.metadata.operationLastError
    : null;
  const operationScheduleLabel = typeof currentTask?.metadata.scheduleLabel === "string"
    ? currentTask.metadata.scheduleLabel
    : "Scheduled operation";

  const performOperationAction = async (action: "run" | "retry" | "pause" | "resume") => {
    if (!operationJobId) return;
    const response = await fetch("/api/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, jobId: operationJobId })
    });
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok || payload?.error) throw new Error(payload?.error || "OpenClaw rejected the operation action.");
    await onOperationComplete?.();
    onOpenChange(false);
  };

  useEffect(() => {
    setOperatorReply("");
    setActivityExpanded(false);
  }, [open, task?.id]);

  const runAction = async (action: Exclude<TaskReviewPendingAction, null>, callback: () => Promise<void> | void) => {
    if (pendingAction) {
      return;
    }

    setPendingAction(action);

    try {
      await callback();
    } catch (actionError) {
      toast.error("Review action failed.", {
        description: actionError instanceof Error ? actionError.message : "The requested action could not be completed."
      });
    } finally {
      setPendingAction(null);
    }
  };

  if (isScheduledOperation) {
    const incompleteRun = currentTask?.status === "stalled" || operationFailed;
    const reviewReason = operationLastError || rawIssueDetail || (incompleteRun
      ? "The scheduled run stopped after producing an intermediate response. No final completion was confirmed."
      : "The latest scheduled result needs an operator decision.");
    const nextRunAt = typeof currentTask?.metadata.nextRunAt === "string" ? currentTask.metadata.nextRunAt : null;

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(
            "w-[calc(100vw-24px)] max-w-[680px] gap-0 overflow-hidden rounded-[20px] border p-0",
            isLight
              ? "border-slate-200 bg-white text-slate-950 shadow-[0_20px_65px_rgba(15,23,42,0.2)]"
              : "border-white/[0.1] bg-slate-950 text-white shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
          )}
          closeClassName={isLight ? "text-slate-500 hover:bg-slate-950/5 hover:text-slate-900" : undefined}
        >
          <div className={cn("border-b px-5 py-4 pr-12", isLight ? "border-slate-200" : "border-white/[0.08]")}>
            <div className="flex items-start gap-3">
              <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border", incompleteRun ? "border-amber-400/25 bg-amber-400/10 text-amber-500" : "border-primary/20 bg-primary/10 text-primary")}>
                {incompleteRun ? <AlertTriangle className="h-4 w-4" /> : <ClipboardList className="h-4 w-4" />}
              </div>
              <DialogHeader className="min-w-0 flex-1 space-y-1 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={incompleteRun ? "warning" : "muted"}>{incompleteRun ? "run incomplete" : "review result"}</Badge>
                  <span className={cn("text-[10px]", isLight ? "text-slate-500" : "text-slate-400")}>{operationScheduleLabel}</span>
                </div>
                <DialogTitle className={cn("line-clamp-2 text-[16px] leading-6", isLight && "text-slate-950")}>
                  {currentTask?.title.trim() || "Scheduled run review"}
                </DialogTitle>
                <DialogDescription className={isLight ? "text-slate-500" : "text-slate-400"}>
                  {workspace?.name || "Workspace"}{agent ? ` · ${formatAgentDisplayName(agent)}` : ""}
                </DialogDescription>
              </DialogHeader>
            </div>
          </div>

          <div className="space-y-3 px-5 py-4">
            <section className={cn("rounded-[14px] border px-3.5 py-3", incompleteRun ? isLight ? "border-amber-200 bg-amber-50" : "border-amber-300/20 bg-amber-400/[0.08]" : isLight ? "border-slate-200 bg-slate-50" : "border-white/[0.08] bg-white/[0.035]")}>
              <p className={cn("text-[10px] font-semibold uppercase tracking-[0.16em]", incompleteRun ? "text-amber-700" : isLight ? "text-slate-500" : "text-slate-400")}>What needs review</p>
              <p className={cn("mt-1.5 text-[13px] leading-5", isLight ? "text-slate-800" : "text-slate-100")}>{reviewReason}</p>
            </section>

            <div className="grid gap-3 sm:grid-cols-2">
              <section className={cn("min-w-0 rounded-[14px] border p-3.5", isLight ? "border-slate-200 bg-white" : "border-white/[0.08] bg-white/[0.025]")}>
                <p className={cn("text-[10px] font-semibold uppercase tracking-[0.16em]", isLight ? "text-slate-500" : "text-slate-400")}>Last captured output</p>
                <div className="mt-2 max-h-[132px] overflow-y-auto pr-1">
                  <InteractiveContent
                    text={capturedOutput || "No assistant output was captured before the run stopped."}
                    className={cn("text-[12.5px] leading-5", isLight ? "text-slate-700" : "text-slate-200")}
                    compact
                  />
                </div>
              </section>
              <section className={cn("min-w-0 rounded-[14px] border p-3.5", isLight ? "border-slate-200 bg-slate-50" : "border-white/[0.08] bg-white/[0.025]")}>
                <p className={cn("text-[10px] font-semibold uppercase tracking-[0.16em]", isLight ? "text-slate-500" : "text-slate-400")}>Expected outcome</p>
                <p className={cn("mt-2 line-clamp-5 text-[12.5px] leading-5", isLight ? "text-slate-700" : "text-slate-200")}>{originalPrompt || "No original prompt was captured."}</p>
              </section>
            </div>

            <div className={cn("flex flex-wrap items-center justify-between gap-2 rounded-[12px] border px-3 py-2", isLight ? "border-slate-200 bg-slate-50 text-slate-600" : "border-white/[0.08] bg-white/[0.025] text-slate-400")}>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                <span>Status: <strong className={isLight ? "text-slate-800" : "text-slate-200"}>{operationPaused ? "paused" : currentTask?.status ?? "unknown"}</strong></span>
                <span>{nextRunAt ? `Next: ${new Date(nextRunAt).toLocaleString()}` : operationPaused ? "No future runs while paused" : "Next run unavailable"}</span>
              </div>
              <button type="button" className="text-[11px] font-semibold text-primary hover:underline" onClick={() => currentTask && onOpenEvidence(currentTask, "output")}>Open full evidence</button>
            </div>
          </div>

          <div className={cn("flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3.5", isLight ? "border-slate-200 bg-slate-50" : "border-white/[0.08] bg-white/[0.025]")}>
            <Button type="button" variant="ghost" disabled={!currentTask || isActionPending} onClick={() => void runAction("dismiss", () => {
              if (currentTask) return onDismiss(currentTask);
            })}>
              {pendingAction === "dismiss" ? "Acknowledging..." : "Acknowledge"}
            </Button>
            <Button type="button" variant="secondary" disabled={isActionPending} onClick={() => void runAction(operationPaused ? "resume" : "pause", () => performOperationAction(operationPaused ? "resume" : "pause"))}>
              {pendingAction === "pause" || pendingAction === "resume" ? "Updating..." : operationPaused ? "Resume schedule" : "Pause schedule"}
            </Button>
            <Button type="button" className="bg-primary text-primary-foreground hover:bg-primary/90" disabled={isActionPending || operationPaused} onClick={() => void runAction(incompleteRun ? "retry" : "run", () => performOperationAction(incompleteRun ? "retry" : "run"))}>
              {pendingAction === "retry" || pendingAction === "run" ? "Starting..." : incompleteRun ? "Retry failed run" : "Run now"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const hasLongActivity = lastActivity.length > 280;

  return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(
            "w-[calc(100vw-24px)] max-w-[620px] gap-0 overflow-hidden rounded-[22px] border p-0",
            isLight
              ? "border-slate-200 bg-white text-slate-950 shadow-[0_20px_65px_rgba(15,23,42,0.2)]"
              : "border-white/[0.1] bg-slate-950 text-white shadow-[0_24px_80px_rgba(0,0,0,0.45)]"
          )}
          closeClassName={isLight ? "text-slate-500 hover:bg-slate-950/5 hover:text-slate-900" : undefined}
        >
          <div className={cn("border-b px-5 py-4 pr-12", isLight ? "border-slate-200" : "border-white/[0.08]") }>
            <div className="flex items-start gap-3">
              <div className={cn(
                "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
                reviewStatus === "accepted" || isVerified
                  ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-500"
                  : "border-amber-400/25 bg-amber-400/10 text-amber-500"
              )}>
                {reviewStatus === "accepted" || isVerified ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              </div>
              <DialogHeader className="min-w-0 flex-1 space-y-1 text-left">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={reviewStatus === "accepted" || isVerified ? "success" : "warning"}>{statusLabel}</Badge>
                  <span className={cn("truncate text-[11px]", isLight ? "text-slate-500" : "text-slate-400")}>{agent ? formatAgentDisplayName(agent) : "Unknown agent"}</span>
                  <span aria-hidden="true" className={isLight ? "text-slate-300" : "text-slate-700"}>·</span>
                  <span className={cn("max-w-[190px] truncate text-[11px]", isLight ? "text-slate-500" : "text-slate-400")}>{taskModel}</span>
                </div>
                <DialogTitle className={cn("line-clamp-2 text-[17px] leading-6", isLight && "text-slate-950")}>{currentTask?.title.trim() || "Task review"}</DialogTitle>
                <DialogDescription className={isLight ? "text-slate-500" : "text-slate-400"}>{workspace?.name || "Workspace"}</DialogDescription>
              </DialogHeader>
            </div>
          </div>

          <div className="max-h-[calc(100dvh-190px)] space-y-4 overflow-y-auto px-5 py-4">
            <section>
              <p className={cn("text-[10px] font-semibold uppercase tracking-[0.17em]", isLight ? "text-slate-500" : "text-slate-400")}>What happened</p>
              <p className={cn("mt-1.5 text-[13px] leading-5", isLight ? "text-slate-800" : "text-slate-100")}>{issueSummary}</p>
            </section>

            <section className={cn("rounded-[14px] border p-3.5", isLight ? "border-slate-200 bg-slate-50" : "border-white/[0.08] bg-white/[0.035]") }>
              <div className="flex items-center justify-between gap-3">
                <p className={cn("text-[10px] font-semibold uppercase tracking-[0.17em]", isLight ? "text-slate-500" : "text-slate-400")}>Last activity</p>
                {latestEvidenceEvent?.timestamp ? <span className={cn("text-[10px]", isLight ? "text-slate-400" : "text-slate-500")}>{formatRelativeTime(Date.parse(latestEvidenceEvent.timestamp))}</span> : null}
              </div>
              <div className={cn("mt-2 text-[12.5px] leading-5", !activityExpanded && "line-clamp-4", isLight ? "text-slate-700" : "text-slate-200")}>
                <InteractiveContent text={lastActivity} compact />
              </div>
              {hasLongActivity ? <button type="button" className="mt-2 text-[11px] font-semibold text-primary hover:underline" onClick={() => setActivityExpanded((value) => !value)}>{activityExpanded ? "Show less" : "Show full activity"}</button> : null}
            </section>

            <section className={cn("rounded-[14px] border px-3.5 py-3", isLight ? "border-primary/20 bg-primary/[0.055]" : "border-primary/20 bg-primary/[0.08]") }>
              <p className="text-[10px] font-semibold uppercase tracking-[0.17em] text-primary">Recommended action</p>
              <p className={cn("mt-1.5 text-[12.5px] leading-5", isLight ? "text-slate-800" : "text-slate-100")}>{recommendedAction}</p>
            </section>

            <details className={cn("group rounded-[14px] border", isLight ? "border-slate-200 bg-white" : "border-white/[0.08] bg-white/[0.02]") }>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-3 text-[12px] font-medium text-foreground">
                Technical details
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform group-open:rotate-180" />
              </summary>
              <div className={cn("space-y-3 border-t px-3.5 py-3", isLight ? "border-slate-200" : "border-white/[0.08]") }>
                {shouldShowRawIssueDetail ? <div><p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Runtime detail</p><p className="mt-1 break-words font-mono text-[11px] leading-5 text-foreground">{rawIssueDetail}</p></div> : null}
                {latestRuntimeFailureDetail && dispatchIssueDetail && dispatchIssueDetail !== latestRuntimeFailureDetail ? <div><p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Gateway observation</p><p className="mt-1 text-[11px] leading-5 text-muted-foreground">{isGatewayWaitTimeoutDetail(dispatchIssueDetail) ? "AgentOS stopped waiting for a terminal Gateway response. This did not cancel the underlying OpenClaw run." : dispatchIssueDetail}</p></div> : null}
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                  <span className="text-muted-foreground">Task status</span><span className="text-right text-foreground">{currentTask?.status ?? "unknown"}</span>
                  <span className="text-muted-foreground">Dispatch</span><span className="truncate text-right font-mono text-foreground">{currentTask?.dispatchId ? shortId(currentTask.dispatchId.replace(/^dispatch-/, ""), 10) : "unavailable"}</span>
                  <span className="text-muted-foreground">Files</span><span className="text-right text-foreground">{reportedFileCount}</span>
                  {reviewAction ? <><span className="text-muted-foreground">Last decision</span><span className="text-right text-foreground">{reviewAction}</span></> : null}
                </div>
                {error ? <p className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] leading-5 text-amber-700 dark:text-amber-200">{error}</p> : null}
                {loading ? <div className="flex items-center gap-2 text-[11px] text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Refreshing evidence…</div> : null}
                <div>
                  <p className="mb-1.5 text-[10px] uppercase tracking-[0.15em] text-muted-foreground">Continuation instruction <span className="normal-case tracking-normal">(optional)</span></p>
                  <Textarea value={operatorReply} onChange={(event) => setOperatorReply(event.target.value)} placeholder="Add a precise instruction before continuing…" className="min-h-[72px] resize-y text-xs" disabled={!currentTask || isActionPending} />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" variant="ghost" disabled={!currentTask || isActionPending} onClick={() => currentTask && onOpenEvidence(currentTask, "output")}><Eye className="mr-1.5 h-3.5 w-3.5" />Open activity</Button>
                  {reportedFileCount > 0 ? <Button type="button" size="sm" variant="ghost" disabled={!currentTask || isActionPending} onClick={() => currentTask && onOpenEvidence(currentTask, "files")}>Open files</Button> : null}
                  {hasAcceptableEvidence ? <Button type="button" size="sm" variant="ghost" disabled={!currentTask || isActionPending} onClick={() => void runAction("accept", () => currentTask ? onAccept(currentTask) : undefined)}>{pendingAction === "accept" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />}Accept evidence</Button> : null}
                </div>
              </div>
            </details>
          </div>

          <div className={cn("flex flex-col-reverse gap-2 border-t px-5 py-3.5 sm:flex-row sm:items-center sm:justify-end", isLight ? "border-slate-200 bg-slate-50" : "border-white/[0.08] bg-white/[0.025]") }>
            <Button type="button" variant="ghost" disabled={!currentTask || isActionPending} onClick={() => void runAction("dismiss", () => currentTask ? onDismiss(currentTask) : undefined)}>{pendingAction === "dismiss" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <XCircle className="mr-1.5 h-3.5 w-3.5" />}{pendingAction === "dismiss" ? "Acknowledging…" : "Acknowledge"}</Button>
            <Button type="button" variant="secondary" disabled={!currentTask || isActionPending} onClick={() => void runAction("retry", () => currentTask ? onRetry(currentTask) : undefined)}>{pendingAction === "retry" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}{pendingAction === "retry" ? "Preparing…" : "Retry"}</Button>
            <Button type="button" className="bg-primary text-primary-foreground hover:bg-primary/90" disabled={!currentTask || isActionPending} onClick={() => void runAction("continue", () => currentTask ? onContinue(currentTask, capturedOutput, operatorReply.trim() || browserRecoveryInstruction, capturedOutputLabel) : undefined)}>{pendingAction === "continue" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <CornerDownRight className="mr-1.5 h-3.5 w-3.5" />}{pendingAction === "continue" ? "Continuing…" : "Continue safely"}</Button>
          </div>
        </DialogContent>
      </Dialog>
  );
}

function readCapturedTaskOutput(task: WorkItemRecord, integrityFinalResponse?: string | null) {
  const finalResponse = typeof integrityFinalResponse === "string" ? integrityFinalResponse.trim() : "";
  const metadataFinalResponse =
    typeof task.metadata.finalResponseText === "string" ? task.metadata.finalResponseText.trim() : "";
  const resultPreview = typeof task.metadata.resultPreview === "string" ? task.metadata.resultPreview.trim() : "";
  const subtitle = task.subtitle.trim();

  return finalResponse || metadataFinalResponse || resultPreview || subtitle;
}

function hasExplicitCapturedTaskOutput(task: WorkItemRecord, integrityFinalResponse?: string | null) {
  const values = [
    typeof integrityFinalResponse === "string" ? integrityFinalResponse.trim() : "",
    typeof task.metadata.finalResponseText === "string" ? task.metadata.finalResponseText.trim() : "",
    typeof task.metadata.resultPreview === "string" ? task.metadata.resultPreview.trim() : ""
  ];

  return values.some(
    (value) =>
      Boolean(value) &&
      !/waiting for (the first )?(transcript|output)|working silently/i.test(value) &&
      !/^(agent|chat|session\.message|sessions\.changed)$/i.test(value)
  );
}

function resolveReviewIssueSummary(dispatchIssueDetail: string | null, integrityIssueDetail?: string | null) {
  const detail = dispatchIssueDetail || integrityIssueDetail || null;

  if (!detail) {
    return null;
  }

  if (isGatewayWaitTimeoutDetail(detail)) {
    return "Delivery is unconfirmed. The Gateway wait expired before AgentOS observed a terminal task response. The last captured response below may be incomplete.";
  }

  return detail;
}

function readTaskPromptText(task: WorkItemRecord) {
  return task.mission?.trim() || task.title.trim() || "Untitled task";
}

function readTaskFeedEvents(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TaskFeedEvent[];
  }

  return value.filter(isTaskFeedEvent);
}

function mergeLocalTaskReviewMetadata(
  streamedTask: WorkItemRecord | undefined,
  localTask: WorkItemRecord | null
) {
  if (!streamedTask || !localTask) {
    return streamedTask ?? localTask;
  }

  const reviewMetadata = Object.fromEntries(
    ["reviewStatus", "reviewAction", "reviewedAt", "reviewEvents"]
      .map((key) => [key, localTask.metadata[key]])
      .filter(([, value]) => value !== undefined)
  );

  if (Object.keys(reviewMetadata).length === 0) {
    return streamedTask;
  }

  return {
    ...streamedTask,
    metadata: {
      ...streamedTask.metadata,
      ...reviewMetadata
    }
  };
}

function isTaskFeedEvent(value: unknown): value is TaskFeedEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TaskFeedEvent).id === "string" &&
    typeof (value as TaskFeedEvent).kind === "string" &&
    typeof (value as TaskFeedEvent).timestamp === "string" &&
    typeof (value as TaskFeedEvent).title === "string" &&
    typeof (value as TaskFeedEvent).detail === "string"
  );
}

function findLatestOutputEvidenceEvent(feed: TaskFeedEvent[]) {
  return [...feed]
    .reverse()
    .find((event) => event.kind === "assistant" || event.kind === "tool" || event.kind === "artifact") ?? null;
}
