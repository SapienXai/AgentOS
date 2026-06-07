"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Activity, Bot, CircleCheck, Clock3, Import, MessageSquare, Play, Plus, ShieldCheck, SlidersHorizontal, Sparkles, Star, Filter } from "lucide-react";

import { AddModelsDialog } from "@/components/mission-control/add-models/add-models-dialog";
import { AgentCapabilityEditorDialog } from "@/components/mission-control/agent-capability-editor-dialog";
import { AgentChatDrawer } from "@/components/mission-control/agent-chat-drawer";
import { AgentModelPickerDialog } from "@/components/mission-control/agent-model-picker-dialog";
import { CreateAgentDialog } from "@/components/mission-control/create-agent-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";
import { buildAgentViews, formatBigNumber, statusToneForAgentFilter, summarizeTokens, type AgentFilter, type AgentView } from "@/components/operations/operations-data";
import { EmptyState, EntityIcon, FilterChip, InspectorPanelFrame, KeyValue, MoreButton, OperationsPageLayout, PageHeader, SearchToolbar, SectionCard, StatCard, StatGrid, StatusBadge, ToolbarButton, ViewToggle, type StatusTone } from "@/components/operations/operations-ui";
import { agentFilterLabel, formatAgentDisplayNameFromRecord, formatAgentSortLabel, MissionDispatchDialog, readClientError, sortAgentViews, toTitleCase } from "@/components/operations/operations-shared";

