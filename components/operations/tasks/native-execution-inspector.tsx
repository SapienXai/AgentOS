"use client";

import { useEffect, useRef, useState } from "react";
import { Check, GitBranch, Loader2, Plus, Trash2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { KeyValue, SectionCard, StatusBadge } from "@/components/operations/operations-ui";
import type { AgentRecord, NativeWorkExecutionProjection } from "@/lib/agentos/contracts";
import type { SessionMembershipDetailState, SessionOwnershipProjection } from "@/lib/openclaw/types";

type NativeProfileOption = {
  profileId: string;
  displayName: string | null;
  role: string | null;
};

type SessionVisibility = NonNullable<SessionOwnershipProjection["visibility"]>;

export function NativeExecutionInspector({ execution, agents, refresh, assignmentAvailable }: { execution: NativeWorkExecutionProjection | null; agents: AgentRecord[]; refresh: () => Promise<void>; assignmentAvailable: boolean }) {
  const [agentId, setAgentId] = useState(execution?.ownership.owner?.id ?? agents[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [ownershipDetail, setOwnershipDetail] = useState<SessionOwnershipProjection | null>(execution?.ownership ?? null);
  const [ownershipSessionKey, setOwnershipSessionKey] = useState<string | null>(execution?.sessionKey ?? null);
  const [detailState, setDetailState] = useState<SessionMembershipDetailState>(execution?.ownership.membershipDetailState ?? "not-loaded");
  const [detailRefreshNonce, setDetailRefreshNonce] = useState(0);
  const [sharingOpen, setSharingOpen] = useState(false);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [nativeProfiles, setNativeProfiles] = useState<NativeProfileOption[]>([]);
  const [profileId, setProfileId] = useState("");
  const [visibility, setVisibility] = useState<SessionVisibility>(execution?.ownership.visibility ?? "shared");
  const executionRef = useRef(execution);
  executionRef.current = execution;

  useEffect(() => {
    const selectedExecution = executionRef.current;
    if (!selectedExecution || selectedExecution.ownership.membershipDetailState === "unavailable") return;
    const sessionKey = selectedExecution.sessionKey;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(`/api/sessions/ownership?sessionKey=${encodeURIComponent(sessionKey)}`, {
          cache: "no-store",
          signal: controller.signal
        });
        const result = await response.json() as {
          execution?: { ownership?: SessionOwnershipProjection };
          detailState?: SessionMembershipDetailState;
          error?: string;
        };
        if (!response.ok || !result.execution?.ownership) throw new Error(result.error || "OpenClaw membership detail is unavailable.");
        if (controller.signal.aborted) return;
        setOwnershipSessionKey(sessionKey);
        setOwnershipDetail(result.execution.ownership);
        setDetailState(result.detailState ?? result.execution.ownership.membershipDetailState);
        if (result.execution.ownership.visibility) setVisibility(result.execution.ownership.visibility);
      } catch {
        if (controller.signal.aborted) return;
        setOwnershipSessionKey(sessionKey);
        setOwnershipDetail(selectedExecution.ownership);
        setDetailState("unavailable");
      }
    })();
    return () => controller.abort();
  }, [execution?.sessionKey, detailRefreshNonce]);

  useEffect(() => {
    setSharingOpen(false);
    setNativeProfiles([]);
    setProfileId("");
    if (execution?.ownership.visibility) setVisibility(execution.ownership.visibility);
  }, [execution?.sessionKey, execution?.ownership.visibility]);

  if (!execution) return null;
  const displayedOwnership = ownershipSessionKey === execution.sessionKey && ownershipDetail
    ? ownershipDetail
    : execution.ownership;
  const displayedDetailState = ownershipSessionKey === execution.sessionKey
    ? detailState
    : displayedOwnership.membershipDetailState;
  const membershipEvidence = displayedDetailState === "not-loaded"
    ? "Loading OpenClaw detail…"
    : displayedDetailState === "unavailable"
      ? "Unavailable from OpenClaw"
      : displayedOwnership.memberEvidence.length
        ? `${displayedOwnership.memberEvidence.length} member record${displayedOwnership.memberEvidence.length === 1 ? "" : "s"}${displayedOwnership.memberEvidence.some((entry) => entry.addedByState === "unknown") ? " · principal unknown" : ""}`
        : "No evidence reported";
  const canAssign = assignmentAvailable && execution.ownership.sourceOfTruth === "openclaw" && Boolean(agentId);
  const assignOwner = async () => {
    if (!canAssign) return;
    setBusy(true);
    try {
      const response = await fetch("/api/sessions/ownership", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "assignOwner", sessionKey: execution.sessionKey, agentId }) });
      const result = await response.json() as { error?: string };
      if (!response.ok || result.error) throw new Error(result.error || "OpenClaw rejected the handoff.");
      toast.success("Session owner updated in OpenClaw.");
      await refresh();
    } catch (error) {
      toast.error("Session owner was not updated.", { description: error instanceof Error ? error.message : "Unknown error." });
    } finally {
      setBusy(false);
    }
  };
  const loadNativeProfiles = async () => {
    if (nativeProfiles.length) return;
    try {
      const response = await fetch("/api/users/openclaw", { cache: "no-store" });
      const result = await response.json() as { profiles?: NativeProfileOption[]; error?: string };
      if (!response.ok || !Array.isArray(result.profiles)) throw new Error(result.error || "Native OpenClaw profiles are unavailable.");
      setNativeProfiles(result.profiles);
      setProfileId(result.profiles[0]?.profileId ?? "");
    } catch (error) {
      toast.error("Native profile directory is unavailable.", { description: error instanceof Error ? error.message : "OpenClaw did not return profiles." });
    }
  };
  const mutateSharing = async (body: Record<string, string>, successMessage: string) => {
    setSharingBusy(true);
    try {
      const response = await fetch("/api/sessions/ownership", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok || result.error) throw new Error(result.error || "OpenClaw rejected the sharing change.");
      toast.success(successMessage);
      setDetailRefreshNonce((value) => value + 1);
      await refresh();
    } catch (error) {
      toast.error("Session sharing was not updated.", { description: error instanceof Error ? error.message : "Unknown error." });
    } finally {
      setSharingBusy(false);
    }
  };
  const currentMemberIds = new Set(displayedOwnership.participants.map((participant) => participant.identityId));
  const addableProfiles = nativeProfiles.filter((profile) => !currentMemberIds.has(profile.profileId));
  const removableProfiles = nativeProfiles.filter((profile) => currentMemberIds.has(profile.profileId));
  const visibilityOptions: SessionVisibility[] = displayedOwnership.allowedVisibilities.length
    ? displayedOwnership.allowedVisibilities
    : ["shared", "read-only", "suggest", "draft"];
  const canManageSharing = assignmentAvailable && displayedDetailState === "available";

  return (
    <SectionCard title="Native execution" className="mt-3" action={<StatusBadge label="OpenClaw" tone="purple" />}>
      <div className="grid gap-2 p-2.5">
        <KeyValue label="Session" value={execution.sessionKey} />
        <KeyValue label="State" value={execution.status} />
        <KeyValue label="Working directory" value={execution.execCwd ?? "Not reported"} />
        <KeyValue label="Worktree" value={execution.worktree ? `${execution.worktree.branch} · ${execution.worktree.path ?? execution.worktree.repoRoot}` : "Standard session"} />
        <KeyValue label="Created by" value={displayedOwnership.createdActor?.label ?? displayedOwnership.createdActor?.id ?? "Not reported"} />
        <KeyValue label="Owner" value={displayedOwnership.owner?.label ?? displayedOwnership.owner?.id ?? "Unassigned"} />
        <KeyValue label="Visibility" value={displayedOwnership.visibility ?? "Not reported"} />
        <KeyValue label="Participants" value={displayedOwnership.participantCount ? `${displayedOwnership.participants.map((entry) => entry.label ?? entry.identityId).join(", ")} · ${displayedOwnership.participantCount} total` : "None reported"} />
        <KeyValue label="Membership evidence" value={membershipEvidence} />
      </div>
      {agents.length ? (
        <div className="border-t border-border px-2.5 py-2.5">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"><Users className="h-3.5 w-3.5" />Handoff owner</div>
          <div className="flex gap-2">
            <select value={agentId} onChange={(event) => setAgentId(event.target.value)} disabled={busy || !assignmentAvailable} className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-card px-2 text-xs text-foreground">
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <Button size="sm" className="h-8 shrink-0 rounded-lg" disabled={busy || !canAssign} onClick={() => void assignOwner()}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />}<span className="sr-only">Assign owner</span>
            </Button>
          </div>
          <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">{assignmentAvailable ? "This handoff calls OpenClaw sessions.assignOwner; it does not mutate AgentOS task ownership." : "OpenClaw does not currently advertise native owner handoff for this session."}</p>
        </div>
      ) : <p className="border-t border-border px-2.5 py-2.5 text-[10px] text-muted-foreground">No AgentOS agents are available for a native handoff target.</p>}
      {canManageSharing ? (
        <div className="border-t border-border px-2.5 py-2.5">
          <Button type="button" variant="secondary" size="sm" className="h-8 rounded-lg text-xs" disabled={sharingBusy} onClick={() => { setSharingOpen((value) => !value); if (!sharingOpen) void loadNativeProfiles(); }}>
            {sharingOpen ? <Check className="mr-1.5 size-3.5" /> : <Users className="mr-1.5 size-3.5" />} {sharingOpen ? "Close sharing" : "Manage sharing"}
          </Button>
          {sharingOpen ? (
            <div className="mt-2 grid gap-2">
              <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Visibility
                <div className="flex gap-2">
                  <select value={visibility} onChange={(event) => setVisibility(event.target.value as SessionVisibility)} disabled={sharingBusy} className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-card px-2 text-xs font-normal normal-case tracking-normal text-foreground">
                    {visibilityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <Button type="button" size="sm" className="h-8 rounded-lg" disabled={sharingBusy || visibility === displayedOwnership.visibility} onClick={() => void mutateSharing({ action: "setVisibility", sessionKey: execution.sessionKey, visibility }, "Session visibility updated in OpenClaw.")}><Check className="size-3.5" /><span className="sr-only">Save visibility</span></Button>
                </div>
              </label>
              {nativeProfiles.length ? <>
                <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Native participant
                  <div className="flex gap-2">
                    <select value={profileId} onChange={(event) => setProfileId(event.target.value)} disabled={sharingBusy || !addableProfiles.length} className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-card px-2 text-xs font-normal normal-case tracking-normal text-foreground">
                      {addableProfiles.map((profile) => <option key={profile.profileId} value={profile.profileId}>{profile.displayName || profile.profileId}{profile.role ? ` · ${profile.role}` : ""}</option>)}
                    </select>
                    <Button type="button" size="sm" className="h-8 rounded-lg" disabled={sharingBusy || !addableProfiles.length || !profileId} onClick={() => void mutateSharing({ action: "addMember", sessionKey: execution.sessionKey, profileId }, "Native participant added in OpenClaw.")}><Plus className="size-3.5" /><span className="sr-only">Add participant</span></Button>
                  </div>
                </label>
                {removableProfiles.length ? <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Remove participant
                  <div className="flex gap-2">
                    <select value={removableProfiles[0]?.profileId ?? ""} onChange={(event) => setProfileId(event.target.value)} disabled={sharingBusy} className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-card px-2 text-xs font-normal normal-case tracking-normal text-foreground">
                      {removableProfiles.map((profile) => <option key={profile.profileId} value={profile.profileId}>{profile.displayName || profile.profileId}</option>)}
                    </select>
                    <Button type="button" variant="secondary" size="sm" className="h-8 rounded-lg" disabled={sharingBusy || !profileId} onClick={() => void mutateSharing({ action: "removeMember", sessionKey: execution.sessionKey, profileId }, "Native participant removed in OpenClaw.")}><Trash2 className="size-3.5" /><span className="sr-only">Remove participant</span></Button>
                  </div>
                </label> : null}
              </> : <p className="text-[10px] text-muted-foreground">No disposable/native human profiles are available for this connection.</p>}
              <p className="text-[10px] leading-4 text-muted-foreground">Sharing changes use OpenClaw native visibility and profile identities. AgentOS actor IDs are never sent as native participant IDs.</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </SectionCard>
  );
}
