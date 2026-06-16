"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  CornerDownRight,
  Eye,
  FileText,
  Files,
  ListChecks,
  Loader2,
  MessageSquare,
  RefreshCw,
  XCircle
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

import { InteractiveContent } from "@/components/mission-control/interactive-content";
import {
  readTaskReviewAction,
  readTaskReviewReviewedAt,
  resolveEffectiveTaskReviewStatus,
  resolveTaskReviewBadgeLabel,
  resolveTaskReviewSummary
} from "@/components/mission-control/task-review-state";
import { resolveTaskDispatchIssueDetail } from "@/components/mission-control/task-node-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useTaskFeed } from "@/hooks/use-task-feed";
import type { MissionControlSnapshot, TaskFeedEvent, WorkItemRecord } from "@/lib/agentos/contracts";
import type { RuntimeCreatedFile } from "@/lib/openclaw/types";
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
  onContinue: (task: WorkItemRecord, capturedOutput: string, operatorMessage?: string) => Promise<void> | void;
  onRetry: (task: WorkItemRecord) => Promise<void> | void;
  onDismiss: (task: WorkItemRecord) => Promise<void> | void;
  onOpenEvidence: (task: WorkItemRecord, target: "overview" | "output" | "files") => void;
};
type TaskReviewPendingAction = "accept" | "continue" | "retry" | "dismiss" | null;

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
  onOpenEvidence
}: TaskReviewDialogProps) {
  const [pendingAction, setPendingAction] = useState<TaskReviewPendingAction>(null);
  const [operatorReply, setOperatorReply] = useState("");
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
  const reviewStatus = currentTask
    ? resolveEffectiveTaskReviewStatus(currentTask, {
        hasLiveActivity: currentTask.status === "running" || currentTask.status === "queued" || currentTask.liveRunCount > 0,
        latestEvidenceAt: latestEvidenceEvent?.timestamp ?? null
      })
    : null;
  const reviewedAt = currentTask ? readTaskReviewReviewedAt(currentTask) : null;
  const reviewAction = currentTask ? readTaskReviewAction(currentTask) : null;
  const capturedOutput = currentTask ? readCapturedTaskOutput(currentTask, integrity?.finalResponseText) : "";
  const createdFiles = detail?.createdFiles ?? [];
  const originalPrompt = currentTask ? readTaskPromptText(currentTask) : "";
  const issue = integrity?.issues.find((entry) => entry.id === "partial-final-response") ?? integrity?.issues[0] ?? null;
  const dispatchIssueDetail = currentTask ? resolveTaskDispatchIssueDetail(currentTask, integrity) : null;
  const isVerified = integrity?.status === "verified" && !issue;
  const statusLabel = reviewStatus ? resolveTaskReviewBadgeLabel(reviewStatus) : isVerified ? "verified" : "needs review";
  const issueSummary = reviewStatus
    ? resolveTaskReviewSummary(reviewStatus)
    : resolveReviewIssueSummary(dispatchIssueDetail, issue?.detail) ||
      (isVerified
        ? "AgentOS recovered a matching completed response and no review issues remain."
        : "The captured task evidence needs an operator decision before AgentOS treats the result as handled.");
  const rawIssueDetail = dispatchIssueDetail || issue?.detail || null;
  const shouldShowRawIssueDetail = rawIssueDetail && rawIssueDetail !== issueSummary;
  const reviewGuidance = currentTask
    ? resolveReviewGuidance({
        task: currentTask,
        createdFiles,
        capturedOutput,
        rawIssueDetail
      })
    : [];
  const reportedFileCount = createdFiles.length || currentTask?.artifactCount || 0;
  const isLight = surfaceTheme === "light";
  const isActionPending = pendingAction !== null;

  useEffect(() => {
    setOperatorReply("");
  }, [open, task?.id]);

  const runAction = async (action: Exclude<TaskReviewPendingAction, null>, callback: () => Promise<void> | void) => {
    if (pendingAction) {
      return;
    }

    setPendingAction(action);

    try {
      await callback();
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex h-[min(780px,calc(100dvh-32px))] w-[calc(100vw-24px)] max-w-[900px] flex-col gap-0 overflow-hidden rounded-[26px] border-white/10 p-0",
          isLight
            ? "bg-white/95 text-slate-950 shadow-[0_24px_80px_rgba(15,23,42,0.22)]"
            : "bg-[linear-gradient(180deg,rgba(8,13,24,0.98),rgba(4,7,14,0.98))] text-white"
        )}
        closeClassName={isLight ? "text-slate-500 hover:bg-slate-950/5 hover:text-slate-900" : undefined}
      >
        <div
          className={cn(
            "border-b px-5 py-4",
            isLight ? "border-slate-200/80 bg-slate-50/85" : "border-white/[0.08] bg-white/[0.03]"
          )}
        >
          <div className="flex items-start gap-3 pr-9">
            <div
              className={cn(
                "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border",
                reviewStatus === "accepted" || isVerified
                  ? "border-emerald-300/30 bg-emerald-400/12 text-emerald-200"
                  : "border-amber-300/30 bg-amber-400/12 text-amber-100"
              )}
            >
              {reviewStatus === "accepted" || isVerified ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <AlertTriangle className="h-4 w-4" />
              )}
            </div>
            <DialogHeader className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={reviewStatus === "accepted" || isVerified ? "success" : reviewStatus ? "muted" : "warning"}>
                  {statusLabel}
                </Badge>
                {currentTask?.dispatchId ? (
                  <Badge variant="muted">dispatch {shortId(currentTask.dispatchId, 8)}</Badge>
                ) : null}
              </div>
              <DialogTitle className={cn("truncate text-lg", isLight && "text-slate-950")}>
                {currentTask?.title.trim() || "Task review"}
              </DialogTitle>
              <DialogDescription className={isLight ? "text-slate-600" : undefined}>
                {workspace?.name || "Workspace"}{agent ? ` · ${formatAgentDisplayName(agent)}` : ""}
              </DialogDescription>
            </DialogHeader>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_290px]">
            <div className="space-y-4">
              <ReviewSection
                icon={FileText}
                title="Captured output"
                tone={reviewStatus === "accepted" || isVerified ? "success" : "warning"}
                isLight={isLight}
              >
                {capturedOutput ? (
                  <InteractiveContent
                    text={capturedOutput}
                    className={cn("text-[12.5px] leading-6", isLight ? "text-slate-800" : "text-slate-100")}
                  />
                ) : (
                  <p className={cn("text-[12.5px] leading-6", isLight ? "text-slate-500" : "text-slate-400")}>
                    No captured assistant output is available yet.
                  </p>
                )}
              </ReviewSection>

              <ReviewSection icon={AlertTriangle} title="Review reason" tone="warning" isLight={isLight}>
                <p className={cn("text-[12.5px] leading-6", isLight ? "text-slate-700" : "text-slate-200")}>
                  {issueSummary}
                </p>
                {shouldShowRawIssueDetail ? (
                  <p className={cn("mt-2 text-[11px] leading-5", isLight ? "text-slate-500" : "text-slate-400")}>
                    OpenClaw detail: {rawIssueDetail}
                  </p>
                ) : null}
                {reviewAction ? (
                  <p className={cn("mt-2 text-[11px]", isLight ? "text-slate-500" : "text-slate-500")}>
                    Last operator action: {reviewAction}
                  </p>
                ) : null}
              </ReviewSection>

              <ReviewSection icon={ListChecks} title="What to review" tone="warning" isLight={isLight}>
                <ul className={cn("space-y-2 text-[12.5px] leading-5", isLight ? "text-slate-700" : "text-slate-200")}>
                  {reviewGuidance.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className={cn("mt-2 h-1.5 w-1.5 shrink-0 rounded-full", isLight ? "bg-amber-500" : "bg-amber-200")} />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </ReviewSection>

              <ReviewSection icon={Files} title="Files to inspect" tone={reportedFileCount > 0 ? "success" : "neutral"} isLight={isLight}>
                {createdFiles.length > 0 ? (
                  <div className="space-y-2">
                    {createdFiles.slice(0, 6).map((file) => (
                      <div
                        key={`${file.path}:${file.displayPath}`}
                        className={cn(
                          "min-w-0 border-b pb-2 last:border-b-0 last:pb-0",
                          isLight ? "border-slate-100" : "border-white/[0.08]"
                        )}
                      >
                        <p className={cn("truncate font-mono text-[12px]", isLight ? "text-slate-800" : "text-slate-100")}>
                          {file.displayPath || file.path}
                        </p>
                        {file.path && file.path !== file.displayPath ? (
                          <p className={cn("mt-0.5 truncate text-[11px]", isLight ? "text-slate-500" : "text-slate-400")}>
                            {file.path}
                          </p>
                        ) : null}
                      </div>
                    ))}
                    {createdFiles.length > 6 ? (
                      <p className={cn("text-[11px]", isLight ? "text-slate-500" : "text-slate-400")}>
                        {createdFiles.length - 6} more file{createdFiles.length - 6 === 1 ? "" : "s"} in the task evidence.
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className={cn("text-[12.5px] leading-5", isLight ? "text-slate-600" : "text-slate-300")}>
                    {reportedFileCount > 0
                      ? `This task reports ${reportedFileCount} generated file${reportedFileCount === 1 ? "" : "s"}, but the detailed file list has not loaded yet.`
                      : "OpenClaw did not report generated files for this task. Use the files evidence view if the agent appears to have written workspace files."}
                  </p>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  className={cn(
                    "mt-3 w-full justify-start gap-2 sm:w-auto",
                    isLight && "border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100"
                  )}
                  disabled={!currentTask || isActionPending}
                  onClick={() => {
                    if (currentTask) {
                      onOpenEvidence(currentTask, "files");
                    }
                  }}
                >
                  <Eye className="h-4 w-4" />
                  Open files
                </Button>
              </ReviewSection>

              <ReviewSection icon={MessageSquare} title="Operator reply" isLight={isLight}>
                <Textarea
                  value={operatorReply}
                  onChange={(event) => setOperatorReply(event.target.value)}
                  placeholder="Answer the agent or add continuation instructions before continuing this task."
                  className={cn(
                    "min-h-[112px] resize-none text-[12.5px] leading-5",
                    isLight
                      ? "border-slate-200 bg-slate-50 text-slate-900 placeholder:text-slate-400 focus-visible:ring-slate-300"
                      : "border-white/[0.08] bg-black/20 text-slate-100 placeholder:text-slate-500 focus-visible:ring-cyan-300/25"
                  )}
                  disabled={!currentTask || isActionPending}
                />
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    variant="secondary"
                    className={cn(
                      "w-full gap-2 sm:w-auto",
                      isLight && "border-slate-200 bg-white text-slate-800 hover:bg-slate-100"
                    )}
                    disabled={!currentTask || isActionPending}
                    onClick={() => void runAction("continue", () => {
                      if (currentTask) {
                        return onContinue(currentTask, capturedOutput, operatorReply);
                      }
                    })}
                  >
                    {pendingAction === "continue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CornerDownRight className="h-4 w-4" />}
                    {pendingAction === "continue"
                      ? "Continuing..."
                      : operatorReply.trim()
                        ? "Send reply and continue"
                        : "Continue task"}
                  </Button>
                </div>
              </ReviewSection>

              <ReviewSection icon={ClipboardList} title="Original prompt" isLight={isLight}>
                <InteractiveContent
                  text={originalPrompt || "No original prompt was captured."}
                  className={cn("text-[12.5px] leading-6", isLight ? "text-slate-700" : "text-slate-200")}
                />
              </ReviewSection>
            </div>

            <aside className="space-y-4">
              <div
                className={cn(
                  "rounded-[18px] border p-3",
                  isLight ? "border-slate-200 bg-white" : "border-white/[0.08] bg-white/[0.035]"
                )}
              >
                <p className={cn("text-[10px] uppercase tracking-[0.2em]", isLight ? "text-slate-500" : "text-slate-500")}>
                  Evidence
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <ReviewMetric label="Runs" value={String(currentTask?.runtimeCount ?? 0)} isLight={isLight} />
                  <ReviewMetric label="Turns" value={String(readTaskTurnCount(currentTask))} isLight={isLight} />
                  <ReviewMetric label="Files" value={String(currentTask?.artifactCount ?? 0)} isLight={isLight} />
                  <ReviewMetric label="Issues" value={String(integrity?.issues.length ?? currentTask?.warningCount ?? 0)} isLight={isLight} />
                </div>
                {loading ? (
                  <div className={cn("mt-3 flex items-center gap-2 text-[11px]", isLight ? "text-slate-500" : "text-slate-400")}>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading live evidence...
                  </div>
                ) : null}
                {error ? (
                  <p className="mt-3 rounded-[12px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[11px] leading-5 text-amber-100">
                    {error}
                  </p>
                ) : null}
              </div>

              <div
                className={cn(
                  "rounded-[18px] border p-3",
                  isLight ? "border-slate-200 bg-white" : "border-white/[0.08] bg-white/[0.035]"
                )}
              >
                <p className={cn("text-[10px] uppercase tracking-[0.2em]", isLight ? "text-slate-500" : "text-slate-500")}>
                  Task state
                </p>
                <div className="mt-3 space-y-2 text-[12px]">
                  <ReviewLine label="Status" value={currentTask?.status ?? "unknown"} isLight={isLight} />
                  <ReviewLine
                    label="Updated"
                    value={currentTask?.updatedAt ? formatRelativeTime(currentTask.updatedAt) : "unknown"}
                    isLight={isLight}
                  />
                  <ReviewLine
                    label="Reviewed"
                    value={reviewedAt ? formatRelativeTime(Date.parse(reviewedAt)) : "not yet"}
                    isLight={isLight}
                  />
                </div>
              </div>

              <Button
                type="button"
                variant="secondary"
                className={cn(
                  "w-full justify-start gap-2",
                  isLight && "border-slate-200 bg-slate-50 text-slate-800 hover:bg-slate-100"
                )}
                disabled={!currentTask || isActionPending}
                onClick={() => {
                  if (currentTask) {
                    onOpenEvidence(currentTask, "output");
                  }
                }}
              >
                <Eye className="h-4 w-4" />
                Open evidence
              </Button>
            </aside>
          </div>
        </ScrollArea>

        <div
          className={cn(
            "flex flex-col gap-2 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-end",
            isLight ? "border-slate-200 bg-slate-50/85" : "border-white/[0.08] bg-white/[0.03]"
          )}
        >
          <Button
            type="button"
            variant="ghost"
            className={cn("gap-2", isLight && "text-slate-700 hover:bg-slate-950/5 hover:text-slate-950")}
            disabled={!currentTask || isActionPending}
            onClick={() => void runAction("dismiss", () => {
              if (currentTask) {
                return onDismiss(currentTask);
              }
            })}
          >
            {pendingAction === "dismiss" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
            {pendingAction === "dismiss" ? "Dismissing..." : "Dismiss"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={cn("gap-2", isLight && "border-slate-200 bg-white text-slate-800 hover:bg-slate-100")}
            disabled={!currentTask || isActionPending}
            onClick={() => void runAction("retry", () => {
              if (currentTask) {
                return onRetry(currentTask);
              }
            })}
          >
            {pendingAction === "retry" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {pendingAction === "retry" ? "Preparing..." : "Retry"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className={cn("gap-2", isLight && "border-slate-200 bg-white text-slate-800 hover:bg-slate-100")}
            disabled={!currentTask || isActionPending}
            onClick={() => void runAction("continue", () => {
              if (currentTask) {
                return onContinue(currentTask, capturedOutput, operatorReply);
              }
            })}
          >
            {pendingAction === "continue" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CornerDownRight className="h-4 w-4" />}
            {pendingAction === "continue" ? "Continuing..." : "Continue task"}
          </Button>
          <Button
            type="button"
            className="gap-2 bg-emerald-400 text-slate-950 shadow-emerald-400/20 hover:bg-emerald-300"
            disabled={!currentTask || isActionPending}
            onClick={() => void runAction("accept", () => {
              if (currentTask) {
                return onAccept(currentTask);
              }
            })}
          >
            {pendingAction === "accept" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {pendingAction === "accept" ? "Accepting..." : "Accept result"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReviewSection({
  icon: Icon,
  title,
  tone = "neutral",
  isLight,
  children
}: {
  icon: typeof AlertTriangle;
  title: string;
  tone?: "neutral" | "warning" | "success";
  isLight: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-[18px] border p-3.5",
        isLight ? "border-slate-200 bg-white" : "border-white/[0.08] bg-white/[0.035]"
      )}
    >
      <div className="mb-3 flex items-center gap-2">
        <div
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-[10px] border",
            tone === "success"
              ? "border-emerald-300/30 bg-emerald-400/12 text-emerald-200"
              : tone === "warning"
                ? "border-amber-300/30 bg-amber-400/12 text-amber-100"
                : isLight
                  ? "border-slate-200 bg-slate-50 text-slate-600"
                  : "border-white/[0.08] bg-white/[0.05] text-slate-300"
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        <p className={cn("text-[10px] uppercase tracking-[0.2em]", isLight ? "text-slate-500" : "text-slate-500")}>
          {title}
        </p>
      </div>
      {children}
    </section>
  );
}

function ReviewMetric({ label, value, isLight }: { label: string; value: string; isLight: boolean }) {
  return (
    <div className={cn("rounded-[12px] border px-3 py-2", isLight ? "border-slate-200 bg-slate-50" : "border-white/[0.08] bg-white/[0.04]")}>
      <p className={cn("text-[9px] uppercase tracking-[0.16em]", isLight ? "text-slate-500" : "text-slate-500")}>{label}</p>
      <p className={cn("mt-1 font-mono text-[13px]", isLight ? "text-slate-900" : "text-white")}>{value}</p>
    </div>
  );
}

function ReviewLine({ label, value, isLight }: { label: string; value: string; isLight: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={isLight ? "text-slate-500" : "text-slate-500"}>{label}</span>
      <span className={cn("min-w-0 truncate text-right", isLight ? "text-slate-900" : "text-slate-100")}>{value}</span>
    </div>
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

function resolveReviewIssueSummary(dispatchIssueDetail: string | null, integrityIssueDetail?: string | null) {
  const detail = dispatchIssueDetail || integrityIssueDetail || null;

  if (!detail) {
    return null;
  }

  if (isGatewayWaitTimeoutDetail(detail)) {
    return "OpenClaw accepted the task, but AgentOS did not capture a final agent answer before the Gateway wait window expired. Review the captured output and transcript; if the agent asked a question or the result is incomplete, send an operator reply or continuation.";
  }

  return detail;
}

function resolveReviewGuidance(input: {
  task: WorkItemRecord;
  createdFiles: RuntimeCreatedFile[];
  capturedOutput: string;
  rawIssueDetail: string | null;
}) {
  const fileCount = input.createdFiles.length || input.task.artifactCount;
  const hasGatewayTimeout = input.rawIssueDetail ? isGatewayWaitTimeoutDetail(input.rawIssueDetail) : false;
  const guidance: string[] = [];

  if (hasGatewayTimeout) {
    guidance.push(
      "The review is not asking you to approve the timeout itself. It is asking whether the captured work is complete enough to accept."
    );
  } else {
    guidance.push("Review the captured work before marking this task handled.");
  }

  if (fileCount > 0) {
    guidance.push(
      `Inspect the ${fileCount} generated file${fileCount === 1 ? "" : "s"} and decide whether they satisfy the original prompt.`
    );
  } else {
    guidance.push("If the agent appears to have written files, open the files evidence view and verify the workspace output directly.");
  }

  if (input.capturedOutput.trim()) {
    guidance.push("Check the captured output for missing sections, unanswered questions, or instructions that still need an operator reply.");
  }

  guidance.push("Accept the result if the work is good, send a reply and continue if context is missing, or retry if the run produced the wrong work.");

  return guidance;
}

function isGatewayWaitTimeoutDetail(detail: string) {
  return /OpenClaw Gateway wait timed out/i.test(detail);
}

function readTaskPromptText(task: WorkItemRecord) {
  return task.mission?.trim() || task.title.trim() || "Untitled task";
}

function readTaskTurnCount(task: WorkItemRecord | null) {
  if (!task) {
    return 0;
  }

  const metadataCount = task.metadata.turnCount;
  return typeof metadataCount === "number" && Number.isFinite(metadataCount) ? metadataCount : task.runtimeCount;
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