export function AgentsPageContent({
  snapshot,
  rootSnapshot,
  activeWorkspaceId,
  surfaceTheme,
  refresh,
  setSnapshot
}: {
  snapshot: MissionControlSnapshot;
  rootSnapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  surfaceTheme: "dark" | "light";
  refresh: () => Promise<void>;
  setSnapshot: Dispatch<SetStateAction<MissionControlSnapshot>>;
}) {
  const agents = useMemo(
    () => buildAgentViews(snapshot),
    [snapshot]
  );
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AgentFilter>("all");
  const [sort, setSort] = useState<"last-active" | "name" | "status" | "workspace">("last-active");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selectedId, setSelectedId] = useState(agents[0]?.id ?? "");
  const [chatAgentId, setChatAgentId] = useState<string | null>(null);
  const [modelAgentId, setModelAgentId] = useState<string | null>(null);
  const [capabilityAgentId, setCapabilityAgentId] = useState<string | null>(null);
  const [capabilityFocus, setCapabilityFocus] = useState<"skills" | "tools">("skills");
  const [dispatchAgent, setDispatchAgent] = useState<AgentView | null>(null);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [isAddModelsDialogOpen, setIsAddModelsDialogOpen] = useState(false);

  const filteredAgents = agents.filter((agent) => {
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      [agent.name, agent.purpose, agent.modelLabel, agent.policyLabel, agent.workspaceName]
        .join(" ")
        .toLowerCase()
        .includes(query);
    const matchesFilter = filter === "all" || agent.status === filter;
    return matchesSearch && matchesFilter;
  }).sort((left, right) => sortAgentViews(left, right, sort));
  const selectedAgent = filteredAgents.find((agent) => agent.id === selectedId) ?? filteredAgents[0] ?? null;
  const chatAgent = chatAgentId ? rootSnapshot.agents.find((agent) => agent.id === chatAgentId) ?? null : null;
  const runningCount = agents.filter((agent) => agent.status === "running").length;
  const readyCount = agents.filter((agent) => agent.status === "ready").length;
  const idleCount = agents.filter((agent) => agent.status === "idle").length;
  const approvalCount = agents.filter((agent) => agent.status === "needs-approval").length;
  const tokenTotal = summarizeTokens(snapshot);
  const filterCounts: Record<AgentFilter, number> = {
    all: agents.length,
    ready: readyCount,
    running: runningCount,
    idle: idleCount,
    "needs-approval": approvalCount
  };
  const sortModes: Array<typeof sort> = ["last-active", "name", "status", "workspace"];

  const openCapabilityEditor = (agentId: string, focus: "skills" | "tools") => {
    setCapabilityAgentId(agentId);
    setCapabilityFocus(focus);
  };

  const deleteAgent = async (agent: AgentView) => {
    if (!agent.source) {
      toast.message("Delete is unavailable.", {
        description: "This row is not backed by an AgentOS agent record."
      });
      return;
    }

    if (!window.confirm(`Delete ${agent.name}? This removes the OpenClaw agent from AgentOS.`)) {
      return;
    }

    setDeletingAgentId(agent.id);

    try {
      const response = await fetch("/api/agents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agent.source.id })
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok || result?.error) {
        throw new Error(result?.error || "Agent deletion failed.");
      }
      toast.success("Agent deleted.");
      setSelectedId("");
      await refresh();
    } catch (error) {
      toast.error("Agent deletion failed.", {
        description: readClientError(error)
      });
    } finally {
      setDeletingAgentId(null);
    }
  };

  return (
    <>
      <OperationsPageLayout
        main={
          <>
          <PageHeader
            surfaceTheme={surfaceTheme}
            title="Agents"
            subtitle="Manage your AI workforce. Monitor health, configure capabilities, and run agents at scale."
            actions={
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs"
                  disabled
                  title="Agent import requires a backend import contract."
                >
                  <Import className="mr-1.5 h-3.5 w-3.5" />
                  Import Agent
                </Button>
                <CreateAgentDialog
                  snapshot={rootSnapshot}
                  defaultWorkspaceId={activeWorkspaceId}
                  onRefresh={refresh}
                  onSnapshotChange={(updater) => setSnapshot((current) => updater(current))}
                  onAgentCreated={setSelectedId}
                  onAgentCreatedVisible={setSelectedId}
                  surfaceTheme={surfaceTheme}
                  trigger={
                    <Button
                      size="sm"
                      className="h-8 rounded-lg px-3 text-xs"
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Create Agent
                    </Button>
                  }
                />
              </>
            }
          />

          <StatGrid columns={5}>
            <StatCard label="Total Agents" value={String(agents.length)} detail={`${snapshot.workspaces.length} workspaces`} icon={Bot} tone="info" />
            <StatCard label="Active" value={String(runningCount)} detail={`${Math.round((runningCount / Math.max(1, agents.length)) * 100)}% of total`} icon={Activity} tone="success" />
            <StatCard label="Idle" value={String(idleCount)} detail={`${Math.round((idleCount / Math.max(1, agents.length)) * 100)}% of total`} icon={Clock3} tone="warning" />
            <StatCard label="Needs Approval" value={String(approvalCount)} detail={`${Math.round((approvalCount / Math.max(1, agents.length)) * 100)}% of total`} icon={ShieldCheck} tone="danger" />
            <StatCard label="Runtime Tokens" value={formatBigNumber(tokenTotal)} detail={tokenTotal ? "From live runtimes" : "No runtime token usage reported"} icon={Sparkles} tone="purple" />
          </StatGrid>

          <SearchToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search agents..."
            surfaceTheme={surfaceTheme}
            right={<ViewToggle value={view} onChange={setView} surfaceTheme={surfaceTheme} />}
          >
            <ToolbarButton surfaceTheme={surfaceTheme} icon={Filter} label={`Filter: ${agentFilterLabel(filter)}`} active={filter !== "all"} onClick={() => setFilter("all")} />
            <ToolbarButton surfaceTheme={surfaceTheme} icon={SlidersHorizontal} label={`Sort: ${formatAgentSortLabel(sort)}`} chevron onClick={() => setSort((current) => sortModes[(sortModes.indexOf(current) + 1) % sortModes.length])} />
          </SearchToolbar>

          <div className="flex flex-wrap items-center gap-2">
            {(["all", "ready", "running", "idle", "needs-approval"] as AgentFilter[]).map((id) => (
              <FilterChip
                key={id}
                label={agentFilterLabel(id)}
                count={filterCounts[id]}
                active={filter === id}
                tone={statusToneForAgentFilter(id)}
                surfaceTheme={surfaceTheme}
                onClick={() => setFilter(id)}
              />
            ))}
          </div>

          {filteredAgents.length > 0 ? (
            <div className={cn(view === "grid" ? "grid gap-2.5 lg:grid-cols-2 min-[1400px]:grid-cols-3" : "flex flex-col gap-2.5")}>
              {filteredAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  selected={selectedAgent?.id === agent.id}
                  list={view === "list"}
                  onSelect={() => setSelectedId(agent.id)}
                  onMessage={() => setChatAgentId(agent.id)}
                  onRunTask={() => setDispatchAgent(agent)}
                />
              ))}
            </div>
          ) : (
            <EmptyState title="No agents match your filters" description="Clear search or switch back to All to see every OpenClaw agent in this workspace." />
          )}

          <RecentAgentActivity snapshot={snapshot} agents={agents} />
        </>
      }
      inspector={selectedAgent ? (
        <AgentInspector
          agent={selectedAgent}
          deleting={deletingAgentId === selectedAgent.id}
          onMessage={() => setChatAgentId(selectedAgent.id)}
          onRunTask={() => setDispatchAgent(selectedAgent)}
          onChangeModel={() => setModelAgentId(selectedAgent.id)}
          onManagePolicy={() => openCapabilityEditor(selectedAgent.id, "skills")}
          onManageTools={() => openCapabilityEditor(selectedAgent.id, "tools")}
          onDelete={() => void deleteAgent(selectedAgent)}
        />
      ) : null}
    />
      <Dialog open={Boolean(chatAgent)} onOpenChange={(open) => setChatAgentId(open ? chatAgentId : null)}>
        <DialogContent className="flex h-[min(82dvh,760px)] max-w-3xl flex-col rounded-[18px] p-4">
          <DialogHeader>
            <DialogTitle>{chatAgent ? `Message ${formatAgentDisplayNameFromRecord(chatAgent)}` : "Agent Chat"}</DialogTitle>
            <DialogDescription>
              Messages are sent through the existing AgentOS/OpenClaw agent chat runner.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            {chatAgent ? (
              <AgentChatDrawer
                agent={chatAgent}
                snapshot={rootSnapshot}
                surfaceTheme={surfaceTheme}
                isVisible={Boolean(chatAgent)}
                onRefresh={refresh}
                onSnapshotChange={(updater) => setSnapshot((current) => updater(current))}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <AgentModelPickerDialog
        open={Boolean(modelAgentId)}
        agentId={modelAgentId}
        snapshot={rootSnapshot}
        onOpenChange={(open) => setModelAgentId(open ? modelAgentId : null)}
        onSnapshotChange={(updater) => setSnapshot((current) => updater(current))}
        onRefresh={refresh}
        onOpenAddModels={() => setIsAddModelsDialogOpen(true)}
      />
      <AddModelsDialog
        open={isAddModelsDialogOpen}
        onOpenChange={setIsAddModelsDialogOpen}
        snapshot={rootSnapshot}
        onSnapshotChange={setSnapshot}
      />
      <AgentCapabilityEditorDialog
        open={Boolean(capabilityAgentId)}
        agentId={capabilityAgentId}
        initialFocus={capabilityFocus}
        snapshot={rootSnapshot}
        onOpenChange={(open) => setCapabilityAgentId(open ? capabilityAgentId : null)}
        onSnapshotChange={(updater) => setSnapshot((current) => updater(current))}
        onRefresh={refresh}
      />
      <MissionDispatchDialog
        open={Boolean(dispatchAgent)}
        agent={dispatchAgent}
        onOpenChange={(open) => setDispatchAgent(open ? dispatchAgent : null)}
        onSubmitted={refresh}
      />
    </>
  );
}

