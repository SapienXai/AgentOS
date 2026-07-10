"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  ClipboardList,
  ChevronDown,
  Copy,
  CornerDownLeft,
  EyeOff,
  Lock,
  LockOpen,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Sparkles,
  X
} from "lucide-react";
import { motion } from "motion/react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";

import type { TaskCardInspectorContext, TaskNodeData } from "@/components/mission-control/canvas-types";
import { InteractiveContent } from "@/components/mission-control/interactive-content";
import {
  FRESH_NODE_BADGE_CLASSES,
  type TaskNodeToneInput,
  resolveTaskNodeBadgeVariant,
  resolveTaskNodeSurfaceTone,
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
  resolveTaskCardPrimaryAction,
  resolveTaskDispatchIssueDetail,
  resolveTaskBadgeLabel
} from "@/components/mission-control/task-node-status";
import {
  ExpandableTaskResult,
  TaskFollowUpComposer,
  formatFollowUpDetail,
  type SubmittedTaskFollowUp
} from "@/components/mission-control/task-follow-up";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTaskFeed } from "@/hooks/use-task-feed";
import type { RuntimeActivityRecord, RuntimeOutputRecord, TaskFeedEvent } from "@/lib/agentos/contracts";
import {
  mergeTaskFollowUps,
  readTaskFollowUpsFromMetadata,
  resolveTaskFollowUpDisplayMessage
} from "@/lib/openclaw/domains/task-follow-up-records";
import { resolveTaskFollowUpAvailability } from "@/lib/openclaw/domains/task-follow-up";
import { compactMissionText } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type TaskFlowNode = Node<TaskNodeData, "task">;
const FOLLOW_UP_STALE_MS = 90_000;

type TaskWorkspaceTab = {
  id: string;
  index: number | null;
  kind: "task" | "follow-up";
  label: string;
  title: string;
  statusLabel: string;
  hasLiveActivity: boolean;
};

