"use client";

import { useState, type ComponentType, type ReactNode, type Ref } from "react";
import { ChevronDown, Loader2, MessageSquare, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import {
  buildTaskFollowUpPrompt,
  resolveTaskFollowUpAvailability
} from "@/lib/openclaw/domains/task-follow-up";
import {
  resolveTaskFollowUpDisplayMessage,
  type TaskFollowUpRecord
} from "@/lib/openclaw/domains/task-follow-up-records";
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
  const message = resolveTaskFollowUpDisplayMessage(followUp) ?? followUp.message.trim();
  const displayMessage = message || "Follow-up";

  if (followUp.summary) {
    return [
      "Operator follow-up:",
      displayMessage,
      "",
      "Agent response:",
      followUp.summary
    ].join("\n");
  }

  if (isFollowUpTimeoutStatus(followUp.status)) {
    return [
      "Operator follow-up:",
      displayMessage,
      "",
      "No agent answer was captured before the OpenClaw wait window expired."
    ].join("\n");
  }

  return [
    "Operator follow-up:",
    displayMessage,
    "",
    `Accepted for continuation ${formatFollowUpTimestamp(followUp.createdAt)}.`,
    followUp.runId
      ? `OpenClaw run ${followUp.runId} is being tracked for this follow-up.`
      : "Waiting for the agent result to appear in the task feed and latest result."
  ].join("\n");
}

function isFollowUpTimeoutStatus(status: string | null | undefined) {
  const normalized = status?.trim().toLowerCase();
  return normalized === "timeout" || normalized === "timed_out" || normalized === "stalled" || normalized === "failed";
}

