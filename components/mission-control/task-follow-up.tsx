"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { ChevronDown, Loader2, MessageSquare, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import {
  buildTaskFollowUpPrompt,
  resolveTaskFollowUpAvailability
} from "@/lib/openclaw/domains/task-follow-up";
import type { TaskFollowUpRecord } from "@/lib/openclaw/domains/task-follow-up-records";
import type { RuntimeCreatedFile, TaskRecord } from "@/lib/openclaw/types";
import { compactMissionText } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

export type TaskMetricItem = {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value?: ReactNode;
  active?: boolean;
  highlighted?: boolean;
  onClick?: () => void;
};

export type SubmittedTaskFollowUp = TaskFollowUpRecord;

export function formatFollowUpDetail(followUp: SubmittedTaskFollowUp) {
  if (followUp.summary) {
    return [
      "Operator follow-up:",
      followUp.message,
      "",
      "Agent response:",
      followUp.summary
    ].join("\n");
  }

  return [
    "Operator follow-up:",
    followUp.message,
    "",
    `Sent ${formatFollowUpTimestamp(followUp.createdAt)}.`,
    followUp.runId
      ? `OpenClaw run ${followUp.runId} is being tracked for this follow-up.`
      : "Waiting for the agent result to appear in the task feed and latest result."
  ].join("\n");
}

export function TaskMetricRow({
  metrics,
  className,
  compact = false
}: {
  metrics: TaskMetricItem[];
  className?: string;
  compact?: boolean;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2.5", className)}>
      {metrics.map((metric, index) => {
        const Icon = metric.icon;
        const content = (
          <>
            <Icon className={cn("h-3.5 w-3.5 shrink-0", metric.highlighted ? "text-emerald-200" : "text-slate-400")} />
            <span>{metric.label}</span>
            {metric.value !== undefined ? (
              <span
                className={cn(
                  "ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 font-mono text-[10px]",
                  metric.highlighted
                    ? "bg-emerald-300/12 text-emerald-100"
                    : "bg-white/[0.06] text-slate-200"
                )}
              >
                {metric.value}
              </span>
            ) : null}
          </>
        );

        return metric.onClick ? (
          <button
            key={`${metric.label}-${index}`}
            type="button"
            className={cn(
              metricPillClassName(metric, compact),
              "transition-colors hover:border-cyan-200/24 hover:bg-white/[0.06] hover:text-slate-100"
            )}
            onClick={(event) => {
              event.stopPropagation();
              metric.onClick?.();
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {content}
          </button>
        ) : (
          <span key={`${metric.label}-${index}`} className={metricPillClassName(metric, compact)}>
            {content}
          </span>
        );
      })}
    </div>
  );
}

export function ExpandableTaskResult({
  title = "Latest result",
  result,
  emptyText = "No result has been captured for this task yet.",
  className,
  compact = false
}: {
  title?: string;
  result: string | null | undefined;
  emptyText?: string;
  className?: string;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const normalizedResult = result?.trim() || emptyText;
  const preview = compactMissionText(normalizedResult, compact ? 150 : 260) || normalizedResult;

  return (
    <section
      className={cn(
        "rounded-[16px] border border-white/[0.08] bg-slate-950/28 px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
        className
      )}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.6)]" />
          <span className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            {title}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-slate-400 transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>
      <p
        className={cn(
          "mt-2 whitespace-pre-wrap text-slate-200/90",
          compact ? "text-[11.5px] leading-5" : "text-sm leading-6",
          expanded ? "max-h-56 overflow-y-auto pr-2" : "line-clamp-2"
        )}
      >
        {expanded ? normalizedResult : preview}
      </p>
    </section>
  );
}

export function TaskFollowUpComposer({
  task,
  latestResult,
  createdFiles,
  outputSummary,
  onSubmitted,
  className,
  compact = false
}: {
  task: TaskRecord;
  latestResult?: string | null;
  createdFiles?: RuntimeCreatedFile[];
  outputSummary?: string | null;
  onSubmitted?: (followUp: SubmittedTaskFollowUp) => Promise<void> | void;
  className?: string;
  compact?: boolean;
}) {
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const availability = resolveTaskFollowUpAvailability(task);
  const trimmedMessage = message.trim();
  const disabledReason =
    availability.reason ||
    (submitting ? "Follow-up is being sent." : null) ||
    (!trimmedMessage ? "Enter a follow-up before sending." : null);
  const disabled = Boolean(disabledReason);

  const submitFollowUp = async () => {
    if (disabled || submitting) {
      return;
    }

    setSubmitting(true);

    try {
      const prompt = buildTaskFollowUpPrompt({
        task,
        operatorMessage: trimmedMessage,
        latestResult,
        createdFiles,
        outputSummary
      });
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "continue",
          message: prompt,
          dispatchId: task.dispatchId ?? null
        })
      });
      const payload = (await response.json().catch(() => null)) as TaskControlApiResponse | null;

      if (!response.ok || payload?.error) {
        throw new Error(payload?.error || "Unable to send follow-up.");
      }

      const continuation = readTaskControlContinuation(payload);
      setMessage("");
      const followUp = {
        id: `follow-up:${task.id}:${Date.now()}`,
        message: trimmedMessage,
        prompt,
        createdAt: new Date().toISOString(),
        taskId: continuation.taskId,
        dispatchId: task.dispatchId ?? null,
        runId: continuation.runId,
        sessionId: continuation.sessionId,
        status: continuation.status,
        summary: continuation.summary
      };
      toast.success("Follow-up sent.", {
        description: "AgentOS will continue this task in the existing OpenClaw context."
      });
      await onSubmitted?.(followUp);
    } catch (error) {
      toast.error("Follow-up failed.", {
        description: error instanceof Error ? error.message : "Unknown task continuation error."
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className={cn(
        "rounded-[16px] border border-cyan-200/14 bg-slate-950/36 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        className
      )}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex items-end gap-2">
        <div className="flex min-h-11 flex-1 items-start gap-2 rounded-[13px] border border-white/[0.07] bg-black/18 px-2.5 py-2">
          <MessageSquare className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
          <Textarea
            value={message}
            maxLength={4000}
            disabled={submitting || !availability.available}
            placeholder="Ask a follow-up..."
            className={cn(
              "min-h-8 resize-none border-0 bg-transparent p-0 font-medium text-slate-100 caret-emerald-200 shadow-none placeholder:font-medium placeholder:text-slate-400 focus-visible:ring-0",
              compact ? "text-base leading-7" : "text-[16px] leading-7"
            )}
            rows={compact ? 1 : 2}
            title={availability.reason ?? undefined}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submitFollowUp();
              }
            }}
          />
        </div>
        <Button
          type="button"
          size="icon"
          disabled={disabled}
          title={disabledReason ?? "Send follow-up"}
          className={cn(
            "h-11 w-11 shrink-0 rounded-[13px] border border-cyan-200/16 bg-slate-800 text-emerald-200 shadow-[0_0_24px_rgba(45,212,191,0.08)] hover:bg-slate-700 hover:text-emerald-100",
            disabled && "opacity-55"
          )}
          onClick={() => void submitFollowUp()}
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      {availability.reason ? (
        <p className="mt-1.5 px-1 text-[10px] leading-4 text-amber-200/80">{availability.reason}</p>
      ) : null}
    </div>
  );
}

