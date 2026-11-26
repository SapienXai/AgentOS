"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { ArrowUpRight, Chrome, Folder, Globe2, MessageSquare, Play, Plus, Plug, SlidersHorizontal, Terminal } from "lucide-react";

import { AddModelsDialog } from "@/components/mission-control/add-models/add-models-dialog";
import { AccountIcon } from "@/components/mission-control/account-icon";
import { AgentCapabilityEditorDialog } from "@/components/mission-control/agent-capability-editor-dialog";
import { AgentChatDialog } from "@/components/mission-control/agent-chat-dialog";
import { AgentChatDrawer } from "@/components/mission-control/agent-chat-drawer";
import { AgentModelPickerDialog } from "@/components/mission-control/agent-model-picker-dialog";
import { WorkerProfileDialog } from "@/components/operations/agents/worker-profile-dialog";
import { EmployeeAvatar } from "@/components/workforce/employee-avatar";
import { CreateAgentDialog } from "@/components/mission-control/create-agent-dialog";
import type { PendingAgentProjection } from "@/components/mission-control/pending-agent-projection";
import { Button } from "@/components/ui/button";
import { PikoLoader } from "@/components/ui/piko-loader";
import { toast } from "@/components/ui/sonner";
import { useAccountsData } from "@/components/operations/accounts/use-accounts-data";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { AddModelsProviderId } from "@/lib/openclaw/types";
import type { AccountAccessRuleView } from "@/lib/agentos/account-access-policy-types";
import type { AccountLoginTargetView } from "@/lib/agentos/account-login-target-types";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  buildAgentViews,
  statusToneForAgentFilter,
  type AgentFilter,
  type AgentView
} from "@/components/operations/operations-data";
import { EmptyState, EntityIcon, FilterChip, InspectorPanelFrame, KeyValue, MoreButton, OperationsPageLayout, PageHeader, SearchToolbar, SectionCard, StatusBadge, ToolbarButton, ViewToggle } from "@/components/operations/operations-ui";
import { agentFilterLabel, formatAgentSortLabel, MissionDispatchDialog, readClientError, sortAgentViews, toTitleCase } from "@/components/operations/operations-shared";

type ActiveWork = { title: string; status: "running" | "queued" };

