"use client";

import { AlertTriangle, CheckCircle2, Clock3, History, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { MissionControlSnapshot, TaskHealthSummary, TaskRunIssueGroup } from "@/lib/agentos/contracts";
import { formatRelativeTime, resolveRelativeTimeReferenceMs, shortId } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";
import { KeyValue, SectionCard, StatusBadge, type StatusTone } from "@/components/operations/operations-ui";

export function TaskHealthCard({
  snapshot,
  title = "Task Health",
  compact = false,
  showGroups = false,
  onRefresh
}: {
  snapshot: MissionControlSnapshot;
  title?: string;
  compact?: boolean;
  showGroups?: boolean;
  onRefresh?: () => Promise<void> | void;
}) {
  const health = snapshot.diagnostics.taskHealth;

  if (!health) {
    return (
      <SectionCard title={title}>
        <div className="p-3">
          <TaskHealthNotice
            tone="muted"
            title="Task health unavailable"
            detail="OpenClaw did not report task health fields in this snapshot."
          />
        </div>
      </SectionCard>
    );
  }

  const tone = resolveTaskHealthTone(health);
  const historicalLabel = formatHistoricalLabel(health);
  const auditLabel = health.audit.state === "clean" ? "Clean" : health.audit.state === "findings" ? "Findings" : "Unknown";

  return (
    <SectionCard
      title={title}
      action={
        onRefresh ? (
          <Button variant="secondary" size="sm" className="h-7 rounded-lg px-2 text-[0.68rem]" onClick={() => void onRefresh()}>
            <RotateCw className="mr-1.5 h-3 w-3" />
            Recheck
          </Button>
        ) : null
      }
    >
      <div className="space-y-3 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {tone === "success" ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <AlertTriangle className={cn("h-4 w-4", tone === "danger" ? "text-red-500" : "text-amber-500")} />
              )}
              <p className="text-sm font-semibold text-foreground">{resolveTaskHealthTitle(health)}</p>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{health.explanation}</p>
          </div>
          <StatusBadge label={auditLabel} tone={health.audit.state === "clean" ? "success" : tone} />
        </div>

        <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-5")}>
          <TaskHealthMetric label="Active" value={health.active.active} tone={health.active.active > 0 ? "info" : "muted"} />
          <TaskHealthMetric label="Queued" value={health.active.queued} tone={health.active.queued > 0 ? "warning" : "muted"} />
          <TaskHealthMetric label="Running" value={health.active.running} tone={health.active.running > 0 ? "info" : "muted"} />
          <TaskHealthMetric label="Historical failures" value={health.historical.issueCount} tone={health.historical.issueCount > 0 ? "warning" : "success"} />
          <TaskHealthMetric label="Audit" value={auditLabel} tone={health.audit.state === "clean" ? "success" : tone} />
        </div>

        <TaskHealthNotice
          tone={tone}
          title={historicalLabel}
          detail={resolveTaskHealthDetail(health)}
        />

        {showGroups ? <TaskIssueGroups health={health} snapshot={snapshot} /> : null}
      </div>
    </SectionCard>
  );
}

function TaskHealthMetric({ label, value, tone }: { label: string; value: number | string; tone: StatusTone }) {
  return (
    <div className="rounded-lg border border-border bg-muted/35 px-3 py-2">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-lg font-semibold", metricToneClassName(tone))}>{value}</p>
    </div>
  );
}

function TaskIssueGroups({ health, snapshot }: { health: TaskHealthSummary; snapshot: MissionControlSnapshot }) {
  const referenceMs = resolveRelativeTimeReferenceMs(snapshot.generatedAt);
  const groups = health.groups.slice(0, 8);

  if (groups.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-muted/25 p-3">
        <p className="text-xs text-muted-foreground">No grouped historical task failures were reported.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <History className="h-3.5 w-3.5" />
        Historical task failure groups
      </div>
      {groups.map((group) => (
        <TaskIssueGroupRow key={group.id} group={group} referenceMs={referenceMs} />
      ))}
    </div>
  );
}

