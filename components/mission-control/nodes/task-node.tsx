"use client";

import { Handle, Position, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import {
  AlertTriangle, Ban, CalendarClock, Check, CheckCircle2, Circle, Clock3, Copy,
  CornerDownLeft, EyeOff, FileText, Lock, LockOpen, MoreHorizontal, Pause, Play, RefreshCw, Square, Trash2, X
} from "lucide-react";
import { useReducedMotion } from "motion/react";
import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";

import type { TaskNodeData } from "@/components/mission-control/canvas-types";
import { InteractiveContent } from "@/components/mission-control/interactive-content";
import { resolveTaskNodeVisualTone } from "@/components/mission-control/node-visual-tones";
import { TaskFollowUpComposer, type SubmittedTaskFollowUp } from "@/components/mission-control/task-follow-up";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmployeeAvatar } from "@/components/workforce/employee-avatar";
import { useTaskFeed } from "@/hooks/use-task-feed";
import type { TaskFeedEvent } from "@/lib/agentos/contracts";
import { hasScopedTaskSession, resolveTaskFollowUpAvailability } from "@/lib/openclaw/domains/task-follow-up";
import { mergeTaskFollowUps, readTaskFollowUpsFromMetadata, resolveTaskFollowUpDisplayMessage } from "@/lib/openclaw/domains/task-follow-up-records";
import { cn } from "@/lib/utils";
import {
  buildTaskConversation, isSameTaskMessage, readTaskCardUpdate, readTaskFailure, resolveLiveTaskState, validTimestamp, type LiveTaskState
} from "./task-live-presentation";
import styles from "./task-live-card.module.css";

const TaskLiveConversation = dynamic(() => import("./task-live-conversation").then((module) => module.TaskLiveConversation), {
  loading: () => <p role="status" className="grid flex-1 place-content-center text-sm text-[var(--task-muted)]">Opening the task conversation…</p>
});

type TaskFlowNode = Node<TaskNodeData, "task">;
type OperationAction = "run" | "retry" | "pause" | "resume" | "delete";

const controlClass = "nodrag nopan inline-grid size-9 shrink-0 place-items-center rounded-xl border border-[var(--task-line)] text-[var(--task-muted)] outline-offset-2 transition-colors hover:bg-[var(--task-tool)] hover:text-[var(--task-text)] focus-visible:outline-2 focus-visible:outline-violet-500";
const recoveryClass = "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white transition-colors hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500";
const dateFormat: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

