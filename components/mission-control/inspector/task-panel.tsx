"use client";

import type { HTMLAttributes, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

import { Badge as UiBadge, type BadgeProps } from "@/components/ui/badge";
import { shortId } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";
import type { InspectorTaskSessionView, PollingFallbackNotice } from "./inspector-utils";

const INSPECTOR_BADGE_CLASS_NAME =
  "!h-4 !px-1.5 !py-0 !text-[8px] !leading-none !tracking-[0.1em] !whitespace-nowrap";

function Badge({ className, ...props }: BadgeProps) {
  return <UiBadge {...props} className={cn(INSPECTOR_BADGE_CLASS_NAME, className)} />;
}

export function TaskSessionTruthPanel({
  view,
  pollingFallback
}: {
  view: InspectorTaskSessionView;
  pollingFallback: PollingFallbackNotice;
}) {
  const followUpReason = view.followUpAvailability.reason;
  const followUpWarning = view.followUpAvailability.warning;

  return (
    <section
      data-testid="inspector-task-session-truth"
      className="rounded-[18px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.88),rgba(8,13,24,0.84))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">Session truth</p>
          <h3 className="mt-1 truncate font-display text-[15px] text-white">OpenClaw task provenance</h3>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <Badge variant={confidenceBadgeVariant(view.sessionConfidence)} data-testid="inspector-follow-up-confidence">
            {view.sessionConfidenceLabel}
          </Badge>
          <Badge variant="muted">{view.provenanceLabel}</Badge>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <TruthRow
          label="OpenClaw task"
          value={view.openClawTaskId}
          detail={view.openClawTaskIdSource === "normalized-task" ? "normalized task record" : null}
        />
        <TruthRow label="Dispatch" value={view.dispatchId} />
        <TruthRow label="Session" value={formatIdList(view.sessionIds)} detail={view.sessionKey ? `key ${shortId(view.sessionKey, 14)}` : null} />
        <TruthRow label="Run" value={formatIdList(view.runIds)} />
        <TruthRow label="Runtime" value={formatIdList(view.runtimeIds)} />
        <TruthRow label="Workspace" value={view.workspaceName ?? view.workspaceId} detail={view.workspaceId} />
        <TruthRow label="Agent" value={view.agentName ?? view.agentId} detail={view.agentId} />
        <TruthRow label="Follow-up" value={view.followUpAvailability.available ? "available" : "disabled"} detail={followUpReason ?? followUpWarning} />
      </div>

      {followUpWarning ? (
        <Notice tone="warning" data-testid="inspector-follow-up-warning">
          {followUpWarning}
        </Notice>
      ) : null}

      {followUpReason ? (
        <Notice tone="warning" data-testid="inspector-follow-up-disabled-reason">
          {followUpReason}
        </Notice>
      ) : null}

      {pollingFallback.visible ? (
        <Notice tone="info" data-testid="inspector-polling-fallback">
          <span className="font-semibold">{pollingFallback.title}</span>
          {pollingFallback.message ? `: ${pollingFallback.message}` : null}
          {pollingFallback.recovery ? ` ${pollingFallback.recovery}` : null}
        </Notice>
      ) : null}
    </section>
  );
}

function TruthRow({ label, value, detail }: { label: string; value: string | null | undefined; detail?: string | null }) {
  const normalized = value?.trim() || "Not reported";

  return (
    <div className="min-w-0 rounded-[14px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
      <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1 truncate font-mono text-[11px] text-slate-100" title={normalized}>
        {compactTruthValue(normalized)}
      </p>
      {detail && detail !== normalized ? (
        <p className="mt-1 truncate text-[10px] text-slate-500" title={detail}>
          {detail}
        </p>
      ) : null}
    </div>
  );
}

function Notice({
  children,
  tone,
  ...props
}: {
  children: ReactNode;
  tone: "info" | "warning";
} & HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      {...props}
      className={cn(
        "mt-3 rounded-[12px] border px-3 py-2 text-[12px] leading-5",
        tone === "warning"
          ? "border-amber-400/20 bg-amber-400/10 text-amber-100"
          : "border-sky-300/18 bg-sky-300/10 text-sky-100",
        props.className
      )}
    >
      {tone === "warning" ? <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]" /> : null}
      {children}
    </p>
  );
}

function confidenceBadgeVariant(confidence: InspectorTaskSessionView["sessionConfidence"]): BadgeProps["variant"] {
  switch (confidence) {
    case "high":
      return "success";
    case "medium":
      return "warning";
    case "none":
      return "danger";
  }
}

function formatIdList(values: string[]) {
  if (values.length === 0) {
    return null;
  }

  return values.map((value) => shortId(value, 12)).join(", ");
}

function compactTruthValue(value: string) {
  if (value === "Not reported" || value.length <= 56) {
    return value;
  }

  return `${value.slice(0, 24)}...${value.slice(-20)}`;
}