function metricPillClassName(metric: TaskMetricItem, compact: boolean) {
  return cn(
    "inline-flex min-w-0 items-center gap-1.5 rounded-full border font-medium",
    compact ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-xs",
    metric.highlighted
      ? "border-emerald-300/18 bg-emerald-300/[0.07] text-emerald-100"
      : "border-white/[0.08] bg-white/[0.03] text-slate-300",
    metric.active && "border-cyan-200/25 bg-cyan-300/[0.08] text-cyan-100"
  );
}

function formatFollowUpTimestamp(value: string) {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return "just now";
  }

  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

type TaskControlApiResponse = {
  error?: string;
  result?: {
    taskId?: string;
    target?: {
      sessionId?: string | null;
      sessionKey?: string | null;
      runId?: string | null;
    };
    result?: Record<string, unknown>;
  };
};

function readTaskControlContinuation(payload: TaskControlApiResponse | null) {
  const control = payload?.result;
  const result = control?.result ?? {};

  return {
    taskId: readString(control?.taskId),
    runId: readString(result.runId) ?? readString(control?.target?.runId),
    sessionId: readString(result.sessionId) ?? readString(control?.target?.sessionId) ?? readString(control?.target?.sessionKey),
    status: readString(result.status),
    summary: readString(result.summary) ?? readPayloadSummary(result)
  };
}

function readPayloadSummary(result: Record<string, unknown>) {
  const payloads = Array.isArray(result.payloads)
    ? result.payloads
    : isRecord(result.result) && Array.isArray(result.result.payloads)
      ? result.result.payloads
      : [];
  const text = payloads
    .map((entry) => (isRecord(entry) ? readString(entry.text) : null))
    .filter((entry): entry is string => Boolean(entry))
    .join("\n")
    .trim();

  return text || null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