export function TaskNode({ id, data, selected }: NodeProps<TaskFlowNode>) {
  const flow = useReactFlow();
  const reduceMotion = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const collapseButton = useRef<HTMLButtonElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const conversationScroller = useRef<HTMLDivElement>(null);
  const closedScrollOffset = useRef<number | null>(null);
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [opened, setOpened] = useState(false);
  const [operationAction, setOperationAction] = useState<OperationAction | null>(null);
  const [localFollowUps, setLocalFollowUps] = useState<SubmittedTaskFollowUp[]>([]);
  const [resolvedAttention, setResolvedAttention] = useState<string[]>([]);
  const optimisticFeed = useMemo(() => readTaskFeedEvents(data.task.metadata.optimisticEvents), [data.task.metadata.optimisticEvents]);
  const shouldStreamFeed = expanded || selected;
  const { feed, detail, loading, error, streamNotice, assistantUpdates, toolUpdates, attention, artifacts } = useTaskFeed(data.task.id, shouldStreamFeed, {
    dispatchId: data.task.dispatchId,
    optimisticFeed,
    liveConversation: true
  });
  const task = detail && (expanded || (detail.task.updatedAt ?? 0) >= (data.task.updatedAt ?? 0)) ? detail.task : data.task;
  const pendingAttention = useMemo(() => attention.filter(({ id }) => !resolvedAttention.includes(id)), [attention, resolvedAttention]);
  const conversation = useMemo(() => buildTaskConversation(task, detail, feed, assistantUpdates, toolUpdates, artifacts), [task, detail, feed, assistantUpdates, toolUpdates, artifacts]);
  const followUps = useMemo(() => {
    const history = readTaskFollowUpsFromMetadata(task.metadata).filter((attempt) =>
      resolveTaskFollowUpDisplayMessage(attempt)?.trim() !== (task.mission ?? task.title).trim());
    return mergeTaskFollowUps(history, localFollowUps);
  }, [task.metadata, task.mission, task.title, localFollowUps]);
  const entries = useMemo(() => {
    const receipts = followUps.flatMap((followUp) => {
      const text = resolveTaskFollowUpDisplayMessage(followUp) ?? followUp.message;
      if (conversation.some((entry) => entry.kind === "user" && isSameTaskMessage(entry.text, entry.timestamp, text, followUp.createdAt))) return [];
      return [{ id: followUp.id, title: "You", kind: "user" as const, text, timestamp: followUp.createdAt }];
    });
    return receipts.length ? [...conversation, ...receipts].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)) : conversation;
  }, [conversation, followUps]);

  const failure = readTaskFailure(task, detail);
  const state = resolveLiveTaskState(task, detail, pendingAttention);
  const taskUpdate = readTaskCardUpdate(task, state, entries, pendingAttention, failure);
  const surfaceTheme = data.surfaceTheme ?? "dark";
  const agentName = task.primaryAgentName || data.employee?.name || "OpenClaw";
  const monitor = task.metadata.systemOwnedMonitor === "heartbeat" ? "Heartbeat"
    : task.metadata.systemOwnedMonitor === "skill-collection-review" ? "Skill Workshop" : null;
  const title = monitor ?? (task.mission?.trim() || task.title.trim() || "Untitled task");
  const available = resolveTaskFollowUpAvailability(task);
  const progress = state === "Running" || state === "Queued";
  const schedulable = typeof task.metadata.operationJobId === "string" ? task.metadata.operationJobId : null;
  const scheduleLabel = typeof task.metadata.scheduleLabel === "string" ? task.metadata.scheduleLabel : null;
  const schedulePaused = task.metadata.operationStatus === "paused";
  const hasFailedSchedule = Boolean(task.metadata.lastRunStatus === "error" || task.metadata.operationLastError);
  const canStop = data.onAbortTask && (task.status === "running" || task.status === "queued");
  const timeSource = task.metadata.dispatchSubmittedAt ?? task.metadata.startedAt ?? task.metadata.createdAt;
  const start = validTimestamp(typeof timeSource === "string" || typeof timeSource === "number" ? timeSource : null);
  const panelId = `task-live-${id}`;
  const headingId = `${panelId}-heading`;
  const tone = resolveTaskNodeVisualTone({
    status: task.status,
    isAborted: state === "Cancelled",
    completedNeedsReview: state === "Needs review",
    visibleReviewStatus: null,
    isJustCreated: Boolean(data.justCreated),
    isPendingCreation: Boolean(data.pendingCreation)
  });

  function openConversation() {
    setOpened(true);
    setExpanded(true);
    const pane = root.current?.closest(".react-flow");
    const internal = flow.getInternalNode(id);
    if (!pane || !internal) return;
    const view = pane.getBoundingClientRect();
    const rect = root.current?.getBoundingClientRect();
    const zoom = flow.getZoom();
    const mobile = view.width < 620;
    const width = Math.min(620, window.innerWidth - 40);
    const height = Math.min(590, window.innerHeight - 146);
    const fits = rect && rect.left >= view.left + 12 && rect.top >= view.top + 72 &&
      rect.left + width * zoom <= view.right - (view.width >= 1024 ? 68 : 16) && rect.top + height * zoom <= view.bottom - 24;
    if (fits && !mobile && zoom >= .75) return;
    const position = internal.internals.positionAbsolute;
    const targetZoom = Math.min(1, (view.width - 24) / width, (view.height - 32) / height);
    if (targetZoom >= .42) {
      void flow.setCenter(position.x + width / 2, position.y + height / 2, { zoom: targetZoom, duration: reduceMotion ? 0 : 250 });
    }
  }

  function closeConversation() {
    closedScrollOffset.current = conversationScroller.current?.scrollTop ?? null;
    setExpanded(false);
    requestAnimationFrame(() => expandButton.current?.focus({ preventScroll: true }));
  }

  useEffect(() => {
    if (expanded) collapseButton.current?.focus({ preventScroll: true });
  }, [expanded]);

  const operateSchedule = async (action: OperationAction) => {
    if (!schedulable || operationAction) return;
    if (action === "delete" && !window.confirm("Delete this schedule permanently? This removes the OpenClaw job and cannot be undone.")) return;
    setOperationAction(action);
    try {
      const response = await fetch("/api/operations", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, jobId: schedulable }) });
      const result = await response.json() as { error?: string };
      if (!response.ok || result.error) throw new Error(result.error || "OpenClaw rejected the schedule change.");
      await data.onRefresh?.();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Schedule action failed.");
    } finally {
      setOperationAction(null);
    }
  };

  const renderActions = (close: () => void) => {
    const run = (action: OperationAction) => { close(); void operateSchedule(action); };
    return (
      <>
        {data.onInspect ? <TaskMenuButton icon={FileText} label="Task details" surfaceTheme={surfaceTheme}
          onClick={() => { close(); data.onInspect?.(data.task, "overview"); }} /> : null}
        {data.onReviewTask && (state === "Needs review" || state === "Failed" || task.metadata.reviewStatus) ?
          <TaskMenuButton icon={state === "Needs review" ? AlertTriangle : CheckCircle2} label={task.metadata.reviewStatus ? "Review record" : "Review result"} surfaceTheme={surfaceTheme}
            onClick={() => { close(); data.onReviewTask?.(task); }} /> : null}
        {data.onReply && !monitor ? <TaskMenuButton icon={CornerDownLeft} label={state === "Failed" ? "Prepare retry" : "Reuse as new task"} surfaceTheme={surfaceTheme}
          onClick={() => { close(); if (expanded) closeConversation(); data.onReply?.(data.task); }} /> : null}
        {data.onCopyPrompt && !monitor ? <TaskMenuButton icon={Copy} label="Copy & edit prompt" surfaceTheme={surfaceTheme}
          onClick={() => { close(); if (expanded) closeConversation(); data.onCopyPrompt?.(data.task); }} /> : null}
        {schedulable ? <>
          <TaskMenuButton icon={Play} label="Run now" disabled={operationAction !== null || schedulePaused} surfaceTheme={surfaceTheme} onClick={() => run("run")} />
          {hasFailedSchedule ? <TaskMenuButton icon={RefreshCw} label="Retry failed run" disabled={operationAction !== null || schedulePaused} surfaceTheme={surfaceTheme} onClick={() => run("retry")} /> : null}
          <TaskMenuButton icon={schedulePaused ? Play : Pause} label={schedulePaused ? "Resume schedule" : "Pause schedule"} disabled={operationAction !== null} surfaceTheme={surfaceTheme} onClick={() => run(schedulePaused ? "resume" : "pause")} />
          <TaskMenuButton icon={Trash2} label="Delete schedule" disabled={operationAction !== null} destructive surfaceTheme={surfaceTheme} onClick={() => run("delete")} />
        </> : null}
        {canStop ? <TaskMenuButton icon={Ban} label="Stop task" destructive surfaceTheme={surfaceTheme} onClick={() => { close(); data.onAbortTask?.(data.task); }} /> : null}
        {data.onHide ? <TaskMenuButton icon={EyeOff} label="Hide task" surfaceTheme={surfaceTheme} onClick={() => { close(); data.onHide?.(data.task); }} /> : null}
        {data.onToggleLock ? <TaskMenuButton icon={data.locked ? LockOpen : Lock} label={data.locked ? "Unlock" : "Lock"} surfaceTheme={surfaceTheme}
          onClick={() => { close(); data.onToggleLock?.(data.task); }} /> : null}
      </>
    );
  };
  const recovery = failure && state === "Failed" ? (
    <div className="rounded-2xl border border-rose-500/30 bg-rose-500/[0.06] p-3 text-sm">
      <p className="flex items-center gap-2 font-semibold text-[var(--task-danger)]"><AlertTriangle aria-hidden="true" className="size-4" /> Task failed</p>
      <p className="mt-1 leading-relaxed text-[var(--task-muted)]">{failure.summary}</p>
      {failure.technical ? <details className="mt-2 text-xs"><summary className="cursor-pointer font-semibold">Technical details</summary>
        <p className="mt-1 break-all leading-relaxed text-[var(--task-muted)]">{failure.technical}</p></details> : null}
      {schedulable && hasFailedSchedule && !schedulePaused ? <button type="button" className={cn(recoveryClass, "mt-3")} disabled={operationAction !== null} onClick={() => void operateSchedule("retry")}>Retry failed run</button> :
        data.onReply && !schedulable ? <button type="button" className={cn(recoveryClass, "mt-3")} onClick={() => { closeConversation(); data.onReply?.(data.task); }}>
          <RefreshCw className="size-3.5" aria-hidden="true" />{failure.reasoning ? "Retry with Balanced" : "Prepare retry"}
        </button> : null}
    </div>
  ) : state === "Needs review" && data.onReviewTask ? (
    <button type="button" className={recoveryClass} onClick={() => data.onReviewTask?.(task)}>Review result</button>
  ) : null;
  const attempts = schedulable || (detail?.runs.length ?? 0) > 1 || followUps.length ? (
    <details className="mb-3 rounded-xl border border-[var(--task-line)] bg-[var(--task-surface)] text-xs">
      <summary className="cursor-pointer px-3 py-2.5 font-semibold">Run history</summary>
      <div className="px-3 pb-3">
        {schedulable ? <OperationRunTimeline entries={readOperationRunTimeline(task.metadata.operationFeed, task.metadata.operationRunHistory, task.metadata.operationRecoveryHistory)}
          nextRunAt={typeof task.metadata.nextRunAt === "string" ? task.metadata.nextRunAt : null}
          scheduleLabel={scheduleLabel} surfaceTheme={surfaceTheme} /> :
          <ul className="space-y-2">
            {detail?.runs.map((run, index) => <li key={run.id} className="flex items-center justify-between gap-3">
              <span>{run.source === "turn" ? "Attempt" : "Run"} {index + 1} · {run.status === "stalled" ? "Failed" : run.status === "completed" ? "Completed" : run.status}</span>
              <span className="text-[var(--task-muted)]">{formatTime(validTimestamp(run.updatedAt))}</span>
            </li>)}
            {followUps.map((attempt, index) => {
              const message = resolveTaskFollowUpDisplayMessage(attempt) ?? attempt.message;
              return <li key={attempt.id}>
                <details>
                  <summary className="cursor-pointer truncate py-1 font-semibold">Follow-up {index + 1} · {message}</summary>
                  {attempt.summary ? <p className="mt-1 whitespace-pre-wrap break-words text-[var(--task-muted)]">{attempt.summary}</p> : null}
                  {data.onInspect ? <button type="button" className="mt-1 rounded px-1 py-1 font-semibold text-[var(--task-accent)] hover:underline"
                    onClick={() => {
                      closeConversation();
                      data.onInspect?.(data.task, "result", { taskId: task.id, cardNumber: index + 2, followUpIndex: index,
                        runId: attempt.runId, sessionId: attempt.sessionId, status: attempt.status, createdAt: attempt.createdAt, message });
                    }}>Inspect this follow-up</button> : null}
                </details>
              </li>;
            })}
          </ul>}
        {schedulable && scheduleLabel ? <OperationScheduleControl jobId={schedulable} label={scheduleLabel}
          cronExpression={typeof task.metadata.cronExpression === "string" ? task.metadata.cronExpression : null}
          timezone={typeof task.metadata.timezone === "string" ? task.metadata.timezone : null}
          scheduleKind={task.metadata.recurrence === "at" || task.metadata.recurrence === "every" || task.metadata.recurrence === "cron" ? task.metadata.recurrence : null}
          triggerAt={typeof task.metadata.triggerAt === "string" ? task.metadata.triggerAt : null}
          intervalMs={typeof task.metadata.intervalMs === "number" ? task.metadata.intervalMs : null}
          surfaceTheme={surfaceTheme} onSaved={() => { void data.onRefresh?.(); }} /> : null}
      </div>
    </details>
  ) : null;

  return (
    <div ref={root} className={cn(styles.task, "relative max-w-[calc(100vw-40px)]", monitor ? "w-[206px]" : "w-[400px]")}
      data-task-theme={surfaceTheme} data-task-expanded={expanded} data-testid="live-task-node">
      <Handle type="target" id="target-left" position={Position.Left} className={cn("!size-2.5 !border-0", tone.handle)} />
      <div className={cn(styles.card, "relative grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-2.5 rounded-[18px] px-3.5 pb-3 pt-3", expanded && "invisible", !data.emphasis && !selected && "opacity-90")}
        data-selected={selected} inert={expanded}
        onPointerDown={(event) => { pressOrigin.current = { x: event.clientX, y: event.clientY }; }}
        onClick={(event) => {
          const origin = pressOrigin.current;
          if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 6 &&
              !(event.target instanceof Element && event.target.closest("button, a"))) openConversation();
        }}>
        <EmployeeAvatar agent={data.employee} name={agentName} className={cn("mt-0.5 size-10 rounded-[12px] text-xs", monitor && "size-7")} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{agentName}</span>
            <TaskStatus status={state} />
            <TaskActions>{renderActions}</TaskActions>
          </div>
          <button ref={expandButton} type="button" aria-expanded={expanded} aria-controls={opened ? panelId : undefined} aria-label={monitor ? "Expand monitor details" : `Open task conversation: ${title}`}
            className="nodrag nopan mt-0.5 block w-full rounded-md text-left outline-offset-4 focus-visible:outline-2 focus-visible:outline-violet-500"
            onClick={(event) => { event.stopPropagation(); openConversation(); }}>
            <h3 className="line-clamp-2 break-words text-[15px] font-semibold leading-snug tracking-[-.015em]">{title}</h3>
            <div className="mt-1.5 flex items-center gap-2 text-[13px] leading-5 text-[var(--task-muted)]">
              <p className="min-w-0 flex-1 truncate">{taskUpdate}</p>
              <TaskTiming start={start} updatedAt={task.updatedAt} active={progress} compact />
            </div>
          </button>
          {progress ? <TaskProgress queued={state === "Queued"} /> : null}
        </div>
      </div>

      {opened ? <section id={panelId} aria-labelledby={headingId} inert={!expanded} data-open={expanded}
        className={cn(styles.panel, "nodrag nopan nowheel absolute left-0 top-0 z-30 flex h-[min(590px,calc(100dvh-146px))] min-h-[240px] w-[min(620px,calc(100vw-40px))] flex-col overflow-hidden rounded-[22px]")}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); closeConversation(); } }}>
        <header className="shrink-0 border-b border-[var(--task-line)] px-3 pb-3 pt-3 sm:px-5 sm:pt-4">
          <div className="flex items-center gap-2.5">
            <EmployeeAvatar agent={data.employee} name={agentName} className="size-10 rounded-[12px] text-sm" />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold sm:text-base">{agentName}</span>
            {canStop ? <button type="button" aria-label="Stop task" title="Stop task" className={cn(controlClass, "text-[var(--task-danger)]")} onClick={() => data.onAbortTask?.(data.task)}><Square className="size-3.5" fill="currentColor" /></button> : null}
            <TaskActions>{renderActions}</TaskActions>
            <button ref={collapseButton} type="button" aria-label="Collapse task conversation" title="Collapse task conversation" className={controlClass} onClick={closeConversation}><X className="size-4" /></button>
          </div>
          <h3 id={headingId} className="mt-2.5 line-clamp-2 break-words text-[20px] font-semibold leading-tight tracking-[-.023em] sm:text-[23px]">{title}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--task-muted)]">
            <TaskStatus status={state} />
            {start ? <span className="inline-flex items-center gap-1.5"><CalendarClock aria-hidden="true" className="size-3.5" /> Started {formatTime(start)}</span> : null}
            <TaskTiming start={start} updatedAt={task.updatedAt} active={progress} />
          </div>
          {progress ? <TaskProgress queued={state === "Queued"} /> : null}
        </header>
        <TaskLiveConversation visible={expanded} scroller={conversationScroller} closedOffset={closedScrollOffset} entries={entries} attention={pendingAttention}
          agent={data.employee} agentName={agentName}
          loading={loading} notice={error ?? streamNotice}
          emptyText={state === "Queued" ? "The task is queued in OpenClaw." : state === "Running" ? "Waiting for the agent’s first update." : "OpenClaw has no messages for this task."}
          history={{ taskId: task.id, dispatchId: task.dispatchId, cursor: detail?.taskHistory?.nextCursor ?? null }}
          recovery={recovery} attempts={attempts} onAttentionResolved={(id) => setResolvedAttention((current) => [...current, id])} />
        {available.available && hasScopedTaskSession(available.context) && !failure?.reasoning && !monitor ? (
          <footer className="shrink-0 border-t border-[var(--task-line)] px-3 py-3 sm:px-5">
            <TaskFollowUpComposer task={task} liveConversation submitLabel="Send task instruction" textareaRef={textarea}
              onSubmitted={(followUp) => setLocalFollowUps((current) => mergeTaskFollowUps(current, [followUp]))} />
          </footer>
        ) : null}
      </section> : null}
    </div>
  );
}