export function AgentsPageContent({
  snapshot,
  rootSnapshot,
  activeWorkspaceId,
  workspaceSelectionReady = true,
  surfaceTheme,
  pendingAgentNames,
  refresh,
  setSnapshot
}: {
  snapshot: MissionControlSnapshot;
  rootSnapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  workspaceSelectionReady?: boolean;
  surfaceTheme: "dark" | "light";
  pendingAgentNames: readonly Pick<PendingAgentProjection, "workspaceId" | "name">[];
  refresh: () => Promise<void>;
  setSnapshot: Dispatch<SetStateAction<MissionControlSnapshot>>;
}) {
  const activeWork = useMemo(() => {
    const items = new Map<string, ActiveWork>();
    for (const task of snapshot.tasks) {
      if (!task.primaryAgentId || (task.status !== "running" && task.status !== "queued")) continue;
      const current = items.get(task.primaryAgentId);
      if (!current || (current.status === "queued" && task.status === "running")) {
        items.set(task.primaryAgentId, { title: task.mission || task.title, status: task.status });
      }
    }
    return items;
  }, [snapshot.tasks]);
  const agents = useMemo(() => {
    const running = new Set(snapshot.runtimes.filter(runtime => runtime.status === "running" &&
      (runtime.source === "turn" || runtime.source === "cron" || runtime.runId)).map(runtime => runtime.id));
    return buildAgentViews(snapshot).map(agent => agent.status === "running" &&
      !agent.source?.activeRuntimeIds.some(id => running.has(id)) && activeWork.get(agent.id)?.status !== "running"
      ? { ...agent, status: "ready" as const, statusLabel: "Ready", statusTone: "success" as const }
      : agent);
  }, [activeWork, snapshot]);
  const { loginTargets, accessRules } = useAccountsData(activeWorkspaceId);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AgentFilter>("all");
  const [sort, setSort] = useState<"last-active" | "name" | "status" | "workspace">("last-active");
  const [preferredView, setView] = useState<"grid" | "list" | null>(null);
  const view = preferredView ?? (agents.length > 6 ? "list" : "grid");
  const [selectedId, setSelectedId] = useState("");
  const [chatAgentId, setChatAgentId] = useState<string | null>(null);
  const [modelAgentId, setModelAgentId] = useState<string | null>(null);
  const [profileAgentId, setProfileAgentId] = useState<string | null>(null);
  const [capabilityAgentId, setCapabilityAgentId] = useState<string | null>(null);
  const [capabilityFocus, setCapabilityFocus] = useState<"skills" | "tools">("skills");
  const [dispatchAgent, setDispatchAgent] = useState<AgentView | null>(null);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [isAddModelsDialogOpen, setIsAddModelsDialogOpen] = useState(false);
  const [modelProviderToConnect, setModelProviderToConnect] = useState<AddModelsProviderId | null>(null);

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
  const selectedAgent = filteredAgents.find((agent) => agent.id === selectedId) ?? null;
  const chatAgent = chatAgentId ? rootSnapshot.agents.find((agent) => agent.id === chatAgentId) ?? null : null;
  const runningCount = agents.filter((agent) => agent.status === "running").length;
  const readyCount = agents.filter((agent) => agent.status === "ready").length;
  const idleCount = agents.filter((agent) => agent.status === "idle").length;
  const approvalCount = agents.filter((agent) => agent.status === "needs-approval").length;
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
  const openAddModels = (provider?: AddModelsProviderId | null) => {
    setModelProviderToConnect(provider ?? null);
    setIsAddModelsDialogOpen(true);
  };
  const openChatModelProvider = (provider: AddModelsProviderId) => {
    setModelProviderToConnect(provider);
    setChatAgentId(null);
    window.requestAnimationFrame(() => setIsAddModelsDialogOpen(true));
  };
  const handleAddModelsOpenChange = (open: boolean) => {
    setIsAddModelsDialogOpen(open);
    if (!open) {
      setModelProviderToConnect(null);
    }
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
      const result = await response.json().catch(() => null) as { error?: string | { message?: string }; outcome?: "ready" | "partial" | "failed" | "unknown"; warnings?: string[] } | null;
      if (!response.ok || result?.error) {
        const errorMessage = typeof result?.error === "string" ? result.error : result?.error?.message;
        throw new Error(errorMessage || result?.warnings?.[0] || "Agent deletion failed.");
      }
      if (result?.outcome === "partial") {
        toast.message("Agent deleted; cleanup needs attention.", { description: result.warnings?.[0] || "Review the operation details." });
      } else {
        toast.success("Agent deleted.");
      }
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
      <PikoLoader
        open={Boolean(deletingAgentId)}
        title="Deleting agent"
        description="Removing the agent and cleaning up its OpenClaw workspace binding."
      />
      <OperationsPageLayout
        main={
          <>
          <PageHeader
            surfaceTheme={surfaceTheme}
            title="Team"
            subtitle="Meet your employees, see what they’re working on, and give them their next assignment."
            actions={
              <>
                <CreateAgentDialog
                  workforce
                  snapshot={rootSnapshot}
                  defaultWorkspaceId={activeWorkspaceId}
                  pendingAgentNames={pendingAgentNames}
                  onRefresh={refresh}
                  onSnapshotChange={(updater) => setSnapshot((current) => updater(current))}
                  onAgentCreated={setSelectedId}
                  onAgentCreatedVisible={setSelectedId}
                  surfaceTheme={surfaceTheme}
                  trigger={
                    <Button
                      size="sm"
                      disabled={!workspaceSelectionReady}
                      className="min-h-11 px-4"
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Add employee
                    </Button>
                  }
                />
              </>
            }
          />

          <SearchToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search employees"
            surfaceTheme={surfaceTheme}
            right={<div className="hidden gap-2 sm:flex">
              <ToolbarButton surfaceTheme={surfaceTheme} icon={SlidersHorizontal} label={`Sort: ${formatAgentSortLabel(sort)}`} chevron onClick={() => setSort((current) => sortModes[(sortModes.indexOf(current) + 1) % sortModes.length])} />
              <ViewToggle value={view} onChange={setView} surfaceTheme={surfaceTheme} />
            </div>}
          />

          <div className="flex flex-wrap items-center gap-2">
            {(["all", "ready", "running", "idle", "needs-approval"] as AgentFilter[]).filter(id => id === "all" || id === filter || filterCounts[id] > 0).map((id) => (
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
            <div className={cn(view === "grid" ? "grid gap-4 sm:grid-cols-2 xl:grid-cols-3" : "workforce-panel divide-y divide-border/75 overflow-hidden")}>
              {filteredAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  currentWork={activeWork.get(agent.id)}
                  connectionBadges={resolveAgentConnectionBadges(agent, loginTargets, accessRules)}
                  selected={selectedAgent?.id === agent.id}
                  list={view === "list"}
                  onSelect={() => setSelectedId((current) => current === agent.id ? "" : agent.id)}
                  onMessage={() => setChatAgentId(agent.id)}
                  onRunTask={() => setDispatchAgent(agent)}
                  onManageProfile={() => setProfileAgentId(agent.id)}
                />
              ))}
            </div>
          ) : (
            <EmptyState title={agents.length ? "No employees match" : "Your team is empty"}
              description={agents.length ? "Clear the search or change the filter." : "Add an employee to start working in this workspace."} />
          )}

          {snapshot.tasks.length ? <details className="rounded-xl border border-border bg-card px-4">
            <summary className="cursor-pointer py-3 text-sm font-medium">Recent work</summary>
            <div className="pb-4"><RecentAgentActivity snapshot={snapshot} agents={agents} /></div>
          </details> : null}
        </>
      }
      inspector={selectedAgent ? (
        <AgentInspector
          agent={selectedAgent}
          deleting={deletingAgentId === selectedAgent.id}
          onMessage={() => setChatAgentId(selectedAgent.id)}
          onRunTask={() => setDispatchAgent(selectedAgent)}
          onChangeModel={() => setModelAgentId(selectedAgent.id)}
          onManageProfile={() => setProfileAgentId(selectedAgent.id)}
          onManagePolicy={() => openCapabilityEditor(selectedAgent.id, "skills")}
          onManageTools={() => openCapabilityEditor(selectedAgent.id, "tools")}
          onDelete={() => void deleteAgent(selectedAgent)}
        />
      ) : null}
    />
      <AgentChatDialog
        open={Boolean(chatAgent)}
        onOpenChange={(open) => setChatAgentId(open ? chatAgentId : null)}
        agent={chatAgent}
      >
        {chatAgent ? (
          <AgentChatDrawer
            agent={chatAgent}
            snapshot={rootSnapshot}
            isVisible={Boolean(chatAgent)}
            onRefresh={refresh}
            onSnapshotChange={(updater) => setSnapshot((current) => updater(current))}
            onConnectModelProvider={openChatModelProvider}
          />
        ) : null}
      </AgentChatDialog>
      <AgentModelPickerDialog
        open={Boolean(modelAgentId)}
        agentId={modelAgentId}
        snapshot={rootSnapshot}
        onOpenChange={(open) => setModelAgentId(open ? modelAgentId : null)}
        onSnapshotChange={(updater) => setSnapshot((current) => updater(current))}
        onRefresh={refresh}
        onOpenAddModels={openAddModels}
        surfaceTheme={surfaceTheme}
      />
      <WorkerProfileDialog
        open={Boolean(profileAgentId)}
        agentId={profileAgentId}
        snapshot={rootSnapshot}
        onOpenChange={(open) => setProfileAgentId(open ? profileAgentId : null)}
        onRefresh={refresh}
        onChangeModel={(agentId) => {
          setProfileAgentId(null);
          setModelAgentId(agentId);
        }}
        onManageCapabilities={(agentId, focus) => {
          setProfileAgentId(null);
          openCapabilityEditor(agentId, focus);
        }}
        surfaceTheme={surfaceTheme}
      />
      <AddModelsDialog
        open={isAddModelsDialogOpen}
        onOpenChange={handleAddModelsOpenChange}
        snapshot={rootSnapshot}
        initialProvider={modelProviderToConnect}
        onSnapshotChange={setSnapshot}
        surfaceTheme={surfaceTheme}
      />
      <AgentCapabilityEditorDialog
        open={Boolean(capabilityAgentId)}
        agentId={capabilityAgentId}
        initialFocus={capabilityFocus}
        snapshot={rootSnapshot}
        onOpenChange={(open) => setCapabilityAgentId(open ? capabilityAgentId : null)}
        onSnapshotChange={(updater) => setSnapshot((current) => updater(current))}
        onRefresh={refresh}
        surfaceTheme={surfaceTheme}
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
  currentWork,
  connectionBadges,
  selected,
  list,
  onSelect,
  onMessage,
  onRunTask,
  onManageProfile
}: {
  agent: AgentView;
  currentWork: ActiveWork | undefined;
  connectionBadges: AgentConnectionBadge[];
  selected: boolean;
  list: boolean;
  onSelect: () => void;
  onMessage: () => void;
  onRunTask: () => void;
  onManageProfile: () => void;
}) {
  const role = agent.source?.workerProfile?.employment.role || agent.policyLabel;
  const chatHref = `/chat?employee=${encodeURIComponent(agent.id)}`;

  const activity = currentWork
    ? `${currentWork.status === "running" ? "Working on" : "Queued"}: ${currentWork.title}`
    : agent.status === "running" ? "Active session"
      : agent.status === "needs-approval" ? "Needs approval" : "No active task";

  return (
    <article className={cn("workforce-person min-w-0", selected && "workforce-person--selected", list ? "workforce-person--list" : "workforce-directory-card")}>
      <div className="flex min-w-0 items-center gap-4">
        <EmployeeAvatar agent={agent.source} name={agent.name} className={cn("size-20 rounded-2xl text-lg", list && "size-14 rounded-xl")} />
        <div className="min-w-0 flex-1">
          <h2 className={cn("break-words font-display text-2xl font-semibold leading-tight", list && "text-lg")}>
            <Link href={`/agents/${encodeURIComponent(agent.id)}`} className="rounded-sm hover:underline focus-visible:outline focus-visible:outline-ring">
              {agent.name} <ArrowUpRight className="ml-1 inline size-3 text-muted-foreground" aria-hidden="true" />
            </Link>
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{role}</p>
        </div>
      </div>
      <div className="workforce-person-work min-w-0">
        {agent.purpose !== role ? <p className="line-clamp-2 text-sm leading-6 text-foreground">{agent.purpose}</p> : null}
        <p className="flex items-start gap-2 text-sm leading-5 text-muted-foreground">
          <span aria-hidden="true" className={cn("mt-[0.42rem] size-2 shrink-0 rounded-full bg-muted-foreground/45", (agent.status === "running" || currentWork?.status === "running") && "bg-[hsl(var(--status-success))]")} />
          {activity}
        </p>
        {connectionBadges.length ? (
          <details className="workforce-disclosure">
            <summary>Connections</summary>
            <div className="pt-2"><AgentConnectionIconRow badges={connectionBadges} /></div>
          </details>
        ) : null}
      </div>

      <div className={cn("flex flex-wrap items-center gap-1.5", list ? "sm:ml-auto" : "border-t border-border/65 pt-2.5")}>
        {agent.source ? (
          <Button asChild variant="secondary" size="sm" className="min-h-11 sm:min-h-8">
            <Link href={chatHref}><MessageSquare className="mr-1.5 size-3.5" /> Chat</Link>
          </Button>
        ) : (
          <Button type="button" variant="secondary" size="sm" onClick={onMessage}>Chat</Button>
        )}
        <Button type="button" variant="ghost" size="sm" className="min-h-11 sm:min-h-8" onClick={onRunTask}>
          <Play className="mr-1.5 size-3.5" /> Assign task
        </Button>
        <Button type="button" variant="ghost" size="icon" title="Quick details" className="ml-auto min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
          aria-label={`Quick details for ${agent.name}`} aria-expanded={selected} onClick={onSelect}>
          <SlidersHorizontal className="size-3.5" />
        </Button>
        {selected ? <Button type="button" variant="ghost" size="sm" onClick={onManageProfile}>Edit profile</Button> : null}
      </div>
    </article>
  );
}