export function TaskMetricRow({
  metrics,
  className,
  compact = false,
  surface = "auto",
  density = "default"
}: {
  metrics: TaskMetricItem[];
  className?: string;
  compact?: boolean;
  surface?: "auto" | "dark";
  density?: "default" | "dense";
}) {
  const forceDark = surface === "dark";
  const dense = density === "dense";

  return (
    <div className={cn("flex flex-wrap items-center", dense ? "gap-1.5" : "gap-2.5", className)}>
      {metrics.map((metric, index) => {
        const Icon = metric.icon;
        const content = (
          <>
            <Icon
              className={cn(
                "shrink-0",
                dense ? "h-3 w-3" : "h-3.5 w-3.5",
                forceDark
                  ? metric.highlighted
                    ? "text-emerald-200"
                    : "text-slate-400"
                  : metric.highlighted
                    ? "text-emerald-700 dark:text-emerald-200"
                    : "text-muted-foreground dark:text-slate-400"
              )}
            />
            <span>{metric.label}</span>
            {metric.value !== undefined ? (
              <span
                className={cn(
                  "ml-0.5 inline-flex items-center justify-center font-mono",
                  dense
                    ? "min-w-4 rounded-[6px] px-1 py-0.5 text-[9px]"
                    : "min-w-5 rounded-full px-1.5 py-0.5 text-[10px]",
                  forceDark
                    ? metric.highlighted
                      ? "bg-emerald-300/[0.12] text-emerald-100"
                      : "bg-white/[0.06] text-slate-200"
                    : metric.highlighted
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-300/12 dark:text-emerald-100"
                      : "bg-muted text-foreground dark:bg-white/[0.06] dark:text-slate-200"
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
              metricPillClassName(metric, compact, surface, density),
              forceDark
                ? "transition-colors hover:border-cyan-200/24 hover:bg-white/[0.06] hover:text-slate-100"
                : "transition-colors hover:border-primary/20 hover:bg-accent/60 hover:text-foreground dark:hover:border-cyan-200/24 dark:hover:bg-white/[0.06] dark:hover:text-slate-100"
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
          <span key={`${metric.label}-${index}`} className={metricPillClassName(metric, compact, surface, density)}>
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
  compact = false,
  density = "default"
}: {
  title?: string;
  result: string | null | undefined;
  emptyText?: string;
  className?: string;
  compact?: boolean;
  density?: "default" | "dense";
}) {
  const [expanded, setExpanded] = useState(false);
  const normalizedResult = result?.trim() || emptyText;
  const preview = compactMissionText(normalizedResult, compact ? 150 : 260) || normalizedResult;
  const dense = density === "dense";

  return (
    <section
      className={cn(
        "border border-border bg-card shadow-[inset_0_1px_0_hsl(var(--border)/0.35)] dark:border-white/[0.08] dark:bg-slate-950/28 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]",
        dense ? "rounded-[12px] px-2.5 py-2" : "rounded-[16px] px-3 py-2.5",
        className
      )}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        aria-expanded={expanded}
        className={cn("flex w-full items-center justify-between text-left", dense ? "gap-2" : "gap-3")}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.6)]" />
          <span className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground dark:text-slate-400">
            {title}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "shrink-0 text-muted-foreground transition-transform dark:text-slate-400",
            dense ? "h-3.5 w-3.5" : "h-4 w-4",
            expanded && "rotate-180"
          )}
        />
      </button>
      <p
        className={cn(
          "mt-2 whitespace-pre-wrap text-foreground/85 dark:text-slate-200/90",
          dense ? "text-[11px] leading-[18px]" : compact ? "text-[11.5px] leading-5" : "text-sm leading-6",
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
  onExpandRequest,
  textareaRef,
  expanded = false,
  className,
  compact = false,
  density = "default"
}: {
  task: TaskRecord;
  latestResult?: string | null;
  createdFiles?: RuntimeCreatedFile[];
  outputSummary?: string | null;
  onSubmitted?: (followUp: SubmittedTaskFollowUp) => Promise<void> | void;
  onExpandRequest?: () => void;
  textareaRef?: Ref<HTMLTextAreaElement>;
  expanded?: boolean;
  className?: string;
  compact?: boolean;
  density?: "default" | "dense";
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
  const dense = density === "dense";

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
      toast.success("Follow-up accepted.", {
        description: "OpenClaw accepted the continuation. AgentOS will track the follow-up until live output arrives."
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
        "border border-border bg-card shadow-[inset_0_1px_0_hsl(var(--border)/0.35)] dark:border-cyan-200/14 dark:bg-slate-950/36 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        dense ? "rounded-[12px] p-1.5" : "rounded-[16px] p-2",
        expanded && "border-primary/20 bg-accent/50 dark:border-cyan-200/24 dark:bg-slate-950/46",
        className
      )}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className={cn("flex items-end", dense ? "gap-1.5" : "gap-2")}>
        <div className={cn(
          "flex flex-1 items-start gap-2 border border-border bg-background/60 transition-[min-height,border-color,background-color] duration-200 dark:border-white/[0.07] dark:bg-black/18",
          dense ? "min-h-9 rounded-[10px] px-2 py-1.5" : "min-h-11 rounded-[13px] px-2.5 py-2",
          expanded && (dense ? "min-h-12" : "min-h-14"),
          expanded && "border-primary/20 bg-background dark:border-cyan-200/20 dark:bg-black/24"
        )}>
          <MessageSquare
            className={cn(
              "mt-1 shrink-0 text-muted-foreground transition-transform duration-200 dark:text-slate-400",
              dense ? "h-3.5 w-3.5" : "h-4 w-4",
              expanded && "scale-110 text-primary dark:text-cyan-100"
            )}
          />
          <Textarea
            ref={textareaRef}
            value={message}
            maxLength={4000}
            disabled={submitting || !availability.available}
            placeholder="Ask a follow-up..."
            className={cn(
              "min-h-8 resize-none border-0 bg-transparent p-0 font-medium text-foreground caret-primary shadow-none placeholder:font-medium placeholder:text-muted-foreground focus-visible:ring-0 dark:text-slate-100 dark:caret-emerald-200 dark:placeholder:text-slate-400",
              dense ? "text-[13px] leading-5" : compact ? "text-base leading-7" : "text-[16px] leading-7",
              expanded && (dense ? "text-sm leading-6" : "text-[17px]")
            )}
            rows={expanded ? 3 : compact ? 1 : 2}
            title={availability.reason ?? undefined}
            onFocus={() => onExpandRequest?.()}
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
            "shrink-0 border border-primary/20 bg-primary text-primary-foreground shadow-[0_10px_24px_hsl(var(--primary)/0.16)] hover:bg-primary/90 dark:border-cyan-200/16 dark:bg-slate-800 dark:text-emerald-200 dark:shadow-[0_0_24px_rgba(45,212,191,0.08)] dark:hover:bg-slate-700 dark:hover:text-emerald-100",
            dense ? "h-9 w-9 rounded-[10px]" : "h-11 w-11 rounded-[13px]",
            disabled && "opacity-55"
          )}
          onClick={() => void submitFollowUp()}
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
      {availability.reason ? (
        <p className="mt-1.5 px-1 text-[10px] leading-4 text-amber-700 dark:text-amber-200/80">{availability.reason}</p>
      ) : null}
    </div>
  );
}

function metricPillClassName(
  metric: TaskMetricItem,
  compact: boolean,
  surface: "auto" | "dark",
  density: "default" | "dense" = "default"
) {
  const dense = density === "dense";

  if (surface === "dark") {
    return cn(
      "inline-flex min-w-0 items-center border font-medium",
      dense ? "gap-1 rounded-[9px] px-1.5 py-0.5 text-[9px]" : "gap-1.5 rounded-full",
      !dense && (compact ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-xs"),
      metric.highlighted
        ? "border-emerald-300/[0.18] bg-emerald-300/[0.07] text-emerald-100"
        : "border-white/[0.08] bg-white/[0.03] text-slate-300",
      metric.active && "border-cyan-200/25 bg-cyan-300/[0.08] text-cyan-100"
    );
  }

  return cn(
    "inline-flex min-w-0 items-center border font-medium",
    dense ? "gap-1 rounded-[9px] px-1.5 py-0.5 text-[9px]" : "gap-1.5 rounded-full",
    !dense && (compact ? "px-2 py-1 text-[10px]" : "px-3 py-1.5 text-xs"),
    metric.highlighted
      ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-300/18 dark:bg-emerald-300/[0.07] dark:text-emerald-100"
      : "border-border bg-muted/45 text-muted-foreground dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300",
    metric.active && "border-primary/25 bg-primary/10 text-primary dark:border-cyan-200/25 dark:bg-cyan-300/[0.08] dark:text-cyan-100"
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
