"use client";

import { useMemo, useState } from "react";
import { Activity, ChevronDown, CircleCheck, Clock3, ClipboardList, FileInput, Filter, FolderOpenDot, Layers3, Plus, RefreshCw, Rows3, ShieldCheck, SlidersHorizontal, Sparkles, Users, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";
import { buildTaskViews, formatBigNumber, summarizeTokens, taskStatusIcons, type TaskView } from "@/components/operations/operations-data";
import { EmptyState, FilterChip, InspectorPanelFrame, KeyValue, MoreButton, OperationsPageLayout, PageHeader, ProgressBar, SearchToolbar, SectionCard, StatCard, StatGrid, StatusBadge, ToolbarButton, ViewToggle, pageSurface } from "@/components/operations/operations-ui";
import { canCancelTask, formatTaskFilterLabel, formatTaskSortLabel, MetricMini, MissionDispatchDialog, resolveTaskTone, sortTaskViews, UnsupportedPanel } from "@/components/operations/operations-shared";
import {
  ExpandableTaskResult,
  TaskFollowUpComposer,
  TaskMetricRow,
  formatFollowUpDetail,
  type SubmittedTaskFollowUp,
  type TaskMetricItem
} from "@/components/mission-control/task-follow-up";
import {
  mergeTaskFollowUps,
  readTaskFollowUpsFromMetadata
} from "@/lib/openclaw/domains/task-follow-up-records";

export function TasksPageContent({
  snapshot,
  activeWorkspaceId,
  refresh
}: {
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  refresh: () => Promise<void>;
}) {
  const tasks = useMemo(
    () => buildTaskViews(snapshot),
    [snapshot]
  );
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | TaskView["status"]>("all");
  const [sort, setSort] = useState<"updated" | "title" | "status" | "agent">("updated");
  const [view, setView] = useState<"board" | "list">("board");
  const [selectedId, setSelectedId] = useState(tasks[0]?.id ?? "");
  const [activeFollowUpByTaskId, setActiveFollowUpByTaskId] = useState<Record<string, SubmittedTaskFollowUp | null>>({});
  const [dispatchOpen, setDispatchOpen] = useState(false);

  const filteredTasks = tasks.filter((task) => {
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      [task.title, task.agentName, task.category, task.objective, task.description].join(" ").toLowerCase().includes(query);
    const matchesFilter = filter === "all" || task.status === filter;
    return matchesSearch && matchesFilter;
  }).sort((left, right) => sortTaskViews(left, right, sort));
  const selectedTask = filteredTasks.find((task) => task.id === selectedId) ?? filteredTasks[0] ?? null;
  const selectedFollowUp = selectedTask ? activeFollowUpByTaskId[selectedTask.id] ?? null : null;
  const statusCounts: Record<TaskView["status"], number> = {
    queued: tasks.filter((task) => task.status === "queued").length,
    running: tasks.filter((task) => task.status === "running").length,
    approval: tasks.filter((task) => task.status === "approval").length,
    completed: tasks.filter((task) => task.status === "completed").length,
    cancelled: tasks.filter((task) => task.status === "cancelled").length,
    stalled: tasks.filter((task) => task.status === "stalled").length
  };
  const tokenTotal = snapshot.tasks.reduce((sum, task) => sum + (task.tokenUsage?.total ?? 0), 0) || summarizeTokens(snapshot);
  const sortModes: Array<typeof sort> = ["updated", "title", "status", "agent"];

  const abortTask = async (task: TaskView) => {
    if (!canCancelTask(task)) {
      toast.message("Cancel is unavailable.", {
        description: "Only live, queued, stalled, or approval tasks can be cancelled through the current task API."
      });
      return;
    }

    if (!task.source) {
      toast.message("Cancel is unavailable.", {
        description: "This row is not backed by an AgentOS task record."
      });
      return;
    }

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.source.id)}/abort`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: "Cancelled from Tasks page.",
          dispatchId: task.source.dispatchId ?? null
        })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok || result.error) {
        throw new Error(result.error || "Unable to cancel task.");
      }
      toast.success("Task cancellation requested.");
      await refresh();
    } catch (error) {
      toast.error("Task cancellation failed.", {
        description: error instanceof Error ? error.message : "Unknown task error."
      });
    }
  };

  return (
    <>
      <OperationsPageLayout
      main={
        <>
          <PageHeader
            title="Tasks"
            subtitle="Plan, monitor, and execute work across your agents. Track progress and manage approvals."
            actions={
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-[10px] px-3 text-xs"
                  disabled
                  title="Task import requires a backend import contract."
                >
                  <FileInput className="mr-1.5 h-3.5 w-3.5" />
                  Import Tasks
                </Button>
                <Button size="sm" className="h-8 rounded-[10px] bg-blue-500 px-3 text-xs text-white shadow-blue-500/20 hover:bg-blue-400" onClick={() => setDispatchOpen(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Create Task
                </Button>
              </>
            }
          />

          <StatGrid columns={4}>
            <StatCard label="Total Tasks" value={String(tasks.length)} detail={`${snapshot.tasks.length} tracked from snapshot`} icon={ClipboardList} tone="info" />
            <StatCard label="Running" value={String(statusCounts.running)} detail="Live task records" icon={Activity} tone="success" />
            <StatCard label="Queued" value={String(statusCounts.queued)} detail="Waiting to run" icon={Clock3} tone="warning" />
            <StatCard label="Needs Approval" value={String(statusCounts.approval)} detail="Warnings or review gates" icon={ShieldCheck} tone="danger" />
            <StatCard label="Completed" value={String(statusCounts.completed)} detail="Completed task records" icon={CircleCheck} tone="purple" />
            <StatCard label="Runtime Tokens" value={formatBigNumber(tokenTotal)} detail={tokenTotal ? "From live task/runtime usage" : "No token usage reported"} icon={Sparkles} tone="purple" />
          </StatGrid>

          <SearchToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search tasks..."
            right={<ViewToggle value={view === "board" ? "board" : "list"} labels={["Board", "List"]} onChange={(value) => setView(value === "grid" ? "board" : "list")} />}
          >
            <ToolbarButton icon={Filter} label={`Filter: ${formatTaskFilterLabel(filter)}`} active={filter !== "all"} onClick={() => setFilter("all")} />
            <ToolbarButton icon={SlidersHorizontal} label={`Sort: ${formatTaskSortLabel(sort)}`} chevron onClick={() => setSort((current) => sortModes[(sortModes.indexOf(current) + 1) % sortModes.length])} />
            <ToolbarButton icon={Layers3} label="Group: Status" active disabled title="The board is grouped by status." />
          </SearchToolbar>

          <div className="flex flex-wrap items-center gap-2">
            {(["all", "queued", "running", "approval", "stalled", "completed", "cancelled"] as Array<"all" | TaskView["status"]>).map((id) => (
              <FilterChip
                key={id}
                label={formatTaskFilterLabel(id)}
                count={id === "all" ? tasks.length : statusCounts[id]}
                active={filter === id}
                tone={resolveTaskTone(id)}
                onClick={() => setFilter(id)}
              />
            ))}
          </div>

          {filteredTasks.length === 0 ? (
            <EmptyState title="No tasks match your filters" description="Clear search or switch filters to inspect the current AgentOS task snapshot." />
          ) : view === "board" ? (
            <div className="grid gap-3 xl:grid-cols-2 min-[1800px]:grid-cols-3">
              {(["queued", "running", "approval", "stalled", "completed", "cancelled"] as TaskView["status"][]).map((status) => (
                <TaskColumn
                  key={status}
                  status={status}
                  tasks={filteredTasks.filter((task) => task.status === status)}
                  selectedId={selectedTask?.id}
                  onSelect={setSelectedId}
                  onAbort={abortTask}
                  onFollowUpComplete={refresh}
                  onActiveFollowUpChange={(task, followUp) => {
                    setSelectedId(task.id);
                    setActiveFollowUpByTaskId((current) => ({ ...current, [task.id]: followUp }));
                  }}
                />
              ))}
            </div>
          ) : (
            <SectionCard>
              <div className="flex flex-col gap-3 p-3">
                {filteredTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    selected={task.id === selectedTask?.id}
                    onSelect={() => setSelectedId(task.id)}
                    onAbort={() => abortTask(task)}
                    onFollowUpComplete={refresh}
                    onActiveFollowUpChange={(followUp) => {
                      setSelectedId(task.id);
                      setActiveFollowUpByTaskId((current) => ({ ...current, [task.id]: followUp }));
                    }}
                  />
                ))}
              </div>
            </SectionCard>
          )}

          <div className="grid gap-2.5 xl:grid-cols-2">
            <RecentTasksPanel tasks={tasks.slice(0, 5)} />
            <UnsupportedPanel
              title="Automation Controls"
              description="Task scheduling toggles, approval decisions, pause, and retry controls are not exposed by the current Operations backend. Existing live cancellation and mission dispatch remain enabled."
            />
          </div>
        </>
      }
      inspector={selectedTask ? (
        <TaskInspector
          task={selectedTask}
          activeFollowUp={selectedFollowUp}
          onAbort={() => abortTask(selectedTask)}
          onFollowUpComplete={refresh}
          onActiveFollowUpChange={(followUp) => {
            setActiveFollowUpByTaskId((current) => ({ ...current, [selectedTask.id]: followUp }));
          }}
        />
      ) : null}
    />
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

function TaskColumn({
  status,
  tasks,
  selectedId,
  onSelect,
  onAbort,
  onFollowUpComplete,
  onActiveFollowUpChange
}: {
  status: TaskView["status"];
  tasks: TaskView[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onAbort: (task: TaskView) => void;
  onFollowUpComplete: () => Promise<void>;
  onActiveFollowUpChange: (task: TaskView, followUp: SubmittedTaskFollowUp | null) => void;
}) {
  const Icon = taskStatusIcons[status];
  return (
    <section className={cn("rounded-[12px] p-2.5", pageSurface)}>
      <div className="flex items-center justify-between gap-2 px-1 pb-2.5">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-blue-300" />
          <h2 className="text-[0.66rem] font-bold uppercase tracking-[0.13em] text-blue-200">
            {formatTaskFilterLabel(status)}
          </h2>
          <span className="rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[0.62rem] text-slate-400">{tasks.length}</span>
        </div>
        <button className="text-slate-500" type="button" disabled title="Use Create Task to submit a mission through the supported dispatch flow.">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-2.5">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            selected={task.id === selectedId}
            onSelect={() => onSelect(task.id)}
            onAbort={() => onAbort(task)}
            onFollowUpComplete={onFollowUpComplete}
            onActiveFollowUpChange={(followUp) => onActiveFollowUpChange(task, followUp)}
          />
        ))}
        <button
          type="button"
          disabled
          title="Inline column creation is disabled; use Create Task to submit a mission through the supported dispatch flow."
          className="rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 text-xs text-slate-500"
        >
          <Plus className="mr-1.5 inline h-3.5 w-3.5" /> Add Task
        </button>
      </div>
    </section>
  );
}

function TaskCard({
  task,
  selected,
  onSelect,
  onAbort,
  onFollowUpComplete,
  onActiveFollowUpChange
}: {
  task: TaskView;
  selected: boolean;
  onSelect: () => void;
  onAbort: () => void;
  onFollowUpComplete: () => Promise<void>;
  onActiveFollowUpChange: (followUp: SubmittedTaskFollowUp | null) => void;
}) {
  const cancelEnabled = canCancelTask(task);
  const resultText = readTaskResultText(task);
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [localFollowUps, setLocalFollowUps] = useState<SubmittedTaskFollowUp[]>([]);
  const [activeFollowUpIndex, setActiveFollowUpIndex] = useState<number | null>(null);
  const persistedFollowUps = useMemo(
    () => (task.source ? readTaskFollowUpsFromMetadata(task.source.metadata) : []),
    [task.source]
  );
  const followUps = useMemo(
    () => mergeTaskFollowUps(localFollowUps, persistedFollowUps),
    [localFollowUps, persistedFollowUps]
  );
  const effectiveActiveFollowUpIndex =
    activeFollowUpIndex !== null && activeFollowUpIndex < followUps.length ? activeFollowUpIndex : null;
  const activeFollowUp =
    effectiveActiveFollowUpIndex !== null ? followUps[effectiveActiveFollowUpIndex] ?? null : null;
  const cardCount = 1 + followUps.length;
  const currentCardNumber = effectiveActiveFollowUpIndex === null ? 1 : effectiveActiveFollowUpIndex + 2;
  const nextCardNumber = currentCardNumber >= cardCount ? 1 : currentCardNumber + 1;
  const displayTitle = activeFollowUp ? activeFollowUp.message : task.title;
  const displayResultTitle = activeFollowUp ? `Follow-up ${currentCardNumber - 1}` : "Latest result";
  const displayResultText = activeFollowUp ? formatFollowUpDetail(activeFollowUp) : resultText;
  const displayStatus = activeFollowUp ? mapFollowUpStatus(activeFollowUp.status) : task.status;
  const displayStatusLabel = activeFollowUp ? formatFollowUpStatusLabel(displayStatus) : task.statusLabel;
  const displayStatusTone = activeFollowUp ? statusToneForFollowUp(displayStatus) : task.statusTone;
  const metrics = activeFollowUp ? buildFollowUpMetrics(activeFollowUp) : buildTaskMetrics(task);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "relative overflow-hidden rounded-[22px] border bg-[linear-gradient(180deg,rgba(12,19,33,0.96),rgba(5,10,20,0.96))] p-4 text-left shadow-[0_18px_50px_rgba(0,0,0,0.24)] transition-all hover:border-cyan-200/22 hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40",
        selected ? "border-cyan-300/45 shadow-[0_0_0_1px_rgba(34,211,238,0.16),0_18px_50px_rgba(0,0,0,0.32)]" : "border-white/[0.08]"
      )}
    >
      <div className="pointer-events-none absolute inset-y-5 left-0 w-1 rounded-r-full bg-cyan-300/45" />
      <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border border-cyan-200/18 bg-cyan-300/[0.06] text-cyan-200 shadow-[0_0_18px_rgba(45,212,191,0.09)]">
                  <ClipboardList className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Task / <span className="text-emerald-300">{task.agentName}</span>
                  </span>
                  <span className="mt-1 block truncate text-[0.68rem] text-slate-500">{task.category}</span>
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusBadge label={displayStatusLabel} tone={displayStatusTone} />
              {followUps.length > 0 ? (
                <button
                  type="button"
                  aria-label={`Current card ${currentCardNumber} of ${cardCount}; show card ${nextCardNumber}`}
                  title={`Current card ${currentCardNumber} of ${cardCount}; click to show card ${nextCardNumber}`}
                  className="inline-flex h-7 min-w-7 items-center justify-center rounded-full border border-cyan-200/16 bg-cyan-300/[0.07] px-2 font-mono text-[10px] font-semibold text-cyan-100 transition-colors hover:border-cyan-200/30 hover:bg-cyan-300/[0.12]"
                  onClick={(event) => {
                    event.stopPropagation();
                    const nextFollowUpIndex =
                      activeFollowUpIndex === null
                        ? 0
                        : effectiveActiveFollowUpIndex === null || effectiveActiveFollowUpIndex + 1 >= followUps.length
                          ? null
                          : effectiveActiveFollowUpIndex + 1;
                    setTitleExpanded(false);
                    setActiveFollowUpIndex(nextFollowUpIndex);
                    onActiveFollowUpChange(nextFollowUpIndex === null ? null : followUps[nextFollowUpIndex] ?? null);
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  {currentCardNumber}
                </button>
              ) : null}
              <MoreButton />
            </div>
          </div>

          <button
            type="button"
            aria-expanded={titleExpanded}
            className="group mt-3 flex w-full items-start gap-2 text-left"
            onClick={(event) => {
              event.stopPropagation();
              setTitleExpanded((current) => !current);
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            <h3
              className={cn(
                "min-w-0 flex-1 font-display text-[1.45rem] font-semibold leading-tight text-white",
                !titleExpanded && "line-clamp-2"
              )}
            >
              {displayTitle}
            </h3>
            <span className="mt-1 shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] p-1 text-slate-400 transition-colors group-hover:border-cyan-200/20 group-hover:text-slate-100">
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", titleExpanded && "rotate-180")} />
            </span>
          </button>

          <TaskMetricRow metrics={metrics} compact className="mt-4" />

          {task.status === "running" ? (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-[0.68rem] text-slate-400">
                <span>{task.progress}%</span>
                <span>{task.tokenLabel}</span>
              </div>
              <ProgressBar value={task.progress} />
            </div>
          ) : null}

          <ExpandableTaskResult title={displayResultTitle} result={displayResultText} compact className="mt-4" />

          {task.source ? (
            <TaskFollowUpComposer
              task={task.source}
              latestResult={resultText}
              compact
              className="mt-4"
              onSubmitted={(followUp) => {
                setActiveFollowUpIndex(followUps.length);
                setLocalFollowUps((current) => mergeTaskFollowUps(current, [followUp]));
                onActiveFollowUpChange(followUp);
                return onFollowUpComplete();
              }}
            />
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[0.68rem] text-slate-500">{task.dueLabel}</span>
            <Button
              variant="secondary"
              size="sm"
              className="h-8 rounded-[9px] px-2.5 text-[0.7rem]"
              disabled={!cancelEnabled}
              title={cancelEnabled ? "Cancel this task through the supported abort action." : "This task status cannot be cancelled."}
              onClick={(event) => { event.stopPropagation(); onAbort(); }}
            >
              <X className="mr-1.5 h-3 w-3" />
              Cancel
            </Button>
          </div>
      </div>
    </div>
  );
}

function TaskInspector({
  task,
  activeFollowUp,
  onAbort,
  onFollowUpComplete,
  onActiveFollowUpChange
}: {
  task: TaskView;
  activeFollowUp?: SubmittedTaskFollowUp | null;
  onAbort: () => void;
  onFollowUpComplete: () => Promise<void>;
  onActiveFollowUpChange: (followUp: SubmittedTaskFollowUp | null) => void;
}) {
  const cancelEnabled = canCancelTask(task);
  const displayStatus = activeFollowUp ? mapFollowUpStatus(activeFollowUp.status) : task.status;
  const displayStatusLabel = activeFollowUp ? formatFollowUpStatusLabel(displayStatus) : task.statusLabel;
  const displayStatusTone = activeFollowUp ? statusToneForFollowUp(displayStatus) : task.statusTone;
  const displayTitle = activeFollowUp?.message || task.title;
  const displayObjective = activeFollowUp?.message || task.objective;
  const displayDescription = activeFollowUp
    ? activeFollowUp.summary || formatFollowUpDetail(activeFollowUp)
    : task.description;
  const displayResult = activeFollowUp ? formatFollowUpDetail(activeFollowUp) : readTaskResultText(task);
  const displayProgress =
    activeFollowUp && displayStatus === "completed"
      ? 100
      : activeFollowUp && displayStatus === "running"
        ? 48
        : task.progress;
  return (
    <InspectorPanelFrame title="Task Details">
      <h2 className="text-base font-semibold text-white">{displayTitle}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusBadge label={displayStatusLabel} tone={displayStatusTone} />
        {activeFollowUp ? <span className="rounded-full bg-cyan-300/10 px-2 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-cyan-100">Follow-up</span> : null}
        <span className="font-mono text-[0.68rem] text-slate-500">ID: {task.id.slice(0, 18)}</span>
      </div>
      <SectionCard title="Assigned Agent" className="mt-3">
        <div className="flex items-center justify-between gap-2 p-2.5">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-white">{task.agentName}</p>
            <p className="mt-1 text-[0.68rem] text-slate-400">{task.category} work item</p>
          </div>
          <Button variant="secondary" size="sm" className="h-7 rounded-[8px] px-2 text-[0.7rem]" disabled title="Task-to-agent messaging is not exposed from this inspector. Use the Agents page chat for direct messages.">Message</Button>
        </div>
      </SectionCard>
      <div className="mt-3 space-y-3">
        <div>
          <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-slate-500">Objective</p>
          <p className="mt-1.5 text-xs leading-5 text-slate-300">{displayObjective}</p>
        </div>
        <div>
          <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-slate-500">Description</p>
          <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-slate-300">{displayDescription}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-[10px] border border-white/[0.08] bg-white/[0.03] p-2.5">
        <MetricMini label="Status" value={displayStatusLabel} />
        <MetricMini label="Priority" value={task.priority} />
        <MetricMini label="Due" value={task.dueLabel} />
      </div>
      <div className="mt-3">
        <div className="mb-1.5 flex justify-between text-xs">
          <span className="text-slate-400">Progress</span>
          <span className="text-blue-300">{displayProgress}%</span>
        </div>
        <ProgressBar value={displayProgress} />
      </div>
      <ExpandableTaskResult title={activeFollowUp ? "Follow-up result" : "Latest result"} result={displayResult} compact className="mt-3" />
      {task.source ? (
        <TaskFollowUpComposer
          task={task.source}
          latestResult={readTaskResultText(task)}
          compact
          className="mt-3"
          onSubmitted={(followUp) => {
            onActiveFollowUpChange(followUp);
            return onFollowUpComplete();
          }}
        />
      ) : null}
      <div className="mt-4 rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-3">
        <KeyValue label="Task Key" value={task.source?.key ?? "Not reported"} />
        <KeyValue label="Approvals" value={task.status === "approval" ? "Review required by task warnings" : "Not reported"} />
        <KeyValue label="Outputs / Files" value={`${task.artifactCount} files`} />
        <KeyValue label="Warnings" value={`${task.warningCount} warnings`} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button size="sm" className="h-8 rounded-[9px] bg-blue-500 text-xs text-white hover:bg-blue-400" disabled title="Task details are already shown in this inspector.">Open</Button>
        <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" disabled title="Pause is not exposed by the current task API.">Pause</Button>
        <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" disabled title="Retry/run-again requires a supported replay contract for the original mission.">Run Again</Button>
        <Button variant="destructive" size="sm" className="h-8 rounded-[9px] text-xs" disabled={!cancelEnabled} title={cancelEnabled ? "Cancel this task through the supported abort action." : "This task status cannot be cancelled."} onClick={onAbort}>Cancel</Button>
      </div>
    </InspectorPanelFrame>
  );
}

function buildTaskMetrics(task: TaskView): TaskMetricItem[] {
  const source = task.source;
  const sessionCount = readTaskSessionCount(task);
  const turnCount = readTaskTurnCount(task);
  const feedCount = source?.updateCount ?? source?.runtimeCount ?? 0;

  return [
    {
      icon: Users,
      label: "Sessions",
      value: sessionCount
    },
    {
      icon: RefreshCw,
      label: "Turns",
      value: turnCount
    },
    {
      icon: Sparkles,
      label: "Tokens",
      value: task.tokenLabel,
      highlighted: true
    },
    {
      icon: Rows3,
      label: "Feed",
      value: feedCount
    },
    {
      icon: FolderOpenDot,
      label: "Runs",
      value: task.source?.runtimeCount ?? turnCount
    },
    {
      icon: Sparkles,
      label: "Files",
      value: task.artifactCount
    }
  ];
}

function buildFollowUpMetrics(followUp: SubmittedTaskFollowUp): TaskMetricItem[] {
  return [
    {
      icon: Users,
      label: "Sessions",
      value: followUp.sessionId ? 1 : 0
    },
    {
      icon: RefreshCw,
      label: "Turns",
      value: followUp.runId ? 1 : 0
    },
    {
      icon: Sparkles,
      label: "Tokens",
      value: "0",
      highlighted: true
    },
    {
      icon: Rows3,
      label: "Feed",
      value: followUp.summary ? 1 : 0
    },
    {
      icon: FolderOpenDot,
      label: "Runs",
      value: followUp.runId ? 1 : 0
    },
    {
      icon: Sparkles,
      label: "Files",
      value: 0
    }
  ];
}

function mapFollowUpStatus(value: string | null | undefined): TaskView["status"] {
  switch (value) {
    case "queued":
    case "running":
    case "stalled":
    case "completed":
    case "cancelled":
      return value;
    default:
      return "running";
  }
}

function formatFollowUpStatusLabel(status: TaskView["status"]) {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Running";
    case "stalled":
      return "Stalled";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "approval":
      return "Needs Approval";
    default:
      return "Running";
  }
}

function statusToneForFollowUp(status: TaskView["status"]) {
  switch (status) {
    case "completed":
      return "success" as const;
    case "running":
    case "queued":
      return "info" as const;
    case "stalled":
      return "warning" as const;
    case "cancelled":
      return "danger" as const;
    default:
      return "muted" as const;
  }
}

function readTaskSessionCount(task: TaskView) {
  const metadataCount = task.source?.metadata.sessionCount;
  return typeof metadataCount === "number" && Number.isFinite(metadataCount)
    ? metadataCount
    : task.source?.sessionIds.length ?? 0;
}

function readTaskTurnCount(task: TaskView) {
  const metadataCount = task.source?.metadata.turnCount;
  return typeof metadataCount === "number" && Number.isFinite(metadataCount)
    ? metadataCount
    : task.source?.runtimeCount ?? 0;
}

function readTaskResultText(task: TaskView) {
  const source = task.source;
  const finalResponseText = readTaskMetadataString(source, "finalResponseText");
  const resultPreview = readTaskMetadataString(source, "resultPreview");
  return finalResponseText || resultPreview || source?.subtitle || task.description || "No result has been captured for this task yet.";
}

function readTaskMetadataString(task: TaskView["source"] | undefined, key: string) {
  const value = task?.metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function RecentTasksPanel({ tasks }: { tasks: TaskView[] }) {
  return (
    <SectionCard title="Recent Activity">
      {tasks.length === 0 ? (
        <EmptyState title="No task activity" description="No task records were reported in the current AgentOS snapshot." />
      ) : (
      <div className="divide-y divide-white/[0.06] px-3">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center justify-between gap-2 py-2.5 text-[0.68rem]">
            <span className="min-w-0 truncate text-slate-300">{task.title}</span>
            <span className="shrink-0 text-slate-500">{task.statusLabel}</span>
          </div>
        ))}
      </div>
      )}
    </SectionCard>
  );
}
