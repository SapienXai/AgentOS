"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Bot, Building2, CalendarClock, ChevronDown, CirclePause, Clock3, Coins, History, Loader2, Pause, Play, Plus, RefreshCw, ShieldCheck, Sparkles, Trash2, UserRound, Zap } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PikoLoader } from "@/components/ui/piko-loader";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState, InspectorPanelFrame, KeyValue, OperationsPageLayout, PageHeader, SectionCard, StatCard, StatGrid, StatusBadge } from "@/components/operations/operations-ui";
import type { OperationJob, OperationsSnapshot } from "@/lib/agentos/operations/types";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

export function OperationsJobsPageContent({ snapshot, activeWorkspaceId, surfaceTheme }: { snapshot: MissionControlSnapshot; activeWorkspaceId: string | null; surfaceTheme: "dark" | "light" }) {
  const [data, setData] = useState<OperationsSnapshot | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(() => new Set());
  const [deleteTarget, setDeleteTarget] = useState<OperationJob | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyAction, setBusyAction] = useState<{ jobId: string; action: string } | null>(null);
  const load = async () => { try { const response = await fetch("/api/operations", { cache: "no-store" }); const result = await response.json() as OperationsSnapshot & { error?: string }; if (!response.ok || result.error) throw new Error(result.error || "Unable to load Operations."); setData(result); } catch (error) { toast.error("Operations could not be loaded.", { description: error instanceof Error ? error.message : "Unknown error." }); } };
  useEffect(() => { void load(); }, []);
  const jobs = useMemo(() => (data?.jobs ?? []).filter((job) => !activeWorkspaceId || job.workspaceId === activeWorkspaceId), [activeWorkspaceId, data]);
  const current = jobs.find((job) => job.id === selected) ?? jobs[0] ?? null;
  const perform = async (action: "run" | "pause" | "resume" | "retry" | "disable" | "cancel" | "delete", job: OperationJob) => { setBusyAction({ jobId: job.id, action }); try { const response = await fetch("/api/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, jobId: job.id }) }); const result = await response.json() as { error?: string }; if (!response.ok || result.error) throw new Error(result.error || "Operation was rejected."); toast.success(action === "delete" ? `${job.name} was removed from OpenClaw.` : `${job.name}: ${action} accepted by OpenClaw.`); if (action === "delete") { setSelected((value) => value === job.id ? null : value); setExpandedJobs((current) => { const next = new Set(current); next.delete(job.id); return next; }); setDeleteTarget(null); } await load(); } catch (error) { toast.error(`${action} was not applied.`, { description: error instanceof Error ? error.message : "Unknown error." }); } finally { setBusyAction(null); } };
  const counts = { active: jobs.filter((job) => job.status === "active" || job.status === "scheduled").length, running: jobs.filter((job) => job.status === "running").length, failed: jobs.filter((job) => job.status === "failed").length, paused: jobs.filter((job) => job.status === "paused").length };
  return <OperationsPageLayout main={<>
    <PikoLoader
      open={Boolean(busyAction)}
      title={busyAction?.action === "run" ? "Starting operation" : busyAction?.action === "delete" ? "Deleting operation" : "Updating operation"}
      description="Applying the requested operation change in OpenClaw."
    />
    <PageHeader surfaceTheme={surfaceTheme} title="Operations & Jobs" subtitle="OpenClaw cron is the execution source of truth. AgentOS adds safety checks, health projection, and an immutable operator audit trail." actions={<div className="flex shrink-0 items-center gap-2"><Button variant="secondary" size="sm" className="h-9 rounded-lg px-3" onClick={() => void load()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button><Button size="sm" className="h-9 rounded-lg px-3" disabled={data?.scheduler.state !== "available"} title={data?.scheduler.state !== "available" ? "Cron write capability is unavailable." : undefined} onClick={() => setCreating(true)}><Plus className="mr-1.5 h-3.5 w-3.5" />New job</Button></div>} />
    <StatGrid columns={4}><StatCard label="Active" value={String(counts.active)} detail="Scheduled in OpenClaw" icon={CalendarClock} tone="info" /><StatCard label="Running" value={String(counts.running)} detail="Live cron runs" icon={Activity} tone="warning" /><StatCard label="Failed" value={String(counts.failed)} detail="Needs recovery" icon={AlertTriangle} tone="danger" /><StatCard label="Paused" value={String(counts.paused)} detail="Disabled jobs" icon={CirclePause} tone="muted" /></StatGrid>
    {data?.notices.map((notice) => <div key={notice.title} className="rounded-lg border border-[hsl(var(--status-warning)/0.25)] bg-[hsl(var(--status-warning)/0.08)] p-3 text-xs text-muted-foreground"><strong className="text-foreground">{notice.title}</strong><span className="ml-2">{notice.detail}</span></div>)}
    <SectionCard title="Jobs"><div className="space-y-2 p-2.5">{jobs.length ? jobs.map((job) => <OperationJobRow key={job.id} job={job} runs={(data?.runs ?? []).filter((run) => run.jobId === job.id)} snapshot={snapshot} surfaceTheme={surfaceTheme} expanded={expandedJobs.has(job.id)} selected={current?.id === job.id} busyAction={busyAction} onSelect={() => setSelected(job.id)} onToggle={() => setExpandedJobs((currentSet) => { const next = new Set(currentSet); if (next.has(job.id)) next.delete(job.id); else next.add(job.id); return next; })} onAction={perform} onDelete={() => setDeleteTarget(job)} />) : <EmptyState title="No OpenClaw jobs" description="Create a cron-backed operation when the Gateway advertises cron write support." />}</div></SectionCard>
    {creating ? <CreateOperationForm snapshot={snapshot} activeWorkspaceId={activeWorkspaceId} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); await load(); }} /> : null}
    <DeleteOperationDialog job={deleteTarget} busy={Boolean(deleteTarget && busyAction?.jobId === deleteTarget.id)} onClose={() => setDeleteTarget(null)} onConfirm={(job) => perform("delete", job)} />
  </>} inspector={<InspectorPanelFrame title="Job detail">{current ? <JobDetail job={current} runs={(data?.runs ?? []).filter((run) => run.jobId === current.id)} busy={busyAction?.jobId === current.id} onAction={perform} /> : <p className="text-xs text-muted-foreground">Select a job to inspect its real runtime state.</p>}</InspectorPanelFrame>} />;
}

