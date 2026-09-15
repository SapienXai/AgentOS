"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GitBranch, LoaderCircle, MessageCircle, Plus, RefreshCw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import type { ChannelRouteKind, ChannelRouteIdentity } from "@/lib/openclaw/domains/channel-center";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";
type DisplayMatch = "explicit" | "inherited" | "default";

type AgentRouteProjection = {
  id: string;
  route: ChannelRouteIdentity | null;
  provider: string | null;
  accountId: string | null;
  kind: ChannelRouteKind | null;
  title: string;
  subtitle: string;
  scope: "route" | "account";
  effectiveAgentId: string | null;
  explicitAgentId: string | null;
  displayMatch: DisplayMatch;
  bindingMatch: string;
  inheritedFrom: ChannelRouteIdentity | null;
  editable: boolean;
  editingAmbiguity: boolean;
  shadowedBindingCount: number;
};

type AgentRouteSummary = {
  routes: AgentRouteProjection[];
  diagnostics?: { topicConfig?: "read" | "unavailable" | "not-requested" };
};

type CenterProvider = {
  id: string;
  label: string;
  accounts: Array<{
    accountId: string;
    name?: string | null;
    configured?: boolean;
    running?: boolean;
  }>;
  capabilities?: { supportsTopics?: boolean };
};

type DirectoryEntry = {
  routeId: string;
  kind: ChannelRouteKind;
  accountId: string;
  parentRouteId: string | null;
  title: string | null;
  handle: string | null;
  metadata: Record<string, unknown>;
  agentId: string | null;
  bindingMatch: string | null;
  bindingEditingAmbiguous: boolean;
  inheritedFrom: ChannelRouteIdentity | null;
  shadowedBindingCount: number;
};

type DirectoryResponse = {
  entries: DirectoryEntry[];
  status: "ok" | "empty" | "unsupported" | "failed";
  error: string | null;
};