function AgentCard({
  agent,
  selected,
  list,
  onSelect,
  onMessage,
  onRunTask
}: {
  agent: AgentView;
  selected: boolean;
  list: boolean;
  onSelect: () => void;
  onMessage: () => void;
  onRunTask: () => void;
}) {
  const Icon = agent.icon;
  const heartbeatLabel = agent.source?.heartbeat.enabled
    ? agent.source.heartbeat.every ?? "on"
    : "off";
  const roleLabel = agent.source?.policy.preset ? toTitleCase(agent.source.policy.preset) : agent.policyLabel;
  const statusVariant = toAgentBadgeVariant(agent.statusTone);
  const onlineLabel = agent.online ? "Online" : "Offline";

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
        "agent-node group relative isolate overflow-hidden rounded-lg border border-border bg-card text-left shadow-card backdrop-blur-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        list ? "md:grid md:grid-cols-[220px_minmax(0,1fr)]" : "",
        selected && "border-primary/50 shadow-[0_0_0_1px_hsl(var(--primary)/0.12),0_22px_64px_hsl(var(--primary)/0.12)]"
      )}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,hsl(var(--primary)/0.12),transparent_36%),radial-gradient(circle_at_84%_18%,hsl(var(--status-success)/0.07),transparent_28%)]" />
        <div className="absolute inset-y-4 left-0 w-[3px] rounded-r-full bg-[linear-gradient(180deg,hsl(var(--primary)/0.86),hsl(var(--primary)/0.12))]" />
      </div>

      <div className={cn("relative overflow-hidden border-b border-white/[0.12] bg-[linear-gradient(180deg,rgba(14,16,20,0.98),rgba(8,10,14,0.95))]", list ? "h-full min-h-[210px] rounded-l-[24px] md:rounded-r-none" : "h-[154px] rounded-t-[24px]")}>
        <video
          className="pointer-events-none absolute inset-0 h-full w-full object-cover object-center brightness-[0.88] contrast-[1.04] saturate-[0.92]"
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
        >
          <source src="/assets/agent.mp4" type="video/mp4" />
        </video>
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(3,4,7,0.42),rgba(3,4,7,0.88)),radial-gradient(circle_at_center,transparent_38%,rgba(3,4,7,0.34)_100%),radial-gradient(circle_at_20%_10%,hsl(var(--primary)/0.08),transparent_34%),radial-gradient(circle_at_82%_18%,rgba(251,191,36,0.05),transparent_28%)]" />
        <div className="absolute left-3 top-3 z-20 flex items-center gap-2">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-slate-950/70 text-primary shadow-[0_12px_28px_rgba(0,0,0,0.28)] backdrop-blur-xl">
            <Icon className="h-4 w-4" />
          </span>
          <Badge variant={statusVariant} className="max-w-[150px] truncate px-2 py-1 text-[9px]">
            {agent.statusLabel}
          </Badge>
        </div>
        {selected ? (
          <span className="absolute right-3 top-3 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary shadow-[0_0_16px_hsl(var(--primary)/0.20)]">
            <CircleCheck className="h-3.5 w-3.5" />
          </span>
        ) : null}
        <div className="absolute inset-x-0 bottom-0 z-20 p-3.5">
          <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.22em] text-white/65">
            <span className={cn("h-1.5 w-1.5 rounded-full", agent.online ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.42)]" : "bg-slate-500")} />
            Agent
          </div>
          <h3 className="mt-1 truncate font-display text-[1.08rem] leading-5 text-white">{agent.name}</h3>
          <p className="mt-0.5 truncate text-[10px] uppercase tracking-[0.16em] text-amber-200/90">{roleLabel}</p>
        </div>
      </div>

      <div className="relative z-10 px-3.5 pb-3.5 pt-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="muted" className="max-w-[170px] truncate px-2 py-1 text-[9px] normal-case tracking-normal">
            {agent.modelLabel}
          </Badge>
          <Badge
            variant={agent.online ? "success" : "muted"}
            className={cn(
              "px-2 py-1 text-[9px] normal-case tracking-normal",
              agent.online && "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-100"
            )}
          >
            {onlineLabel}
          </Badge>
        </div>

        <div className="mt-2.5">
          <p className="line-clamp-2 min-h-10 text-[12px] leading-5 text-foreground/80">{agent.purpose}</p>
          <p className="mt-2 truncate text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
            Heartbeat {heartbeatLabel} · Last seen {agent.lastActiveLabel}
          </p>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <AgentCardStat label="Tools" value={agent.toolsCount} />
          <AgentCardStat label="Sessions" value={agent.sessionsCount} />
          <AgentCardStat label="Policy" value={agent.policyLabel} />
        </div>

        <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="h-10 rounded-full border-border bg-muted/35 px-2 text-xs text-foreground hover:bg-muted/60"
            onClick={(event) => {
              event.stopPropagation();
              onMessage();
            }}
          >
            <MessageSquare className="mr-1.5 h-3.5 w-3.5" /> Message
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={cn(
              "h-10 rounded-full border-primary/20 bg-primary/10 px-2 text-xs text-primary shadow-[0_10px_24px_rgba(245,158,11,0.18)] hover:border-primary/30 hover:bg-primary/15 hover:text-primary",
              "dark:border-amber-300/20 dark:bg-[linear-gradient(180deg,rgba(251,191,36,0.18),rgba(217,119,6,0.28))] dark:text-amber-50 dark:hover:border-amber-200/30 dark:hover:bg-amber-400/20 dark:hover:text-white"
            )}
            onClick={(event) => {
              event.stopPropagation();
              onRunTask();
            }}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" /> Run Task
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-10 rounded-full border-border bg-muted/35 px-3 text-muted-foreground"
            disabled
            title="Following agents requires backend support."
            onClick={(event) => event.stopPropagation()}
          >
            <Star className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="mt-3 overflow-hidden rounded-b-[18px] border-t border-border bg-muted/35 px-2.5 py-2 shadow-[inset_0_1px_0_hsl(var(--border)/0.35)]">
          <div className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/75 shadow-[0_0_10px_hsl(var(--primary)/0.25)]" />
            <p className="truncate text-[8px] uppercase leading-none tracking-[0.22em] text-muted-foreground">Agent details</p>
            <p className="ml-auto min-w-0 truncate text-[8px] leading-none text-muted-foreground">
              {agent.toolsCount} tool{agent.toolsCount === 1 ? "" : "s"} · {agent.sessionsCount} session
              {agent.sessionsCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentCardStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-[14px] border border-border bg-muted/45 px-2.5 py-2 text-center shadow-[inset_0_1px_0_hsl(var(--border)/0.35)] dark:bg-muted/35">
      <p className="truncate text-[8px] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-[13px] font-semibold leading-none text-foreground dark:text-slate-100">{value}</p>
    </div>
  );
}

