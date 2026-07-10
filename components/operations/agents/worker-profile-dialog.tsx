"use client";

import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { BrainCircuit, Database, FolderLock, KeyRound, LoaderCircle, ShieldCheck, Wrench, type LucideIcon } from "lucide-react";

import { ChannelBindingPicker } from "@/components/mission-control/channel-binding-picker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { getWorkspaceChannelIdsForAgent, syncWorkspaceAgentChannelBindings } from "@/lib/openclaw/channel-bindings";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type { AgentPolicy, MissionControlSnapshot } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";
type ToolProfile = "minimal" | "coding" | "messaging" | "full" | "";
type SandboxMode = "" | "off" | "non-main" | "all";
type SandboxScope = "" | "session" | "agent" | "shared";
type WorkspaceAccess = "" | "none" | "ro" | "rw";

const profileSelectClassName = "h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15";

type WorkerProfileDialogProps = {
  open: boolean;
  agentId: string | null;
  snapshot: MissionControlSnapshot;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<void>;
  onSnapshotChange?: Dispatch<SetStateAction<MissionControlSnapshot>>;
  onChangeModel: (agentId: string) => void;
  onManageCapabilities: (agentId: string, focus: "skills" | "tools") => void;
  surfaceTheme?: SurfaceTheme;
};

type WorkerProfileDraft = {
  name: string;
  emoji: string;
  theme: string;
  avatar: string;
  role: string;
  mission: string;
  behaviorInstructions: string;
  labels: string;
  policy: AgentPolicy;
  heartbeatEnabled: boolean;
  heartbeatEvery: string;
  toolProfile: ToolProfile;
  toolAllow: string;
  toolDeny: string;
  sandboxMode: SandboxMode;
  sandboxScope: SandboxScope;
  workspaceAccess: WorkspaceAccess;
  memoryEnabled: boolean;
  memorySources: Array<"memory" | "sessions">;
  channelIds: string[];
};