function OperationJobRow({ job, runs, snapshot, surfaceTheme, expanded, selected, busyAction, onSelect, onToggle, onAction, onDelete }: {
  job: OperationJob;
  runs: OperationsSnapshot["runs"];
  snapshot: MissionControlSnapshot;
  surfaceTheme: "dark" | "light";
  expanded: boolean;
  selected: boolean;
  busyAction: { jobId: string; action: string } | null;
  onSelect: () => void;
  onToggle: () => void;
  onAction: (action: "run" | "pause" | "resume" | "retry" | "disable" | "cancel" | "delete", job: OperationJob) => Promise<void>;
  onDelete: () => void;
}) {
  const agent = snapshot.agents.find((entry) => entry.id === job.agentId) ?? null;
  const workspace = snapshot.workspaces.find((entry) => entry.id === job.workspaceId) ?? null;
  const sortedRuns = [...runs].sort((left, right) => Date.parse(right.startedAt ?? "") - Date.parse(left.startedAt ?? ""));
  const activeRun = sortedRuns.find((run) => run.status === "running" || run.status === "queued") ?? null;
  const firstRun = [...runs].filter((run) => run.startedAt).sort((left, right) => Date.parse(left.startedAt!) - Date.parse(right.startedAt!))[0] ?? null;
  const latestRun = sortedRuns[0] ?? null;
  const tokenValues = runs.map((run) => run.tokens).filter((value): value is number => typeof value === "number");
  const totalTokens = tokenValues.reduce((total, value) => total + value, 0);
  const isBusy = busyAction?.jobId === job.id;
  const runDisabled = isBusy || !job.capabilities.mutable || Boolean(activeRun);
  const mutableReason = job.capabilities.mutable ? undefined : job.capabilities.reason ?? "OpenClaw cron mutations are unavailable.";
  const pauseTitle = job.enabled
    ? activeRun
      ? "Pause future runs. The current OpenClaw run will continue because run cancellation is unsupported."
      : "Pause future scheduled runs"
    : "Resume this schedule";

  return <article className={cn(
    "group overflow-hidden rounded-xl border bg-card transition-all duration-200",
    selected ? "border-primary/30 shadow-[0_8px_28px_hsl(var(--primary)/0.09)] ring-1 ring-primary/10" : "border-border hover:border-primary/20 hover:shadow-sm"
  )}>
    <div className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:px-4">
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none" onClick={() => { onSelect(); onToggle(); }} aria-expanded={expanded}>
        <span className={cn("relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border", statusIconTone(job.status))}>
          {job.status === "running" ? <Activity className="h-4 w-4" /> : job.enabled ? <CalendarClock className="h-4 w-4" /> : <CirclePause className="h-4 w-4" />}
          {job.status === "running" ? <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full border-2 border-card bg-[hsl(var(--status-success))]" /> : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{job.name}</span>
            <StatusBadge
              label={job.status}
              tone={tone(job.status)}
              className={job.status === "scheduled" ? scheduledJobBadgeClassName(surfaceTheme) : undefined}
            />
          </span>
          <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span className="truncate">{agent?.name ?? job.agentId ?? "Unbound agent"}</span>
            <span aria-hidden="true">·</span>
            <span className="truncate">{humanSchedule(job)}</span>
            <span aria-hidden="true" className="hidden sm:inline">·</span>
            <span className="hidden truncate sm:inline">{job.nextRunAt ? `Next ${formatDateTime(job.nextRunAt)}` : job.enabled ? "Next run unavailable" : "Schedule paused"}</span>
          </span>
        </span>
      </button>

      <TooltipProvider delayDuration={140}>
        <div className="flex w-full shrink-0 items-center justify-end gap-1 border-t border-border/70 pt-2 sm:w-auto sm:border-0 sm:pt-0" onClick={(event) => event.stopPropagation()}>
          <JobActionTooltip label={activeRun ? "Run unavailable" : "Run once now"} detail={activeRun ? "This job already has an active OpenClaw run." : mutableReason ?? "Start one immediate run without changing the schedule."}>
            <Button type="button" variant="ghost" size="sm" className="h-8 w-8 rounded-lg p-0" disabled={runDisabled} aria-label={`Run ${job.name} once now`} onClick={() => void onAction("run", job)}>{isBusy && busyAction?.action === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}</Button>
          </JobActionTooltip>
          <JobActionTooltip label={job.enabled ? "Pause schedule" : "Resume schedule"} detail={mutableReason ?? pauseTitle}>
            <Button type="button" variant="ghost" size="sm" className="h-8 w-8 rounded-lg p-0" disabled={isBusy || !job.capabilities.mutable} aria-label={job.enabled ? `Pause ${job.name}` : `Resume ${job.name}`} onClick={() => void onAction(job.enabled ? "pause" : "resume", job)}>{isBusy && (busyAction?.action === "pause" || busyAction?.action === "resume") ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : job.enabled ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</Button>
          </JobActionTooltip>
          <JobActionTooltip label="Delete job" detail={mutableReason ?? "Permanently remove this job from OpenClaw after confirmation."}>
            <Button type="button" variant="ghost" size="sm" className="h-8 w-8 rounded-lg p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" disabled={isBusy || !job.capabilities.mutable} aria-label={`Delete ${job.name}`} onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
          </JobActionTooltip>
          <JobActionTooltip label={expanded ? "Collapse details" : "Expand details"} detail={expanded ? "Hide runtime, workspace, and usage details." : "Show runtime, workspace, next run, and token details."}>
            <button type="button" className="ml-0.5 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground" aria-label={expanded ? `Collapse ${job.name}` : `Expand ${job.name}`} aria-expanded={expanded} onClick={() => { onSelect(); onToggle(); }}><ChevronDown className={cn("h-4 w-4 transition-transform duration-200", expanded && "rotate-180")} /></button>
          </JobActionTooltip>
        </div>
      </TooltipProvider>
    </div>

    <div className={cn("grid transition-[grid-template-rows] duration-200 ease-out", expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
      <div className="min-h-0 overflow-hidden">
        <div className="border-t border-border bg-muted/[0.22] px-3 py-3 sm:px-4">
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <JobMetric icon={UserRound} label="Owner" value={agent?.name ?? job.agentId ?? "Unbound"} detail={job.model ?? agent?.modelId ?? "Default model"} />
            <JobMetric icon={Building2} label="Workspace" value={workspace?.name ?? job.workspaceId ?? "Unknown"} detail={workspace?.path ?? "Workspace path unavailable"} />
            <JobMetric icon={History} label="Runs" value={job.capabilities.runHistory ? String(runs.length) : "Unavailable"} detail={activeRun?.startedAt ? `Active since ${formatDateTime(activeRun.startedAt)}` : firstRun?.startedAt ? `First ${formatDateTime(firstRun.startedAt)}` : "Never observed"} />
            <JobMetric icon={Coins} label="Token usage" value={tokenValues.length ? formatCompactNumber(totalTokens) : "Not reported"} detail={tokenValues.length ? `Across ${tokenValues.length} reported run${tokenValues.length === 1 ? "" : "s"}` : "Gateway usage unavailable"} />
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <InlineDetail label="Current state" value={activeRun ? activeRun.status === "queued" ? "Queued in OpenClaw" : "Running now" : job.enabled ? job.status === "failed" ? "Failed — recovery needed" : "Waiting for next run" : "Paused"} tone={job.status === "failed" ? "danger" : activeRun ? "live" : "default"} />
            <InlineDetail label="Next run" value={job.nextRunAt ? formatDateTime(job.nextRunAt) : job.enabled ? "Not reported by Gateway" : "Paused"} />
            <InlineDetail label="Last run" value={latestRun?.startedAt ? `${formatDateTime(latestRun.startedAt)} · ${latestRun.status}` : job.lastRunAt ? formatDateTime(job.lastRunAt) : "No run history"} />
          </div>

          {latestRun?.error || latestRun?.output || job.latestOutput ? <div className={cn("mt-2 rounded-lg border px-3 py-2 text-[11px] leading-5", latestRun?.error ? "border-destructive/20 bg-destructive/[0.05] text-destructive" : "border-border bg-card text-muted-foreground")}><span className="mr-2 font-semibold uppercase tracking-[0.12em]">{latestRun?.error ? "Latest error" : "Latest result"}</span><span className="line-clamp-2">{latestRun?.error ?? latestRun?.output ?? job.latestOutput}</span></div> : null}
        </div>
      </div>
    </div>
  </article>;
}

function JobMetric({ icon: Icon, label, value, detail }: { icon: typeof UserRound; label: string; value: string; detail: string }) { return <div className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/[0.08] text-primary"><Icon className="h-3.5 w-3.5" /></span><span className="min-w-0"><span className="block text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</span><span className="mt-0.5 block truncate text-xs font-semibold text-foreground">{value}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{detail}</span></span></div>; }
function InlineDetail({ label, value, tone: detailTone = "default" }: { label: string; value: string; tone?: "default" | "live" | "danger" }) { return <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2"><span className="shrink-0 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</span><span className={cn("truncate text-right text-[11px] font-medium", detailTone === "live" ? "text-[hsl(var(--status-success))]" : detailTone === "danger" ? "text-destructive" : "text-foreground")}>{value}</span></div>; }
function JobActionTooltip({ label, detail, children }: { label: string; detail: string; children: React.ReactNode }) { return <Tooltip><TooltipTrigger asChild><span className="inline-flex">{children}</span></TooltipTrigger><TooltipContent side="top" className="max-w-[240px] px-3 py-2"><p className="text-[11px] font-semibold text-foreground">{label}</p><p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{detail}</p></TooltipContent></Tooltip>; }

function DeleteOperationDialog({ job, busy, onClose, onConfirm }: { job: OperationJob | null; busy: boolean; onClose: () => void; onConfirm: (job: OperationJob) => Promise<void> }) { return <Dialog open={Boolean(job)} onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="w-[calc(100vw-24px)] max-w-[440px] gap-0 overflow-hidden rounded-[20px] border-border bg-popover p-0"><div className="border-b border-border px-5 py-4 pr-12"><div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/10 text-destructive"><Trash2 className="h-4 w-4" /></span><DialogHeader className="space-y-1"><DialogTitle className="text-base">Delete operation?</DialogTitle><DialogDescription>This permanently removes the job from OpenClaw and clears its AgentOS operation metadata.</DialogDescription></DialogHeader></div></div><div className="px-5 py-4"><p className="text-sm font-semibold text-foreground">{job?.name}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Historical runtime evidence already held by OpenClaw may remain available through its session history. Future scheduled runs will stop.</p></div><div className="flex justify-end gap-2 border-t border-border bg-muted/25 px-5 py-3.5"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button type="button" variant="destructive" disabled={!job || busy} onClick={() => { if (job) void onConfirm(job); }}>{busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}{busy ? "Deleting…" : "Delete job"}</Button></div></DialogContent></Dialog>; }

function JobDetail({ job, runs, busy, onAction }: { job: OperationJob; runs: OperationsSnapshot["runs"]; busy: boolean; onAction: (action: "run" | "pause" | "resume" | "retry" | "disable" | "cancel" | "delete", job: OperationJob) => Promise<void> }) { return <div className="space-y-4"><div><p className="text-sm font-semibold text-foreground">{job.name}</p><p className="mt-1 text-xs text-muted-foreground">{job.description ?? "No description"}</p></div><div className="space-y-2"><KeyValue label="Owner" value={job.agentId ?? "Unknown"} /><KeyValue label="Schedule" value={schedule(job)} /><KeyValue label="Next run" value={job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : "Not scheduled"} /><KeyValue label="Health" value={job.health.degraded ? "Degraded" : job.health.successRate === null ? "No completed runs" : `${Math.round(job.health.successRate * 100)}% success`} /><KeyValue label="Concurrency" value={job.safety?.concurrency ?? "Not managed by AgentOS"} /><KeyValue label="Transport" value={job.capabilities.mutable ? "Native Gateway" : job.capabilities.reason ?? "Read-only"} /></div><div className="grid grid-cols-2 gap-2"><Button size="sm" disabled={busy || !job.capabilities.mutable} onClick={() => void onAction("run", job)}><Zap className="mr-1 h-3.5 w-3.5" />Run once now</Button><Button size="sm" variant="secondary" disabled={busy || !job.capabilities.mutable} onClick={() => void onAction(job.enabled ? "pause" : "resume", job)}>{job.enabled ? "Pause schedule" : "Resume schedule"}</Button></div><SectionCard title="Run history"><div className="divide-y divide-border">{runs.length ? runs.slice(0, 12).map((run) => <div key={run.id} className="px-3 py-2"><div className="flex justify-between gap-2"><StatusBadge label={run.status} tone={tone(run.status)} /><span className="text-[0.65rem] text-muted-foreground">{run.startedAt ? new Date(run.startedAt).toLocaleString() : "Unknown start"}</span></div>{run.error ? <p className="mt-1 text-xs text-destructive">{run.error}</p> : run.output ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{run.output}</p> : null}</div>) : <p className="p-3 text-xs text-muted-foreground">No Gateway run history is available.</p>}</div></SectionCard><p className="text-[0.67rem] leading-4 text-muted-foreground">Cancellation of an already-queued cron run is unavailable because OpenClaw does not expose a documented cron cancel RPC. AgentOS does not simulate it.</p></div>; }
function CreateOperationForm({ snapshot, activeWorkspaceId, onClose, onCreated }: { snapshot: MissionControlSnapshot; activeWorkspaceId: string | null; onClose: () => void; onCreated: () => Promise<void> }) {
  const agents = snapshot.agents.filter((agent) => !activeWorkspaceId || agent.workspaceId === activeWorkspaceId);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const selectedAgent = agents.find((agent) => agent.id === agentId) ?? null;
  const [model, setModel] = useState(selectedAgent?.modelId === "unassigned" ? "" : selectedAgent?.modelId ?? "");
  const [thinking, setThinking] = useState<"off" | "minimal" | "low" | "medium" | "high" | "xhigh">("medium");
  const [expression, setExpression] = useState("0 9 * * 1-5");
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [concurrency, setConcurrency] = useState<"allow" | "forbid" | "replace">("forbid");
  const [saving, setSaving] = useState(false);
  const presets = [
    { label: "Weekdays", detail: "09:00", value: "0 9 * * 1-5" },
    { label: "Daily", detail: "09:00", value: "0 9 * * *" },
    { label: "Hourly", detail: "On the hour", value: "0 * * * *" }
  ];
  const canSubmit = Boolean(name.trim() && prompt.trim() && agentId && expression.trim() && timezone.trim() && agents.length);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const agent = agents.find((entry) => entry.id === agentId);
    if (!agent || !canSubmit) return;
    setSaving(true);
    try {
      const response = await fetch("/api/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          name: name.trim(),
          description: description.trim() || null,
          prompt: prompt.trim(),
          agentId,
          workspaceId: agent.workspaceId,
          model: model.trim() || null,
          thinking,
          trigger: { kind: "cron", expression: expression.trim(), timezone: timezone.trim() },
          safety: { concurrency }
        })
      });
      const result = await response.json() as { error?: string };
      if (!response.ok || result.error) throw new Error(result.error || "OpenClaw rejected this job.");
      toast.success("Job created in OpenClaw.");
      await onCreated();
    } catch (error) {
      toast.error("Job was not created.", { description: error instanceof Error ? error.message : "Unknown error." });
    } finally {
      setSaving(false);
    }
  };

  return <>
    <PikoLoader
      open={saving}
      title="Creating operation"
      description="Saving the schedule and its OpenClaw execution settings."
    />
    <Dialog open onOpenChange={(nextOpen) => { if (!nextOpen && !saving) onClose(); }}>
    <DialogContent className="w-[calc(100vw-24px)] max-w-[720px] gap-0 overflow-hidden rounded-[22px] border-border bg-popover p-0 shadow-2xl">
      <form onSubmit={submit}>
        <div className="border-b border-border bg-gradient-to-r from-primary/[0.09] via-primary/[0.035] to-transparent px-6 py-5 pr-14">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary"><CalendarClock className="h-4.5 w-4.5" /></div>
            <DialogHeader className="space-y-1">
              <DialogTitle className="text-lg">New operation</DialogTitle>
              <DialogDescription>Create a recurring job in OpenClaw with an explicit owner, schedule, and concurrency policy.</DialogDescription>
            </DialogHeader>
          </div>
        </div>

        <div className="max-h-[calc(100dvh-190px)] space-y-5 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {!agents.length ? <div className="rounded-xl border border-[hsl(var(--status-warning)/0.3)] bg-[hsl(var(--status-warning)/0.08)] px-4 py-3 text-sm text-muted-foreground">This workspace has no available agent. Create or attach an agent before scheduling a job.</div> : null}

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground"><Sparkles className="h-3.5 w-3.5 text-primary" />Operation</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Morning operations brief" required /></Field>
              <Field label="Description" optional><Input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this operation owns" /></Field>
            </div>
            <Field label="Instructions"><Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe the outcome, constraints, and evidence the agent should return…" className="min-h-[104px] resize-y" required /></Field>
          </section>

          <section className="space-y-3 border-t border-border pt-5">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground"><Bot className="h-3.5 w-3.5 text-primary" />Owner & runtime</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Owner agent"><select value={agentId} onChange={(event) => { const nextId = event.target.value; const nextAgent = agents.find((agent) => agent.id === nextId); setAgentId(nextId); setModel(nextAgent?.modelId === "unassigned" ? "" : nextAgent?.modelId ?? ""); }} className={selectClassName} required>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></Field>
              <Field label="Model" optional><Input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Use agent default" /></Field>
              <Field label="Thinking"><select value={thinking} onChange={(event) => setThinking(event.target.value as typeof thinking)} className={selectClassName}><option value="off">Off</option><option value="minimal">Minimal</option><option value="low">Low</option><option value="medium">Balanced</option><option value="high">High</option><option value="xhigh">Extra high</option></select></Field>
              <Field label="Concurrency"><select value={concurrency} onChange={(event) => setConcurrency(event.target.value as typeof concurrency)} className={selectClassName}><option value="forbid">Forbid overlap (recommended)</option><option value="replace">Replace current run</option><option value="allow">Allow parallel runs</option></select></Field>
            </div>
          </section>

          <section className="space-y-3 border-t border-border pt-5">
            <div className="flex items-center gap-2 text-xs font-semibold text-foreground"><Clock3 className="h-3.5 w-3.5 text-primary" />Schedule</div>
            <div className="grid gap-2 sm:grid-cols-3">{presets.map((preset) => <button key={preset.value} type="button" onClick={() => setExpression(preset.value)} className={`rounded-xl border px-3 py-2.5 text-left transition-colors ${expression === preset.value ? "border-primary/35 bg-primary/10 text-primary" : "border-border bg-card text-foreground hover:bg-accent"}`}><span className="block text-xs font-semibold">{preset.label}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{preset.detail}</span></button>)}</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Cron expression"><Input value={expression} onChange={(event) => setExpression(event.target.value)} className="font-mono" required /></Field>
              <Field label="Timezone"><Input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Europe/Istanbul" required /></Field>
            </div>
            <div className="flex items-start gap-2 rounded-xl border border-border bg-muted/35 px-3.5 py-3 text-xs leading-5 text-muted-foreground"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /><span><strong className="font-medium text-foreground">{describeCron(expression)}</strong> in {timezone || "the selected timezone"}. DST resolution and execution remain authoritative in OpenClaw.</span></div>
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/25 px-6 py-4"><Button type="button" variant="ghost" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving || !canSubmit}><ShieldCheck className="mr-1.5 h-3.5 w-3.5" />{saving ? "Creating…" : "Create operation"}</Button></div>
      </form>
    </DialogContent>
    </Dialog>
  </>;
}

const selectClassName = "h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-sm outline-none focus:ring-2 focus:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50";
function Field({ label, optional = false, children }: { label: string; optional?: boolean; children: React.ReactNode }) { return <div className="space-y-1.5"><div className="flex items-center justify-between"><Label>{label}</Label>{optional ? <span className="text-[10px] text-muted-foreground">Optional</span> : null}</div>{children}</div>; }
function describeCron(expression: string) { const normalized = expression.trim(); if (normalized === "0 9 * * 1-5") return "Every weekday at 09:00"; if (normalized === "0 9 * * *") return "Every day at 09:00"; if (normalized === "0 * * * *") return "Every hour, on the hour"; return normalized ? `Custom schedule (${normalized})` : "Enter a schedule"; }
function schedule(job: OperationJob) { if (!job.trigger) return "Unknown schedule"; return job.trigger.kind === "cron" ? `${job.trigger.expression} · ${job.trigger.timezone ?? "Gateway local time"}` : job.trigger.kind === "every" ? `Every ${Math.round(job.trigger.everyMs / 60000)} min` : `Once at ${new Date(job.trigger.at).toLocaleString()}`; }
function humanSchedule(job: OperationJob) { if (!job.trigger) return "Schedule unavailable"; if (job.trigger.kind === "every") return `Every ${formatDuration(job.trigger.everyMs)}`; if (job.trigger.kind === "at") return `Once · ${formatDateTime(job.trigger.at)}`; const description = describeCron(job.trigger.expression); return description.startsWith("Custom schedule") ? `${job.trigger.expression} · ${job.trigger.timezone ?? "Gateway timezone"}` : description; }
function formatDateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "Unknown" : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date); }
function formatDuration(milliseconds: number) { if (milliseconds < 60_000) return `${Math.round(milliseconds / 1_000)} sec`; if (milliseconds < 3_600_000) return `${Math.round(milliseconds / 60_000)} min`; if (milliseconds < 86_400_000) return `${Math.round(milliseconds / 3_600_000)} hr`; return `${Math.round(milliseconds / 86_400_000)} day`; }
function formatCompactNumber(value: number) { return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(value); }
function scheduledJobBadgeClassName(surfaceTheme: "dark" | "light") { return surfaceTheme === "light" ? "border-blue-300/70 bg-blue-50 text-blue-700 [&>span]:bg-blue-500" : "border-blue-300/25 bg-blue-300/10 text-blue-100 [&>span]:bg-blue-300"; }
function statusIconTone(status: OperationJob["status"]) { return status === "failed" ? "border-destructive/20 bg-destructive/[0.07] text-destructive" : status === "running" ? "border-[hsl(var(--status-success)/0.25)] bg-[hsl(var(--status-success)/0.08)] text-[hsl(var(--status-success))]" : status === "paused" ? "border-border bg-muted text-muted-foreground" : "border-primary/20 bg-primary/[0.08] text-primary"; }
function tone(status: string) { return status === "failed" || status === "error" ? "danger" : status === "running" || status === "queued" ? "warning" : status === "completed" || status === "ok" || status === "active" ? "success" : "muted" as const; }