export function AgentChannelsSection({ agentId, surfaceTheme = "dark" }: { agentId: string; surfaceTheme?: SurfaceTheme }) {
  const isLight = surfaceTheme === "light";
  const [summary, setSummary] = useState<AgentRouteSummary | null>(null);
  const [loadingSummary, setLoadingSummary] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [centerLoading, setCenterLoading] = useState(false);
  const [providers, setProviders] = useState<CenterProvider[]>([]);
  const [providerId, setProviderId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [routeKind, setRouteKind] = useState<"groups" | "peers" | "topics">("groups");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [directoryEntries, setDirectoryEntries] = useState<DirectoryEntry[]>([]);
  const [directoryStatus, setDirectoryStatus] = useState<DirectoryResponse["status"] | null>(null);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  const [mutationKey, setMutationKey] = useState<string | null>(null);

  const selectedProvider = providers.find((provider) => provider.id === providerId) ?? null;
  const selectedAccount = selectedProvider?.accounts.find((account) => account.accountId === accountId) ?? null;
  const groupEntries = useMemo(
    () => directoryEntries.filter((entry) => entry.kind === "group"),
    [directoryEntries]
  );

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true);
    setSummaryError(null);
    try {
      const response = await fetch(`/api/openclaw/channels/agent-routes?agentId=${encodeURIComponent(agentId)}`, { cache: "no-store" });
      const payload = await response.json() as AgentRouteSummary & { error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error ?? "Agent channel routes are unavailable.");
      setSummary(payload);
    } catch (error) {
      setSummary(null);
      setSummaryError(error instanceof Error ? error.message : "Agent channel routes are unavailable.");
    } finally {
      setLoadingSummary(false);
    }
  }, [agentId]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const loadCenter = async () => {
    if (providers.length > 0 || centerLoading) return;
    setCenterLoading(true);
    try {
      const response = await fetch("/api/openclaw/channels/center", { cache: "no-store" });
      const payload = await response.json() as { providers?: CenterProvider[]; error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error ?? "Channel providers are unavailable.");
      const nextProviders = payload.providers ?? [];
      setProviders(nextProviders);
      const nextProvider = nextProviders[0];
      const nextAccount = nextProvider?.accounts[0];
      setProviderId(nextProvider?.id ?? "");
      setAccountId(nextAccount?.accountId ?? "");
      setDirectoryEntries([]);
      setDirectoryStatus(null);
      setDirectoryError(null);
    } catch (error) {
      setDirectoryError(error instanceof Error ? error.message : "Channel providers are unavailable.");
    } finally {
      setCenterLoading(false);
    }
  };

  const readDirectory = async (nextKind: "groups" | "peers" | "topics", nextGroupId = groupId) => {
    if (!providerId || !accountId || (nextKind === "topics" && !nextGroupId)) return;
    setLoadingDirectory(true);
    setDirectoryError(null);
    const params = new URLSearchParams({ provider: providerId, accountId, kind: nextKind, limit: "100" });
    if (nextGroupId) params.set("groupId", nextGroupId);
    try {
      const response = await fetch(`/api/openclaw/channels/directory?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json() as DirectoryResponse & { error?: string };
      if (!response.ok && !payload.status) throw new Error(payload.error ?? "Channel routes are unavailable.");
      setDirectoryEntries(payload.entries ?? []);
      setDirectoryStatus(payload.status ?? "failed");
      if (payload.error) setDirectoryError(payload.error);
    } catch (error) {
      setDirectoryEntries([]);
      setDirectoryStatus("failed");
      setDirectoryError(error instanceof Error ? error.message : "Channel routes are unavailable.");
    } finally {
      setLoadingDirectory(false);
    }
  };

  const openAddRoute = () => {
    setAddOpen((current) => !current);
    if (!addOpen) void loadCenter();
  };

  const chooseProvider = (nextProviderId: string) => {
    const nextProvider = providers.find((provider) => provider.id === nextProviderId);
    setProviderId(nextProviderId);
    setAccountId(nextProvider?.accounts[0]?.accountId ?? "");
    setGroupId(null);
    setDirectoryEntries([]);
    setDirectoryStatus(null);
    setDirectoryError(null);
  };

  const chooseAccount = (nextAccountId: string) => {
    setAccountId(nextAccountId);
    setGroupId(null);
    setDirectoryEntries([]);
    setDirectoryStatus(null);
    setDirectoryError(null);
  };

  const mutateRoute = async (route: ChannelRouteIdentity, nextAgentId: string | null, successMessage: string) => {
    const key = `${route.provider}:${route.accountId}:${route.kind}:${route.parentRouteId ?? ""}:${route.routeId}`;
    setMutationKey(key);
    try {
      const response = await fetch("/api/openclaw/channels/route-binding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...route, agentId: nextAgentId })
      });
      const payload = await response.json() as { error?: string; pending?: boolean; applyMode?: string };
      if (!response.ok || payload.error) throw new Error(payload.error ?? "OpenClaw could not update the route.");
      toast.success(successMessage, {
        description: payload.pending || payload.applyMode === "pending"
          ? "OpenClaw accepted the change and will apply it asynchronously."
          : "OpenClaw accepted the native route change."
      });
      await loadSummary();
      if (addOpen && providerId && accountId) await readDirectory(routeKind, groupId);
    } catch (error) {
      toast.error("Route change failed.", { description: error instanceof Error ? error.message : "OpenClaw route update failed." });
    } finally {
      setMutationKey(null);
    }
  };

  const showSummaryEmpty = !loadingSummary && !summaryError && (summary?.routes.length ?? 0) === 0;

  return (
    <div className="space-y-3">
      <div className={cn("flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between", isLight ? "border-border bg-background/80" : "border-border bg-muted/20")}>
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary"><MessageCircle className="h-4 w-4" /></span>
          <div className="min-w-0">
            <p className="text-sm font-medium">OpenClaw native routes</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">This agent’s effective message routes come from OpenClaw. Workspace channel metadata is not used for runtime routing.</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => void loadSummary()} disabled={loadingSummary || Boolean(mutationKey)}><RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loadingSummary && "animate-spin")} />Refresh</Button>
          <Button type="button" size="sm" className="h-8 rounded-lg px-2.5 text-xs" onClick={openAddRoute} disabled={Boolean(mutationKey)}><Plus className="mr-1.5 h-3.5 w-3.5" />Add route</Button>
        </div>
      </div>

      {summaryError ? <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs leading-5 text-amber-800 dark:text-amber-100" role="alert">{summaryError}</div> : null}
      {summary?.diagnostics?.topicConfig === "unavailable" ? <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs leading-5 text-amber-800 dark:text-amber-100">Telegram topic state could not be read. Group and account bindings remain visible; refresh after OpenClaw is available.</div> : null}
      {loadingSummary ? <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-3 text-xs text-muted-foreground"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Reading OpenClaw route state…</div> : null}
      {showSummaryEmpty ? <div className="rounded-xl border border-dashed border-border px-3 py-4 text-xs leading-5 text-muted-foreground">No native route currently targets this agent. Add a route to create an exact OpenClaw override, or leave it unassigned to inherit the provider/default route.</div> : null}

      {summary?.routes.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {summary.routes.map((route) => <RouteCard key={route.id} route={route} mutationKey={mutationKey} onRemove={() => route.route && void mutateRoute(route.route, null, "Route override removed.")} onOverride={() => route.route && void mutateRoute(route.route, agentId, "Route override added.")} />)}
        </div>
      ) : null}

      {addOpen ? (
        <div className="rounded-2xl border border-primary/20 bg-primary/[0.03] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Add an OpenClaw route</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Provider accounts and route candidates are loaded only when requested.</p>
            </div>
            {centerLoading ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
          </div>

          {providers.length > 0 ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs font-medium"><span>Provider</span><select value={providerId} onChange={(event) => chooseProvider(event.target.value)} className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"><option value="">Choose provider</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}</select></label>
              <label className="space-y-1.5 text-xs font-medium"><span>Account</span><select value={accountId} onChange={(event) => chooseAccount(event.target.value)} disabled={!selectedProvider} className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"><option value="">Choose account</option>{selectedProvider?.accounts.map((account) => <option key={account.accountId} value={account.accountId}>{account.name || account.accountId}</option>)}</select></label>
              <label className="space-y-1.5 text-xs font-medium"><span>Route type</span><select value={routeKind} onChange={(event) => { const nextKind = event.target.value as "groups" | "peers" | "topics"; setRouteKind(nextKind); setDirectoryEntries([]); setDirectoryStatus(null); setDirectoryError(null); if (nextKind === "topics" && groupId) void readDirectory(nextKind, groupId); }} disabled={!selectedAccount} className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"><option value="groups">Groups and servers</option><option value="peers">Direct routes</option>{selectedProvider?.id === "telegram" && selectedProvider.capabilities?.supportsTopics ? <option value="topics">Telegram topics</option> : null}</select></label>
              {routeKind === "topics" ? <label className="space-y-1.5 text-xs font-medium"><span>Parent group</span><select value={groupId ?? ""} onChange={(event) => { setGroupId(event.target.value || null); if (event.target.value) void readDirectory("topics", event.target.value); }} disabled={groupEntries.length === 0} className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"><option value="">Choose group</option>{groupEntries.map((entry) => <option key={entry.routeId} value={entry.routeId}>{entry.title || entry.handle || "Telegram group"}</option>)}</select></label> : null}
            </div>
          ) : centerLoading ? null : <p className="mt-4 rounded-xl border border-dashed border-border px-3 py-3 text-xs leading-5 text-muted-foreground">OpenClaw did not report any provider accounts that can be selected.</p>}

          {providers.length > 0 && selectedAccount ? <Button type="button" variant="secondary" size="sm" className="mt-3 h-8 rounded-lg text-xs" onClick={() => void readDirectory(routeKind, groupId)} disabled={loadingDirectory || (routeKind === "topics" && !groupId)}>{loadingDirectory ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <GitBranch className="mr-1.5 h-3.5 w-3.5" />}Load routes</Button> : null}
          {directoryError ? <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs leading-5 text-amber-800 dark:text-amber-100">{directoryError}</p> : null}
          {directoryStatus === "unsupported" ? <p className="mt-3 rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-xs leading-5 text-muted-foreground">OpenClaw does not expose this directory for the selected provider. Use the OpenClaw Control UI for discovery, then return here to bind a known route.</p> : null}
          {directoryStatus === "empty" && !loadingDirectory ? <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-3 text-xs leading-5 text-muted-foreground">OpenClaw returned no routes for this account.</p> : null}
          {directoryEntries.length > 0 ? <div className="mt-3 space-y-2">{directoryEntries.map((entry) => <DirectoryRouteCard key={`${entry.kind}:${entry.parentRouteId ?? ""}:${entry.routeId}`} entry={entry} agentId={agentId} mutationKey={mutationKey} onRoute={() => void mutateRoute(toRouteIdentity(providerId, entry), agentId, "Route override added.")} />)}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function RouteCard({ route, mutationKey, onRemove, onOverride }: { route: AgentRouteProjection; mutationKey: string | null; onRemove: () => void; onOverride: () => void }) {
  const canAct = Boolean(route.route && route.editable && !route.editingAmbiguity);
  return (
    <div className="rounded-xl border border-border bg-background/60 p-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-primary/15 bg-primary/10 text-primary"><MessageCircle className="h-3.5 w-3.5" /></span>
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><p className="truncate text-xs font-semibold">{route.title}</p><Badge variant="muted" className="h-5 rounded-full px-2 text-[9px]">{displayMatchLabel(route.displayMatch)}</Badge></div><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{route.subtitle}</p>{route.inheritedFrom ? <p className="mt-1 text-[10px] text-muted-foreground">Parent route inheritance is active.</p> : null}{route.editingAmbiguity ? <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-200">Multiple native matches are present; editing is blocked until the ambiguity is resolved in OpenClaw.</p> : null}</div>
      </div>
      {route.displayMatch === "explicit" && route.scope === "route" ? <Button type="button" variant="ghost" size="sm" className="mt-2 h-7 rounded-lg px-2 text-[10px] text-destructive" onClick={onRemove} disabled={!canAct || Boolean(mutationKey)}><Trash2 className="mr-1 h-3 w-3" />Remove override</Button> : route.displayMatch === "inherited" ? <Button type="button" variant="secondary" size="sm" className="mt-2 h-7 rounded-lg px-2 text-[10px]" onClick={onOverride} disabled={!canAct || Boolean(mutationKey)}><GitBranch className="mr-1 h-3 w-3" />Override for this agent</Button> : null}
    </div>
  );
}

function DirectoryRouteCard({ entry, agentId, mutationKey, onRoute }: { entry: DirectoryEntry; agentId: string; mutationKey: string | null; onRoute: () => void }) {
  const effectiveForAgent = entry.agentId === agentId;
  const canEdit = entry.kind !== "peer" && entry.kind !== "thread";
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-background/65 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><p className="truncate text-xs font-medium">{entry.title || entry.handle || routeKindLabel(entry.kind)}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{routeKindLabel(entry.kind)}{entry.bindingMatch === "inherited" ? " · inherited" : entry.bindingMatch === "fallback" ? " · OpenClaw default" : ""}</p></div>
      <Button type="button" size="sm" variant={effectiveForAgent ? "secondary" : "default"} className="h-7 shrink-0 rounded-lg px-2.5 text-[10px]" onClick={onRoute} disabled={effectiveForAgent || !canEdit || entry.bindingEditingAmbiguous || Boolean(mutationKey)}>{effectiveForAgent ? "Current route" : canEdit ? "Route to agent" : "OpenClaw only"}</Button>
    </div>
  );
}

function toRouteIdentity(provider: string, entry: DirectoryEntry): ChannelRouteIdentity {
  return {
    provider,
    accountId: entry.accountId,
    kind: entry.kind,
    routeId: entry.routeId,
    parentRouteId: entry.parentRouteId,
    ...(Object.keys(entry.metadata).length > 0 ? { metadata: entry.metadata } : {})
  };
}

function displayMatchLabel(value: DisplayMatch) {
  switch (value) {
    case "explicit": return "Explicit";
    case "inherited": return "Inherited";
    default: return "Default";
  }
}

function routeKindLabel(kind: ChannelRouteKind) {
  switch (kind) {
    case "dm": return "Direct route";
    case "group": return "Group route";
    case "channel": return "Channel route";
    case "topic": return "Topic route";
    case "thread": return "Thread route";
    case "role": return "Role route";
    default: return "Native route";
  }
}