function TaskActions({ children }: { children: (dismiss: () => void) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as globalThis.Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <div ref={ref} className="nodrag nopan relative shrink-0" onKeyDown={(event) => {
      if (event.key !== "Escape" || !open) return;
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }}>
      <button ref={trigger} type="button" aria-expanded={open} aria-label="Task actions"
        className={cn(controlClass, "size-8 border-transparent")} onClick={(event) => { event.stopPropagation(); setOpen(!open); }}><MoreHorizontal className="size-[18px]" /></button>
      {open ? <div className="absolute right-0 top-[calc(100%+5px)] z-40 w-[178px] rounded-xl border border-[var(--task-line)] bg-[var(--task-surface)] p-1.5 shadow-lg"
        onClick={(event) => event.stopPropagation()}>{children(() => setOpen(false))}</div> : null}
    </div>
  );
}

function TaskStatus({ status }: { status: LiveTaskState }) {
  const success = status === "Running" || status === "Completed";
  const warning = status === "Needs approval" || status === "Blocked" || status === "Needs review";
  const failed = status === "Failed";
  const Icon = status === "Completed" ? Check : failed || warning ? AlertTriangle : Circle;
  return <span className={cn("inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold leading-none",
    success ? "bg-[var(--task-good-bg)] text-[var(--task-good)]" : warning ? "bg-[var(--task-warn-bg)] text-[var(--task-warn)]" :
      failed ? "bg-[var(--task-bad-bg)] text-[var(--task-danger)]" : "bg-[var(--task-tool)] text-[var(--task-muted)]")}>
    <Icon className={cn("size-3 shrink-0", status === "Running" && "size-2 fill-current")} aria-hidden="true" />{status}
  </span>;
}