export function WorkerProfileDialog({
  open,
  agentId,
  snapshot,
  onOpenChange,
  onRefresh,
  onSnapshotChange,
  onChangeModel,
  onManageCapabilities,
  surfaceTheme = "dark"
}: WorkerProfileDialogProps) {
  const agent = agentId ? snapshot.agents.find((entry) => entry.id === agentId) ?? null : null;
  const workspace = snapshot.workspaces.find((entry) => entry.id === agent?.workspaceId) ?? null;
  const [draft, setDraft] = useState<WorkerProfileDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const isLight = surfaceTheme === "light";

  useEffect(() => {
    if (!open || !agent) {
      return;
    }

    setDraft(buildDraft(agent, snapshot));
  }, [agent, open, snapshot]);

  const accountSummary = useMemo(() => {
    if (!agent) {
      return "No worker selected.";
    }

    const browserCapable = [...agent.tools, ...(agent.observedTools ?? [])].some((tool) => tool === "browser");
    return browserCapable
      ? "Browser-capable. Account and browser-profile use remains governed by AgentOS account-access rules per supported task."
      : "No browser capability is declared. Account and browser-profile assignment is unavailable for this worker."
  }, [agent]);

  if (!agent || !workspace || !draft) {
    return null;
  }

  const save = async () => {
    setSaving(true);

    try {
      const response = await fetch("/api/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: agent.id,
          name: draft.name,
          emoji: draft.emoji,
          theme: draft.theme,
          avatar: draft.avatar,
          policy: draft.policy,
          heartbeat: {
            enabled: draft.heartbeatEnabled,
            ...(draft.heartbeatEnabled && draft.heartbeatEvery ? { every: draft.heartbeatEvery } : {})
          },
          workerProfile: {
            schemaVersion: 1,
            identity: {
              displayName: draft.name,
              emoji: draft.emoji || null,
              theme: draft.theme || null,
              avatar: draft.avatar || null
            },
            employment: {
              role: draft.role || null,
              mission: draft.mission || null,
              behaviorInstructions: draft.behaviorInstructions || null
            },
            operator: {
              labels: splitList(draft.labels)
            }
          },
          toolPolicy: {
            profile: draft.toolProfile || null,
            allow: draft.toolAllow.trim() ? splitList(draft.toolAllow) : null,
            deny: draft.toolDeny.trim() ? splitList(draft.toolDeny) : null,
            fs: {
              workspaceOnly: draft.policy.fileAccess === "workspace-only"
            }
          },
          sandbox:
            !draft.sandboxMode && !draft.sandboxScope && !draft.workspaceAccess
              ? null
              : {
                  mode: draft.sandboxMode || null,
                  scope: draft.sandboxScope || null,
                  workspaceAccess: draft.workspaceAccess || null
                },
          memorySearch: {
            enabled: draft.memoryEnabled,
            sources: draft.memorySources
          }
        })
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok || payload.error) {
        throw new Error(payload.error || "Unable to save the Worker Profile.");
      }

      const currentChannelIds = getWorkspaceChannelIdsForAgent(snapshot, workspace.id, agent.id);
      if (!areSameValues(currentChannelIds, draft.channelIds)) {
        await syncWorkspaceAgentChannelBindings({
          workspaceId: workspace.id,
          workspacePath: workspace.path,
          agentId: agent.id,
          currentChannelIds,
          nextChannelIds: draft.channelIds,
          onRegistryChange: onSnapshotChange
        });
      }

      toast.success("Worker Profile saved.");
      await onRefresh();
      onOpenChange(false);
    } catch (error) {
      toast.error("Worker Profile could not be saved.", {
        description: error instanceof Error ? error.message : "Unknown profile error."
      });
    } finally {
      setSaving(false);
    }
  };

  const updatePolicy = <K extends keyof AgentPolicy>(key: K, value: AgentPolicy[K]) => {
    setDraft((current) => current ? { ...current, policy: { ...current.policy, [key]: value } } : current);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("flex max-h-[calc(100dvh-1.5rem)] w-[min(1180px,calc(100vw-1.5rem))] max-w-none flex-col overflow-hidden rounded-[28px] border-border/80 p-0", isLight && "agentos-light-modal")}>
        <DialogHeader className="border-b border-border/80 px-5 py-5 pr-14 sm:px-7">
          <div className="flex items-start gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-lg shadow-sm">{draft.emoji || "🤖"}</span>
            <div className="min-w-0">
              <DialogTitle className="truncate text-lg">Worker Profile · {formatAgentDisplayName(agent)}</DialogTitle>
              <DialogDescription className="mt-1 max-w-3xl leading-5">
                One clear place for this worker&apos;s identity, operating guidance, runtime access, and connected channels.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto grid max-w-[1180px] gap-7 px-5 py-6 sm:px-7 lg:grid-cols-[238px_minmax(0,1fr)] lg:gap-10 lg:px-8">
            <aside className="lg:sticky lg:top-0 lg:self-start">
              <ProfileSummary agent={agent} workspace={workspace} draft={draft} />
            </aside>

            <div className="min-w-0 space-y-8 pb-2">
              <ProfileSection icon={KeyRound} title="Identity & role" description="How operators recognize this worker and the outcome it owns.">
                <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Display name"><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
                <Field label="Role"><Input value={draft.role} placeholder="e.g. Research analyst" onChange={(event) => setDraft({ ...draft, role: event.target.value })} /></Field>
                <Field label="Emoji"><Input value={draft.emoji} onChange={(event) => setDraft({ ...draft, emoji: event.target.value })} /></Field>
                <Field label="Theme"><Input value={draft.theme} placeholder="slate" onChange={(event) => setDraft({ ...draft, theme: event.target.value })} /></Field>
                  <Field className="sm:col-span-2" label="Mission"><Textarea className="min-h-24 resize-y" value={draft.mission} placeholder="What outcome does this worker own?" onChange={(event) => setDraft({ ...draft, mission: event.target.value })} /></Field>
                  <Field className="sm:col-span-2" label="Behavior instructions"><Textarea className="min-h-28 resize-y" value={draft.behaviorInstructions} placeholder="Concise, reviewable working guidance for this worker." onChange={(event) => setDraft({ ...draft, behaviorInstructions: event.target.value })} /></Field>
                  <Field className="sm:col-span-2" label="Operator labels"><Input value={draft.labels} placeholder="research, customer-facing" onChange={(event) => setDraft({ ...draft, labels: event.target.value })} /></Field>
                </div>
              </ProfileSection>

              <ProfileSection icon={BrainCircuit} title="Work setup" description="OpenClaw workspace, model, memory, and heartbeat settings.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <ReadOnlyField label="Workspace" value={workspace.name} detail={workspace.path} />
                  <ReadOnlyField label="Model & auth" value={agent.modelId === "unassigned" ? "OpenClaw default" : agent.modelId} detail="Credentials remain in OpenClaw and are never shown or copied here." action={<Button size="sm" variant="secondary" onClick={() => onChangeModel(agent.id)}>Change model</Button>} />
                <Field label="Heartbeat"><select value={draft.heartbeatEnabled ? "on" : "off"} className={profileSelectClassName} onChange={(event) => setDraft({ ...draft, heartbeatEnabled: event.target.value === "on" })}><option value="off">Off</option><option value="on">On</option></select></Field>
                <Field label="Interval"><Input disabled={!draft.heartbeatEnabled} value={draft.heartbeatEvery} placeholder="30m" onChange={(event) => setDraft({ ...draft, heartbeatEvery: event.target.value })} /></Field>
                  <div className="sm:col-span-2 rounded-2xl border border-border bg-muted/25 p-4">
                    <div className="flex items-start justify-between gap-4"><div className="flex gap-3"><span className="mt-0.5 text-primary"><Database className="h-4 w-4" /></span><div><p className="text-sm font-medium">Memory search</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Allow this worker to search workspace memory and its bounded session recall.</p></div></div><input aria-label="Enable memory search" className="mt-1 h-4 w-4 accent-primary" type="checkbox" checked={draft.memoryEnabled} onChange={(event) => setDraft({ ...draft, memoryEnabled: event.target.checked })} /></div>
                    <div className="mt-4 flex flex-wrap gap-2"><ToggleChip label="Workspace memory" active={draft.memorySources.includes("memory")} onClick={() => setDraft({ ...draft, memorySources: toggleValue(draft.memorySources, "memory") })} /><ToggleChip label="Session recall" active={draft.memorySources.includes("sessions")} onClick={() => setDraft({ ...draft, memorySources: toggleValue(draft.memorySources, "sessions") })} /></div>
                  </div>
                </div>
              </ProfileSection>

              <ProfileSection icon={Wrench} title="Capabilities" description="What this worker may use, within global OpenClaw policy and installed plugins.">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Tool profile"><select value={draft.toolProfile} className={profileSelectClassName} onChange={(event) => setDraft({ ...draft, toolProfile: event.target.value as ToolProfile })}><option value="">Inherit OpenClaw default</option><option value="minimal">Minimal</option><option value="coding">Coding</option><option value="messaging">Messaging</option><option value="full">Full</option></select></Field>
                  <Field label="File boundary"><select value={draft.policy.fileAccess} className={profileSelectClassName} onChange={(event) => updatePolicy("fileAccess", event.target.value as AgentPolicy["fileAccess"])}><option value="workspace-only">Workspace only</option><option value="extended">Extended</option></select></Field>
                  <Field label="Additional allowed tools"><Input value={draft.toolAllow} placeholder="browser, web_search" onChange={(event) => setDraft({ ...draft, toolAllow: event.target.value })} /></Field>
                  <Field label="Denied tools"><Input value={draft.toolDeny} placeholder="exec, process" onChange={(event) => setDraft({ ...draft, toolDeny: event.target.value })} /></Field>
                </div>
                <div className="flex flex-wrap gap-2 pt-1"><Button variant="secondary" size="sm" onClick={() => onManageCapabilities(agent.id, "skills")}>Manage skills ({agent.skills.length})</Button><Button variant="secondary" size="sm" onClick={() => onManageCapabilities(agent.id, "tools")}>Manage declared tools</Button></div>
              </ProfileSection>

              <ProfileSection icon={ShieldCheck} title="Access & safety" description="Supported sandbox controls and connected channels. Browser sessions and credentials remain separate.">
                <div className="grid gap-4 sm:grid-cols-3"><Field label="Sandbox mode"><select value={draft.sandboxMode} className={profileSelectClassName} onChange={(event) => setDraft({ ...draft, sandboxMode: event.target.value as SandboxMode })}><option value="">Inherit</option><option value="off">Off</option><option value="non-main">Non-main</option><option value="all">All sessions</option></select></Field><Field label="Scope"><select value={draft.sandboxScope} className={profileSelectClassName} onChange={(event) => setDraft({ ...draft, sandboxScope: event.target.value as SandboxScope })}><option value="">Inherit</option><option value="session">Session</option><option value="agent">Agent</option><option value="shared">Shared</option></select></Field><Field label="Workspace in sandbox"><select value={draft.workspaceAccess} className={profileSelectClassName} onChange={(event) => setDraft({ ...draft, workspaceAccess: event.target.value as WorkspaceAccess })}><option value="">Inherit</option><option value="none">No access</option><option value="ro">Read only</option><option value="rw">Read/write</option></select></Field></div>
                <div className="rounded-2xl border border-amber-300/25 bg-amber-400/5 px-4 py-3 text-xs leading-5 text-muted-foreground"><FolderLock className="mr-1.5 inline h-4 w-4 text-amber-500" />Sandbox changes can alter the worker&apos;s visible workspace and may recreate its runtime on the next turn.</div>
                <div className="rounded-2xl border border-border bg-muted/25 p-4"><p className="text-sm font-medium">Accounts & browser profiles</p><p className="mt-1.5 text-xs leading-5 text-muted-foreground">{accountSummary}</p></div>
                <ChannelBindingPicker snapshot={snapshot} workspaceId={workspace.id} agentId={agent.id} channelIds={draft.channelIds} isSaving={saving} surfaceTheme={surfaceTheme} onChange={(channelIds) => setDraft({ ...draft, channelIds })} />
              </ProfileSection>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-border/80 bg-muted/20 px-5 py-4 sm:flex-row sm:px-7">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving || !draft.name.trim()}>{saving ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}Save Worker Profile</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function buildDraft(agent: MissionControlSnapshot["agents"][number], snapshot: MissionControlSnapshot): WorkerProfileDraft {
  const profile = agent.workerProfile;
  const channels = getWorkspaceChannelIdsForAgent(snapshot, agent.workspaceId, agent.id);
  return {
    name: profile?.identity.displayName ?? agent.name,
    emoji: profile?.identity.emoji ?? agent.identity.emoji ?? "",
    theme: profile?.identity.theme ?? agent.identity.theme ?? "",
    avatar: profile?.identity.avatar ?? agent.identity.avatar ?? "",
    role: profile?.employment.role ?? agent.policy.preset,
    mission: profile?.employment.mission ?? agent.profile.purpose ?? "",
    behaviorInstructions: profile?.employment.behaviorInstructions ?? "",
    labels: profile?.operator.labels.join(", ") ?? "",
    policy: agent.policy,
    heartbeatEnabled: agent.heartbeat.enabled,
    heartbeatEvery: agent.heartbeat.every ?? "",
    toolProfile: agent.toolPolicy?.profile ?? "",
    toolAllow: agent.toolPolicy?.allow?.join(", ") ?? "",
    toolDeny: agent.toolPolicy?.deny?.join(", ") ?? "",
    sandboxMode: agent.sandbox?.mode ?? "",
    sandboxScope: agent.sandbox?.scope ?? "",
    workspaceAccess: agent.sandbox?.workspaceAccess ?? "",
    memoryEnabled: agent.memorySearch?.enabled ?? false,
    memorySources: agent.memorySearch?.sources ?? ["memory"],
    channelIds: channels
  };
}