function AgentConnectionIconRow({
  badges
}: {
  badges: AgentConnectionBadge[];
}) {
  if (badges.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {badges.map((badge) => (
        <span
          key={badge.key}
          className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-slate-950/62 px-1.5 py-1 shadow-[0_10px_20px_rgba(0,0,0,0.24)] backdrop-blur-xl"
          title={badge.title}
          aria-label={badge.title}
        >
          {badge.kind === "account" ? (
            <AccountIcon
              serviceId={badge.serviceId}
              serviceName={badge.label}
              primaryDomain={badge.primaryDomain}
              className="h-5 w-5 border-white/10 bg-slate-950/60 shadow-none"
            />
          ) : (
            <EntityIcon icon={badge.icon} label={badge.label} tone={badge.tone} size="sm" />
          )}
        </span>
      ))}
    </div>
  );
}

type AgentConnectionBadge = {
  key: string;
  kind: "integration" | "account";
  title: string;
  label: string;
  icon?: LucideIcon;
  tone: "success" | "info" | "warning" | "danger" | "muted" | "purple";
  serviceId?: string;
  primaryDomain?: string;
};

function resolveAgentConnectionBadges(
  agent: AgentView,
  loginTargets: AccountLoginTargetView[],
  accessRules: AccountAccessRuleView[]
) {
  const source = agent.source;
  if (!source) {
    return [];
  }

  const toolNames = new Set([...(source.tools ?? []), ...(source.observedTools ?? [])].map((tool) => tool.toLowerCase()));
  const badges: AgentConnectionBadge[] = [];

  if (toolNames.has("gateway")) {
    badges.push({
      key: "integration:gateway",
      kind: "integration",
      title: "Gateway",
      label: "Gateway",
      icon: Plug,
      tone: "info"
    });
  }

  if (toolNames.has("browser")) {
    badges.push({
      key: "integration:browser",
      kind: "integration",
      title: "Browser",
      label: "Browser",
      icon: Chrome,
      tone: "warning"
    });
  }

  if (toolNames.has("exec") || toolNames.has("process")) {
    badges.push({
      key: "integration:runtime",
      kind: "integration",
      title: "Runtime",
      label: "Runtime",
      icon: Terminal,
      tone: "muted"
    });
  }

  if (toolNames.has("read") || toolNames.has("write") || toolNames.has("fs.workspaceonly")) {
    badges.push({
      key: "integration:workspace",
      kind: "integration",
      title: "Workspace files",
      label: "Workspace",
      icon: Folder,
      tone: "success"
    });
  }

  if (toolNames.has("web_search") || toolNames.has("web_fetch")) {
    badges.push({
      key: "integration:web",
      kind: "integration",
      title: "Web",
      label: "Web",
      icon: Globe2,
      tone: "purple"
    });
  }

  for (const badge of buildAgentAccountBadges(agent, loginTargets, accessRules).slice(0, 4)) {
    badges.push({
      key: `account:${badge.id}`,
      kind: "account",
      title: `${badge.serviceName} · ${badge.browserProfileName}`,
      label: badge.serviceName,
      serviceId: badge.serviceId,
      primaryDomain: badge.primaryDomain,
      tone: "warning"
    });
  }

  return badges.slice(0, 5);
}

