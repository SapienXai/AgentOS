"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, ChevronDown, CircleCheck, Clock3, ClipboardList, FileInput, Filter, FolderOpenDot, Layers3, MessageSquare, Plus, RefreshCw, Rows3, ShieldCheck, SlidersHorizontal, Sparkles, Users, X } from "lucide-react";

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
  buildTaskFollowUpConfidenceMetric,
  formatFollowUpDetail,
  type SubmittedTaskFollowUp,
  type TaskMetricItem
} from "@/components/mission-control/task-follow-up";
import {
  mergeTaskFollowUps,
  readTaskFollowUpsFromMetadata,
  resolveTaskFollowUpDisplayMessage
} from "@/lib/openclaw/domains/task-follow-up-records";
import { compactMissionText, formatTokens } from "@/lib/openclaw/presenters";

type OperationTaskTab = {
  id: string;
  index: number | null;
  kind: "task" | "follow-up";
  label: string;
  title: string;
  statusLabel: string;
};

export function TasksPageContent({
  snapshot,
  activeWorkspaceId,
  surfaceTheme,
  refresh
}: {
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  surfaceTheme: "dark" | "light";
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
            surfaceTheme={surfaceTheme}
            title="Tasks"
            subtitle="Plan, monitor, and execute work across your agents. Track progress and manage approvals."
            actions={
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs"
                  disabled
                  title="Task import requires a backend import contract."
                >
                  <FileInput className="mr-1.5 h-3.5 w-3.5" />
                  Import Tasks
                </Button>
                <Button
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
            surfaceTheme={surfaceTheme}
            right={<ViewToggle value={view === "board" ? "board" : "list"} labels={["Board", "List"]} surfaceTheme={surfaceTheme} onChange={(value) => setView(value === "grid" ? "board" : "list")} />}
          >
            <ToolbarButton surfaceTheme={surfaceTheme} icon={Filter} label={`Filter: ${formatTaskFilterLabel(filter)}`} active={filter !== "all"} onClick={() => setFilter("all")} />
            <ToolbarButton surfaceTheme={surfaceTheme} icon={SlidersHorizontal} label={`Sort: ${formatTaskSortLabel(sort)}`} chevron onClick={() => setSort((current) => sortModes[(sortModes.indexOf(current) + 1) % sortModes.length])} />
            <ToolbarButton surfaceTheme={surfaceTheme} icon={Layers3} label="Group: Status" active disabled title="The board is grouped by status." />
          </SearchToolbar>

          <div className="flex flex-wrap items-center gap-2">
            {(["all", "queued", "running", "approval", "stalled", "completed", "cancelled"] as Array<"all" | TaskView["status"]>).map((id) => (
              <FilterChip
                key={id}
                label={formatTaskFilterLabel(id)}
                count={id === "all" ? tasks.length : statusCounts[id]}
                active={filter === id}
                tone={resolveTaskTone(id)}
                surfaceTheme={surfaceTheme}
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
          <Icon className="h-3.5 w-3.5 text-primary" />
          <h2 className="text-[0.66rem] font-bold uppercase tracking-[0.13em] text-primary">
            {formatTaskFilterLabel(status)}
          </h2>
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[0.62rem] text-muted-foreground">{tasks.length}</span>
        </div>
        <button className="text-muted-foreground" type="button" disabled title="Use Create Task to submit a mission through the supported dispatch flow.">
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
          className="rounded-[10px] border border-border bg-muted/35 px-3 py-2.5 text-xs text-muted-foreground"
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
  const cardRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [composerExpanded, setComposerExpanded] = useState(false);
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
  const displayTitle = activeFollowUp
    ? resolveTaskFollowUpDisplayMessage(activeFollowUp) ?? activeFollowUp.message
    : task.title;
  const displayResultTitle = activeFollowUp ? "Follow-up result" : "Latest result";
  const displayResultText = activeFollowUp ? formatFollowUpDetail(activeFollowUp) : resultText;
  const displayStatus = activeFollowUp ? mapFollowUpStatus(activeFollowUp.status) : task.status;
  const displayStatusLabel = activeFollowUp ? formatFollowUpStatusLabel(displayStatus) : task.statusLabel;
  const displayStatusTone = activeFollowUp ? statusToneForFollowUp(displayStatus) : task.statusTone;
  const metrics = activeFollowUp ? buildFollowUpMetrics(activeFollowUp) : buildTaskMetrics(task);
  const tabs: OperationTaskTab[] = [
    {
      id: "task",
      index: null,
      kind: "task",
      label: "Task 1",
      title: compactMissionText(task.title, 28) || "Original task",
      statusLabel: task.statusLabel
    },
    ...followUps.map((followUp, index) => ({
      id: followUp.runId || followUp.id,
      index,
      kind: "follow-up" as const,
      label: "Follow-up",
      title: compactMissionText(resolveTaskFollowUpDisplayMessage(followUp) ?? followUp.message, 28) || "Follow-up",
      statusLabel: formatFollowUpStatusLabel(mapFollowUpStatus(followUp.status))
    }))
  ];
  const activeTabId = activeFollowUp ? activeFollowUp.runId || activeFollowUp.id : "task";
  const selectTaskTab = (nextIndex: number | null) => {
    setTitleExpanded(false);
    setActiveFollowUpIndex(nextIndex);
    onActiveFollowUpChange(nextIndex === null ? null : followUps[nextIndex] ?? null);
  };

  useEffect(() => {
    if (!composerExpanded) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!cardRef.current?.contains(event.target as globalThis.Node)) {
        setComposerExpanded(false);
        setTitleExpanded(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [composerExpanded]);

  return (
    <div
      ref={cardRef}
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
        "relative origin-center transform-gpu overflow-hidden rounded-lg border bg-card p-2.5 text-left shadow-card transition-[transform,box-shadow,border-color,background-color] hover:border-primary/20 hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        selected ? "border-primary/50 shadow-[0_0_0_1px_hsl(var(--primary)/0.12),0_18px_50px_hsl(var(--primary)/0.10)]" : "border-border",
        composerExpanded && "z-30 scale-[1.03] shadow-[0_28px_90px_rgba(0,0,0,0.42)]"
      )}
    >
      <div className="pointer-events-none absolute inset-y-5 left-0 w-1 rounded-r-full bg-primary/50" />
      <TaskCardTabs
        activeTabId={activeTabId}
        tabs={tabs}
        onAdd={() => {
          setComposerExpanded(true);
          composerInputRef.current?.focus();
        }}
        onSelect={(tab) => selectTaskTab(tab.index)}
      />
      <div className="min-w-0 rounded-[16px] border border-border bg-muted/25 p-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary shadow-[0_0_18px_hsl(var(--primary)/0.08)]">
                  <ClipboardList className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Task / <span className="text-emerald-700 dark:text-[hsl(var(--status-success-foreground))]">{task.agentName}</span>
                  </span>
                  <span className="mt-1 block truncate text-[0.68rem] text-muted-foreground">{task.category}</span>
                </span>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StatusBadge label={displayStatusLabel} tone={displayStatusTone} />
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
                "min-w-0 flex-1 font-display text-[1.45rem] font-semibold leading-tight text-foreground",
                !titleExpanded && "line-clamp-2"
              )}
            >
              {displayTitle}
            </h3>
            <span className="mt-1 shrink-0 rounded-full border border-border bg-card/75 p-1 text-muted-foreground transition-colors group-hover:border-primary/20 group-hover:text-foreground">
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", titleExpanded && "rotate-180")} />
            </span>
          </button>

          <TaskMetricRow metrics={metrics} compact className="mt-3" />

          {task.status === "running" ? (
            <div className="mt-3">
              <div className="mb-1 flex justify-between text-[0.68rem] text-muted-foreground">
                <span>{task.progress}%</span>
                <span>{task.tokenLabel}</span>
              </div>
              <ProgressBar value={task.progress} />
            </div>
          ) : null}

          <ExpandableTaskResult title={displayResultTitle} result={displayResultText} compact className="mt-3" />

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[0.68rem] text-muted-foreground">{task.dueLabel}</span>
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
      {task.source ? (
      <TaskFollowUpComposer
        task={task.source}
        latestResult={displayResultText}
        compact
        expanded={composerExpanded}
        onExpandRequest={() => setComposerExpanded(true)}
        textareaRef={composerInputRef}
        className="mt-2.5"
        onSubmitted={(followUp) => {
            const nextIndex = followUps.length;
            setActiveFollowUpIndex(nextIndex);
            setLocalFollowUps((current) => mergeTaskFollowUps(current, [followUp]));
            onActiveFollowUpChange(followUp);
            return onFollowUpComplete();
          }}
        />
      ) : null}
    </div>
  );
}

function TaskCardTabs({
  activeTabId,
  tabs,
  onAdd,
  onSelect
}: {
  activeTabId: string;
  tabs: OperationTaskTab[];
  onAdd: () => void;
  onSelect: (tab: OperationTaskTab) => void;
}) {
  const activeIndex = Math.max(tabs.findIndex((tab) => tab.id === activeTabId), 0);
  const selectByOffset = (offset: number) => {
    const nextTab = tabs[(activeIndex + offset + tabs.length) % tabs.length];
    if (nextTab) {
      onSelect(nextTab);
    }
  };

  return (
    <div
      className="mb-2 flex items-end gap-1.5 pb-px"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div
        role="tablist"
        aria-label="Task workspace tabs"
        className={cn(
          "min-w-0 items-end gap-1.5",
          tabs.length <= 7 ? "grid flex-1" : "flex min-w-max overflow-x-auto"
        )}
        style={tabs.length <= 7 ? { gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` } : undefined}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const Icon = tab.kind === "task" ? ClipboardList : MessageSquare;

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={`${tab.label}: ${tab.title}`}
              className={cn(
                "group/tab relative flex h-[50px] items-center gap-2 rounded-t-lg border px-2.5 text-left outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-ring/50",
                tabs.length <= 7 ? "min-w-0 w-full" : "min-w-[148px] max-w-[220px] shrink-0",
                active
                  ? "border-primary/25 bg-primary/10 text-foreground shadow-[0_-8px_24px_hsl(var(--primary)/0.10)]"
                  : "border-border bg-card/75 text-muted-foreground hover:border-primary/20 hover:bg-accent/50"
              )}
              onClick={() => onSelect(tab)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  selectByOffset(1);
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  selectByOffset(-1);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  if (tabs[0]) {
                    onSelect(tabs[0]);
                  }
                } else if (event.key === "End") {
                  event.preventDefault();
                  const lastTab = tabs[tabs.length - 1];
                  if (lastTab) {
                    onSelect(lastTab);
                  }
                }
              }}
            >
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border transition-colors",
                  active
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-200/24 dark:bg-emerald-300/[0.12] dark:text-emerald-100"
                    : "border-border bg-muted/35 text-muted-foreground group-hover/tab:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("flex items-center gap-1.5 text-[10px] font-semibold", active ? "text-emerald-700 dark:text-[hsl(var(--status-success-foreground))]" : "text-muted-foreground")}>
                  <span className="truncate">{tab.label}</span>
                  <span className={cn("h-1 w-1 shrink-0 rounded-full", taskCardTabStatusDotClassName(tab.statusLabel))} />
                </span>
                <span className="mt-0.5 block truncate text-[10px] font-semibold leading-4 text-foreground">
                  {tab.title}
                </span>
              </span>
              <span
                className={cn(
                  "absolute inset-x-2.5 bottom-0 h-0.5 rounded-full transition-all duration-200",
                  active ? "bg-[hsl(var(--status-success))] shadow-[0_0_14px_hsl(var(--status-success)/0.30)]" : "bg-transparent"
                )}
              />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="Focus follow-up composer"
        title="Focus follow-up composer"
        className="mb-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-card/75 text-muted-foreground outline-none transition-all duration-200 hover:border-primary/20 hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={onAdd}
      >
        <Plus className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}

function taskCardTabStatusDotClassName(statusLabel: string) {
  switch (statusLabel.toLowerCase()) {
    case "completed":
      return "bg-emerald-300";
    case "running":
    case "queued":
      return "bg-primary";
    case "stalled":
      return "bg-amber-300";
    case "cancelled":
      return "bg-rose-300";
    default:
      return "bg-slate-500";
  }
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
  const displayFollowUpMessage = activeFollowUp
    ? resolveTaskFollowUpDisplayMessage(activeFollowUp) ?? activeFollowUp.message
    : null;
  const displayTitle = displayFollowUpMessage || task.title;
  const displayObjective = displayFollowUpMessage || task.objective;
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
      <h2 className="text-base font-semibold text-foreground">{displayTitle}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusBadge label={displayStatusLabel} tone={displayStatusTone} />
        {activeFollowUp ? <span className="rounded-full bg-primary/10 px-2 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-primary">Follow-up</span> : null}
        <span className="font-mono text-[0.68rem] text-muted-foreground">ID: {task.id.slice(0, 18)}</span>
      </div>
      <SectionCard title="Assigned Agent" className="mt-3">
        <div className="flex items-center justify-between gap-2 p-2.5">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground">{task.agentName}</p>
            <p className="mt-1 text-[0.68rem] text-muted-foreground">{task.category} work item</p>
          </div>
          <Button variant="secondary" size="sm" className="h-7 rounded-[8px] px-2 text-[0.7rem]" disabled title="Task-to-agent messaging is not exposed from this inspector. Use the Agents page chat for direct messages.">Message</Button>
        </div>
      </SectionCard>
      <div className="mt-3 space-y-3">
        <div>
          <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Objective</p>
          <p className="mt-1.5 text-xs leading-5 text-foreground/80">{displayObjective}</p>
        </div>
        <div>
          <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Description</p>
          <p className="mt-1.5 whitespace-pre-wrap text-xs leading-5 text-foreground/80">{displayDescription}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-[10px] border border-border bg-muted/35 p-2.5">
        <MetricMini label="Status" value={displayStatusLabel} />
        <MetricMini label="Priority" value={task.priority} />
        <MetricMini label="Due" value={task.dueLabel} />
      </div>
      <div className="mt-3">
        <div className="mb-1.5 flex justify-between text-xs">
          <span className="text-muted-foreground">Progress</span>
          <span className="text-primary">{displayProgress}%</span>
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
      <div className="mt-4 rounded-[10px] border border-border bg-muted/35 px-3">
        <KeyValue label="Task Key" value={task.source?.key ?? "Not reported"} />
        <KeyValue label="Approvals" value={task.status === "approval" ? "Review required by task warnings" : "Not reported"} />
        <KeyValue label="Outputs / Files" value={`${task.artifactCount} files`} />
        <KeyValue label="Warnings" value={`${task.warningCount} warnings`} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button size="sm" className="h-8 rounded-[9px] bg-primary text-xs text-white hover:bg-primary/90" disabled title="Task details are already shown in this inspector.">Open</Button>
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
    ...(source ? [buildTaskFollowUpConfidenceMetric(source)] : []),
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
      value: formatTokens(followUp.tokenUsage?.total),
      highlighted: true
    },
    {
      icon: Rows3,
      label: "Feed",
      value: followUp.summary ? 1 : "n/a"
    },
    {
      icon: FolderOpenDot,
      label: "Runs",
      value: followUp.runId ? 1 : 0
    },
    {
      icon: Sparkles,
      label: "Files",
      value: followUp.createdFiles ? followUp.createdFiles.length : "n/a"
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
    case "timeout":
    case "timed_out":
    case "failed":
    case "error":
      return "stalled";
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
      <div className="divide-y divide-border px-3">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-center justify-between gap-2 py-2.5 text-[0.68rem]">
            <span className="min-w-0 truncate text-foreground/80">{task.title}</span>
            <span className="shrink-0 text-muted-foreground">{task.statusLabel}</span>
          </div>
        ))}
      </div>
      )}
    </SectionCard>
  );
}
