"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  CircleDashed,
  Code2,
  FolderKanban,
  Gauge,
  MessageCircle,
  Pencil,
  Play,
  RefreshCw,
  Sparkles,
  Wrench
} from "lucide-react";

import { AddModelsDialog } from "@/components/mission-control/add-models/add-models-dialog";
import { AgentCapabilityEditorDialog } from "@/components/mission-control/agent-capability-editor-dialog";
import { AgentChatDrawer } from "@/components/mission-control/agent-chat-drawer";
import { AgentModelPickerDialog } from "@/components/mission-control/agent-model-picker-dialog";
import { AgentChannelsSection } from "@/components/operations/agents/agent-channels-section";
import { EffectiveCapabilitiesPanel } from "@/components/operations/agents/effective-capabilities-panel";
import {
  AGENT_DETAIL_TABS,
  parseAgentDetailQueryState,
  type AgentDetailTab
} from "@/components/operations/agents/agent-detail-tabs";
import { WorkerProfileDialog } from "@/components/operations/agents/worker-profile-dialog";
import {
  buildAgentDetailActivity,
  buildAgentDetailSessions,
  resolveAgentCurrentWork,
  resolveAgentDetailWorkspace
} from "@/components/operations/agents/agent-detail-data";
import { MissionDispatchDialog } from "@/components/operations/operations-shared";
import { buildAgentViews, type AgentView } from "@/components/operations/operations-data";
import {
  EmptyState,
  EntityIcon,
  KeyValue,
  OperationsPageLayout,
  PageHeader,
  SectionCard,
  StatusBadge,
  type StatusTone
} from "@/components/operations/operations-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  useWorkerEffectiveCapabilities,
  type WorkerEffectiveCapabilitiesState
} from "@/hooks/use-worker-effective-capabilities";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { formatAgentDisplayName, formatRelativeTime, resolveAgentModelLabel, resolveRelativeTimeReferenceMs } from "@/lib/openclaw/presenters";
import type { SkillLibraryItem, WorkerEffectiveCapabilitiesPayload } from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

export { parseAgentDetailTab, type AgentDetailTab } from "@/components/operations/agents/agent-detail-tabs";

function readAgentDetailLocation() {
  if (typeof window === "undefined") {
    return parseAgentDetailQueryState({});
  }
  const search = new URLSearchParams(window.location.search);
  return parseAgentDetailQueryState({
    tab: search.get("tab"),
    capability: search.get("capability"),
    session: search.get("session")
  });
}