function ProfileSummary({
  agent,
  workspace,
  draft
}: {
  agent: MissionControlSnapshot["agents"][number];
  workspace: MissionControlSnapshot["workspaces"][number];
  draft: WorkerProfileDraft;
}) {
  const identity = draft.emoji || "🤖";
  const role = draft.role.trim() || "Worker profile";
  const model = agent.modelId === "unassigned" ? "OpenClaw default" : agent.modelId;

  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
      <div className="border-b border-border bg-muted/30 p-5">
        <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-2xl shadow-sm">{identity}</span>
        <p className="mt-4 truncate text-base font-semibold">{draft.name || formatAgentDisplayName(agent)}</p>
        <p className="mt-1 truncate text-sm text-primary">{role}</p>
      </div>
      <div className="space-y-4 p-5">
        <SummaryItem label="Workspace" value={workspace.name} />
        <SummaryItem label="Model" value={model} />
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-4">
          <SummaryItem label="Skills" value={String(agent.skills.length)} />
          <SummaryItem label="Tools" value={String(agent.tools.length)} />
        </div>
        <div className="rounded-2xl bg-primary/5 px-3 py-3 text-xs leading-5 text-muted-foreground">
          Settings save to the real worker profile and supported OpenClaw runtime configuration.
        </div>
      </div>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className="mt-1 truncate text-xs font-medium">{value}</p></div>;
}

