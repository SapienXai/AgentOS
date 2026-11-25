"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Bot, Loader2, Plus, Search } from "lucide-react";

import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatusBadge
} from "@/components/operations/operations-ui";
import { HumanControlInbox } from "@/components/operations/human-control-inbox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { WorkforceMissionListResponse, WorkforceMissionProjection } from "@/lib/agentos/workforce/types";
import { cn } from "@/lib/utils";

export function MissionListPage({
  initial,
  snapshot,
  activeWorkspaceId,
  connectionState,
  attentionRefreshGeneration,
  refresh,
  surfaceTheme,
  view
}: {
  initial: WorkforceMissionListResponse;
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  connectionState: "connecting" | "live" | "retrying";
  attentionRefreshGeneration: number;
  refresh: () => Promise<void>;
  surfaceTheme: "light" | "dark";
  view: TaskView;
}) {
  const [payload, setPayload] = useState(initial);
  const [search, setSearch] = useState("");
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (activeWorkspaceId) params.set("workspaceId", activeWorkspaceId);
    if (search.trim()) params.set("search", search.trim());
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch(`/api/missions${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store", signal: controller.signal });
        const next = (await response.json()) as WorkforceMissionListResponse & { error?: string };
        if (!response.ok || next.error) throw new Error(next.error || "Tasks could not be refreshed.");
        if (!controller.signal.aborted) setPayload(next);
      } catch (error) {
        if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "Tasks could not be refreshed.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, search.trim() ? 180 : 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [activeWorkspaceId, attentionRefreshGeneration, search, snapshot.revision, retry]);

  const sections = useMemo(() => {
    const needsYou = payload.missions.filter((mission) => ["waiting-human", "blocked", "failed"].includes(mission.state));
    const active = payload.missions.filter((mission) => ["starting", "running", "waiting-worker", "reconnecting"].includes(mission.state));
    const queued = payload.missions.filter((mission) => mission.state === "queued");
    const history = payload.missions.filter((mission) => ["completed", "cancelled"].includes(mission.state));
    return { needsYou, active, queued, history };
  }, [payload.missions]);
  const showingActive = view === "all" || view === "progress";
  const showingCompleted = view === "all" || view === "completed";
  const displayedTaskCount = view === "needs-you" ? sections.needsYou.length :
    view === "progress" ? sections.active.length + sections.queued.length :
    view === "completed" ? sections.history.length : payload.missions.length;

  const eligibleAgentCount = snapshot.agents.filter((agent) =>
    agent.status !== "offline" && (!activeWorkspaceId || agent.workspaceId === activeWorkspaceId)
  ).length;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <PageHeader
        title="Tasks"
        subtitle="Assign work, follow the results, and make decisions when your team needs you."
        primaryAction={{ label: "Assign task", icon: Plus, onClick: () => setNewTaskOpen(true), disabled: eligibleAgentCount === 0, title: eligibleAgentCount === 0 ? "Connect an available agent in this workspace before starting a task." : undefined }}
      />

      <TaskViewNavigation view={view} attentionCount={payload.summary.needsYou} />
      {connectionState !== "live" ? <p role="status" className="text-sm text-muted-foreground">Reconnecting. Showing the last confirmed task state.</p> : null}
      {view === "needs-you" ? <HumanControlInbox mode="section" surfaceTheme={surfaceTheme} attentionRefreshGeneration={attentionRefreshGeneration} /> : null}
      {loadError ? <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/25 p-3 text-sm">
        {loadError}<Button type="button" variant="secondary" onClick={() => setRetry(value => value + 1)}>Retry</Button>
      </div> : null}

      <div className="flex items-center gap-2 rounded-lg border border-border bg-card/45 px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search tasks, workers, or workspaces"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          aria-label="Search tasks"
        />
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Refreshing tasks" /> : null}
      </div>

      {(view === "all" || view === "needs-you") && sections.needsYou.length > 0 ? <MissionSection title="Needs you" detail="These tasks need an operator decision or recovery." missions={sections.needsYou} tone="warning" /> : null}
      {showingActive && sections.active.length > 0 ? <MissionSection title="Active" detail="Current task state follows confirmed OpenClaw runtime evidence." missions={sections.active} tone="info" /> : null}
      {showingActive && sections.queued.length > 0 ? <MissionSection title="Queued" detail="Tasks admitted and waiting for runtime start." missions={sections.queued} tone="purple" /> : null}
      {showingCompleted && sections.history.length > 0 ? <MissionSection title="History" detail="Completed and cancelled tasks remain available with their captured evidence." missions={sections.history} tone="muted" /> : null}

      {displayedTaskCount === 0 && !loading && !loadError && view !== "needs-you" ? (
        <EmptyState title={view === "all" && !search ? "No tasks yet" : "No tasks match"}
          description={view === "all" && !search ? "Assign a task to an employee to get started." : "Change the search or select another view."} />
      ) : null}

      <NewMissionDialog
        open={newTaskOpen}
        onOpenChange={setNewTaskOpen}
        snapshot={snapshot}
        activeWorkspaceId={activeWorkspaceId}
        onSubmitted={async (missionId) => {
          await refresh();
          window.location.assign(`/missions/${encodeURIComponent(missionId)}`);
        }}
      />
    </div>
  );
}

function MissionSection({ title, detail, missions, tone }: { title: string; detail: string; missions: WorkforceMissionProjection[]; tone: "warning" | "info" | "purple" | "success" | "muted" }) {
  return (
    <SectionCard title={title} action={<span className="text-[0.65rem] text-muted-foreground">{missions.length}</span>}>
      <p className="border-b border-border px-3 py-2 text-xs leading-5 text-muted-foreground">{detail}</p>
      <div className="flex flex-col divide-y divide-border">
        {missions.map((mission) => <MissionCard key={mission.id} mission={mission} tone={tone} />)}
      </div>
    </SectionCard>
  );
}

function MissionCard({ mission, tone }: { mission: WorkforceMissionProjection; tone: "warning" | "info" | "purple" | "success" | "muted" }) {
  const activeWorkerCount = mission.activeWorkers.length;
  return (
    <article className="flex min-w-0 flex-col gap-2 px-4 py-3 transition-colors hover:bg-accent/35 motion-reduce:transition-none">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">{mission.title}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{mission.goal}</p>
        </div>
        <StatusBadge label={mission.stateLabel} tone={tone} />
      </div>
      <div className="mt-3 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{mission.primaryAgentName}</span>
        {activeWorkerCount > 1 ? <span className="shrink-0">· {activeWorkerCount} workers</span> : null}
      </div>
      {mission.humanControlItems[0] ? (
        <div className="mt-3 rounded-lg border border-[hsl(var(--status-warning)/0.30)] bg-[hsl(var(--status-warning)/0.08)] p-2.5 text-xs text-[hsl(var(--status-warning-foreground))]">
          <p className="font-semibold">{mission.humanControlItems[0].title}</p>
          <p className="mt-1 line-clamp-2 leading-5">{mission.humanControlItems[0].summary}</p>
        </div>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
        <span className="text-[0.68rem] text-muted-foreground">{formatAge(mission.updatedAt ?? mission.createdAt)}</span>
        <Link href={`/missions/${encodeURIComponent(mission.id)}`} className="group inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          {mission.humanControlItems.length > 0 ? "Answer" : mission.state === "completed" ? "View result" : "Open task"}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

export type TaskView = "all" | "progress" | "needs-you" | "completed" | "scheduled";

export function TaskViewNavigation({ view, attentionCount }: { view: TaskView; attentionCount?: number }) {
  const views: Array<{ id: TaskView; label: string }> = [
    { id: "all", label: "All" },
    { id: "progress", label: "In progress" },
    { id: "needs-you", label: "Needs you" },
    { id: "completed", label: "Completed" },
    { id: "scheduled", label: "Scheduled" }
  ];
  return (
    <nav aria-label="Task views" className="flex gap-1 overflow-x-auto border-b border-border">
      {views.map(({ id, label }) => (
        <Link key={id} href={id === "all" ? "/missions" : `/missions?view=${id}`} scroll={false}
          aria-current={view === id ? "page" : undefined}
          className={cn("flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm font-medium focus-visible:outline focus-visible:outline-ring",
            view === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>
          {label}
          {id === "needs-you" && attentionCount ? <span className="rounded-md bg-primary/10 px-1.5 text-xs text-primary">{attentionCount}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

function NewMissionDialog({ open, onOpenChange, snapshot, activeWorkspaceId, onSubmitted }: { open: boolean; onOpenChange: (open: boolean) => void; snapshot: MissionControlSnapshot; activeWorkspaceId: string | null; onSubmitted: (missionId: string) => Promise<void> }) {
  const [goal, setGoal] = useState("");
  const request = useRef<{ goal: string; agentId: string; id: string } | null>(null);
  const [agentId, setAgentId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligibleAgents = snapshot.agents.filter((agent) => agent.status !== "offline" && (!activeWorkspaceId || agent.workspaceId === activeWorkspaceId));

  useEffect(() => {
    if (!open) return;
    setGoal("");
    request.current = null;
    setAgentId("");
    setError(null);
  }, [open]);

  async function submit() {
    const mission = goal.trim();
    if (!mission) {
      setError("Describe what you want this agent to accomplish.");
      return;
    }
    if (eligibleAgents.length === 0) {
      setError("Select an available agent in the current workspace.");
      return;
    }
    if (!agentId || !eligibleAgents.some((agent) => agent.id === agentId)) {
      setError("Choose an employee for this task.");
      return;
    }
    if (submitting) return;
    if (request.current?.goal !== mission || request.current.agentId !== agentId) {
      request.current = { goal: mission, agentId, id: `task:${crypto.randomUUID()}` };
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/mission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mission,
          requestId: request.current.id,
          agentId,
          workspaceId: activeWorkspaceId ?? eligibleAgents.find((agent) => agent.id === agentId)?.workspaceId
        })
      });
      const result = (await response.json()) as { dispatchId?: string; error?: string };
      if (!response.ok || result.error) throw new Error(result.error || "Task could not be started.");
      if (!result.dispatchId) throw new Error("OpenClaw accepted the request without returning a task reference.");
      onOpenChange(false);
      await onSubmitted(result.dispatchId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Task could not be started.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={value => { if (!submitting) onOpenChange(value); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-1.5rem)] max-w-xl overflow-y-auto rounded-2xl p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle>Assign task</DialogTitle>
          <DialogDescription>Describe the result you want and choose who should do the work.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div>
            <Label htmlFor="mission-goal">Task goal</Label>
            <Textarea id="mission-goal" value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Research our competitors and prepare a launch brief." className="mt-2 min-h-28 resize-y text-sm" disabled={submitting} />
          </div>
          <div>
            <Label htmlFor="mission-agent">Employee</Label>
            <select id="mission-agent" value={agentId} onChange={(event) => setAgentId(event.target.value)} disabled={submitting || eligibleAgents.length === 0} className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
              <option value="">Choose an employee</option>
              {eligibleAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} ({agent.status})</option>)}
            </select>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">Only employees in the current workspace are available here.</p>
          </div>
          {snapshot.diagnostics.health !== "healthy" ? <div className="flex items-start gap-2 rounded-lg border border-[hsl(var(--status-warning)/0.30)] bg-[hsl(var(--status-warning)/0.08)] p-3 text-xs leading-5 text-[hsl(var(--status-warning-foreground))]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>OpenClaw is not fully ready. Start will validate the live Gateway before creating runtime work.</span></div> : null}
          {error ? <p className="text-sm text-[hsl(var(--status-danger-foreground))]" role="alert">{error}</p> : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={submitting || eligibleAgents.length === 0 || !agentId}>{submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />}Start task</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatAge(value: string | null) {
  if (!value) return "Awaiting runtime evidence";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "Recently updated";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
