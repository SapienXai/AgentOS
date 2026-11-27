"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { AlertTriangle, ArrowDown, Check, ChevronDown, Download, FileText, Loader2, ShieldCheck, Wrench } from "lucide-react";

import { AgentChatMessageContent } from "@/components/mission-control/agent-chat-message-content";
import { EmployeeAvatar } from "@/components/workforce/employee-avatar";
import { QuestionAnswer } from "@/components/operations/human-control-inbox";
import type { AgentRecord, AttentionItem, TaskDetailRecord } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";
import { buildTaskConversation, type TaskConversationEntry } from "./task-live-presentation";

type TaskLiveConversationProps = {
  visible: boolean;
  scroller: RefObject<HTMLDivElement | null>;
  closedOffset: RefObject<number | null>;
  entries: TaskConversationEntry[];
  attention: AttentionItem[];
  agent?: AgentRecord;
  agentName: string;
  loading: boolean;
  notice: string | null;
  emptyText: string;
  recovery?: ReactNode;
  history?: { taskId: string; dispatchId?: string; cursor: string | null };
  attempts?: ReactNode;
  onAttentionResolved: (id: string) => void;
};

export function TaskLiveConversation({
  visible, scroller, closedOffset, entries, attention, agent, agentName, loading, notice, emptyText,
  recovery, history, attempts, onAttentionResolved
}: TaskLiveConversationProps) {
  const latestScrollTop = useRef(0);
  const pinToEnd = useRef(true);
  const previousVisible = useRef(false);
  const prependHeight = useRef<number | null>(null);
  const [awayFromEnd, setAwayFromEnd] = useState(false);
  const [older, setOlder] = useState<TaskConversationEntry[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null | undefined>(undefined);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyAbort = useRef<AbortController | null>(null);
  const lastEntry = entries.at(-1);
  const contentVersion = `${entries.length}:${lastEntry?.id ?? ""}:${lastEntry?.text.length ?? 0}:${attention.length}:${older.length}`;

  useEffect(() => () => historyAbort.current?.abort(), []);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!visible || !element) {
      previousVisible.current = false;
      return;
    }
    if (prependHeight.current !== null) {
      element.scrollTop = latestScrollTop.current + element.scrollHeight - prependHeight.current;
      prependHeight.current = null;
    } else if (!previousVisible.current && closedOffset.current !== null) {
      element.scrollTop = closedOffset.current;
      pinToEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 3;
    } else if (pinToEnd.current) {
      element.scrollTop = element.scrollHeight;
    }
    latestScrollTop.current = element.scrollTop;
    previousVisible.current = true;
  }, [contentVersion, visible, scroller, closedOffset]);

  const cursor = olderCursor === undefined ? history?.cursor : olderCursor;
  const loadOlder = async () => {
    if (!history || !cursor || loadingOlder) return;
    const params = new URLSearchParams({ cursor });
    if (history.dispatchId) params.set("dispatchId", history.dispatchId);
    const controller = new AbortController();
    historyAbort.current = controller;
    setLoadingOlder(true);
    setHistoryError(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(history.taskId)}/stream?${params}`, {
        headers: { accept: "application/json" }, cache: "no-store", signal: controller.signal
      });
      if (!response.ok) throw new Error("Earlier messages could not be loaded. Try again.");
      const detail = await response.json() as TaskDetailRecord;
      const page = buildTaskConversation(detail.task, detail, [], []);
      if (scroller.current && visible) prependHeight.current = scroller.current.scrollHeight;
      setOlder((current) => [...page, ...current]);
      setOlderCursor(detail.taskHistory?.nextCursor ?? null);
    } catch (error) {
      if (!controller.signal.aborted) setHistoryError(error instanceof Error ? error.message : "Unable to load messages.");
    } finally {
      if (!controller.signal.aborted) setLoadingOlder(false);
    }
  };
  const currentIds = new Set(entries.map((entry) => entry.id));
  const past = older.filter((entry) => {
    if (currentIds.has(entry.id)) return false;
    currentIds.add(entry.id);
    return true;
  });

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        className="nowheel min-h-0 flex-1 select-text overflow-y-auto overscroll-contain px-3 pb-4 pt-3 [scrollbar-gutter:stable] sm:px-5"
        role="region"
        aria-label="Task conversation"
        tabIndex={visible ? 0 : -1}
        onScroll={(event) => {
          const element = event.currentTarget;
          if (!visible || !element.clientHeight) return;
          latestScrollTop.current = element.scrollTop;
          pinToEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 8;
          setAwayFromEnd(!pinToEnd.current);
        }}
      >
        {notice ? <p role="status" className="mb-3 rounded-xl bg-[var(--task-tool)] px-3 py-2 text-xs text-[var(--task-muted)]">{notice}</p> : null}
        {cursor ? (
          <div className="mb-3 text-center">
            <button type="button" disabled={loadingOlder} onClick={() => void loadOlder()} className="rounded-lg px-3 py-2 text-xs font-semibold text-[var(--task-accent)] hover:bg-[var(--task-tool)] disabled:opacity-60">
              {loadingOlder ? "Loading earlier messages…" : "Load earlier messages"}
            </button>
            {historyError ? <p role="alert" className="text-xs text-[var(--task-danger)]">{historyError}</p> : null}
          </div>
        ) : null}
        {attempts}
        {past.length || entries.length ? (
          <ol className="space-y-3" aria-label="Task messages and activity">
            {[...past, ...entries].map((entry) => <ConversationRow key={entry.id} entry={entry} agent={agent} agentName={agentName} />)}
          </ol>
        ) : !recovery && !attention.length ? (
          <div className="grid min-h-28 place-content-center text-center text-sm text-[var(--task-muted)]" role="status">
            {loading ? "Opening the task conversation…" : emptyText}
          </div>
        ) : null}
        {recovery ? <div className="mt-3">{recovery}</div> : null}
        {attention.map((item) => <TaskAttention key={item.id} item={item} onResolved={onAttentionResolved} />)}
      </div>
      {awayFromEnd ? (
        <button type="button" className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--task-line)] bg-[var(--task-surface)] px-3 py-1.5 text-xs font-semibold shadow-md hover:text-[var(--task-accent)]"
          onClick={() => {
            pinToEnd.current = true;
            if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
            setAwayFromEnd(false);
          }}
        ><ArrowDown aria-hidden="true" className="size-3.5" /> Latest activity</button>
      ) : null}
    </div>
  );
}

function ConversationRow({ entry, agent, agentName }: {
  entry: TaskConversationEntry; agent?: AgentRecord; agentName: string;
}) {
  const time = new Date(entry.timestamp);
  const label = Number.isNaN(time.getTime()) ? null : time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (entry.kind === "tool" || entry.kind === "artifact") {
    const isFile = entry.kind === "artifact";
    const Icon = isFile ? FileText : Wrench;
    const state = isFile ? entry.href ? "Download" : "File created" : entry.failed ? "Failed" : entry.toolPhase === "result" ? "Completed" : entry.streaming ? "Running" : "Started";
    const row = (
      <>
        <Icon className="size-4 shrink-0 text-[var(--task-muted)]" aria-hidden="true" />
        <div className="min-w-0 flex-1 truncate text-left text-[13px] font-semibold">{isFile ? entry.text : entry.title}</div>
        <span className={cn("shrink-0 text-[11px]", entry.failed ? "text-[var(--task-danger)]" : "text-[var(--task-muted)]")}>{state}</span>
        {isFile && entry.href ? <Download aria-hidden="true" className="size-3.5 shrink-0 text-[var(--task-accent)]" /> : null}
        {entry.durationMs && Number.isFinite(entry.durationMs) ? <span className="shrink-0 text-[11px] tabular-nums text-[var(--task-muted)]">{entry.durationMs < 100 ? "<0.1s" : `${(entry.durationMs / 1000).toFixed(1)}s`}</span> : null}
      </>
    );
    const rowClass = "flex min-h-10 w-full items-center gap-2.5 rounded-xl border border-[var(--task-line)] bg-[var(--task-tool)] px-3 py-2";
    return <li className="sm:ml-10">
      {isFile && entry.href ? (
        <a href={entry.href} download aria-label={`Download ${entry.text}`} className={cn(rowClass, "transition-colors hover:border-violet-500")}>{row}</a>
      ) : !isFile && entry.text ? (
        <details className="group/tool">
          <summary className={cn(rowClass, "cursor-pointer list-none transition-colors hover:border-violet-500 [&::-webkit-details-marker]:hidden")}>{row}<ChevronDown className="size-3.5 shrink-0 group-open/tool:rotate-180" aria-hidden="true" /></summary>
          <p className="whitespace-pre-wrap break-words px-3 pb-1 pt-2 text-xs text-[var(--task-muted)]">{entry.text}</p>
        </details>
      ) : <div className={rowClass}>{row}</div>}
    </li>;
  }

  const isUser = entry.kind === "user";
  return (
    <li className={cn("flex items-start gap-2.5", isUser && "justify-end")}>
      {!isUser ? <EmployeeAvatar agent={entry.agentId && entry.agentId !== agent?.id ? null : agent} name={agentName} className="mt-0.5 size-7 rounded-[9px] text-xs sm:size-8" /> : null}
      <div className={cn("min-w-0 max-w-[91%]", isUser ? "items-end" : "items-start")}>
        <p className={cn("mb-1 flex items-center gap-2 px-1 text-xs font-semibold", isUser && "justify-end")}>
          {isUser ? "You" : entry.agentId && entry.agentId !== agent?.id ? entry.title : agentName}
          {label ? <time dateTime={entry.timestamp} className="text-[11px] font-normal tabular-nums text-[var(--task-muted)]">{label}</time> : null}
        </p>
        <div data-task-message={entry.streaming ? "streaming" : undefined} className={cn("max-w-full rounded-2xl px-3 py-2 text-[14px] leading-[1.55] [overflow-wrap:anywhere]", isUser ? "bg-[var(--task-user)]" : "bg-[var(--task-message)]")}>
          {entry.streaming ? <p className="whitespace-pre-wrap">{entry.text}<span className="ml-1 inline-block h-[0.85em] w-0.5 rounded-full bg-[var(--task-accent)] motion-safe:animate-pulse" aria-hidden="true" /></p> :
            <AgentChatMessageContent text={entry.text} className="!leading-[1.55] !text-inherit" />}
        </div>
      </div>
    </li>
  );
}

function TaskAttention({ item, onResolved }: { item: AttentionItem; onResolved: (id: string) => void }) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const actions = item.availableActions.filter(({ id }) => id === "approve" || id === "deny" || id === "answer");

  const submit = async (action: string) => {
    setPending(action);
    setError(null);
    try {
      const response = await fetch("/api/human-control/action", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId: item.id, action, ...(action === "answer" ? { answers: { answers } } : {}) }) });
      const data = await response.json() as { error?: string; code?: string };
      if (response.status === 409 && data.code === "attention-mutation-uncertain") setUncertain(true);
      if (!response.ok) throw new Error(data.error || "OpenClaw could not confirm the decision.");
      onResolved(item.id);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to save the decision.");
    } finally {
      setPending(null);
    }
  };

  return (
    <section aria-label={item.title} className="mt-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.07] px-3 py-3 text-sm">
      <div className="flex items-center gap-2 font-semibold"><ShieldCheck aria-hidden="true" className="size-4 text-amber-600" />{item.title}</div>
      {item.type === "question" ? (
        <div className="mt-2"><QuestionAnswer item={item} answers={answers} onAnswerChange={(id, values) => setAnswers((current) => ({ ...current, [id]: values }))} /></div>
      ) : <p className="mt-1 break-words text-xs leading-relaxed text-[var(--task-muted)]">{item.summary}</p>}
      {error ? <p role="alert" className="mt-2 flex items-start gap-1.5 text-xs text-[var(--task-danger)]"><AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />{error}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {actions.map(({ id, label }) => <button key={id} type="button"
          disabled={pending !== null || uncertain || (id === "answer" && !item.question?.every((question) => answers[question.questionId]?.some((value) => value.trim())))}
          onClick={() => void submit(id)}
          className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors disabled:opacity-45", id === "deny" ? "border border-[var(--task-line)] hover:bg-[var(--task-tool)]" : "bg-violet-600 text-white hover:bg-violet-700")}
        >{pending === id ? <Loader2 aria-hidden="true" className="size-3.5 motion-safe:animate-spin" /> : id !== "deny" ? <Check aria-hidden="true" className="size-3.5" /> : null}{label}</button>)}
      </div>
    </section>
  );
}
