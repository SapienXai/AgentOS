"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Ban, Bot, ChevronRight, Clock3, Download, FileText, Play, RefreshCw, ShieldAlert } from "lucide-react";

import { EmptyState, KeyValue, PageHeader, SectionCard, StatusBadge } from "@/components/operations/operations-ui";
import { Button } from "@/components/ui/button";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { WorkforceDeliverable, WorkforceMissionProjection, WorkforceTimelineEvent } from "@/lib/agentos/workforce/types";
import { cn } from "@/lib/utils";

export function MissionDetailPage({
  initial,
  snapshot,
  connectionState,
  attentionRefreshGeneration,
  refresh
}: {
  initial: WorkforceMissionProjection;
  snapshot: MissionControlSnapshot;
  connectionState: "connecting" | "live" | "retrying";
  attentionRefreshGeneration: number;
  refresh: () => Promise<void>;
}) {
  const [mission, setMission] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRead = useRef<AbortController | null>(null);
  const currentWorkSignature = useMemo(() => {
    const root = snapshot.tasks.find((task) => task.id === mission.rootTaskId || task.dispatchId === mission.id);
    const parentSessionKey = root?.metadata.openClawSessionKey;
    const knownTasks = new Set(mission.workTree.map((item) => item.taskId));
    return snapshot.tasks.filter((task) => task.id === root?.id || knownTasks.has(task.id) ||
      (typeof parentSessionKey === "string" && task.metadata.requesterSessionKey === parentSessionKey))
      .map((task) => `${task.id}:${task.updatedAt}:${task.status}:${task.artifactCount}:${task.warningCount}`)
      .sort().join("|");
  }, [snapshot.tasks, mission.id, mission.rootTaskId, mission.workTree]);

  const loadMission = useCallback(async () => {
    const controller = new AbortController();
    pendingRead.current?.abort();
    pendingRead.current = controller;
    setLoading(true);
    try {
      const response = await fetch(`/api/missions/${encodeURIComponent(initial.id)}`, {
        cache: "no-store",
        signal: controller.signal
      });
      const next = (await response.json()) as WorkforceMissionProjection & { error?: string };
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(next.error || "Mission details are unavailable.");
      setMission(next);
      setError(null);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Mission details are unavailable.");
    } finally {
      if (pendingRead.current === controller) {
        pendingRead.current = null;
        if (!controller.signal.aborted) setLoading(false);
      }
    }
  }, [initial.id]);

  useEffect(() => {
    const scheduledRead = window.setTimeout(() => void loadMission(), 170);
    return () => window.clearTimeout(scheduledRead);
  }, [attentionRefreshGeneration, connectionState, currentWorkSignature, loadMission]);

  useEffect(() => () => pendingRead.current?.abort(), [initial.id]);

  async function cancelMission() {
    if (!mission.availableActions.canCancel || actionPending) return;
    if (!window.confirm("Stop this task and its current runtime work?")) return;
    const targetId = mission.rootTaskId ?? mission.dispatchId;
    if (!targetId) return;
    setActionPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(targetId)}/abort`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dispatchId: mission.dispatchId, reason: "Stopped from Workforce mission control." })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok || result.error) throw new Error(result.error || "The task could not be stopped.");
      await refresh();
      await loadMission();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The task could not be stopped.");
    } finally {
      setActionPending(false);
    }
  }

  async function resumeMission() {
    if (!mission.availableActions.canResume || actionPending || !mission.rootTaskId) return;
    setActionPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(mission.rootTaskId)}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "continue",
          message: "Continue from the last confirmed runtime state.",
          dispatchId: mission.dispatchId,
          idempotencyKey: `mission:${mission.id}:continue`
        })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok || result.error) throw new Error(result.error || "The task could not be continued.");
      await refresh();
      await loadMission();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The task could not be continued.");
    } finally {
      setActionPending(false);
    }
  }

  async function acceptDeliverable() {
    if (!mission.rootTaskId || actionPending) return;
    setActionPending(true);
    setError(null);
    try {
      const response = await fetch("/api/task-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: mission.rootTaskId,
          dispatchId: mission.dispatchId,
          status: "accepted",
          action: "Accepted the deliverable."
        })
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "The review could not be saved.");
      await loadMission();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The review could not be saved.");
    } finally {
      setActionPending(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/missions" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Tasks
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void loadMission()} disabled={loading} className="h-9 rounded-lg px-2.5 text-xs">
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "motion-safe:animate-spin")} aria-hidden="true" /> Refresh
          </Button>
          {mission.availableActions.canResume ? <Button variant="secondary" size="sm" onClick={() => void resumeMission()} disabled={actionPending} className="h-9 rounded-lg px-2.5 text-xs"><Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {actionPending ? "Continuing…" : "Continue task"}</Button> : null}
          {mission.availableActions.canCancel ? <Button variant="secondary" size="sm" onClick={() => void cancelMission()} disabled={actionPending} className="h-9 rounded-lg px-2.5 text-xs text-[hsl(var(--status-danger-foreground))]"><Ban className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {actionPending ? "Requesting stop…" : "Stop task"}</Button> : null}
        </div>
      </div>

      <PageHeader title={mission.title} subtitle={mission.title === mission.goal.trim() ? undefined : mission.goal}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={mission.stateLabel} tone={stateTone(mission.state)} />
          <span className="text-xs text-muted-foreground">{mission.primaryAgentName}</span>
          {mission.workspaceName ? <span className="text-xs text-muted-foreground">· {mission.workspaceName}</span> : null}
          {mission.connection === "reconnecting" ? <span className="text-xs text-[hsl(var(--status-warning-foreground))]">· Runtime reconnecting</span> : null}
        </div>
      </PageHeader>

      {mission.expectedOutcome || mission.acceptanceCriteria ? (
        <details className="rounded-lg border border-border bg-card/45 px-4 py-3">
          <summary className="cursor-pointer text-sm font-semibold">Expected result</summary>
          {mission.expectedOutcome ? <p className="mt-2 whitespace-pre-wrap break-words text-sm">{mission.expectedOutcome}</p> : null}
          {mission.acceptanceCriteria ? (
            <div className="mt-2">
              <p className="text-xs font-semibold text-muted-foreground">Acceptance criteria</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm">{mission.acceptanceCriteria}</p>
            </div>
          ) : null}
        </details>
      ) : null}

      {error ? <div className="rounded-lg border border-[hsl(var(--status-danger)/0.30)] bg-[hsl(var(--status-danger)/0.08)] p-3 text-sm text-[hsl(var(--status-danger-foreground))]" role="alert">{error}</div> : null}

      {mission.state !== "completed" ? <section className={cn("rounded-xl border p-4", mission.state === "waiting-human" || mission.state === "blocked" || mission.state === "failed" ? "border-[hsl(var(--status-warning)/0.35)] bg-[hsl(var(--status-warning)/0.08)]" : "border-border bg-card/55")}>
        <div className="flex items-start gap-3">
          {mission.state === "waiting-human" || mission.state === "blocked" || mission.state === "failed" ? <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--status-warning-foreground))]" aria-hidden="true" /> : <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{currentStateTitle(mission)}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{currentStateDetail(mission)}</p>
            {mission.humanControlItems.length > 0 ? <Link href={`/human-control?missionId=${encodeURIComponent(mission.id)}`} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Open Human Control <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Link> : null}
          </div>
        </div>
      </section> : null}

      {mission.deliverable ? <MissionDeliverable mission={mission} actionPending={actionPending} onAccept={() => void acceptDeliverable()} /> : null}

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3">
          {mission.activeWorkers.length > 0 ? <SectionCard title="Active workers">
            <div className="divide-y divide-border">
              {mission.activeWorkers.map((worker) => (
                <div key={`${worker.taskId ?? worker.id ?? "worker"}:${worker.relationship}`} className="flex items-start gap-3 px-4 py-3">
                  <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-foreground">{worker.name}</p>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{worker.activity}</p>
                  </div>
                  <StatusBadge label={worker.state === "waiting-worker" ? "Waiting" : worker.state} tone={stateTone(worker.state)} />
                </div>
              ))}
            </div>
          </SectionCard> : null}

          <SectionCard title="Work tree">
            {mission.workTree.length > 0 ? <div className="divide-y divide-border">{mission.workTree.map((item) => <div key={item.id} className="flex min-w-0 items-center gap-3 px-3 py-3"><div className={cn("h-2 w-2 shrink-0 rounded-full", item.relationship === "delegated" ? "bg-[hsl(var(--agentos-operational-accent))]" : "bg-primary")} aria-hidden="true" /><div className="min-w-0 flex-1"><p className={cn("truncate text-sm font-medium text-foreground", item.relationship === "delegated" && "pl-3")}>{item.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.agentName}{item.relationship === "delegated" ? " · delegated" : " · primary"}</p></div><StatusBadge label={item.state === "waiting-worker" ? "Waiting" : item.state} tone={stateTone(item.state)} /></div>)}</div> : <div className="p-3"><EmptyState title="Work tree is still forming" description="OpenClaw has not returned child-work evidence for this mission yet." /></div>}
          </SectionCard>

          <SectionCard title="Activity">
            {mission.timeline.length > 0 ? <div className="divide-y divide-border">{mission.timeline.map((event) => <TimelineRow key={event.id} event={event} />)}</div> : <div className="p-3"><EmptyState title="No timeline events yet" description="Confirmed runtime and human-control events will appear here." /></div>}
          </SectionCard>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <SectionCard title="Execution summary">
            <div className="px-3 py-1"><KeyValue label="Started" value={formatDate(mission.startedAt)} /><KeyValue label="Duration" value={formatDuration(mission.durationMs)} /><KeyValue label="Worker" value={mission.primaryAgentName} /><KeyValue label="Runtime state" value={mission.connection === "reconnecting" ? "Reconnecting" : mission.stateLabel} /></div>
          </SectionCard>
          <details className="rounded-lg border border-border bg-card/45 p-3">
            <summary className="cursor-pointer list-none text-xs font-semibold text-foreground">Technical details</summary>
            <div className="mt-3 space-y-1.5 text-[0.68rem] text-muted-foreground"><p>Mission reference: <span className="font-mono text-foreground">{mission.id}</span></p><p>Dispatch: <span className="font-mono text-foreground">{mission.runtime.dispatchId ?? "Not bound"}</span></p><p>Tasks: <span className="font-mono text-foreground">{mission.runtime.taskIds.join(", ") || "None"}</span></p><p>Sessions: <span className="font-mono text-foreground">{mission.runtime.sessionIds.join(", ") || "None"}</span></p><p>Runtimes: <span className="font-mono text-foreground">{mission.runtime.runtimeIds.join(", ") || "None"}</span></p></div>
          </details>
        </div>
      </div>
    </div>
  );
}

const outcomeLabel: Record<WorkforceDeliverable["outcome"], string> = {
  delivered: "Delivered",
  partial: "Partial result",
  "needs-review": "Needs review",
  unverified: "Unverified",
  failed: "No deliverable"
};

function MissionDeliverable({ mission, actionPending, onAccept }: {
  mission: WorkforceMissionProjection;
  actionPending: boolean;
  onAccept: () => void;
}) {
  const deliverable = mission.deliverable;
  if (!deliverable) return null;
  const accepted = deliverable.review?.status === "accepted";
  const canAccept = !accepted && mission.state === "completed" && Boolean(mission.rootTaskId &&
    (deliverable.summary || deliverable.artifactCount));

  return (
    <SectionCard
      title="Deliverable"
      action={<StatusBadge label={outcomeLabel[deliverable.outcome]} tone={deliverable.outcome === "delivered" ? "success" : "warning"} />}
    >
      <div id="deliverable" className="scroll-mt-4 space-y-4 px-4 py-4 sm:px-5">
        {deliverable.summary ? (
          <p className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
            {deliverable.summary}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {deliverable.artifactCount ? "The work produced the files below." : "There is no saved result for this run."}
          </p>
        )}
        {deliverable.evidence.length > 0 ? (
          <ul className="list-disc space-y-1 pl-4 text-sm text-[hsl(var(--status-warning-foreground))]">
            {deliverable.evidence.map((item) => <li key={item}>{item}</li>)}
          </ul>
        ) : null}
        {mission.artifacts.length > 0 ? (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
            {mission.artifacts.map((artifact) => (
              <li key={artifact.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <FileText className="size-4 shrink-0 text-primary" aria-hidden="true" />
                <div className="min-w-[min(12rem,70%)] flex-1">
                  <p className="break-words text-sm font-medium text-foreground">{artifact.displayPath}</p>
                  <p className="text-xs text-muted-foreground">
                    {artifact.bytes !== null ? formatFileSize(artifact.bytes) : "File unavailable"}
                  </p>
                </div>
                {artifact.availability === "available" ? (
                  <Button asChild variant="secondary" size="sm" className="min-h-10">
                    <a
                      href={`/api/missions/${encodeURIComponent(mission.id)}?artifact=${artifact.id}`}
                      aria-label={`Download ${artifact.displayPath}`}
                    >
                      <Download className="size-3.5" aria-hidden="true" /> Download
                    </a>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {accepted ? (
          <p className="text-sm text-muted-foreground" role="status">Accepted {formatDate(deliverable.review?.reviewedAt ?? null)}</p>
        ) : canAccept ? (
          <Button type="button" size="sm" variant="secondary" disabled={actionPending} onClick={onAccept}>
            Accept result
          </Button>
        ) : null}
      </div>
    </SectionCard>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function TimelineRow({ event }: { event: WorkforceTimelineEvent }) {
  return <div className="flex gap-3 px-3 py-3"><span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", event.kind === "failed" || event.kind === "blocked" ? "bg-[hsl(var(--status-danger))]" : event.kind === "approval" ? "bg-[hsl(var(--status-warning))]" : event.kind === "completed" ? "bg-[hsl(var(--status-success))]" : "bg-primary")} aria-hidden="true" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-xs font-semibold text-foreground">{event.title}</p><time dateTime={event.at} className="text-[0.65rem] text-muted-foreground">{formatDate(event.at)}</time></div>{event.detail ? <p className="mt-1 line-clamp-3 break-words text-xs leading-5 text-muted-foreground">{event.detail}</p> : null}{event.workerLabel ? <p className="mt-1 text-[0.65rem] text-muted-foreground">{event.workerLabel}</p> : null}</div></div>;
}

function currentStateTitle(mission: WorkforceMissionProjection) {
  if (mission.state === "waiting-human") return "Waiting for your decision";
  if (mission.state === "waiting-worker") return "Waiting for a delegated worker";
  if (mission.state === "reconnecting") return "OpenClaw is reconnecting";
  if (mission.state === "failed") return "Task needs recovery";
  if (mission.state === "blocked") return "Task is blocked";
  if (mission.state === "completed") return "Task done";
  if (mission.state === "queued") return "Task queued";
  if (mission.state === "starting") return "Task is starting";
  return `${mission.primaryAgentName} is working`;
}

function currentStateDetail(mission: WorkforceMissionProjection) {
  if (mission.humanControlItems[0]) return mission.humanControlItems[0].summary;
  if (mission.error) return mission.error;
  if (mission.state === "waiting-worker") return "The parent work is waiting for the child worker's authoritative result.";
  if (mission.state === "reconnecting") return "AgentOS temporarily lost the live Gateway connection. This is not a failure; confirmed runtime state will be restored when it reconnects.";
  if (mission.state === "completed") return "The run has finished. Review the saved result and available files below.";
  return mission.summary || "Current activity is limited to confirmed OpenClaw runtime evidence.";
}

function stateTone(state: WorkforceMissionProjection["state"] | "idle") {
  if (state === "completed") return "success" as const;
  if (state === "failed" || state === "blocked") return "danger" as const;
  if (state === "waiting-human") return "warning" as const;
  if (state === "waiting-worker" || state === "reconnecting" || state === "queued") return "purple" as const;
  return "info" as const;
}

function formatDate(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatDuration(value: number | null) {
  if (value === null) return "Not available";
  const totalMinutes = Math.floor(value / 60_000);
  if (totalMinutes < 1) return "Less than a minute";
  if (totalMinutes < 60) return `${totalMinutes}m`;
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}