export function TaskNode({ data, selected }: NodeProps<TaskFlowNode>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
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
  const { feed, detail, loading, error, streamNotice } = useTaskFeed(data.task.id, shouldStreamFeed, {
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
  const dispatchIssueDetail = resolveTaskDispatchIssueDetail(displayTask, integrity);
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
  const feedPanelId = `task-feed-${data.task.id}`;
  const visualTone = resolveTaskNodeVisualTone(displayedToneInput);
  const surfaceTheme = data.surfaceTheme ?? "dark";
  const surfaceTone = resolveTaskNodeSurfaceTone(surfaceTheme);
  const agentThemeRgb = data.agentThemeRgb ?? "14, 165, 233";
  const taskCardStyle = {
    borderColor: `rgba(${agentThemeRgb}, ${selected ? 0.62 : surfaceTheme === "light" ? 0.32 : 0.28})`,
    ...(selected
      ? {
          boxShadow:
            surfaceTheme === "light"
              ? `0 0 0 1px rgba(${agentThemeRgb}, 0.18), 0 22px 52px rgba(${agentThemeRgb}, 0.18)`
              : `0 0 0 1px rgba(${agentThemeRgb}, 0.2), 0 22px 52px rgba(${agentThemeRgb}, 0.24)`
        }
      : {})
  } as CSSProperties;
  const followUpAvailability = resolveTaskFollowUpAvailability(displayTask);
  const resolvedPrimaryAction = resolveTaskCardPrimaryAction({
    status: displayTask.status,
    completedNeedsReview
  });
  const primaryAction = resolvedPrimaryAction === "review-result" && !data.onReviewTask
    ? "view-details"
    : resolvedPrimaryAction;
  const currentCardNumber = effectiveActiveFollowUpIndex === null ? 1 : effectiveActiveFollowUpIndex + 2;
  const displayPromptText = activeFollowUp
    ? resolveTaskFollowUpDisplayMessage(activeFollowUp) ?? activeFollowUp.message
    : promptText;
  const displayResultTitle = activeFollowUp ? "Follow-up result" : "Latest result";
  const displayResultText = activeFollowUp
    ? resolveFollowUpResultText(activeFollowUp, activeFollowUpRuntime, activeFollowUpOutput)
    : resultPreview;
  const activeInspectorContext = activeFollowUp
    ? buildTaskCardInspectorContext(data.task.id, activeFollowUp, effectiveActiveFollowUpIndex ?? 0, currentCardNumber)
    : null;
  const cardSummary = compactMissionText(
    isLiveTask || isPendingCreation ? activitySummary : displayResultText || activitySummary,
    164
  ) || activitySummary;

  useEffect(() => {
    if (!expanded && !composerExpanded) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!cardRef.current?.contains(event.target as globalThis.Node)) {
        setExpanded(false);
        setComposerExpanded(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [expanded, composerExpanded]);

  const tabs: TaskWorkspaceTab[] = [
    {
      id: "task",
      index: null,
      kind: "task",
      label: "Task 1",
      title: compactMissionText(promptText, 36) || "Original task",
      statusLabel: displayTask.status,
      hasLiveActivity: !activeFollowUp && showsLiveActivity
    },
    ...followUps.map((followUp, index) => ({
      id: followUp.runId || followUp.id,
      index,
      kind: "follow-up" as const,
      label: "Follow-up",
      title: compactMissionText(resolveTaskFollowUpDisplayMessage(followUp) ?? followUp.message, 34) || "Follow-up",
      statusLabel: normalizeRuntimeStatus(followUp.status) ?? "running",
      hasLiveActivity: activeFollowUp?.id === followUp.id && showsLiveActivity
    }))
  ];
  const activeTabId = activeFollowUp ? activeFollowUp.runId || activeFollowUp.id : "task";
  const selectTaskTab = (nextIndex: number | null) => {
    setActiveFollowUpIndex(nextIndex);
    data.onActiveCardChange?.(
      data.task,
      nextIndex === null
        ? null
        : buildTaskCardInspectorContext(
            data.task.id,
            followUps[nextIndex]!,
            nextIndex,
            nextIndex + 2
          )
    );
  };
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
      ref={cardRef}
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
        "group relative w-[400px] max-w-[calc(100vw-32px)] origin-center transform-gpu overflow-visible rounded-[18px] border p-1.5 backdrop-blur-xl transition-[border-color,box-shadow,opacity,transform] duration-200",
        surfaceTone.outer,
        data.emphasis ? "opacity-100" : "opacity-76",
        (composerExpanded || expanded) && "z-30 shadow-[0_22px_58px_rgba(0,0,0,0.3)]"
      )}
      style={taskCardStyle}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[18px]">
        <div
          className="absolute inset-y-3 left-0 w-0.5 rounded-r-full"
          style={{ backgroundColor: `rgb(${agentThemeRgb})`, boxShadow: `0 0 14px rgba(${agentThemeRgb}, 0.46)` }}
        />
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{ backgroundColor: `rgba(${agentThemeRgb}, ${surfaceTheme === "light" ? 0.62 : 0.78})` }}
        />
        <div
          className="absolute -right-8 -top-8 h-24 w-24 rounded-full blur-3xl"
          style={{ backgroundColor: `rgba(${agentThemeRgb}, ${surfaceTheme === "light" ? 0.1 : 0.14})` }}
        />
      </div>

      <div className="relative z-10">
        {isPendingCreation ? (
        <motion.div
          className="pointer-events-none absolute inset-[-8px] rounded-[18px] border"
          style={{ borderColor: `rgba(${agentThemeRgb}, 0.28)` }}
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

        <div className={cn("relative z-20 rounded-[13px] border px-3 py-2.5", surfaceTone.panel)}>
          <div className="min-w-0">
          <div className="flex items-start justify-between gap-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border",
                    resolveTaskIconClass(visualTone.key, surfaceTheme)
                  )}
                >
                  <ClipboardList className="h-3.5 w-3.5" />
                </span>
                <span
                  className={cn(
                    "inline-flex h-1.5 w-1.5 shrink-0 rounded-full",
                    visualTone.dot,
                    showsLiveActivity && "motion-safe:animate-pulse"
                  )}
                />
                <span className={cn("truncate text-[10px] font-semibold uppercase tracking-[0.16em]", surfaceTone.mutedText)}>
                  {activeFollowUp ? "Follow-up" : "Task"} · <span className={cn("normal-case tracking-normal", surfaceTone.text)}>{displayTask.primaryAgentName || "OpenClaw"}</span>
                </span>
                {data.locked ? <Lock className={cn("h-3 w-3", surfaceTone.mutedText)} /> : null}
              </div>
              <p className={cn("mt-0.5 truncate text-[10px] leading-4", surfaceTone.mutedText)}>{activityLabel}</p>
            </div>

            <div className="nodrag nopan relative flex shrink-0 items-center gap-1.5" ref={menuRef}>
              <Badge variant={badgeVariant} className="max-w-[132px] truncate rounded-[8px] px-2 py-1 text-[9px]">
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
                className={cn("nodrag nopan inline-flex h-7 w-7 items-center justify-center rounded-[9px] border transition-colors", surfaceTone.subtleButton)}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>

              {menuOpen ? (
                <div
                  className={cn("nodrag nopan absolute right-0 top-[calc(100%+8px)] z-[70] min-w-[176px] rounded-[12px] border p-1.5 backdrop-blur-xl", surfaceTone.menu)}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  {data.onReviewTask && (completedNeedsReview || hasReviewResolution) ? (
                    <TaskMenuButton
                      icon={hasReviewResolution ? CheckCircle2 : AlertTriangle}
                      label={hasReviewResolution ? "Review record" : "Review result"}
                      surfaceTheme={surfaceTheme}
                      onClick={() => {
                        data.onReviewTask?.(displayTask);
                        setMenuOpen(false);
                      }}
                    />
                  ) : null}
                  <TaskMenuButton
                      icon={CornerDownLeft}
                      label="Reuse as new task"
                      surfaceTheme={surfaceTheme}
                    onClick={() => {
                      data.onReply?.(data.task);
                      setMenuOpen(false);
                    }}
                  />
                  <TaskMenuButton
                      icon={Copy}
                      label="Copy & edit prompt"
                      surfaceTheme={surfaceTheme}
                    onClick={() => {
                      data.onCopyPrompt?.(data.task);
                      setMenuOpen(false);
                    }}
                  />
                  <TaskMenuButton
                      icon={EyeOff}
                      label="Hide"
                      surfaceTheme={surfaceTheme}
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
                      surfaceTheme={surfaceTheme}
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
                      surfaceTheme={surfaceTheme}
                    onClick={() => {
                      data.onToggleLock?.(data.task);
                      setMenuOpen(false);
                    }}
                  />
                </div>
              ) : null}
            </div>
          </div>

          <h3 className={cn("mt-2.5 line-clamp-2 font-display text-[1rem] font-semibold leading-[1.28]", surfaceTone.text)}>
            {displayPromptText}
          </h3>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {displayTask.warningCount > 0 && !hasReviewResolution ? (
              <Badge variant="warning" className="rounded-[8px] px-2 py-1 text-[9px]">
                {displayTask.warningCount} review{displayTask.warningCount === 1 ? "" : "s"}
              </Badge>
            ) : null}
            {isJustCreated ? (
              <Badge variant="default" className={cn(FRESH_NODE_BADGE_CLASSES, "rounded-[8px] px-2 py-1 text-[9px]")}>
                <Sparkles className="h-3 w-3" />
                new
              </Badge>
            ) : null}
            {followUps.length > 0 ? (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className={cn("nodrag nopan rounded-[7px] border px-1.5 py-1 text-[9px] font-medium", surfaceTone.subtleButton)}
              >
                {followUps.length} follow-up{followUps.length === 1 ? "" : "s"}
              </button>
            ) : null}
            <span className={cn("text-[9px] uppercase tracking-[0.14em]", tone, surfaceTheme === "light" && resolveLightTaskStatusTextClass(visualTone.key))}>
              {footerLabel}
            </span>
          </div>

          {dispatchIssueDetail ? (
            <p className={cn("mt-1.5 line-clamp-2 text-[10px] leading-4", surfaceTheme === "light" ? "text-amber-800" : "text-amber-100/90")}>{dispatchIssueDetail}</p>
          ) : null}

          <p className={cn("mt-2 line-clamp-2 text-[11px] leading-5", surfaceTheme === "light" ? "text-[#624f43]" : "text-slate-300")}>
            {cardSummary}
          </p>

          <div className="mt-3 flex items-center gap-1.5">
            <button
              type="button"
              className={cn("nodrag nopan inline-flex h-8 items-center rounded-[9px] px-2.5 text-[10px] font-semibold transition-colors", resolvePrimaryActionClass(primaryAction, surfaceTheme))}
              onClick={(event) => {
                event.stopPropagation();
                if (primaryAction === "review-result") {
                  data.onReviewTask?.(displayTask);
                  return;
                }

                data.onInspect?.(data.task, primaryAction === "view-details" ? "overview" : "output", activeInspectorContext);
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {formatPrimaryActionLabel(primaryAction)}
            </button>
            <button
              type="button"
              disabled={!followUpAvailability.available}
              title={followUpAvailability.reason ?? followUpAvailability.warning ?? "Continue this task in its existing OpenClaw session."}
              className={cn(
                "nodrag nopan inline-flex h-8 items-center rounded-[9px] border px-2.5 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                surfaceTone.subtleButton
              )}
              onClick={(event) => {
                event.stopPropagation();
                setExpanded(true);
                setComposerExpanded(true);
                requestAnimationFrame(() => composerInputRef.current?.focus());
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              Follow up
            </button>
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={feedPanelId}
              className={cn("nodrag nopan ml-auto inline-flex h-8 w-8 items-center justify-center rounded-[9px] border transition-colors", surfaceTone.subtleButton)}
              title={expanded ? "Hide activity" : "Show activity and details"}
              onClick={(event) => {
                event.stopPropagation();
                setExpanded((current) => !current);
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {expanded ? <X className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>

          </div>
        </div>

        {expanded ? (
          <motion.div
            id={feedPanelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={cn("nodrag nopan mt-1.5 overflow-hidden rounded-[13px] border px-2.5 py-2.5 nowheel", surfaceTone.panel)}
            onClick={(e) => e.stopPropagation()}
          >
            {followUps.length > 0 ? (
              <TaskWorkspaceTabs
                activeTabId={activeTabId}
                tabs={tabs}
                surfaceTheme={surfaceTheme}
                addDisabled={!followUpAvailability.available}
                addTitle={followUpAvailability.reason ?? followUpAvailability.warning ?? "Continue this task in its existing OpenClaw session."}
                onAdd={() => {
                  setComposerExpanded(true);
                  requestAnimationFrame(() => composerInputRef.current?.focus());
                }}
                onSelect={(tab) => selectTaskTab(tab.index)}
              />
            ) : null}
            <ExpandableTaskResult
              title={displayResultTitle}
              result={displayResultText}
              compact
              density="dense"
              className="mb-2"
            />
            <div>
              {streamNotice ? (
                <div className={cn("mb-2 rounded-[10px] border border-amber-400/20 bg-amber-400/10 px-2.5 py-2 text-[10px] leading-5", surfaceTheme === "light" ? "text-amber-800" : "text-amber-100")}>
                  {streamNotice}
                </div>
              ) : null}
              <ScrollArea className="h-[108px] w-full pr-3">
                {loading && displayedFeed.length === 0 ? (
                  <div className={cn("py-4 text-center text-[10px]", surfaceTone.mutedText)}>
                    Connecting to feed...
                  </div>
                ) : error && displayedFeed.length === 0 ? (
                  <div className={cn("rounded-[10px] border border-amber-400/20 bg-amber-400/10 px-2.5 py-2 text-[10px] leading-5", surfaceTheme === "light" ? "text-amber-800" : "text-amber-100")}>
                    {error}
                  </div>
                ) : displayedFeed.length === 0 ? (
                  <div className={cn("py-4 text-center text-[10px]", surfaceTone.mutedText)}>
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
                          <span className={cn("text-[10px] font-medium", surfaceTheme === "light" ? "text-[#514136]" : "text-slate-300")}>
                            {event.title}
                          </span>
                          <span className={cn("shrink-0 text-[9px]", surfaceTone.mutedText)}>
                            {formatTimeOnly(event.timestamp)}
                          </span>
                        </div>
                        <div className="mt-0.5">
                          <InteractiveContent
                            text={event.detail}
                            className={cn("text-[10px] leading-relaxed", surfaceTheme === "light" ? "text-[#806958] group-hover/item:text-[#514136]" : "text-slate-400 group-hover/item:text-slate-300")}
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
            {composerExpanded ? (
              <TaskFollowUpComposer
                task={displayTask}
                latestResult={displayResultText}
                createdFiles={detail?.createdFiles}
                outputSummary={activitySummary}
                compact
                density="dense"
                expanded
                textareaRef={composerInputRef}
                className="nodrag nopan mt-2"
                onSubmitted={(followUp) => {
                  const nextIndex = followUps.length;
                  setLocalFollowUps((current) => mergeTaskFollowUps(current, [followUp]));
                  setActiveFollowUpIndex(nextIndex);
                  data.onActiveCardChange?.(data.task, buildTaskCardInspectorContext(data.task.id, followUp, nextIndex, nextIndex + 2));
                }}
              />
            ) : null}
          </motion.div>
        ) : null}
      </div>
    </motion.div>
  );
}

function TaskWorkspaceTabs({
  activeTabId,
  tabs,
  onAdd,
  onSelect,
  surfaceTheme,
  addDisabled = false,
  addTitle = "Focus follow-up composer"
}: {
  activeTabId: string;
  tabs: TaskWorkspaceTab[];
  onAdd: () => void;
  onSelect: (tab: TaskWorkspaceTab) => void;
  surfaceTheme: "dark" | "light";
  addDisabled?: boolean;
  addTitle?: string;
}) {
  const activeIndex = Math.max(tabs.findIndex((tab) => tab.id === activeTabId), 0);
  const selectByOffset = (offset: number) => {
    const nextTab = tabs[(activeIndex + offset + tabs.length) % tabs.length];
    if (nextTab) {
      onSelect(nextTab);
    }
  };

  return (
    <div
      className="relative z-20 mb-1.5 flex items-end gap-1.5 pb-px"
      onClick={(event) => event.stopPropagation()}
    >
      <div
        role="tablist"
        aria-label="Task workspace tabs"
        className={cn(
          "min-w-0 items-end gap-2",
          tabs.length <= 7 ? "grid flex-1" : "flex min-w-max overflow-x-auto"
        )}
        style={tabs.length <= 7 ? { gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` } : undefined}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const Icon = tab.kind === "task" ? ClipboardList : MessageSquare;
          const isLight = surfaceTheme === "light";

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={`${tab.label}: ${tab.title}`}
              className={cn(
                "group/tab relative flex h-[50px] cursor-grab items-center gap-2 rounded-t-[14px] border px-2.5 text-left outline-none transition-all duration-200 active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-cyan-200/45",
                tabs.length <= 7 ? "min-w-0 w-full" : "min-w-[150px] max-w-[220px] shrink-0",
                active
                  ? isLight
                    ? "border-[#b9a18d] bg-[#f9eee6] text-[#3b2d24] shadow-[0_-8px_24px_rgba(107,75,55,0.10)]"
                    : "border-cyan-200/28 bg-cyan-300/[0.09] text-white shadow-[0_-10px_34px_rgba(45,212,191,0.13)]"
                  : isLight
                    ? "border-[#e6d7cd] bg-white/[0.58] text-[#7d6656] hover:border-[#cda98f] hover:bg-[#faf1ea]"
                    : "border-white/[0.075] bg-white/[0.025] text-slate-300 hover:border-cyan-200/16 hover:bg-white/[0.045]"
              )}
              onClick={() => onSelect(tab)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  selectByOffset(1);
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  selectByOffset(-1);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  if (tabs[0]) {
                    onSelect(tabs[0]);
                  }
                } else if (event.key === "End") {
                  event.preventDefault();
                  const lastTab = tabs[tabs.length - 1];
                  if (lastTab) {
                    onSelect(lastTab);
                  }
                }
              }}
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border transition-colors",
                  active
                    ? isLight
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-emerald-200/24 bg-emerald-300/[0.12] text-emerald-100"
                    : isLight
                      ? "border-[#e7d8ce] bg-white/60 text-[#927968] group-hover/tab:text-[#5d493c]"
                      : "border-white/[0.08] bg-white/[0.035] text-slate-400 group-hover/tab:text-slate-200"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("flex items-center gap-1.5 text-[10px] font-semibold", active ? (isLight ? "text-emerald-700" : "text-emerald-200") : (isLight ? "text-[#8d7463]" : "text-slate-400"))}>
                  {tab.hasLiveActivity ? (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.75)] motion-safe:animate-pulse" />
                  ) : null}
                  <span className="truncate">{tab.label}</span>
                  <span className={cn("h-1 w-1 rounded-full", tabStatusDotClassName(tab.statusLabel))} />
                </span>
                <span className={cn("mt-0.5 block truncate text-[10px] font-semibold leading-4", isLight ? "text-[#413229]" : "text-slate-100")}>
                  {tab.title}
                </span>
              </span>
              <span
                className={cn(
                  "absolute inset-x-3 bottom-0 h-0.5 rounded-full transition-all duration-200",
                  active ? (isLight ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.34)]" : "bg-emerald-300 shadow-[0_0_16px_rgba(52,211,153,0.75)]") : "bg-transparent"
                )}
              />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        disabled={addDisabled}
        aria-label="Focus follow-up composer"
        title={addTitle}
        className={cn(
          "nodrag nopan mb-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-cyan-200/45 disabled:cursor-not-allowed disabled:opacity-45",
          surfaceTheme === "light"
            ? "border-[#e1d1c6] bg-white/70 text-[#70594a] hover:border-[#cda98f] hover:bg-[#fbf1e9]"
            : "border-white/[0.08] bg-white/[0.045] text-slate-200 shadow-[0_8px_18px_rgba(0,0,0,0.16)] hover:border-cyan-200/22 hover:bg-cyan-300/[0.08] hover:text-cyan-100"
        )}
        onClick={onAdd}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function tabStatusDotClassName(status: string) {
  switch (status) {
    case "completed":
      return "bg-emerald-300";
    case "running":
    case "queued":
      return "bg-cyan-300";
    case "stalled":
      return "bg-amber-300";
    case "cancelled":
      return "bg-rose-300";
    default:
      return "bg-slate-500";
  }
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
      return "waiting for output";
    case "stalled":
      return "working silently";
    default:
      return liveRunCount > 0 ? `${liveRunCount} live run${liveRunCount === 1 ? "" : "s"}` : "no live runs right now";
  }
}

function readTaskPromptText(task: TaskFlowNode["data"]["task"]) {
  return task.mission?.trim() || task.title.trim() || "Untitled task";
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

function resolveFollowUpRuntimes(followUp: SubmittedTaskFollowUp, runs: RuntimeActivityRecord[]) {
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

function resolveRepresentativeFollowUpRuntime(runtimes: RuntimeActivityRecord[]) {
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
  runtimes: RuntimeActivityRecord[],
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
      title: followUp.runId ? "Follow-up run started" : "Follow-up accepted",
      detail: followUp.runId
        ? `OpenClaw accepted this follow-up as run ${followUp.runId}. Waiting for live output.`
        : "OpenClaw accepted this follow-up. Waiting for the run to appear in the live feed.",
      runtimeId: followUp.runId ?? undefined
    }
  ];
}

function resolveFollowUpStatus(
  followUp: SubmittedTaskFollowUp,
  runtime: RuntimeActivityRecord | null,
  output: RuntimeOutputRecord | null | undefined,
  runtimes: RuntimeActivityRecord[] = []
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

function isFollowUpRuntimeGroupStale(runtimes: RuntimeActivityRecord[]) {
  const latestUpdatedAt = Math.max(...runtimes.map((runtime) => timestampNumberToMs(runtime.updatedAt)));
  return latestUpdatedAt > 0 && Date.now() - latestUpdatedAt > FOLLOW_UP_STALE_MS;
}

function resolveFollowUpResultText(
  followUp: SubmittedTaskFollowUp,
  runtime: RuntimeActivityRecord | null,
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

  const message = resolveTaskFollowUpDisplayMessage(followUp) ?? followUp.message;

  if (runtime || followUp.runId) {
    return [
      "Operator follow-up:",
      message,
      "",
      "OpenClaw accepted this follow-up and AgentOS is tracking the live run.",
      "No agent answer has been captured yet."
    ].join("\n");
  }

  return formatFollowUpDetail(followUp);
}

function resolveFollowUpFooterLabel(
  followUp: SubmittedTaskFollowUp,
  runtime: RuntimeActivityRecord | null,
  output: RuntimeOutputRecord | null | undefined,
  runtimes: RuntimeActivityRecord[] = []
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
  const message = resolveTaskFollowUpDisplayMessage(followUp) ?? followUp.message;
  return {
    taskId,
    cardNumber,
    followUpIndex,
    message,
    runId: followUp.runId ?? null,
    sessionId: followUp.sessionId ?? null,
    status: followUp.status ?? null,
    summary: followUp.summary ?? null,
    createdAt: followUp.createdAt
  };
}

function normalizeRuntimeStatus(value: string | null | undefined): RuntimeActivityRecord["status"] | null {
  switch (value) {
    case "queued":
    case "running":
    case "idle":
    case "completed":
    case "stalled":
    case "cancelled":
      return value;
    case "timeout":
    case "timed_out":
    case "failed":
    case "error":
      return "stalled";
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

function hasMeaningfulRuntimeSubtitle(runtime: RuntimeActivityRecord) {
  const value = runtime.subtitle.trim().toLowerCase();
  return Boolean(value && !["chat", "agent", "sessions.changed", "session.message", "openclaw runtime event", "gateway runtime event"].includes(value));
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

function resolveTaskIconClass(key: ReturnType<typeof resolveTaskNodeVisualTone>["key"], surfaceTheme: "dark" | "light") {
  if (surfaceTheme === "dark") {
    return resolveDarkTaskIconClass(key);
  }

  switch (key) {
    case "aborted":
      return "border-rose-200 bg-rose-50 text-rose-600";
    case "review":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "live":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "fresh":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-[#e2d1c5] bg-[#faf2eb] text-[#70594a]";
  }
}

function resolveDarkTaskIconClass(key: ReturnType<typeof resolveTaskNodeVisualTone>["key"]) {
  switch (key) {
    case "aborted":
      return "border-rose-300/20 bg-rose-400/[0.09] text-rose-100";
    case "review":
      return "border-amber-300/[0.22] bg-amber-400/[0.1] text-amber-100";
    case "live":
      return "border-cyan-300/20 bg-cyan-300/[0.09] text-cyan-100";
    case "success":
      return "border-emerald-300/[0.18] bg-emerald-300/[0.07] text-emerald-100";
    case "fresh":
      return "border-sky-300/20 bg-sky-300/[0.08] text-sky-100";
    default:
      return "border-white/[0.08] bg-white/[0.045] text-slate-200";
  }
}

function resolveLightTaskStatusTextClass(key: ReturnType<typeof resolveTaskNodeVisualTone>["key"]) {
  switch (key) {
    case "aborted":
      return "text-rose-700";
    case "review":
      return "text-amber-700";
    case "live":
      return "text-cyan-700";
    case "success":
      return "text-emerald-700";
    case "fresh":
      return "text-sky-700";
    default:
      return "text-[#8f7868]";
  }
}

function formatPrimaryActionLabel(action: ReturnType<typeof resolveTaskCardPrimaryAction>) {
  switch (action) {
    case "open-live-activity":
      return "Open live activity";
    case "view-result":
      return "View result";
    case "review-result":
      return "Review result";
    default:
      return "View details";
  }
}

function resolvePrimaryActionClass(action: ReturnType<typeof resolveTaskCardPrimaryAction>, surfaceTheme: "dark" | "light") {
  if (action === "review-result") {
    return surfaceTheme === "light"
      ? "bg-amber-600 text-white hover:bg-amber-700"
      : "bg-amber-300 text-amber-950 hover:bg-amber-200";
  }

  return surfaceTheme === "light"
    ? "bg-[#342820] text-white hover:bg-[#4b382d]"
    : "bg-white text-slate-950 hover:bg-slate-100";
}

function TaskMenuButton({
  icon: Icon,
  label,
  destructive = false,
  disabled = false,
  onClick,
  surfaceTheme
}: {
  icon: typeof MoreHorizontal;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
  surfaceTheme: "dark" | "light";
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
            ? surfaceTheme === "light"
              ? "text-rose-700 hover:bg-rose-50 hover:text-rose-800"
              : "text-rose-100 hover:bg-rose-400/10 hover:text-rose-50"
            : surfaceTheme === "light"
              ? "text-[#513f33] hover:bg-[#f8eee7] hover:text-[#2f241d]"
              : "text-slate-200 hover:bg-white/[0.06] hover:text-white"
      )}
      onClick={onClick}
    >
      <Icon className={cn("h-3.5 w-3.5", destructive ? (surfaceTheme === "light" ? "text-rose-500" : "text-rose-300") : (surfaceTheme === "light" ? "text-[#9b745d]" : "text-cyan-300"))} />
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
