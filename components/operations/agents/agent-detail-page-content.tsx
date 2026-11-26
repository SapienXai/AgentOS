"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  CircleDashed,
  Code2,
  FolderKanban,
  MessageCircle,
  Pencil,
  Play,
  RefreshCw,
  Sparkles,
  Wrench
} from "lucide-react";

import { AddModelsDialog } from "@/components/mission-control/add-models/add-models-dialog";
import { AgentCapabilityEditorDialog } from "@/components/mission-control/agent-capability-editor-dialog";
import { AgentModelPickerDialog } from "@/components/mission-control/agent-model-picker-dialog";
import { AgentChannelsSection } from "@/components/operations/agents/agent-channels-section";
import { EffectiveCapabilitiesPanel } from "@/components/operations/agents/effective-capabilities-panel";
import {
  AGENT_DETAIL_TABS, EMPLOYEE_SECTIONS, getEmployeeSection,
  parseAgentDetailQueryState,
  type AgentDetailTab, type AgentDetailQueryState
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
import { OperationsShell } from "@/components/operations/operations-shell";
import { ContextEngineDialog } from "@/components/mission-control/context-engine-dialog";
import { EmployeeDocuments } from "@/components/workforce/employee-documents";
import { EmployeeAvatar } from "@/components/workforce/employee-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  useWorkerEffectiveCapabilities,
  type WorkerEffectiveCapabilitiesState
} from "@/hooks/use-worker-effective-capabilities";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { formatAgentDisplayName, formatRelativeTime, resolveAgentModelLabel, resolveRelativeTimeReferenceMs } from "@/lib/openclaw/presenters";
import type { AddModelsProviderId, SkillLibraryItem, WorkerEffectiveCapabilitiesPayload } from "@/lib/openclaw/types";
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