function TaskIssueGroupRow({ group, referenceMs }: { group: TaskRunIssueGroup; referenceMs: number }) {
  const statusDetail = Object.entries(group.statusCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([status, count]) => `${status}: ${count}`)
    .join(" · ");

  return (
    <div className="rounded-lg border border-border bg-card/70 p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {group.agentName ?? group.agentId ?? "Unknown agent"} · {group.runtime}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {group.issueCount} past failed run{group.issueCount === 1 ? "" : "s"}
            {group.lastErrorAt ? ` · last ${formatRelativeTime(Date.parse(group.lastErrorAt), referenceMs)}` : ""}
          </p>
        </div>
        <StatusBadge label={group.runtime} tone={group.runtime === "cron" ? "warning" : "info"} />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <KeyValue label="Status distribution" value={statusDetail || "Not reported"} />
        <KeyValue label="Child session" value={group.childSessionKey ? shortId(group.childSessionKey, 16) : "Not reported"} />
        <KeyValue label="Run" value={group.runIds[0] ? shortId(group.runIds[0], 16) : "Not reported"} />
        <KeyValue label="Task" value={group.taskIds[0] ? shortId(group.taskIds[0], 16) : "Not reported"} />
      </div>
      {group.lastError || group.lastSummary ? (
        <p className="mt-3 rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-muted-foreground">
          {group.lastError ?? group.lastSummary}
        </p>
      ) : null}
    </div>
  );
}

function TaskHealthNotice({ tone, title, detail }: { tone: StatusTone; title: string; detail: string }) {
  return (
    <div className={cn("rounded-lg border px-3 py-2", noticeClassName(tone))}>
      <div className="flex items-start gap-2">
        {tone === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />}
        <div className="min-w-0">
          <p className="text-xs font-semibold">{title}</p>
          <p className="mt-1 text-xs leading-5 opacity-80">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function resolveTaskHealthTitle(health: TaskHealthSummary) {
  if (health.currentIssue.severity === "critical") {
    return "Current task issues need attention";
  }

  if (health.currentIssue.severity === "warning") {
    return "Task audit has warnings";
  }

  return "No active task issues";
}

function resolveTaskHealthDetail(health: TaskHealthSummary) {
  if (health.audit.state === "clean" && health.historical.issueCount > 0) {
    return "Audit found no repairable task state issues. Historical failed runs are still shown for visibility.";
  }

  if (health.audit.state === "clean") {
    return "OpenClaw task audit is clean and no historical task failures are currently reported.";
  }

  return health.audit.explanation;
}

function formatHistoricalLabel(health: TaskHealthSummary) {
  if (health.historical.issueCount === 0) {
    return "No historical task failures";
  }

  const cronGroupCount = health.groups.filter((group) => group.runtime === "cron").length;
  const suffix = cronGroupCount > 0 ? "past failed cron runs" : "historical task failures";
  return `${health.historical.issueCount} ${suffix}`;
}

function resolveTaskHealthTone(health: TaskHealthSummary): StatusTone {
  if (health.currentIssue.severity === "critical") {
    return "danger";
  }

  if (health.currentIssue.severity === "warning" || health.historical.issueCount > 0) {
    return "warning";
  }

  return "success";
}

function metricToneClassName(tone: StatusTone) {
  switch (tone) {
    case "success":
      return "text-emerald-600";
    case "warning":
      return "text-amber-600";
    case "danger":
      return "text-red-600";
    case "info":
      return "text-primary";
    default:
      return "text-foreground";
  }
}

function noticeClassName(tone: StatusTone) {
  switch (tone) {
    case "success":
      return "border-emerald-400/25 bg-emerald-400/10 text-emerald-700 dark:text-emerald-100";
    case "danger":
      return "border-red-400/25 bg-red-400/10 text-red-700 dark:text-red-100";
    case "warning":
      return "border-amber-400/25 bg-amber-400/10 text-amber-700 dark:text-amber-100";
    default:
      return "border-border bg-muted/30 text-muted-foreground";
  }
}
