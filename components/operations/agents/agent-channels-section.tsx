"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, GitBranch, LoaderCircle, MessageCircle, Plus, RefreshCw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import type { ChannelCenterSnapshot } from "@/lib/openclaw/application/channel-center-service";
import type { ChannelRouteKind, ChannelRouteIdentity } from "@/lib/openclaw/domains/channel-center";
import { presentChannelAccountState } from "@/lib/openclaw/domains/channel-account-presentation";
import {
  classifyChannelAccountPollState,
  pollChannelAccount
} from "@/lib/openclaw/domains/channel-account-polling";
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
  description?: string;
  setupMode?: ChannelCenterSnapshot["providers"][number]["setupMode"];
  available?: boolean;
  pluginInstalled?: boolean;
  availabilityReason?: string | null;
  state?: ChannelCenterSnapshot["providers"][number]["state"];
  accounts: Array<{
    accountId: string;
    name?: string | null;
    configured?: boolean;
    enabled?: boolean;
    linked?: boolean;
    running?: boolean;
    connected?: boolean;
    liveStatusAvailable?: boolean;
    authenticationRequired?: boolean;
    healthState?: string | null;
    lastError?: string | null;
    credentialState?: "present" | "missing" | "unknown";
    evidence?: "live-and-config" | "live-only" | "config-only" | "unknown";
  }>;
  capabilities?: {
    supportsTopics?: boolean;
    supportsStart?: boolean;
    supportsTokenSetup?: boolean;
  };
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

