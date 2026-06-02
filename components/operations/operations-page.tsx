"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertTriangle,
  BellRing,
  Bot,
  BrainCircuit,
  Check,
  Chrome,
  CircleCheck,
  Clock3,
  ClipboardList,
  Database,
  FileInput,
  FilePlus2,
  FileText,
  Fingerprint,
  Filter,
  Folder,
  Gauge,
  HardDrive,
  Import,
  KeyRound,
  Layers3,
  ListFilter,
  MessageSquare,
  Pause,
  Play,
  Plug,
  Plus,
  RefreshCw,
  SearchCheck,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquareArrowOutUpRight,
  Star,
  UserCog,
  Upload,
  UserCheck,
  Workflow,
  X
} from "lucide-react";

import { AddModelsDialog } from "@/components/mission-control/add-models/add-models-dialog";
import { AgentCapabilityEditorDialog } from "@/components/mission-control/agent-capability-editor-dialog";
import { AgentChatDrawer } from "@/components/mission-control/agent-chat-drawer";
import { AgentModelPickerDialog } from "@/components/mission-control/agent-model-picker-dialog";
import { CreateAgentDialog } from "@/components/mission-control/create-agent-dialog";
import { WorkspaceContextFilesDialog } from "@/components/mission-control/workspace-context-files-dialog";
import { WorkspaceChannelsDialog } from "@/components/mission-control/workspace-channels-dialog";
import { OperationsShell } from "@/components/operations/operations-shell";
import {
  EmptyState,
  EntityIcon,
  FilterChip,
  InspectorPanelFrame,
  KeyValue,
  MiniBadge,
  MoreButton,
  PageHeader,
  ProgressBar,
  SearchToolbar,
  SectionCard,
  StatCard,
  StatGrid,
  StatusBadge,
  ToolbarButton,
  ViewToggle,
  pageSurface
} from "@/components/operations/operations-ui";
import {
  buildAgentViews,
  buildFileViews,
  buildIntegrationViews,
  buildModelViews,
  buildTaskViews,
  fileCollectionIcons,
  formatBigNumber,
  formatBytes,
  integrationStatusIcons,
  statusToneForAgentFilter,
  summarizeTokens,
  taskStatusIcons,
  type AgentFilter,
  type AgentView,
  type FileView,
  type IntegrationStatus,
  type IntegrationView,
  type ModelView,
  type TaskView
} from "@/components/operations/operations-data";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import type {
  AccountAccessPermission,
  AccountAccessRulesResponse,
  AccountAccessRuleView
} from "@/lib/agentos/account-access-policy-types";
import type {
  AccountLoginTargetsResponse,
  AccountLoginTargetView
} from "@/lib/agentos/account-login-target-types";
import type { AddModelsProviderId, AgentRecord, MissionControlSnapshot, WorkspaceRecord } from "@/lib/agentos/contracts";
import type {
  OpenClawBrowserDriver,
  OpenClawBrowserProfileMutationResponse,
  OpenClawBrowserProfilesResponse,
  OpenClawBrowserProfileView
} from "@/lib/openclaw/browser-profile-types";
import type {
  WorkspaceManagedFile,
  WorkspaceManagedFileReadResponse,
  WorkspaceManagedFileListResponse
} from "@/lib/openclaw/workspace-file-types";
import { isAddModelsProviderId } from "@/lib/openclaw/model-provider-registry";
import { cn } from "@/lib/utils";

export type OperationsPageId = "agents" | "tasks" | "files" | "accounts" | "models" | "integrations";

export function OperationsPage({
  initialSnapshot,
  page
}: {
  initialSnapshot: MissionControlSnapshot;
  page: OperationsPageId;
}) {
  return (
    <OperationsShell initialSnapshot={initialSnapshot}>
      {(context) => {
        if (page === "agents") {
          return (
            <AgentsPageContent
              snapshot={context.snapshot}
              rootSnapshot={context.rootSnapshot}
              activeWorkspaceId={context.activeWorkspaceId}
              refresh={context.refresh}
              setSnapshot={context.setSnapshot}
            />
          );
        }

        if (page === "tasks") {
          return (
            <TasksPageContent
              snapshot={context.snapshot}
              activeWorkspaceId={context.activeWorkspaceId}
              refresh={context.refresh}
            />
          );
        }

        if (page === "files") {
          return (
            <FilesPageContent
              snapshot={context.snapshot}
              activeWorkspaceId={context.activeWorkspaceId}
            />
          );
        }

        if (page === "accounts") {
          return (
            <AccountsPageContent
              snapshot={context.snapshot}
              activeWorkspace={context.activeWorkspace}
              activeWorkspaceId={context.activeWorkspaceId}
            />
          );
        }

        if (page === "models") {
          return (
            <ModelsPageContent
              snapshot={context.snapshot}
              rootSnapshot={context.rootSnapshot}
              refresh={context.refresh}
              setSnapshot={context.setSnapshot}
            />
          );
        }

        return (
          <IntegrationsPageContent
            snapshot={context.snapshot}
            rootSnapshot={context.rootSnapshot}
            activeWorkspaceId={context.activeWorkspaceId}
            refresh={context.refresh}
            setSnapshot={context.setSnapshot}
          />
        );
      }}
    </OperationsShell>
  );
}

