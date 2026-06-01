"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ClipboardList,
  ChevronDown,
  ChevronUp,
  Copy,
  CornerDownLeft,
  EyeOff,
  FolderOpenDot,
  Lock,
  LockOpen,
  MoreHorizontal,
  Rows3,
  Sparkles
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { TaskNodeData } from "@/components/mission-control/canvas-types";
import { InteractiveContent } from "@/components/mission-control/interactive-content";
import {
  FRESH_NODE_BADGE_CLASSES,
  TASK_NODE_REVIEW_ACTION_CLASSES,
  TASK_NODE_SELECTED_CLASSES,
  type TaskNodeToneInput,
  resolveTaskNodeBadgeVariant,
  resolveTaskNodeTokenTone,
  resolveTaskNodeVisualTone
} from "@/components/mission-control/node-visual-tones";
import {
  resolveEffectiveTaskReviewStatus,
  resolveTaskReviewBadgeLabel,
  resolveTaskReviewFooterLabel
} from "@/components/mission-control/task-review-state";
import {
  hasTaskRuntimeOutputEvidence,
  isWaitingForOutputCopy,
  readTaskResultPreview,
  resolveTaskBadgeLabel
} from "@/components/mission-control/task-node-status";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTaskFeed } from "@/hooks/use-task-feed";
import type { TaskFeedEvent } from "@/lib/agentos/contracts";
import { compactMissionText, formatTokens } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type TaskFlowNode = Node<TaskNodeData, "task">;