export function AgentDetailPageContent({
  agentId,
  snapshot,
  rootSnapshot,
  surfaceTheme,
  refresh,
  setSnapshot,
  initialTab,
  initialCapabilityFocus,
  initialSessionFocus
}: {
  agentId: string;
  snapshot: MissionControlSnapshot;
  rootSnapshot: MissionControlSnapshot;
  surfaceTheme: "dark" | "light";
  refresh: () => Promise<void>;
  setSnapshot: Dispatch<SetStateAction<MissionControlSnapshot>>;
  initialTab: AgentDetailTab;
  initialCapabilityFocus: string | null;
  initialSessionFocus: string | null;
}) {
  const agent = snapshot.agents.find((entry) => entry.id === agentId) ?? null;
  const workspace = agent ? resolveAgentDetailWorkspace(snapshot, agent) : null;
  const [tab, setTab] = useState<AgentDetailTab>(initialTab);
  const [chatOpen, setChatOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [capabilityOpen, setCapabilityOpen] = useState(false);
  const [capabilityFocus, setCapabilityFocus] = useState<"skills" | "tools">("skills");
  const [addModelsOpen, setAddModelsOpen] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const capabilities = useWorkerEffectiveCapabilities({ agentId: agent?.id });
  const [capabilityFocusId, setCapabilityFocusId] = useState(initialCapabilityFocus);
  const [sessionFocusKey, setSessionFocusKey] = useState(initialSessionFocus);

  useEffect(() => {
    const handlePopState = () => {
      const location = readAgentDetailLocation();
      setTab(location.tab);
      setCapabilityFocusId(location.capabilityFocus);
      setSessionFocusKey(location.sessionFocus);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const agentView = useMemo<AgentView | null>(
    () => (agent ? buildAgentViews(snapshot).find((entry) => entry.id === agent.id) ?? null : null),
    [agent, snapshot]
  );
  const currentWork = agent ? resolveAgentCurrentWork(agent, snapshot) : null;
  const sessions = agent ? buildAgentDetailSessions(snapshot, agent.id) : [];
  const activity = agent ? buildAgentDetailActivity(snapshot, agent.id) : [];

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (tab === "capabilities" && capabilityFocusId) {
      const target = Array.from(document.querySelectorAll<HTMLElement>("[data-capability-id]"))
        .find((element) => element.dataset.capabilityId === capabilityFocusId);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    if (tab === "sessions" && sessionFocusKey) {
      const target = Array.from(document.querySelectorAll<HTMLElement>("[data-session-key]"))
        .find((element) => element.dataset.sessionKey === sessionFocusKey);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [capabilities.data, capabilityFocusId, sessionFocusKey, sessions.length, tab]);

  const updateTab = (nextTab: AgentDetailTab) => {
    if (typeof window === "undefined") {
      setTab(nextTab);
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("tab", nextTab);
    if (nextTab !== "capabilities") url.searchParams.delete("capability");
    if (nextTab !== "sessions") url.searchParams.delete("session");
    window.history.pushState({}, "", url);
    setTab(nextTab);
    setCapabilityFocusId(nextTab === "capabilities" ? parseAgentDetailQueryState({ capability: url.searchParams.get("capability") }).capabilityFocus : null);
    setSessionFocusKey(nextTab === "sessions" ? parseAgentDetailQueryState({ session: url.searchParams.get("session") }).sessionFocus : null);
  };

  if (!agent || !workspace || !agentView || !currentWork) {
    return (
      <OperationsPageLayout
        main={<div className="space-y-3"><EmptyState title="Worker unavailable" description="This agent is no longer present in the current OpenClaw snapshot. Return to the roster and refresh to continue." /><Link href="/agents" className="mx-auto flex w-fit rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground">Back to Agents</Link></div>}
        inspector={null}
      />
    );
  }

  const modelLabel = resolveAgentModelLabel(agent.modelId, rootSnapshot.models);
  const statusTone = agentView.statusTone as StatusTone;
  const displayName = formatAgentDisplayName(agent);
  const openCapabilityEditor = (focus: "skills" | "tools") => {
    setCapabilityFocus(focus);
    setCapabilityOpen(true);
  };
  return (
    <>
      <OperationsPageLayout
        main={
          <div className="space-y-4">
            <Link href="/agents" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Agents
            </Link>

            <PageHeader
              title={displayName}
              subtitle={`${agent.workerProfile?.employment.role || "OpenClaw worker"} · ${workspace.name}`}
              actions={
                <>
                  <Button variant="ghost" size="sm" className="h-9 rounded-lg px-3 text-xs" onClick={() => setProfileOpen(true)}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button variant="secondary" size="sm" className="h-9 rounded-lg px-3 text-xs" onClick={() => setChatOpen(true)}>
                    <MessageCircle className="mr-1.5 h-3.5 w-3.5" /> Chat
                  </Button>
                  <Button size="sm" className="h-9 rounded-lg px-3 text-xs" onClick={() => setDispatchOpen(true)}>
                    <Play className="mr-1.5 h-3.5 w-3.5" /> Give work
                  </Button>
                </>
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge label={agentView.statusLabel} tone={statusTone} />
                <Badge variant="muted" className="rounded-full px-2 py-1 text-[10px] normal-case tracking-normal">{modelLabel}</Badge>
                <Badge variant="muted" className="rounded-full px-2 py-1 text-[10px] normal-case tracking-normal">{workspace.name}</Badge>
                <span className="text-[11px] text-muted-foreground">Updated {formatRelativeTime(agent.lastActiveAt, resolveRelativeTimeReferenceMs(snapshot.generatedAt))}</span>
              </div>
            </PageHeader>

            <nav aria-label="Worker detail sections" className="overflow-x-auto border-b border-border">
              <div className="flex min-w-max gap-1">
                {AGENT_DETAIL_TABS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === item.id}
                    onClick={() => updateTab(item.id)}
                    className={cn("border-b-2 px-3 py-2.5 text-xs font-medium transition-colors", tab === item.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </nav>

            <div role="tabpanel" aria-label={`${AGENT_DETAIL_TABS.find((item) => item.id === tab)?.label} for ${displayName}`}>
              {tab === "overview" ? <OverviewTab agent={agent} workspace={workspace} modelLabel={modelLabel} currentWork={currentWork} activity={activity} capabilities={capabilities.data} onOpenCapabilities={() => updateTab("capabilities")} onOpenChannels={() => updateTab("channels")} onChangeModel={() => setModelOpen(true)} /> : null}
              {tab === "behavior" ? <BehaviorTab agent={agent} onEdit={() => setProfileOpen(true)} /> : null}
              {tab === "capabilities" ? (
                <CapabilitiesTab
                  agent={agent}
                  capabilities={capabilities}
                  onRefreshCapabilities={() => void capabilities.refresh()}
                  onActivate={capabilities.activateSkill}
                  onOpenEditor={openCapabilityEditor}
                  onEditProfile={() => setProfileOpen(true)}
                  focusId={capabilityFocusId}
                />
              ) : null}
              {tab === "channels" ? <ChannelsTab agent={agent} workspace={workspace} surfaceTheme={surfaceTheme} onRouteChanged={refresh} /> : null}
              {tab === "sessions" ? <SessionsTab sessions={sessions} activity={activity} onRefresh={refresh} focusKey={sessionFocusKey} /> : null}
            </div>
          </div>
        }
        inspector={null}
      />

      <Dialog open={chatOpen} onOpenChange={setChatOpen}>
        <DialogContent className="left-0 top-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 sm:left-1/2 sm:top-1/2 sm:h-[min(82dvh,760px)] sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:gap-4 sm:rounded-[18px] sm:border sm:p-4">
          <DialogHeader className="shrink-0 border-b border-border/55 px-3 pb-3 pt-[calc(0.6rem+env(safe-area-inset-top))] sm:border-0 sm:p-0">
            <div className="flex items-center gap-3 sm:block">
              <DialogClose className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-accent sm:hidden"><ArrowLeft className="h-4 w-4" /><span className="sr-only">Back to worker detail</span></DialogClose>
              <div className="min-w-0 sm:pr-10"><DialogTitle className="truncate text-[1.05rem] sm:text-xl">Chat with {displayName}</DialogTitle><DialogDescription className="mt-0.5 truncate text-[11px] sm:mt-2 sm:text-sm">Messages use the existing AgentOS/OpenClaw agent chat runner.</DialogDescription></div>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-0"><AgentChatDrawer agent={agent} snapshot={rootSnapshot} surfaceTheme={surfaceTheme} isVisible={chatOpen} onRefresh={refresh} onSnapshotChange={(updater) => setSnapshot((current) => updater(current))} /></div>
        </DialogContent>
      </Dialog>

      <WorkerProfileDialog
        open={profileOpen}
        agentId={agent.id}
        snapshot={rootSnapshot}
        onOpenChange={setProfileOpen}
        onRefresh={refresh}
        onChangeModel={() => { setProfileOpen(false); setModelOpen(true); }}
        onManageCapabilities={(nextAgentId, focus) => { setProfileOpen(false); setCapabilityFocus(focus); setCapabilityOpen(Boolean(nextAgentId)); }}
        surfaceTheme={surfaceTheme}
      />
      <AgentModelPickerDialog open={modelOpen} agentId={agent.id} snapshot={rootSnapshot} onOpenChange={setModelOpen} onSnapshotChange={(updater) => setSnapshot((current) => updater(current))} onRefresh={refresh} onOpenAddModels={() => setAddModelsOpen(true)} surfaceTheme={surfaceTheme} />
      <AddModelsDialog open={addModelsOpen} onOpenChange={setAddModelsOpen} snapshot={rootSnapshot} onSnapshotChange={setSnapshot} surfaceTheme={surfaceTheme} />
      <AgentCapabilityEditorDialog open={capabilityOpen} agentId={agent.id} initialFocus={capabilityFocus} snapshot={rootSnapshot} onOpenChange={setCapabilityOpen} onSnapshotChange={(updater) => setSnapshot((current) => updater(current))} onRefresh={refresh} surfaceTheme={surfaceTheme} />
      <MissionDispatchDialog open={dispatchOpen} agent={agentView} onOpenChange={setDispatchOpen} onSubmitted={refresh} />
    </>
  );
}

function OverviewTab({ agent, workspace, modelLabel, currentWork, activity, capabilities, onOpenCapabilities, onOpenChannels, onChangeModel }: { agent: MissionControlSnapshot["agents"][number]; workspace: MissionControlSnapshot["workspaces"][number]; modelLabel: string; currentWork: ReturnType<typeof resolveAgentCurrentWork>; activity: ReturnType<typeof buildAgentDetailActivity>; capabilities: WorkerEffectiveCapabilitiesPayload | null; onOpenCapabilities: () => void; onOpenChannels: () => void; onChangeModel: () => void }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
      <div className="space-y-4">
        <SectionCard title="Current operation">
          <div className="p-4"><div className="flex items-start gap-3"><EntityIcon icon={Gauge} label="Work" tone="info" size="md" /><div className="min-w-0"><p className="text-sm font-semibold">{currentWork.label}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{currentWork.detail}</p><div className="mt-3 flex flex-wrap gap-2"><StatusBadge label={currentWork.status} tone={currentWork.status === "running" ? "info" : currentWork.status === "completed" ? "success" : "muted"} /><span className="text-[11px] text-muted-foreground">{currentWork.taskId ? `Task ${currentWork.taskId}` : "No task id reported"}</span></div></div></div></div>
        </SectionCard>
        <SectionCard title="Recent work and sessions">
          {activity.length ? <div className="divide-y divide-border">{activity.slice(0, 5).map((entry) => <div key={entry.id} className="flex items-start gap-3 px-4 py-3"><CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{entry.title}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{entry.detail}</p></div><span className="shrink-0 text-[10px] text-muted-foreground">{entry.updatedLabel}</span></div>)}</div> : <div className="p-4"><EmptyState title="No recent runtime evidence" description="OpenClaw has not reported recent task or runtime activity for this worker." /></div>}
        </SectionCard>
      </div>
      <div className="space-y-4">
        <SectionCard title="Worker identity">
          <div className="p-4"><div className="flex items-start gap-3"><EntityIcon icon={Bot} label={agent.identity.emoji || agent.name} tone="purple" size="lg" /><div className="min-w-0"><p className="text-base font-semibold">{agent.identity.emoji ? `${agent.identity.emoji} ` : ""}{agent.name}</p><p className="mt-1 text-xs text-muted-foreground">{agent.workerProfile?.employment.role || "OpenClaw worker"}</p></div></div><div className="mt-4"><KeyValue label="Workspace" value={workspace.name} /><KeyValue label="Model" value={modelLabel} action={<Button variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-[10px]" onClick={onChangeModel}>Change</Button>} /><KeyValue label="Heartbeat" value={agent.heartbeat.enabled ? agent.heartbeat.every || "Enabled" : "Off"} /><KeyValue label="Sessions" value={String(agent.sessionCount)} /></div></div>
        </SectionCard>
        <SectionCard title="Effective capability summary" action={<Button variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-[11px]" onClick={onOpenCapabilities}>Open</Button>}>
          <div className="p-4">{capabilities ? <div className="flex flex-wrap gap-2"><CapabilityCount label="Available" value={capabilities.summary.available} tone="success" /><CapabilityCount label="Needs setup" value={capabilities.summary["needs-setup"]} tone="warning" /><CapabilityCount label="Approval" value={capabilities.summary["requires-approval"]} tone="info" /></div> : <p className="text-xs text-muted-foreground">Effective capability state is still loading or unavailable.</p>}<p className="mt-3 text-[11px] leading-5 text-muted-foreground">Configured declarations and effective session tools are shown separately in Capabilities.</p></div>
        </SectionCard>
        <SectionCard title="Delivery" action={<Button variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-[11px]" onClick={onOpenChannels}>Open</Button>}>
          <div className="p-4"><p className="text-xs leading-5 text-muted-foreground">Channel bindings remain owned by OpenClaw&apos;s canonical route service.</p><div className="mt-3 flex items-center gap-2 text-xs font-medium"><MessageCircle className="h-4 w-4 text-primary" />{agent.workspaceId ? "Workspace-scoped routes" : "No workspace binding"}</div></div>
        </SectionCard>
      </div>
    </div>
  );
}

function BehaviorTab({ agent, onEdit }: { agent: MissionControlSnapshot["agents"][number]; onEdit: () => void }) {
  const behavior = agent.workerProfile?.employment.behaviorInstructions || agent.profile.operatingInstructions.join("\n\n");
  const mission = agent.workerProfile?.employment.mission || agent.profile.purpose || "No mission statement is configured.";
  const labels = agent.workerProfile?.operator.labels ?? [];
  return <div className="space-y-4"><SectionCard title="Behavior contract" action={<Button size="sm" variant="secondary" className="h-8 rounded-lg px-3 text-xs" onClick={onEdit}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit behavior</Button>}><div className="grid gap-4 p-4 lg:grid-cols-2"><ReadOnlyBlock label="Mission" value={mission} /><ReadOnlyBlock label="Working guidance" value={behavior || "No behavior instructions are configured."} /><div className="lg:col-span-2"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Operator labels</p><div className="mt-2 flex flex-wrap gap-2">{labels.length ? labels.map((label) => <Badge key={label} variant="muted" className="rounded-full px-2 py-1 text-[10px] normal-case tracking-normal">{label}</Badge>) : <span className="text-xs text-muted-foreground">No labels configured.</span>}</div></div></div></SectionCard><SectionCard title="Edit semantics"><div className="flex items-start gap-3 p-4"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /><p className="text-xs leading-5 text-muted-foreground">Behavior edits open the existing Worker Profile editor. Draft changes stay local until Save Worker Profile commits them through the protected AgentOS/OpenClaw update path.</p></div></SectionCard></div>;
}

function CapabilitiesTab({ agent, capabilities, onRefreshCapabilities, onActivate, onOpenEditor, onEditProfile, focusId }: { agent: MissionControlSnapshot["agents"][number]; capabilities: WorkerEffectiveCapabilitiesState; onRefreshCapabilities: () => void; onActivate: (skill: SkillLibraryItem) => Promise<boolean>; onOpenEditor: (focus: "skills" | "tools") => void; onEditProfile: () => void; focusId: string | null }) {
  return <div className="space-y-4"><SectionCard title="Configured vs effective" action={<Button variant="ghost" size="sm" className="h-8 rounded-lg px-2.5 text-xs" onClick={onRefreshCapabilities}><RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", capabilities.loading && "animate-spin")} />Refresh</Button>}><div className="grid gap-4 p-4 lg:grid-cols-2"><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Configured declarations</p><div className="mt-2 flex flex-wrap gap-2">{agent.skills.map((skill) => <Badge key={skill} variant="muted" className="rounded-full px-2 py-1 text-[10px] normal-case tracking-normal">Skill · {skill}</Badge>)}{agent.tools.map((tool) => <Badge key={tool} variant="muted" className="rounded-full px-2 py-1 text-[10px] normal-case tracking-normal">Tool · {tool}</Badge>)}{agent.skills.length === 0 && agent.tools.length === 0 ? <span className="text-xs text-muted-foreground">No explicit declarations.</span> : null}</div><div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="secondary" className="h-8 rounded-lg px-3 text-xs" onClick={() => onOpenEditor("skills")}><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Manage skills</Button><Button size="sm" variant="secondary" className="h-8 rounded-lg px-3 text-xs" onClick={() => onOpenEditor("tools")}><Wrench className="mr-1.5 h-3.5 w-3.5" /> Manage tools</Button></div></div><div><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Effective session state</p>{capabilities.loading ? <p className="mt-2 text-xs text-muted-foreground">Reading native OpenClaw session evidence…</p> : capabilities.error ? <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-200">{capabilities.error}</p> : capabilities.data ? <div className="mt-2 flex flex-wrap gap-2"><CapabilityCount label="Available" value={capabilities.data.summary.available} tone="success" /><CapabilityCount label="Setup" value={capabilities.data.summary["needs-setup"]} tone="warning" /><CapabilityCount label="Approval" value={capabilities.data.summary["requires-approval"]} tone="info" /><CapabilityCount label="Blocked" value={capabilities.data.summary.blocked} tone="danger" /></div> : <p className="mt-2 text-xs text-muted-foreground">No effective session state was returned.</p>}</div></div></SectionCard><EffectiveCapabilitiesPanel state={capabilities} onActivate={onActivate} focusId={focusId} /><SectionCard title="Guardrails & access" action={<Button size="sm" variant="ghost" className="h-8 rounded-lg px-2.5 text-xs" onClick={onEditProfile}>Edit in Worker Profile</Button>}><div className="grid gap-3 p-4 sm:grid-cols-3"><KeyValue label="Policy" value={agent.policy.preset} /><KeyValue label="File access" value={agent.policy.fileAccess} /><KeyValue label="Network" value={agent.policy.networkAccess} /><KeyValue label="Sandbox" value={agent.sandbox?.mode || "Inherited"} /><KeyValue label="Sandbox scope" value={agent.sandbox?.scope || "Inherited"} /><KeyValue label="Workspace access" value={agent.sandbox?.workspaceAccess || "Inherited"} /></div></SectionCard></div>;
}

function ChannelsTab({ agent, workspace, surfaceTheme, onRouteChanged }: { agent: MissionControlSnapshot["agents"][number]; workspace: MissionControlSnapshot["workspaces"][number]; surfaceTheme: "dark" | "light"; onRouteChanged: () => Promise<void> }) {
  return <SectionCard title="Channel bindings" action={<Button asChild size="sm" variant="secondary" className="h-8 rounded-lg px-2.5 text-xs"><Link href={`/channels/simulator?expectedAgentId=${encodeURIComponent(agent.id)}`}>Test delivery</Link></Button>}><div className="p-4"><p className="mb-4 max-w-2xl text-xs leading-5 text-muted-foreground">These routes are read and changed through OpenClaw&apos;s canonical Channel Center binding service. Telegram groups and topics keep their inherited and explicit route states.</p><AgentChannelsSection agentId={agent.id} workspaceId={workspace.id} workspacePath={workspace.path} surfaceTheme={surfaceTheme} onRouteChanged={onRouteChanged} /></div></SectionCard>;
}

function SessionsTab({ sessions, activity, onRefresh, focusKey }: { sessions: ReturnType<typeof buildAgentDetailSessions>; activity: ReturnType<typeof buildAgentDetailActivity>; onRefresh: () => Promise<void>; focusKey: string | null }) {
  return <div className="space-y-4"><SectionCard title="Session history" action={<Button size="sm" variant="ghost" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => void onRefresh()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button>}><div className="p-4"><p className="mb-3 text-xs leading-5 text-muted-foreground">Session rows are projected from the existing OpenClaw runtime/session/task snapshot. AgentOS does not create a parallel session store here.</p>{sessions.length ? <div className="grid gap-2 lg:grid-cols-2">{sessions.map((session) => <div key={session.key} data-session-key={session.key} className={cn("rounded-xl border border-border bg-muted/20 p-3", focusKey === session.key && "ring-2 ring-primary/40")}><div className="flex items-start gap-3"><EntityIcon icon={session.source === "runtime" ? Code2 : FolderKanban} label="S" tone="info" size="sm" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{session.title}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{session.subtitle}</p><div className="mt-2 flex flex-wrap gap-2"><StatusBadge label={session.status} tone={session.status === "running" ? "info" : session.status === "completed" ? "success" : "muted"} /><span className="text-[10px] text-muted-foreground">{session.updatedLabel}</span><span className="text-[10px] text-muted-foreground">{session.tokenLabel} tokens</span></div></div></div><p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">{session.key}</p></div>)}</div> : <EmptyState title="No sessions reported" description="OpenClaw has not exposed session evidence for this worker yet." />}</div></SectionCard><SectionCard title="Recent activity"><div className="divide-y divide-border">{activity.length ? activity.map((entry) => <div key={entry.id} className="flex items-start gap-3 px-4 py-3"><CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><div className="min-w-0 flex-1"><p className="text-xs font-medium">{entry.title}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{entry.detail}</p></div><span className="text-[10px] text-muted-foreground">{entry.updatedLabel}</span></div>) : <div className="p-4"><EmptyState title="No recent activity" description="Only confirmed runtime and task evidence appears here." /></div>}</div></SectionCard></div>;
}

function ReadOnlyBlock({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-muted/20 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-foreground/85">{value}</p></div>;
}

function CapabilityCount({ label, value, tone }: { label: string; value: number; tone: StatusTone }) {
  return <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px]", tone === "success" ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" : tone === "warning" ? "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-200" : tone === "danger" ? "border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-200" : "border-primary/25 bg-primary/10 text-primary")}><span className="font-semibold">{value}</span> {label}</span>;
}