function AgentsPageContent({
  snapshot,
  rootSnapshot,
  activeWorkspaceId,
  refresh,
  setSnapshot
}: {
  snapshot: MissionControlSnapshot;
  rootSnapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
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
            title="Agents"
            subtitle="Manage your AI workforce. Monitor health, configure capabilities, and run agents at scale."
            actions={
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-[10px] px-3 text-xs"
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
                  surfaceTheme="dark"
                  trigger={
                    <Button size="sm" className="h-8 rounded-[10px] bg-blue-500 px-3 text-xs text-white shadow-blue-500/20 hover:bg-blue-400">
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
            right={<ViewToggle value={view} onChange={setView} />}
          >
            <ToolbarButton icon={Filter} label={`Filter: ${agentFilterLabel(filter)}`} active={filter !== "all"} onClick={() => setFilter("all")} />
            <ToolbarButton icon={SlidersHorizontal} label={`Sort: ${formatAgentSortLabel(sort)}`} chevron onClick={() => setSort((current) => sortModes[(sortModes.indexOf(current) + 1) % sortModes.length])} />
          </SearchToolbar>

          <div className="flex flex-wrap items-center gap-2">
            {(["all", "ready", "running", "idle", "needs-approval"] as AgentFilter[]).map((id) => (
              <FilterChip
                key={id}
                label={agentFilterLabel(id)}
                count={filterCounts[id]}
                active={filter === id}
                tone={statusToneForAgentFilter(id)}
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
                surfaceTheme="dark"
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

function TasksPageContent({
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
            <div className="grid gap-2.5 xl:grid-cols-3 min-[1600px]:grid-cols-6">
              {(["queued", "running", "approval", "stalled", "completed", "cancelled"] as TaskView["status"][]).map((status) => (
                <TaskColumn
                  key={status}
                  status={status}
                  tasks={filteredTasks.filter((task) => task.status === status)}
                  selectedId={selectedTask?.id}
                  onSelect={setSelectedId}
                  onAbort={abortTask}
                />
              ))}
            </div>
          ) : (
            <SectionCard>
              <div className="divide-y divide-white/[0.07]">
                {filteredTasks.map((task) => (
                  <TaskListRow key={task.id} task={task} selected={task.id === selectedTask?.id} onSelect={() => setSelectedId(task.id)} onAbort={() => abortTask(task)} />
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
      inspector={selectedTask ? <TaskInspector task={selectedTask} onAbort={() => abortTask(selectedTask)} /> : null}
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
  onAbort
}: {
  status: TaskView["status"];
  tasks: TaskView[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onAbort: (task: TaskView) => void;
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
          <TaskCard key={task.id} task={task} selected={task.id === selectedId} onSelect={() => onSelect(task.id)} onAbort={() => onAbort(task)} />
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
  onAbort
}: {
  task: TaskView;
  selected: boolean;
  onSelect: () => void;
  onAbort: () => void;
}) {
  const cancelEnabled = canCancelTask(task);
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
        "rounded-[10px] border bg-white/[0.035] p-2.5 text-left transition-all hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40",
        selected ? "border-blue-400/70 shadow-[0_0_0_1px_rgba(59,130,246,0.18)]" : "border-white/[0.08]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-xs font-semibold text-white">{task.title}</h3>
          <p className="mt-1 truncate text-[0.68rem] text-slate-400">{task.agentName}</p>
        </div>
        <MoreButton />
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <MiniBadge>{task.category}</MiniBadge>
        <StatusBadge label={task.priority} tone={task.priority === "High" ? "danger" : task.priority === "Medium" ? "warning" : "success"} dot={false} />
      </div>
      {task.status === "running" ? (
        <div className="mt-2.5">
          <div className="mb-1 flex justify-between text-[0.68rem] text-slate-400">
            <span>{task.progress}%</span>
            <span>{task.tokenLabel}</span>
          </div>
          <ProgressBar value={task.progress} />
        </div>
      ) : null}
      <div className="mt-2.5 flex items-center justify-between gap-2 text-[0.68rem] text-slate-400">
        <span>{task.dueLabel}</span>
        <span>{task.status === "approval" ? `Est. cost ${task.tokenLabel}` : task.tokenLabel}</span>
      </div>
      <div className="mt-2.5 flex gap-2">
        {task.status === "approval" ? (
          <>
            <Button variant="secondary" size="sm" className="h-7 flex-1 rounded-[8px] px-2 text-[0.7rem]" disabled title="Approval review decisions are not exposed by the current task API." onClick={(event) => event.stopPropagation()}>Review</Button>
            <Button variant="secondary" size="sm" className="h-7 flex-1 rounded-[8px] border-rose-400/20 px-2 text-[0.7rem] text-rose-200" disabled title="Reject is not exposed by the current task API." onClick={(event) => event.stopPropagation()}>Reject</Button>
          </>
        ) : task.status === "running" ? (
          <Button variant="secondary" size="sm" className="h-7 flex-1 rounded-[8px] px-2 text-[0.7rem]" disabled title="Pause is not exposed by the current task API." onClick={(event) => event.stopPropagation()}>
            <Pause className="mr-1.5 h-3 w-3" /> Pause
          </Button>
        ) : (
          <Button variant="secondary" size="sm" className="h-7 flex-1 rounded-[8px] px-2 text-[0.7rem]" onClick={(event) => { event.stopPropagation(); onSelect(); }}>
            <Play className="mr-1.5 h-3 w-3" /> Open
          </Button>
        )}
        <Button
          variant="secondary"
          size="sm"
          className="h-7 rounded-[8px] px-2"
          disabled={!cancelEnabled}
          title={cancelEnabled ? "Cancel this task through the supported abort action." : "This task status cannot be cancelled."}
          onClick={(event) => { event.stopPropagation(); onAbort(); }}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function TaskListRow({ task, selected, onSelect, onAbort }: { task: TaskView; selected: boolean; onSelect: () => void; onAbort: () => void }) {
  const cancelEnabled = canCancelTask(task);
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
        "grid w-full grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-3 py-2.5 text-left text-xs hover:bg-white/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40",
        selected && "bg-blue-500/[0.08]"
      )}
    >
      <span className="min-w-0">
        <span className="block truncate font-semibold text-white">{task.title}</span>
        <span className="mt-1 block truncate text-[0.68rem] text-slate-400">{task.agentName} · {task.category}</span>
      </span>
      <StatusBadge label={task.statusLabel} tone={task.statusTone} />
      <span className="w-24 text-right text-slate-400">{task.tokenLabel}</span>
      <Button
        variant="secondary"
        size="sm"
        className="h-7 rounded-[8px] px-2 text-[0.7rem]"
        disabled={!cancelEnabled}
        title={cancelEnabled ? "Cancel this task through the supported abort action." : "This task status cannot be cancelled."}
        onClick={(event) => { event.stopPropagation(); onAbort(); }}
      >
        Cancel
      </Button>
    </div>
  );
}

function TaskInspector({ task, onAbort }: { task: TaskView; onAbort: () => void }) {
  const cancelEnabled = canCancelTask(task);
  return (
    <InspectorPanelFrame title="Task Details">
      <h2 className="text-base font-semibold text-white">{task.title}</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StatusBadge label={task.statusLabel} tone={task.statusTone} />
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
          <p className="mt-1.5 text-xs leading-5 text-slate-300">{task.objective}</p>
        </div>
        <div>
          <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-slate-500">Description</p>
          <p className="mt-1.5 text-xs leading-5 text-slate-300">{task.description}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-[10px] border border-white/[0.08] bg-white/[0.03] p-2.5">
        <MetricMini label="Status" value={task.statusLabel} />
        <MetricMini label="Priority" value={task.priority} />
        <MetricMini label="Due" value={task.dueLabel} />
      </div>
      <div className="mt-3">
        <div className="mb-1.5 flex justify-between text-xs">
          <span className="text-slate-400">Progress</span>
          <span className="text-blue-300">{task.progress}%</span>
        </div>
        <ProgressBar value={task.progress} />
      </div>
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

function FilesPageContent({
  snapshot,
  activeWorkspaceId
}: {
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
}) {
  const activeWorkspace = activeWorkspaceId
    ? snapshot.workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
    : null;
  const visibleWorkspaces = useMemo(
    () => (activeWorkspaceId ? (activeWorkspace ? [activeWorkspace] : []) : snapshot.workspaces),
    [activeWorkspace, activeWorkspaceId, snapshot.workspaces]
  );
  const [filesByWorkspace, setFilesByWorkspace] = useState<Record<string, WorkspaceManagedFile[]>>({});
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [collection, setCollection] = useState("All Files");
  const [sort, setSort] = useState<"name" | "path" | "size" | "collection">("path");
  const [view, setView] = useState<"grid" | "list">("list");
  const [selectedFileId, setSelectedFileId] = useState("");
  const [previewFile, setPreviewFile] = useState<FileView | null>(null);
  const [workspaceFilesOpen, setWorkspaceFilesOpen] = useState(false);
  const [fileReloadKey, setFileReloadKey] = useState(0);

  useEffect(() => {
    if (visibleWorkspaces.length === 0) {
      setFilesByWorkspace({});
      setFileError(null);
      return;
    }

    let cancelled = false;
    setIsLoadingFiles(true);
    setFileError(null);

    void (async () => {
      const entries = await Promise.all(
        visibleWorkspaces.map(async (workspace) => {
          try {
            const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace.id)}/files`, {
              cache: "no-store"
            });
            const result = (await response.json()) as WorkspaceManagedFileListResponse & { error?: string };
            if (!response.ok || result.error) {
              throw new Error(result.error || "Workspace files could not be loaded.");
            }
            return { workspaceId: workspace.id, files: result.files, error: null as string | null };
          } catch (error) {
            return {
              workspaceId: workspace.id,
              files: [] as WorkspaceManagedFile[],
              error: `${workspace.name}: ${error instanceof Error ? error.message : "Workspace files could not be loaded."}`
            };
          }
        })
      );

      if (!cancelled) {
        setFilesByWorkspace(
          Object.fromEntries(entries.map((entry) => [entry.workspaceId, entry.files]))
        );
        const errors = entries.map((entry) => entry.error).filter((error): error is string => Boolean(error));
        if (errors.length > 0) {
          setFileError(errors.join(" "));
        }
        setIsLoadingFiles(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fileReloadKey, visibleWorkspaces]);

  const fileViews = useMemo(
    () =>
      visibleWorkspaces.flatMap((workspace) =>
        buildFileViews(
          filesByWorkspace[workspace.id] ?? [],
          workspace,
          snapshot.agents.filter((agent) => agent.workspaceId === workspace.id)
        )
      ),
    [filesByWorkspace, snapshot.agents, visibleWorkspaces]
  );

  const filteredFiles = fileViews.filter((file) => {
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      [file.name, file.path, file.type, file.owner, file.workspaceName, ...file.tags].join(" ").toLowerCase().includes(query);
    const matchesCollection = collection === "All Files" || file.collection === collection;
    return matchesSearch && matchesCollection;
  }).sort((left, right) => sortFileViews(left, right, sort));
  const selectedFile = filteredFiles.find((file) => file.id === selectedFileId) ?? filteredFiles[0] ?? null;
  const totalSize = fileViews.reduce((sum, file) => sum + (file.sizeBytes ?? 0), 0);
  const generatedCount = fileViews.filter((file) => file.collection === "Generated Outputs").length;
  const memoryCount = fileViews.filter((file) => file.collection === "Memory").length;
  const coreCount = fileViews.filter((file) => file.collection === "Core Knowledge").length;
  const collectionItems = ["All Files", ...Array.from(new Set(fileViews.map((file) => file.collection))).sort()];
  const sortModes: Array<typeof sort> = ["path", "name", "collection", "size"];

  const revealFile = async (file: FileView) => {
    if (!file.workspacePath) {
      toast.message("This file is not attached to a workspace.");
      return;
    }

    try {
      const response = await fetch("/api/files/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.source?.path ?? file.relativePath, basePath: file.workspacePath })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok || result.error) {
        throw new Error(result.error || "Unable to reveal file.");
      }
      toast.success("File revealed in Finder.");
    } catch (error) {
      toast.error("File open failed.", {
        description: error instanceof Error ? error.message : "Unknown file error."
      });
    }
  };

  return (
    <>
      <OperationsPageLayout
      main={
        <>
          <PageHeader
            title="Files"
            subtitle="Manage workspace documents, knowledge files, memory, and generated outputs."
            actions={
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-[10px] px-3 text-xs"
                  disabled
                  title="Runtime artifact import is not exposed by the current workspace file API."
                >
                  <Import className="mr-1.5 h-3.5 w-3.5" />
                  Import from Agent
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-[10px] px-3 text-xs"
                  disabled
                  title="Uploads are not exposed by the current workspace file API."
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  Upload Files
                </Button>
                <Button
                  size="sm"
                  className="h-8 rounded-[10px] bg-blue-500 px-3 text-xs text-white shadow-blue-500/20 hover:bg-blue-400"
                  disabled={!activeWorkspaceId}
                  title={activeWorkspaceId ? "Open the existing workspace file reader/editor." : "Select a workspace to open workspace files."}
                  onClick={() => setWorkspaceFilesOpen(true)}
                >
                  <FileText className="mr-1.5 h-3.5 w-3.5" />
                  Workspace Files
                </Button>
              </>
            }
          />

          <StatGrid columns={5}>
            <StatCard label="Total Files" value={String(fileViews.length)} detail={isLoadingFiles ? "Loading workspace files" : `${filteredFiles.length} visible`} icon={FileText} tone="info" />
            <StatCard label="Core Files" value={String(coreCount)} detail={`${Math.round((coreCount / Math.max(1, fileViews.length)) * 100)}% of total`} icon={FilePlus2} tone="success" />
            <StatCard label="Generated Outputs" value={String(generatedCount)} detail="Managed workspace files" icon={BrainCircuit} tone="purple" />
            <StatCard label="Memory Docs" value={String(memoryCount)} detail="Durable context" icon={Database} tone="warning" />
            <StatCard label="Storage Used" value={formatBytes(totalSize)} detail={fileViews.some((file) => file.sizeBytes != null) ? "From file metadata" : "No file sizes reported"} icon={HardDrive} tone="info" />
          </StatGrid>

          <SearchToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search files..."
            right={<ViewToggle value={view} onChange={setView} />}
          >
            <ToolbarButton icon={Filter} label={`Collection: ${collection}`} active={collection !== "All Files"} onClick={() => setCollection("All Files")} />
            <ToolbarButton icon={ListFilter} label="Workspace managed files" disabled title="Only managed workspace files are exposed by the current file API." />
            <ToolbarButton icon={SlidersHorizontal} label={`Sort: ${formatFileSortLabel(sort)}`} chevron onClick={() => setSort((current) => sortModes[(sortModes.indexOf(current) + 1) % sortModes.length])} />
          </SearchToolbar>

          {fileError ? (
            <div className="rounded-[10px] border border-amber-300/20 bg-amber-400/10 px-3 py-2.5 text-xs text-amber-100">{fileError}</div>
          ) : null}

          <div className="grid gap-2.5 xl:grid-cols-[180px_minmax(0,1fr)]">
            <SectionCard title="Collections" action={<button className="text-slate-500" disabled title="Custom collections are not exposed by the workspace file API."><Plus className="h-3.5 w-3.5" /></button>}>
              <div className="flex flex-col gap-1 p-2.5">
                {collectionItems.map((item) => {
                  const Icon = fileCollectionIcons[item] ?? Folder;
                  const count = item === "All Files" ? fileViews.length : fileViews.filter((file) => file.collection === item).length;
                  return (
                    <button
                      type="button"
                      key={item}
                      onClick={() => setCollection(item)}
                      className={cn("flex items-center justify-between gap-2 rounded-[9px] px-2.5 py-2 text-left text-xs transition-colors", collection === item ? "bg-blue-500/[0.14] text-blue-200" : "text-slate-300 hover:bg-white/[0.05] hover:text-white")}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Icon className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{item}</span>
                      </span>
                      <span className="text-[0.68rem] text-slate-500">{count}</span>
                    </button>
                  );
                })}
              </div>
              <div className="mt-auto border-t border-white/[0.07] p-3">
                <div className="mb-2 flex items-center justify-between text-[0.68rem] text-slate-400">
                  <span>Storage</span>
                  <span>{fileViews.some((file) => file.sizeBytes != null) ? "Reported" : "Unknown"}</span>
                </div>
                <ProgressBar value={fileViews.some((file) => file.sizeBytes != null) ? Math.min(100, (totalSize / 10_000_000_000) * 100) : 0} />
                <Button variant="secondary" size="sm" className="mt-3 h-7 w-full rounded-[8px] px-2 text-[0.7rem]" disabled title="Storage quota management is not exposed by the current workspace file API.">Manage Storage</Button>
              </div>
            </SectionCard>

            <SectionCard title={`Files (${fileViews.length})`}>
              {isLoadingFiles ? (
                <div className="p-6 text-center text-xs text-slate-400">Loading workspace files...</div>
              ) : filteredFiles.length === 0 ? (
                <EmptyState title="No files found" description={fileViews.length === 0 ? "No managed workspace files were returned by the current workspace file API." : "Clear search or collection filters to inspect another file set."} />
              ) : view === "list" ? (
                <FilesTable files={filteredFiles} selectedId={selectedFile?.id} onSelect={setSelectedFileId} onPreview={setPreviewFile} onReveal={revealFile} />
              ) : (
                <div className="grid gap-2.5 p-3 lg:grid-cols-2 2xl:grid-cols-3">
                  {filteredFiles.map((file) => (
                    <button key={file.id} type="button" onClick={() => setSelectedFileId(file.id)} className={cn("rounded-[10px] border p-3 text-left hover:bg-white/[0.05]", file.id === selectedFile?.id ? "border-blue-400/60 bg-blue-500/[0.08]" : "border-white/[0.08] bg-white/[0.03]")}>
                      <div className="flex items-start gap-2.5">
                        <EntityIcon icon={file.icon} label={file.name} tone={file.iconTone} />
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-white">{file.name}</span>
                          <span className="mt-1 block truncate text-[0.68rem] text-slate-500">{file.path}</span>
                        </span>
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1.5">{file.tags.map((tag) => <MiniBadge key={tag}>{tag}</MiniBadge>)}</div>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between border-t border-white/[0.07] px-3 py-2.5 text-[0.68rem] text-slate-400">
                <span>Showing {filteredFiles.length} of {fileViews.length} files</span>
                <span>Workspace managed files only</span>
              </div>
            </SectionCard>
          </div>
        </>
      }
      inspector={selectedFile ? <FileInspector file={selectedFile} onReveal={() => revealFile(selectedFile)} onPreview={() => setPreviewFile(selectedFile)} /> : null}
    />
      <WorkspaceContextFilesDialog
        snapshot={snapshot}
        workspaceId={activeWorkspaceId}
        open={workspaceFilesOpen}
        onOpenChange={setWorkspaceFilesOpen}
      />
      <FilePreviewDialog
        file={previewFile}
        open={Boolean(previewFile)}
        onOpenChange={(open) => setPreviewFile(open ? previewFile : null)}
        onSaved={() => {
          setPreviewFile(null);
          setFileReloadKey((current) => current + 1);
        }}
      />
    </>
  );
}

function FilesTable({
  files,
  selectedId,
  onSelect,
  onPreview,
  onReveal
}: {
  files: FileView[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onPreview: (file: FileView) => void;
  onReveal: (file: FileView) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] text-left text-[0.72rem]">
        <thead className="border-b border-white/[0.07] text-[0.56rem] uppercase tracking-[0.14em] text-slate-500">
          <tr>
            <th className="w-8 px-3 py-2.5"><span className="block h-3.5 w-3.5 rounded border border-white/[0.14]" /></th>
            <th className="px-2 py-2.5 font-semibold">Name</th>
            <th className="px-2 py-2.5 font-semibold">Type</th>
            <th className="px-2 py-2.5 font-semibold">Last Updated</th>
            <th className="px-2 py-2.5 font-semibold">Owner / Agent</th>
            <th className="px-2 py-2.5 font-semibold">Size</th>
            <th className="px-2 py-2.5 font-semibold">Tags</th>
            <th className="px-3 py-2.5 font-semibold">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06] text-slate-300">
          {files.map((file) => (
            <tr
              key={file.id}
              onClick={() => onSelect(file.id)}
              className={cn("cursor-pointer hover:bg-white/[0.035]", file.id === selectedId && "bg-blue-500/[0.10] outline outline-1 outline-blue-400/50")}
            >
              <td className="px-3 py-2.5"><span className={cn("flex h-3.5 w-3.5 items-center justify-center rounded border", file.id === selectedId ? "border-blue-400 bg-blue-500 text-white" : "border-white/[0.14]")}><Check className="h-2.5 w-2.5" /></span></td>
              <td className="px-2 py-2.5">
                <div className="flex items-center gap-2.5">
                  <EntityIcon icon={file.icon} label={file.name} tone={file.iconTone} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-white">{file.name}</span>
                    <span className="mt-0.5 block truncate text-[0.66rem] text-slate-500">{file.workspaceName} · {file.path}</span>
                  </span>
                </div>
              </td>
              <td className="px-2 py-2.5"><MiniBadge>{file.type}</MiniBadge></td>
              <td className="px-2 py-2.5">{file.updatedLabel}</td>
              <td className="px-2 py-2.5"><span className="line-clamp-2 max-w-24">{file.owner}</span></td>
              <td className="px-2 py-2.5">{file.sizeLabel}</td>
              <td className="px-2 py-2.5"><div className="flex max-w-28 flex-wrap gap-1">{file.tags.slice(0, 2).map((tag) => <MiniBadge key={tag}>{tag}</MiniBadge>)}</div></td>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 rounded-[8px] px-2 text-[0.7rem]"
                    disabled={!file.source?.exists}
                    title={file.source?.exists ? "Read this managed workspace file." : "File is not created yet."}
                    onClick={(event) => {
                      event.stopPropagation();
                      onPreview(file);
                    }}
                  >
                    Preview
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-7 rounded-[8px] px-2 text-[0.7rem]"
                    disabled={!file.workspacePath}
                    title={file.workspacePath ? "Reveal this file in Finder." : "Reveal requires a workspace path."}
                    onClick={(event) => {
                      event.stopPropagation();
                      onReveal(file);
                    }}
                  >
                    Reveal
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FileInspector({
  file,
  onReveal,
  onPreview
}: {
  file: FileView;
  onReveal: () => void;
  onPreview: () => void;
}) {
  return (
    <InspectorPanelFrame>
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <EntityIcon icon={file.icon} label={file.name} tone={file.iconTone} size="lg" />
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-white">{file.name}</h2>
            <div className="mt-1.5 flex gap-1.5"><MiniBadge>{file.type}</MiniBadge><MiniBadge>{file.sizeLabel}</MiniBadge></div>
          </div>
        </div>
        <MoreButton />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button size="sm" className="h-8 rounded-[9px] bg-blue-500 px-2 text-xs text-white hover:bg-blue-400" onClick={onReveal}><SquareArrowOutUpRight className="mr-1.5 h-3.5 w-3.5" />Open</Button>
        <Button variant="secondary" size="sm" className="h-8 rounded-[9px] px-2 text-xs" disabled={!file.source?.exists} title={file.source?.exists ? "Read this managed workspace file." : "File is not created yet."} onClick={onPreview}>Preview</Button>
        <Button variant="secondary" size="sm" className="h-8 rounded-[9px] px-2 text-xs" disabled title="Additional file actions require backend support.">More</Button>
      </div>
      <div className="mt-3 border-b border-white/[0.08] px-3 py-2.5 text-xs text-blue-200">Details</div>
      <>
          <div className="mt-3 rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-3">
            <KeyValue label="File Path" value={file.path} />
            <KeyValue label="Type" value={file.type} />
            <KeyValue label="Size" value={file.sizeLabel} />
            <KeyValue label="Last Updated" value={file.updatedLabel} />
            <KeyValue label="Workspace" value={file.workspaceName} />
            <KeyValue label="Owner / Agent" value={file.owner} />
            <KeyValue label="Workspace API" value={file.source ? "Managed file" : "Not reported"} />
          </div>
          <div className="mt-3">
            <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-slate-500">Tags</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">{file.tags.map((tag) => <MiniBadge key={tag}>{tag}</MiniBadge>)}</div>
          </div>
          <div className="mt-3">
            <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-slate-500">Description</p>
            <p className="mt-1.5 text-xs leading-5 text-slate-300">{file.source?.description ?? "Workspace context file managed by AgentOS and OpenClaw."}</p>
          </div>
        </>
      <SectionCard title="Quick Actions" className="mt-4">
        <div className="grid grid-cols-2 gap-2 p-2.5">
          <Button variant="secondary" size="sm" className="h-8 rounded-[9px] px-2 text-xs" disabled title="Share requires backend support.">Share</Button>
          <Button variant="secondary" size="sm" className="h-8 rounded-[9px] px-2 text-xs" disabled title="Context selection persistence is not exposed by the workspace file API.">Add to Context</Button>
          <Button variant="destructive" size="sm" className="col-span-2 h-8 rounded-[9px] px-2 text-xs" disabled title="Trash/delete is not exposed by the workspace file API.">Move to Trash</Button>
        </div>
      </SectionCard>
    </InspectorPanelFrame>
  );
}

function FilePreviewDialog({
  file,
  open,
  onOpenChange,
  onSaved
}: {
  file: FileView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canRead = Boolean(file?.workspaceId && file?.source?.exists);
  const canSave = Boolean(file?.workspaceId && file?.source?.editable && content !== savedContent && !loading && !saving);

  useEffect(() => {
    if (!open || !file) {
      setContent("");
      setSavedContent("");
      setError(null);
      return;
    }

    if (!canRead) {
      setError("This file cannot be read because it is not created yet or is not attached to a workspace.");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(file.workspaceId ?? "")}/files?path=${encodeURIComponent(file.relativePath)}`,
          { cache: "no-store" }
        );
        const result = (await response.json()) as WorkspaceManagedFileReadResponse & { error?: string };
        if (!response.ok || result.error) {
          throw new Error(result.error || "Workspace file could not be read.");
        }

        if (!cancelled) {
          setContent(result.content);
          setSavedContent(result.content);
        }
      } catch (error) {
        if (!cancelled) {
          setError(readClientError(error));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [canRead, file, open]);

  const saveFile = async () => {
    if (!file?.workspaceId) {
      setError("This file is not attached to a workspace.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(file.workspaceId)}/files`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: file.relativePath,
          content
        })
      });
      const result = (await response.json()) as WorkspaceManagedFileReadResponse & { error?: string };
      if (!response.ok || result.error) {
        throw new Error(result.error || "Workspace file could not be saved.");
      }
      setSavedContent(result.content);
      setContent(result.content);
      toast.success("Workspace file saved.");
      onSaved();
    } catch (error) {
      setError(readClientError(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(82dvh,780px)] max-w-4xl flex-col rounded-[18px] border-white/[0.10] bg-[#08111f]/95 p-4">
        <DialogHeader>
          <DialogTitle>{file?.name ?? "Workspace File"}</DialogTitle>
          <DialogDescription>
            Reads and saves through the existing workspace file API with workspace path safety checks.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <div className="rounded-[10px] border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">{error}</div>
        ) : null}
        <Textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          readOnly={loading || saving || !file?.source?.editable}
          placeholder={loading ? "Loading workspace file..." : "File content"}
          className="min-h-0 flex-1 resize-none rounded-[12px] border-white/[0.10] bg-slate-950/50 font-mono text-xs leading-5 text-slate-100"
        />
        <DialogFooter>
          <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button
            size="sm"
            className="h-8 rounded-[9px] bg-blue-500 text-xs text-white hover:bg-blue-400"
            disabled={!canSave}
            title={file?.source?.editable ? "Save this managed workspace file." : "This managed file is read-only."}
            onClick={() => void saveFile()}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AccountsPageContent({
  snapshot,
  activeWorkspace,
  activeWorkspaceId
}: {
  snapshot: MissionControlSnapshot;
  activeWorkspace: WorkspaceRecord | null;
  activeWorkspaceId: string | null;
}) {
  const [profiles, setProfiles] = useState<OpenClawBrowserProfileView[]>([]);
  const [loginTargets, setLoginTargets] = useState<AccountLoginTargetView[]>([]);
  const [accessRules, setAccessRules] = useState<AccountAccessRuleView[]>([]);
  const [loading, setLoading] = useState(true);
  const [targetsLoading, setTargetsLoading] = useState(true);
  const [accessRulesLoading, setAccessRulesLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [targetsError, setTargetsError] = useState<string | null>(null);
  const [accessRulesError, setAccessRulesError] = useState<string | null>(null);
  const [profileSearch, setProfileSearch] = useState("");
  const [driverFilter, setDriverFilter] = useState<"all" | OpenClawBrowserDriver>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "running" | "stopped">("all");
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [manageAccessTarget, setManageAccessTarget] = useState<AccountLoginTargetView | null>(null);
  const [missionTarget, setMissionTarget] = useState<AccountLoginTargetView | null>(null);
  const [busyProfileName, setBusyProfileName] = useState<string | null>(null);
  const [busyLoginTargetId, setBusyLoginTargetId] = useState<string | null>(null);
  const workspaceAgents = useMemo(
    () => snapshot.agents.filter((agent) => !activeWorkspaceId || agent.workspaceId === activeWorkspaceId),
    [activeWorkspaceId, snapshot.agents]
  );
  const browserAgentCount = workspaceAgents.filter(agentHasBrowserAccess).length;
  const runningCount = profiles.filter((profile) => profile.running).length;
  const managedCount = profiles.filter((profile) => profile.driver === "openclaw").length;
  const existingSessionCount = profiles.filter((profile) => profile.driver === "existing-session").length;
  const tabCount = profiles.reduce((total, profile) => total + profile.tabCount, 0);
  const driverFilters: Array<"all" | OpenClawBrowserDriver> = ["all", "openclaw", "existing-session"];
  const statusFilters: Array<"all" | "running" | "stopped"> = ["all", "running", "stopped"];
  const profileNames = useMemo(() => new Set(profiles.map((profile) => profile.name)), [profiles]);
  const accessRulesByTargetId = useMemo(() => {
    const rulesByTarget = new Map<string, AccountAccessRuleView[]>();

    for (const rule of accessRules) {
      const current = rulesByTarget.get(rule.targetId) ?? [];
      current.push(rule);
      rulesByTarget.set(rule.targetId, current);
    }

    return rulesByTarget;
  }, [accessRules]);
  const agentsByWorkspaceId = useMemo(() => {
    const byWorkspace = new Map<string, AgentRecord[]>();

    for (const agent of snapshot.agents) {
      const current = byWorkspace.get(agent.workspaceId) ?? [];
      current.push(agent);
      byWorkspace.set(agent.workspaceId, current);
    }

    return byWorkspace;
  }, [snapshot.agents]);
  const searchQuery = profileSearch.trim().toLowerCase();
  const filteredLoginTargets = loginTargets.filter((target) => {
    if (!searchQuery) {
      return true;
    }

    return [
      target.serviceName,
      target.primaryDomain,
      target.browserProfileName,
      target.workspaceName,
      target.statusLabel,
      target.loginUrl
    ].join(" ").toLowerCase().includes(searchQuery);
  });
  const filteredProfiles = profiles.filter((profile) => {
    const matchesSearch =
      !searchQuery ||
      [
        profile.name,
        profile.driverLabel,
        profile.transportLabel,
        profile.statusLabel,
        profile.cdpUrl ?? "",
        profile.reconcileReason ?? ""
      ].join(" ").toLowerCase().includes(searchQuery);
    const matchesDriver = driverFilter === "all" || profile.driver === driverFilter;
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "running" ? profile.running : !profile.running);

    return matchesSearch && matchesDriver && matchesStatus;
  });

  const loadProfiles = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/accounts/browser-profiles", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as OpenClawBrowserProfilesResponse | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Unable to read OpenClaw browser profiles.");
      }

      setProfiles(payload.profiles);
    } catch (loadError) {
      setProfiles([]);
      setError(readBrowserProfileError(loadError, "Unable to read OpenClaw browser profiles."));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLoginTargets = useCallback(async () => {
    setTargetsLoading(true);
    setTargetsError(null);

    try {
      const query = activeWorkspaceId ? `?workspaceId=${encodeURIComponent(activeWorkspaceId)}` : "";
      const response = await fetch(`/api/accounts/login-targets${query}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as AccountLoginTargetsResponse | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Unable to read account login targets.");
      }

      setLoginTargets(payload.targets);
    } catch (loadError) {
      setLoginTargets([]);
      setTargetsError(readBrowserProfileError(loadError, "Unable to read account login targets."));
    } finally {
      setTargetsLoading(false);
    }
  }, [activeWorkspaceId]);

  const loadAccessRules = useCallback(async () => {
    setAccessRulesLoading(true);
    setAccessRulesError(null);

    try {
      const query = activeWorkspaceId ? `?workspaceId=${encodeURIComponent(activeWorkspaceId)}` : "";
      const response = await fetch(`/api/accounts/access-rules${query}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as AccountAccessRulesResponse | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Unable to read account access rules.");
      }

      setAccessRules(payload.rules);
    } catch (loadError) {
      setAccessRules([]);
      setAccessRulesError(readBrowserProfileError(loadError, "Unable to read account access rules."));
    } finally {
      setAccessRulesLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    void loadLoginTargets();
  }, [loadLoginTargets]);

  useEffect(() => {
    void loadAccessRules();
  }, [loadAccessRules]);

  const postProfileMutation = async (
    body: Record<string, unknown>,
    fallbackError: string
  ) => {
    const response = await fetch("/api/accounts/browser-profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => null) as OpenClawBrowserProfileMutationResponse | null;

    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error ?? fallbackError);
    }

    return payload;
  };

  const saveLoginTarget = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/accounts/login-targets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => null) as AccountLoginTargetsResponse | null;

    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error ?? "Unable to save account login target.");
    }

    setLoginTargets(payload.targets);
    return payload;
  };

  const saveAccessRulesForTarget = async (
    target: AccountLoginTargetView,
    rules: Array<{
      agentId: string;
      agentName: string;
      permission: AccountAccessPermission;
      notes?: string | null;
    }>
  ) => {
    const response = await fetch("/api/accounts/access-rules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId: target.workspaceId,
        targetId: target.id,
        rules
      })
    });
    const payload = await response.json().catch(() => null) as AccountAccessRulesResponse | null;

    if (!response.ok || !payload?.ok) {
      throw new Error(payload?.error ?? "Unable to save account access rules.");
    }

    setAccessRules(payload.rules);
    return payload;
  };

  const removeLoginTarget = async (target: AccountLoginTargetView) => {
    setBusyLoginTargetId(target.id);

    try {
      const response = await fetch("/api/accounts/login-targets", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: target.id, workspaceId: activeWorkspaceId })
      });
      const payload = await response.json().catch(() => null) as AccountLoginTargetsResponse | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error ?? "Unable to remove account login target.");
      }

      setLoginTargets(payload.targets);
      await loadAccessRules();
      toast.success("Login target forgotten.", {
        description: "Only the AgentOS account list entry was removed. Browser profile sessions were not changed."
      });
    } catch (removeError) {
      toast.error("Login target was not removed.", {
        description: readBrowserProfileError(removeError, "Unable to remove account login target.")
      });
    } finally {
      setBusyLoginTargetId(null);
    }
  };

  const openLoginTarget = async (target: AccountLoginTargetView) => {
    setBusyLoginTargetId(target.id);

    try {
      await postProfileMutation(
        {
          action: "open-login",
          profileName: target.browserProfileName,
          loginUrl: target.loginUrl,
          label: `${slugifyClient(target.serviceName)}-login`
        },
        "Unable to open the login URL in OpenClaw."
      );
      await saveLoginTarget({
        workspaceId: target.workspaceId,
        workspaceName: target.workspaceName,
        workspacePath: target.workspacePath,
        serviceId: target.serviceId,
        serviceName: target.serviceName,
        primaryDomain: target.primaryDomain,
        loginUrl: target.loginUrl,
        browserProfileName: target.browserProfileName
      });
      await loadProfiles();
      toast.success("Login browser opened.", {
        description: `${target.serviceName} opened in ${target.browserProfileName}.`
      });
    } catch (openError) {
      toast.error("Login browser did not open.", {
        description: readBrowserProfileError(openError, "Unable to open the login URL in OpenClaw.")
      });
    } finally {
      setBusyLoginTargetId(null);
    }
  };

  const startProfile = async (profile: OpenClawBrowserProfileView) => {
    setBusyProfileName(profile.name);

    try {
      await postProfileMutation(
        { action: "start-profile", profileName: profile.name },
        `Unable to start ${profile.name}.`
      );
      toast.success("Browser profile started.", {
        description: `${profile.name} is now available through OpenClaw.`
      });
      await loadProfiles();
    } catch (startError) {
      toast.error("Browser profile did not start.", {
        description: readBrowserProfileError(startError, `Unable to start ${profile.name}.`)
      });
    } finally {
      setBusyProfileName(null);
    }
  };

  const connectAccount = async (input: ConnectBrowserProfileInput) => {
    if (!activeWorkspace) {
      toast.error("Select a workspace before connecting an account.");
      return;
    }

    setBusyProfileName(input.profileName);

    try {
      await postProfileMutation(
        {
          action: "open-login",
          profileName: input.profileName,
          loginUrl: input.loginUrl,
          label: input.label
        },
        "Unable to open the login URL in OpenClaw."
      );

      await saveLoginTarget({
        workspaceId: activeWorkspace.id,
        workspaceName: activeWorkspace.name,
        workspacePath: activeWorkspace.path ?? null,
        serviceId: input.serviceId,
        serviceName: input.serviceName,
        primaryDomain: input.primaryDomain,
        loginUrl: input.loginUrl,
        browserProfileName: input.profileName
      });

      toast.success("Login browser opened.", {
        description: "Complete the login in the OpenClaw browser profile. AgentOS saved only the login target."
      });
      setConnectDialogOpen(false);
      await loadProfiles();
    } catch (connectError) {
      toast.error("Connect Account did not complete.", {
        description: readBrowserProfileError(connectError, "Unable to open the login browser.")
      });
    } finally {
      setBusyProfileName(null);
    }
  };

  return (
    <>
      <OperationsPageLayout
        main={
          <>
            <PageHeader
              title="Accounts"
              subtitle="Manage real OpenClaw browser profiles used for reusable account sessions."
              primaryAction={{
                label: "Connect Account",
                icon: KeyRound,
                onClick: () => setConnectDialogOpen(true),
                disabled: !activeWorkspaceId,
                title: activeWorkspaceId
                  ? "Open a login flow in an OpenClaw browser profile for this workspace."
                  : "Select a workspace before connecting account sessions."
              }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <MiniBadge>Workspace: {activeWorkspace?.name ?? "All workspaces"}</MiniBadge>
                <MiniBadge>{activeWorkspace?.path ?? activeWorkspace?.slug ?? "Read-only overview"}</MiniBadge>
                <MiniBadge>Source: OpenClaw profiles + AgentOS login targets</MiniBadge>
              </div>
            </PageHeader>

            <StatGrid columns={5}>
              <StatCard label="Profiles" value={loading ? "-" : String(profiles.length)} detail={`${managedCount} managed, ${existingSessionCount} existing-session`} icon={Chrome} tone="info" />
              <StatCard label="Login Targets" value={targetsLoading ? "-" : String(loginTargets.length)} detail="Created through Connect Account" icon={KeyRound} tone={loginTargets.length > 0 ? "success" : "muted"} />
              <StatCard label="Running" value={loading ? "-" : String(runningCount)} detail={`${tabCount} open browser tabs`} icon={Fingerprint} tone={runningCount > 0 ? "success" : "muted"} />
              <StatCard label="Agent Access" value={accessRulesLoading ? "-" : String(accessRules.length)} detail={`${browserAgentCount} browser-capable agents`} icon={UserCog} tone={accessRules.length > 0 ? "success" : "muted"} />
              <StatCard label="Gateway State" value={error ? "Blocked" : loading ? "Checking" : "Ready"} detail={error ? "OpenClaw browser unavailable" : "Real browser profile API"} icon={Gauge} tone={error ? "warning" : "success"} />
            </StatGrid>

            <div className="rounded-[12px] border border-cyan-300/18 bg-cyan-400/10 px-3 py-2.5 text-xs leading-5 text-cyan-100">
              AgentOS does not store raw passwords. Sessions are stored in OpenClaw browser profiles.
            </div>

            <SectionCard title="Browser Profile Access">
              <div className="grid gap-3 p-3 text-xs leading-5 text-slate-300 lg:grid-cols-2">
                <div>
                  <p className="font-semibold text-white">What works here</p>
                  <p className="mt-1 text-slate-400">AgentOS reads OpenClaw browser profiles, starts a profile, opens a login URL, and records the workspace login target after that browser action succeeds.</p>
                </div>
                <div>
                  <p className="font-semibold text-white">What is not exposed yet</p>
                  <p className="mt-1 text-slate-400">OpenClaw does not expose verified website account identities or a direct browser-profile dispatch parameter to AgentOS. Agent access is enforced by AgentOS before account-target task launch.</p>
                </div>
              </div>
            </SectionCard>

            <SearchToolbar
              search={profileSearch}
              onSearchChange={setProfileSearch}
              searchPlaceholder="Search login targets and browser profiles..."
            >
              <ToolbarButton
                icon={Filter}
                label={`State: ${formatBrowserProfileStateFilter(statusFilter)}`}
                active={statusFilter !== "all"}
                chevron
                onClick={() => setStatusFilter((current) => statusFilters[(statusFilters.indexOf(current) + 1) % statusFilters.length])}
              />
              <ToolbarButton
                icon={SlidersHorizontal}
                label={`Driver: ${formatBrowserDriverFilter(driverFilter)}`}
                active={driverFilter !== "all"}
                chevron
                onClick={() => setDriverFilter((current) => driverFilters[(driverFilters.indexOf(current) + 1) % driverFilters.length])}
              />
              <ToolbarButton
                icon={RefreshCw}
                label={loading || targetsLoading || accessRulesLoading ? "Refreshing" : "Refresh"}
                active={loading || targetsLoading || accessRulesLoading}
                onClick={() => {
                  void loadProfiles();
                  void loadLoginTargets();
                  void loadAccessRules();
                }}
              />
            </SearchToolbar>

            <SectionCard title="Connected Login Targets">
              {targetsError || accessRulesError ? (
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <EntityIcon icon={AlertTriangle} label="Login targets unavailable" tone="warning" />
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-white">Account login targets are unavailable</h2>
                      <p className="mt-1 text-xs leading-5 text-slate-400">{targetsError ?? accessRulesError}</p>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" onClick={() => {
                    void loadLoginTargets();
                    void loadAccessRules();
                  }}>
                    Retry
                  </Button>
                </div>
              ) : targetsLoading || accessRulesLoading ? (
                <div className="p-4 text-xs text-slate-400">Loading login targets...</div>
              ) : filteredLoginTargets.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    title={loginTargets.length === 0 ? "No login targets connected" : "No login targets match"}
                    description={loginTargets.length === 0
                      ? "Use Connect Account to open a login page in a real OpenClaw browser profile. AgentOS will list the target here after the browser action succeeds."
                      : "Clear search to inspect another login target."}
                  />
                </div>
              ) : (
                <div className="grid gap-2.5 p-3 lg:grid-cols-2 min-[1500px]:grid-cols-3">
                  {filteredLoginTargets.map((target) => (
                    <LoginTargetCard
                      key={target.id}
                      target={target}
                      profileAvailable={profileNames.has(target.browserProfileName)}
                      accessRules={accessRulesByTargetId.get(target.id) ?? []}
                      workspaceAgents={agentsByWorkspaceId.get(target.workspaceId) ?? []}
                      busy={busyLoginTargetId === target.id}
                      onOpen={() => void openLoginTarget(target)}
                      onForget={() => void removeLoginTarget(target)}
                      onManageAccess={() => setManageAccessTarget(target)}
                      onRunTask={() => setMissionTarget(target)}
                    />
                  ))}
                </div>
              )}
            </SectionCard>

            <div className="flex flex-wrap items-center gap-2">
              {statusFilters.map((status) => (
                <FilterChip
                  key={status}
                  label={formatBrowserProfileStateFilter(status)}
                  count={status === "all" ? profiles.length : profiles.filter((profile) => status === "running" ? profile.running : !profile.running).length}
                  active={statusFilter === status}
                  tone={status === "running" ? "success" : status === "stopped" ? "muted" : "info"}
                  onClick={() => setStatusFilter(status)}
                />
              ))}
              {driverFilters.map((driver) => (
                <FilterChip
                  key={driver}
                  label={formatBrowserDriverFilter(driver)}
                  count={driver === "all" ? profiles.length : profiles.filter((profile) => profile.driver === driver).length}
                  active={driverFilter === driver}
                  tone={driver === "existing-session" ? "warning" : driver === "openclaw" ? "info" : "purple"}
                  onClick={() => setDriverFilter(driver)}
                />
              ))}
            </div>

            {error ? (
              <SectionCard>
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <EntityIcon icon={AlertTriangle} label="OpenClaw browser unavailable" tone="warning" />
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-white">OpenClaw browser profiles are unavailable</h2>
                      <p className="mt-1 text-xs leading-5 text-slate-400">{error}</p>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" onClick={() => void loadProfiles()}>
                    Retry
                  </Button>
                </div>
              </SectionCard>
            ) : loading ? (
              <EmptyState title="Loading browser profiles" description="Reading OpenClaw browser profile state through the Gateway." />
            ) : filteredProfiles.length === 0 ? (
              <EmptyState
                title={profiles.length === 0 ? "No browser profiles reported" : "No profiles match"}
                description={profiles.length === 0
                  ? "Create or enable a browser profile in OpenClaw first, then use Connect Account to open a manual login flow in that profile."
                  : "Clear search or filters to inspect another OpenClaw browser profile."}
              />
            ) : (
              <div className="grid gap-2.5 lg:grid-cols-2 min-[1500px]:grid-cols-3">
                {filteredProfiles.map((profile) => (
                  <BrowserProfileCard
                    key={profile.name}
                    profile={profile}
                    busy={busyProfileName === profile.name}
                    onStart={() => void startProfile(profile)}
                  />
                ))}
              </div>
            )}
          </>
        }
        inspector={null}
      />
      <ConnectAccountWizard
        open={connectDialogOpen}
        workspace={activeWorkspace}
        onOpenChange={setConnectDialogOpen}
        onSubmit={connectAccount}
        profiles={profiles}
      />
      <ManageAccountAccessDialog
        open={Boolean(manageAccessTarget)}
        target={manageAccessTarget}
        agents={manageAccessTarget ? agentsByWorkspaceId.get(manageAccessTarget.workspaceId) ?? [] : []}
        accessRules={manageAccessTarget ? accessRulesByTargetId.get(manageAccessTarget.id) ?? [] : []}
        onOpenChange={(open) => setManageAccessTarget(open ? manageAccessTarget : null)}
        onSave={saveAccessRulesForTarget}
      />
      <AccountTargetMissionDialog
        open={Boolean(missionTarget)}
        target={missionTarget}
        agents={missionTarget ? agentsByWorkspaceId.get(missionTarget.workspaceId) ?? [] : []}
        accessRules={missionTarget ? accessRulesByTargetId.get(missionTarget.id) ?? [] : []}
        onOpenChange={(open) => setMissionTarget(open ? missionTarget : null)}
        onSubmitted={async () => {
          setMissionTarget(null);
          await loadProfiles();
        }}
      />
    </>
  );
}

