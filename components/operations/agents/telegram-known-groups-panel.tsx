"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, ChevronRight, Clock3, LoaderCircle, Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { TelegramGroupPermissionsDialog } from "@/components/operations/agents/telegram-group-permissions-dialog";

type TelegramKnownGroup = {
  accountId: string;
  chatId: string;
  title: string;
  titleSource: "observed" | "stored" | "chat-id";
  configured: boolean;
  connectedAgentId: string | null;
  bindingMatch?: "exact" | "inherited" | "fallback" | "shadowed" | "overlapping" | "ambiguous-edit" | "none" | "conflict" | null;
  bindingSource?: "openclaw" | "agentos-compatibility" | null;
  historicalAgentId: string | null;
  source: "openclaw-config" | "openclaw-binding" | "agentos-registry" | "openclaw-session";
  sources: Array<"openclaw-config" | "openclaw-binding" | "agentos-registry" | "openclaw-session">;
  connectable: boolean;
  historical: boolean;
  bindingConflict: boolean;
  lastObservedAt: string | null;
};

type KnownGroupsResponse = {
  groups: TelegramKnownGroup[];
  observation: {
    supported: boolean;
    available: boolean;
    error: string | null;
  };
  error?: string;
};

type AgentOption = {
  id: string;
  name?: string;
  identityName?: string;
  identity?: { name?: string };
};

type AgentsResponse = {
  agents?: AgentOption[];
};

type TelegramGroupPermissionSummary = {
  access: { mode: "anyone" | "selected" | "nobody" };
  response: { requireMention: boolean };
  capabilities: { preset: "agent-defaults" | "chat-only" | "research" | "selected-tools" | "custom" };
};

type TelegramGroupBroadcast = {
  agentIds: string[];
  strategy: "parallel" | "sequential";
  mentionGating: boolean;
  maxRounds: number;
  maxTurns: number | null;
};

type BroadcastResponse = {
  broadcast: TelegramGroupBroadcast | null;
};

type BroadcastDraft = TelegramGroupBroadcast & { enabled: boolean };

type AccountState = "ONLINE" | "READY" | "STOPPED" | "STARTING" | "NEEDS_SETUP" | "NEEDS_ATTENTION" | "STATUS_UNAVAILABLE" | string;

const DETECTION_TIMEOUT_MS = 75_000;
const DETECTION_INTERVAL_MS = 2_000;

