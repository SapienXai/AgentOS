"use client";

import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  Bot,
  BrainCircuit,
  Check,
  Database,
  FolderLock,
  KeyRound,
  Layers3,
  LoaderCircle,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Wrench,
  type LucideIcon
} from "lucide-react";

import { ChannelBindingPicker } from "@/components/mission-control/channel-binding-picker";
import { Button } from "@/components/ui/button";
import {
  MissionControlDialogChip,
  MissionControlDialogShell,
  missionControlDialogButtonClassName
} from "@/components/mission-control/mission-control-dialog-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { getWorkspaceChannelIdsForAgent, syncWorkspaceAgentChannelBindings } from "@/lib/openclaw/channel-bindings";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type { AgentPolicy, MissionControlSnapshot } from "@/lib/agentos/contracts";
import type {
  EffectiveCapabilityStatus,
  SkillLibraryItem,
  WorkerEffectiveCapabilitiesPayload
} from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";
type ToolProfile = "minimal" | "coding" | "messaging" | "full" | "";
type SandboxMode = "" | "off" | "non-main" | "all";
type SandboxScope = "" | "session" | "agent" | "shared";
type WorkspaceAccess = "" | "none" | "ro" | "rw";

const profileSelectClassName = "h-9 w-full rounded-lg border border-input bg-background px-3 text-xs text-foreground shadow-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/15";

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
  const [effectiveCapabilities, setEffectiveCapabilities] = useState<{
    loading: boolean;
    data: WorkerEffectiveCapabilitiesPayload | null;
    error: string | null;
  }>({ loading: false, data: null, error: null });

  useEffect(() => {
    if (!open || !agent) {
      return;
    }

    setDraft(buildDraft(agent, snapshot));
  }, [agent, open, snapshot]);

  useEffect(() => {
    if (!open || !agentId) {
      return;
    }

    const controller = new AbortController();
    setEffectiveCapabilities({ loading: true, data: null, error: null });
    void fetch(`/api/agents/${encodeURIComponent(agentId)}/capabilities`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        const payload = await response.json() as WorkerEffectiveCapabilitiesPayload & { error?: string };
        if (!response.ok || payload.error) {
          throw new Error(payload.error || "Unable to read effective capabilities.");
        }
        setEffectiveCapabilities({ loading: false, data: payload, error: null });
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setEffectiveCapabilities({
          loading: false,
          data: null,
          error: error instanceof Error ? error.message : "Unable to read effective capabilities."
        });
      });

    return () => controller.abort();
  }, [agentId, open]);

  const accountSummary = useMemo(() => {
    if (!agent) {
      return "No worker selected.";
    }

    const browserCapable = [...agent.tools, ...(agent.observedTools ?? [])].some((tool) => tool === "browser");
    return browserCapable
      ? "Browser is declared or observed. Effective browser use still depends on OpenClaw session tools and account policy."
      : "No browser tool is declared or observed. Effective browser use is not established for this worker."
  }, [agent]);

  const baselineDraft = useMemo(() => agent ? buildDraft(agent, snapshot) : null, [agent, snapshot]);
  const hasChanges = Boolean(draft && baselineDraft && !areSameDraft(draft, baselineDraft));

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
    <MissionControlDialogShell
      open={open}
      onOpenChange={onOpenChange}
      surfaceTheme={surfaceTheme}
      variant="worker-profile"
      title={formatAgentDisplayName(agent)}
      description="Design this worker's identity, operating context, capabilities, and safety boundaries without raw configuration."
      icon={Bot}
      chips={<><MissionControlDialogChip tone="violet" surfaceTheme={surfaceTheme}><Sparkles className="mr-1 h-3 w-3" />Worker profile</MissionControlDialogChip><MissionControlDialogChip tone={hasChanges ? "amber" : "emerald"} surfaceTheme={surfaceTheme}><Check className="mr-1 h-3 w-3" />{hasChanges ? "Unsaved changes" : "Profile in sync"}</MissionControlDialogChip></>}
      bodyClassName="px-0 py-0"
      footer={
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
          <div className="mr-auto hidden items-center gap-2 text-xs text-slate-400 sm:flex"><span className={cn("h-2 w-2 rounded-full", hasChanges ? "bg-amber-400" : "bg-emerald-400")} />{hasChanges ? "Review and save your profile changes" : "No pending profile changes"}</div>
          {hasChanges ? <Button variant="secondary" size="sm" onClick={() => setDraft(buildDraft(agent, snapshot))} disabled={saving} className={missionControlDialogButtonClassName("secondary", surfaceTheme)}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Reset changes</Button> : null}
          <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)} disabled={saving} className={missionControlDialogButtonClassName("secondary", surfaceTheme)}>Cancel</Button>
          <Button size="sm" onClick={() => void save()} disabled={saving || !draft.name.trim() || !hasChanges} className={missionControlDialogButtonClassName("primary", surfaceTheme)}>{saving ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}{saving ? "Saving profile" : "Save Worker Profile"}</Button>
        </div>
      }
    >
          <div className="mx-auto grid max-w-[1120px] gap-5 px-4 py-4 sm:px-6 lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-6 lg:px-7 lg:py-5">
            <aside className="lg:sticky lg:top-0 lg:self-start">
              <ProfileSummary agent={agent} workspace={workspace} draft={draft} hasChanges={hasChanges} />
              <ProfileNavigation />
            </aside>

            <div className="min-w-0 space-y-4 pb-1">
              <ProfileSection id="worker-profile-identity" eyebrow="01 · Employment record" icon={KeyRound} title="Identity & role" description="Give this worker a clear professional identity and a specific outcome to own.">
                <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Display name"><Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
                <Field label="Role"><Input value={draft.role} placeholder="e.g. Research analyst" onChange={(event) => setDraft({ ...draft, role: event.target.value })} /></Field>
                <Field label="Emoji"><Input value={draft.emoji} onChange={(event) => setDraft({ ...draft, emoji: event.target.value })} /></Field>
                <Field label="Theme"><Input value={draft.theme} placeholder="slate" onChange={(event) => setDraft({ ...draft, theme: event.target.value })} /></Field>
                  <Field className="sm:col-span-2" label="Mission"><Textarea className="min-h-20 resize-y" value={draft.mission} placeholder="What outcome does this worker own?" onChange={(event) => setDraft({ ...draft, mission: event.target.value })} /></Field>
                  <Field className="sm:col-span-2" label="Behavior instructions"><Textarea className="min-h-20 resize-y" value={draft.behaviorInstructions} placeholder="Concise, reviewable working guidance for this worker." onChange={(event) => setDraft({ ...draft, behaviorInstructions: event.target.value })} /></Field>
                  <Field className="sm:col-span-2" label="Operator labels"><Input value={draft.labels} placeholder="research, customer-facing" onChange={(event) => setDraft({ ...draft, labels: event.target.value })} /></Field>
                </div>
              </ProfileSection>

              <ProfileSection id="worker-profile-work" eyebrow="02 · Operating context" icon={BrainCircuit} title="Work setup" description="The workspace, model, recall, and cadence that shape how this worker operates.">
                <div className="grid gap-3 sm:grid-cols-2">
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

              <ProfileSection id="worker-profile-capabilities" eyebrow="03 · Capability envelope" icon={Wrench} title="Capabilities" description="Grant the smallest useful tool surface; global OpenClaw policy still applies.">
                <EffectiveCapabilitiesPanel state={effectiveCapabilities} onActivate={async (skill) => {
                  const sessionKey = effectiveCapabilities.data?.session.key;
                  if (!sessionKey) {
                    toast.message("Skill activation is unavailable.", { description: "OpenClaw has not exposed a usable session context for this worker." });
                    return;
                  }
                  try {
                    const response = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/capabilities`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        sessionKey,
                        action: "attach",
                        skillId: skill.id,
                        revision: skill.revision.id
                      })
                    });
                    const payload = await response.json() as { capabilities?: WorkerEffectiveCapabilitiesPayload; error?: string };
                    if (!response.ok || payload.error || !payload.capabilities) {
                      throw new Error(payload.error || "Skill activation failed.");
                    }
                    setEffectiveCapabilities({ loading: false, data: payload.capabilities, error: null });
                    toast.success("Skill activation requested.", { description: "OpenClaw will apply the selected revision on the next turn." });
                  } catch (error) {
                    toast.error("Skill activation failed.", { description: error instanceof Error ? error.message : "Unknown activation error." });
                  }
                }} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Tool profile"><select value={draft.toolProfile} className={profileSelectClassName} onChange={(event) => setDraft({ ...draft, toolProfile: event.target.value as ToolProfile })}><option value="">Inherit OpenClaw default</option><option value="minimal">Minimal</option><option value="coding">Coding</option><option value="messaging">Messaging</option><option value="full">Full</option></select></Field>
                  <Field label="File boundary"><select value={draft.policy.fileAccess} className={profileSelectClassName} onChange={(event) => updatePolicy("fileAccess", event.target.value as AgentPolicy["fileAccess"])}><option value="workspace-only">Workspace only</option><option value="extended">Extended</option></select></Field>
                  <Field label="Additional allowed tools"><Input value={draft.toolAllow} placeholder="browser, web_search" onChange={(event) => setDraft({ ...draft, toolAllow: event.target.value })} /></Field>
                  <Field label="Denied tools"><Input value={draft.toolDeny} placeholder="exec, process" onChange={(event) => setDraft({ ...draft, toolDeny: event.target.value })} /></Field>
                </div>
                <div className="flex flex-wrap gap-2 pt-1"><Button variant="secondary" size="sm" onClick={() => onManageCapabilities(agent.id, "skills")}>Manage skills ({agent.skills.length})</Button><Button variant="secondary" size="sm" onClick={() => onManageCapabilities(agent.id, "tools")}>Manage declared tools</Button></div>
              </ProfileSection>

              <ProfileSection id="worker-profile-safety" eyebrow="04 · Guardrails & reach" icon={ShieldCheck} title="Access & safety" description="Set supported sandbox limits and connect the worker to the channels it may serve.">
                <div className="grid gap-3 sm:grid-cols-3"><Field label="Sandbox mode"><select value={draft.sandboxMode} className={profileSelectClassName} onChange={(event) => setDraft({ ...draft, sandboxMode: event.target.value as SandboxMode })}><option value="">Inherit</option><option value="off">Off</option><option value="non-main">Non-main</option><option value="all">All sessions</option></select></Field><Field label="Scope"><select value={draft.sandboxScope} className={profileSelectClassName} onChange={(event) => setDraft({ ...draft, sandboxScope: event.target.value as SandboxScope })}><option value="">Inherit</option><option value="session">Session</option><option value="agent">Agent</option><option value="shared">Shared</option></select></Field><Field label="Workspace in sandbox"><select value={draft.workspaceAccess} className={profileSelectClassName} onChange={(event) => setDraft({ ...draft, workspaceAccess: event.target.value as WorkspaceAccess })}><option value="">Inherit</option><option value="none">No access</option><option value="ro">Read only</option><option value="rw">Read/write</option></select></Field></div>
                <div className="rounded-2xl border border-amber-300/25 bg-amber-400/5 px-4 py-3 text-xs leading-5 text-muted-foreground"><FolderLock className="mr-1.5 inline h-4 w-4 text-amber-500" />Sandbox changes can alter the worker&apos;s visible workspace and may recreate its runtime on the next turn.</div>
                <div className="rounded-2xl border border-border bg-muted/25 p-4"><p className="text-sm font-medium">Accounts & browser profiles</p><p className="mt-1.5 text-xs leading-5 text-muted-foreground">{accountSummary}</p></div>
                <ChannelBindingPicker snapshot={snapshot} workspaceId={workspace.id} agentId={agent.id} channelIds={draft.channelIds} isSaving={saving} surfaceTheme={surfaceTheme} onChange={(channelIds) => setDraft({ ...draft, channelIds })} />
              </ProfileSection>
            </div>
          </div>
    </MissionControlDialogShell>
  );
}

function EffectiveCapabilitiesPanel({
  state,
  onActivate
}: {
  state: {
    loading: boolean;
    data: WorkerEffectiveCapabilitiesPayload | null;
    error: string | null;
  };
  onActivate: (skill: SkillLibraryItem) => Promise<void>;
}) {
  if (state.loading) {
    return <div className="rounded-2xl border border-border bg-muted/25 px-4 py-3 text-xs text-muted-foreground">Reading OpenClaw&apos;s current effective tools and Skills Library state...</div>;
  }

  if (state.error) {
    return <div className="rounded-2xl border border-amber-300/30 bg-amber-400/5 px-4 py-3 text-xs leading-5 text-muted-foreground"><span className="font-medium text-foreground">Effective capability state unavailable.</span> {state.error}</div>;
  }

  const data = state.data;
  if (!data) return null;

  return (
    <div className="space-y-3 rounded-2xl border border-primary/15 bg-primary/[0.035] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">What this worker can do now</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {data.session.key
              ? `Based on OpenClaw's effective tools for session ${shortId(data.session.key)}.`
              : "OpenClaw has not exposed a session context, so configured tools are not presented as effective capabilities."}
          </p>
        </div>
        <CapabilitySummary summary={data.summary} />
      </div>

      {data.capabilities.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {data.capabilities.map((capability) => (
            <div key={capability.id} className="rounded-xl border border-border bg-background/65 px-3 py-3">
              <div className="flex items-start gap-2">
                <span className={cn("mt-0.5 h-2 w-2 shrink-0 rounded-full", capabilityStatusDot(capability.status))} />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold">{capability.label}</p>
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{capabilityStatusLabel(capability.status)}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{capability.explanation}</p>
                  {capability.configured !== null ? <p className="mt-1.5 text-[10px] text-muted-foreground">Configured: {capability.configured ? "yes" : "no"} · Effective: {capability.effective === null ? "unknown" : capability.effective ? "yes" : "no"}</p> : null}
                  {capability.reasons[0] ? <p className="mt-1 text-[10px] text-muted-foreground/80">Why: {capability.reasons[0].message}</p> : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-border bg-background/65 px-3 py-3 text-xs text-muted-foreground">No native capability entries were returned for this worker.</p>
      )}

      <SkillLibraryPanel data={data} onActivate={onActivate} />
    </div>
  );
}

function SkillLibraryPanel({ data, onActivate }: { data: WorkerEffectiveCapabilitiesPayload; onActivate: (skill: SkillLibraryItem) => Promise<void> }) {
  return (
    <div className="space-y-2 border-t border-border/70 pt-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold">Skills Library</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Native OpenClaw skills, revisions, and session selections.</p>
        </div>
        <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{data.skillLibrary.supported ? "Native" : "Unsupported"}</span>
      </div>
      {!data.skillLibrary.supported ? (
        <p className="rounded-xl border border-border bg-background/65 px-3 py-2.5 text-[11px] leading-4 text-muted-foreground">Skills Library is not available from the current OpenClaw runtime.</p>
      ) : data.skills.length ? (
        <div className="space-y-2">
          {data.skills.map((skill) => {
            const activeLatest = skill.activation.activeRevisionId === skill.revision.id;
            return (
              <div key={skill.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background/65 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{skill.name}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{skill.ownership.scope === "shared" ? "Shared" : skill.ownership.scope === "personal" ? "Personal" : "Ownership unavailable"} · Latest rev {shortId(skill.revision.id)}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">{skill.activation.activeInSession ? activeLatest ? "Active in current session" : `Session rev ${shortId(skill.activation.activeRevisionId)} · newer revision available` : skill.activation.enabled ? "Available to activate" : "Disabled in library"}</p>
                </div>
                {skill.activation.enabled && !skill.activation.activeInSession && data.session.key ? <Button type="button" size="sm" variant="secondary" className="h-7 rounded-lg px-2.5 text-[10px]" onClick={() => void onActivate(skill)}>Activate next turn</Button> : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-xl border border-border bg-background/65 px-3 py-2.5 text-[11px] text-muted-foreground">No native library entries are visible to this operator.</p>
      )}
    </div>
  );
}

function CapabilitySummary({ summary }: { summary: WorkerEffectiveCapabilitiesPayload["summary"] }) {
  const items: Array<[EffectiveCapabilityStatus, string]> = [
    ["available", "available"],
    ["needs-setup", "setup"],
    ["requires-approval", "approval"]
  ];
  return <div className="flex flex-wrap justify-end gap-1.5">{items.filter(([status]) => summary[status] > 0).map(([status, label]) => <span key={status} className="rounded-full border border-border px-2 py-1 text-[10px] text-muted-foreground">{summary[status]} {label}</span>)}</div>;
}

function capabilityStatusLabel(status: EffectiveCapabilityStatus) {
  switch (status) {
    case "available": return "Available";
    case "requires-approval": return "Requires approval";
    case "needs-setup": return "Needs setup";
    case "blocked": return "Blocked";
    case "unavailable": return "Unavailable";
    case "unknown": return "Unknown";
  }
}

function capabilityStatusDot(status: EffectiveCapabilityStatus) {
  switch (status) {
    case "available": return "bg-emerald-500";
    case "requires-approval": return "bg-amber-500";
    case "needs-setup": return "bg-orange-500";
    case "blocked": return "bg-red-500";
    case "unavailable": return "bg-slate-400";
    case "unknown": return "bg-violet-400";
  }
}

function shortId(value: string | null) {
  return value ? `${value.slice(0, 8)}…` : "unknown";
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
  draft,
  hasChanges
}: {
  agent: MissionControlSnapshot["agents"][number];
  workspace: MissionControlSnapshot["workspaces"][number];
  draft: WorkerProfileDraft;
  hasChanges: boolean;
}) {
  const identity = draft.emoji || "🤖";
  const role = draft.role.trim() || "Worker profile";
  const model = agent.modelId === "unassigned" ? "OpenClaw default" : agent.modelId;

  return (
    <div className="overflow-hidden rounded-[18px] border border-border bg-card shadow-[0_10px_28px_rgba(0,0,0,0.07)]">
      <div className="relative overflow-hidden border-b border-border bg-[linear-gradient(145deg,hsl(var(--primary)/0.12),transparent_68%)] p-4">
        <div className="absolute -right-7 -top-7 h-24 w-24 rounded-full border border-primary/15" />
        <span className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-primary/25 bg-background/75 text-lg shadow-lg shadow-primary/10">{identity}</span>
        <p className="relative mt-3 truncate text-sm font-semibold tracking-[-0.015em]">{draft.name || formatAgentDisplayName(agent)}</p>
        <p className="relative mt-1 truncate text-sm text-primary">{role}</p>
        <span className={cn("relative mt-2.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9px] font-semibold", hasChanges ? "bg-amber-400/10 text-amber-600 dark:text-amber-300" : "bg-emerald-400/10 text-emerald-700 dark:text-emerald-300")}><span className={cn("h-1.5 w-1.5 rounded-full", hasChanges ? "bg-amber-400" : "bg-emerald-400")} />{hasChanges ? "Draft updated" : "Saved profile"}</span>
      </div>
      <div className="space-y-3 p-4">
        <SummaryItem label="Workspace" value={workspace.name} />
        <SummaryItem label="Model" value={model} />
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
          <SummaryItem label="Configured skills" value={String(agent.skills.length)} />
          <SummaryItem label="Declared tools" value={String(agent.tools.length)} />
        </div>
        <div className="flex gap-2 rounded-xl border border-primary/10 bg-primary/5 px-2.5 py-2 text-[11px] leading-4 text-muted-foreground">
          <Layers3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>Changes compile into the supported OpenClaw worker runtime and AgentOS profile.</span>
        </div>
      </div>
    </div>
  );
}

function ProfileNavigation() {
  const items = [
    ["worker-profile-identity", "Identity & role"],
    ["worker-profile-work", "Work setup"],
    ["worker-profile-capabilities", "Capabilities"],
    ["worker-profile-safety", "Access & safety"]
  ] as const;

  return (
    <nav aria-label="Worker Profile sections" className="mt-4 hidden rounded-2xl border border-border/80 bg-muted/20 p-2 lg:block">
      <p className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Profile sections</p>
      {items.map(([id, label]) => (
        <a key={id} href={`#${id}`} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-primary/50" />
          {label}
        </a>
      ))}
    </nav>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className="mt-1 truncate text-xs font-medium">{value}</p></div>;
}

function ProfileSection({ id, eyebrow, icon: Icon, title, description, children }: { id: string; eyebrow: string; icon: LucideIcon; title: string; description: string; children: ReactNode }) {
  return <section id={id} className="scroll-mt-4 space-y-4 rounded-[18px] border border-border/80 bg-[linear-gradient(150deg,hsl(var(--card)),hsl(var(--muted)/0.18))] p-4 shadow-[0_8px_24px_rgba(0,0,0,0.03)]"><div className="flex max-w-2xl gap-3"><span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary shadow-sm"><Icon className="h-4 w-4" /></span><div><p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-primary/80">{eyebrow}</p><h3 className="mt-0.5 text-base font-semibold tracking-[-0.015em]">{title}</h3><p className="mt-1 text-xs leading-4 text-muted-foreground">{description}</p></div></div>{children}</section>;
}

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) { return <div className={cn("space-y-2", className)}><Label className="text-xs font-medium text-foreground/85">{label}</Label>{children}</div>; }

function ReadOnlyField({ label, value, detail, action }: { label: string; value: string; detail: string; action?: ReactNode }) { return <div className="rounded-2xl border border-border bg-muted/25 px-4 py-3.5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-xs font-medium text-foreground/85">{label}</p><p className="mt-1.5 truncate text-sm font-medium">{value}</p><p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{detail}</p></div>{action}</div></div>; }

function ToggleChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) { return <button type="button" onClick={onClick} className={cn("rounded-full border px-3 py-1.5 text-xs transition-colors", active ? "border-primary/35 bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground hover:bg-muted")}>{label}</button>; }

function splitList(value: string) { return Array.from(new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))); }
function toggleValue(values: Array<"memory" | "sessions">, value: "memory" | "sessions") { return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]; }
function areSameValues(left: string[], right: string[]) { return left.length === right.length && left.every((value) => right.includes(value)); }
function areSameDraft(left: WorkerProfileDraft, right: WorkerProfileDraft) { return JSON.stringify(left) === JSON.stringify(right); }