export function AgentChannelsSection({
  agentId,
  agentLabel = "this agent",
  workspaceId,
  workspacePath,
  initialProviderId = null,
  surfaceTheme = "dark",
  onRouteChanged
}: {
  agentId: string;
  agentLabel?: string;
  workspaceId: string;
  workspacePath: string;
  initialProviderId?: string | null;
  surfaceTheme?: SurfaceTheme;
  onRouteChanged?: () => Promise<void> | void;
}) {
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
  const [groupDirectoryEntries, setGroupDirectoryEntries] = useState<DirectoryEntry[]>([]);
  const [peerDirectoryEntries, setPeerDirectoryEntries] = useState<DirectoryEntry[]>([]);
  const [topicDirectoryEntries, setTopicDirectoryEntries] = useState<DirectoryEntry[]>([]);
  const [directoryStatus, setDirectoryStatus] = useState<DirectoryResponse["status"] | null>(null);
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  const [mutationKey, setMutationKey] = useState<string | null>(null);
  const [accountName, setAccountName] = useState("");
  const [token, setToken] = useState("");
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [accountAction, setAccountAction] = useState<"setup" | "start" | null>(null);
  const lifecycleControllerRef = useRef<AbortController | null>(null);

  const selectedProvider = providers.find((provider) => provider.id === providerId) ?? null;
  const selectedAccount = selectedProvider?.accounts.find((account) => account.accountId === accountId) ?? null;
  const directoryEntries = routeKind === "groups"
    ? groupDirectoryEntries
    : routeKind === "peers"
      ? peerDirectoryEntries
      : topicDirectoryEntries;
  const groupEntries = useMemo(
    () => groupDirectoryEntries.filter((entry) => entry.kind === "group"),
    [groupDirectoryEntries]
  );
  const selectedAccountPresentation = selectedAccount
    ? presentChannelAccountState(accountStateInput(selectedAccount))
    : null;
  const canCreateTokenAccount = Boolean(
    selectedProvider?.capabilities?.supportsTokenSetup
      && accountName.trim()
      && (selectedProvider.setupMode === "app-tokens" ? botToken.trim() && appToken.trim() : token.trim())
  );

  useEffect(() => {
    return () => lifecycleControllerRef.current?.abort();
  }, []);

  const loadSummary = useCallback(async (): Promise<AgentRouteSummary | null> => {
    setLoadingSummary(true);
    setSummaryError(null);
    try {
      const response = await fetch(`/api/openclaw/channels/agent-routes?agentId=${encodeURIComponent(agentId)}`, { cache: "no-store" });
      const payload = await response.json() as AgentRouteSummary & { error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error ?? "Agent channels are unavailable.");
      setSummary(payload);
      return payload;
    } catch (error) {
      setSummary(null);
      setSummaryError(error instanceof Error ? error.message : "Agent channels are unavailable.");
      return null;
    } finally {
      setLoadingSummary(false);
    }
  }, [agentId]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const loadCenter = useCallback(async (force = false, signal?: AbortSignal): Promise<ChannelCenterSnapshot | null> => {
    if (!force && (providers.length > 0 || centerLoading)) return null;
    setCenterLoading(true);
    try {
      const response = await fetch("/api/openclaw/channels/center", { cache: "no-store", signal });
      const payload = await response.json() as { providers?: CenterProvider[]; error?: string };
      if (!response.ok || payload.error) throw new Error(payload.error ?? "Channel providers are unavailable.");
      const nextProviders = payload.providers ?? [];
      setProviders(nextProviders);
      const nextProvider = (!force ? nextProviders.find((provider) => provider.id === initialProviderId) : null)
        ?? nextProviders.find((provider) => provider.id === providerId)
        ?? nextProviders[0];
      const nextAccount = nextProvider?.accounts.find((account) => account.accountId === accountId)
        ?? nextProvider?.accounts.find((account) => isRouteAccountSelectable(account))
        ?? nextProvider?.accounts[0];
      setProviderId(nextProvider?.id ?? "");
      setAccountId(nextAccount?.accountId ?? "");
      setGroupDirectoryEntries([]);
      setPeerDirectoryEntries([]);
      setTopicDirectoryEntries([]);
      setDirectoryStatus(null);
      setDirectoryError(null);
      return payload as ChannelCenterSnapshot;
    } catch (error) {
      if (isAbortError(error)) return null;
      setDirectoryError(error instanceof Error ? error.message : "Channel providers are unavailable.");
      return null;
    } finally {
      setCenterLoading(false);
    }
  }, [accountId, centerLoading, initialProviderId, providerId, providers.length]);

  const readDirectory = useCallback(async (
    nextKind: "groups" | "peers" | "topics",
    nextGroupId = groupId,
    selectedProviderId = providerId,
    selectedAccountId = accountId,
    signal?: AbortSignal
  ) => {
    if (!selectedProviderId || !selectedAccountId || (nextKind === "topics" && !nextGroupId)) return;
    setLoadingDirectory(true);
    setDirectoryError(null);
    const params = new URLSearchParams({ provider: selectedProviderId, accountId: selectedAccountId, kind: nextKind, limit: "100" });
    if (nextGroupId) params.set("groupId", nextGroupId);
    try {
      const response = await fetch(`/api/openclaw/channels/directory?${params.toString()}`, { cache: "no-store", signal });
      const payload = await response.json() as DirectoryResponse & { error?: string };
      if (!response.ok && !payload.status) throw new Error(payload.error ?? "Channel routes are unavailable.");
      if (nextKind === "groups") {
        setGroupDirectoryEntries(payload.entries ?? []);
      } else if (nextKind === "peers") {
        setPeerDirectoryEntries(payload.entries ?? []);
      } else {
        setTopicDirectoryEntries(payload.entries ?? []);
      }
      setDirectoryStatus(payload.status ?? "failed");
      if (payload.error) setDirectoryError(payload.error);
    } catch (error) {
      if (isAbortError(error)) return;
      if (nextKind === "groups") {
        setGroupDirectoryEntries([]);
      } else if (nextKind === "peers") {
        setPeerDirectoryEntries([]);
      } else {
        setTopicDirectoryEntries([]);
      }
      setDirectoryStatus("failed");
      setDirectoryError(error instanceof Error ? error.message : "Channel routes are unavailable.");
    } finally {
      setLoadingDirectory(false);
    }
  }, [accountId, groupId, providerId]);

  const openAddRoute = () => {
    setAddOpen((current) => !current);
    if (!addOpen) {
      const focusedProvider = initialProviderId ? providers.find((provider) => provider.id === initialProviderId) : null;
      if (focusedProvider) {
        setProviderId(focusedProvider.id);
        setAccountId(focusedProvider.accounts.find((account) => isRouteAccountSelectable(account))?.accountId ?? focusedProvider.accounts[0]?.accountId ?? "");
        setGroupId(null);
        setGroupDirectoryEntries([]);
        setPeerDirectoryEntries([]);
        setTopicDirectoryEntries([]);
      }
      setDirectoryStatus(null);
      setDirectoryError(null);
      void loadCenter();
    }
  };

  useEffect(() => {
    if (!addOpen || !selectedAccount || selectedAccountPresentation?.state !== "ONLINE" || loadingDirectory || directoryStatus) return;
    void readDirectory(routeKind, groupId);
  }, [addOpen, directoryStatus, groupId, loadingDirectory, readDirectory, routeKind, selectedAccount, selectedAccountPresentation?.state]);

  const chooseProvider = (nextProviderId: string) => {
    const nextProvider = providers.find((provider) => provider.id === nextProviderId);
    setProviderId(nextProviderId);
    setAccountId(nextProvider?.accounts.find((account) => isRouteAccountSelectable(account))?.accountId ?? nextProvider?.accounts[0]?.accountId ?? "");
    setRouteKind("groups");
    setGroupId(null);
    setAccountName("");
    setToken("");
    setBotToken("");
    setAppToken("");
    setGroupDirectoryEntries([]);
    setPeerDirectoryEntries([]);
    setTopicDirectoryEntries([]);
    setDirectoryStatus(null);
    setDirectoryError(null);
  };

  const chooseAccount = (nextAccountId: string) => {
    setAccountId(nextAccountId);
    setGroupId(null);
    setDirectoryStatus(null);
    setDirectoryError(null);
    setGroupDirectoryEntries([]);
    setPeerDirectoryEntries([]);
    setTopicDirectoryEntries([]);
    setDirectoryStatus(null);
    setDirectoryError(null);
  };

  const readAccount = useCallback(async (nextProviderId: string, nextAccountId: string, signal?: AbortSignal) => {
    const center = await loadCenter(true, signal);
    const provider = center?.providers.find((entry) => entry.id === nextProviderId) ?? null;
    const account = provider?.accounts.find((entry) => entry.accountId === nextAccountId) ?? null;
    return {
      center,
      provider,
      account,
      presentation: account ? presentChannelAccountState(accountStateInput(account), { statusError: center?.statusError }) : null
    };
  }, [loadCenter]);

  const startAndDiscover = useCallback(async (
    nextProviderId: string,
    nextAccountId: string,
    shouldStart = true,
    existingController?: AbortController
  ) => {
    const provider = providers.find((entry) => entry.id === nextProviderId);
    if (!provider) return;

    if (!existingController) {
      lifecycleControllerRef.current?.abort();
    }
    const controller = existingController ?? new AbortController();
    lifecycleControllerRef.current = controller;
    setAccountAction("start");
    setDirectoryError(null);
    try {
      if (shouldStart) {
        const startResponse = await fetch("/api/openclaw/channels/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start", provider: nextProviderId, accountId: nextAccountId }),
          signal: controller.signal
        });
        const startPayload = await startResponse.json().catch(() => null) as { error?: string } | null;
        if (!startResponse.ok) throw new Error(startPayload?.error ?? `${provider.label} could not be started.`);
      }

      const polled = await pollChannelAccount({
        signal: controller.signal,
        read: () => readAccount(nextProviderId, nextAccountId, controller.signal),
        classify: (value) => classifyChannelAccountPollState({
          operation: "start",
          state: value.presentation?.state
        })
      });
      const finalState = polled.value;

      if (polled.classification !== "SUCCESS" || !finalState.account || finalState.presentation?.state !== "ONLINE") {
        throw new Error(polled.timedOut
          ? `${provider.label} did not come online within the expected time. Current state: ${finalState.presentation?.label ?? "Status unavailable"}.`
          : finalState.presentation?.detail ?? `${provider.label} did not become usable.`);
      }

      setProviderId(nextProviderId);
      setAccountId(nextAccountId);
      setDirectoryStatus(null);
      await readDirectory("groups", null, nextProviderId, nextAccountId, controller.signal);
    } catch (error) {
      if (!isAbortError(error)) setDirectoryError(error instanceof Error ? error.message : `${provider.label} could not be started.`);
    } finally {
      if (lifecycleControllerRef.current === controller) lifecycleControllerRef.current = null;
      setAccountAction(null);
    }
  }, [providers, readAccount, readDirectory]);

  useEffect(() => {
    if (!addOpen || !selectedAccount || selectedAccountPresentation?.state !== "STARTING" || accountAction) return;
    void startAndDiscover(providerId, accountId, false);
  }, [accountAction, accountId, addOpen, providerId, selectedAccount, selectedAccountPresentation?.state, startAndDiscover]);

  const createAccountAndContinue = useCallback(async () => {
    if (!selectedProvider || !canCreateTokenAccount) return;

    lifecycleControllerRef.current?.abort();
    const controller = new AbortController();
    lifecycleControllerRef.current = controller;
    setAccountAction("setup");
    setDirectoryError(null);
    try {
      const body: Record<string, unknown> = {
        type: selectedProvider.id,
        name: accountName.trim(),
        workspacePath,
        ...(selectedProvider.setupMode === "app-tokens"
          ? { botToken: botToken.trim(), appToken: appToken.trim() }
          : { token: token.trim() })
      };
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => null) as { error?: string; account?: { id?: string; accountId?: string; name?: string } } | null;
      if (!response.ok) throw new Error(payload?.error ?? `${selectedProvider.label} account setup failed.`);

      const accountIdFromResponse = payload?.account?.accountId?.trim() || payload?.account?.id?.trim();
      const configuredAccountName = payload?.account?.name ?? accountName.trim();
      const verifiedPoll = await pollChannelAccount({
        signal: controller.signal,
        read: async () => {
          const center = await loadCenter(true, controller.signal);
          const provider = center?.providers.find((entry) => entry.id === selectedProvider.id) ?? null;
          const account = provider?.accounts.find((entry) => (
            (accountIdFromResponse && entry.accountId === accountIdFromResponse)
              || entry.name === configuredAccountName
          )) ?? null;
          return {
            center,
            provider,
            account,
            presentation: account ? presentChannelAccountState(accountStateInput(account), { statusError: center?.statusError }) : null
          };
        },
          classify: (value) => value.account
            ? classifyChannelAccountPollState({ operation: "post-create", state: value.presentation?.state })
            : "RETRY"
      });
      const verified = verifiedPoll.value;
      const verifiedAccount = verified.account;
      if (!verified.provider || !verifiedAccount) {
        throw new Error(verifiedPoll.timedOut
          ? `${selectedProvider.label} was saved, but OpenClaw did not return a verifiable account state within the expected time.`
          : `${selectedProvider.label} was saved, but OpenClaw did not return a verifiable account state.`);
      }

      setProviderId(selectedProvider.id);
      setAccountId(verifiedAccount.accountId);
      setAccountName("");
      setToken("");
      setBotToken("");
      setAppToken("");

      const presentation = presentChannelAccountState(accountStateInput(verifiedAccount), { statusError: verified.center?.statusError });
      if (presentation.state === "ONLINE") {
        setDirectoryStatus(null);
        await readDirectory("groups", null, selectedProvider.id, verifiedAccount.accountId, controller.signal);
      } else if ((presentation.state === "READY" || presentation.state === "STOPPED") && selectedProvider.capabilities?.supportsStart) {
        await startAndDiscover(selectedProvider.id, verifiedAccount.accountId, true, controller);
      } else if (verifiedPoll.timedOut) {
        throw new Error(`${selectedProvider.label} did not come online within the expected time. Current state: ${presentation.label}.`);
      } else {
        throw new Error(`${selectedProvider.label} is not ready: ${presentation.detail}`);
      }
    } catch (error) {
      if (!isAbortError(error)) setDirectoryError(error instanceof Error ? error.message : `${selectedProvider.label} account setup failed.`);
    } finally {
      if (lifecycleControllerRef.current === controller) lifecycleControllerRef.current = null;
      setAccountAction(null);
    }
  }, [accountName, appToken, botToken, canCreateTokenAccount, loadCenter, readDirectory, selectedProvider, startAndDiscover, token, workspaceId, workspacePath]);

  const openControlUi = useCallback(async () => {
    try {
      const response = await fetch("/api/openclaw/dashboard", { method: "POST", cache: "no-store" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to open the OpenClaw Control UI.");
      toast.info("Complete account setup in OpenClaw, then return here.");
    } catch (error) {
      toast.error("OpenClaw setup could not be opened.", { description: error instanceof Error ? error.message : "Try again from Channel Center." });
    }
  }, []);

  const mutateRoute = async (route: ChannelRouteIdentity, nextAgentId: string | null, successMessage: string) => {
    const key = `${route.provider}:${route.accountId}:${route.kind}:${route.parentRouteId ?? ""}:${route.routeId}`;
    setMutationKey(key);
    try {
      const response = await fetch("/api/openclaw/channels/route-binding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...route, agentId: nextAgentId })
      });
      const payload = await response.json() as {
        error?: string;
        pending?: boolean;
        applyMode?: string;
        verification?: {
          verified?: boolean;
          effectiveAgentId?: string | null;
          explicitAgentId?: string | null;
        };
      };
      if (!response.ok || payload.error) throw new Error(payload.error ?? "The channel could not be connected.");
      const nextSummary = await loadSummary();
      const verified = payload.verification?.verified === true;
      const pending = payload.pending || payload.applyMode === "pending";
      if (verified) {
        toast.success(successMessage, {
          description: "OpenClaw confirmed the native route for this agent."
        });
      } else if (pending) {
        toast.warning(nextAgentId ? "Connection pending verification." : "Route removal pending verification.", {
          description: "OpenClaw accepted the change, but the live route state has not caught up yet. Refresh to confirm it."
        });
      } else {
        const effectiveAgentId = payload.verification?.effectiveAgentId ?? nextSummary?.routes.find((entry) => entry.route && channelRouteMatches(entry.route, route))?.effectiveAgentId ?? null;
        toast.error(nextAgentId ? "Couldn’t finish connecting this route." : "Couldn’t finish removing this route.", {
          description: effectiveAgentId
            ? `OpenClaw still resolves this route to another agent (${effectiveAgentId}).`
            : "OpenClaw accepted the change, but the canonical route state did not confirm it."
        });
      }
      if (addOpen && providerId && accountId) await readDirectory(routeKind, groupId);
      await onRouteChanged?.();
    } catch (error) {
      toast.error("Channel connection failed.", { description: error instanceof Error ? error.message : "The channel could not be updated." });
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
            <p className="text-sm font-medium">Channels</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Connect real groups, servers, and channels to this agent. Connections are verified against the live messaging runtime.</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => void loadSummary()} disabled={loadingSummary || Boolean(mutationKey)}><RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loadingSummary && "animate-spin")} />Refresh</Button>
          <Button type="button" size="sm" className="h-8 rounded-lg px-2.5 text-xs" onClick={openAddRoute} disabled={Boolean(mutationKey) || Boolean(accountAction)}><Plus className="mr-1.5 h-3.5 w-3.5" />Connect channel</Button>
        </div>
      </div>

      {summaryError ? <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs leading-5 text-amber-800 dark:text-amber-100" role="alert">{summaryError}</div> : null}
      {summary?.diagnostics?.topicConfig === "unavailable" ? <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs leading-5 text-amber-800 dark:text-amber-100">Telegram topic state could not be read. Group and account bindings remain visible; refresh after OpenClaw is available.</div> : null}
      {loadingSummary ? <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-3 text-xs text-muted-foreground"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Reading OpenClaw route state…</div> : null}
      {showSummaryEmpty ? <div className="rounded-xl border border-dashed border-border px-3 py-4 text-xs leading-5 text-muted-foreground">No channels are connected yet. Connect a group or channel to send its messages to this agent.</div> : null}

      {summary?.routes.length ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {summary.routes.map((route) => <RouteCard key={route.id} route={route} mutationKey={mutationKey} onRemove={() => route.route && void mutateRoute(route.route, null, "Channel disconnected.")} onOverride={() => route.route && void mutateRoute(route.route, agentId, "Channel connected.")} />)}
        </div>
      ) : null}

      {addOpen ? (
        <div className="rounded-2xl border border-primary/20 bg-primary/[0.03] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">Connect a channel</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">Choose an account, then discover the real groups and channels it can receive.</p>
            </div>
            {centerLoading ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
          </div>

          {providers.length > 0 ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5 text-xs font-medium"><span>Provider</span><select value={providerId} onChange={(event) => chooseProvider(event.target.value)} disabled={Boolean(accountAction)} className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"><option value="">Choose provider</option>{providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label} · {providerHumanState(provider)}</option>)}</select></label>
              <label className="space-y-1.5 text-xs font-medium"><span>Account</span><select value={accountId} onChange={(event) => chooseAccount(event.target.value)} disabled={!selectedProvider || Boolean(accountAction)} className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"><option value="">Choose account</option>{selectedProvider?.accounts.map((account) => { const presentation = presentChannelAccountState(accountStateInput(account)); return <option key={account.accountId} value={account.accountId}>{account.name || account.accountId} · {presentation.label}</option>; })}</select></label>
              <label className="space-y-1.5 text-xs font-medium"><span>Route type</span><select value={routeKind} onChange={(event) => { const nextKind = event.target.value as "groups" | "peers" | "topics"; setRouteKind(nextKind); setDirectoryStatus(null); setDirectoryError(null); if (nextKind === "topics" && groupId) void readDirectory(nextKind, groupId); }} disabled={!selectedAccount} className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"><option value="groups">Groups and servers</option><option value="peers">Direct routes</option>{selectedProvider?.id === "telegram" && selectedProvider.capabilities?.supportsTopics ? <option value="topics">Telegram topics</option> : null}</select></label>
              {routeKind === "topics" ? <label className="space-y-1.5 text-xs font-medium"><span>Parent group</span><select value={groupId ?? ""} onChange={(event) => { setGroupId(event.target.value || null); if (event.target.value) void readDirectory("topics", event.target.value); }} disabled={groupEntries.length === 0} className="h-9 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground"><option value="">Choose group</option>{groupEntries.map((entry) => <option key={entry.routeId} value={entry.routeId}>{entry.title || entry.handle || "Telegram group"}</option>)}</select></label> : null}
            </div>
          ) : centerLoading ? null : <p className="mt-4 rounded-xl border border-dashed border-border px-3 py-3 text-xs leading-5 text-muted-foreground">No usable messaging accounts are available yet. Choose a provider below to continue setup.</p>}

          {selectedProvider && selectedAccount && selectedAccountPresentation ? (
            <div className="mt-4 rounded-xl border border-border bg-background/70 p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-medium">{selectedProvider.label} · {selectedAccount.name}</p><Badge variant="muted" className="h-5 rounded-full px-2 text-[9px]">{selectedAccountPresentation.label}</Badge></div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{selectedAccountPresentation.detail}</p>
                </div>
                {(selectedAccountPresentation.state === "READY" || selectedAccountPresentation.state === "STOPPED") && selectedProvider.capabilities?.supportsStart ? <Button type="button" size="sm" className="h-8 shrink-0 rounded-lg px-3 text-xs" onClick={() => void startAndDiscover(selectedProvider.id, selectedAccount.accountId)} disabled={Boolean(accountAction)}>{accountAction === "start" ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}{accountAction === "start" ? "Starting…" : "Start and continue"}</Button> : null}
                {selectedAccountPresentation.state === "STARTING" ? <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary/10 px-3 text-xs text-primary"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Starting…</span> : null}
                {selectedAccountPresentation.state === "STATUS_UNAVAILABLE" ? <Button type="button" variant="secondary" size="sm" className="h-8 shrink-0 rounded-lg px-3 text-xs" onClick={() => void loadCenter(true)} disabled={Boolean(accountAction)}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh status</Button> : null}
              </div>
              {(selectedAccountPresentation.state === "NEEDS_SETUP" || selectedAccountPresentation.state === "NEEDS_ATTENTION") && selectedProvider.capabilities?.supportsTokenSetup ? <InlineAccountSetup provider={selectedProvider} accountName={accountName} token={token} botToken={botToken} appToken={appToken} onAccountNameChange={setAccountName} onTokenChange={setToken} onBotTokenChange={setBotToken} onAppTokenChange={setAppToken} onSubmit={() => void createAccountAndContinue()} saving={accountAction === "setup"} canSubmit={canCreateTokenAccount} /> : null}
              {(selectedAccountPresentation.state === "NEEDS_SETUP" || selectedAccountPresentation.state === "NEEDS_ATTENTION") && !selectedProvider.capabilities?.supportsTokenSetup ? <Button type="button" variant="secondary" size="sm" className="mt-3 h-8 rounded-lg px-3 text-xs" onClick={() => void openControlUi()}><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Complete setup in OpenClaw</Button> : null}
            </div>
          ) : selectedProvider?.capabilities?.supportsTokenSetup ? <InlineAccountSetup provider={selectedProvider} accountName={accountName} token={token} botToken={botToken} appToken={appToken} onAccountNameChange={setAccountName} onTokenChange={setToken} onBotTokenChange={setBotToken} onAppTokenChange={setAppToken} onSubmit={() => void createAccountAndContinue()} saving={accountAction === "setup"} canSubmit={canCreateTokenAccount} /> : selectedProvider?.setupMode === "qr" ? <div className="mt-3 rounded-xl border border-border bg-background/70 p-3"><p className="text-xs leading-5 text-muted-foreground">OpenClaw will show the native QR flow for this provider. Return here after the account is linked so route discovery can continue.</p><Button type="button" variant="secondary" size="sm" className="mt-3 h-8 rounded-lg px-3 text-xs" onClick={() => void openControlUi()}><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Start QR setup in OpenClaw</Button></div> : selectedProvider ? <div className="mt-3 rounded-xl border border-border bg-background/70 p-3"><p className="text-xs leading-5 text-muted-foreground">This provider needs an external OpenClaw setup before its account can be used here.</p><Button type="button" variant="secondary" size="sm" className="mt-3 h-8 rounded-lg px-3 text-xs" onClick={() => void openControlUi()}><ExternalLink className="mr-1.5 h-3.5 w-3.5" />Complete setup in OpenClaw</Button></div> : null}

          {providers.length > 0 && selectedAccount && isRouteAccountSelectable(selectedAccount) ? <Button type="button" variant="ghost" size="sm" className="mt-3 h-8 rounded-lg px-2.5 text-xs" onClick={() => void readDirectory(routeKind, groupId)} disabled={loadingDirectory || Boolean(accountAction) || (routeKind === "topics" && !groupId)}>{loadingDirectory ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Refresh routes</Button> : null}
          {directoryError ? <p className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-3 py-2.5 text-xs leading-5 text-amber-800 dark:text-amber-100">{directoryError}</p> : null}
          {directoryStatus === "unsupported" ? <p className="mt-3 rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-xs leading-5 text-muted-foreground">This provider does not expose channel discovery here. Complete discovery in the OpenClaw Control UI, then return with the channel details.</p> : null}
          {directoryStatus === "empty" && !loadingDirectory ? <p className="mt-3 rounded-xl border border-dashed border-border px-3 py-3 text-xs leading-5 text-muted-foreground">{emptyDirectoryMessage(selectedProvider?.id, routeKind, selectedAccount?.name)}</p> : null}
          {directoryEntries.length > 0 ? <div className="mt-3 space-y-2">{directoryEntries.map((entry) => <DirectoryRouteCard key={`${entry.kind}:${entry.parentRouteId ?? ""}:${entry.routeId}`} entry={entry} agentId={agentId} agentLabel={agentLabel} mutationKey={mutationKey} onRoute={() => void mutateRoute(toRouteIdentity(providerId, entry), agentId, `${entry.title || routeKindLabel(entry.kind)} now sends messages to ${agentLabel}.`)} />)}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function channelRouteMatches(left: ChannelRouteIdentity, right: ChannelRouteIdentity) {
  return left.provider === right.provider
    && left.accountId === right.accountId
    && left.kind === right.kind
    && left.routeId === right.routeId
    && left.parentRouteId === right.parentRouteId;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function accountStateInput(account: CenterProvider["accounts"][number]) {
  return {
    accountId: account.accountId,
    configured: account.configured === true,
    enabled: account.enabled !== false,
    linked: account.linked === true,
    running: account.running === true,
    connected: account.connected === true,
    liveStatusAvailable: account.liveStatusAvailable === true,
    authenticationRequired: account.authenticationRequired === true,
    lastError: account.lastError ?? null,
    healthState: account.healthState ?? null,
    credentialState: account.credentialState
  };
}

function isRouteAccountSelectable(account: CenterProvider["accounts"][number]) {
  const state = presentChannelAccountState(accountStateInput(account)).state;
  return state === "ONLINE" || state === "READY" || state === "STOPPED";
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

function InlineAccountSetup({
  provider,
  accountName,
  token,
  botToken,
  appToken,
  onAccountNameChange,
  onTokenChange,
  onBotTokenChange,
  onAppTokenChange,
  onSubmit,
  saving,
  canSubmit
}: {
  provider: CenterProvider;
  accountName: string;
  token: string;
  botToken: string;
  appToken: string;
  onAccountNameChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onBotTokenChange: (value: string) => void;
  onAppTokenChange: (value: string) => void;
  onSubmit: () => void;
  saving: boolean;
  canSubmit: boolean;
}) {
  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="text-xs font-medium">Connect a new {provider.label} account</p>
      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">Credentials are sent to OpenClaw, then the account is verified and started before route discovery.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5 text-xs font-medium"><span>Account name</span><Input value={accountName} onChange={(event) => onAccountNameChange(event.target.value)} placeholder={`${provider.label} account`} autoComplete="off" disabled={saving} /></label>
        {provider.setupMode === "app-tokens" ? <>
          <label className="space-y-1.5 text-xs font-medium"><span>Bot token</span><Input type="password" value={botToken} onChange={(event) => onBotTokenChange(event.target.value)} autoComplete="off" disabled={saving} /></label>
          <label className="space-y-1.5 text-xs font-medium"><span>App token</span><Input type="password" value={appToken} onChange={(event) => onAppTokenChange(event.target.value)} autoComplete="off" disabled={saving} /></label>
        </> : <label className="space-y-1.5 text-xs font-medium"><span>Bot token</span><Input type="password" value={token} onChange={(event) => onTokenChange(event.target.value)} autoComplete="off" placeholder="Paste the token" disabled={saving} /></label>}
      </div>
      <Button type="button" className="mt-3 h-8 rounded-lg px-3 text-xs" onClick={onSubmit} disabled={!canSubmit || saving}>{saving ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}{saving ? "Connecting…" : "Connect account and continue"}</Button>
    </div>
  );
}

function providerHumanState(provider: CenterProvider) {
  if (provider.state?.availability === "not-installed" || provider.pluginInstalled === false && provider.accounts.length === 0) return "Not installed";
  if (provider.state?.availability === "degraded" || provider.state?.availability === "unknown") return "Unavailable";
  if (provider.accounts.length === 0) return provider.capabilities?.supportsTokenSetup || provider.setupMode === "qr" ? "Needs setup" : "Unavailable";
  const states = provider.accounts.map((account) => presentChannelAccountState(accountStateInput(account)).state);
  if (states.includes("ONLINE")) return "Online";
  if (states.includes("STARTING")) return "Starting";
  if (states.includes("READY") || states.includes("STOPPED")) return "Ready";
  if (states.includes("NEEDS_SETUP")) return "Needs setup";
  if (states.includes("NEEDS_ATTENTION")) return "Needs attention";
  return "Status unavailable";
}

function emptyDirectoryMessage(providerId: string | undefined, routeKind: "groups" | "peers" | "topics", accountName?: string | null) {
  if (routeKind === "topics") return "No topics found. Add topics to the selected group, then refresh.";
  switch (providerId) {
    case "telegram":
      return `No groups found. Add ${accountName || "this account"} to a Telegram group, then refresh.`;
    case "discord":
      return "No servers or channels found. Add the bot to a Discord server, then refresh.";
    case "slack":
      return "No channels found. Add the app to a Slack workspace, then refresh.";
    case "whatsapp":
      return "No groups or chats found. Link the account to a WhatsApp group, then refresh.";
    default:
      return "No groups or channels found. Add the account to a supported group or channel, then refresh.";
  }
}

function DirectoryRouteCard({ entry, agentId, agentLabel, mutationKey, onRoute }: { entry: DirectoryEntry; agentId: string; agentLabel: string; mutationKey: string | null; onRoute: () => void }) {
  const effectiveForAgent = entry.agentId === agentId;
  const canEdit = entry.kind !== "peer" && entry.kind !== "thread";
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-background/65 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0"><p className="truncate text-xs font-medium">{entry.title || entry.handle || routeKindLabel(entry.kind)}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{routeKindLabel(entry.kind)}{entry.bindingMatch === "inherited" ? " · inherited" : entry.bindingMatch === "fallback" ? " · OpenClaw default" : ""}</p></div>
      <Button type="button" size="sm" variant={effectiveForAgent ? "secondary" : "default"} className="h-7 shrink-0 rounded-lg px-2.5 text-[10px]" onClick={onRoute} disabled={effectiveForAgent || !canEdit || entry.bindingEditingAmbiguous || Boolean(mutationKey)}>{effectiveForAgent ? "Connected" : canEdit ? `Connect to ${agentLabel}` : "OpenClaw only"}</Button>
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
