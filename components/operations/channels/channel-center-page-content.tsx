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

import { ConnectChannelsDialog } from "@/components/mission-control/connect-channels-dialog";
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
  agentId: string | null;
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

const ACTION_PROVIDERS = new Set(["whatsapp", "telegram", "discord", "slack", "googlechat", "imessage", "signal"]);

export function ChannelCenterPageContent({
  snapshot,
  rootSnapshot,
  activeWorkspaceId,
  refresh,
}: {
  snapshot: MissionControlSnapshot;
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
  const [selectedRouteId, setSelectedRouteId] = useState<string | null>(null);
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
  const selectedGroup = groups.find((route) => route.routeId === selectedRouteId) ?? null;
  const selectedTopic = topics.find((route) => route.routeId === selectedTopicId) ?? null;
  const selectedRoute = selectedTopic ?? selectedGroup;
  const workspaceChannel = findWorkspaceChannel(snapshot, activeWorkspaceId, selectedProvider?.id ?? null, selectedAccount?.accountId ?? null);
  const workspaceBinding = workspaceChannel?.workspaces.find((binding) => binding.workspaceId === activeWorkspaceId) ?? null;
  const currentAssignment = selectedGroup && workspaceBinding
    ? workspaceBinding.groupAssignments.find((assignment) => assignment.chatId === selectedGroup.routeId) ?? null
    : null;
  const currentAgentId = selectedTopic?.agentId ?? currentAssignment?.agentId ?? selectedGroup?.agentId ?? null;

  useEffect(() => {
    if (!selectedProviderId && providers[0]) setSelectedProviderId(providers[0].id);
    if (selectedProviderId && !providers.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(providers[0]?.id ?? null);
    }
  }, [providers, selectedProviderId]);

  useEffect(() => {
    setSelectedAccountId(selectedProvider?.accounts[0]?.accountId ?? null);
    setSelectedRouteId(null);
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
      const payload = await readDirectory(selectedProvider.id, selectedAccount.accountId, "groups");
      setGroups(payload.entries);
      if (payload.status === "failed" || payload.status === "unsupported") {
        setRouteError(payload.error ?? payload.fallbackReason ?? "Groups are not available for this provider.");
      }
      setSelectedRouteId((current) => payload.entries.some((entry) => entry.routeId === current) ? current : payload.entries[0]?.routeId ?? null);
    } catch (error) {
      setGroups([]);
      setRouteError(error instanceof Error ? error.message : "Groups are unavailable.");
    } finally {
      setLoadingRoutes(false);
    }
  }, [selectedAccount, selectedProvider]);

  useEffect(() => {
    void loadRoutes();
  }, [loadRoutes]);

  const loadTopics = useCallback(async () => {
    if (selectedProvider?.id !== "telegram" || !selectedAccount || !selectedGroup) {
      setTopics([]);
      return;
    }
    setLoadingTopics(true);
    try {
      const payload = await readDirectory("telegram", selectedAccount.accountId, "topics", selectedGroup.routeId);
      setTopics(payload.entries);
      setSelectedTopicId((current) => payload.entries.some((entry) => entry.routeId === current) ? current : null);
    } catch {
      setTopics([]);
    } finally {
      setLoadingTopics(false);
    }
  }, [selectedAccount, selectedGroup, selectedProvider?.id]);

  useEffect(() => {
    void loadTopics();
  }, [loadTopics]);

  const runAccountAction = async (action: "start" | "stop" | "restart" | "logout") => {
    if (!selectedProvider || !selectedAccount || !ACTION_PROVIDERS.has(selectedProvider.id)) return;
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
    if (!selectedGroup || !workspaceChannel || !activeWorkspaceId || !workspaceBinding) {
      toast.message("Attach this account to the selected workspace before assigning a group agent.");
      return;
    }
    const assignments = workspaceBinding.groupAssignments.filter((assignment) => assignment.chatId !== selectedGroup.routeId);
    assignments.push({
      chatId: selectedGroup.routeId,
      title: selectedGroup.title,
      agentId,
      enabled: true
    });
    await runMutation(`/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/channels`, {
      channelId: workspaceChannel.id,
      action: "groups",
      groupAssignments: assignments
    }, "Group agent updated.");
  };

  const updateTopicAgent = async (agentId: string | null) => {
    if (!selectedGroup || !selectedTopic || !selectedAccount) return;
    await runPolicyMutation({ agentId }, "Topic agent updated.", selectedGroup.routeId, selectedTopic.routeId);
  };

  const runPolicyMutation = async (
    patch: Record<string, unknown>,
    successMessage: string,
    groupId = selectedGroup?.routeId,
    topicId = selectedTopic?.routeId ?? null
  ) => {
    if (!selectedAccount || !groupId) return;
    await runMutation("/api/openclaw/channels/route-policy", {
      provider: "telegram",
      accountId: selectedAccount.accountId,
      groupId,
      topicId,
      patch
    }, successMessage, async () => {
      await loadRoutes();
      await loadTopics();
    });
  };

  const openAdvanced = () => {
    window.open("/integrations", "_blank", "noopener,noreferrer");
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
                        onClick={() => { setSelectedAccountId(account.accountId); setSelectedRouteId(null); setSelectedTopicId(null); }}
                        className={cn("flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition-colors", account.accountId === selectedAccount?.accountId ? "border-primary/40 bg-primary/10" : "border-border bg-card/50 hover:bg-accent/60")}
                      >
                        <span className="flex min-w-0 items-center gap-2.5"><EntityIcon label={selectedProvider.label} size="sm" /><span className="min-w-0"><span className="block truncate text-xs font-semibold text-foreground">{account.name}</span><span className="block truncate font-mono text-[0.62rem] text-muted-foreground">{account.accountId}</span></span></span>
                        <StatusBadge label={accountStatus(account)} tone={accountTone(account)} />
                      </button>
                    ))}
                  </div>

                  <div className="min-w-0">
                    {selectedAccount ? <AccountPanel provider={selectedProvider} account={selectedAccount} actionKey={actionKey} onAction={runAccountAction} onAdvanced={openAdvanced} /> : <EmptyState title="Select an account" description="Choose an account to inspect its routes." />}
                  </div>
                </div>
              </SectionCard>
            ) : null}

            {selectedProvider && selectedAccount ? (
              <SectionCard
                title="Routes"
                action={loadingRoutes ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : <span className="text-[0.64rem] text-muted-foreground">{groups.length} discovered</span>}
              >
                {routeError ? <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/10 p-3 text-xs text-amber-200"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /><span>{routeError}</span></div> : null}
                {groups.length === 0 && !loadingRoutes ? <EmptyState title="No groups discovered" description={selectedProvider.id === "telegram" ? "OpenClaw returned no groups for this account. Configured groups appear here when the directory is unavailable." : "This provider has no supported route directory result for the selected account."} /> : null}
                <div className="divide-y divide-border">
                  {groups.map((route) => (
                    <button key={route.routeId} type="button" onClick={() => { setSelectedRouteId(route.routeId); setSelectedTopicId(null); setMembers([]); }} className={cn("flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/50", selectedGroup?.routeId === route.routeId && !selectedTopic ? "bg-primary/10" : "")}>
                      <span className="flex min-w-0 items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/60 text-muted-foreground"><Hash className="h-3.5 w-3.5" /></span><span className="min-w-0"><span className="block truncate text-xs font-semibold text-foreground">{route.title ?? route.routeId}</span><span className="block truncate font-mono text-[0.62rem] text-muted-foreground">{route.routeId}</span></span></span>
                      <span className="flex items-center gap-2">{route.accessPolicy?.requireMention === false ? <StatusBadge label="Always" tone="info" /> : route.accessPolicy?.requireMention === true ? <StatusBadge label="Mention" tone="muted" /> : null}{route.agentId ? <StatusBadge label={route.agentId} tone="success" /> : null}<ChevronRight className="h-4 w-4 text-muted-foreground" /></span>
                    </button>
                  ))}
                </div>
              </SectionCard>
            ) : null}

            {selectedRoute && selectedProvider && selectedAccount ? (
              <RouteDetail
                key={`${selectedProvider.id}:${selectedAccount.accountId}:${selectedRoute.routeId}`}
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

      <ConnectChannelsDialog
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
      const payload = await response.json() as { error?: string; restartRequired?: boolean };
      if (!response.ok) throw new Error(payload.error ?? "The channel change could not be saved.");
      toast.success(payload.restartRequired ? `${successMessage} Restart OpenClaw to apply routing changes.` : successMessage);
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

function AccountPanel({ provider, account, actionKey, onAction, onAdvanced }: { provider: ChannelCenterProvider; account: ChannelCenterProvider["accounts"][number]; actionKey: string | null; onAction: (action: "start" | "stop" | "restart" | "logout") => void; onAdvanced: () => void }) {
  const canAct = ACTION_PROVIDERS.has(provider.id);
  return (
    <div className="rounded-xl border border-border bg-card/45 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-foreground">{account.name}</h3><StatusBadge label={accountStatus(account)} tone={accountTone(account)} /></div><p className="mt-1 font-mono text-[0.65rem] text-muted-foreground">{account.accountId}{account.isDefault ? " · default" : ""}</p></div><div className="flex flex-wrap gap-1.5"><Button variant="ghost" size="sm" className="h-8 rounded-lg px-2 text-[0.65rem]" onClick={onAdvanced}><ExternalLink className="mr-1 h-3 w-3" />Advanced</Button>{canAct && account.running ? <Button variant="secondary" size="sm" className="h-8 rounded-lg px-2 text-[0.65rem]" onClick={() => onAction("stop")} disabled={Boolean(actionKey)}><Square className="mr-1 h-3 w-3" />Stop</Button> : canAct ? <Button variant="secondary" size="sm" className="h-8 rounded-lg px-2 text-[0.65rem]" onClick={() => onAction("start")} disabled={Boolean(actionKey)}><Play className="mr-1 h-3 w-3" />Start</Button> : null}<Button variant="ghost" size="sm" className="h-8 rounded-lg px-2 text-[0.65rem] text-destructive" onClick={() => onAction("logout")} disabled={!canAct || Boolean(actionKey)}><LogOut className="mr-1 h-3 w-3" />Log out</Button></div></div>
      {account.lastError ? <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/10 p-2 text-xs text-destructive">{account.lastError}</div> : null}
      <div className="mt-3 grid gap-2 sm:grid-cols-3"><KeyValue label="Runtime" value={account.connected ? "Connected" : account.running ? "Running" : account.configured ? "Configured" : "Unknown"} /><KeyValue label="Authentication" value={account.authenticationRequired ? "Required" : account.linked ? "Linked" : account.configured ? "Configured" : "Unknown"} /><KeyValue label="Inventory" value={account.liveStatusAvailable ? "Gateway status" : "Config only"} /></div>
    </div>
  );
}

function RouteDetail({ provider, accountId, group, topic, topics, loadingTopics, members, loadingMembers, currentAgentId, agents, onTopicSelect, onAgentChange, onPolicyChange, onLoadMembers }: { provider: ChannelCenterProvider; accountId: string; group: DirectoryEntry | null; topic: DirectoryEntry | null; topics: DirectoryEntry[]; loadingTopics: boolean; members: DirectoryEntry[]; loadingMembers: boolean; currentAgentId: string | null; agents: MissionControlSnapshot["agents"]; onTopicSelect: (topicId: string | null) => void; onAgentChange: (agentId: string | null) => void; onPolicyChange: (patch: Record<string, unknown>) => void; onLoadMembers: () => void }) {
  const route = topic ?? group;
  const policy = route?.accessPolicy;
  const [allowFrom, setAllowFrom] = useState(() => policy?.allowFrom.join(", ") ?? "");
  const isTopic = Boolean(topic);
  const mention = policy?.requireMention ?? true;
  const access = policy?.groupPolicy ?? "open";

  if (!route) return null;

  return (
    <SectionCard title={topic ? `${group?.title ?? group?.routeId} / ${topic.title ?? topic.routeId}` : (group?.title ?? group?.routeId)} action={<StatusBadge label={topic ? "Topic" : "Group"} tone="info" />}>
      <div className="grid gap-4 p-3 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          <div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-muted/60 text-muted-foreground">{topic ? <MessageCircle className="h-5 w-5" /> : <Hash className="h-5 w-5" />}</span><div className="min-w-0"><h3 className="text-sm font-semibold text-foreground">{route.title ?? route.routeId}</h3><p className="font-mono text-[0.65rem] text-muted-foreground">{accountId} · {route.routeId}</p></div></div>
          <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-border p-3"><div className="flex items-center gap-2 text-xs font-semibold text-foreground"><ShieldCheck className="h-4 w-4 text-primary" />Respond</div><div className="mt-2 flex gap-2"><button type="button" onClick={() => onPolicyChange({ requireMention: true })} className={cn("flex-1 rounded-lg border px-2 py-2 text-[0.68rem]", mention ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground")}>Only when mentioned</button><button type="button" onClick={() => onPolicyChange({ requireMention: false })} className={cn("flex-1 rounded-lg border px-2 py-2 text-[0.68rem]", !mention ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground")}>Always</button></div></div><div className="rounded-xl border border-border p-3"><div className="flex items-center gap-2 text-xs font-semibold text-foreground"><Users className="h-4 w-4 text-primary" />Access</div><select value={access} onChange={(event) => onPolicyChange({ groupPolicy: event.target.value })} className="mt-2 h-9 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground"><option value="open">Allowed</option><option value="allowlist">Approved members only</option><option value="disabled">Disabled</option></select><Input value={allowFrom} onChange={(event) => setAllowFrom(event.target.value)} onBlur={() => onPolicyChange({ allowFrom: allowFrom.split(",").map((value) => value.trim()).filter(Boolean) })} placeholder="Approved member IDs" className="mt-2 h-9 text-xs" /></div></div>
          {!isTopic ? <div className="rounded-xl border border-border p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-foreground">Topics</span><span className="text-[0.65rem] text-muted-foreground">{loadingTopics ? "Loading…" : `${topics.length}`}</span></div>{topics.length === 0 && !loadingTopics ? <p className="mt-2 text-xs text-muted-foreground">No configured forum topics were reported by OpenClaw.</p> : <div className="mt-2 grid gap-1.5 sm:grid-cols-2">{topics.map((entry) => <button key={entry.routeId} type="button" onClick={() => onTopicSelect(entry.routeId)} className="flex items-center justify-between rounded-lg border border-border px-2.5 py-2 text-left text-xs hover:bg-accent/60"><span className="truncate">{entry.title ?? entry.routeId}</span><span className="ml-2 text-[0.62rem] text-muted-foreground">{entry.agentId ?? "Default"}</span></button>)}</div>}</div> : <button type="button" onClick={() => onTopicSelect(null)} className="text-xs text-primary hover:underline">Back to group</button>}
          {!isTopic && group ? <div className="rounded-xl border border-border p-3"><div className="flex items-center justify-between"><span className="text-xs font-semibold text-foreground">Members</span><Button variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-[0.65rem]" onClick={onLoadMembers} disabled={loadingMembers}>{loadingMembers ? <Loader2 className="h-3 w-3 animate-spin" /> : <Users className="mr-1 h-3 w-3" />}Load members</Button></div>{members.length > 0 ? <div className="mt-2 space-y-1">{members.map((member) => <div key={member.routeId} className="flex justify-between text-[0.68rem]"><span>{member.title ?? member.handle ?? member.routeId}</span><span className="font-mono text-muted-foreground">{member.routeId}</span></div>)}</div> : <p className="mt-2 text-xs text-muted-foreground">Members load only when requested.</p>}</div> : null}
        </div>
        <div className="rounded-xl border border-border bg-card/45 p-3"><div className="flex items-center gap-2 text-xs font-semibold text-foreground"><Check className="h-4 w-4 text-primary" />Agent</div><p className="mt-1 text-[0.68rem] text-muted-foreground">Binding is separate from access policy.</p><select value={currentAgentId ?? ""} onChange={(event) => onAgentChange(event.target.value || null)} className="mt-3 h-10 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground"><option value="">Use workspace default</option>{agents.map((agent) => <option key={agent.id} value={agent.id}>{formatAgentDisplayName(agent)}</option>)}</select><div className="mt-4 space-y-1.5 text-[0.67rem] text-muted-foreground"><div className="flex justify-between"><span>Provider</span><span className="text-foreground">{provider.label}</span></div><div className="flex justify-between"><span>Account</span><span className="font-mono text-foreground">{accountId}</span></div><div className="flex justify-between"><span>Route</span><span className="font-mono text-foreground">{route.routeId}</span></div></div></div>
      </div>
    </SectionCard>
  );
}

function findWorkspaceChannel(snapshot: MissionControlSnapshot, workspaceId: string | null, provider: string | null, accountId: string | null) {
  if (!workspaceId || !provider || !accountId) return null;
  const workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);
  return workspace?.channels.find((channel) => channel.type === provider && channel.id === accountId) ?? null;
}

async function readDirectory(provider: string, accountId: string, kind: "groups" | "members" | "topics", groupId?: string): Promise<DirectoryResponse> {
  const params = new URLSearchParams({ provider, accountId, kind });
  if (groupId) params.set("groupId", groupId);
  const response = await fetch(`/api/openclaw/channels/directory?${params.toString()}`, { cache: "no-store" });
  const payload = await response.json() as DirectoryResponse & { error?: string };
  if (!response.ok && !payload.status) throw new Error(payload.error ?? "Channel routes are unavailable.");
  return payload;
}

function providerStatus(provider: ChannelCenterProvider) {
  if (provider.connected) return "Connected";
  if (provider.running) return "Running";
  if (provider.configured) return "Configured";
  if (provider.pluginInstalled) return provider.pluginEnabled ? "Ready" : "Disabled";
  return provider.available ? "Available" : "Unavailable";
}

function providerTone(provider: ChannelCenterProvider): "success" | "info" | "warning" | "danger" | "muted" {
  if (provider.connected || provider.running) return "success";
  if (provider.configured || provider.pluginEnabled) return "info";
  if (provider.pluginInstalled || provider.available) return "warning";
  return "muted";
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