export function TelegramKnownGroupsPanel({
  accountId,
  workspaceId,
  agentId,
  agentLabel,
  accountState,
  accountDetail,
  surfaceTheme = "dark",
  onConnected
}: {
  accountId: string;
  workspaceId: string;
  agentId: string;
  agentLabel: string;
  accountState: AccountState;
  accountDetail: string;
  surfaceTheme?: "dark" | "light";
  onConnected?: () => Promise<void> | void;
}) {
  const isLight = surfaceTheme === "light";
  const [groups, setGroups] = useState<TelegramKnownGroup[]>([]);
  const [observation, setObservation] = useState<KnownGroupsResponse["observation"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [manualGroupId, setManualGroupId] = useState("");
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [finding, setFinding] = useState(false);
  const [findError, setFindError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<TelegramKnownGroup[]>([]);
  const [permissionsGroup, setPermissionsGroup] = useState<TelegramKnownGroup | null>(null);
  const [permissionSummaries, setPermissionSummaries] = useState<Record<string, TelegramGroupPermissionSummary>>({});
  const [broadcasts, setBroadcasts] = useState<Record<string, TelegramGroupBroadcast | null>>({});
  const [broadcastDrafts, setBroadcastDrafts] = useState<Record<string, BroadcastDraft>>({});
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [routeDrafts, setRouteDrafts] = useState<Record<string, string>>({});
  const detectionControllerRef = useRef<AbortController | null>(null);

  const readKnownGroups = useCallback(async (signal?: AbortSignal) => {
    const params = new URLSearchParams({ accountId, workspaceId });
    const response = await fetch(`/api/openclaw/channels/telegram-known-groups?${params.toString()}`, {
      cache: "no-store",
      signal
    });
    const payload = await response.json() as KnownGroupsResponse;
    if (!response.ok || payload.error) {
      throw new Error(payload.error ?? "Known Telegram groups are unavailable.");
    }
    return payload;
  }, [accountId, workspaceId]);

  const loadGroups = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const payload = await readKnownGroups(signal);
      setGroups(payload.groups ?? []);
      setObservation(payload.observation ?? null);
      setRouteDrafts((current) => {
        const next = { ...current };
        for (const group of payload.groups ?? []) {
          const key = groupKey(group);
          if (group.bindingMatch === "exact" && group.connectedAgentId) {
            next[key] = group.connectedAgentId;
          } else if (!group.configured && !next[key]) {
            next[key] = agentId;
          } else if (!(key in next)) {
            next[key] = "";
          }
        }
        return next;
      });
      void Promise.all((payload.groups ?? []).map(async (group) => {
        try {
          const params = new URLSearchParams({ accountId: group.accountId, groupId: group.chatId });
          const [permissionResponse, broadcastResponse] = await Promise.all([
            fetch(`/api/openclaw/channels/telegram-group-permissions?${new URLSearchParams({ accountId: group.accountId, groupId: group.chatId, agentId }).toString()}`, { cache: "no-store", signal }),
            fetch(`/api/openclaw/channels/telegram-group-broadcast?${params.toString()}`, { cache: "no-store", signal })
          ]);
          const permission = permissionResponse.ok ? await permissionResponse.json() as TelegramGroupPermissionSummary : null;
          const broadcast = broadcastResponse.ok ? (await broadcastResponse.json() as BroadcastResponse).broadcast : null;
          return [groupKey(group), { permission, broadcast }] as const;
        } catch (nextError) {
          if (isAbortError(nextError)) throw nextError;
          return null;
        }
      })).then((summaries) => {
        if (!signal?.aborted) {
          const entries = summaries.filter((summary): summary is readonly [string, { permission: TelegramGroupPermissionSummary | null; broadcast: TelegramGroupBroadcast | null }] => Boolean(summary));
          setPermissionSummaries(Object.fromEntries(entries.filter(([, value]) => Boolean(value.permission)).map(([key, value]) => [key, value.permission as TelegramGroupPermissionSummary])));
          setBroadcasts(Object.fromEntries(entries.map(([key, value]) => [key, value.broadcast])));
          setBroadcastDrafts(Object.fromEntries(entries.map(([key, value]) => [key, value.broadcast
            ? { ...value.broadcast, enabled: true }
            : defaultBroadcastDraft(agentId)])));
        }
      }).catch(() => {
        // Group discovery remains useful when the optional permissions summary is unavailable.
      });
      return payload;
    } catch (nextError) {
      if (isAbortError(nextError)) return null;
      const message = nextError instanceof Error ? nextError.message : "Known Telegram groups are unavailable.";
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [agentId, readKnownGroups]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/agents", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as AgentsResponse;
      })
      .then((payload) => {
        if (!payload || controller.signal.aborted) return;
        setAgents(payload.agents ?? []);
      })
      .catch(() => {
        // The current agent remains available if the optional agent directory is unavailable.
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadGroups(controller.signal);
    return () => controller.abort();
  }, [accountState, loadGroups]);

  useEffect(() => {
    return () => detectionControllerRef.current?.abort();
  }, []);

  const cancelDetection = useCallback(() => {
    detectionControllerRef.current?.abort();
    detectionControllerRef.current = null;
    setFinding(false);
    setFindOpen(false);
  }, []);

  const connectGroup = useCallback(async (group: Pick<TelegramKnownGroup, "accountId" | "chatId">, targetAgentId = agentId) => {
    const nextGroupId = group.chatId.trim();
    if (!nextGroupId || !group.accountId || !targetAgentId) return;

    const key = `${group.accountId}:${nextGroupId}`;
    setActionKey(key);
    setError(null);
    try {
      const response = await fetch("/api/openclaw/channels/telegram-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: group.accountId, groupId: nextGroupId, agentId: targetAgentId })
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error ?? "The Telegram group could not be connected.");

      await Promise.all([loadGroups(), onConnected?.()]);
      setManualGroupId("");
      setAdvancedOpen(false);
      setCandidates((current) => current.filter((candidate) => candidate.chatId !== nextGroupId));
      toast.success("Telegram group connected.", {
        description: `OpenClaw confirmed the group for ${agentName(targetAgentId, agents, targetAgentId === agentId ? agentLabel : targetAgentId)}.`
      });
    } catch (nextError) {
      toast.error("Telegram group connection failed.", {
        description: nextError instanceof Error ? nextError.message : "OpenClaw could not confirm the group connection."
      });
    } finally {
      setActionKey(null);
    }
  }, [agentId, agentLabel, agents, loadGroups, onConnected]);

  const updateGroupRoute = useCallback(async (group: TelegramKnownGroup) => {
    const key = groupKey(group);
    const targetAgentId = routeDrafts[key] || null;
    if (group.configured === false) {
      if (!targetAgentId) return;
      await connectGroup(group, targetAgentId);
      return;
    }

    setActionKey(key);
    setError(null);
    try {
      const response = await fetch("/api/openclaw/channels/route-binding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "telegram",
          accountId: group.accountId,
          kind: "group",
          routeId: group.chatId,
          parentRouteId: null,
          metadata: { nativePeerKind: "group" },
          agentId: targetAgentId
        })
      });
      const payload = await response.json() as {
        error?: string;
        pending?: boolean;
        verification?: { verified?: boolean; effectiveAgentId?: string | null };
      };
      if (!response.ok || payload.error) throw new Error(payload.error ?? "The Telegram route could not be updated.");

      await Promise.all([loadGroups(), onConnected?.()]);
      if (payload.verification?.verified) {
        toast.success(targetAgentId ? "Telegram route updated." : "Telegram route removed.", {
          description: targetAgentId
            ? `${group.title} now sends inbound messages to ${agentName(targetAgentId, agents, targetAgentId)}.`
            : `${group.title} now follows its OpenClaw account/default route.`
        });
      } else {
        toast.warning("Telegram route change is pending verification.", {
          description: payload.pending
            ? "OpenClaw accepted the change, but the live route has not caught up yet."
            : "Refresh the group list to confirm the effective route."
        });
      }
    } catch (nextError) {
      toast.error("Telegram route update failed.", {
        description: nextError instanceof Error ? nextError.message : "OpenClaw could not update this group route."
      });
    } finally {
      setActionKey(null);
    }
  }, [agents, connectGroup, loadGroups, onConnected, routeDrafts]);

  const updateGroupBroadcast = useCallback(async (group: TelegramKnownGroup) => {
    const key = groupKey(group);
    const draft = broadcastDrafts[key] ?? defaultBroadcastDraft(agentId);
    setActionKey(key);
    setError(null);
    try {
      const response = await fetch("/api/openclaw/channels/telegram-group-broadcast", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: group.accountId,
          groupId: group.chatId,
          agentIds: draft.enabled ? draft.agentIds : [],
          strategy: draft.strategy,
          mentionGating: draft.mentionGating,
          maxRounds: draft.maxRounds,
          maxTurns: draft.maxTurns
        })
      });
      const payload = await response.json() as { error?: string; broadcast?: TelegramGroupBroadcast | null };
      if (!response.ok || payload.error) throw new Error(payload.error ?? "The Telegram broadcast group could not be updated.");
      await Promise.all([loadGroups(), onConnected?.()]);
      toast.success(draft.enabled ? "Broadcast team saved." : "Broadcast team removed.", {
        description: draft.enabled
          ? `${group.title} will fan out to ${draft.agentIds.length} selected agents.`
          : `${group.title} now uses its single-agent route.`
      });
    } catch (nextError) {
      toast.error("Broadcast team update failed.", {
        description: nextError instanceof Error ? nextError.message : "OpenClaw could not update this broadcast group."
      });
    } finally {
      setActionKey(null);
    }
  }, [agentId, broadcastDrafts, loadGroups, onConnected]);

  const startDetection = useCallback(() => {
    if (accountState !== "ONLINE") {
      toast.info("Telegram is not online yet.", { description: accountDetail });
      return;
    }

    detectionControllerRef.current?.abort();
    const controller = new AbortController();
    detectionControllerRef.current = controller;
    const baseline = new Set(groups.map(groupKey));
    setFindOpen(true);
    setFinding(true);
    setFindError(null);
    setCandidates([]);

    void (async () => {
      const deadline = Date.now() + DETECTION_TIMEOUT_MS;
      try {
        while (Date.now() < deadline && !controller.signal.aborted) {
          const payload = await readKnownGroups(controller.signal);
          setObservation(payload.observation ?? null);
          if (!payload.observation?.supported || !payload.observation.available) {
            throw new Error(payload.observation?.error ?? "OpenClaw cannot expose observed Telegram groups right now.");
          }

          setGroups(payload.groups ?? []);
          const newlyObserved = (payload.groups ?? []).filter((group) => (
            group.sources.includes("openclaw-session") && !baseline.has(groupKey(group))
          ));
          if (newlyObserved.length > 0) {
            setCandidates(newlyObserved);
            setFinding(false);
            return;
          }

          await waitForDelay(DETECTION_INTERVAL_MS, controller.signal);
        }

        if (!controller.signal.aborted) {
          setFinding(false);
          setFindError("No new Telegram group activity was observed. Keep this panel open and try again, or use Advanced.");
        }
      } catch (nextError) {
        if (!isAbortError(nextError)) {
          setFinding(false);
          setFindError(nextError instanceof Error ? nextError.message : "OpenClaw could not observe Telegram activity.");
        }
      } finally {
        if (detectionControllerRef.current === controller) detectionControllerRef.current = null;
      }
    })();
  }, [accountDetail, accountState, groups, readKnownGroups]);

  const manualConnect = () => {
    if (!manualGroupId.trim()) return;
    void connectGroup({ accountId, chatId: manualGroupId });
  };

  const online = accountState === "ONLINE";
  const visibleGroups = findOpen && candidates.length > 0 ? candidates : groups;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Groups</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Each group has one inbound OpenClaw route. See the effective agent, then assign, reassign, or remove that route here.</p>
        </div>
        <Badge variant="muted" className="h-5 shrink-0 rounded-full px-2 text-[9px]">One agent per group</Badge>
      </div>

      {!loading && !error && visibleGroups.length > 0 ? <div className="rounded-lg border border-primary/15 bg-primary/[0.04] px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
        <span className="font-medium text-foreground">How routing works:</span> an explicit group route wins over the account/default route. Removing it does not block the group; it returns the group to OpenClaw&apos;s inherited/default route.
      </div> : null}

      {loading ? <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-3 text-xs text-muted-foreground" role="status"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Reading OpenClaw group state…</div> : null}
      {error ? <div className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs leading-5 text-amber-800 dark:text-amber-100" role="alert"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div> : null}

      {!loading && !error && visibleGroups.length === 0 ? (
        <div className={cn("rounded-lg border border-dashed px-3 py-4", isLight ? "border-border bg-background" : "border-border bg-muted/10")}>
          <p className="text-sm font-medium">No groups yet</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Send a message in the Telegram group you want to connect.</p>
          <Button type="button" size="sm" className="mt-3 h-8 rounded-lg px-3 text-xs" onClick={startDetection} disabled={!online || finding}>
            <Search className="mr-1.5 h-3.5 w-3.5" />Find group
          </Button>
        </div>
      ) : null}

      {!loading && visibleGroups.length > 0 ? (
        <div className="divide-y divide-border rounded-lg border border-border">
          {findOpen && candidates.length > 0 ? <div className="flex items-center justify-between gap-2 bg-primary/5 px-3 py-2.5"><p className="text-xs font-medium">Detected groups</p><Button type="button" variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-[11px]" onClick={cancelDetection}>Close</Button></div> : null}
          {visibleGroups.map((group) => <KnownGroupRow
            key={groupKey(group)}
            group={group}
            summary={permissionSummaries[groupKey(group)]}
            broadcast={broadcasts[groupKey(group)] ?? null}
            broadcastDraft={broadcastDrafts[groupKey(group)] ?? defaultBroadcastDraft(agentId)}
            currentAgentId={agentId}
            agents={agents}
            routeDraft={routeDrafts[groupKey(group)] ?? ""}
            actionKey={actionKey}
            onRouteDraftChange={(nextAgentId) => setRouteDrafts((current) => ({ ...current, [groupKey(group)]: nextAgentId }))}
            onSaveRoute={() => void updateGroupRoute(group)}
            onBroadcastDraftChange={(nextDraft) => setBroadcastDrafts((current) => ({ ...current, [groupKey(group)]: nextDraft }))}
            onSaveBroadcast={() => void updateGroupBroadcast(group)}
            onConnect={() => void connectGroup(group)}
            onOpenPermissions={() => setPermissionsGroup(group)}
          />)}
        </div>
      ) : null}

      {finding ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-3" role="status" aria-live="polite">
          <div className="flex min-w-0 items-center gap-2"><Clock3 className="h-3.5 w-3.5 shrink-0 text-primary" /><span className="text-xs text-foreground">Waiting for activity…</span></div>
          <Button type="button" variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-[11px]" onClick={cancelDetection}><X className="mr-1 h-3 w-3" />Cancel</Button>
        </div>
      ) : null}
      {findError ? <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs leading-5 text-amber-800 dark:text-amber-100"><span>{findError}</span><Button type="button" variant="ghost" size="sm" className="h-7 shrink-0 rounded-lg px-2 text-[11px] text-amber-900 dark:text-amber-100" onClick={startDetection} disabled={!online}>Retry</Button></div> : null}

      {visibleGroups.length > 0 && !findOpen ? <Button type="button" variant="secondary" size="sm" className="h-8 rounded-lg px-3 text-xs" onClick={startDetection} disabled={!online || finding}><Search className="mr-1.5 h-3.5 w-3.5" />Find another group</Button> : null}

      {observation && !observation.available && !loading && !error ? <p className="text-[11px] leading-4 text-muted-foreground">OpenClaw activity detection is unavailable right now. Use Advanced if the group is not already known.</p> : null}

      <div className="border-t border-border pt-3">
        <Button type="button" variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-xs text-muted-foreground" onClick={() => setAdvancedOpen((current) => !current)} aria-expanded={advancedOpen}>
          <ChevronDown className={cn("mr-1.5 h-3.5 w-3.5 transition-transform", advancedOpen && "rotate-180")} />Advanced
        </Button>
        {advancedOpen ? (
          <div className="mt-2 rounded-lg border border-border bg-muted/10 p-3">
            <label className="block space-y-1.5 text-xs font-medium" htmlFor="telegram-group-id"><span>Enter group ID manually</span><Input id="telegram-group-id" value={manualGroupId} onChange={(event) => setManualGroupId(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") manualConnect(); }} placeholder="-1001234567890" inputMode="numeric" autoComplete="off" disabled={Boolean(actionKey)} /></label>
            <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">Open the group, mention the bot once, then check OpenClaw activity.</p>
            <Button type="button" size="sm" className="mt-3 h-8 rounded-lg px-3 text-xs" onClick={manualConnect} disabled={!manualGroupId.trim() || Boolean(actionKey) || !online}><Check className="mr-1.5 h-3.5 w-3.5" />{actionKey ? "Connecting…" : "Add & connect"}</Button>
          </div>
        ) : null}
      </div>

      <TelegramGroupPermissionsDialog
        open={Boolean(permissionsGroup)}
        onOpenChange={(nextOpen) => { if (!nextOpen) setPermissionsGroup(null); }}
        group={permissionsGroup}
        agentId={agentId}
        agentLabel={agentLabel}
        surfaceTheme={surfaceTheme}
        onSaved={async () => {
          await loadGroups();
          await onConnected?.();
        }}
      />
    </div>
  );
}

function KnownGroupRow({
  group,
  summary,
  broadcast,
  broadcastDraft,
  currentAgentId,
  agents,
  routeDraft,
  actionKey,
  onRouteDraftChange,
  onSaveRoute,
  onBroadcastDraftChange,
  onSaveBroadcast,
  onConnect,
  onOpenPermissions
}: {
  group: TelegramKnownGroup;
  summary?: TelegramGroupPermissionSummary;
  broadcast: TelegramGroupBroadcast | null;
  broadcastDraft: BroadcastDraft;
  currentAgentId: string;
  agents: AgentOption[];
  routeDraft: string;
  actionKey: string | null;
  onRouteDraftChange: (agentId: string) => void;
  onSaveRoute: () => void;
  onBroadcastDraftChange: (draft: BroadcastDraft) => void;
  onSaveBroadcast: () => void;
  onConnect: () => void;
  onOpenPermissions: () => void;
}) {
  const key = groupKey(group);
  const explicitBinding = group.bindingMatch === "exact";
  const inheritedBinding = group.bindingMatch === "inherited" || group.bindingMatch === "fallback";
  const currentAgent = explicitBinding && group.connectedAgentId === currentAgentId;
  const effectiveAgent = group.connectedAgentId ? agentName(group.connectedAgentId, agents, group.connectedAgentId) : "OpenClaw default";
  const broadcastChanged = broadcastDraft.enabled !== Boolean(broadcast)
    || (broadcastDraft.enabled && !broadcastDraftsEqual(broadcastDraft, broadcast));
  const draftChanged = explicitBinding
    ? routeDraft !== (group.connectedAgentId ?? "")
    : Boolean(routeDraft);
  const hasConfiguredRoute = Boolean(group.configured);
  const saveLabel = !hasConfiguredRoute
    ? "Add & connect"
    : routeDraft
      ? explicitBinding ? "Save assignment" : "Assign agent"
      : explicitBinding ? "Remove route" : "Keep inherited";

  return (
    <div className="space-y-3 px-3 py-3">
      <div className="flex items-start gap-3">
        <button type="button" className="min-w-0 flex-1 rounded-lg text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-primary/60" onClick={onOpenPermissions} aria-label={`Open permissions for ${group.title}`}>
          <span className="flex items-center gap-1.5"><span className="truncate text-xs font-semibold" title={group.title}>{group.title}</span><ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
            <span className="font-mono">{group.chatId}</span>
            {group.historical ? <span>Previously used</span> : null}
            {group.lastObservedAt ? <span>Observed by OpenClaw</span> : null}
            <span>{summary ? `${accessLabel(summary.access.mode)} · ${summary.response.requireMention ? "Mention required" : "Mentions optional"} · ${capabilityLabel(summary.capabilities.preset)}` : "Open permissions"}</span>
          </span>
        </button>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {group.bindingConflict ? <Badge variant="warning" className="h-6 rounded-md px-2 text-[10px]">Binding conflict</Badge> : null}
          {!group.bindingConflict && broadcast ? <Badge variant="success" className="h-6 rounded-md px-2 text-[10px]">Broadcast · {broadcast.agentIds.length}</Badge> : null}
          {!group.bindingConflict && !broadcast && explicitBinding ? <Badge variant={currentAgent ? "success" : "muted"} className="h-6 rounded-md px-2 text-[10px]">Explicit route</Badge> : null}
          {!group.bindingConflict && !broadcast && inheritedBinding ? <Badge variant="muted" className="h-6 rounded-md px-2 text-[10px]">Inherited</Badge> : null}
          {!group.bindingConflict && !broadcast && !explicitBinding && !inheritedBinding ? <Badge variant="muted" className="h-6 rounded-md px-2 text-[10px]">Unassigned</Badge> : null}
        </div>
      </div>

      <div className="grid gap-2 rounded-lg border border-border bg-muted/[0.08] p-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="min-w-0 space-y-1.5 text-[10px] font-medium text-muted-foreground" htmlFor={`telegram-agent-${key}`}>
          <span className="flex flex-wrap items-center gap-1.5"><span>{broadcastDraft.enabled ? "Fallback route" : "Inbound agent"}</span><span className="font-normal">{broadcastDraft.enabled ? "Broadcast takes precedence" : <>Effective now: <span className="text-foreground">{effectiveAgent}</span>{inheritedBinding ? " · inherited/default" : ""}</>}</span></span>
          <select
            id={`telegram-agent-${key}`}
            value={routeDraft}
            onChange={(event) => onRouteDraftChange(event.target.value)}
            disabled={Boolean(group.bindingConflict) || actionKey === key}
            className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs font-normal text-foreground"
          >
            {inheritedBinding ? <option value="">No explicit override · uses {effectiveAgent}</option> : <option value="">No explicit route</option>}
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agentName(agent.id, agents, agent.id)}{agent.id === currentAgentId ? " · current agent" : ""}</option>)}
            {!agents.some((agent) => agent.id === currentAgentId) ? <option value={currentAgentId}>{currentAgentId} · current agent</option> : null}
          </select>
        </label>
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg px-2.5 text-[11px]" onClick={onOpenPermissions}>Permissions</Button>
          {group.bindingConflict ? null : !hasConfiguredRoute && !routeDraft ? <Button type="button" size="sm" className="h-8 rounded-lg px-2.5 text-[11px]" onClick={onConnect} disabled={actionKey === key}>{actionKey === key ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}{actionKey === key ? "Connecting…" : "Add & connect"}</Button> : <Button type="button" size="sm" variant={routeDraft ? "default" : "destructive"} className="h-8 rounded-lg px-2.5 text-[11px]" onClick={onSaveRoute} disabled={!draftChanged || actionKey === key}>{actionKey === key ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}{actionKey === key ? "Saving…" : saveLabel}</Button>}
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-background/60 p-2.5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <label className="min-w-0 space-y-1.5 text-[10px] font-medium text-muted-foreground" htmlFor={`telegram-delivery-${key}`}>
            <span>Delivery mode</span>
            <select
              id={`telegram-delivery-${key}`}
              value={broadcastDraft.enabled ? "broadcast" : "single"}
              onChange={(event) => onBroadcastDraftChange({
                ...broadcastDraft,
                enabled: event.target.value === "broadcast",
                agentIds: event.target.value === "broadcast" && broadcastDraft.agentIds.length === 0 ? [currentAgentId] : broadcastDraft.agentIds
              })}
              disabled={Boolean(group.bindingConflict) || actionKey === key}
              className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs font-normal text-foreground sm:w-[260px]"
            >
              <option value="single">Single agent route</option>
              <option value="broadcast">Broadcast to an agent team</option>
            </select>
          </label>
          <Button type="button" size="sm" variant={broadcastDraft.enabled ? "default" : "secondary"} className="h-8 rounded-lg px-2.5 text-[11px]" onClick={onSaveBroadcast} disabled={Boolean(group.bindingConflict) || !broadcastChanged || (broadcastDraft.enabled && broadcastDraft.agentIds.length === 0) || actionKey === key}>
            {actionKey === key ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
            {actionKey === key ? "Saving…" : broadcastDraft.enabled ? "Save broadcast team" : "Remove broadcast"}
          </Button>
        </div>
        {broadcastDraft.enabled ? <>
          <p className="text-[10px] leading-4 text-muted-foreground">OpenClaw runs the selected agents for the same Telegram message. The ordinary route above remains the fallback/admission route.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {agents.map((agent) => <label key={agent.id} className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-xs", broadcastDraft.agentIds.includes(agent.id) ? "border-primary bg-primary/5" : "border-border bg-muted/10")}>
              <input type="checkbox" checked={broadcastDraft.agentIds.includes(agent.id)} onChange={() => onBroadcastDraftChange({ ...broadcastDraft, agentIds: broadcastDraft.agentIds.includes(agent.id) ? broadcastDraft.agentIds.filter((id) => id !== agent.id) : [...broadcastDraft.agentIds, agent.id] })} className="accent-[hsl(var(--primary))]" />
              <span className="min-w-0 truncate">{agentName(agent.id, agents, agent.id)}{agent.id === currentAgentId ? <span className="ml-1 text-[10px] text-muted-foreground">(current)</span> : null}</span>
            </label>)}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex items-center gap-2 text-[10px] text-muted-foreground"><span>Processing (all broadcast groups)</span><select value={broadcastDraft.strategy} onChange={(event) => onBroadcastDraftChange({ ...broadcastDraft, strategy: event.target.value as TelegramGroupBroadcast["strategy"] })} className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground"><option value="parallel">Parallel</option><option value="sequential">Sequential</option></select></label>
            <label className="flex items-center gap-2 text-[10px] text-muted-foreground"><input type="checkbox" checked={broadcastDraft.mentionGating} onChange={(event) => onBroadcastDraftChange({ ...broadcastDraft, mentionGating: event.target.checked })} className="accent-[hsl(var(--primary))]" />Only mentioned agents when named</label>
          </div>
          {agents.length === 0 ? <p className="text-[10px] leading-4 text-amber-700 dark:text-amber-200">The agent directory is unavailable. Refresh after OpenClaw exposes the configured agents.</p> : null}
        </> : <p className="text-[10px] leading-4 text-muted-foreground">One agent receives this group through the route above. Choose Broadcast to let multiple configured agents respond.</p>}
      </div>
    </div>
  );
}

function groupKey(group: Pick<TelegramKnownGroup, "accountId" | "chatId">) {
  return `${group.accountId}:${group.chatId}`;
}

function accessLabel(mode: TelegramGroupPermissionSummary["access"]["mode"]) {
  return mode === "anyone" ? "Anyone" : mode === "selected" ? "Selected people" : "Nobody";
}

function capabilityLabel(preset: TelegramGroupPermissionSummary["capabilities"]["preset"]) {
  return preset === "agent-defaults" ? "Agent defaults" : preset === "chat-only" ? "Chat only" : preset === "selected-tools" ? "Selected tools" : preset === "research" ? "Research" : "Custom";
}

function agentName(agentId: string, agents: AgentOption[], fallback: string) {
  const agent = agents.find((entry) => entry.id === agentId);
  return agent?.name || agent?.identityName || agent?.identity?.name || fallback;
}

function defaultBroadcastDraft(agentId: string): BroadcastDraft {
  return {
    agentIds: agentId ? [agentId] : [],
    enabled: false,
    strategy: "parallel",
    mentionGating: true,
    maxRounds: 1,
    maxTurns: null
  };
}

function broadcastDraftsEqual(left: BroadcastDraft, right: TelegramGroupBroadcast | null) {
  if (!right) return false;
  return left.agentIds.length === right.agentIds.length
    && left.agentIds.every((agentId, index) => agentId === right.agentIds[index])
    && left.strategy === right.strategy
    && left.mentionGating === right.mentionGating
    && left.maxRounds === right.maxRounds
    && left.maxTurns === right.maxTurns;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function waitForDelay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      window.clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const finish = () => {
      cleanup();
      resolve();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("The detection request was cancelled.", "AbortError"));
    };
    const timer = window.setTimeout(finish, ms);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
