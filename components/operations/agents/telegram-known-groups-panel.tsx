"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, ChevronDown, Clock3, LoaderCircle, Search, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

type TelegramKnownGroup = {
  accountId: string;
  chatId: string;
  title: string;
  titleSource: "observed" | "stored" | "chat-id";
  configured: boolean;
  connectedAgentId: string | null;
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
      return payload;
    } catch (nextError) {
      if (isAbortError(nextError)) return null;
      const message = nextError instanceof Error ? nextError.message : "Known Telegram groups are unavailable.";
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [readKnownGroups]);

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

  const connectGroup = useCallback(async (group: Pick<TelegramKnownGroup, "chatId">) => {
    const nextGroupId = group.chatId.trim();
    if (!nextGroupId || !accountId || !agentId) return;

    const key = `${accountId}:${nextGroupId}`;
    setActionKey(key);
    setError(null);
    try {
      const response = await fetch("/api/openclaw/channels/telegram-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, groupId: nextGroupId, agentId })
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error ?? "The Telegram group could not be connected.");

      await Promise.all([loadGroups(), onConnected?.()]);
      setManualGroupId("");
      setAdvancedOpen(false);
      setCandidates((current) => current.filter((candidate) => candidate.chatId !== nextGroupId));
      toast.success("Telegram group connected.", {
        description: `OpenClaw confirmed the group for ${agentLabel}.`
      });
    } catch (nextError) {
      toast.error("Telegram group connection failed.", {
        description: nextError instanceof Error ? nextError.message : "OpenClaw could not confirm the group connection."
      });
    } finally {
      setActionKey(null);
    }
  }, [accountId, agentId, agentLabel, loadGroups, onConnected]);

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
    void connectGroup({ chatId: manualGroupId });
  };

  const online = accountState === "ONLINE";
  const visibleGroups = findOpen && candidates.length > 0 ? candidates : groups;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Groups</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Known groups from OpenClaw configuration, routing, history, and observed sessions.</p>
        </div>
        <Badge variant="muted" className="h-5 shrink-0 rounded-full px-2 text-[9px]">Known groups</Badge>
      </div>

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
          {visibleGroups.map((group) => <KnownGroupRow key={groupKey(group)} group={group} currentAgentId={agentId} actionKey={actionKey} onConnect={() => void connectGroup(group)} />)}
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
    </div>
  );
}

function KnownGroupRow({
  group,
  currentAgentId,
  actionKey,
  onConnect
}: {
  group: TelegramKnownGroup;
  currentAgentId: string;
  actionKey: string | null;
  onConnect: () => void;
}) {
  const key = groupKey(group);
  const currentAgent = group.connectedAgentId === currentAgentId;
  const otherAgent = Boolean(group.connectedAgentId && !currentAgent);
  const actionLabel = group.historical || !group.configured ? "Add & connect" : "Connect";

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold" title={group.title}>{group.title}</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
          <span className="font-mono">{group.chatId}</span>
          {group.historical ? <span>Previously used</span> : null}
          {group.lastObservedAt ? <span>Observed by OpenClaw</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {group.bindingConflict ? <Badge variant="warning" className="h-6 rounded-md px-2 text-[10px]">Binding conflict</Badge> : null}
        {!group.bindingConflict && currentAgent ? <Badge variant="success" className="h-6 rounded-md px-2 text-[10px]">Connected</Badge> : null}
        {!group.bindingConflict && otherAgent ? <span className="max-w-[150px] truncate text-right text-[10px] text-muted-foreground" title={group.connectedAgentId ?? undefined}>Connected to {group.connectedAgentId}</span> : null}
        {!group.bindingConflict && !group.connectedAgentId ? <Button type="button" size="sm" className="h-8 rounded-lg px-2.5 text-xs" onClick={onConnect} disabled={actionKey === key}>{actionKey === key ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}{actionKey === key ? "Connecting…" : actionLabel}</Button> : null}
      </div>
    </div>
  );
}

function groupKey(group: Pick<TelegramKnownGroup, "accountId" | "chatId">) {
  return `${group.accountId}:${group.chatId}`;
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