function BrowserProfileCard({
  profile,
  busy,
  onStart
}: {
  profile: OpenClawBrowserProfileView;
  busy: boolean;
  onStart: () => void;
}) {
  return (
    <SectionCard>
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="flex min-w-0 items-start gap-3">
          <EntityIcon icon={Chrome} label={profile.name} tone="info" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-white">{profile.name}</h2>
            <p className="mt-1 truncate text-[0.7rem] text-slate-400">{profile.driverLabel}</p>
          </div>
        </div>
        <StatusBadge label={profile.statusLabel} tone={profile.statusTone} />
      </div>
      <div className="grid gap-2 border-t border-white/[0.07] p-3 sm:grid-cols-2">
        <KeyValue label="Transport" value={profile.transportLabel} />
        <KeyValue label="Tabs" value={String(profile.tabCount)} />
        <KeyValue label="Default" value={profile.isDefault ? "Yes" : "No"} />
        <KeyValue label="Remote" value={profile.isRemote ? "Yes" : "No"} />
        <KeyValue label="CDP Port" value={profile.cdpPort == null ? "Not reported" : String(profile.cdpPort)} />
        <KeyValue label="CDP URL" value={profile.cdpUrl ?? "Not reported"} />
      </div>
      {profile.missingFromConfig || profile.reconcileReason ? (
        <div className="border-t border-white/[0.07] px-3 py-2 text-[0.68rem] leading-5 text-amber-100">
          {profile.reconcileReason ?? "This profile was reported by OpenClaw but is missing from config."}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] p-3">
        <Button
          variant="secondary"
          size="sm"
          className="h-7 rounded-[8px] px-2 text-[0.7rem]"
          disabled={busy}
          onClick={onStart}
        >
          {profile.running ? "Restart / attach" : "Start profile"}
        </Button>
        <MiniBadge>{profile.driver}</MiniBadge>
        <MiniBadge>{profile.running ? "Browser control active" : "Browser control stopped"}</MiniBadge>
      </div>
    </SectionCard>
  );
}

function LoginTargetCard({
  target,
  profileAvailable,
  accessRules,
  workspaceAgents,
  busy,
  onOpen,
  onForget,
  onManageAccess,
  onRunTask
}: {
  target: AccountLoginTargetView;
  profileAvailable: boolean;
  accessRules: AccountAccessRuleView[];
  workspaceAgents: AgentRecord[];
  busy: boolean;
  onOpen: () => void;
  onForget: () => void;
  onManageAccess: () => void;
  onRunTask: () => void;
}) {
  const workspaceAgentIds = new Set(workspaceAgents.map((agent) => agent.id));
  const allowedRules = accessRules.filter(
    (rule) => workspaceAgentIds.has(rule.agentId) && rule.permission !== "no_access"
  );
  const browserCapableAllowedRules = allowedRules.filter((rule) => {
    const agent = workspaceAgents.find((entry) => entry.id === rule.agentId);
    return agent ? agentHasBrowserAccess(agent) : false;
  });

  return (
    <div className="rounded-[12px] border border-white/[0.08] bg-white/[0.035]">
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="flex min-w-0 items-start gap-3">
          <EntityIcon icon={KeyRound} label={target.serviceName} tone="warning" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-white">{target.serviceName}</h2>
            <p className="mt-1 truncate text-[0.7rem] text-slate-400">{target.primaryDomain}</p>
          </div>
        </div>
        <StatusBadge label={target.statusLabel} tone={target.statusTone} />
      </div>
      <div className="grid gap-2 border-t border-white/[0.07] p-3 sm:grid-cols-2">
        <KeyValue label="Browser profile" value={target.browserProfileName} />
        <KeyValue label="Workspace" value={target.workspaceName} />
        <KeyValue label="Last opened" value={formatAccountTimestamp(target.lastOpenedAt)} />
        <KeyValue label="Opened" value={`${target.openCount} time${target.openCount === 1 ? "" : "s"}`} />
        <KeyValue label="Login URL" value={target.loginUrl} />
        <KeyValue label="Source" value="Connect Account" />
      </div>
      <div className="border-t border-white/[0.07] px-3 py-2 text-[0.68rem] leading-5 text-slate-400">
        AgentOS records that this login target was opened in the selected browser profile. Website account identity is not verified by OpenClaw.
      </div>
      <div className="border-t border-white/[0.07] px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-slate-500">Agent Access</p>
          <MiniBadge>{allowedRules.length} allowed</MiniBadge>
        </div>
        {allowedRules.length === 0 ? (
          <p className="mt-2 text-[0.68rem] leading-5 text-slate-500">
            No agent can use this account target until access is granted.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {allowedRules.slice(0, 4).map((rule) => (
              <MiniBadge key={rule.id}>{rule.agentName}</MiniBadge>
            ))}
            {allowedRules.length > 4 ? <MiniBadge>+{allowedRules.length - 4} more</MiniBadge> : null}
          </div>
        )}
        <p className="mt-2 text-[0.66rem] leading-5 text-slate-500">
          AgentOS blocks account-target dispatch for agents without access. OpenClaw does not expose a direct browser-profile dispatch parameter yet.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] p-3">
        <Button
          variant="secondary"
          size="sm"
          className="h-7 rounded-[8px] px-2 text-[0.7rem]"
          disabled={busy || !profileAvailable}
          title={profileAvailable ? "Open this login page in its OpenClaw browser profile." : "The saved browser profile is not reported by OpenClaw."}
          onClick={onOpen}
        >
          <SquareArrowOutUpRight className="mr-1 h-3 w-3" />
          Open login
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 rounded-[8px] px-2 text-[0.7rem]"
          disabled={busy || !profileAvailable}
          title="Select which workspace agents can use this account target."
          onClick={onManageAccess}
        >
          <UserCog className="mr-1 h-3 w-3" />
          Manage access
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 rounded-[8px] px-2 text-[0.7rem]"
          disabled={busy || !profileAvailable || browserCapableAllowedRules.length === 0}
          title={browserCapableAllowedRules.length > 0 ? "Run a task with an allowed browser-capable agent." : "Grant access to a browser-capable agent first."}
          onClick={onRunTask}
        >
          <Play className="mr-1 h-3 w-3" />
          Run task
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 rounded-[8px] px-2 text-[0.7rem]"
          disabled={busy}
          title="Remove this AgentOS list entry only. Browser profile sessions are not changed."
          onClick={onForget}
        >
          <X className="mr-1 h-3 w-3" />
          Forget
        </Button>
        <MiniBadge>{profileAvailable ? "Profile available" : "Profile missing"}</MiniBadge>
      </div>
    </div>
  );
}