export function TaskNode({ data, selected }: NodeProps<TaskFlowNode>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const baseBootstrapStage =
    typeof data.task.metadata.bootstrapStage === "string" ? data.task.metadata.bootstrapStage : null;
  const shouldStreamFeed =
    expanded ||
    selected ||
    Boolean(data.pendingCreation || isPendingTaskBootstrapStage(baseBootstrapStage)) ||
    data.task.status === "running" ||
    data.task.status === "stalled" ||
    data.task.liveRunCount > 0;

  const optimisticFeed = useMemo(
    () => readTaskFeedEvents(data.task.metadata.optimisticEvents),
    [data.task.metadata.optimisticEvents]
  );
  const reviewFeed = useMemo(
    () => readTaskFeedEvents(data.task.metadata.reviewEvents),
    [data.task.metadata.reviewEvents]
  );
  const latestLocalEvent =
    reviewFeed.length > 0 && isTaskFeedEvent(reviewFeed[reviewFeed.length - 1])
      ? reviewFeed[reviewFeed.length - 1]
      : optimisticFeed.length > 0 && isTaskFeedEvent(optimisticFeed[optimisticFeed.length - 1])
      ? optimisticFeed[optimisticFeed.length - 1]
      : null;
  const { feed, detail, loading, error } = useTaskFeed(data.task.id, shouldStreamFeed, {
    dispatchId: data.task.dispatchId,
    optimisticFeed
  });
  const mergedFeed = useMemo(
    () => mergeTaskFeedEvents(feed, reviewFeed),
    [feed, reviewFeed]
  );
  const visibleFeed = useMemo(
    () => mergedFeed.filter((event) => !isRunnerLogTaskEvent(event)),
    [mergedFeed]
  );
  const displayTask = mergeLocalTaskReviewMetadata(detail?.task, data.task);
  const integrity = detail?.integrity ?? null;
  const bootstrapStage =
    typeof displayTask.metadata.bootstrapStage === "string" ? displayTask.metadata.bootstrapStage : null;
  const dispatchSubmittedAt =
    typeof displayTask.metadata.dispatchSubmittedAt === "string"
      ? displayTask.metadata.dispatchSubmittedAt
      : null;
  const isPendingCreation = detail
    ? isPendingTaskBootstrapStage(bootstrapStage)
    : Boolean(data.pendingCreation || isPendingTaskBootstrapStage(bootstrapStage));
  const isJustCreated = Boolean(data.justCreated);
  const isAborted = isTaskAborted(displayTask);
  const isAbortable = isTaskAbortable(displayTask);
  const isLiveTask = displayTask.status === "running" || displayTask.status === "queued" || displayTask.liveRunCount > 0;
  const missingFinalResponse = Boolean(
    integrity?.issues.some((issue) => issue.id === "missing-final-response")
  );
  const partialFinalResponse = Boolean(
    integrity?.issues.some((issue) => issue.id === "partial-final-response")
  );
  const hasRuntimeOutputEvidence = hasTaskRuntimeOutputEvidence(displayTask, visibleFeed);
  const stalledWithCapturedOutput =
    partialFinalResponse || (displayTask.status === "stalled" && hasRuntimeOutputEvidence);
  const latestEvidenceEvent = findLatestOutputEvidenceEvent(visibleFeed);
  const reviewStatus = resolveEffectiveTaskReviewStatus(displayTask, {
    nowMs: data.relativeTimeReferenceMs,
    hasLiveActivity: isLiveTask || isPendingCreation,
    latestEvidenceAt: latestEvidenceEvent?.timestamp ?? null
  });
  const visibleReviewStatus =
    reviewStatus && reviewStatus === "continued" && isLiveTask ? null : reviewStatus;
  const hasReviewResolution = Boolean(reviewStatus);
  const hasReviewableIntegrity =
    integrity
      ? integrity.status === "warning" ||
        integrity.status === "error" ||
        (displayTask.status === "stalled" && hasRuntimeOutputEvidence)
      : stalledWithCapturedOutput;
  const completedNeedsReview = Boolean(
    (displayTask.status === "completed" || stalledWithCapturedOutput) &&
      hasReviewableIntegrity &&
      !hasReviewResolution
  );
  const bootstrapElapsedLabel = isPendingCreation
    ? formatElapsedFromIso(dispatchSubmittedAt, data.relativeTimeReferenceMs)
    : null;
  const toneInput: TaskNodeToneInput = {
    completedNeedsReview,
    isAborted,
    isJustCreated,
    isPendingCreation,
    status: displayTask.status,
    visibleReviewStatus
  };
  const tone = resolveTaskNodeTokenTone(toneInput);
  const badgeVariant = resolveTaskNodeBadgeVariant(toneInput);
  const badgeLabel = visibleReviewStatus
    ? resolveTaskReviewBadgeLabel(visibleReviewStatus)
    : missingFinalResponse
    ? "no result"
    : completedNeedsReview
      ? "needs review"
      : resolveTaskBadgeLabel(bootstrapStage, displayTask.status, isPendingCreation, isAborted, hasRuntimeOutputEvidence);
  const footerLabel = visibleReviewStatus
    ? resolveTaskReviewFooterLabel(visibleReviewStatus)
    : stalledWithCapturedOutput
    ? "partial output needs review"
    : missingFinalResponse
    ? "completed without a final answer"
    : resolveTaskFooterLabel(bootstrapStage, displayTask.liveRunCount, isAborted);
  const latestFeedEvent = visibleFeed[visibleFeed.length - 1] ?? latestLocalEvent ?? null;
  const showsLiveActivity =
    !isAborted &&
    !completedNeedsReview &&
    (isPendingCreation ||
      displayTask.status === "running" ||
      displayTask.liveRunCount > 0 ||
      Boolean(latestFeedEvent && /working|waiting for output/i.test(latestFeedEvent.title)));
  const activityLabel = latestFeedEvent?.title || footerLabel;
  const activitySummary =
    compactMissionText(latestFeedEvent?.detail, 88) ||
    (isPendingCreation
      ? [footerLabel, bootstrapElapsedLabel ? `${bootstrapElapsedLabel} elapsed` : null].filter(Boolean).join(" · ")
      : compactMissionText(displayTask.subtitle, 72) || footerLabel);
  const promptText = readTaskPromptText(displayTask);
  const rawResultPreview = readTaskResultPreview(displayTask);
  const resultPreview = missingFinalResponse
    ? "No final answer was captured from OpenClaw for this task."
    : stalledWithCapturedOutput && isWaitingForOutputCopy(rawResultPreview)
      ? "Partial runtime evidence captured. Review the live feed for the latest tool output."
      : rawResultPreview;
  const sessionCount = readTaskSessionCount(displayTask);
  const turnCount = readTaskTurnCount(displayTask);
  const feedButtonCount = visibleFeed.length > 0 ? String(visibleFeed.length) : undefined;
  const feedPanelId = `task-feed-${data.task.id}`;
  const visualTone = resolveTaskNodeVisualTone(toneInput);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as globalThis.Node)) {
        setMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen]);

  return (
    <motion.div
      initial={
        isPendingCreation
          ? { opacity: 0, scale: 0.92, y: -10 }
          : isJustCreated
            ? { opacity: 0, scale: 0.96, y: 10 }
            : { opacity: 0, x: 10 }
      }
      animate={
        isPendingCreation
          ? { opacity: 1, scale: 1, y: 0 }
          : isJustCreated
            ? { opacity: 1, scale: [1, 1.015, 1], y: 0 }
            : { opacity: 1, x: 0 }
      }
      transition={
        isJustCreated
          ? {
              duration: 0.7,
              times: [0, 0.45, 1]
            }
          : undefined
      }
      className={cn(
        "group relative w-[282px] overflow-visible rounded-[18px] border bg-[linear-gradient(180deg,rgba(13,18,30,0.96),rgba(7,10,18,0.96))] p-3 shadow-[0_18px_42px_rgba(0,0,0,0.3)] backdrop-blur-xl transition-[border-color,box-shadow,opacity] duration-200",
        visualTone.outer,
        data.emphasis ? "opacity-100" : "opacity-72",
        selected && TASK_NODE_SELECTED_CLASSES
      )}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[18px]">
        <div className={cn("absolute inset-y-3 left-0 w-1 rounded-r-full", visualTone.rail)} />
        <div className={cn("absolute inset-x-0 top-0 h-px", visualTone.topLine)} />
        <div className={cn("absolute -right-10 -top-10 h-28 w-28 rounded-full blur-3xl", visualTone.glow)} />
        <div className="absolute inset-x-3 bottom-0 h-px bg-white/[0.04]" />
      </div>

      <div className="relative z-10">
      {isPendingCreation ? (
        <motion.div
          className="pointer-events-none absolute inset-[-14px] rounded-[22px] border border-cyan-200/16"
          animate={{ opacity: [0.18, 0.42, 0.18], scale: [0.985, 1.02, 0.985] }}
          transition={{ duration: 1.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
      ) : null}

      <Handle
        type="target"
        id="target-left"
        position={Position.Left}
        className={cn("!h-2.5 !w-2.5 !border-0", visualTone.handle)}
      />

      <div className="relative z-20 overflow-visible">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex h-1.5 w-1.5 shrink-0 rounded-full",
                  visualTone.dot,
                  showsLiveActivity && "motion-safe:animate-pulse"
                )}
              />
              <span className="text-[9px] uppercase tracking-[0.22em] text-slate-400">Task</span>
              {data.locked ? <Lock className="h-3 w-3 text-slate-500" /> : null}
            </div>
            <p className="mt-1 max-w-[156px] truncate text-[10px] uppercase tracking-[0.14em] text-slate-500">
              {displayTask.primaryAgentName || "OpenClaw"}
            </p>
          </div>

          <div className="nodrag nopan relative flex items-center gap-1.5" ref={menuRef}>
            <Badge variant={badgeVariant} className="max-w-[124px] truncate">
              {badgeLabel}
            </Badge>
            <button
              type="button"
              aria-label="Task actions"
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((current) => !current);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              className="nodrag nopan inline-flex rounded-full border border-white/[0.08] bg-white/[0.04] p-1.5 text-slate-300 transition-colors hover:border-white/[0.14] hover:bg-white/[0.08] hover:text-white"
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>

            {menuOpen ? (
              <div
                className="nodrag nopan absolute right-0 top-[calc(100%+8px)] z-[70] min-w-[148px] rounded-[14px] border border-white/[0.1] bg-slate-950/96 p-1.5 shadow-[0_20px_44px_rgba(0,0,0,0.42)] backdrop-blur-xl"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                {data.onReviewTask && (completedNeedsReview || hasReviewResolution) ? (
                  <TaskMenuButton
                    icon={hasReviewResolution ? CheckCircle2 : AlertTriangle}
                    label={hasReviewResolution ? "Review record" : "Review result"}
                    onClick={() => {
                      data.onReviewTask?.(displayTask);
                      setMenuOpen(false);
                    }}
                  />
                ) : null}
                <TaskMenuButton
                  icon={CornerDownLeft}
                  label="Use prompt"
                  onClick={() => {
                    data.onReply?.(data.task);
                    setMenuOpen(false);
                  }}
                />
                <TaskMenuButton
                  icon={Copy}
                  label="Copy mission"
                  onClick={() => {
                    data.onCopyPrompt?.(data.task);
                    setMenuOpen(false);
                  }}
                />
                <TaskMenuButton
                  icon={EyeOff}
                  label="Hide"
                  onClick={() => {
                    data.onHide?.(data.task);
                    setMenuOpen(false);
                  }}
                />
                {data.onAbortTask && (isAbortable || isAborted) ? (
                  <TaskMenuButton
                    icon={Ban}
                    label={isAborted ? "Aborted" : "Abort task"}
                    destructive
                    disabled={!isAbortable}
                    onClick={() => {
                      if (!isAbortable) {
                        return;
                      }

                      data.onAbortTask?.(data.task);
                      setMenuOpen(false);
                    }}
                  />
                ) : null}
                <TaskMenuButton
                  icon={data.locked ? LockOpen : Lock}
                  label={data.locked ? "Unlock" : "Lock"}
                  onClick={() => {
                    data.onToggleLock?.(data.task);
                    setMenuOpen(false);
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex items-start gap-2.5">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border shadow-[0_0_22px_rgba(255,255,255,0.05)]",
              visualTone.icon
            )}
          >
            <ClipboardList className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 font-display text-[0.98rem] leading-5 text-white">
              {compactMissionText(promptText, 112) || promptText}
            </p>
            <p className="mt-1 truncate text-[10.5px] leading-4 text-slate-400">
              {activityLabel}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {displayTask.warningCount > 0 && !hasReviewResolution ? (
          <Badge variant="warning">
            {displayTask.warningCount} review{displayTask.warningCount === 1 ? "" : "s"}
          </Badge>
        ) : null}
        {isJustCreated ? (
          <Badge variant="default" className={FRESH_NODE_BADGE_CLASSES}>
            <Sparkles className="h-3 w-3" />
            new
          </Badge>
        ) : null}
        <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-2 py-1 text-[10px] leading-none text-slate-300">
          {sessionCount} session{sessionCount === 1 ? "" : "s"}
        </span>
        <span className="rounded-full border border-white/[0.08] bg-white/[0.035] px-2 py-1 text-[10px] leading-none text-slate-300">
          {turnCount} turn{turnCount === 1 ? "" : "s"}
        </span>
        <span className={cn("px-1 text-[9px] uppercase tracking-[0.16em]", tone)}>
          {formatTokens(displayTask.tokenUsage?.total)} tokens
        </span>
      </div>

      <div className={cn("mt-2.5 border-l pl-3", visualTone.resultBorder)}>
        <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">Latest result</p>
        <p className="mt-1 line-clamp-2 text-[12.5px] leading-5 text-slate-100/95">
          {compactMissionText(resultPreview, 128) || resultPreview}
        </p>
      </div>

      {completedNeedsReview && data.onReviewTask ? (
        <button
          type="button"
          className={TASK_NODE_REVIEW_ACTION_CLASSES.button}
          onClick={(event) => {
            event.stopPropagation();
            data.onReviewTask?.(displayTask);
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className={TASK_NODE_REVIEW_ACTION_CLASSES.icon}>
              <AlertTriangle className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-medium uppercase tracking-[0.18em]">
                Review result
              </span>
              <span className={TASK_NODE_REVIEW_ACTION_CLASSES.detail}>
                Accept, continue, retry, or dismiss.
              </span>
            </span>
          </span>
          <ChevronDown className={TASK_NODE_REVIEW_ACTION_CLASSES.chevron} />
        </button>
      ) : null}

      <div className="mt-2.5 grid grid-cols-3 gap-1.5">
        <TaskQuickAction
          icon={Rows3}
          label="Feed"
          value={feedButtonCount}
          active={expanded}
          onClick={() => {
            if (data.onInspect) {
              data.onInspect(data.task, "output");
              return;
            }

            setExpanded((current) => !current);
          }}
        />
        <TaskQuickAction
          icon={FolderOpenDot}
          label="Turns"
          value={String(turnCount)}
          onClick={() => data.onInspect?.(data.task, "overview")}
        />
        <TaskQuickAction
          icon={Sparkles}
          label="Files"
          value={String(displayTask.artifactCount)}
          onClick={() => data.onInspect?.(data.task, "files")}
        />
      </div>

      <div className={cn("mt-2.5 rounded-[14px] border border-white/[0.07] bg-white/[0.025] px-2.5 py-1.5", expanded && "pb-2.5")}>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={feedPanelId}
          className="nodrag nopan group flex w-full items-start justify-between gap-3 rounded-[10px] border border-transparent px-1 py-1 text-left transition-colors hover:bg-white/[0.035]"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((current) => !current);
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-slate-500 transition-colors group-hover:text-slate-400">
              {showsLiveActivity ? (
                <span className={cn("inline-flex h-1.5 w-1.5 rounded-full shadow-[0_0_10px_rgba(34,211,238,0.7)]", visualTone.dot, "motion-safe:animate-pulse")} />
              ) : null}
              <span>Live feed</span>
            </p>
            <p className="mt-1 truncate text-[10.5px] text-slate-300">{activityLabel}</p>
            {expanded ? <p className="mt-1 truncate text-[10px] text-slate-500">{activitySummary}</p> : null}
          </div>
          <div className="mt-0.5 shrink-0 rounded-full border border-white/[0.08] bg-white/[0.035] p-1 text-slate-400 transition-colors group-hover:border-white/[0.12] group-hover:text-slate-200">
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </div>
        </button>

        {expanded && (
          <motion.div
            id={feedPanelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="nodrag nopan overflow-hidden nowheel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pt-2.5">
              <ScrollArea className="h-[112px] w-full pr-3">
                {loading && visibleFeed.length === 0 ? (
                  <div className="py-4 text-center text-[10px] text-slate-500">
                    Connecting to feed...
                  </div>
                ) : error && visibleFeed.length === 0 ? (
                  <div className="rounded-[12px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[10px] leading-5 text-amber-100">
                    {error}
                  </div>
                ) : visibleFeed.length === 0 ? (
                  <div className="py-4 text-center text-[10px] text-slate-500">No events yet.</div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {visibleFeed.map((event) => (
                      <div key={event.id} className="group/item relative pl-3">
                        <div
                          className={cn(
                            "absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full",
                            resolveFeedEventColor(event.kind, event.isError)
                          )}
                        />
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[10px] font-medium text-slate-300">
                            {event.title}
                          </span>
                          <span className="shrink-0 text-[9px] text-slate-600">
                            {formatTimeOnly(event.timestamp)}
                          </span>
                        </div>
                        <div className="mt-0.5">
                          <InteractiveContent
                            text={event.detail}
                            className="text-[10px] leading-relaxed text-slate-400 group-hover/item:text-slate-300"
                            url={"url" in event ? event.url : null}
                            filePath={"filePath" in event ? event.filePath : null}
                            displayPath={"displayPath" in event ? event.displayPath : null}
                            basePath={data.workspacePath}
                            compact
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </motion.div>
        )}
      </div>
      </div>
    </motion.div>
  );
}

function isPendingTaskBootstrapStage(bootstrapStage: string | null) {
  return (
    bootstrapStage === "submitting" ||
    bootstrapStage === "accepted" ||
    bootstrapStage === "waiting-for-heartbeat" ||
    bootstrapStage === "waiting-for-runtime" ||
    bootstrapStage === "runtime-observed"
  );
}

function resolveTaskFooterLabel(bootstrapStage: string | null, liveRunCount: number, isAborted: boolean) {
  if (isAborted) {
    return "dispatch aborted";
  }

  switch (bootstrapStage) {
    case "submitting":
      return "contacting dispatcher";
    case "accepted":
      return "dispatch accepted";
    case "waiting-for-heartbeat":
      return "waiting for first heartbeat";
    case "waiting-for-runtime":
      return "waiting for first OpenClaw runtime";
    case "runtime-observed":
      return "runtime observed";
    case "stalled":
      return "working silently";
    default:
      return liveRunCount > 0 ? `${liveRunCount} live run${liveRunCount === 1 ? "" : "s"}` : "no live runs right now";
  }
}

function readTaskPromptText(task: TaskFlowNode["data"]["task"]) {
  return task.mission?.trim() || task.title.trim() || "Untitled task";
}

function readTaskSessionCount(task: TaskFlowNode["data"]["task"]) {
  const metadataCount = task.metadata.sessionCount;
  return typeof metadataCount === "number" && Number.isFinite(metadataCount)
    ? metadataCount
    : task.sessionIds.length;
}

function readTaskTurnCount(task: TaskFlowNode["data"]["task"]) {
  const metadataCount = task.metadata.turnCount;
  return typeof metadataCount === "number" && Number.isFinite(metadataCount)
    ? metadataCount
    : task.runtimeCount;
}

function formatElapsedFromIso(value: string | null, referenceTimeMs: number) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return null;
  }

  const elapsedMs = Math.max(referenceTimeMs - timestamp, 0);
  const seconds = Math.floor(elapsedMs / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
}

function TaskQuickAction({
  icon: Icon,
  label,
  value,
  active = false,
  onClick
}: {
  icon: typeof Rows3;
  label: string;
  value?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "nodrag nopan flex min-h-[34px] w-full items-center justify-between rounded-[11px] border border-white/[0.07] bg-white/[0.03] px-2 py-1.5 text-left transition-colors hover:border-cyan-200/[0.18] hover:bg-white/[0.055]",
        active && "border-cyan-200/25 bg-cyan-300/[0.07]"
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-slate-300">
        <Icon className={cn("h-3 w-3 shrink-0", active ? "text-cyan-200" : "text-slate-500")} />
        <span className="whitespace-nowrap">{label}</span>
      </div>
      {value ? <span className="ml-1.5 shrink-0 font-mono text-[10px] text-slate-200">{value}</span> : null}
    </button>
  );
}

function resolveFeedEventColor(kind: string, isError?: boolean) {
  if (isError) return "bg-red-400";
  switch (kind) {
    case "status":
      return "bg-slate-400";
    case "assistant":
      return "bg-cyan-400";
    case "tool":
      return "bg-indigo-400";
    case "artifact":
      return "bg-emerald-400";
    case "warning":
      return "bg-amber-400";
    case "user":
      return "bg-pink-400";
    default:
      return "bg-slate-500";
  }
}

function readTaskFeedEvents(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TaskFeedEvent[];
  }

  return value
    .filter(isTaskFeedEvent)
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function mergeTaskFeedEvents(...eventGroups: TaskFeedEvent[][]) {
  const byId = new Map<string, TaskFeedEvent>();

  for (const event of eventGroups.flat()) {
    byId.set(event.id, event);
  }

  return [...byId.values()].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function mergeLocalTaskReviewMetadata(
  streamedTask: TaskFlowNode["data"]["task"] | undefined,
  localTask: TaskFlowNode["data"]["task"]
) {
  if (!streamedTask) {
    return localTask;
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

function formatTimeOnly(iso: string) {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
  } catch {
    return "";
  }
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

function isRunnerLogTaskEvent(event: TaskFeedEvent) {
  return event.id.startsWith("runner-log:");
}

function findLatestOutputEvidenceEvent(feed: TaskFeedEvent[]) {
  return [...feed]
    .reverse()
    .find((event) => event.kind === "assistant" || event.kind === "tool" || event.kind === "artifact") ?? null;
}

function TaskMenuButton({
  icon: Icon,
  label,
  destructive = false,
  disabled = false,
  onClick
}: {
  icon: typeof MoreHorizontal;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "nodrag nopan flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[11px] transition-colors",
        disabled
          ? "cursor-not-allowed text-slate-500"
          : destructive
            ? "text-rose-100 hover:bg-rose-400/10 hover:text-rose-50"
            : "text-slate-200 hover:bg-white/[0.06] hover:text-white"
      )}
      onClick={onClick}
    >
      <Icon className={cn("h-3.5 w-3.5", destructive ? "text-rose-300" : "text-cyan-300")} />
      <span>{label}</span>
    </button>
  );
}

function resolveTaskDispatchStatus(task: TaskFlowNode["data"]["task"]) {
  return typeof task.metadata.dispatchStatus === "string" ? task.metadata.dispatchStatus : null;
}

function isTaskAborted(task: TaskFlowNode["data"]["task"]) {
  const dispatchStatus = resolveTaskDispatchStatus(task);
  const runtimeStatus = task.status as string;
  return dispatchStatus === "cancelled" || dispatchStatus === "aborted" || runtimeStatus === "cancelled" || runtimeStatus === "aborted";
}

function isTaskAbortable(task: TaskFlowNode["data"]["task"]) {
  if (isTaskAborted(task)) {
    return false;
  }

  const runtimeStatus = task.status as string;
  return runtimeStatus === "running" || runtimeStatus === "queued";
}