function toAgentBadgeVariant(tone: StatusTone): "default" | "muted" | "success" | "warning" | "danger" {
  if (tone === "success") {
    return "success";
  }
  if (tone === "warning") {
    return "warning";
  }
  if (tone === "danger") {
    return "danger";
  }
  if (tone === "muted") {
    return "muted";
  }
  return "default";
}

function AgentInspector({
  agent,
  deleting,
  onMessage,
  onRunTask,
  onChangeModel,
  onManagePolicy,
  onManageTools,
  onDelete
}: {
  agent: AgentView;
  deleting: boolean;
  onMessage: () => void;
  onRunTask: () => void;
  onChangeModel: () => void;
  onManagePolicy: () => void;
  onManageTools: () => void;
  onDelete: () => void;
}) {
  return (
    <InspectorPanelFrame>
      <div className="flex items-start gap-3">
        <EntityIcon icon={agent.icon} label={agent.name} tone={agent.iconTone} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-base font-semibold leading-tight text-foreground">{agent.name}</h2>
            <MoreButton />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge label={agent.statusLabel} tone={agent.statusTone} />
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("h-1.5 w-1.5 rounded-full", agent.online ? "bg-emerald-400" : "bg-slate-500")} />
              {agent.online ? "Online" : "Offline"}
            </span>
          </div>
          <p className="mt-2.5 text-xs leading-5 text-foreground/80">{agent.purpose}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button variant="secondary" size="sm" className="h-8 rounded-[9px] px-2 text-xs" onClick={onMessage}>Message</Button>
        <Button variant="secondary" size="sm" className="h-8 rounded-[9px] px-2 text-xs" onClick={onRunTask}>Run Task</Button>
        <Button
          size="sm"
          className="h-8 rounded-[9px] bg-amber-400 px-2 text-xs text-slate-950 hover:bg-amber-300"
          disabled
          title="Following agents requires backend support."
        >
          Follow
        </Button>
      </div>

      <div className="mt-4 rounded-[10px] border border-border bg-muted/35 px-3">
        <KeyValue label="Role" value={agent.source?.policy.preset ? toTitleCase(agent.source.policy.preset) : agent.policyLabel} />
        <KeyValue label="Policy Mode" value={agent.policyLabel} action={<button className="text-primary" onClick={onManagePolicy}>Manage</button>} />
        <KeyValue label="Workspace Scope" value={`${agent.workspaceName} (Full Access)`} />
        <KeyValue label="Default Model" value={agent.modelLabel} action={<button className="text-primary" onClick={onChangeModel}>Change</button>} />
        <KeyValue label="Tools Enabled" value={`${agent.toolsCount} tools`} action={<button className="text-primary" onClick={onManageTools}>Manage</button>} />
      </div>

      <SectionCard title="Runtime Summary" className="mt-3">
        <div className="px-3 py-2 text-xs">
          <KeyValue label="Sessions" value={String(agent.sessionsCount)} />
          <KeyValue label="Active runtimes" value={String(agent.source?.activeRuntimeIds.length ?? 0)} />
          <KeyValue label="Status" value={agent.source?.status ?? agent.statusLabel} />
          <KeyValue label="Heartbeat" value={agent.source?.heartbeat.enabled ? agent.source.heartbeat.every ?? "Enabled" : "Disabled"} />
          <KeyValue label="Last active" value={agent.lastActiveLabel} />
        </div>
      </SectionCard>

      <SectionCard title="Backend Support" className="mt-3">
        <div className="space-y-2 p-3 text-xs leading-5 text-foreground/80">
          <p>Message, model changes, capability management, mission dispatch, and delete are connected to existing AgentOS/OpenClaw APIs.</p>
          <p className="text-muted-foreground">Follow/import actions are disabled because this codebase does not expose persistence or import contracts for them.</p>
        </div>
      </SectionCard>
      <Button
        variant="destructive"
        size="sm"
        className="mt-3 h-8 w-full rounded-[9px] text-xs"
        disabled={deleting || !agent.source}
        title={agent.source ? "Delete this AgentOS/OpenClaw agent." : "Delete requires a real agent record."}
        onClick={onDelete}
      >
        {deleting ? "Deleting..." : "Delete Agent"}
      </Button>
    </InspectorPanelFrame>
  );
}