export function EmployeeProfileRoute({ initialSnapshot, employeeId, workspaceId, query }: {
  initialSnapshot: MissionControlSnapshot;
  employeeId: string;
  workspaceId: string;
  query: AgentDetailQueryState;
}) {
  return (
    <OperationsShell initialSnapshot={initialSnapshot} preferredWorkspaceId={workspaceId}>
      {context => <AgentDetailPageContent agentId={employeeId} snapshot={context.snapshot} rootSnapshot={context.rootSnapshot}
        surfaceTheme={context.surfaceTheme} refresh={context.refresh} setSnapshot={context.setSnapshot}
        initialTab={query.tab} initialCapabilityFocus={query.capabilityFocus} initialSessionFocus={query.sessionFocus} />}
    </OperationsShell>
  );
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
  const [contextOpen, setContextOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [capabilityOpen, setCapabilityOpen] = useState(false);
  const [capabilityFocus, setCapabilityFocus] = useState<"skills" | "tools">("skills");
  const [addModelsOpen, setAddModelsOpen] = useState(false);
  const [modelProviderToConnect, setModelProviderToConnect] = useState<AddModelsProviderId | null>(null);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const capabilities = useWorkerEffectiveCapabilities({ agentId: agent?.id, enabled: tab === "capabilities" || tab === "overview" });
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
        main={<div className="space-y-3"><EmptyState title="Employee unavailable" description="This agent is no longer present in the current OpenClaw snapshot. Return to the roster and refresh to continue." /><Link href="/team" className="mx-auto flex w-fit rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground">Back to Team</Link></div>}
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
  const openAddModels = (provider?: AddModelsProviderId | null) => {
    setModelProviderToConnect(provider ?? null);
    setAddModelsOpen(true);
  };
  const handleAddModelsOpenChange = (open: boolean) => {
    setAddModelsOpen(open);
    if (!open) {
      setModelProviderToConnect(null);
    }
  };
  return (
    <>
      <OperationsPageLayout
        main={
          <div className="space-y-4">
            <Link href="/team" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Team
            </Link>

            <PageHeader
              title={displayName}
              icon={<EmployeeAvatar agent={agent} name={displayName} className="size-[4.5rem] rounded-[1.15rem] text-xl" />}
              subtitle={`${agent.workerProfile?.employment.role || "Digital employee"} · ${workspace.name}`}
              actions={
                <>
                  <Button variant="ghost" size="sm" className="h-9 rounded-lg px-3 text-xs" onClick={() => setProfileOpen(true)}>
                    <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button asChild size="sm" className="h-9 rounded-lg px-3 text-xs">
                    <Link href={`/chat?employee=${encodeURIComponent(agent.id)}`}><MessageCircle className="mr-1.5 size-3.5" /> Chat</Link>
                  </Button>
                  <Button variant="secondary" size="sm" className="h-9 rounded-lg px-3 text-xs" onClick={() => setDispatchOpen(true)}>
                    <Play className="mr-1.5 h-3.5 w-3.5" /> Assign task
                  </Button>
                </>
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge label={agentView.statusLabel} tone={statusTone} />
                {agent.lastActiveAt ? <span className="text-xs text-muted-foreground">Last active {formatRelativeTime(agent.lastActiveAt, resolveRelativeTimeReferenceMs(snapshot.generatedAt))}</span> : null}
              </div>
            </PageHeader>

            <nav aria-label="Employee profile sections" className="border-b border-border">
              <div className="flex flex-wrap gap-x-1">
                {EMPLOYEE_SECTIONS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-pressed={getEmployeeSection(tab) === item.id}
                    onClick={() => updateTab(item.id)}
                    className={cn("min-h-11 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors motion-reduce:transition-none", getEmployeeSection(tab) === item.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </nav>

            <div role="region" aria-label={`${AGENT_DETAIL_TABS.find((item) => item.id === tab)?.label ?? "Settings"} for ${displayName}`}>
              {tab === "overview" ? <OverviewTab agent={agent} currentWork={currentWork} activity={activity} capabilities={capabilities.data}
                onOpenCapabilities={() => updateTab("capabilities")} onOpenActivity={() => updateTab("sessions")} onEdit={() => setProfileOpen(true)} /> : null}
              {tab === "behavior" ? <><Button variant="ghost" onClick={() => updateTab("settings")}>Back to employee settings</Button><BehaviorTab agent={agent} onEdit={() => setProfileOpen(true)} /></> : null}
              {tab === "knowledge" ? (
                <div className="space-y-5">
                  <section className="workforce-panel space-y-3 p-4 sm:p-5">
                    <h2 className="workforce-section-title">Workspace documents</h2>
                    <p className="text-sm leading-6 text-muted-foreground">Assign a shared source to include it in {displayName}’s memory search. Workspace-level file access is managed separately.</p>
                    <EmployeeDocuments key={agent.id} workspaceId={workspace.id} employeeId={agent.id} />
                  </section>
                  <section className="border-t border-border/70 pt-5">
                    <h2 className="workforce-section-title">Employee context and memory</h2>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button variant="secondary" onClick={() => setContextOpen(true)}>Open employee context</Button>
                      <Button asChild variant="ghost"><Link href={`/knowledge?workspaceId=\${encodeURIComponent(workspace.id)}`}>Company knowledge</Link></Button>
                    </div>
                  </section>
                </div>
              ) : null}
              {tab === "settings" || tab === "intelligence" ? (
                <div className="workforce-detail-grid space-y-4">
                  <div className="workforce-detail-grid-inner">
                    <section className="workforce-panel space-y-3 p-5">
                      <h2 className="workforce-section-title">Identity and responsibilities</h2>
                      <p className="text-sm leading-6 text-muted-foreground">{agent.profile?.purpose || agent.workerProfile?.employment.role || "Set a clear responsibility for this employee."}</p>
                      <Button variant="secondary" onClick={() => setProfileOpen(true)}>Edit employee</Button>
                      <Button variant="ghost" onClick={() => updateTab("behavior")}>View working instructions</Button>
                    </section>
                    <section className="workforce-panel space-y-3 p-5">
                      <h2 className="workforce-section-title">AI model</h2>
                      <p className="break-words text-sm text-muted-foreground">{modelLabel}</p>
                      <Button variant="secondary" onClick={() => setModelOpen(true)}>Change model</Button>
                    </section>
                  </div>
                  <details className="workforce-panel p-5">
                    <summary className="cursor-pointer font-semibold">Connections and native settings</summary>
                    <p className="mt-2 text-sm text-muted-foreground">Review how this employee is reached outside AgentOS.</p>
                    <Button className="mt-3" variant="secondary" onClick={() => updateTab("channels")}>Manage connections</Button>
                  </details>
                </div>
              ) : null}
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
              {tab === "channels" ? <><Button variant="ghost" onClick={() => updateTab("settings")}>Back to employee settings</Button><ChannelsTab agent={agent} workspace={workspace} surfaceTheme={surfaceTheme} onRouteChanged={refresh} /></> : null}
              {tab === "sessions" ? <SessionsTab sessions={sessions} activity={activity} onRefresh={refresh} focusKey={sessionFocusKey} /> : null}
            </div>
          </div>
        }
        inspector={null}
      />

      {contextOpen ? <ContextEngineDialog agentId={agent.id} open onOpenChange={setContextOpen} surfaceTheme={surfaceTheme}
        onConfigureCapabilities={(_, focus) => { setContextOpen(false); openCapabilityEditor(focus); }} /> : null}

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
      <AgentModelPickerDialog open={modelOpen} agentId={agent.id} snapshot={rootSnapshot} onOpenChange={setModelOpen} onSnapshotChange={(updater) => setSnapshot((current) => updater(current))} onRefresh={refresh} onOpenAddModels={openAddModels} surfaceTheme={surfaceTheme} />
      <AddModelsDialog open={addModelsOpen} onOpenChange={handleAddModelsOpenChange} snapshot={rootSnapshot} initialProvider={modelProviderToConnect} onSnapshotChange={setSnapshot} surfaceTheme={surfaceTheme} />
      <AgentCapabilityEditorDialog workforce open={capabilityOpen} agentId={agent.id} initialFocus={capabilityFocus} snapshot={rootSnapshot} onOpenChange={setCapabilityOpen} onSnapshotChange={(updater) => setSnapshot((current) => updater(current))} onRefresh={refresh} surfaceTheme={surfaceTheme} />
      <MissionDispatchDialog open={dispatchOpen} agent={agentView} onOpenChange={setDispatchOpen} onSubmitted={refresh} />
    </>
  );
}

function OverviewTab({ agent, currentWork, activity, capabilities, onOpenCapabilities, onOpenActivity, onEdit }: {
  agent: MissionControlSnapshot["agents"][number];
  currentWork: ReturnType<typeof resolveAgentCurrentWork>;
  activity: ReturnType<typeof buildAgentDetailActivity>;
  capabilities: WorkerEffectiveCapabilitiesPayload | null;
  onOpenCapabilities: () => void;
  onOpenActivity: () => void;
  onEdit: () => void;
}) {
  const purpose = agent.workerProfile?.employment.mission || agent.profile.purpose;
  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(16rem,.8fr)]">
      <div className="space-y-5">
        <section className="workforce-panel p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="workforce-section-title">Responsibilities</h2>
            <Button size="sm" variant="ghost" onClick={onEdit}>Edit responsibilities</Button>
          </div>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{purpose || "Give this employee a clear job to do."}</p>
          {agent.workerProfile?.employment.behaviorInstructions && <details className="mt-4 border-t border-border pt-3">
            <summary className="cursor-pointer text-sm font-medium">Working instructions</summary>
            <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{agent.workerProfile.employment.behaviorInstructions}</p>
          </details>}
        </section>
        <section className="border-t border-border/75 pt-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="workforce-section-title">Recent activity</h2>
            <Button variant="ghost" size="sm" onClick={onOpenActivity}>See activity</Button>
          </div>
          <ActivityRows activity={activity.slice(0, 4)} />
        </section>
      </div>
      <aside aria-label="At a glance" className="space-y-4">
        <section className="workforce-panel p-4 sm:p-5">
          <h2 className="workforce-section-title">Current work</h2>
          <p className="mt-2 break-words text-sm font-medium">{currentWork.label}</p>
          {currentWork.detail && <p className="mt-1 break-words text-sm leading-5 text-muted-foreground">{currentWork.detail}</p>}
        </section>
        <section className="border-t border-border/75 px-1 pt-4">
          <h2 className="workforce-section-title">What they can use</h2>
          {capabilities ? (
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              <li>{capabilities.summary.available} ready to use</li>
              {capabilities.summary["needs-setup"] > 0 && <li>{capabilities.summary["needs-setup"]} need setup</li>}
              {capabilities.summary["requires-approval"] > 0 && <li>{capabilities.summary["requires-approval"]} require approval</li>}
            </ul>
          ) : <p className="mt-2 text-sm text-muted-foreground">Availability has not been confirmed.</p>}
          <Button variant="secondary" size="sm" className="mt-4" onClick={onOpenCapabilities}>Manage abilities</Button>
        </section>
      </aside>
    </div>
  );
}

function ActivityRows({ activity }: { activity: ReturnType<typeof buildAgentDetailActivity> }) {
  return activity.length ? <ul className="mt-2 divide-y divide-border/70">
    {activity.map(entry => <li key={entry.id} className="flex items-start gap-3 py-3">
      <CircleDashed aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{entry.title}</p>
        <p className="mt-1 break-words text-xs leading-5 text-muted-foreground">{entry.detail}</p></div>
      <span className="shrink-0 text-xs text-muted-foreground">{entry.updatedLabel}</span>
    </li>)}
  </ul> : <p className="py-3 text-sm text-muted-foreground">No recent activity reported.</p>;
}

function BehaviorTab({ agent, onEdit }: { agent: MissionControlSnapshot["agents"][number]; onEdit: () => void }) {
  const behavior = agent.workerProfile?.employment.behaviorInstructions || agent.profile.operatingInstructions.join("\n\n");
  const mission = agent.workerProfile?.employment.mission || agent.profile.purpose || "No mission statement is configured.";
  const labels = agent.workerProfile?.operator.labels ?? [];
  return <div className="space-y-4"><SectionCard title="Working instructions" action={<Button size="sm" variant="secondary" className="h-8 rounded-lg px-3 text-xs" onClick={onEdit}><Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit behavior</Button>}><div className="grid gap-4 p-4 lg:grid-cols-2"><ReadOnlyBlock label="Mission" value={mission} /><ReadOnlyBlock label="Working guidance" value={behavior || "No behavior instructions are configured."} /><div className="lg:col-span-2"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Operator labels</p><div className="mt-2 flex flex-wrap gap-2">{labels.length ? labels.map((label) => <Badge key={label} variant="muted" className="rounded-full px-2 py-1 text-[10px] normal-case tracking-normal">{label}</Badge>) : <span className="text-xs text-muted-foreground">No labels configured.</span>}</div></div></div></SectionCard><SectionCard title="Edit semantics"><div className="flex items-start gap-3 p-4"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" /><p className="text-xs leading-5 text-muted-foreground">Behavior edits open the existing Worker Profile editor. Draft changes stay local until Save Worker Profile commits them through the protected AgentOS/OpenClaw update path.</p></div></SectionCard></div>;
}

function CapabilitiesTab({ agent, capabilities, onRefreshCapabilities, onActivate, onOpenEditor, onEditProfile, focusId }: { agent: MissionControlSnapshot["agents"][number]; capabilities: WorkerEffectiveCapabilitiesState; onRefreshCapabilities: () => void; onActivate: (skill: SkillLibraryItem) => Promise<boolean>; onOpenEditor: (focus: "skills" | "tools") => void; onEditProfile: () => void; focusId: string | null }) {
  const configured = [...agent.skills, ...agent.tools];
  return <div className="space-y-4">
    <SectionCard title="Employee abilities" action={<Button variant="ghost" size="sm" className="min-h-11 sm:min-h-9"
      disabled={capabilities.loading} onClick={onRefreshCapabilities}>
      <RefreshCw aria-hidden="true" className={cn("mr-1.5 size-3.5", capabilities.loading && "animate-spin motion-reduce:animate-none")} />Refresh
    </Button>}>
      <div className="flex flex-wrap items-center justify-between gap-3 p-4">
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">Review tools, skills, and connections for this employee. OpenClaw checks access for each conversation.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" className="min-h-11" onClick={() => onOpenEditor("skills")}><Sparkles aria-hidden="true" className="mr-1.5 size-4" />Manage skills</Button>
          <Button className="min-h-11" onClick={() => onOpenEditor("tools")}><Wrench aria-hidden="true" className="mr-1.5 size-4" />Manage tools</Button>
        </div>
      </div>
    </SectionCard>
    <EffectiveCapabilitiesPanel state={capabilities} onActivate={onActivate} focusId={focusId} />
    <details className="workforce-panel px-4 sm:px-5">
      <summary className="cursor-pointer py-4 text-sm font-medium">Advanced policy and configuration</summary>
      <div className="space-y-4 pb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <KeyValue label="Policy" value={agent.policy.preset} />
          <KeyValue label="File access" value={agent.policy.fileAccess} />
          <KeyValue label="Network" value={agent.policy.networkAccess} />
          <KeyValue label="Sandbox" value={agent.sandbox?.mode || "Inherited"} />
          <KeyValue label="Sandbox scope" value={agent.sandbox?.scope || "Inherited"} />
          <KeyValue label="Workspace access" value={agent.sandbox?.workspaceAccess || "Inherited"} />
        </div>
        {configured.length ? <p className="break-words text-xs text-muted-foreground">Configured identifiers <code>{configured.join(", ")}</code></p> : null}
        <Button type="button" variant="secondary" onClick={onEditProfile}>Edit employee policy</Button>
      </div>
    </details>
  </div>;
}

function ChannelsTab({ agent, workspace, surfaceTheme, onRouteChanged }: { agent: MissionControlSnapshot["agents"][number]; workspace: MissionControlSnapshot["workspaces"][number]; surfaceTheme: "dark" | "light"; onRouteChanged: () => Promise<void> }) {
  return <SectionCard title="Channel bindings" action={<Button asChild size="sm" variant="secondary" className="h-8 rounded-lg px-2.5 text-xs"><Link href={`/channels/simulator?expectedAgentId=${encodeURIComponent(agent.id)}`}>Test delivery</Link></Button>}><div className="p-4"><p className="mb-4 max-w-2xl text-xs leading-5 text-muted-foreground">These routes are read and changed through OpenClaw&apos;s canonical Channel Center binding service. Telegram groups and topics keep their inherited and explicit route states.</p><AgentChannelsSection agentId={agent.id} workspaceId={workspace.id} workspacePath={workspace.path} surfaceTheme={surfaceTheme} onRouteChanged={onRouteChanged} /></div></SectionCard>;
}

function SessionsTab({ sessions, activity, onRefresh, focusKey }: { sessions: ReturnType<typeof buildAgentDetailSessions>; activity: ReturnType<typeof buildAgentDetailActivity>; onRefresh: () => Promise<void>; focusKey: string | null }) {
  return <div className="space-y-4"><section className="workforce-panel p-4 sm:p-5"><h2 className="workforce-section-title">Recent activity</h2><ActivityRows activity={activity} /></section>
    <details open={Boolean(focusKey)} className="workforce-panel p-4"><summary className="cursor-pointer text-sm font-medium">Native session details</summary>
    <SectionCard title="Session history" action={<Button size="sm" variant="ghost" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => void onRefresh()}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh</Button>}><div className="p-4"><p className="mb-3 text-xs leading-5 text-muted-foreground">OpenClaw session history.</p>{sessions.length ? <div className="grid gap-2 lg:grid-cols-2">{sessions.map((session) => <div key={session.key} data-session-key={session.key} className={cn("rounded-xl border border-border bg-muted/20 p-3", focusKey === session.key && "ring-2 ring-primary/40")}><div className="flex items-start gap-3"><EntityIcon icon={session.source === "runtime" ? Code2 : FolderKanban} label="S" tone="info" size="sm" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{session.title}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{session.subtitle}</p><div className="mt-2 flex flex-wrap gap-2"><StatusBadge label={session.status} tone={session.status === "running" ? "info" : session.status === "completed" ? "success" : "muted"} /><span className="text-[10px] text-muted-foreground">{session.updatedLabel}</span><span className="text-[10px] text-muted-foreground">{session.tokenLabel} tokens</span></div></div></div><p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">{session.key}</p></div>)}</div> : <EmptyState title="No sessions reported" description="OpenClaw has not exposed session evidence for this worker yet." />}</div></SectionCard></details></div>;
}

function ReadOnlyBlock({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border bg-muted/20 p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-foreground/85">{value}</p></div>;
}