function buildAgentAccountBadges(
  agent: AgentView,
  loginTargets: AccountLoginTargetView[],
  accessRules: AccountAccessRuleView[]
) {
  const targetsById = new Map(loginTargets.map((target) => [target.id, target]));
  const summaries = new Map<
    string,
    {
      id: string;
      serviceId: string;
      serviceName: string;
      primaryDomain: string;
      browserProfileName: string;
    }
  >();

  for (const rule of accessRules) {
    if (rule.agentId !== agent.id || rule.permission !== "use_browser_profile") {
      continue;
    }

    const target = targetsById.get(rule.targetId);
    if (!target) {
      continue;
    }

    const key = `${target.serviceId}:${target.primaryDomain}:${target.browserProfileName}`;
    if (!summaries.has(key)) {
      summaries.set(key, {
        id: target.id,
        serviceId: target.serviceId,
        serviceName: target.serviceName,
        primaryDomain: target.primaryDomain,
        browserProfileName: target.browserProfileName
      });
    }
  }

  return Array.from(summaries.values()).sort((left, right) => left.serviceName.localeCompare(right.serviceName));
}

function AgentInspector({
  agent,
  deleting,
  onMessage,
  onRunTask,
  onChangeModel,
  onManageProfile,
  onManagePolicy,
  onManageTools,
  onDelete
}: {
  agent: AgentView;
  deleting: boolean;
  onMessage: () => void;
  onRunTask: () => void;
  onChangeModel: () => void;
  onManageProfile: () => void;
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
        <KeyValue label="Worker Profile" value={agent.source?.workerProfile?.employment.role ?? "Role baseline"} action={<button className="text-primary" onClick={onManageProfile}>Manage</button>} />
        <KeyValue label="Role" value={agent.source?.policy.preset ? toTitleCase(agent.source.policy.preset) : agent.policyLabel} />
        <KeyValue label="Policy Mode" value={agent.policyLabel} action={<button className="text-primary" onClick={onManagePolicy}>Manage</button>} />
        <KeyValue label="Workspace Scope" value={agent.source?.toolPolicy?.fs?.workspaceOnly ? `${agent.workspaceName} (Workspace only)` : `${agent.workspaceName} (Policy controlled)`} />
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
    <SectionCard title="Recent Activity" action={<Button asChild variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-[0.68rem]"><Link href="/missions">View tasks</Link></Button>}>
      {rows.length === 0 ? (
        <EmptyState title="No runtime activity" description="No agent runtime events were reported in the current AgentOS snapshot." />
      ) : (
      <div>
        <div className="divide-y divide-border sm:hidden">
          {rows.map((row, index) => (
            <div key={`${row.agent}-${row.task}-${index}`} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{row.agent}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{row.event}</p>
                </div>
                <StatusBadge label={row.status} tone={row.status === "completed" ? "success" : row.status === "running" ? "info" : "warning"} />
              </div>
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-foreground/80">{row.task}</p>
              <p className="mt-1 text-[0.68rem] text-muted-foreground">{row.time}</p>
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto sm:block">
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
      </div>
      )}
    </SectionCard>
  );
}