function RecentAgentActivity({ snapshot, agents }: { snapshot: MissionControlSnapshot; agents: AgentView[] }) {
  const rows = snapshot.runtimes.slice(0, 4).map((runtime) => {
    const agent = agents.find((entry) => entry.id === runtime.agentId);
    return {
      agent: agent?.name || runtime.agentId || "OpenClaw",
      event: runtime.status === "completed" ? "Completed task" : runtime.status === "running" ? "Running task" : "Updated session",
      status: runtime.status,
      task: runtime.title || runtime.subtitle || runtime.id,
      time: runtime.updatedAt ? "recently" : "no activity"
    };
  });

  return (
    <SectionCard title="Recent Activity">
      {rows.length === 0 ? (
        <EmptyState title="No runtime activity" description="No agent runtime events were reported in the current AgentOS snapshot." />
      ) : (
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-left text-xs">
          <thead className="border-b border-border text-[0.58rem] uppercase tracking-[0.14em] text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 font-semibold">Agent</th>
              <th className="px-3 py-2.5 font-semibold">Event</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-3 py-2.5 font-semibold">Task</th>
              <th className="px-3 py-2.5 font-semibold">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-foreground/80">
            {rows.map((row, index) => (
              <tr key={`${row.agent}-${row.task}-${index}`} className="hover:bg-muted/50">
                <td className="px-3 py-2.5 text-foreground">{row.agent}</td>
                <td className="px-3 py-2.5">{row.event}</td>
                <td className="px-3 py-2.5"><StatusBadge label={row.status} tone={row.status === "completed" ? "success" : row.status === "running" ? "info" : "warning"} /></td>
                <td className="px-3 py-2.5">{row.task}</td>
                <td className="px-3 py-2.5">{row.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </SectionCard>
  );
}
