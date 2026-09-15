"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Hash,
  Loader2,
  LogOut,
  MessageCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  Square,
  Users
} from "lucide-react";

import { ChannelCenterAddAccountDialog } from "@/components/operations/channels/channel-center-add-account-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type { ChannelCenterSnapshot, ChannelCenterProvider } from "@/lib/openclaw/application/channel-center-service";
import {
  EmptyState,
  EntityIcon,
  KeyValue,
  OperationsPageLayout,
  PageHeader,
  SectionCard,
  StatusBadge
} from "@/components/operations/operations-ui";
import { cn } from "@/lib/utils";

type DirectoryEntry = {
  routeId: string;
  kind: "dm" | "group" | "channel" | "thread" | "topic" | "role" | "peer";
  accountId: string;
  parentRouteId: string | null;
  title: string | null;
  handle: string | null;
  memberCount: number | null;
  metadata: Record<string, unknown>;
  agentId: string | null;
  bindingSource: "openclaw" | "agentos-compatibility" | null;
  bindingMatch: "exact" | "inherited" | "fallback" | "shadowed" | "overlapping" | "ambiguous-edit" | "none" | "conflict" | null;
  bindingConflict: boolean;
  bindingEditingAmbiguous: boolean;
  inheritedFrom: { routeId: string; kind: string; title?: string | null } | null;
  shadowedBindingCount: number;
  accessPolicy: {
    enabled: boolean | null;
    groupPolicy: string | null;
    allowFrom: string[];
    requireMention: boolean | null;
  } | null;
};

type DirectoryResponse = {
  entries: DirectoryEntry[];
  status: "ok" | "empty" | "unsupported" | "failed";
  source: string;
  fallbackReason: string | null;
  error: string | null;
};