type AccountAccessDraft = Record<string, {
  permission: AccountAccessPermission;
  notes: string;
}>;

function ManageAccountAccessDialog({
  open,
  target,
  agents,
  accessRules,
  onOpenChange,
  onSave
}: {
  open: boolean;
  target: AccountLoginTargetView | null;
  agents: AgentRecord[];
  accessRules: AccountAccessRuleView[];
  onOpenChange: (open: boolean) => void;
  onSave: (
    target: AccountLoginTargetView,
    rules: Array<{
      agentId: string;
      agentName: string;
      permission: AccountAccessPermission;
      notes?: string | null;
    }>
  ) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<AccountAccessDraft>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sortedAgents = useMemo(
    () => [...agents].sort((left, right) => left.name.localeCompare(right.name)),
    [agents]
  );

  useEffect(() => {
    if (!open || !target) {
      return;
    }

    const nextDraft: AccountAccessDraft = {};
    for (const agent of sortedAgents) {
      const rule = accessRules.find((entry) => entry.agentId === agent.id);
      nextDraft[agent.id] = {
        permission: rule?.permission === "requires_approval" ? "requires_approval" : rule?.permission === "use_browser_profile" ? "use_browser_profile" : "no_access",
        notes: rule?.notes ?? ""
      };
    }

    setDraft(nextDraft);
    setError(null);
  }, [accessRules, open, sortedAgents, target]);

  const save = async () => {
    if (!target) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSave(
        target,
        sortedAgents.map((agent) => {
          const agentDraft = draft[agent.id] ?? { permission: "no_access" as AccountAccessPermission, notes: "" };
          return {
            agentId: agent.id,
            agentName: agent.name,
            permission: agentHasBrowserAccess(agent) ? agentDraft.permission : "no_access",
            notes: agentDraft.notes
          };
        })
      );
      toast.success("Account access saved.", {
        description: `Agent access for ${target.serviceName} now uses AgentOS policy state.`
      });
      onOpenChange(false);
    } catch (saveError) {
      const message = readBrowserProfileError(saveError, "Unable to save account access rules.");
      setError(message);
      toast.error("Account access was not saved.", {
        description: message
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {target ? (
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto rounded-[18px] border-white/[0.10] bg-[#08111f]/95 p-4">
          <DialogHeader>
            <DialogTitle>Manage Account Access</DialogTitle>
            <DialogDescription>
              Select which workspace agents may use this saved browser profile session.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-[10px] border border-cyan-300/18 bg-cyan-400/10 px-3 py-2 text-xs leading-5 text-cyan-100">
            AgentOS enforces this before account-target task launch. OpenClaw does not expose a direct browser-profile dispatch parameter yet.
          </div>

          <SectionCard>
            <div className="grid gap-2 p-3 sm:grid-cols-2">
              <KeyValue label="Account target" value={target.serviceName} />
              <KeyValue label="Domain" value={target.primaryDomain} />
              <KeyValue label="Browser profile" value={target.browserProfileName} />
              <KeyValue label="Workspace" value={target.workspaceName} />
            </div>
          </SectionCard>

          {sortedAgents.length === 0 ? (
            <EmptyState title="No workspace agents" description="Create an agent in this workspace before granting account access." />
          ) : (
            <div className="rounded-[12px] border border-white/[0.08] bg-white/[0.03]">
              {sortedAgents.map((agent) => {
                const canUseBrowser = agentHasBrowserAccess(agent);
                const agentDraft = draft[agent.id] ?? { permission: "no_access" as AccountAccessPermission, notes: "" };

                return (
                  <div key={agent.id} className="grid gap-3 border-b border-white/[0.07] p-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_180px]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-white">{agent.name}</p>
                        <MiniBadge>{canUseBrowser ? "Browser-capable" : "Browser tools missing"}</MiniBadge>
                      </div>
                      <p className="mt-1 text-[0.68rem] leading-5 text-slate-500">
                        {canUseBrowser
                          ? "This agent can be granted account-target task access."
                          : "Enable browser/chrome tools before this agent can use account sessions."}
                      </p>
                      <Input
                        value={agentDraft.notes}
                        disabled={!canUseBrowser || agentDraft.permission === "no_access"}
                        onChange={(event) => {
                          const notes = event.target.value;
                          setDraft((current) => ({
                            ...current,
                            [agent.id]: {
                              ...(current[agent.id] ?? { permission: "no_access" as AccountAccessPermission, notes: "" }),
                              notes
                            }
                          }));
                        }}
                        placeholder="Optional policy note"
                        className="mt-2 h-8 rounded-[9px] bg-slate-950/50 text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`access-${target.id}-${agent.id}`}>Permission</Label>
                      <select
                        id={`access-${target.id}-${agent.id}`}
                        value={agentDraft.permission}
                        disabled={!canUseBrowser}
                        onChange={(event) => {
                          const permission = normalizeAccessPermission(event.target.value);
                          setDraft((current) => ({
                            ...current,
                            [agent.id]: {
                              ...(current[agent.id] ?? { permission: "no_access" as AccountAccessPermission, notes: "" }),
                              permission
                            }
                          }));
                        }}
                        className="h-9 rounded-[10px] border border-white/[0.10] bg-slate-950/50 px-3 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="no_access">No access</option>
                        <option value="use_browser_profile">Can use profile</option>
                        <option value="requires_approval" disabled>Requires approval (coming soon)</option>
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {error ? <div className="rounded-[10px] border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">{error}</div> : null}

          <DialogFooter>
            <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-8 rounded-[9px] bg-blue-500 text-xs text-white hover:bg-blue-400" disabled={saving || sortedAgents.length === 0} onClick={() => void save()}>
              {saving ? "Saving..." : "Save access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function AccountTargetMissionDialog({
  open,
  target,
  agents,
  accessRules,
  onOpenChange,
  onSubmitted
}: {
  open: boolean;
  target: AccountLoginTargetView | null;
  agents: AgentRecord[];
  accessRules: AccountAccessRuleView[];
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => Promise<void>;
}) {
  const allowedAgents = useMemo(() => {
    const ruleByAgentId = new Map(accessRules.map((rule) => [rule.agentId, rule]));
    return agents
      .filter((agent) => agentHasBrowserAccess(agent))
      .filter((agent) => {
        const rule = ruleByAgentId.get(agent.id);
        return rule?.permission === "use_browser_profile";
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [accessRules, agents]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [mission, setMission] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSelectedAgentId(allowedAgents[0]?.id ?? "");
    setMission("");
    setError(null);
  }, [allowedAgents, open]);

  const submit = async () => {
    if (!target || !selectedAgentId || !mission.trim()) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/mission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mission: mission.trim(),
          agentId: selectedAgentId,
          workspaceId: target.workspaceId,
          accountTargetId: target.id
        })
      });
      const result = await response.json().catch(() => null) as { error?: string; summary?: string } | null;

      if (!response.ok || result?.error) {
        throw new Error(result?.error || "Mission dispatch failed.");
      }

      toast.success("Task submitted.", {
        description: result?.summary ?? `${target.serviceName} account target context was attached.`
      });
      onOpenChange(false);
      await onSubmitted();
    } catch (submitError) {
      const message = readBrowserProfileError(submitError, "Mission dispatch failed.");
      setError(message);
      toast.error("Task was not submitted.", {
        description: message
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {target ? (
        <DialogContent className="max-w-xl rounded-[18px] border-white/[0.10] bg-[#08111f]/95 p-4">
          <DialogHeader>
            <DialogTitle>Run Task With Account</DialogTitle>
            <DialogDescription>
              Dispatch to an allowed browser-capable agent with account target context.
            </DialogDescription>
          </DialogHeader>

          <SectionCard>
            <div className="grid gap-2 p-3 sm:grid-cols-2">
              <KeyValue label="Account target" value={target.serviceName} />
              <KeyValue label="Browser profile" value={target.browserProfileName} />
              <KeyValue label="Domain" value={target.primaryDomain} />
              <KeyValue label="Dispatch enforcement" value="AgentOS policy guard" />
            </div>
          </SectionCard>

          <div className="rounded-[10px] border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
            OpenClaw does not expose a direct browser-profile dispatch parameter yet. AgentOS blocks unauthorized agents and includes the selected profile/session as task context.
          </div>

          {allowedAgents.length === 0 ? (
            <EmptyState title="No allowed browser-capable agents" description="Grant account access to a browser-capable agent before running a task with this login target." />
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`account-task-agent-${target.id}`}>Agent</Label>
                <select
                  id={`account-task-agent-${target.id}`}
                  value={selectedAgentId}
                  onChange={(event) => setSelectedAgentId(event.target.value)}
                  className="h-9 rounded-[10px] border border-white/[0.10] bg-slate-950/50 px-3 text-xs text-white"
                >
                  {allowedAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </select>
              </div>
              <Textarea
                value={mission}
                onChange={(event) => setMission(event.target.value)}
                placeholder={`Describe what the agent should do using ${target.serviceName}...`}
                className="min-h-32 rounded-[12px] border-white/[0.10] bg-slate-950/50 text-sm text-slate-100"
              />
            </>
          )}

          {error ? <div className="rounded-[10px] border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">{error}</div> : null}

          <DialogFooter>
            <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 rounded-[9px] bg-blue-500 text-xs text-white hover:bg-blue-400"
              disabled={submitting || allowedAgents.length === 0 || !selectedAgentId || !mission.trim()}
              onClick={() => void submit()}
            >
              {submitting ? "Submitting..." : "Submit task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

type ConnectBrowserProfileInput = {
  mode: ConnectBrowserProfileMode;
  profileName: string;
  loginUrl: string;
  label: string;
  serviceId: string;
  serviceName: string;
  primaryDomain: string;
};

type ConnectBrowserProfileMode = "existing" | "signed-in-chrome";

type ConnectBrowserServiceOption = {
  id: string;
  label: string;
  service: string;
  loginUrl: string;
  domains: string[];
  icon: LucideIcon;
  iconTone: "success" | "info" | "warning" | "danger" | "muted" | "purple";
};

const connectBrowserServices: ConnectBrowserServiceOption[] = [
  {
    id: "product-hunt",
    label: "Product Hunt",
    service: "Product Hunt",
    loginUrl: "https://www.producthunt.com/login",
    domains: ["producthunt.com"],
    icon: KeyRound,
    iconTone: "warning"
  },
  {
    id: "gmail",
    label: "Gmail",
    service: "Gmail",
    loginUrl: "https://accounts.google.com/",
    domains: ["mail.google.com", "accounts.google.com"],
    icon: MessageSquare,
    iconTone: "danger"
  },
  {
    id: "x-twitter",
    label: "X / Twitter",
    service: "X / Twitter",
    loginUrl: "https://x.com/login",
    domains: ["x.com", "twitter.com"],
    icon: BellRing,
    iconTone: "muted"
  },
  {
    id: "github",
    label: "GitHub",
    service: "GitHub",
    loginUrl: "https://github.com/login",
    domains: ["github.com"],
    icon: Workflow,
    iconTone: "muted"
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    service: "LinkedIn",
    loginUrl: "https://www.linkedin.com/login",
    domains: ["linkedin.com"],
    icon: UserCheck,
    iconTone: "info"
  },
  {
    id: "discord",
    label: "Discord",
    service: "Discord",
    loginUrl: "https://discord.com/login",
    domains: ["discord.com"],
    icon: MessageSquare,
    iconTone: "purple"
  },
  {
    id: "telegram",
    label: "Telegram",
    service: "Telegram",
    loginUrl: "https://web.telegram.org/",
    domains: ["web.telegram.org"],
    icon: MessageSquare,
    iconTone: "success"
  },
  {
    id: "custom",
    label: "Custom Website",
    service: "Custom Website",
    loginUrl: "",
    domains: [],
    icon: Chrome,
    iconTone: "info"
  }
];

function ConnectAccountWizard({
  open,
  workspace,
  onOpenChange,
  onSubmit,
  profiles
}: {
  open: boolean;
  workspace: WorkspaceRecord | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: ConnectBrowserProfileInput) => Promise<void>;
  profiles: OpenClawBrowserProfileView[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <ConnectAccountWizardContent
          key={workspace?.id ?? "no-workspace"}
          workspace={workspace}
          profiles={profiles}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      ) : null}
    </Dialog>
  );
}

function ConnectAccountWizardContent({
  workspace,
  profiles,
  onCancel,
  onSubmit
}: {
  workspace: WorkspaceRecord | null;
  profiles: OpenClawBrowserProfileView[];
  onCancel: () => void;
  onSubmit: (input: ConnectBrowserProfileInput) => Promise<void>;
}) {
  const initialService = connectBrowserServices[0];
  const defaultExistingProfileName = profiles.find((profile) => profile.name === "openclaw")?.name ?? profiles[0]?.name ?? "";
  const hasSignedInChromeProfile = profiles.some((profile) => profile.name === "user");
  const [selectedServiceId, setSelectedServiceId] = useState(initialService.id);
  const [customWebsiteName, setCustomWebsiteName] = useState("");
  const [customLoginUrl, setCustomLoginUrl] = useState("");
  const [customPrimaryDomain, setCustomPrimaryDomain] = useState("");
  const [mode, setMode] = useState<ConnectBrowserProfileMode>("existing");
  const [existingProfileName, setExistingProfileName] = useState(defaultExistingProfileName);
  const [submitting, setSubmitting] = useState(false);
  const selectedService = connectBrowserServices.find((service) => service.id === selectedServiceId) ?? initialService;
  const isCustomService = selectedService.id === "custom";
  const resolvedServiceName = isCustomService ? customWebsiteName.trim() || "Custom Website" : selectedService.service;
  const resolvedLoginUrl = isCustomService ? customLoginUrl.trim() : selectedService.loginUrl;
  const resolvedDomain = isCustomService ? customPrimaryDomain.trim() : selectedService.domains[0] ?? selectedService.service.toLowerCase();
  const resolvedProfileName =
    mode === "signed-in-chrome"
      ? "user"
      : existingProfileName.trim();
  const validationMessage = validateConnectBrowserProfileInput({
    workspace,
    isCustomService,
    customWebsiteName,
    customLoginUrl,
    customPrimaryDomain,
    mode,
    profileName: resolvedProfileName,
    existingProfileName,
    hasSignedInChromeProfile
  });

  const selectService = (service: ConnectBrowserServiceOption) => {
    setSelectedServiceId(service.id);
    if (service.id !== "custom") {
      setCustomWebsiteName("");
      setCustomLoginUrl("");
      setCustomPrimaryDomain("");
    }
  };

  const submit = async () => {
    if (validationMessage || !workspace) {
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        mode,
        profileName: resolvedProfileName,
        loginUrl: resolvedLoginUrl,
        label: `${slugifyClient(resolvedServiceName)}-login`,
        serviceId: selectedService.id === "custom" ? slugifyClient(resolvedServiceName) || "custom" : selectedService.id,
        serviceName: resolvedServiceName,
        primaryDomain: resolvedDomain
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto rounded-[18px] border-white/[0.10] bg-[#08111f]/95 p-4">
      <div className="border-b border-white/[0.08] p-4">
        <DialogHeader>
          <DialogTitle>Connect Account</DialogTitle>
          <DialogDescription>
            Open a login flow in a real OpenClaw browser profile for this workspace.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-3 rounded-[10px] border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
          AgentOS does not store raw passwords. Use manual login inside the assigned browser profile or connect through supported integrations.
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4">
        <WizardSectionTitle
          title="Login Target"
          description="Choose the website to open. AgentOS does not infer or store login success."
        />
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {connectBrowserServices.map((service) => {
            const selected = service.id === selectedServiceId;
            return (
              <button
                key={service.id}
                type="button"
                onClick={() => selectService(service)}
                className={cn(
                  "rounded-[12px] border p-3 text-left transition hover:border-blue-300/35 hover:bg-blue-400/10",
                  selected ? "border-blue-300/45 bg-blue-400/12" : "border-white/[0.08] bg-white/[0.035]"
                )}
              >
                <div className="flex items-center gap-2">
                  <EntityIcon icon={service.icon} label={service.label} tone={service.iconTone} />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-white">{service.label}</p>
                    <p className="mt-0.5 truncate text-[0.66rem] text-slate-500">{service.domains[0] ?? "Manual URL"}</p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {isCustomService ? (
          <div className="grid gap-3 rounded-[12px] border border-white/[0.08] bg-white/[0.035] p-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="connect-custom-name">Website name</Label>
              <Input id="connect-custom-name" value={customWebsiteName} onChange={(event) => {
                setCustomWebsiteName(event.target.value);
              }} placeholder="Example Portal" className="h-9 rounded-[10px] bg-slate-950/50 text-xs" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="connect-custom-url">Login URL</Label>
              <Input id="connect-custom-url" value={customLoginUrl} onChange={(event) => setCustomLoginUrl(event.target.value)} placeholder="https://example.com/login" className="h-9 rounded-[10px] bg-slate-950/50 text-xs" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="connect-custom-domain">Primary domain</Label>
              <Input id="connect-custom-domain" value={customPrimaryDomain} onChange={(event) => setCustomPrimaryDomain(event.target.value)} placeholder="example.com" className="h-9 rounded-[10px] bg-slate-950/50 text-xs" />
            </div>
          </div>
        ) : null}

        <WizardSectionTitle
          title="Browser Profile"
          description="Select a profile reported by OpenClaw. AgentOS cannot create persistent browser profiles through the current Gateway browser request API."
        />
        <div className="grid gap-2 md:grid-cols-2">
          <ProfileModeOption
            active={mode === "existing"}
            title="Existing profile"
            description="Use a profile reported by OpenClaw."
            onClick={() => setMode("existing")}
          />
          <ProfileModeOption
            active={mode === "signed-in-chrome"}
            title="Signed-in Chrome"
            description="Use OpenClaw's built-in user profile."
            onClick={() => setMode("signed-in-chrome")}
          />
        </div>

        {mode === "existing" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="connect-existing-profile">Existing browser profile</Label>
            <select id="connect-existing-profile" value={existingProfileName} onChange={(event) => setExistingProfileName(event.target.value)} className="h-9 rounded-[10px] border border-white/[0.10] bg-slate-950/50 px-3 text-xs text-white">
              <option value="">Select a browser profile</option>
              {profiles.map((profile) => (
                <option key={profile.name} value={profile.name}>{profile.name} ({profile.driverLabel})</option>
              ))}
            </select>
          </div>
        ) : null}

        {mode === "signed-in-chrome" ? (
          <div className="rounded-[12px] border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
            The built-in user profile attaches to the signed-in Chrome session through OpenClaw. Use it only when existing cookies matter and the operator is present to approve browser prompts.
          </div>
        ) : null}

        <SectionCard>
          <div className="grid gap-2 p-3 sm:grid-cols-2">
            <KeyValue label="Workspace" value={workspace?.name ?? "No workspace selected"} />
            <KeyValue label="Login target" value={resolvedServiceName} />
            <KeyValue label="Login URL" value={resolvedLoginUrl || "Not set"} />
            <KeyValue label="Primary domain" value={resolvedDomain || "Not set"} />
            <KeyValue label="Browser profile" value={resolvedProfileName || "Not set"} />
            <KeyValue label="Action" value="Open login URL in selected profile" />
          </div>
        </SectionCard>

        <ValidationMessage message={validationMessage} />
      </div>

      <DialogFooter className="border-t border-white/[0.08] p-4">
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[0.7rem] text-slate-500">{validationMessage ?? "Ready to open a real OpenClaw browser login flow."}</p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" onClick={onCancel}>Cancel</Button>
            <Button size="sm" className="h-8 rounded-[9px] bg-blue-500 text-xs text-white hover:bg-blue-400" disabled={Boolean(validationMessage) || submitting} onClick={() => void submit()}>
              {submitting ? "Opening..." : "Connect Account"}
            </Button>
          </div>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}

function ProfileModeOption({
  active,
  title,
  description,
  onClick
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[12px] border p-3 text-left",
        active ? "border-blue-300/45 bg-blue-400/12" : "border-white/[0.08] bg-white/[0.035]"
      )}
    >
      <p className="text-xs font-semibold text-white">{title}</p>
      <p className="mt-1 text-[0.68rem] leading-5 text-slate-500">{description}</p>
    </button>
  );
}

function WizardSectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
    </div>
  );
}

function ValidationMessage({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <div className="rounded-[10px] border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
      {message}
    </div>
  );
}

function formatAccountTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function validateConnectBrowserProfileInput(input: {
  workspace: WorkspaceRecord | null;
  isCustomService: boolean;
  customWebsiteName: string;
  customLoginUrl: string;
  customPrimaryDomain: string;
  mode: ConnectBrowserProfileMode;
  profileName: string;
  existingProfileName: string;
  hasSignedInChromeProfile: boolean;
}) {
  if (!input.workspace) {
    return "Select a workspace before connecting accounts.";
  }

  if (input.isCustomService) {
    if (!input.customWebsiteName.trim()) {
      return "Website name is required for Custom Website.";
    }

    if (!isLikelyUrl(input.customLoginUrl)) {
      return "A valid Login URL is required for Custom Website.";
    }

    if (!input.customPrimaryDomain.trim()) {
      return "Primary domain is required for Custom Website.";
    }
  }

  if (input.mode === "existing" && !input.existingProfileName.trim()) {
    return "Select an existing OpenClaw browser profile.";
  }

  if (input.mode === "signed-in-chrome" && !input.hasSignedInChromeProfile) {
    return "The signed-in Chrome profile is not reported by OpenClaw.";
  }

  return null;
}

function normalizeAccessPermission(value: string): AccountAccessPermission {
  return value === "use_browser_profile" || value === "requires_approval" ? value : "no_access";
}

function isLikelyUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function formatBrowserProfileStateFilter(status: "all" | "running" | "stopped") {
  return status === "all" ? "All" : status === "running" ? "Running" : "Stopped";
}

function formatBrowserDriverFilter(driver: "all" | OpenClawBrowserDriver) {
  return driver === "all" ? "All" : driver === "existing-session" ? "Existing session" : "Managed";
}

function readBrowserProfileError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function agentHasBrowserAccess(agent: AgentRecord) {
  const tools = [...(agent.tools ?? []), ...(agent.observedTools ?? [])].map((tool) => tool.toLowerCase());
  return agent.policy.preset === "browser" || tools.some((tool) => tool === "browser" || tool.includes("chrome"));
}

function slugifyClient(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function ModelsPageContent({
  snapshot,
  rootSnapshot,
  refresh,
  setSnapshot
}: {
  snapshot: MissionControlSnapshot;
  rootSnapshot: MissionControlSnapshot;
  refresh: () => Promise<void>;
  setSnapshot: Dispatch<SetStateAction<MissionControlSnapshot>>;
}) {
  const models = useMemo(
    () => buildModelViews(snapshot),
    [snapshot]
  );
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("All Providers");
  const [sort, setSort] = useState<"name" | "provider" | "status" | "role">("provider");
  const [selectedId, setSelectedId] = useState(models[0]?.id ?? "");
  const [tab, setTab] = useState<"Details" | "Capabilities" | "Performance">("Details");
  const [isAddModelsDialogOpen, setIsAddModelsDialogOpen] = useState(false);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);

  const providers = ["All Providers", ...Array.from(new Set(models.map((model) => model.provider)))];
  const sortModes: Array<typeof sort> = ["provider", "name", "status", "role"];
  const filteredModels = models.filter((model) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [model.name, model.provider, model.id, model.role].join(" ").toLowerCase().includes(query);
    const matchesProvider = provider === "All Providers" || model.provider === provider;
    return matchesSearch && matchesProvider;
  }).sort((left, right) => sortModelViews(left, right, sort));
  const selectedModel = filteredModels.find((model) => model.id === selectedId) ?? filteredModels[0] ?? null;
  const connectedProviders = new Set(models.filter((model) => model.statusTone !== "danger").map((model) => model.provider)).size;
  const tokenTotal = summarizeTokens(snapshot);
  const defaultModelId = snapshot.diagnostics.modelReadiness.resolvedDefaultModel ?? snapshot.diagnostics.modelReadiness.defaultModel;

  const setDefaultModel = async (model: ModelView) => {
    const rawProvider = model.source?.provider;
    if (!rawProvider || !isAddModelsProviderId(rawProvider)) {
      toast.message("Default model change is unavailable.", {
        description: "This model provider is not supported by the model provider API."
      });
      return;
    }

    setSettingDefaultId(model.id);

    try {
      const response = await fetch("/api/models/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-default",
          provider: rawProvider,
          modelId: model.id
        })
      });
      const result = await response.json().catch(() => null) as {
        ok?: boolean;
        message?: string;
        error?: string;
        snapshot?: MissionControlSnapshot;
      } | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || result?.message || "Default model update failed.");
      }

      if (result.snapshot) {
        setSnapshot(result.snapshot);
      } else {
        await refresh();
      }

      toast.success("Default model updated.", {
        description: result.message
      });
    } catch (error) {
      toast.error("Default model update failed.", {
        description: readClientError(error)
      });
    } finally {
      setSettingDefaultId(null);
    }
  };

  return (
    <>
      <OperationsPageLayout
        main={
          <>
          <PageHeader
            title="Models"
            subtitle="Configure default models, providers, routing, and runtime preferences for your AI agents."
            actions={
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-[10px] px-3 text-xs"
                  disabled
                  title="Model import is handled by the Add Models flow; there is no separate import backend."
                >
                  <Import className="mr-1.5 h-3.5 w-3.5" />
                  Import Model
                </Button>
                <Button size="sm" className="h-8 rounded-[10px] bg-blue-500 px-3 text-xs text-white shadow-blue-500/20 hover:bg-blue-400" onClick={() => setIsAddModelsDialogOpen(true)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add Model
                </Button>
              </>
            }
          />

          <SearchToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search models..."
          >
            <ToolbarButton icon={Database} label={provider} chevron onClick={() => setProvider((current) => providers[(providers.indexOf(current) + 1) % providers.length])} />
            <ToolbarButton icon={Filter} label="Configured models" disabled title="Only configured models are exposed by the current model snapshot." />
            <ToolbarButton icon={SlidersHorizontal} label={`Sort: ${formatModelSortLabel(sort)}`} chevron onClick={() => setSort((current) => sortModes[(sortModes.indexOf(current) + 1) % sortModes.length])} />
          </SearchToolbar>

          <StatGrid columns={4}>
            <StatCard label="Providers" value={String(connectedProviders)} detail={`${providers.length - 1} configured providers`} icon={Plug} tone="info" />
            <StatCard label="Configured Models" value={String(models.length)} detail={`${models.filter((model) => model.statusTone !== "danger").length} available`} icon={BrainCircuit} tone="success" />
            <StatCard label="Default Model" value={defaultModelId ? "1" : "0"} detail={defaultModelId ?? "No default configured"} icon={CircleCheck} tone="warning" />
            <StatCard label="Runtime Tokens" value={formatBigNumber(tokenTotal)} detail={tokenTotal ? "From live runtimes" : "No token usage reported"} icon={Sparkles} tone="purple" />
          </StatGrid>

          <SectionCard title="Providers & Models">
            {filteredModels.length === 0 ? (
              <EmptyState title="No models found" description="Add models through the existing model setup flow or clear the current search/provider filter." />
            ) : (
              <ModelsTable models={filteredModels} selectedId={selectedModel?.id} settingDefaultId={settingDefaultId} onSelect={setSelectedId} onSetDefault={(model) => void setDefaultModel(model)} />
            )}
          </SectionCard>

          <div className="grid gap-2.5 xl:grid-cols-[0.9fr_1.6fr]">
            <SectionCard title="Default Route">
              <div className="divide-y divide-white/[0.07] px-3">
                <KeyValue label="Configured default" value={defaultModelId ?? "Not configured"} />
                <KeyValue label="Readiness" value={snapshot.diagnostics.modelReadiness.ready ? "Ready" : "Needs setup"} />
                <KeyValue label="Available models" value={String(snapshot.diagnostics.modelReadiness.availableModelCount)} />
                <KeyValue label="Missing models" value={String(snapshot.diagnostics.modelReadiness.missingModelCount)} />
              </div>
            </SectionCard>
            <SectionCard title="Model Usage">
              <div className="p-3">
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <MetricMini label="Requests" value="Not reported" />
                  <MetricMini label="Total Tokens" value={formatBigNumber(tokenTotal)} />
                  <MetricMini label="Avg Latency" value="Not reported" />
                </div>
                <UnsupportedPanel
                  className="mt-4"
                  title="Live routing metrics unavailable"
                  description="The current snapshot does not expose model request, cost, latency, or route split analytics. AgentOS shows configured models and runtime token usage only."
                />
              </div>
            </SectionCard>
          </div>
        </>
      }
      inspector={
        selectedModel ? (
          <ModelInspector
            model={selectedModel}
            tab={tab}
            onTabChange={setTab}
            settingDefault={settingDefaultId === selectedModel.id}
            onSetDefault={() => void setDefaultModel(selectedModel)}
            onOpenAddModels={() => setIsAddModelsDialogOpen(true)}
          />
        ) : null
      }
    />
      <AddModelsDialog
        open={isAddModelsDialogOpen}
        onOpenChange={setIsAddModelsDialogOpen}
        snapshot={rootSnapshot}
        onSnapshotChange={setSnapshot}
      />
    </>
  );
}

function ModelsTable({
  models,
  selectedId,
  settingDefaultId,
  onSelect,
  onSetDefault
}: {
  models: ModelView[];
  selectedId?: string;
  settingDefaultId: string | null;
  onSelect: (id: string) => void;
  onSetDefault: (model: ModelView) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-left text-xs">
        <thead className="border-b border-white/[0.07] text-[0.56rem] uppercase tracking-[0.14em] text-slate-500">
          <tr>
            {["Model / Provider", "Status", "Context Window", "Role", "Usage", "Actions"].map((header) => (
              <th key={header} className="px-3 py-2.5 font-semibold">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06] text-slate-300">
          {models.map((model) => (
            <tr key={model.id} onClick={() => onSelect(model.id)} className={cn("cursor-pointer hover:bg-white/[0.035]", model.id === selectedId && "bg-blue-500/[0.10] outline outline-1 outline-blue-400/50")}>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <EntityIcon icon={BrainCircuit} label={model.name} tone={model.statusTone} size="sm" />
                  <span><span className="block font-semibold text-white">{model.name}</span><span className="text-[0.66rem] text-slate-500">{model.provider}</span></span>
                </div>
              </td>
              <td className="px-3 py-2.5"><StatusBadge label={model.statusLabel} tone={model.statusTone} /></td>
              <td className="px-3 py-2.5">{model.contextLabel}</td>
              <td className="px-3 py-2.5"><StatusBadge label={model.role} tone={model.role === "Primary" ? "info" : model.role === "Fallback" ? "purple" : model.role === "Secondary" ? "success" : "warning"} dot={false} /></td>
              <td className="px-3 py-2.5">{model.lastActiveLabel}</td>
              <td className="px-3 py-2.5">
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 rounded-[8px] px-2 text-[0.7rem]"
                  disabled={settingDefaultId === model.id || model.role === "Primary" || model.statusTone === "danger"}
                  title={model.role === "Primary" ? "This model is already the default." : model.statusTone === "danger" ? "Unavailable models cannot be selected as default." : "Set this configured model as the AgentOS default."}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSetDefault(model);
                  }}
                >
                  {settingDefaultId === model.id ? "Saving..." : "Set Default"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelInspector({
  model,
  tab,
  onTabChange,
  settingDefault,
  onSetDefault,
  onOpenAddModels
}: {
  model: ModelView;
  tab: "Details" | "Capabilities" | "Performance";
  onTabChange: (tab: "Details" | "Capabilities" | "Performance") => void;
  settingDefault: boolean;
  onSetDefault: () => void;
  onOpenAddModels: () => void;
}) {
  return (
    <InspectorPanelFrame>
      <div className="flex items-start gap-2.5">
        <EntityIcon icon={BrainCircuit} label={model.name} tone={model.statusTone} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-white">{model.name}</h2>
              <p className="mt-1 text-xs text-slate-300">{model.provider}</p>
            </div>
            <StatusBadge label={model.statusLabel} tone={model.statusTone} />
          </div>
          <p className="mt-2.5 text-xs leading-5 text-slate-300">Configured model route reported by AgentOS/OpenClaw.</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          size="sm"
          className="col-span-2 h-8 rounded-[9px] bg-blue-500 text-xs text-white hover:bg-blue-400"
          disabled={settingDefault || model.role === "Primary" || model.statusTone === "danger"}
          title={model.role === "Primary" ? "This model is already the default." : model.statusTone === "danger" ? "Unavailable models cannot be selected as default." : "Set this configured model as the AgentOS default."}
          onClick={onSetDefault}
        >
          {settingDefault ? "Saving..." : "Set as Default"}
        </Button>
        <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs text-violet-200" disabled title="Fallback routing is not exposed by the current model provider API.">Set as Fallback</Button>
        <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" onClick={onOpenAddModels}>Add Models</Button>
        <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" disabled title="Model removal/disable is not exposed by the current model provider API.">Disable</Button>
      </div>
      <div className="mt-3 flex border-b border-white/[0.08]">
        {(["Details", "Capabilities", "Performance"] as const).map((item) => (
          <button key={item} type="button" onClick={() => onTabChange(item)} className={cn("border-b-2 px-3 py-2.5 text-xs", tab === item ? "border-blue-400 text-blue-200" : "border-transparent text-slate-400 hover:text-white")}>{item}</button>
        ))}
      </div>
      {tab === "Details" ? (
        <div className="mt-3 rounded-[10px] border border-white/[0.08] bg-white/[0.03] px-3">
          <KeyValue label="Provider" value={model.provider} />
          <KeyValue label="API Status" value={model.statusLabel} />
          <KeyValue label="Model ID" value={model.id} />
          <KeyValue label="Context Window" value={model.contextLabel} />
          <KeyValue label="Latency" value={model.latencyLabel} />
          <KeyValue label="Rate Limit" value={model.rateLimitLabel} />
          <KeyValue label="Cost / 1M" value={model.costLabel} />
        </div>
      ) : tab === "Capabilities" ? (
        <div className="mt-3 flex flex-wrap gap-1.5">{model.capabilities.map((capability) => <MiniBadge key={capability}>{capability}</MiniBadge>)}</div>
      ) : (
        <div className="mt-4">
          <UnsupportedPanel
            title="Performance metrics unavailable"
            description="The current snapshot does not expose per-model latency, cost, request volume, or route split analytics."
          />
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <MetricMini label="Latency" value={model.latencyLabel} />
            <MetricMini label="Rate Limit" value={model.rateLimitLabel} />
          </div>
        </div>
      )}
    </InspectorPanelFrame>
  );
}

type IntegrationSortMode = "last-active" | "name" | "status" | "category";
type IntegrationRuntimeOverride = Partial<Pick<
  IntegrationView,
  "status" | "statusLabel" | "statusTone" | "connectionHealth" | "lastSyncLabel" | "uptimeLabel" | "rateLimitLabel" | "errorMessage"
>> & {
  sourceMethods?: string[];
};

const integrationStatusToneMap: Record<IntegrationStatus, IntegrationView["statusTone"]> = {
  connected: "success",
  disabled: "muted",
  "pending-setup": "warning",
  failed: "danger",
  "needs-authentication": "warning",
  "missing-credentials": "warning",
  unsupported: "muted",
  unknown: "muted"
};

function IntegrationsPageContent({
  snapshot,
  rootSnapshot,
  activeWorkspaceId,
  refresh,
  setSnapshot
}: {
  snapshot: MissionControlSnapshot;
  rootSnapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  refresh: () => Promise<void>;
  setSnapshot: Dispatch<SetStateAction<MissionControlSnapshot>>;
}) {
  const baseIntegrations = useMemo(() => buildIntegrationViews(snapshot), [snapshot]);
  const [runtimeOverrides, setRuntimeOverrides] = useState<Record<string, IntegrationRuntimeOverride>>({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All Categories");
  const [status, setStatus] = useState<"All Statuses" | IntegrationStatus>("All Statuses");
  const [sort, setSort] = useState<IntegrationSortMode>("last-active");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selectedId, setSelectedId] = useState(baseIntegrations[0]?.id ?? "");
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isChannelsDialogOpen, setIsChannelsDialogOpen] = useState(false);
  const [isAddModelsDialogOpen, setIsAddModelsDialogOpen] = useState(false);
  const [initialModelProvider, setInitialModelProvider] = useState<AddModelsProviderId | null>(null);
  const [initialSurfaceProvider, setInitialSurfaceProvider] = useState<IntegrationView["surfaceProvider"] | null>(null);
  const integrations = useMemo(
    () =>
      baseIntegrations.map((integration) => {
        const override = runtimeOverrides[integration.id];
        if (!override) {
          return integration;
        }

        const statusOverride = override.status
          ? {
              status: override.status,
              statusLabel: override.statusLabel ?? integration.statusLabel,
              statusTone: override.statusTone ?? integrationStatusToneMap[override.status]
            }
          : {};

        return {
          ...integration,
          ...override,
          ...statusOverride,
          sourceMethods: Array.from(new Set([
            ...integration.sourceMethods,
            ...(override.sourceMethods ?? [])
          ]))
        };
      }),
    [baseIntegrations, runtimeOverrides]
  );
  const categories = ["All Categories", ...Array.from(new Set(integrations.map((integration) => integration.category)))];
  const statuses: Array<"All Statuses" | IntegrationStatus> = [
    "All Statuses",
    "connected",
    "unknown",
    "pending-setup",
    "missing-credentials",
    "needs-authentication",
    "failed",
    "disabled",
    "unsupported"
  ];
  const sorts: IntegrationSortMode[] = ["last-active", "name", "status", "category"];

  const filteredIntegrations = integrations.filter((integration) => {
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      [
        integration.name,
        integration.category,
        integration.description,
        integration.statusLabel,
        integration.managedBy,
        integration.providerType,
        integration.permissions.join(" "),
        integration.setupRequirements.join(" ")
      ].join(" ").toLowerCase().includes(query);
    const matchesCategory = category === "All Categories" || integration.category === category;
    const matchesStatus = status === "All Statuses" || integration.status === status;
    return matchesSearch && matchesCategory && matchesStatus;
  }).sort((left, right) => sortIntegrations(left, right, sort));
  const selectedIntegration = filteredIntegrations.find((integration) => integration.id === selectedId) ?? filteredIntegrations[0] ?? null;
  const connectedCount = filteredIntegrations.filter((integration) => integration.status === "connected").length;
  const pendingCount = filteredIntegrations.filter((integration) =>
    integration.status === "pending-setup" ||
    integration.status === "missing-credentials" ||
    integration.status === "needs-authentication"
  ).length;
  const failedCount = filteredIntegrations.filter((integration) => integration.status === "failed").length;

  const openSurfaceSetup = (surfaceProvider: IntegrationView["surfaceProvider"] | null = null) => {
    if (!activeWorkspaceId) {
      toast.error("Select a workspace before configuring workspace surfaces.", {
        description: "All Workspaces is read-only for surface setup. Pick a workspace from the sidebar first."
      });
      return;
    }

    setInitialSurfaceProvider(surfaceProvider);
    setIsChannelsDialogOpen(true);
  };

  const openModelSetup = (provider: AddModelsProviderId | null = null) => {
    setInitialModelProvider(provider);
    setIsAddModelsDialogOpen(true);
  };

  const handleConfigureIntegration = (integration: IntegrationView) => {
    if (!integration.actionSupport.configure.supported) {
      toast.message("Configure is not available.", {
        description: integration.actionSupport.configure.reason
      });
      return;
    }

    if (integration.modelProvider) {
      openModelSetup(integration.modelProvider);
      return;
    }

    if (integration.surfaceProvider) {
      openSurfaceSetup(integration.surfaceProvider);
      return;
    }

    toast.message("No setup flow is wired for this integration.", {
      description: integration.actionSupport.configure.reason
    });
  };

  const handleReconnectIntegration = async (integration: IntegrationView) => {
    if (!integration.actionSupport.reconnect.supported) {
      toast.message("Reconnect is not available.", {
        description: integration.actionSupport.reconnect.reason
      });
      return;
    }

    const actionKey = `${integration.id}:reconnect`;
    setRunningAction(actionKey);

    try {
      if (integration.modelProvider) {
        const response = await fetch("/api/models/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "status",
            provider: integration.modelProvider,
            includeSnapshot: true
          })
        });
        const result = await response.json().catch(() => null) as {
          ok?: boolean;
          message?: string;
          error?: string;
          connection?: {
            connected?: boolean;
            detail?: string | null;
            canConnect?: boolean;
          };
          snapshot?: MissionControlSnapshot;
        } | null;

        if (!response.ok || !result) {
          throw new Error(result?.error || "Model provider status check failed.");
        }

        if (result.snapshot) {
          setSnapshot(result.snapshot);
        }

        const nextStatus: IntegrationStatus = result.connection?.connected
          ? "connected"
          : integration.modelProvider === "ollama"
            ? "pending-setup"
            : "missing-credentials";
        setRuntimeOverrides((current) => ({
          ...current,
          [integration.id]: {
            status: nextStatus,
            statusLabel: formatIntegrationStatusLabel(nextStatus),
            statusTone: integrationStatusToneMap[nextStatus],
            connectionHealth: {
              label: result.connection?.connected ? "Provider status verified" : "Provider not connected",
              detail: result.connection?.detail ?? result.message ?? "Provider status was refreshed through /api/models/providers."
            },
            lastSyncLabel: "Checked just now",
            sourceMethods: ["/api/models/providers"]
          }
        }));

        toast.message(result.connection?.connected ? "Provider is ready." : "Provider needs setup.", {
          description: result.connection?.detail ?? result.message
        });
        return;
      }

      if (integration.surfaceProvider) {
        const response = await fetch(`/api/integrations/${encodeURIComponent(integration.id)}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        });
        const result = await response.json().catch(() => null) as {
          ok?: boolean;
          status?: IntegrationStatus;
          statusLabel?: string;
          connectionHealth?: IntegrationView["connectionHealth"];
          lastSyncLabel?: string;
          uptimeLabel?: string;
          rateLimitLabel?: string;
          errorMessage?: string | null;
          sourceMethods?: string[];
          error?: string;
        } | null;

        const resultStatus = result?.status;
        if (!response.ok || !resultStatus) {
          throw new Error(result?.error || "Integration status check failed.");
        }

        setRuntimeOverrides((current) => ({
          ...current,
          [integration.id]: {
            status: resultStatus,
            statusLabel: result.statusLabel ?? formatIntegrationStatusLabel(resultStatus),
            statusTone: integrationStatusToneMap[resultStatus],
            connectionHealth: result.connectionHealth ?? {
              label: formatIntegrationStatusLabel(resultStatus),
              detail: "OpenClaw channel status was refreshed."
            },
            lastSyncLabel: result.lastSyncLabel ?? "Checked just now",
            uptimeLabel: result.uptimeLabel,
            rateLimitLabel: result.rateLimitLabel,
            errorMessage: result.errorMessage,
            sourceMethods: result.sourceMethods
          }
        }));

        toast.message(result.status === "connected" ? "Integration status verified." : "Status check completed.", {
          description: result.connectionHealth?.detail
        });
        return;
      }

      toast.message("Reconnect is not wired for this integration.", {
        description: integration.actionSupport.reconnect.reason
      });
    } catch (error) {
      const message = readClientError(error);
      setRuntimeOverrides((current) => ({
        ...current,
        [integration.id]: {
          status: "unknown",
          statusLabel: "Unknown",
          statusTone: "muted",
          connectionHealth: {
            label: "Status check failed",
            detail: message
          },
          lastSyncLabel: "Check failed",
          errorMessage: message
        }
      }));
      toast.error("Reconnect failed.", {
        description: message
      });
    } finally {
      setRunningAction(null);
    }
  };

  const handleDisableIntegration = async (integration: IntegrationView) => {
    if (!integration.actionSupport.disable.supported) {
      toast.message("Disable is not available.", {
        description: integration.actionSupport.disable.reason
      });
      return;
    }

    if (!activeWorkspaceId) {
      toast.error("Select a workspace before disabling a surface.", {
        description: "All Workspaces cannot safely remove a workspace-specific binding."
      });
      return;
    }

    if (integration.channelIds.length === 0) {
      toast.message("No workspace binding found.", {
        description: "There is no AgentOS workspace surface binding to disconnect."
      });
      return;
    }

    const actionKey = `${integration.id}:disable`;
    setRunningAction(actionKey);

    try {
      for (const channelId of integration.channelIds) {
        const response = await fetch(`/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/channels`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId, scope: "workspace" })
        });
        const result = await response.json().catch(() => null) as { error?: string } | null;

        if (!response.ok) {
          throw new Error(result?.error || `Unable to disconnect ${channelId}.`);
        }
      }

      await refresh();
      setRuntimeOverrides((current) => ({
        ...current,
        [integration.id]: {
          status: "disabled",
          statusLabel: "Disabled",
          statusTone: "muted",
          connectionHealth: {
            label: "Disconnected from workspace",
            detail: "The workspace surface binding was removed through the channels API."
          },
          lastSyncLabel: "Updated just now",
          sourceMethods: ["/api/workspaces/[workspaceId]/channels DELETE"]
        }
      }));
      toast.success(`${integration.name} disconnected from this workspace.`);
    } catch (error) {
      toast.error("Disable failed.", {
        description: readClientError(error)
      });
    } finally {
      setRunningAction(null);
    }
  };

  return (
    <>
      <OperationsPageLayout
        main={
          <>
            <PageHeader
              title="Integrations"
              subtitle="Connect channels, tools, and external systems to extend AgentOS capabilities and power automations."
              secondaryAction={{ label: "Import Integration", icon: Import, onClick: () => setIsImportDialogOpen(true) }}
              primaryAction={{ label: "Add Integration", icon: Plus, onClick: () => setIsAddDialogOpen(true) }}
            />

            <SearchToolbar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search integrations..."
              right={<ViewToggle value={view} onChange={setView} />}
            >
              <ToolbarButton icon={Layers3} label={category} chevron onClick={() => setCategory((current) => categories[(categories.indexOf(current) + 1) % categories.length])} />
              <ToolbarButton icon={SearchCheck} label={formatIntegrationStatusFilterLabel(status)} chevron onClick={() => setStatus((current) => statuses[(statuses.indexOf(current) + 1) % statuses.length])} />
              <ToolbarButton icon={SlidersHorizontal} label={`Sort: ${formatIntegrationSortLabel(sort)}`} chevron onClick={() => setSort((current) => sorts[(sorts.indexOf(current) + 1) % sorts.length])} />
            </SearchToolbar>

            <StatGrid columns={5}>
              <StatCard label="Total Integrations" value={String(filteredIntegrations.length)} detail={`${integrations.length} registered`} icon={Plug} tone="info" />
              <StatCard label="Connected" value={String(connectedCount)} detail={`${Math.round((connectedCount / Math.max(1, filteredIntegrations.length)) * 100)}% of filtered`} icon={CircleCheck} tone="success" />
              <StatCard label="Pending Setup" value={String(pendingCount)} detail="Needs setup or credentials" icon={Clock3} tone="warning" />
              <StatCard label="Failed" value={String(failedCount)} detail="Real errors only" icon={X} tone="danger" />
              <StatCard label="Automations Using" value="-" detail="Metrics unavailable from snapshot" icon={Workflow} tone="purple" />
            </StatGrid>

            {filteredIntegrations.length === 0 ? (
              <EmptyState
                title="No integrations match"
                description="Adjust search, category, or status filters to inspect another integration set."
              />
            ) : (
              <div className="space-y-3">
                {Array.from(new Set(filteredIntegrations.map((integration) => integration.category))).map((section) => (
                  <section key={section}>
                    <h2 className="mb-2 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-slate-500">{section} ({filteredIntegrations.filter((integration) => integration.category === section).length})</h2>
                    <div className={cn(view === "grid" ? "grid gap-2.5 lg:grid-cols-2 min-[1400px]:grid-cols-3" : "flex flex-col gap-2.5")}>
                      {filteredIntegrations.filter((integration) => integration.category === section).map((integration) => (
                        <IntegrationCard
                          key={integration.id}
                          integration={integration}
                          selected={integration.id === selectedIntegration?.id}
                          list={view === "list"}
                          actionBusy={runningAction?.startsWith(`${integration.id}:`) ?? false}
                          onSelect={() => setSelectedId(integration.id)}
                          onConfigure={() => handleConfigureIntegration(integration)}
                          onReconnect={() => void handleReconnectIntegration(integration)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}

            <AutomationImpactSummary integrations={integrations} />
          </>
        }
        inspector={selectedIntegration ? (
          <IntegrationInspector
            integration={selectedIntegration}
            actionBusy={runningAction?.startsWith(`${selectedIntegration.id}:`) ?? false}
            activeWorkspaceId={activeWorkspaceId}
            onConfigure={() => handleConfigureIntegration(selectedIntegration)}
            onReconnect={() => void handleReconnectIntegration(selectedIntegration)}
            onDisable={() => void handleDisableIntegration(selectedIntegration)}
          />
        ) : null}
      />
      <IntegrationAddDialog
        open={isAddDialogOpen}
        integrations={integrations}
        onOpenChange={setIsAddDialogOpen}
        onSelect={(integration) => {
          setIsAddDialogOpen(false);
          handleConfigureIntegration(integration);
        }}
      />
      <IntegrationImportDialog
        open={isImportDialogOpen}
        onOpenChange={setIsImportDialogOpen}
        onOpenSurfaceSetup={() => {
          setIsImportDialogOpen(false);
          openSurfaceSetup(null);
        }}
        onOpenModelSetup={() => {
          setIsImportDialogOpen(false);
          openModelSetup(null);
        }}
      />
      <WorkspaceChannelsDialog
        snapshot={rootSnapshot}
        workspaceId={activeWorkspaceId}
        open={isChannelsDialogOpen}
        initialProvider={initialSurfaceProvider}
        onOpenChange={setIsChannelsDialogOpen}
        onRefresh={refresh}
        onSnapshotChange={(updater) => setSnapshot((current) => updater(current))}
      />
      <AddModelsDialog
        open={isAddModelsDialogOpen}
        onOpenChange={setIsAddModelsDialogOpen}
        snapshot={rootSnapshot}
        initialProvider={initialModelProvider}
        onSnapshotChange={setSnapshot}
      />
    </>
  );
}

function IntegrationCard({
  integration,
  selected,
  list,
  actionBusy,
  onSelect,
  onConfigure,
  onReconnect
}: {
  integration: IntegrationView;
  selected: boolean;
  list: boolean;
  actionBusy: boolean;
  onSelect: () => void;
  onConfigure: () => void;
  onReconnect: () => void;
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
        "rounded-[12px] border p-3 text-left transition-all hover:bg-white/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40",
        pageSurface,
        selected && "border-blue-400/70 bg-blue-500/[0.08]"
      )}
    >
      <div className={cn("flex gap-3", list ? "items-center" : "items-start")}>
        <EntityIcon icon={integration.icon} label={integration.name} tone={integration.iconTone} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[0.88rem] font-semibold text-white">{integration.name}</h3>
              <p className="mt-1 truncate text-[0.68rem] text-slate-400">{integration.connectionHealth.label}</p>
              <p className="mt-1 text-[0.68rem] text-slate-400">Linked: {integration.linkedAgentCount} agents</p>
            </div>
            <StatusBadge label={integration.statusLabel} tone={integration.statusTone} />
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap gap-1.5">
              <MiniBadge>{integration.category.split(" ")[0]}</MiniBadge>
              <MiniBadge>{integration.managedBy}</MiniBadge>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="h-7 rounded-[8px] px-2"
                disabled={actionBusy || !integration.actionSupport.configure.supported}
                title={integration.actionSupport.configure.reason}
                onClick={(event) => {
                  event.stopPropagation();
                  onConfigure();
                }}
              >
                <Gauge className="h-3 w-3" />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 rounded-[8px] px-2"
                disabled={actionBusy || !integration.actionSupport.reconnect.supported}
                title={integration.actionSupport.reconnect.reason}
                onClick={(event) => {
                  event.stopPropagation();
                  onReconnect();
                }}
              >
                <RefreshCw className={cn("h-3 w-3", actionBusy && "animate-spin")} />
              </Button>
              <MoreButton />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IntegrationInspector({
  integration,
  actionBusy,
  activeWorkspaceId,
  onConfigure,
  onReconnect,
  onDisable
}: {
  integration: IntegrationView;
  actionBusy: boolean;
  activeWorkspaceId: string | null;
  onConfigure: () => void;
  onReconnect: () => void;
  onDisable: () => void;
}) {
  const StatusIcon = integrationStatusIcons[integration.status];
  const disableReason = activeWorkspaceId
    ? integration.actionSupport.disable.reason
    : "Select a workspace before disabling workspace-specific surface bindings.";
  return (
    <InspectorPanelFrame>
      <div className="flex items-start gap-3">
        <EntityIcon icon={integration.icon} label={integration.name} tone={integration.iconTone} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-white">{integration.name}</h2>
              <StatusBadge label={integration.statusLabel} tone={integration.statusTone} className="mt-1.5" />
            </div>
            <MoreButton />
          </div>
          <MiniBadge>{integration.category}</MiniBadge>
          <p className="mt-2.5 text-xs leading-5 text-slate-300">{integration.description}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="h-8 rounded-[9px] px-2 text-xs"
          disabled={actionBusy || !integration.actionSupport.reconnect.supported}
          title={integration.actionSupport.reconnect.reason}
          onClick={onReconnect}
        >
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", actionBusy && "animate-spin")} />Reconnect
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 rounded-[9px] px-2 text-xs"
          disabled={actionBusy || !integration.actionSupport.configure.supported}
          title={integration.actionSupport.configure.reason}
          onClick={onConfigure}
        >
          Configure
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="h-8 rounded-[9px] px-2 text-xs"
          disabled={actionBusy || !integration.actionSupport.disable.supported || !activeWorkspaceId}
          title={disableReason}
          onClick={onDisable}
        >
          Disable
        </Button>
      </div>
      <SectionCard title="Connection Health" className="mt-3">
        <div className="px-3 py-2.5">
          <KeyValue label="Health" value={<span className="inline-flex items-center gap-1.5"><StatusIcon className={cn("h-3.5 w-3.5", statusIconClassName(integration.status))} />{integration.connectionHealth.label}</span>} />
          <KeyValue label="Last sync" value={integration.lastSyncLabel} />
          <KeyValue label="Uptime" value={integration.uptimeLabel} />
          <KeyValue label="Rate limit" value={integration.rateLimitLabel} />
          <KeyValue label="Source" value={integration.sourceMethods.join(", ")} />
          <p className="border-t border-white/[0.07] py-2 text-xs leading-5 text-slate-400">{integration.connectionHealth.detail}</p>
          <ProgressBar value={integration.status === "connected" ? 84 : integration.status === "failed" ? 8 : 28} tone={integration.statusTone} />
        </div>
      </SectionCard>
      <SectionCard title="Scopes / Permissions" className="mt-3">
        <div className="space-y-1.5 p-3 text-xs text-slate-300">
          {integration.permissions.map((scope) => (
            <div key={scope} className="flex items-center gap-1.5"><CircleCheck className="h-3.5 w-3.5 text-emerald-300" />{scope}</div>
          ))}
        </div>
      </SectionCard>
      <SectionCard title={`Linked Agents (${integration.linkedAgentCount})`} className="mt-3">
        <div className="divide-y divide-white/[0.07] px-3">
          {integration.linkedAgents.length > 0 ? integration.linkedAgents.map((agent) => (
            <div key={agent.id} className="py-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-slate-200">{agent.name}</span>
                <span className="shrink-0 text-slate-500">{agent.workspaceName}</span>
              </div>
              <p className="mt-1 truncate text-[0.66rem] text-slate-500">{agent.reason}</p>
            </div>
          )) : (
            <div className="py-3 text-xs text-slate-500">
              {integration.managedBy === "unsupported" ? "Linkage unavailable until this connector exists." : "No linked agents found in the current workspace snapshot."}
            </div>
          )}
        </div>
      </SectionCard>
      <SectionCard title="Setup Notes" className="mt-3">
        <div className="space-y-2 p-3 text-xs leading-5 text-slate-300">
          <KeyValue label="Managed by" value={formatManagedBy(integration.managedBy)} />
          <KeyValue label="Provider type" value={integration.providerType} />
          <KeyValue label="Accounts" value={integration.accountIds.length ? integration.accountIds.join(", ") : "None"} />
          <KeyValue label="Channels" value={integration.channelIds.length ? integration.channelIds.join(", ") : "None"} />
          <KeyValue label="Models" value={integration.modelIds.length ? integration.modelIds.join(", ") : "None"} />
          {integration.errorMessage ? <p className="rounded-[9px] border border-red-400/20 bg-red-500/10 p-2 text-red-200">{integration.errorMessage}</p> : null}
          {integration.missingConfiguration.length > 0 ? (
            <div>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-slate-500">Required setup</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {integration.missingConfiguration.map((item) => <MiniBadge key={item}>{item}</MiniBadge>)}
              </div>
            </div>
          ) : null}
          <div className="rounded-[9px] border border-white/[0.07] bg-white/[0.03] p-2 text-slate-400">
            <p>Configure: {integration.actionSupport.configure.reason}</p>
            <p>Reconnect: {integration.actionSupport.reconnect.reason}</p>
            <p>Disable: {integration.actionSupport.disable.reason}</p>
          </div>
        </div>
      </SectionCard>
    </InspectorPanelFrame>
  );
}

function AutomationImpactSummary({ integrations }: { integrations: IntegrationView[] }) {
  const connected = integrations.filter((integration) => integration.status === "connected");
  const linked = integrations
    .filter((integration) => integration.linkedAgentCount > 0)
    .sort((left, right) => right.linkedAgentCount - left.linkedAgentCount);
  return (
    <SectionCard title="Automation Impact Summary">
      <div className="grid gap-2.5 p-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_1.4fr_0.8fr]">
        <MetricTile icon={Workflow} label="Automations" value="-" detail="OpenClaw metric unavailable" tone="info" />
        <MetricTile icon={Sparkles} label="Triggers fired" value="-" detail="OpenClaw metric unavailable" tone="success" />
        <MetricTile icon={BellRing} label="Actions executed" value="-" detail="OpenClaw metric unavailable" tone="purple" />
        <MetricTile icon={ShieldCheck} label="Success rate" value="-" detail="OpenClaw metric unavailable" tone="success" />
        <div className="rounded-[10px] border border-white/[0.08] bg-white/[0.03] p-2.5">
          <p className="mb-2.5 text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-slate-500">Top linked integrations</p>
          {linked.slice(0, 3).map((integration) => (
            <div key={integration.id} className="mb-2 grid grid-cols-[80px_1fr_auto] items-center gap-2 text-[0.68rem]">
              <span className="truncate text-slate-300">{integration.name}</span>
              <ProgressBar value={Math.min(100, 20 + integration.linkedAgentCount * 18)} />
              <span className="text-slate-500">{integration.linkedAgentCount} agents</span>
            </div>
          ))}
          {linked.length === 0 ? <p className="text-[0.68rem] text-slate-500">No linked integrations found in the current snapshot.</p> : null}
        </div>
        <div className="rounded-[10px] border border-white/[0.08] bg-white/[0.03] p-2.5">
          <p className="mb-2.5 text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-slate-500">Recently observed</p>
          {connected.slice(0, 3).map((integration) => (
            <div key={integration.id} className="flex justify-between gap-2 py-1 text-[0.68rem]">
              <span className="text-slate-300">{integration.name}</span>
              <span className="text-slate-500">{integration.lastSyncLabel}</span>
            </div>
          ))}
          {connected.length === 0 ? <p className="text-[0.68rem] text-slate-500">No verified connected integrations yet.</p> : null}
        </div>
      </div>
    </SectionCard>
  );
}

function IntegrationAddDialog({
  open,
  integrations,
  onOpenChange,
  onSelect
}: {
  open: boolean;
  integrations: IntegrationView[];
  onOpenChange: (open: boolean) => void;
  onSelect: (integration: IntegrationView) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl rounded-[18px] border-white/[0.10] bg-[#08111f]/95 p-4">
        <DialogHeader>
          <DialogTitle>Add Integration</DialogTitle>
          <DialogDescription>
            Choose a real AgentOS/OpenClaw setup path. Unsupported connectors are shown with their blocking reason.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[62vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {integrations.map((integration) => (
            <button
              key={integration.id}
              type="button"
              onClick={() => onSelect(integration)}
              className={cn(
                "rounded-[12px] border p-3 text-left transition hover:bg-white/[0.06]",
                pageSurface,
                !integration.actionSupport.configure.supported && "opacity-70"
              )}
            >
              <div className="flex items-start gap-3">
                <EntityIcon icon={integration.icon} label={integration.name} tone={integration.iconTone} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-sm font-semibold text-white">{integration.name}</h3>
                    <StatusBadge label={integration.statusLabel} tone={integration.statusTone} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{integration.description}</p>
                  <p className="mt-2 text-[0.68rem] text-slate-500">{integration.actionSupport.configure.reason}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IntegrationImportDialog({
  open,
  onOpenChange,
  onOpenSurfaceSetup,
  onOpenModelSetup
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSurfaceSetup: () => void;
  onOpenModelSetup: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-[18px] border-white/[0.10] bg-[#08111f]/95 p-4">
        <DialogHeader>
          <DialogTitle>Import Integration</DialogTitle>
          <DialogDescription>
            Secure bulk import is not available because this codebase does not expose a credential import contract or secret store handoff.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-[12px] border border-amber-300/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
          Importing tokens, OAuth secrets, bot credentials, or webhook secrets from the browser would expose sensitive values. Use the existing setup flows so OpenClaw handles credentials through its supported config paths.
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button className="h-9 rounded-[9px] bg-blue-500 text-white hover:bg-blue-400" onClick={onOpenSurfaceSetup}>
            Open Surface Setup
          </Button>
          <Button variant="secondary" className="h-9 rounded-[9px]" onClick={onOpenModelSetup}>
            Open Model Setup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function sortIntegrations(left: IntegrationView, right: IntegrationView, sort: IntegrationSortMode) {
  if (sort === "name") {
    return left.name.localeCompare(right.name);
  }

  if (sort === "status") {
    return left.statusLabel.localeCompare(right.statusLabel) || left.name.localeCompare(right.name);
  }

  if (sort === "category") {
    return left.category.localeCompare(right.category) || left.name.localeCompare(right.name);
  }

  const leftTime = left.lastActiveMs ?? 0;
  const rightTime = right.lastActiveMs ?? 0;
  return rightTime - leftTime || left.name.localeCompare(right.name);
}

function formatIntegrationStatusLabel(status: IntegrationStatus) {
  switch (status) {
    case "connected":
      return "Connected";
    case "disabled":
      return "Disabled";
    case "pending-setup":
      return "Pending Setup";
    case "failed":
      return "Failed";
    case "needs-authentication":
      return "Needs Authentication";
    case "missing-credentials":
      return "Missing Credentials";
    case "unsupported":
      return "Unsupported";
    case "unknown":
      return "Unknown";
  }
}

function formatIntegrationStatusFilterLabel(status: "All Statuses" | IntegrationStatus) {
  return status === "All Statuses" ? status : formatIntegrationStatusLabel(status);
}

function formatIntegrationSortLabel(sort: IntegrationSortMode) {
  switch (sort) {
    case "last-active":
      return "Last active";
    case "name":
      return "Name";
    case "status":
      return "Status";
    case "category":
      return "Category";
  }
}

function statusIconClassName(status: IntegrationStatus) {
  if (status === "connected") {
    return "text-emerald-300";
  }

  if (status === "failed") {
    return "text-red-300";
  }

  if (status === "pending-setup" || status === "missing-credentials" || status === "needs-authentication") {
    return "text-amber-300";
  }

  return "text-slate-400";
}

function formatManagedBy(value: IntegrationView["managedBy"]) {
  switch (value) {
    case "openclaw":
      return "OpenClaw";
    case "agentos":
      return "AgentOS";
    case "external-config":
      return "External config";
    case "unsupported":
      return "Unsupported";
  }
}

function readClientError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown integration error.";
}

function OperationsPageLayout({ main, inspector }: { main: React.ReactNode; inspector: React.ReactNode }) {
  return (
    <div className={cn("grid gap-3", inspector ? "xl:grid-cols-[minmax(0,1fr)_320px]" : "xl:grid-cols-1")}>
      <div className="flex min-w-0 flex-col gap-3">{main}</div>
      {inspector}
    </div>
  );
}

function MetricMini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[0.56rem] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className="mt-1 truncate text-xs font-semibold text-white">{value}</p>
    </div>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  detail,
  tone
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
  tone: "info" | "success" | "purple";
}) {
  return (
    <div className="rounded-[10px] border border-white/[0.08] bg-white/[0.03] p-2.5">
      <div className="flex items-center gap-2.5">
        <EntityIcon icon={Icon} label={label} tone={tone} />
        <span className="min-w-0">
          <span className="block text-base font-semibold text-white">{value}</span>
          <span className="block truncate text-[0.68rem] text-slate-400">{label}</span>
        </span>
      </div>
      <p className="mt-1.5 text-[0.68rem] text-slate-500">{detail}</p>
    </div>
  );
}

function UnsupportedPanel({
  title,
  description,
  className
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-[12px] border border-white/[0.08] bg-white/[0.03] p-3", className)}>
      <p className="text-xs font-semibold text-white">{title}</p>
      <p className="mt-2 text-xs leading-5 text-slate-400">{description}</p>
    </div>
  );
}

function MissionDispatchDialog({
  open,
  agent,
  defaultWorkspaceId = null,
  onOpenChange,
  onSubmitted
}: {
  open: boolean;
  agent: AgentView | null;
  defaultWorkspaceId?: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => Promise<void>;
}) {
  const [mission, setMission] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspaceId = agent?.source?.workspaceId ?? defaultWorkspaceId ?? undefined;

  useEffect(() => {
    if (open) {
      setMission("");
      setError(null);
    }
  }, [open]);

  const submitMission = async () => {
    const trimmedMission = mission.trim();
    if (!trimmedMission) {
      setError("Enter a task brief before submitting.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/mission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mission: trimmedMission,
          agentId: agent?.source?.id,
          workspaceId
        })
      });
      const result = await response.json().catch(() => null) as { error?: string; summary?: string } | null;
      if (!response.ok || result?.error) {
        throw new Error(result?.error || "Mission dispatch failed.");
      }
      toast.success("Task submitted.", {
        description: result?.summary
      });
      onOpenChange(false);
      await onSubmitted();
    } catch (error) {
      setError(readClientError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-[18px] border-white/[0.10] bg-[#08111f]/95 p-4">
        <DialogHeader>
          <DialogTitle>{agent ? `Run task with ${agent.name}` : "Create Task"}</DialogTitle>
          <DialogDescription>
            Submits through the existing AgentOS mission dispatch flow.
          </DialogDescription>
        </DialogHeader>
        {error ? <div className="rounded-[10px] border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">{error}</div> : null}
        <Textarea
          value={mission}
          onChange={(event) => setMission(event.target.value)}
          placeholder="Describe the task to run..."
          className="min-h-36 rounded-[12px] border-white/[0.10] bg-slate-950/50 text-sm text-slate-100"
        />
        <DialogFooter>
          <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="h-8 rounded-[9px] bg-blue-500 text-xs text-white hover:bg-blue-400"
            disabled={submitting || !mission.trim()}
            onClick={() => void submitMission()}
          >
            {submitting ? "Submitting..." : "Submit Task"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function sortAgentViews(left: AgentView, right: AgentView, sort: "last-active" | "name" | "status" | "workspace") {
  if (sort === "name") {
    return left.name.localeCompare(right.name);
  }

  if (sort === "status") {
    return left.statusLabel.localeCompare(right.statusLabel) || left.name.localeCompare(right.name);
  }

  if (sort === "workspace") {
    return left.workspaceName.localeCompare(right.workspaceName) || left.name.localeCompare(right.name);
  }

  return (right.source?.lastActiveAt ?? 0) - (left.source?.lastActiveAt ?? 0) || left.name.localeCompare(right.name);
}

function formatAgentSortLabel(sort: "last-active" | "name" | "status" | "workspace") {
  if (sort === "last-active") {
    return "Last active";
  }

  return toTitleCase(sort);
}

function sortTaskViews(left: TaskView, right: TaskView, sort: "updated" | "title" | "status" | "agent") {
  if (sort === "title") {
    return left.title.localeCompare(right.title);
  }

  if (sort === "status") {
    return left.statusLabel.localeCompare(right.statusLabel) || left.title.localeCompare(right.title);
  }

  if (sort === "agent") {
    return left.agentName.localeCompare(right.agentName) || left.title.localeCompare(right.title);
  }

  return (right.source?.updatedAt ?? 0) - (left.source?.updatedAt ?? 0) || left.title.localeCompare(right.title);
}

function formatTaskSortLabel(sort: "updated" | "title" | "status" | "agent") {
  if (sort === "updated") {
    return "Last updated";
  }

  return toTitleCase(sort);
}

function formatTaskFilterLabel(filter: "all" | TaskView["status"]) {
  if (filter === "all") {
    return "All";
  }

  if (filter === "approval") {
    return "Awaiting Approval";
  }

  return toTitleCase(filter);
}

function resolveTaskTone(filter: "all" | TaskView["status"]) {
  if (filter === "running") {
    return "info";
  }

  if (filter === "completed") {
    return "success";
  }

  if (filter === "approval" || filter === "stalled") {
    return "warning";
  }

  if (filter === "cancelled") {
    return "danger";
  }

  return "muted";
}

function canCancelTask(task: TaskView) {
  return Boolean(task.source && ["queued", "running", "approval", "stalled"].includes(task.status));
}

function sortFileViews(left: FileView, right: FileView, sort: "name" | "path" | "size" | "collection") {
  if (sort === "name") {
    return left.name.localeCompare(right.name);
  }

  if (sort === "collection") {
    return left.collection.localeCompare(right.collection) || left.name.localeCompare(right.name);
  }

  if (sort === "size") {
    return (right.sizeBytes ?? -1) - (left.sizeBytes ?? -1) || left.name.localeCompare(right.name);
  }

  return left.relativePath.localeCompare(right.relativePath);
}

function formatFileSortLabel(sort: "name" | "path" | "size" | "collection") {
  if (sort === "path") {
    return "Path";
  }

  return toTitleCase(sort);
}

function sortModelViews(left: ModelView, right: ModelView, sort: "name" | "provider" | "status" | "role") {
  if (sort === "name") {
    return left.name.localeCompare(right.name);
  }

  if (sort === "status") {
    return left.statusLabel.localeCompare(right.statusLabel) || left.name.localeCompare(right.name);
  }

  if (sort === "role") {
    return left.role.localeCompare(right.role) || left.name.localeCompare(right.name);
  }

  return left.provider.localeCompare(right.provider) || left.name.localeCompare(right.name);
}

function formatModelSortLabel(sort: "name" | "provider" | "status" | "role") {
  return toTitleCase(sort);
}

function formatAgentDisplayNameFromRecord(agent: AgentRecord) {
  return agent.identityName?.trim() || agent.name || agent.id;
}

function agentFilterLabel(filter: AgentFilter) {
  if (filter === "all") {
    return "All";
  }

  if (filter === "needs-approval") {
    return "Needs Approval";
  }

  return toTitleCase(filter);
}

function toTitleCase(value: string) {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}
