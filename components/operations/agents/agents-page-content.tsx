"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Activity, Bot, CircleCheck, Clock3, Import, MessageSquare, Play, Plus, ShieldCheck, SlidersHorizontal, Sparkles, Star, Filter } from "lucide-react";

import { AddModelsDialog } from "@/components/mission-control/add-models/add-models-dialog";
import { AgentCapabilityEditorDialog } from "@/components/mission-control/agent-capability-editor-dialog";
import { AgentChatDrawer } from "@/components/mission-control/agent-chat-drawer";
import { AgentModelPickerDialog } from "@/components/mission-control/agent-model-picker-dialog";
import { CreateAgentDialog } from "@/components/mission-control/create-agent-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";
import { buildAgentViews, formatBigNumber, statusToneForAgentFilter, summarizeTokens, type AgentFilter, type AgentView } from "@/components/operations/operations-data";
import { EmptyState, EntityIcon, FilterChip, InspectorPanelFrame, KeyValue, MiniBadge, MoreButton, OperationsPageLayout, PageHeader, SearchToolbar, SectionCard, StatCard, StatGrid, StatusBadge, ToolbarButton, ViewToggle, pageSurface } from "@/components/operations/operations-ui";
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
                  className={cn(
                    "h-8 rounded-[10px] px-3 text-xs",
                    surfaceTheme === "light" && "border-[#e3d3c5] bg-white/85 !text-[#4c3a2e] hover:bg-[#fff8f2] hover:!text-[#4c3a2e]"
                  )}
                  style={
                    surfaceTheme === "light"
                      ? {
                          backgroundColor: "rgba(255, 255, 255, 0.85)",
                          borderColor: "#e3d3c5",
                          color: "#4c3a2e"
                        }
                      : undefined
                  }
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
                      className={cn(
                        "h-8 rounded-[10px] px-3 text-xs text-white",
                        surfaceTheme === "light"
                          ? "bg-[#5c4437] shadow-[#5c4437]/18 hover:bg-[#4d382d]"
                          : "bg-blue-500 shadow-blue-500/20 hover:bg-blue-400"
                      )}
                      style={
                        surfaceTheme === "light"
                          ? {
                              backgroundColor: "#5c4437",
                              boxShadow: "0 8px 18px rgba(92, 68, 55, 0.18)",
                              color: "#ffffff"
                            }
                          : undefined
                      }
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
        <DialogContent className="flex h-[min(82dvh,760px)] max-w-3xl flex-col rounded-[18px] border-white/[0.10] bg-[#08111f]/95 p-4">
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
        "group rounded-[12px] border p-3 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40",
        pageSurface,
        selected && "border-blue-400/70 bg-blue-500/[0.08] shadow-[0_0_0_1px_rgba(59,130,246,0.22),0_22px_64px_rgba(37,99,235,0.16)]"
      )}
    >
      <div className={cn("flex gap-3", list ? "items-center" : "items-start")}>
        <EntityIcon icon={agent.icon} label={agent.name} tone={agent.iconTone} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <StatusBadge label={agent.statusLabel} tone={agent.statusTone} />
              <h3 className="mt-1.5 truncate text-[0.88rem] font-semibold text-white">{agent.name}</h3>
              <p className="mt-1 line-clamp-2 text-[0.72rem] leading-4 text-slate-300">{agent.purpose}</p>
            </div>
            {selected ? <CircleCheck className="h-4 w-4 shrink-0 text-blue-300" /> : null}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <MiniBadge>{agent.modelLabel}</MiniBadge>
            <MiniBadge>Policy: {agent.policyLabel}</MiniBadge>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/[0.07] pt-2.5 text-[0.58rem] uppercase tracking-[0.11em] text-slate-500">
            <span>Tools <b className="ml-1 text-slate-200">{agent.toolsCount}</b></span>
            <span>Sessions <b className="ml-1 text-slate-200">{agent.sessionsCount}</b></span>
            <span>Last active <b className="ml-1 normal-case tracking-normal text-slate-200">{agent.lastActiveLabel}</b></span>
          </div>
          <div className="mt-2.5 grid grid-cols-[1fr_1fr_auto] gap-2">
            <Button variant="secondary" size="sm" className="h-8 rounded-[9px] px-2 text-xs" onClick={(event) => { event.stopPropagation(); onMessage(); }}>
              <MessageSquare className="mr-1.5 h-3.5 w-3.5" /> Message
            </Button>
            <Button variant="secondary" size="sm" className="h-8 rounded-[9px] px-2 text-xs" onClick={(event) => { event.stopPropagation(); onRunTask(); }}>
              <Play className="mr-1.5 h-3.5 w-3.5" /> Run Task
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="h-8 rounded-[9px] px-2.5"
              disabled
              title="Following agents requires backend support."
              onClick={(event) => event.stopPropagation()}
            >
              <Star className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
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
            <h2 className="text-base font-semibold leading-tight text-white">{agent.name}</h2>
            <MoreButton />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge label={agent.statusLabel} tone={agent.statusTone} />
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
              <span className={cn("h-1.5 w-1.5 rounded-full", agent.online ? "bg-emerald-400" : "bg-slate-500")} />
              {agent.online ? "Online" : "Offline"}
            </span>
          </div>
          <p className="mt-2.5 text-xs leading-5 text-slate-300">{agent.purpose}</p>
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

      <div className="mt-4 rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-3">
        <KeyValue label="Role" value={agent.source?.policy.preset ? toTitleCase(agent.source.policy.preset) : agent.policyLabel} />
        <KeyValue label="Policy Mode" value={agent.policyLabel} action={<button className="text-blue-300" onClick={onManagePolicy}>Manage</button>} />
        <KeyValue label="Workspace Scope" value={`${agent.workspaceName} (Full Access)`} />
        <KeyValue label="Default Model" value={agent.modelLabel} action={<button className="text-blue-300" onClick={onChangeModel}>Change</button>} />
        <KeyValue label="Tools Enabled" value={`${agent.toolsCount} tools`} action={<button className="text-blue-300" onClick={onManageTools}>Manage</button>} />
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
        <div className="space-y-2 p-3 text-xs leading-5 text-slate-300">
          <p>Message, model changes, capability management, mission dispatch, and delete are connected to existing AgentOS/OpenClaw APIs.</p>
          <p className="text-slate-500">Follow/import actions are disabled because this codebase does not expose persistence or import contracts for them.</p>
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
          <thead className="border-b border-white/[0.07] text-[0.58rem] uppercase tracking-[0.14em] text-slate-500">
            <tr>
              <th className="px-3 py-2.5 font-semibold">Agent</th>
              <th className="px-3 py-2.5 font-semibold">Event</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-3 py-2.5 font-semibold">Task</th>
              <th className="px-3 py-2.5 font-semibold">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.06] text-slate-300">
            {rows.map((row, index) => (
              <tr key={`${row.agent}-${row.task}-${index}`} className="hover:bg-white/[0.025]">
                <td className="px-3 py-2.5 text-white">{row.agent}</td>
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