export function ChannelCenterPageContent({
  rootSnapshot,
  activeWorkspaceId,
  refresh,
}: {
  rootSnapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  refresh: () => Promise<void>;
}) {
  const [center, setCenter] = useState<ChannelCenterSnapshot | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [groups, setGroups] = useState<DirectoryEntry[]>([]);
  const [topics, setTopics] = useState<DirectoryEntry[]>([]);
  const [members, setMembers] = useState<DirectoryEntry[]>([]);
  const [selectedRouteKey, setSelectedRouteKey] = useState<string | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [loadingCenter, setLoadingCenter] = useState(true);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [loadingTopics, setLoadingTopics] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [isConnectDialogOpen, setIsConnectDialogOpen] = useState(false);

  const loadCenter = useCallback(async () => {
    setLoadingCenter(true);
    try {
      const response = await fetch("/api/openclaw/channels/center", { cache: "no-store" });
      const payload = await response.json() as ChannelCenterSnapshot & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Channel inventory is unavailable.");
      setCenter(payload);
    } catch (error) {
      setCenter(null);
      toast.error(error instanceof Error ? error.message : "Channel inventory is unavailable.");
    } finally {
      setLoadingCenter(false);
    }
  }, []);

  useEffect(() => {
    void loadCenter();
  }, [loadCenter]);

  const providers = useMemo(() => center?.providers ?? [], [center]);
  const selectedProvider = useMemo(() => providers.find((provider) => provider.id === selectedProviderId) ?? providers[0] ?? null, [providers, selectedProviderId]);
  const accounts = useMemo(() => selectedProvider?.accounts ?? [], [selectedProvider]);
  const selectedAccount = accounts.find((account) => account.accountId === selectedAccountId) ?? accounts[0] ?? null;
  const selectedGroup = groups.find((route) => routeSelectionKey(route) === selectedRouteKey) ?? null;
  const selectedTopic = topics.find((route) => route.routeId === selectedTopicId) ?? null;
  const selectedRoute = selectedTopic ?? selectedGroup;
  const currentAgentId = selectedTopic?.agentId ?? selectedGroup?.agentId ?? null;

  useEffect(() => {
    if (!selectedProviderId && providers[0]) setSelectedProviderId(providers[0].id);
    if (selectedProviderId && !providers.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(providers[0]?.id ?? null);
    }
  }, [providers, selectedProviderId]);

  useEffect(() => {
    const requestedProvider = new URLSearchParams(window.location.search).get("provider");
    if (requestedProvider && providers.some((provider) => provider.id === requestedProvider)) {
      setSelectedProviderId(requestedProvider);
    }
  }, [providers]);

  useEffect(() => {
    setSelectedAccountId(selectedProvider?.accounts[0]?.accountId ?? null);
    setSelectedRouteKey(null);
    setSelectedTopicId(null);
    setGroups([]);
    setTopics([]);
    setMembers([]);
  }, [selectedProvider?.id, selectedProvider?.accounts]);

  useEffect(() => {
    if (selectedAccountId && !accounts.some((account) => account.accountId === selectedAccountId)) {
      setSelectedAccountId(accounts[0]?.accountId ?? null);
    }
  }, [accounts, selectedAccountId]);

  const loadRoutes = useCallback(async () => {
    if (!selectedProvider || !selectedAccount) return;
    setLoadingRoutes(true);
    setRouteError(null);
    try {
      const groupPayload = await readDirectory(selectedProvider.id, selectedAccount.accountId, "groups", undefined, activeWorkspaceId);
      const peerPayload = selectedProvider.capabilities.supportsDirectoryPeers
        ? await readDirectory(selectedProvider.id, selectedAccount.accountId, "peers", undefined, activeWorkspaceId)
        : null;
      const entries = mergeDirectoryEntries([...(groupPayload.entries ?? []), ...(peerPayload?.entries ?? [])]);
      setGroups(entries);
      const payload = { ...groupPayload, entries };
      if (payload.status === "failed" || payload.status === "unsupported") {
        setRouteError(payload.error ?? payload.fallbackReason ?? `${routeCollectionLabel(selectedProvider.id)} are not available for this provider.`);
      }
      setSelectedRouteKey((current) => payload.entries.some((entry) => routeSelectionKey(entry) === current) ? current : payload.entries[0] ? routeSelectionKey(payload.entries[0]) : null);
    } catch (error) {
      setGroups([]);
      setRouteError(error instanceof Error ? error.message : "Groups are unavailable.");
    } finally {
      setLoadingRoutes(false);
    }
  }, [activeWorkspaceId, selectedAccount, selectedProvider]);

  useEffect(() => {
    void loadRoutes();
  }, [loadRoutes]);

  const loadTopics = useCallback(async () => {
    if (!selectedProvider?.capabilities.supportsTopics || selectedProvider.id !== "telegram" || !selectedAccount || !selectedGroup || selectedGroup.kind !== "group") {
      setTopics([]);
      return;
    }
    setLoadingTopics(true);
    try {
      const payload = await readDirectory("telegram", selectedAccount.accountId, "topics", selectedGroup.routeId, activeWorkspaceId);
      setTopics(payload.entries);
      setSelectedTopicId((current) => payload.entries.some((entry) => entry.routeId === current) ? current : null);
    } catch {
      setTopics([]);
    } finally {
      setLoadingTopics(false);
    }
  }, [activeWorkspaceId, selectedAccount, selectedGroup, selectedProvider?.capabilities.supportsTopics, selectedProvider?.id]);

  useEffect(() => {
    void loadTopics();
  }, [loadTopics]);

  const runAccountAction = async (action: "start" | "stop" | "restart" | "logout") => {
    if (!selectedProvider || !selectedAccount || !canRunAccountAction(selectedProvider, action)) return;
    if (action === "logout" && !window.confirm(`Log out the ${selectedAccount.name} account from OpenClaw?`)) return;
    const key = `${action}:${selectedProvider.id}:${selectedAccount.accountId}`;
    setActionKey(key);
    try {
      const response = await fetch("/api/openclaw/channels/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, provider: selectedProvider.id, accountId: selectedAccount.accountId })
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `Could not ${action} the account.`);
      toast.success(action === "logout" ? "Account logged out." : `Account ${action} request accepted.`);
      await loadCenter();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not ${action} the account.`);
    } finally {
      setActionKey(null);
    }
  };

  const updateGroupAgent = async (agentId: string | null) => {
    if (!selectedGroup || !selectedProvider || !selectedAccount) {
      toast.message("Select an account and route before assigning an agent.");
      return;
    }
    await runRouteBindingMutation({
      provider: selectedProvider.id,
      accountId: selectedAccount.accountId,
      kind: selectedGroup.kind,
      routeId: selectedGroup.routeId,
      parentRouteId: selectedGroup.parentRouteId,
      agentId
    }, "Group agent updated.");
  };

  const updateTopicAgent = async (agentId: string | null) => {
    if (!selectedGroup || !selectedTopic || !selectedAccount) return;
    await runRouteBindingMutation({
      provider: "telegram",
      accountId: selectedAccount.accountId,
      kind: "topic",
      routeId: selectedTopic.routeId,
      parentRouteId: selectedGroup.routeId,
      agentId
    }, "Topic agent updated.");
  };

  const runPolicyMutation = async (
    patch: Record<string, unknown>,
    successMessage: string
  ) => {
    if (!selectedAccount || !selectedProvider || !selectedRoute) return;
    const route = selectedRoute;
    await runMutation("/api/openclaw/channels/route-policy", {
      provider: selectedProvider.id,
      accountId: selectedAccount.accountId,
      kind: route.kind,
      routeId: route.routeId,
      parentRouteId: route.parentRouteId,
      patch
    }, successMessage, async () => {
      await loadRoutes();
      await loadTopics();
    });
  };

  const runRouteBindingMutation = async (body: {
    provider: string;
    accountId: string;
    kind: DirectoryEntry["kind"];
    routeId: string;
    parentRouteId: string | null;
    agentId: string | null;
  }, successMessage: string) => {
    await runMutation("/api/openclaw/channels/route-binding", body, successMessage, async () => {
      await loadRoutes();
      await loadTopics();
    });
  };

  const openControlUi = async () => {
    setActionKey("open-control-ui");
    try {
      const response = await fetch("/api/openclaw/dashboard", { method: "POST", cache: "no-store" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to open the OpenClaw Control UI.");
      toast.success("OpenClaw Control UI opened.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to open the OpenClaw Control UI.");
    } finally {
      setActionKey(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Channels"
        subtitle="Manage OpenClaw providers, accounts, routes, access, and agent handoff from one place."
        actions={
          <>
            <Button variant="secondary" size="sm" className="h-11 rounded-xl px-3 text-xs sm:h-8 sm:rounded-lg" onClick={() => setIsConnectDialogOpen(true)}>
              Add account
            </Button>
            <Button size="sm" className="h-11 rounded-xl px-3 text-xs sm:h-8 sm:rounded-lg" onClick={() => void loadCenter()} disabled={loadingCenter}>
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loadingCenter && "animate-spin")} />
              Refresh
            </Button>
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={center?.gatewayAvailable ? "Gateway available" : "Gateway unavailable"} tone={center?.gatewayAvailable ? "success" : "warning"} />
          {center?.statusError ? <StatusBadge label="Status degraded" tone="warning" /> : null}
          <span className="text-[0.64rem] text-muted-foreground">OpenClaw runtime inventory</span>
        </div>
      </PageHeader>

      <OperationsPageLayout
        main={
          <>
            <SectionCard title="Providers">
              {loadingCenter && !center ? (
                <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading OpenClaw providers…</div>
              ) : providers.length === 0 ? (
                <EmptyState title="No channel providers found" description="OpenClaw has not reported any channel provider or account yet." />
              ) : (
                <div className="grid gap-2 p-2 sm:grid-cols-2 xl:grid-cols-3">
                  {providers.map((provider) => <ProviderCard key={provider.id} provider={provider} selected={provider.id === selectedProvider?.id} onClick={() => setSelectedProviderId(provider.id)} />)}
                </div>
              )}
            </SectionCard>

            {selectedProvider ? (
              <SectionCard
                title={selectedProvider.label}
                action={<StatusBadge label={`${accounts.length} account${accounts.length === 1 ? "" : "s"}`} tone="info" />}
              >
                <div className="grid gap-3 p-3 xl:grid-cols-[260px_minmax(0,1fr)]">
                  <div className="space-y-2">
                    {accounts.length === 0 ? (
                      <EmptyState title="No accounts" description="Add an OpenClaw account to manage routes for this provider." />
                    ) : accounts.map((account) => (
                      <button
                        key={account.accountId}
                        type="button"
                        onClick={() => { setSelectedAccountId(account.accountId); setSelectedRouteKey(null); setSelectedTopicId(null); }}
                        className={cn("flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors", account.accountId === selectedAccount?.accountId ? "border-primary/40 bg-primary/10" : "border-border bg-card/50 hover:bg-accent/60")}
                      >
                        <span className="flex min-w-0 items-center gap-2.5"><EntityIcon label={selectedProvider.label} size="sm" /><span className="min-w-0"><span className="block truncate text-xs font-semibold text-foreground">{account.name}</span><span className="block truncate font-mono text-[0.62rem] text-muted-foreground">{account.accountId}</span></span></span>
                        <StatusBadge label={accountStatus(account)} tone={accountTone(account)} />
                      </button>
                    ))}
                  </div>

                  <div className="min-w-0">
                    {selectedAccount ? <AccountPanel provider={selectedProvider} account={selectedAccount} actionKey={actionKey} onAction={runAccountAction} onOpenControlUi={openControlUi} /> : <EmptyState title="Select an account" description="Choose an account to inspect its routes." />}
                  </div>
                </div>
              </SectionCard>
            ) : null}

            {selectedProvider && selectedAccount ? (
              <SectionCard
                title={routeCollectionLabel(selectedProvider.id)}
                action={loadingRoutes ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : <span className="text-[0.64rem] text-muted-foreground">{groups.length} discovered</span>}
              >
                {routeError ? <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-xs text-amber-200"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{routeError}</span></div> : null}
                {groups.length === 0 && !loadingRoutes ? <EmptyState title={`No ${routeCollectionLabel(selectedProvider.id).toLowerCase()} discovered`} description={selectedProvider.id === "telegram" ? "OpenClaw returned no groups for this account. Configured groups appear here when the directory is unavailable." : "This provider has no supported route directory result for the selected account."} /> : null}
                <div className="divide-y divide-border">
                  {groups.map((route) => (
                    <button key={routeSelectionKey(route)} type="button" onClick={() => { setSelectedRouteKey(routeSelectionKey(route)); setSelectedTopicId(null); setMembers([]); }} className={cn("flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/50", selectedGroup && routeSelectionKey(selectedGroup) === routeSelectionKey(route) && !selectedTopic ? "bg-primary/10" : "")}>
                      <span className="flex min-w-0 items-center gap-2.5" style={{ paddingLeft: route.parentRouteId ? 16 : 0 }}><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60 text-muted-foreground"><RouteIcon kind={route.kind} /></span><span className="min-w-0"><span className="block truncate text-xs font-semibold text-foreground">{route.title ?? route.routeId}</span><span className="block truncate text-[0.62rem] text-muted-foreground">{routeKindLabel(route.kind)} · <span className="font-mono">{route.routeId}</span></span></span></span>
                      <span className="flex items-center gap-2">{route.accessPolicy?.requireMention === false ? <StatusBadge label="Always" tone="info" /> : route.accessPolicy?.requireMention === true ? <StatusBadge label="Mention" tone="muted" /> : null}{route.bindingEditingAmbiguous ? <StatusBadge label="First match" tone="warning" /> : route.agentId ? <StatusBadge label={route.bindingMatch === "inherited" ? `Inherited · ${route.agentId}` : route.agentId} tone="success" /> : null}<ChevronRight className="h-4 w-4 text-muted-foreground" /></span>
                    </button>
                  ))}
                </div>
              </SectionCard>
            ) : null}

            {selectedRoute && selectedProvider && selectedAccount ? (
              <RouteDetail
                key={`${selectedProvider.id}:${selectedAccount.accountId}:${routeSelectionKey(selectedRoute)}`}
                provider={selectedProvider}
                accountId={selectedAccount.accountId}
                group={selectedGroup}
                topic={selectedTopic}
                topics={topics}
                loadingTopics={loadingTopics}
                members={members}
                loadingMembers={loadingMembers}
                currentAgentId={currentAgentId}
                agents={rootSnapshot.agents}
                canEditPolicy={selectedProvider.capabilities.supportsGroupPolicy || selectedProvider.capabilities.supportsMentionPolicy}
                onTopicSelect={(topicId) => { setSelectedTopicId(topicId); setMembers([]); }}
                onAgentChange={(agentId) => selectedTopic ? void updateTopicAgent(agentId) : void updateGroupAgent(agentId)}
                onPolicyChange={(patch) => void runPolicyMutation(patch, "Route policy updated.")}
                onLoadMembers={async () => {
                  if (!selectedGroup) return;
                  setLoadingMembers(true);
                  try { const payload = await readDirectory(selectedProvider.id, selectedAccount.accountId, "members", selectedGroup.routeId); setMembers(payload.entries); } catch { toast.error("Members are unavailable."); } finally { setLoadingMembers(false); }
                }}
              />
            ) : null}
          </>
        }
        inspector={null}
      />

      <ChannelCenterAddAccountDialog
        open={isConnectDialogOpen}
        onOpenChange={setIsConnectDialogOpen}
        snapshot={rootSnapshot}
        activeWorkspaceId={activeWorkspaceId}
        onRefresh={async () => { await loadCenter(); await refresh(); }}
      />
    </>
  );

  async function runMutation(url: string, body: Record<string, unknown>, successMessage: string, after?: () => Promise<void>) {
    try {
      const response = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string; applyMode?: string; pending?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "The channel change could not be saved.");
      toast.success(successMessage, { description: describeMutationOutcome(payload.applyMode, payload.pending) });
      await after?.();
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The channel change could not be saved.");
    }
  }
}

function ProviderCard({ provider, selected, onClick }: { provider: ChannelCenterProvider; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("rounded-xl border p-3 text-left transition-colors", selected ? "border-primary/40 bg-primary/10" : "border-border bg-card/45 hover:bg-accent/60")}>
      <div className="flex items-start justify-between gap-2"><span className="flex items-center gap-2.5"><EntityIcon label={provider.label} size="sm" /><span><span className="block text-xs font-semibold text-foreground">{provider.label}</span><span className="block text-[0.62rem] text-muted-foreground">{provider.accounts.length} account{provider.accounts.length === 1 ? "" : "s"}</span></span></span><StatusBadge label={providerStatus(provider)} tone={providerTone(provider)} /></div>
      <p className="mt-3 line-clamp-2 text-[0.68rem] leading-4 text-muted-foreground">{provider.description}</p>
    </button>
  );
}

function AccountPanel({ provider, account, actionKey, onAction, onOpenControlUi }: { provider: ChannelCenterProvider; account: ChannelCenterProvider["accounts"][number]; actionKey: string | null; onAction: (action: "start" | "stop" | "restart" | "logout") => void; onOpenControlUi: () => void }) {
  const canStart = provider.capabilities.supportsStart;
  const canStop = provider.capabilities.supportsStop;
  const canRestart = provider.capabilities.supportsRestart;
  const canLogout = provider.capabilities.supportsLogout;
  return (
    <div className="rounded-xl border border-border bg-card/45 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-foreground">{account.name}</h3><StatusBadge label={accountStatus(account)} tone={accountTone(account)} /></div><p className="mt-1 font-mono text-[0.65rem] text-muted-foreground">{account.accountId}{account.isDefault ? " · default" : ""}</p></div><div className="flex flex-wrap gap-1.5"><Button variant="ghost" size="sm" className="h-8 rounded-lg px-2 text-[0.65rem]" onClick={onOpenControlUi} disabled={Boolean(actionKey)}><ExternalLink className="mr-1 h-3 w-3" />Open Control UI</Button>{account.running && canStop ? <Button variant="secondary" size="sm" className="h-8 rounded-lg px-2 text-[0.65rem]" onClick={() => onAction("stop")} disabled={Boolean(actionKey)}><Square className="mr-1 h-3 w-3" />Stop</Button> : !account.running && canStart ? <Button variant="secondary" size="sm" className="h-8 rounded-lg px-2 text-[0.65rem]" onClick={() => onAction("start")} disabled={Boolean(actionKey)}><Play className="mr-1 h-3 w-3" />Start</Button> : null}{canRestart ? <Button variant="ghost" size="sm" className="h-8 rounded-lg px-2 text-[0.65rem]" onClick={() => onAction("restart")} disabled={Boolean(actionKey)}><RefreshCw className="mr-1 h-3 w-3" />Restart</Button> : null}<Button variant="ghost" size="sm" className="h-8 rounded-lg px-2 text-[0.65rem] text-destructive" onClick={() => onAction("logout")} disabled={!canLogout || Boolean(actionKey)}><LogOut className="mr-1 h-3 w-3" />Log out</Button></div></div>
      {account.lastError ? <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/10 p-2 text-xs text-destructive">{account.lastError}</div> : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-3"><KeyValue label="Runtime" value={account.connected ? "Connected" : account.running ? "Running" : account.configured ? "Configured" : "Unknown"} /><KeyValue label="Authentication" value={account.authenticationRequired ? "Required" : account.linked ? "Linked" : account.configured ? "Configured" : "Unknown"} /><KeyValue label="Inventory" value={account.liveStatusAvailable ? "Gateway status" : "Config only"} /></div>
    </div>
  );
}

function RouteDetail({ provider, accountId, group, topic, topics, loadingTopics, members, loadingMembers, currentAgentId, agents, canEditPolicy, onTopicSelect, onAgentChange, onPolicyChange, onLoadMembers }: { provider: ChannelCenterProvider; accountId: string; group: DirectoryEntry | null; topic: DirectoryEntry | null; topics: DirectoryEntry[]; loadingTopics: boolean; members: DirectoryEntry[]; loadingMembers: boolean; currentAgentId: string | null; agents: MissionControlSnapshot["agents"]; canEditPolicy: boolean; onTopicSelect: (topicId: string | null) => void; onAgentChange: (agentId: string | null) => void; onPolicyChange: (patch: Record<string, unknown>) => void; onLoadMembers: () => void }) {
  const route = topic ?? group;
  const policy = route?.accessPolicy;
  const [allowFrom, setAllowFrom] = useState(() => policy?.allowFrom.join(", ") ?? "");
  const isTopic = Boolean(topic);
  const mention = policy?.requireMention ?? true;
  const access = policy?.groupPolicy ?? "open";
  const isThread = route?.kind === "thread";
  const canEditRoutePolicy = Boolean(route && ["group", "channel", "topic"].includes(route.kind) && canEditPolicy);
  const canEditAccessPolicy = provider.id === "telegram" && provider.capabilities.supportsGroupPolicy;
  const explicitAgentId = route?.bindingMatch === "exact" ? route.agentId : null;
  const inherited = route?.bindingMatch === "inherited" || Boolean(route?.inheritedFrom);

  if (!route) return null;

  return (
    <SectionCard title={topic ? `${group?.title ?? group?.routeId} / ${topic.title ?? topic.routeId}` : (group?.title ?? group?.routeId)} action={<StatusBadge label={routeKindLabel(route.kind)} tone="info" />}>
      <div className="grid gap-4 p-3 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted/60 text-muted-foreground">{topic ? <MessageCircle className="h-5 w-5" /> : <Hash className="h-5 w-5" />}</span><div className="min-w-0"><h3 className="text-sm font-semibold text-foreground">{route.title ?? route.routeId}</h3><p className="font-mono text-[0.65rem] text-muted-foreground">{accountId} · {route.routeId}</p></div></div>
          {route.bindingEditingAmbiguous ? <div className="flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-xs leading-5 text-amber-200"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />Multiple native bindings match this route. OpenClaw uses the first configured entry; editing is blocked when the exact binding cannot be identified.</div> : null}
          {canEditRoutePolicy ? <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-border p-3"><div className="flex items-center gap-2 text-xs font-semibold text-foreground"><ShieldCheck className="h-4 w-4 text-primary" />Respond</div><div className="mt-2 flex gap-2"><button type="button" onClick={() => onPolicyChange({ requireMention: true })} className={cn("flex-1 rounded-lg border px-2 py-2 text-[0.68rem]", mention ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground")} disabled={!provider.capabilities.supportsMentionPolicy}>Only when mentioned</button><button type="button" onClick={() => onPolicyChange({ requireMention: false })} className={cn("flex-1 rounded-lg border px-2 py-2 text-[0.68rem]", !mention ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground")} disabled={!provider.capabilities.supportsMentionPolicy}>Always</button></div></div>{canEditAccessPolicy ? <div className="rounded-xl border border-border p-3"><div className="flex items-center gap-2 text-xs font-semibold text-foreground"><Users className="h-4 w-4 text-primary" />Access</div><select value={access} onChange={(event) => onPolicyChange({ groupPolicy: event.target.value })} className="mt-2 h-9 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground"><option value="open">Allowed</option><option value="allowlist">Approved members only</option><option value="disabled">Disabled</option></select><Input value={allowFrom} onChange={(event) => setAllowFrom(event.target.value)} onBlur={() => onPolicyChange({ allowFrom: allowFrom.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="Approved member IDs" className="mt-2 h-9 text-xs" /></div> : null}</div> : <div className="rounded-xl border border-border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">OpenClaw did not report route policy editing for this route. Use the OpenClaw Control UI for provider-native access settings.</div>}
          {!isTopic && route.kind === "group" && provider.capabilities.supportsTopics ? <div className="rounded-xl border border-border p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-foreground">Topics</span><span className="text-[0.65rem] text-muted-foreground">{loadingTopics ? "Loading…" : `${topics.length}`}</span></div>{topics.length === 0 && !loadingTopics ? <p className="mt-2 text-xs text-muted-foreground">No configured forum topics were reported by OpenClaw.</p> : <div className="mt-2 grid gap-1.5 sm:grid-cols-2">{topics.map((entry) => <button key={entry.routeId} type="button" onClick={() => onTopicSelect(entry.routeId)} className="flex items-center justify-between rounded-lg border border-border px-2.5 py-2 text-left text-xs hover:bg-accent/60"><span className="truncate">{entry.title ?? entry.routeId}</span><span className="ml-2 text-[0.62rem] text-muted-foreground">{entry.agentId ?? "No route override"}</span></button>)}</div>}</div> : isTopic ? <button type="button" onClick={() => onTopicSelect(null)} className="text-xs text-primary hover:underline">Back to parent route</button> : null}
          {!isTopic && route.kind === "group" ? <div className="rounded-xl border border-border p-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-foreground">Members</span><Button variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-[0.65rem]" onClick={onLoadMembers} disabled={loadingMembers}>{loadingMembers ? <Loader2 className="h-3 w-3 animate-spin" /> : <Users className="mr-1 h-3 w-3" />}Load members</Button></div>{members.length > 0 ? <div className="mt-2 space-y-1">{members.map((member) => <div key={member.routeId} className="flex justify-between text-[0.68rem]"><span>{member.title ?? member.handle ?? member.routeId}</span><span className="font-mono text-muted-foreground">{member.routeId}</span></div>)}</div> : <p className="mt-2 text-xs text-muted-foreground">Members load only when requested.</p>}</div> : null}
        </div>
        <div className="rounded-xl border border-border bg-card/45 p-3"><div className="flex items-center gap-2 text-xs font-semibold text-foreground"><Check className="h-4 w-4 text-primary" />Agent</div><p className="mt-1 text-[0.68rem] text-muted-foreground">Native OpenClaw routing is separate from access policy.</p>{inherited ? <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-xs"><div className="font-medium text-foreground">{currentAgentId ?? "OpenClaw default"}</div><div className="mt-1 text-muted-foreground">Inherited from {route.inheritedFrom?.title ?? route.inheritedFrom?.routeId ?? "a broader route"}</div></div> : null}{isThread ? <div className="mt-3 rounded-lg border border-border bg-muted/20 p-2.5 text-xs leading-5 text-muted-foreground">Threads inherit their parent peer in this OpenClaw release. Thread-specific overrides are not supported.</div> : <select value={explicitAgentId ?? ""} onChange={(event) => onAgentChange(event.target.value || null)} disabled={!provider.capabilities.supportsNativeBindings} className="mt-3 h-10 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground"><option value="">No route override</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{formatAgentDisplayName(agent)}</option>)}</select>}<div className="mt-4 space-y-1.5 text-[0.67rem] text-muted-foreground"><div className="flex justify-between"><span>Provider</span><span className="text-foreground">{provider.label}</span></div><div className="flex justify-between"><span>Account</span><span className="font-mono text-foreground">{accountId}</span></div><div className="flex justify-between"><span>Route</span><span className="font-mono text-foreground">{route.routeId}</span></div></div></div>
      </div>
    </SectionCard>
  );
}

async function readDirectory(provider: string, accountId: string, kind: "peers" | "groups" | "members" | "topics", groupId?: string, workspaceId?: string | null): Promise<DirectoryResponse> {
  const params = new URLSearchParams({ provider, accountId, kind });
  if (groupId) params.set("groupId", groupId);
  if (workspaceId) params.set("workspaceId", workspaceId);
  const response = await fetch(`/api/openclaw/channels/directory?${params.toString()}`, { cache: "no-store" });
  const payload = await response.json() as DirectoryResponse & { error?: string };
  if (!response.ok && !payload.status) throw new Error(payload.error ?? "Channel routes are unavailable.");
  return payload;
}

function canRunAccountAction(provider: ChannelCenterProvider, action: "start" | "stop" | "restart" | "logout") {
  switch (action) {
    case "start":
      return provider.capabilities.supportsStart;
    case "stop":
      return provider.capabilities.supportsStop;
    case "restart":
      return provider.capabilities.supportsRestart;
    case "logout":
      return provider.capabilities.supportsLogout;
  }
}

function describeMutationOutcome(applyMode?: string, pending?: boolean) {
  if (pending || applyMode === "pending") return "Saved and queued for OpenClaw to apply.";
  switch (applyMode) {
    case "live":
      return "OpenClaw applied the change live.";
    case "reload":
      return "OpenClaw reloaded the affected configuration.";
    case "restart":
      return "OpenClaw reported that a restart is required.";
    default:
      return "OpenClaw accepted the change; apply status is not available.";
  }
}

function providerStatus(provider: ChannelCenterProvider) {
  if (provider.connected) return "Connected";
  if (provider.running) return "Running";
  if (provider.configured) return "Configured";
  if (provider.state.availability === "not-installed") return "Not installed";
  if (provider.state.availability === "not-configured") return "Not configured";
  if (provider.pluginInstalled) return provider.pluginEnabled ? "Ready" : "Disabled";
  return provider.available ? "Available" : "Unavailable";
}

function providerTone(provider: ChannelCenterProvider): "success" | "info" | "warning" | "danger" | "muted" {
  if (provider.connected || provider.running) return "success";
  if (provider.configured || provider.pluginEnabled) return "info";
  if (provider.state.availability === "not-installed" || provider.state.availability === "not-configured" || provider.pluginInstalled || provider.available) return "warning";
  return "muted";
}

function mergeDirectoryEntries(entries: DirectoryEntry[]) {
  const byKey = new Map<string, DirectoryEntry>();
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.parentRouteId ?? ""}:${entry.routeId}`;
    if (!byKey.has(key)) byKey.set(key, entry);
  }
  return Array.from(byKey.values()).sort((left, right) => {
    const parentOrder = Number(Boolean(left.parentRouteId)) - Number(Boolean(right.parentRouteId));
    if (parentOrder !== 0) return parentOrder;
    return (left.title ?? left.routeId).localeCompare(right.title ?? right.routeId);
  });
}

function routeSelectionKey(entry: Pick<DirectoryEntry, "kind" | "parentRouteId" | "routeId">) {
  return `${entry.kind}:${entry.parentRouteId ?? ""}:${entry.routeId}`;
}

function routeCollectionLabel(provider: string) {
  switch (provider) {
    case "telegram":
      return "Groups & topics";
    case "discord":
      return "Servers & channels";
    case "slack":
      return "Channels";
    case "whatsapp":
      return "Chats & groups";
    default:
      return "Routes";
  }
}

function routeKindLabel(kind: DirectoryEntry["kind"]) {
  switch (kind) {
    case "dm": return "Direct chat";
    case "group": return "Group / server";
    case "channel": return "Channel";
    case "thread": return "Thread";
    case "topic": return "Topic";
    case "role": return "Role selector";
    default: return "Peer";
  }
}

function RouteIcon({ kind }: { kind: DirectoryEntry["kind"] }) {
  if (kind === "dm") return <MessageCircle className="h-3.5 w-3.5" />;
  if (kind === "group" || kind === "role") return <Users className="h-3.5 w-3.5" />;
  return <Hash className="h-3.5 w-3.5" />;
}

function accountStatus(account: ChannelCenterProvider["accounts"][number]) {
  if (account.connected) return "Connected";
  if (account.running) return "Running";
  if (account.authenticationRequired) return "Needs auth";
  if (account.configured) return account.enabled ? "Configured" : "Disabled";
  return "Unknown";
}

function accountTone(account: ChannelCenterProvider["accounts"][number]): "success" | "info" | "warning" | "danger" | "muted" {
  if (account.connected || account.running) return "success";
  if (account.authenticationRequired) return "warning";
  if (account.configured) return account.enabled ? "info" : "muted";
  return "muted";
}
