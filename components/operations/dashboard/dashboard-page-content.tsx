"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CircleCheck,
  Clock3,
  Inbox,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  TerminalSquare,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HumanControlInbox } from "@/components/operations/human-control-inbox";
import {
  OperatorRecoveryLink,
  OperatorScopeFreshness,
  OperatorTruthBadge
} from "@/components/operations/operator-truth-indicator";
import type { MissionControlSnapshot, WorkspaceRecord } from "@/lib/agentos/contracts";
import { presentOperatorRuntime } from "@/lib/agentos/ui/operator-runtime-projection";
import { compactPath, formatRelativeTime, formatTokens, resolveRelativeTimeReferenceMs } from "@/lib/openclaw/presenters";
import {
  buildAgentViews,
  buildTaskViews,
  type AgentView,
  type TaskView
} from "@/components/operations/operations-data";
import {
  EmptyState,
  EntityIcon,
  SectionCard,
  StatCard,
  StatGrid,
  StatusBadge,
  type StatusTone
} from "@/components/operations/operations-ui";
import { MissionDispatchDialog } from "@/components/operations/operations-shared";
import { cn } from "@/lib/utils";

const dashboardPanelClassName = "cockpit-panel";
const insetSurfaceClassName = "cockpit-inset";

export function DashboardPageContent({
  snapshot,
  rootSnapshot,
  activeWorkspace,
  activeWorkspaceId,
  connectionState,
  attentionRefreshGeneration,
  surfaceTheme,
  refresh,
}: {
  snapshot: MissionControlSnapshot;
  rootSnapshot: MissionControlSnapshot;
  activeWorkspace: WorkspaceRecord | null;
  activeWorkspaceId: string | null;
  connectionState: "connecting" | "live" | "retrying";
  attentionRefreshGeneration: number;
  surfaceTheme: "dark" | "light";
  refresh: () => Promise<void>;
}) {
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dashboardSearch, setDashboardSearch] = useState("");
  const agents = useMemo(() => buildAgentViews(snapshot), [snapshot]);
  const tasks = useMemo(() => buildTaskViews(snapshot), [snapshot]);
  const referenceMs = resolveRelativeTimeReferenceMs(rootSnapshot.generatedAt);
  const taskCounts = summarizeTasks(tasks);
  const runningAgents = agents.filter((agent) => agent.status === "running");
  const readyAgents = agents.filter((agent) => agent.status === "ready");
  const agentsNeedingApproval = agents.filter((agent) => agent.status === "needs-approval");
  const operatorRuntime = useMemo(
    () => presentOperatorRuntime(rootSnapshot, { connectionState }),
    [connectionState, rootSnapshot]
  );
  const activeRuntimeIssues = rootSnapshot.diagnostics.runtimeIssues.filter(
    (issue) => issue.status !== "resolved" && issue.status !== "dismissed"
  );
  const diagnosticInboxItems = buildDiagnosticInboxItems(rootSnapshot, activeRuntimeIssues);
  const currentTaskIssueCount = rootSnapshot.diagnostics.taskHealth?.currentIssue.count ?? taskCounts.attention;
  const runtimeAttentionCount = activeRuntimeIssues.length + diagnosticInboxItems.length + (operatorRuntime.state === "ready" ? 0 : 1);
  const needsAttentionCount = currentTaskIssueCount + runtimeAttentionCount;
  const dashboardQuery = dashboardSearch.trim().toLowerCase();
  const filteredAgents = useMemo(
    () => filterAgents(agents, dashboardQuery),
    [agents, dashboardQuery]
  );
  const activeTaskByAgentId = useMemo(() => buildActiveTaskByAgentId(tasks), [tasks]);
  const visibleAgents = filteredAgents.slice(0, 6);
  const activeTasks = useMemo(
    () => filterTasks(tasks.filter((task) => ["running", "queued", "approval", "stalled"].includes(task.status)), dashboardQuery).slice(0, 6),
    [dashboardQuery, tasks]
  );
  const activeWorkspaceLabel = activeWorkspace?.name ?? "All workspaces";
  const activeWorkspaceDetail = activeWorkspace?.path ? compactPath(activeWorkspace.path) : `${rootSnapshot.workspaces.length} workspaces visible`;

  return (
    <>
      <div className="flex flex-col gap-3">
        <header className="border-b border-border/80 pb-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <div className="hidden flex-wrap items-center gap-2 sm:flex">
                <OperatorTruthBadge projection={operatorRuntime} surfaceTheme={surfaceTheme} />
                <OperatorScopeFreshness projection={operatorRuntime} compact />
                <OperatorRecoveryLink projection={operatorRuntime} surfaceTheme={surfaceTheme} />
              </div>
              <h1 className="mt-1 font-display text-[1.7rem] font-semibold leading-tight tracking-normal text-foreground sm:mt-4">
                Home
              </h1>
              <p className="mt-1.5 max-w-3xl text-[0.8rem] leading-5 text-muted-foreground">
                See what is happening, what needs you, and whether the system is operational.
              </p>
              <p className="mt-2 text-[0.68rem] leading-4 text-muted-foreground/80">
                <span className="font-semibold text-foreground">Workspace view:</span> {activeWorkspaceLabel} · {activeWorkspaceDetail}
              </p>
            </div>

            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center xl:justify-end">
              <DashboardSearch
                value={dashboardSearch}
                onChange={setDashboardSearch}
                onClear={() => setDashboardSearch("")}
              />
              <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-11 rounded-xl px-3 text-xs sm:h-9 sm:rounded-lg"
                  onClick={() => void refresh()}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Refresh
                </Button>
                <Button
                  size="sm"
                  className="h-11 rounded-xl px-3 text-xs sm:h-9 sm:rounded-lg"
                  onClick={() => setDispatchOpen(true)}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Create Task
                </Button>
              </div>
            </div>
          </div>
        </header>

        <StatGrid columns={3}>
          <StatCard label="Active workforce" value={String(runningAgents.length)} detail={`${readyAgents.length} ready`} icon={Bot} tone="success" />
          <StatCard label="Active work" value={String(taskCounts.running + taskCounts.queued)} detail={`${taskCounts.running} running, ${taskCounts.queued} queued`} icon={Activity} tone="info" />
          <StatCard label="Needs your attention" value={String(needsAttentionCount)} detail={formatAttentionDetail(currentTaskIssueCount, runtimeAttentionCount)} icon={AlertTriangle} tone={needsAttentionCount > 0 ? "warning" : "muted"} />
        </StatGrid>

        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-12">
          <SectionCard
            title="Active workforce"
            action={<PanelLink href="/agents" label="View agents" />}
            className={cn(dashboardPanelClassName, "xl:col-span-7")}
          >
            <div className="space-y-3 p-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <MiniMetric label="Active" value={String(runningAgents.length)} detail="Currently running" tone="info" />
                <MiniMetric label="Ready" value={String(readyAgents.length)} detail="Available agents" tone="success" />
                <MiniMetric label="Needs Approval" value={String(agentsNeedingApproval.length)} detail="Agent attention" tone={agentsNeedingApproval.length > 0 ? "warning" : "muted"} />
              </div>
              {agents.length === 0 ? (
                <ActionEmptyState
                  title="No agents in this workspace"
                  description="AgentOS did not receive OpenClaw agents for the selected workspace."
                  actions={
                    <>
                      <Button asChild size="sm" className="h-8 rounded-lg px-3 text-xs">
                        <Link href="/agents">
                          <Bot className="mr-1.5 h-3.5 w-3.5" />
                          Add Agent
                        </Link>
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 rounded-lg px-3 text-xs"
                        onClick={() => setDispatchOpen(true)}
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        Create Task
                      </Button>
                    </>
                  }
                />
              ) : visibleAgents.length === 0 ? (
                <EmptyState title="No agents match this search" description="Clear the dashboard search to restore the full agent view." />
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {visibleAgents.map((agent) => (
                    <AgentSummaryCard
                      key={agent.id}
                      agent={agent}
                      activeTask={activeTaskByAgentId.get(agent.id) ?? null}
                    />
                  ))}
                </div>
              )}
            </div>
          </SectionCard>

          <div className={cn("space-y-3 xl:col-span-5")}>
            <HumanControlInbox surfaceTheme={surfaceTheme} attentionRefreshGeneration={attentionRefreshGeneration} />
            <div className={cn("grid grid-cols-2 gap-2 rounded-xl border p-3", insetSurfaceClassName)}>
              <div className="min-w-0">
                <p className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Task review</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{currentTaskIssueCount}</p>
                <PanelLink href="/tasks" label="Open tasks" />
              </div>
              <div className="min-w-0">
                <p className="text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Runtime signals</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{runtimeAttentionCount}</p>
                <PanelLink href="/settings#diagnostics" label="View diagnostics" />
              </div>
            </div>
            {diagnosticInboxItems.length > 0 ? (
              <CompactIssueList
                items={diagnosticInboxItems}
                title="Diagnostics"
                footer={
                  diagnosticInboxItems.length > 3 ? (
                    <PanelLink href="/settings#diagnostics" label="View all issues" />
                  ) : null
                }
              />
            ) : null}
          </div>

          <SectionCard
            title="Active work"
            action={<PanelLink href="/missions" label="View missions" />}
            className={cn(dashboardPanelClassName, "xl:col-span-7")}
          >
            {activeTasks.length === 0 ? (
              <div className="p-3">
                <ActionEmptyState
                  title="No active work"
                  description="There are no running, queued, approval, or stalled tasks in this workspace right now."
                  actions={
                    <>
                      <Button size="sm" className="h-8 rounded-lg px-3 text-xs" onClick={() => setDispatchOpen(true)}>
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        Create Task
                      </Button>
                      <Button asChild variant="secondary" size="sm" className="h-8 rounded-lg px-3 text-xs">
                        <Link href="/missions">New mission</Link>
                      </Button>
                    </>
                  }
                />
              </div>
            ) : filterTasks(activeTasks, dashboardQuery).length === 0 ? (
              <div className="p-3">
                <EmptyState title="No active work matches this search" description="Clear the search to restore the active work view." />
              </div>
            ) : (
              <div className="divide-y divide-border/70">
                {activeTasks.map((task) => (
                  <TaskActivityRow key={task.id} task={task} referenceMs={referenceMs} />
                ))}
              </div>
            )}
          </SectionCard>

          {operatorRuntime.state !== "ready" || operatorRuntime.transport.state !== "live" ? (
            <SectionCard
              title="System status"
              action={<PanelLink href="/settings#diagnostics" label="View diagnostics" />}
              className={cn(dashboardPanelClassName, "xl:col-span-5")}
            >
              <div className="space-y-3 p-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  <HealthSummaryRow
                    icon={Activity}
                    label="AgentOS stream"
                    value={operatorRuntime.transport.label}
                    tone={operatorRuntime.transport.state === "offline" ? "danger" : "warning"}
                  />
                  <HealthSummaryRow icon={TerminalSquare} label="OpenClaw runtime" value={operatorRuntime.stateLabel} tone={operatorRuntime.tone} />
                </div>
                <div className={cn("rounded-lg border p-4", insetSurfaceClassName)}>
                  <div className="flex items-start gap-3">
                    <EntityIcon icon={AlertTriangle} label="Attention required" tone={operatorRuntime.tone} size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">Runtime attention required</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{operatorRuntime.explanation}</p>
                    </div>
                  </div>
                  {operatorRuntime.primaryRecovery ? (
                    <Button asChild variant="secondary" size="sm" className="mt-3 h-8 w-full justify-between rounded-lg text-xs">
                      <Link href={operatorRuntime.primaryRecovery.href}>
                        {operatorRuntime.primaryRecovery.label}
                        <Settings2 className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            </SectionCard>
          ) : null}

        </div>
      </div>

      <MissionDispatchDialog
        open={dispatchOpen}
        agent={null}
        defaultWorkspaceId={activeWorkspaceId}
        onOpenChange={setDispatchOpen}
        onSubmitted={refresh}
      />
    </>
  );
}

function DashboardSearch({
  value,
  onChange,
  onClear
}: {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="relative min-w-0 flex-1 sm:w-[min(40vw,380px)] sm:flex-none">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search agents and tasks..."
        className="h-9 rounded-lg bg-card/70 pl-9 pr-9 text-xs"
        aria-label="Search dashboard agents and tasks"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear dashboard search"
          onClick={onClear}
          className="absolute right-2.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function PanelLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-[0.68rem] text-primary hover:text-primary">
      <Link href={href}>
        {label}
        <ArrowRight className="ml-1.5 h-3 w-3" />
      </Link>
    </Button>
  );
}

function ActionEmptyState({
  title,
  description,
  actions
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className={cn("flex min-h-[188px] flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center", insetSurfaceClassName)}>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">{description}</p>
      {actions ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

function MiniMetric({
  label,
  value,
  detail,
  tone = "muted"
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: StatusTone;
}) {
  return (
    <div className={cn("min-w-0 rounded-lg border p-2.5", insetSurfaceClassName, toneBorderClass(tone))}>
      <p className="text-[0.56rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-foreground">{value}</p>
      {detail ? <p className="mt-0.5 truncate text-[0.66rem] text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function AgentSummaryCard({
  agent,
  activeTask
}: {
  agent: AgentView;
  activeTask: TaskView | null;
}) {
  return (
    <div className={cn("min-w-0 rounded-lg border p-3", insetSurfaceClassName)}>
      <div className="flex min-w-0 items-start gap-3">
        <EntityIcon icon={agent.icon} label={agent.name} tone={agent.iconTone} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{agent.name}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{agent.purpose}</p>
            </div>
            <StatusBadge label={agent.statusLabel} tone={agent.statusTone} />
          </div>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <AgentDetail label="Task" value={activeTask?.title ?? "No active task"} />
            <AgentDetail label="Model" value={agent.modelLabel} />
            <AgentDetail label="Workspace" value={agent.workspaceName} />
            <AgentDetail label="Activity" value={agent.lastActiveLabel} />
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.56rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-[0.72rem] font-medium text-foreground">{value}</p>
    </div>
  );
}

function TaskActivityRow({ task, referenceMs }: { task: TaskView; referenceMs: number }) {
  const Icon = task.status === "completed" ? CircleCheck : task.status === "running" ? Activity : task.status === "stalled" ? AlertTriangle : Clock3;
  const tokenLabel =
    typeof task.source?.tokenUsage?.total === "number"
      ? `${formatTokens(task.source.tokenUsage.total)} tokens`
      : "No tokens reported";

  return (
    <div className="flex min-w-0 items-center gap-3 px-3 py-3">
      <EntityIcon icon={Icon} label={task.statusLabel} tone={task.statusTone} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-sm font-semibold text-foreground">{task.title}</p>
          <StatusBadge label={task.statusLabel} tone={task.statusTone} />
        </div>
        <p className="mt-1 truncate text-[0.72rem] text-muted-foreground">
          {task.agentName} / {formatRelativeTime(task.source?.updatedAt ?? null, referenceMs)} / {tokenLabel}
        </p>
      </div>
    </div>
  );
}

function CompactIssueList({
  title,
  items,
  footer
}: {
  title: string;
  items: string[];
  footer?: ReactNode;
}) {
  return (
    <div className={cn("rounded-lg border p-3", insetSurfaceClassName)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <EntityIcon icon={Inbox} label={title} tone="warning" size="sm" />
          <p className="text-xs font-semibold text-foreground">{title}</p>
        </div>
        <StatusBadge label={`${items.length} item${items.length === 1 ? "" : "s"}`} tone="warning" />
      </div>
      <div className="mt-3 space-y-2">
        {items.slice(0, 3).map((item) => (
          <details key={item} className="rounded-lg border border-[hsl(var(--status-warning)/0.22)] bg-[hsl(var(--status-warning)/0.08)] px-2.5 py-2">
            <summary className="cursor-pointer text-xs font-medium leading-5 text-[hsl(var(--status-warning-foreground))]">
              {truncateText(item, 112)}
            </summary>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{item}</p>
          </details>
        ))}
      </div>
      {footer ? <div className="mt-2">{footer}</div> : null}
    </div>
  );
}

function HealthSummaryRow({
  icon,
  label,
  value,
  tone
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: StatusTone;
}) {
  return (
    <div className={cn("flex min-w-0 items-center justify-between gap-3 rounded-lg border p-3", insetSurfaceClassName)}>
      <div className="flex min-w-0 items-center gap-2.5">
        <EntityIcon icon={icon} label={label} tone={tone} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-foreground">{label}</p>
          <p className="mt-0.5 truncate text-[0.7rem] text-muted-foreground">{value}</p>
        </div>
      </div>
      <StatusBadge label={value} tone={tone} />
    </div>
  );
}

function summarizeTasks(tasks: TaskView[]) {
  const running = tasks.filter((task) => task.status === "running").length;
  const queued = tasks.filter((task) => task.status === "queued").length;
  const completed = tasks.filter((task) => task.status === "completed").length;

  return {
    running,
    queued,
    completed,
    attention: new Set([
      ...tasks.filter((task) => task.status === "stalled" || task.status === "cancelled" || task.status === "approval").map((task) => task.id),
      ...tasks.filter((task) => (task.source?.warningCount ?? 0) > 0).map((task) => task.id)
    ]).size
  };
}

function buildAttentionItems(snapshot: MissionControlSnapshot) {
  return [
    ...snapshot.diagnostics.securityWarnings,
    ...snapshot.diagnostics.issues,
    ...snapshot.diagnostics.runtime.issues,
    ...(snapshot.diagnostics.capabilityMatrix?.diagnostics ?? []),
    snapshot.diagnostics.eventBridge?.message ?? "",
    snapshot.diagnostics.eventBridge?.recovery ?? "",
    ...(snapshot.diagnostics.gatewayFallbackReasons ?? []),
    ...(snapshot.diagnostics.capabilityMatrix?.fallbackReasons ?? [])
  ].filter((item, index, items) => item.trim() && items.indexOf(item) === index);
}

function buildDiagnosticInboxItems(
  snapshot: MissionControlSnapshot,
  activeRuntimeIssues: MissionControlSnapshot["diagnostics"]["runtimeIssues"]
) {
  const runtimeIssueText = activeRuntimeIssues
    .flatMap((issue) => [issue.title, issue.message, issue.errorMessage ?? ""])
    .join(" ")
    .toLowerCase();
  const fallbackDiagnostics = snapshot.diagnostics.gatewayFallbackDiagnostics ?? snapshot.diagnostics.capabilityMatrix?.fallbackDiagnostics ?? [];
  const unsupportedMethods = snapshot.diagnostics.capabilityMatrix?.unsupportedGatewayMethods ?? [];
  const candidates = [
    ...buildAttentionItems(snapshot),
    ...fallbackDiagnostics.map((diagnostic) => `${diagnostic.operationLabel || diagnostic.operation}: ${diagnostic.issue}`),
    ...unsupportedMethods.map((method) => `Unsupported Gateway method: ${method}`)
  ];

  return candidates
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index)
    .filter((item) => !runtimeIssueText.includes(item.toLowerCase()));
}

function buildActiveTaskByAgentId(tasks: TaskView[]) {
  const activeTaskByAgentId = new Map<string, TaskView>();
  const activeTasks = tasks.filter((task) => task.status === "running" || task.status === "queued" || task.status === "approval" || task.status === "stalled");

  for (const task of activeTasks) {
    const agentIds = new Set<string>();
    if (task.source?.primaryAgentId) {
      agentIds.add(task.source.primaryAgentId);
    }

    for (const agentId of task.source?.agentIds ?? []) {
      agentIds.add(agentId);
    }

    for (const agentId of agentIds) {
      if (!activeTaskByAgentId.has(agentId)) {
        activeTaskByAgentId.set(agentId, task);
      }
    }
  }

  return activeTaskByAgentId;
}

function filterAgents(agents: AgentView[], query: string) {
  if (!query) {
    return agents;
  }

  return agents.filter((agent) =>
    [agent.name, agent.purpose, agent.statusLabel, agent.modelLabel, agent.workspaceName]
      .join(" ")
      .toLowerCase()
      .includes(query)
  );
}

function filterTasks(tasks: TaskView[], query: string) {
  if (!query) {
    return tasks;
  }

  return tasks.filter((task) =>
    [task.title, task.agentName, task.category, task.statusLabel, task.objective, task.description]
      .join(" ")
      .toLowerCase()
      .includes(query)
  );
}

function formatAttentionDetail(taskAttentionCount: number, runtimeAttentionCount: number) {
  if (taskAttentionCount === 0 && runtimeAttentionCount === 0) {
    return "No review signals";
  }

  const parts = [];

  if (taskAttentionCount > 0) {
    parts.push(`${taskAttentionCount} task${taskAttentionCount === 1 ? "" : "s"}`);
  }

  if (runtimeAttentionCount > 0) {
    parts.push(`${runtimeAttentionCount} runtime`);
  }

  return parts.join(", ");
}

function truncateText(value: string, maxLength: number) {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 3).trim()}...`;
}

function toneBorderClass(tone: StatusTone) {
  if (tone === "success") {
    return "border-[hsl(var(--status-success)/0.28)]";
  }

  if (tone === "warning") {
    return "border-[hsl(var(--status-warning)/0.30)]";
  }

  if (tone === "danger") {
    return "border-[hsl(var(--status-danger)/0.30)]";
  }

  if (tone === "purple") {
    return "border-[hsl(var(--status-purple)/0.28)]";
  }

  if (tone === "muted") {
    return "border-border";
  }

  return "border-primary/25";
}