function TaskProgress({ queued }: { queued: boolean }) {
  return <div role="progressbar" aria-label={queued ? "Waiting for task start" : "Task in progress"} data-queued={queued} className={cn(styles.progress, "mt-2.5")} />;
}

function TaskTiming({ start, updatedAt, active, compact = false }: { start: string | null; updatedAt: number | null; active: boolean; compact?: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!active || !start) return;
    const update = () => setNow(Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [active, start]);
  const end = active && now ? now : Date.parse(validTimestamp(updatedAt) ?? "");
  if (!start || !Number.isFinite(end)) return null;
  const elapsed = Math.max(0, Math.floor((end - Date.parse(start)) / 1000));
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor(elapsed / 60) % 60;
  const seconds = elapsed % 60;
  return <span className="inline-flex shrink-0 items-center gap-1 tabular-nums text-[var(--task-muted)]" title="Elapsed time">
    {!compact ? <Clock3 className="size-3.5" aria-hidden="true" /> : null}
    {hours > 0 ? `${hours}h ${minutes}m` : minutes > 0 ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`}
  </span>;
}

function formatTime(value: string | null) {
  return value ? new Date(value).toLocaleTimeString("en-US", dateFormat) : null;
}

function readTaskFeedEvents(value: unknown): TaskFeedEvent[] {
  return Array.isArray(value) ? value.filter((item): item is TaskFeedEvent => Boolean(item && typeof item === "object" && typeof item.id === "string" && typeof item.detail === "string" && typeof item.timestamp === "string")) : [];
}

type OperationRunTimelineEntry = {
  id: string;
  at: string;
  status: "completed" | "failed" | "skipped" | "missed" | "recovered";
  detail: string;
};

function OperationRunTimeline({ entries, nextRunAt, scheduleLabel, surfaceTheme }: {
  entries: OperationRunTimelineEntry[];
  nextRunAt: string | null;
  scheduleLabel: string | null;
  surfaceTheme: "dark" | "light";
}) {
  const isLight = surfaceTheme === "light";
  return (
    <div className={cn("mb-2 rounded-[11px] border px-2.5 py-2.5", isLight ? "border-[#eadbd0] bg-[#fffcf9]" : "border-white/[0.08] bg-white/[0.025]")}>
      <div className="flex items-center justify-between gap-3">
        <div><p className={cn("text-[10px] font-semibold", isLight ? "text-[#514136]" : "text-slate-200")}>Run history</p><p className={cn("mt-0.5 text-[9px]", isLight ? "text-[#9b745d]" : "text-slate-500")}>{scheduleLabel ?? "OpenClaw schedule"}</p></div>
        {nextRunAt ? <span className={cn("rounded-full border px-2 py-1 text-[9px]", isLight ? "border-primary/20 bg-primary/5 text-[#806856]" : "border-primary/20 bg-primary/10 text-primary")}>Next {formatTimelineDate(nextRunAt)}</span> : null}
      </div>
      {entries.length === 0 ? <p className={cn("mt-3 text-[10px]", isLight ? "text-[#806856]" : "text-slate-400")}>No completed run has been reported by OpenClaw yet.</p> : (
        <ScrollArea className="mt-3 h-[150px] w-full pr-3">
          <div className="space-y-2.5">
            {entries.map((entry) => <div key={entry.id} className="relative pl-3"><span className={cn("absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full", entry.status === "failed" ? "bg-rose-400" : entry.status === "skipped" || entry.status === "missed" ? "bg-amber-400" : "bg-emerald-400")} /><div className="flex items-baseline justify-between gap-2"><span className={cn("text-[10px] font-medium", isLight ? "text-[#514136]" : "text-slate-200")}>{entry.status === "failed" ? "Failed" : entry.status === "skipped" ? "Skipped" : entry.status === "missed" ? "Possible missed run" : entry.status === "recovered" ? "Recovered automatically" : "Completed"}</span><span className={cn("shrink-0 text-[9px]", isLight ? "text-[#9b745d]" : "text-slate-500")}>{formatTimelineDate(entry.at)}</span></div><InteractiveContent text={entry.detail} className={cn("mt-0.5 text-[10px] leading-relaxed", isLight ? "text-[#806958]" : "text-slate-400")} compact /></div>)}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function readOperationRunTimeline(feedValue: unknown, runHistoryValue: unknown, recoveryHistoryValue: unknown): OperationRunTimelineEntry[] {
  const entries: OperationRunTimelineEntry[] = readTaskFeedEvents(feedValue).map((event) => ({ id: event.id, at: event.timestamp, status: "completed", detail: event.detail }));
  if (Array.isArray(runHistoryValue)) {
    for (const value of runHistoryValue) {
      if (!value || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      const status = record.status;
      if (status !== "error" && status !== "skipped") continue;
      const at = typeof record.timestamp === "string" ? record.timestamp : null;
      if (!at) continue;
      entries.push({
        id: typeof record.id === "string" ? `run:${record.id}` : `run:${at}:${status}`,
        at,
        status: status === "error" ? "failed" : "skipped",
        detail: typeof record.error === "string" && record.error.trim() ? record.error : status === "error" ? "OpenClaw reported a failed run without an error detail." : "OpenClaw skipped this scheduled run."
      });
    }
  }
  if (Array.isArray(recoveryHistoryValue)) {
    for (const value of recoveryHistoryValue) {
      if (!value || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      if (record.status !== "missed" && record.status !== "recovered") continue;
      if (typeof record.id !== "string" || typeof record.timestamp !== "string" || typeof record.detail !== "string") continue;
      entries.push({ id: record.id, at: record.timestamp, status: record.status, detail: record.detail });
    }
  }
  return Array.from(new Map(entries.map((entry) => [entry.id, entry])).values()).sort((left, right) => Date.parse(right.at) - Date.parse(left.at)).slice(0, 24);
}

function formatTimelineDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown time" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function OperationScheduleControl({ jobId, label, cronExpression, timezone, scheduleKind, triggerAt, intervalMs, surfaceTheme, onSaved }: {
  jobId: string; label: string; cronExpression: string | null; timezone: string | null; scheduleKind: "at" | "every" | "cron" | null; triggerAt: string | null; intervalMs: number | null; surfaceTheme: "dark" | "light"; onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const controlRef = useRef<HTMLDivElement | null>(null);
  const [recurrence, setRecurrence] = useState<"weekdays" | "daily" | "weekly" | "custom">(inferRecurrence(cronExpression));
  const [time, setTime] = useState(inferCronTime(cronExpression));
  const [customCron, setCustomCron] = useState(cronExpression ?? "0 9 * * 1-5");
  const [zone, setZone] = useState(timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"));
  const [atValue, setAtValue] = useState(toDateTimeLocalValue(triggerAt));
  const [intervalSeconds, setIntervalSeconds] = useState(String(Math.max(1, Math.round((intervalMs ?? 60_000) / 1_000))));
  const [kind, setKind] = useState<"at" | "every" | "cron">(scheduleKind ?? "cron");
  const isLight = surfaceTheme === "light";
  const panelClass = isLight
    ? "border-[#dfcfc3] bg-[#fffcf9] text-[#46352b] shadow-[0_16px_34px_rgba(79,55,39,0.16)]"
    : "border-white/[0.1] bg-[#17111a] text-slate-100 shadow-[0_16px_34px_rgba(0,0,0,0.4)]";
  const mutedTextClass = isLight ? "text-slate-500" : "text-slate-400";
  const inputClass = isLight
    ? "border-[#e7d9cf] bg-white text-[#46352b] focus:border-primary/45"
    : "border-white/[0.1] bg-white/[0.05] text-slate-100 focus:border-primary/50 focus:bg-white/[0.08]";
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof globalThis.Node) || !controlRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
  }, [open]);
  const save = async () => {
    let trigger: { kind: "every"; everyMs: number } | { kind: "at"; at: string } | { kind: "cron"; expression: string; timezone?: string };
    if (kind === "every") {
      const everyMs = Number(intervalSeconds) * 1_000;
      if (!Number.isFinite(everyMs) || everyMs < 1_000) return;
      trigger = { kind: "every", everyMs };
    } else if (kind === "at") {
      if (!atValue || Number.isNaN(Date.parse(atValue))) return;
      trigger = { kind: "at", at: new Date(atValue).toISOString() };
    } else {
      const expression = recurrence === "custom" ? customCron.trim() : recurringCron(recurrence, time);
      if (!expression) return;
      trigger = { kind: "cron", expression, timezone: zone.trim() || undefined };
    }
    setSaving(true);
    try {
      const response = await fetch("/api/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", jobId, trigger }) });
      const result = await response.json() as { error?: string };
      if (!response.ok || result.error) throw new Error(result.error || "OpenClaw rejected the schedule update.");
      setOpen(false);
      onSaved();
    } catch (error) { window.alert(error instanceof Error ? error.message : "Schedule update failed."); }
    finally { setSaving(false); }
  };
  return (
    <div ref={controlRef} className="nodrag nopan relative">
      <button type="button" title={label} onClick={(event) => { event.stopPropagation(); setOpen((current) => !current); }} onPointerDown={(event) => event.stopPropagation()} className="inline-flex h-8 max-w-[138px] items-center gap-1.5 rounded-[9px] border border-primary/35 bg-primary/10 px-2 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/16">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Schedule</span>
      </button>
      {open ? <div onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} className={cn("absolute bottom-[calc(100%+8px)] right-0 z-[80] w-[320px] rounded-[13px] border p-3", panelClass)}>
        <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-semibold">Change schedule</p><p className={cn("mt-0.5 text-[9px]", mutedTextClass)}>{label}</p></div><CalendarClock className={cn("h-4 w-4", isLight ? "text-[#9b745d]" : "text-primary/80")} /></div>
        <div className={cn("mt-2.5 grid grid-cols-3 gap-1 rounded-[9px] border p-1", isLight ? "border-[#e7d9cf] bg-white" : "border-white/[0.08] bg-black/15")}>
          <ScheduleEditChoice label="Once" active={kind === "at"} onClick={() => setKind("at")} surfaceTheme={surfaceTheme} />
          <ScheduleEditChoice label="Interval" active={kind === "every"} onClick={() => setKind("every")} surfaceTheme={surfaceTheme} />
          <ScheduleEditChoice label="Recurring" active={kind === "cron"} onClick={() => setKind("cron")} surfaceTheme={surfaceTheme} />
        </div>
        <div className="mt-2.5">
          {kind === "every" ? <label className="block"><span className={cn("text-[9px] font-semibold uppercase tracking-[0.12em]", mutedTextClass)}>Repeat every</span><div className="mt-1.5 flex items-center gap-2"><input aria-label="Interval in seconds" type="number" min="1" value={intervalSeconds} onChange={(event) => setIntervalSeconds(event.target.value)} className={cn("h-9 w-20 rounded-[9px] border px-2 text-[11px] outline-none", inputClass)} /><span className={cn("text-[11px]", mutedTextClass)}>seconds</span></div></label> : null}
          {kind === "at" ? <label className="block"><span className={cn("text-[9px] font-semibold uppercase tracking-[0.12em]", mutedTextClass)}>Run at</span><input aria-label="One-time run date and time" type="datetime-local" value={atValue} onChange={(event) => setAtValue(event.target.value)} className={cn("mt-1.5 h-9 w-full rounded-[9px] border px-2 text-[11px] outline-none", inputClass)} /></label> : null}
          {kind === "cron" ? <><div className="grid grid-cols-4 gap-1"><ScheduleEditChoice label="Weekdays" active={recurrence === "weekdays"} onClick={() => setRecurrence("weekdays")} surfaceTheme={surfaceTheme} /><ScheduleEditChoice label="Daily" active={recurrence === "daily"} onClick={() => setRecurrence("daily")} surfaceTheme={surfaceTheme} /><ScheduleEditChoice label="Monday" active={recurrence === "weekly"} onClick={() => setRecurrence("weekly")} surfaceTheme={surfaceTheme} /><ScheduleEditChoice label="Custom" active={recurrence === "custom"} onClick={() => setRecurrence("custom")} surfaceTheme={surfaceTheme} /></div>{recurrence === "custom" ? <input aria-label="Custom cron expression" value={customCron} onChange={(event) => setCustomCron(event.target.value)} placeholder="Cron expression" className={cn("mt-2 h-8 w-full rounded-[8px] border px-2 text-[10px] outline-none", inputClass)} /> : <div className="mt-2 flex items-center gap-2"><span className={cn("text-[10px]", mutedTextClass)}>At</span><input aria-label="Recurring run time" type="time" value={time} onChange={(event) => setTime(event.target.value)} className={cn("h-8 flex-1 rounded-[8px] border px-2 text-[10px] outline-none", inputClass)} /></div>}<input aria-label="Schedule timezone" value={zone} onChange={(event) => setZone(event.target.value)} placeholder="Timezone" className={cn("mt-2 h-8 w-full rounded-[8px] border px-2 text-[10px] outline-none", inputClass)} /></> : null}
        </div>
        <div className="mt-3 flex items-center justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className={cn("h-8 rounded-[8px] px-2.5 text-[10px] font-medium transition-colors", isLight ? "text-[#806856] hover:bg-[#f8f0ea]" : "text-slate-400 hover:bg-white/[0.06]")}>Cancel</button><button type="button" disabled={saving} onClick={() => void save()} className="h-8 rounded-[8px] bg-primary px-3 text-[10px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Saving…" : "Save changes"}</button></div>
      </div> : null}
    </div>
  );
}

function ScheduleEditChoice({ label, active, onClick, surfaceTheme }: { label: string; active: boolean; onClick: () => void; surfaceTheme: "dark" | "light" }) { return <button type="button" onClick={onClick} className={cn("h-7 rounded-[6px] border px-1 text-center text-[9px] font-medium transition-colors", active ? "border-primary/35 bg-primary/10 text-primary" : surfaceTheme === "light" ? "border-transparent text-[#806856] hover:bg-[#f8f0ea] hover:text-[#46352b]" : "border-transparent text-slate-400 hover:bg-white/[0.06] hover:text-slate-200")}>{label}</button>; }
function inferRecurrence(value: string | null) { if (value?.endsWith("1-5")) return "weekdays"; if (value?.endsWith(" *")) return "daily"; if (value?.endsWith(" 1")) return "weekly"; return "custom"; }
function inferCronTime(value: string | null) { const parts = value?.trim().split(/\s+/) ?? []; return parts.length >= 2 ? `${String(parts[1]).padStart(2, "0")}:${String(parts[0]).padStart(2, "0")}` : "09:00"; }
function recurringCron(recurrence: "weekdays" | "daily" | "weekly" | "custom", time: string) { const [hour = "9", minute = "0"] = time.split(":"); return recurrence === "daily" ? `${Number(minute)} ${Number(hour)} * * *` : recurrence === "weekly" ? `${Number(minute)} ${Number(hour)} * * 1` : `${Number(minute)} ${Number(hour)} * * 1-5`; }
function toDateTimeLocalValue(value: string | null) { if (!value || Number.isNaN(Date.parse(value))) return ""; const date = new Date(value); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }

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