function ProfileSection({ icon: Icon, title, description, children }: { icon: LucideIcon; title: string; description: string; children: ReactNode }) {
  return <section className="space-y-5 border-b border-border/80 pb-8 last:border-b-0 last:pb-0"><div className="flex max-w-2xl gap-3"><span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-4 w-4" /></span><div><h3 className="text-base font-semibold tracking-[-0.01em]">{title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p></div></div>{children}</section>;
}

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) { return <div className={cn("space-y-2", className)}><Label className="text-xs font-medium text-foreground/85">{label}</Label>{children}</div>; }

function ReadOnlyField({ label, value, detail, action }: { label: string; value: string; detail: string; action?: ReactNode }) { return <div className="rounded-2xl border border-border bg-muted/25 px-4 py-3.5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium text-foreground/85">{label}</p><p className="mt-1.5 truncate text-sm font-medium">{value}</p><p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{detail}</p></div>{action}</div></div>; }

function ToggleChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) { return <button type="button" onClick={onClick} className={cn("rounded-full border px-3 py-1.5 text-xs transition-colors", active ? "border-primary/35 bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground hover:bg-muted")}>{label}</button>; }

function splitList(value: string) { return Array.from(new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))); }
function toggleValue(values: Array<"memory" | "sessions">, value: "memory" | "sessions") { return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]; }
function areSameValues(left: string[], right: string[]) { return left.length === right.length && left.every((value) => right.includes(value)); }
