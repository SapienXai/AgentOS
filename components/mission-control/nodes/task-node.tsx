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
  RefreshCw,
  Rows3,
  Sparkles,
  Users
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { TaskCardInspectorContext, TaskNodeData } from "@/components/mission-control/canvas-types";
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
import {
  ExpandableTaskResult,
  TaskFollowUpComposer,
  TaskMetricRow,
  formatFollowUpDetail,
  type SubmittedTaskFollowUp,
  type TaskMetricItem
} from "@/components/mission-control/task-follow-up";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTaskFeed } from "@/hooks/use-task-feed";
import type { RuntimeOutputRecord, RuntimeRecord, TaskFeedEvent } from "@/lib/agentos/contracts";
import {
  mergeTaskFollowUps,
  readTaskFollowUpsFromMetadata
} from "@/lib/openclaw/domains/task-follow-up-records";
import { compactMissionText, formatTokens } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type TaskFlowNode = Node<TaskNodeData, "task">;
const FOLLOW_UP_STALE_MS = 90_000;

export function TaskNode({ data, selected }: NodeProps<TaskFlowNode>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [localFollowUps, setLocalFollowUps] = useState<SubmittedTaskFollowUp[]>([]);
  const [activeFollowUpIndex, setActiveFollowUpIndex] = useState<number | null>(null);
  const basePersistedFollowUps = useMemo(
    () => readTaskFollowUpsFromMetadata(data.task.metadata),
    [data.task.metadata]
  );
  const baseBootstrapStage =
    typeof data.task.metadata.bootstrapStage === "string" ? data.task.metadata.bootstrapStage : null;
  const shouldStreamFeed =
    expanded ||
    selected ||
    localFollowUps.length > 0 ||
    basePersistedFollowUps.length > 0 ||
    activeFollowUpIndex !== null ||
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
  const persistedFollowUps = useMemo(
    () => readTaskFollowUpsFromMetadata(displayTask.metadata),
    [displayTask.metadata]
  );
  const followUps = useMemo(
    () => mergeTaskFollowUps(localFollowUps, persistedFollowUps),
    [localFollowUps, persistedFollowUps]
  );
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
  const effectiveActiveFollowUpIndex =
    activeFollowUpIndex !== null && activeFollowUpIndex < followUps.length ? activeFollowUpIndex : null;
  const activeFollowUp =
    effectiveActiveFollowUpIndex !== null ? followUps[effectiveActiveFollowUpIndex] ?? null : null;
  const activeFollowUpRuntimes = activeFollowUp ? resolveFollowUpRuntimes(activeFollowUp, detail?.runs ?? []) : [];
  const activeFollowUpRuntime = resolveRepresentativeFollowUpRuntime(activeFollowUpRuntimes);
  const activeFollowUpOutputs =
    detail?.outputs.filter((output) => activeFollowUpRuntimes.some((runtime) => runtime.id === output.runtimeId)) ?? [];
  const activeFollowUpOutput = resolveBestFollowUpOutput(activeFollowUpOutputs);
  const realDisplayedFeed = activeFollowUp
    ? filterFollowUpFeed(activeFollowUp, activeFollowUpRuntimes, visibleFeed)
    : visibleFeed;
  const displayedFeed =
    activeFollowUp && realDisplayedFeed.length === 0
      ? createFollowUpOptimisticFeed(activeFollowUp)
      : realDisplayedFeed;
  const activeFollowUpStatus = activeFollowUp
    ? resolveFollowUpStatus(activeFollowUp, activeFollowUpRuntime, activeFollowUpOutput, activeFollowUpRuntimes)
    : null;
  const toneInput: TaskNodeToneInput = {
    completedNeedsReview,
    isAborted,
    isJustCreated,
    isPendingCreation,
    status: displayTask.status,
    visibleReviewStatus
  };
  const displayedToneInput: TaskNodeToneInput = activeFollowUp && activeFollowUpStatus
    ? {
        completedNeedsReview: false,
        isAborted: activeFollowUpStatus === "cancelled",
        isJustCreated: false,
        isPendingCreation: false,
        status: activeFollowUpStatus,
        visibleReviewStatus: null
      }
    : toneInput;
  const tone = resolveTaskNodeTokenTone(displayedToneInput);
  const badgeVariant = resolveTaskNodeBadgeVariant(displayedToneInput);
  const badgeLabel = activeFollowUp && activeFollowUpStatus
    ? resolveTaskBadgeLabel(null, activeFollowUpStatus, false, activeFollowUpStatus === "cancelled", Boolean(activeFollowUpOutput?.finalText || activeFollowUp?.summary))
    : visibleReviewStatus
    ? resolveTaskReviewBadgeLabel(visibleReviewStatus)
    : missingFinalResponse
    ? "no result"
    : completedNeedsReview
      ? "needs review"
      : resolveTaskBadgeLabel(bootstrapStage, displayTask.status, isPendingCreation, isAborted, hasRuntimeOutputEvidence);
  const footerLabel = activeFollowUp
    ? resolveFollowUpFooterLabel(activeFollowUp, activeFollowUpRuntime, activeFollowUpOutput, activeFollowUpRuntimes)
    : visibleReviewStatus
    ? resolveTaskReviewFooterLabel(visibleReviewStatus)
    : stalledWithCapturedOutput
    ? "partial output needs review"
    : missingFinalResponse
    ? "completed without a final answer"
    : resolveTaskFooterLabel(bootstrapStage, displayTask.liveRunCount, isAborted);
  const latestFeedEvent = displayedFeed[displayedFeed.length - 1] ?? (activeFollowUp ? null : latestLocalEvent) ?? null;
  const showsLiveActivity =
    !isAborted &&
    !completedNeedsReview &&
    (activeFollowUp
      ? activeFollowUpStatus === "running" || activeFollowUpStatus === "queued"
      : isPendingCreation ||
        displayTask.status === "running" ||
        displayTask.liveRunCount > 0 ||
      Boolean(latestFeedEvent && /working|waiting for output/i.test(latestFeedEvent.title)));
  const activityLabel = latestFeedEvent?.title || footerLabel;
  const activitySummary =
    compactMissionText(latestFeedEvent?.detail, 88) ||
    (activeFollowUp
      ? compactMissionText(resolveFollowUpResultText(activeFollowUp, activeFollowUpRuntime, activeFollowUpOutput), 72) || footerLabel
      : isPendingCreation
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
  const displayedSessionCount = activeFollowUp
    ? countUniqueStrings([activeFollowUp.sessionId ?? "", ...activeFollowUpRuntimes.map((runtime) => runtime.sessionId ?? "")])
    : sessionCount;
  const displayedTurnCount = activeFollowUp ? countUniqueStrings([activeFollowUp.runId ?? "", ...activeFollowUpRuntimes.map((runtime) => runtime.runId ?? runtime.id)]) : turnCount;
  const displayedTokenLabel = activeFollowUp
    ? formatTokens(sumRuntimeTokens(activeFollowUpRuntimes))
    : formatTokens(displayTask.tokenUsage?.total);
  const displayedRuntimeCount = activeFollowUp ? Math.max(activeFollowUpRuntimes.length, activeFollowUp.runId ? 1 : 0) : displayTask.runtimeCount;
  const displayedArtifactCount = activeFollowUp
    ? activeFollowUpOutputs.reduce((sum, output) => sum + output.createdFiles.length, 0)
    : displayTask.artifactCount;
  const feedButtonCount = String(displayedFeed.length);
  const feedPanelId = `task-feed-${data.task.id}`;
  const visualTone = resolveTaskNodeVisualTone(displayedToneInput);
  const cardCount = 1 + followUps.length;
  const currentCardNumber = effectiveActiveFollowUpIndex === null ? 1 : effectiveActiveFollowUpIndex + 2;
  const nextCardNumber = currentCardNumber >= cardCount ? 1 : currentCardNumber + 1;
  const displayPromptText = activeFollowUp ? activeFollowUp.message : promptText;
  const displayResultTitle = activeFollowUp ? `Follow-up ${currentCardNumber - 1}` : "Latest result";
  const displayResultText = activeFollowUp
    ? resolveFollowUpResultText(activeFollowUp, activeFollowUpRuntime, activeFollowUpOutput)
    : resultPreview;
  const activeInspectorContext = activeFollowUp
    ? buildTaskCardInspectorContext(data.task.id, activeFollowUp, effectiveActiveFollowUpIndex ?? 0, currentCardNumber)
    : null;
  const taskMetrics: TaskMetricItem[] = [
    {
      icon: Users,
      label: "Sessions",
      value: displayedSessionCount
    },
    {
      icon: RefreshCw,
      label: "Turns",
      value: displayedTurnCount
    },
    {
      icon: Sparkles,
      label: "Tokens",
      value: displayedTokenLabel,
      highlighted: true
    },
    {
      icon: Rows3,
      label: "Feed",
      value: feedButtonCount,
      active: expanded,
      onClick: () => {
        if (data.onInspect) {
          data.onInspect(data.task, "output", activeInspectorContext);
          return;
        }

        setExpanded((current) => !current);
      }
    },
    {
      icon: FolderOpenDot,
      label: "Runs",
      value: displayedRuntimeCount,
      onClick: () => data.onInspect?.(data.task, "overview", activeInspectorContext)
    },
    {
      icon: Sparkles,
      label: "Files",
      value: displayedArtifactCount,
      onClick: () => data.onInspect?.(data.task, "files", activeInspectorContext)
    }
  ];

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
        "group relative w-[620px] max-w-[calc(100vw-32px)] overflow-visible rounded-[28px] border bg-[linear-gradient(180deg,rgba(12,19,33,0.98),rgba(5,10,20,0.98))] p-4 shadow-[0_24px_70px_rgba(0,0,0,0.38)] backdrop-blur-xl transition-[border-color,box-shadow,opacity] duration-200",
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

      <div className="relative z-20">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border shadow-[0_0_18px_rgba(45,212,191,0.09)]",
                    visualTone.icon
                  )}
                >
                  <ClipboardList className="h-[18px] w-[18px]" />
                </span>
                <span
                  className={cn(
                    "inline-flex h-1.5 w-1.5 shrink-0 rounded-full",
                    visualTone.dot,
                    showsLiveActivity && "motion-safe:animate-pulse"
                  )}
                />
                <span className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  {activeFollowUp ? "Follow-up" : "Task"} / <span className="text-emerald-300">{displayTask.primaryAgentName || "OpenClaw"}</span>
                </span>
                {data.locked ? <Lock className="h-3.5 w-3.5 text-slate-500" /> : null}
              </div>
              <p className="mt-1 truncate text-[11px] leading-4 text-slate-500">{activityLabel}</p>
            </div>

            <div className="nodrag nopan relative flex shrink-0 items-center gap-1.5" ref={menuRef}>
              <Badge variant={badgeVariant} className="max-w-[150px] truncate px-3 py-1.5 text-[11px]">
                {badgeLabel}
              </Badge>
              {followUps.length > 0 ? (
                <button
                  type="button"
                  aria-label={`Current card ${currentCardNumber} of ${cardCount}; show card ${nextCardNumber}`}
                  title={`Current card ${currentCardNumber} of ${cardCount}; click to show card ${nextCardNumber}`}
                  className="nodrag nopan inline-flex h-8 min-w-8 items-center justify-center rounded-full border border-cyan-200/16 bg-cyan-300/[0.07] px-2 font-mono text-[11px] font-semibold text-cyan-100 transition-colors hover:border-cyan-200/30 hover:bg-cyan-300/[0.12]"
                  onClick={(event) => {
                    event.stopPropagation();
                    setTitleExpanded(false);
                    const nextFollowUpIndex =
                      activeFollowUpIndex === null
                        ? 0
                        : effectiveActiveFollowUpIndex === null || effectiveActiveFollowUpIndex + 1 >= followUps.length
                          ? null
                          : effectiveActiveFollowUpIndex + 1;
                    setActiveFollowUpIndex(nextFollowUpIndex);
                    data.onActiveCardChange?.(
                      data.task,
                      nextFollowUpIndex === null
                        ? null
                        : buildTaskCardInspectorContext(
                            data.task.id,
                            followUps[nextFollowUpIndex]!,
                            nextFollowUpIndex,
                            nextFollowUpIndex + 2
                          )
                    );
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  {currentCardNumber}
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Task actions"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen((current) => !current);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                className="nodrag nopan inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.04] text-slate-300 transition-colors hover:border-white/[0.14] hover:bg-white/[0.08] hover:text-white"
              >
                <MoreHorizontal className="h-4 w-4" />
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

          <button
            type="button"
            aria-expanded={titleExpanded}
            className="nodrag nopan group mt-3 flex w-full items-start gap-2 text-left"
            onClick={(event) => {
              event.stopPropagation();
              setTitleExpanded((current) => !current);
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <h3
              className={cn(
                "min-w-0 flex-1 font-display text-[1.85rem] font-semibold leading-[1.08] text-white",
                !titleExpanded && "line-clamp-2"
              )}
            >
              {displayPromptText}
            </h3>
            <span className="mt-1.5 shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] p-1 text-slate-400 transition-colors group-hover:border-cyan-200/20 group-hover:text-slate-100">
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", titleExpanded && "rotate-180")} />
            </span>
          </button>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
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
            <span className={cn("text-[10px] uppercase tracking-[0.16em]", tone)}>
              {footerLabel}
            </span>
          </div>

          <TaskMetricRow metrics={taskMetrics} compact className="mt-4" />

          <ExpandableTaskResult
            title={displayResultTitle}
            result={displayResultText}
            compact
            className={cn("mt-4", visualTone.resultBorder)}
          />

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

          <TaskFollowUpComposer
            task={displayTask}
            latestResult={resultPreview}
            createdFiles={detail?.createdFiles}
            outputSummary={activitySummary}
            compact
            className="nodrag nopan mt-4"
            onSubmitted={(followUp) => {
              const nextIndex = followUps.length;
              setLocalFollowUps((current) => mergeTaskFollowUps(current, [followUp]));
              setActiveFollowUpIndex(nextIndex);
              data.onActiveCardChange?.(
                data.task,
                buildTaskCardInspectorContext(data.task.id, followUp, nextIndex, nextIndex + 2)
              );
              setExpanded(true);
            }}
          />
        </div>
      </div>

      <div className={cn("mt-4 rounded-[16px] border border-white/[0.07] bg-white/[0.025] px-2.5 py-1.5", expanded && "pb-2.5")}>
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
                {loading && displayedFeed.length === 0 ? (
                  <div className="py-4 text-center text-[10px] text-slate-500">
                    Connecting to feed...
                  </div>
                ) : error && displayedFeed.length === 0 ? (
                  <div className="rounded-[12px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[10px] leading-5 text-amber-100">
                    {error}
                  </div>
                ) : displayedFeed.length === 0 ? (
                  <div className="py-4 text-center text-[10px] text-slate-500">
                    {activeFollowUp ? "No follow-up events yet." : "No events yet."}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {displayedFeed.map((event) => (
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

function resolveFollowUpRuntimes(followUp: SubmittedTaskFollowUp, runs: RuntimeRecord[]) {
  const runId = followUp.runId?.trim();

  if (runId) {
    const exactMatches = runs.filter((runtime) => runtime.runId === runId || runtime.id === runId || readMetadataString(runtime.metadata, "runId") === runId);

    if (exactMatches.length > 0) {
      return exactMatches.sort((left, right) => timestampNumberToMs(right.updatedAt) - timestampNumberToMs(left.updatedAt));
    }
  }

  const createdAtMs = Date.parse(followUp.createdAt);
  const sessionId = followUp.sessionId?.trim();
  const candidates = runs
    .filter((runtime) => {
      const runtimeUpdatedAt = timestampNumberToMs(runtime.updatedAt);
      const afterFollowUp = Number.isNaN(createdAtMs) || runtimeUpdatedAt === 0 || runtimeUpdatedAt >= createdAtMs - 5000;
      const sameSession = !sessionId || runtime.sessionId === sessionId || runtime.key.includes(sessionId);
      return afterFollowUp && sameSession;
    })
    .sort((left, right) => timestampNumberToMs(right.updatedAt) - timestampNumberToMs(left.updatedAt));

  return candidates;
}

function resolveRepresentativeFollowUpRuntime(runtimes: RuntimeRecord[]) {
  return (
    runtimes.find((runtime) => hasMeaningfulRuntimeSubtitle(runtime)) ??
    runtimes.find((runtime) => runtime.status === "completed") ??
    runtimes[0] ??
    null
  );
}

function resolveBestFollowUpOutput(outputs: RuntimeOutputRecord[]) {
  return (
    outputs.find((output) => output.finalText?.trim()) ??
    outputs.find((output) => output.errorMessage?.trim()) ??
    outputs[0] ??
    null
  );
}

function filterFollowUpFeed(
  followUp: SubmittedTaskFollowUp,
  runtimes: RuntimeRecord[],
  feed: TaskFeedEvent[]
) {
  if (runtimes.length > 0) {
    const runtimeIds = new Set(runtimes.map((runtime) => runtime.id));
    const runIds = new Set(runtimes.map((runtime) => runtime.runId).filter((value): value is string => Boolean(value)));
    return feed.filter((event) => {
      if (event.runtimeId && runtimeIds.has(event.runtimeId)) {
        return true;
      }

      return Boolean(event.runtimeId && runIds.has(event.runtimeId));
    });
  }

  const createdAtMs = Date.parse(followUp.createdAt);
  if (Number.isNaN(createdAtMs)) {
    return [];
  }

  return feed.filter((event) => {
    const eventTimestamp = Date.parse(event.timestamp);
    return !Number.isNaN(eventTimestamp) && eventTimestamp >= createdAtMs - 5000;
  });
}

function createFollowUpOptimisticFeed(followUp: SubmittedTaskFollowUp): TaskFeedEvent[] {
  return [
    {
      id: `${followUp.id}:submitted`,
      kind: "user",
      timestamp: followUp.createdAt,
      title: followUp.runId ? "Follow-up run started" : "Follow-up sent",
      detail: followUp.runId
        ? `OpenClaw accepted this follow-up as run ${followUp.runId}. Waiting for live output.`
        : "OpenClaw accepted this follow-up. Waiting for the run to appear in the live feed.",
      runtimeId: followUp.runId ?? undefined
    }
  ];
}

function resolveFollowUpStatus(
  followUp: SubmittedTaskFollowUp,
  runtime: RuntimeRecord | null,
  output: RuntimeOutputRecord | null | undefined,
  runtimes: RuntimeRecord[] = []
) {
  const status = normalizeRuntimeStatus(followUp.status);
  if (status && status !== "running") {
    return status;
  }

  if (output?.finalText || followUp.summary) {
    return "completed";
  }

  if (runtime?.status === "completed" && hasMeaningfulRuntimeSubtitle(runtime)) {
    return "completed";
  }

  if (runtimes.some((entry) => entry.status === "cancelled")) {
    return "cancelled";
  }

  if (runtimes.some((entry) => entry.status === "stalled")) {
    return "stalled";
  }

  if (runtimes.some((entry) => entry.status === "completed")) {
    return "completed";
  }

  if (runtime?.status === "queued" || runtimes.some((entry) => entry.status === "queued")) {
    return "queued";
  }

  if (runtimes.some((entry) => entry.status === "running") && isFollowUpRuntimeGroupStale(runtimes)) {
    return "stalled";
  }

  return "running";
}

function isFollowUpRuntimeGroupStale(runtimes: RuntimeRecord[]) {
  const latestUpdatedAt = Math.max(...runtimes.map((runtime) => timestampNumberToMs(runtime.updatedAt)));
  return latestUpdatedAt > 0 && Date.now() - latestUpdatedAt > FOLLOW_UP_STALE_MS;
}

function resolveFollowUpResultText(
  followUp: SubmittedTaskFollowUp,
  runtime: RuntimeRecord | null,
  output: RuntimeOutputRecord | null | undefined
) {
  const finalText = output?.finalText?.trim();
  if (finalText) {
    return finalText;
  }

  const errorMessage = output?.errorMessage?.trim();
  if (errorMessage) {
    return errorMessage;
  }

  const runtimeSubtitle = runtime?.subtitle?.trim();
  if (runtime && runtimeSubtitle && hasMeaningfulRuntimeSubtitle(runtime)) {
    return runtimeSubtitle;
  }

  if (runtime || followUp.runId) {
    return [
      "Operator follow-up:",
      followUp.message,
      "",
      "OpenClaw accepted this follow-up and AgentOS is tracking the live run.",
      "No agent answer has been captured yet."
    ].join("\n");
  }

  return formatFollowUpDetail(followUp);
}

function resolveFollowUpFooterLabel(
  followUp: SubmittedTaskFollowUp,
  runtime: RuntimeRecord | null,
  output: RuntimeOutputRecord | null | undefined,
  runtimes: RuntimeRecord[] = []
) {
  const status = resolveFollowUpStatus(followUp, runtime, output, runtimes);

  switch (status) {
    case "queued":
      return "follow-up queued";
    case "running":
      return "follow-up running";
    case "completed":
      return "follow-up completed";
    case "stalled":
      return "follow-up stalled";
    case "cancelled":
      return "follow-up cancelled";
    default:
      return "follow-up";
  }
}

function buildTaskCardInspectorContext(
  taskId: string,
  followUp: SubmittedTaskFollowUp,
  followUpIndex: number,
  cardNumber: number
): TaskCardInspectorContext {
  return {
    taskId,
    cardNumber,
    followUpIndex,
    message: followUp.message,
    runId: followUp.runId ?? null,
    sessionId: followUp.sessionId ?? null,
    status: followUp.status ?? null,
    summary: followUp.summary ?? null,
    createdAt: followUp.createdAt
  };
}

function normalizeRuntimeStatus(value: string | null | undefined): RuntimeRecord["status"] | null {
  switch (value) {
    case "queued":
    case "running":
    case "idle":
    case "completed":
    case "stalled":
    case "cancelled":
      return value;
    default:
      return null;
  }
}

function timestampNumberToMs(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value > 1_000_000_000_000 ? value : value * 1000;
}

function readMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function hasMeaningfulRuntimeSubtitle(runtime: RuntimeRecord) {
  const value = runtime.subtitle.trim().toLowerCase();
  return Boolean(value && !["chat", "agent", "sessions.changed", "session.message", "openclaw runtime event", "gateway runtime event"].includes(value));
}

function countUniqueStrings(values: string[]) {
  return new Set(values.map((value) => value.trim()).filter(Boolean)).size;
}

function sumRuntimeTokens(runtimes: RuntimeRecord[]) {
  const total = runtimes.reduce((sum, runtime) => sum + (runtime.tokenUsage?.total ?? 0), 0);
  return total || undefined;
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
