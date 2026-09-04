"use client";

import { useEffect, useRef, useState } from "react";
import { GitBranch, Loader2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { KeyValue, SectionCard, StatusBadge } from "@/components/operations/operations-ui";
import type { AgentRecord, NativeWorkExecutionProjection } from "@/lib/agentos/contracts";
import type { SessionMembershipDetailState, SessionOwnershipProjection } from "@/lib/openclaw/types";

export function NativeExecutionInspector({ execution, agents, refresh, assignmentAvailable }: { execution: NativeWorkExecutionProjection | null; agents: AgentRecord[]; refresh: () => Promise<void>; assignmentAvailable: boolean }) {
  const [agentId, setAgentId] = useState(execution?.ownership.owner?.id ?? agents[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [ownershipDetail, setOwnershipDetail] = useState<SessionOwnershipProjection | null>(execution?.ownership ?? null);
  const [ownershipSessionKey, setOwnershipSessionKey] = useState<string | null>(execution?.sessionKey ?? null);
  const [detailState, setDetailState] = useState<SessionMembershipDetailState>(execution?.ownership.membershipDetailState ?? "not-loaded");
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
      } catch {
        if (controller.signal.aborted) return;
        setOwnershipSessionKey(sessionKey);
        setOwnershipDetail(selectedExecution.ownership);
        setDetailState("unavailable");
      }
    })();
    return () => controller.abort();
  }, [execution?.sessionKey]);

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
  return <SectionCard title="Native execution" className="mt-3" action={<StatusBadge label="OpenClaw" tone="purple" />}><div className="grid gap-2 p-2.5"><KeyValue label="Session" value={execution.sessionKey} /><KeyValue label="State" value={execution.status} /><KeyValue label="Working directory" value={execution.execCwd ?? "Not reported"} /><KeyValue label="Worktree" value={execution.worktree ? `${execution.worktree.branch} · ${execution.worktree.path ?? execution.worktree.repoRoot}` : "Standard session"} /><KeyValue label="Created by" value={displayedOwnership.createdActor?.label ?? displayedOwnership.createdActor?.id ?? "Not reported"} /><KeyValue label="Owner" value={displayedOwnership.owner?.label ?? displayedOwnership.owner?.id ?? "Unassigned"} /><KeyValue label="Visibility" value={displayedOwnership.visibility ?? "Not reported"} /><KeyValue label="Participants" value={displayedOwnership.participantCount ? `${displayedOwnership.participants.map((entry) => entry.label ?? entry.identityId).join(", ")} · ${displayedOwnership.participantCount} total` : "None reported"} /><KeyValue label="Membership evidence" value={membershipEvidence} /></div>{agents.length ? <div className="border-t border-border px-2.5 py-2.5"><div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"><Users className="h-3.5 w-3.5" />Handoff owner</div><div className="flex gap-2"><select value={agentId} onChange={(event) => setAgentId(event.target.value)} disabled={busy || !assignmentAvailable} className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-card px-2 text-xs text-foreground">{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select><Button size="sm" className="h-8 shrink-0 rounded-lg" disabled={busy || !canAssign} onClick={() => void assignOwner()}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitBranch className="h-3.5 w-3.5" />}<span className="sr-only">Assign owner</span></Button></div><p className="mt-1.5 text-[10px] leading-4 text-muted-foreground">{assignmentAvailable ? "This handoff calls OpenClaw sessions.assignOwner; it does not mutate AgentOS task ownership." : "OpenClaw does not currently advertise native owner handoff for this session."}</p></div> : <p className="border-t border-border px-2.5 py-2.5 text-[10px] text-muted-foreground">No AgentOS agents are available for a native handoff target.</p>}</SectionCard>;
}
