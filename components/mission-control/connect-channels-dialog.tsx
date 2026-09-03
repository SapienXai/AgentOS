"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ExternalLink,
  KeyRound,
  Link2,
  Loader2,
  MessageCircle,
  Play,
  Plug,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Unplug,
  Square
} from "lucide-react";

import { SurfaceIcon } from "@/components/mission-control/surface-icon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { presentChannelLifecycleResult } from "@/lib/openclaw/domains/channel-lifecycle-presenter";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type {
  OpenClawChannelLifecycleResult,
  OpenClawChannelStatusPayload
} from "@/lib/openclaw/client/types";
import { cn } from "@/lib/utils";

type ProviderId = "whatsapp" | "telegram" | "discord" | "slack" | "googlechat" | "imessage" | "signal";

type ProviderView = {
  id: ProviderId;
  label: string;
  description: string;
  setupMode: "qr" | "bot-token" | "app-tokens" | "cloud" | "local-mac" | "external-cli";
  setupLabel: string;
  pluginInstalled: boolean;
  pluginEnabled: boolean;
  pluginStateSource: "gateway" | "cli-fallback" | "inferred";
  pluginStateError: string | null;
  configured: boolean;
  connected: boolean;
  running: boolean;
  available: boolean;
  availabilityReason: string | null;
  address: string | null;
  accounts: Array<{
    accountId: string;
    name: string;
    configured: boolean;
    enabled: boolean;
    isDefault: boolean | null;
    linked: boolean;
    running: boolean;
    connected: boolean;
    liveStatusAvailable: boolean;
    authenticationRequired: boolean;
    lastError: string | null;
  }>;
};

type Overview = {
  installedOpenClawVersion: string | null;
  recommendedOpenClawVersion: string;
  supportedBaselineVersion: string;
  gatewayAvailable: boolean;
  statusError: string | null;
  pluginDiscoveryError: string | null;
  providers: ProviderView[];
};

type ActionResponse<T> = {
  result?: T;
  status?: OpenClawChannelStatusPayload | null;
  statusError?: string;
  error?: string;
};

export function ConnectChannelsDialog({
  open,
  onOpenChange,
  snapshot,
  activeWorkspaceId,
  onRefresh
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  onRefresh?: () => Promise<void>;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId | null>(null);
  const [workspaceId, setWorkspaceId] = useState(activeWorkspaceId ?? snapshot.workspaces[0]?.id ?? "");
  const [agentId, setAgentId] = useState("");
  const [accountName, setAccountName] = useState("");
  const [token, setToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrMessage, setQrMessage] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState("");
  const [attachedAccountId, setAttachedAccountId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const loginRunRef = useRef(0);

  const selectedProvider = overview?.providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId) ?? null;
  const workspaceAgents = useMemo(
    () => snapshot.agents.filter((agent) => agent.workspaceId === workspaceId),
    [snapshot.agents, workspaceId]
  );
  const routedAccountIds = useMemo(() => new Set(
    snapshot.channelRegistry.channels
      .filter((channel) => channel.type === selectedProviderId)
      .filter((channel) => channel.workspaces.some((binding) => binding.workspaceId === workspaceId))
      .map((channel) => channel.id)
  ), [selectedProviderId, snapshot.channelRegistry.channels, workspaceId]);

  const loadOverview = useCallback(async (signal?: AbortSignal) => {
    setLoadError(null);
    try {
      const response = await fetch("/api/openclaw/channels/connect", { cache: "no-store", signal });
      const result = (await response.json()) as Overview & { error?: string };
      if (!response.ok || result.error) {
        throw new Error(result.error || "OpenClaw channels could not be loaded.");
      }
      setOverview(result);
    } catch (error) {
      if (!signal?.aborted) {
        setLoadError(error instanceof Error ? error.message : "OpenClaw channels could not be loaded.");
      }
    }
  }, []);

  useEffect(() => {
    if (!open) {
      loginRunRef.current += 1;
      setSelectedProviderId(null);
      setQrDataUrl(null);
      setQrMessage(null);
      setPairingCode("");
      setAttachedAccountId(null);
      setBusyAction(null);
      return;
    }
    const controller = new AbortController();
    void loadOverview(controller.signal);
    return () => controller.abort();
  }, [loadOverview, open]);

  useEffect(() => {
    if (!open) return;
    const nextWorkspaceId = activeWorkspaceId ?? snapshot.workspaces[0]?.id ?? "";
    setWorkspaceId(nextWorkspaceId);
  }, [activeWorkspaceId, open, snapshot.workspaces]);

  useEffect(() => {
    setAgentId((current) => workspaceAgents.some((agent) => agent.id === current) ? current : workspaceAgents[0]?.id ?? "");
  }, [workspaceAgents]);

  const postActionResponse = useCallback(async <T,>(body: Record<string, unknown>) => {
    const response = await fetch("/api/openclaw/channels/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const result = (await response.json()) as ActionResponse<T>;
    if (!response.ok || result.error || typeof result.result === "undefined") {
      throw new Error(result.error || "OpenClaw could not complete the channel action.");
    }
    return result as ActionResponse<T> & { result: T };
  }, []);

  const postAction = useCallback(async <T,>(body: Record<string, unknown>) => {
    return (await postActionResponse<T>(body)).result;
  }, [postActionResponse]);

  const handleInstall = async () => {
    if (!selectedProvider) return;
    setBusyAction("install");
    try {
      const result = await postAction<{
        action: "install" | "enable" | "already-enabled";
        runtimeVersion: string | null;
        restarted: boolean;
        restartError: string | null;
      }>({
        action: "install-plugin",
        provider: selectedProvider.id
      });
      const successLabel = result.action === "enable"
        ? `${selectedProvider.label} plugin enabled.`
        : result.action === "already-enabled"
          ? `${selectedProvider.label} plugin is already enabled.`
          : `${selectedProvider.label} plugin installed for OpenClaw ${result.runtimeVersion ?? "runtime"}.`;
      toast.success(successLabel, {
        description: result.action === "already-enabled"
          ? "No plugin change was required."
          : result.restarted
            ? "OpenClaw Gateway restarted with the channel plugin."
            : result.restartError || "Restart the OpenClaw Gateway before connecting."
      });
      await loadOverview();
    } catch (error) {
      toast.error("Plugin activation failed.", {
        description: error instanceof Error ? error.message : "The official OpenClaw plugin could not be activated."
      });
    } finally {
      setBusyAction(null);
    }
  };

  const waitForQrLogin = useCallback(async (provider: ProviderView, currentQr: string, runId: number, accountId?: string) => {
    let qr = currentQr;
    while (loginRunRef.current === runId) {
      try {
        const result = await postAction<{ connected?: boolean; qrDataUrl?: string; message?: string }>({
          action: "web-login-wait",
          provider: provider.id,
          accountId,
          currentQrDataUrl: qr
        });
        if (loginRunRef.current !== runId) return;
        if (result.qrDataUrl && result.qrDataUrl !== qr) {
          qr = result.qrDataUrl;
          setQrDataUrl(qr);
        }
        setQrMessage(result.message ?? "Waiting for WhatsApp to confirm the link…");
        if (result.connected) {
          setBusyAction(null);
          setQrDataUrl(null);
          toast.success("WhatsApp connected to OpenClaw.", { description: "Choose a workspace to route this account." });
          await loadOverview();
          return;
        }
      } catch (error) {
        if (loginRunRef.current !== runId) return;
        setBusyAction(null);
        setQrMessage(error instanceof Error ? error.message : "QR login did not complete.");
        return;
      }
    }
  }, [loadOverview, postAction]);

  const handleQrStart = async (accountId?: string) => {
    if (!selectedProvider) return;
    const runId = loginRunRef.current + 1;
    loginRunRef.current = runId;
    setBusyAction("qr");
    setQrMessage("Preparing a secure QR code…");
    try {
      const result = await postAction<{ connected?: boolean; qrDataUrl?: string; message?: string }>({
        action: "web-login-start",
        provider: selectedProvider.id,
        accountId,
        force: true
      });
      if (result.connected) {
        setBusyAction(null);
        toast.success("WhatsApp is already connected.");
        await loadOverview();
        return;
      }
      if (!result.qrDataUrl) {
        throw new Error(result.message || "OpenClaw did not return a QR code.");
      }
      setQrDataUrl(result.qrDataUrl);
      setQrMessage(result.message ?? "Open WhatsApp → Linked devices → Link a device.");
      void waitForQrLogin(selectedProvider, result.qrDataUrl, runId, accountId);
    } catch (error) {
      setBusyAction(null);
      setQrMessage(error instanceof Error ? error.message : "QR login could not be started.");
    }
  };

  const handleProvision = async () => {
    if (!selectedProvider || !workspace) return;
    const normalizedName = accountName.trim() || `${selectedProvider.label} account`;
    if (!token.trim() || (selectedProvider.id === "slack" && !appToken.trim())) {
      toast.error(selectedProvider.id === "slack" ? "Bot and app tokens are required." : "A bot token is required.");
      return;
    }
    setBusyAction("provision");
    try {
      const payload: Record<string, unknown> = {
        type: selectedProvider.id,
        name: normalizedName,
        workspacePath: workspace.path,
        primaryAgentId: agentId || null,
        agentId: agentId || undefined
      };
      if (selectedProvider.id === "slack") {
        payload.botToken = token.trim();
        payload.appToken = appToken.trim();
      } else {
        payload.token = token.trim();
      }
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace.id)}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok || result.error) throw new Error(result.error || "The channel could not be provisioned.");
      setToken("");
      setAppToken("");
      setAccountName("");
      toast.success(`${selectedProvider.label} account configured.`, { description: `${normalizedName} is routed to ${workspace.name}. Live OpenClaw status is shown after refresh.` });
      await Promise.all([loadOverview(), onRefresh?.() ?? Promise.resolve()]);
    } catch (error) {
      toast.error(`${selectedProvider.label} connection failed.`, {
        description: error instanceof Error ? error.message : "OpenClaw could not provision this channel."
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleAttach = async (account: ProviderView["accounts"][number]) => {
    if (!selectedProvider || !workspace) return;
    setBusyAction(`attach:${account.accountId}`);
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace.id)}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channelId: account.accountId,
          type: selectedProvider.id,
          name: account.name,
          workspacePath: workspace.path,
          primaryAgentId: agentId || null,
          agentId: agentId || undefined
        })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok || result.error) throw new Error(result.error || "The channel could not be attached.");
      toast.success(`${account.name} attached to ${workspace.name}.`);
      setAttachedAccountId(account.accountId);
      await Promise.all([loadOverview(), onRefresh?.() ?? Promise.resolve()]);
    } catch (error) {
      toast.error("Workspace attachment failed.", {
        description: error instanceof Error ? error.message : "The account could not be attached."
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleApprovePairing = async (accountId: string) => {
    if (!selectedProvider || !pairingCode.trim()) return;
    setBusyAction(`pairing:${accountId}`);
    try {
      await postAction({
        action: "approve-pairing",
        provider: selectedProvider.id,
        accountId,
        code: pairingCode.trim()
      });
      setPairingCode("");
      toast.success("WhatsApp sender approved.", {
        description: "Send another message in the same conversation to start chatting with the agent."
      });
    } catch (error) {
      toast.error("Pairing approval failed.", {
        description: error instanceof Error ? error.message : "OpenClaw could not approve this sender."
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleLogout = async (accountId: string) => {
    if (!selectedProvider) return;
    setBusyAction(`logout:${accountId}`);
    try {
      await postAction({ action: "logout", provider: selectedProvider.id, accountId });
      toast.success(`${selectedProvider.label} logged out from OpenClaw.`);
      await Promise.all([loadOverview(), onRefresh?.() ?? Promise.resolve()]);
    } catch (error) {
      toast.error("Channel logout failed.", {
        description: error instanceof Error ? error.message : "OpenClaw could not log out this account."
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleLifecycle = async (action: "start" | "stop" | "restart", accountId: string) => {
    if (!selectedProvider) return;
    setBusyAction(`${action}:${accountId}`);
    try {
      const response = await postActionResponse<OpenClawChannelLifecycleResult>({
        action,
        provider: selectedProvider.id,
        accountId
      });
      const presentation = presentChannelLifecycleResult({
        action,
        provider: selectedProvider.id,
        accountId,
        result: response.result,
        status: response.status,
        statusError: response.statusError
      });
      const message = `${selectedProvider.label}: ${presentation.title}`;
      const options = { description: presentation.detail };
      if (presentation.tone === "success") {
        toast.success(message, options);
      } else if (presentation.tone === "danger") {
        toast.error(message, options);
      } else {
        toast(message, options);
      }
      await Promise.all([loadOverview(), onRefresh?.() ?? Promise.resolve()]);
    } catch (error) {
      toast.error(`${selectedProvider.label} ${action} failed.`, {
        description: error instanceof Error ? error.message : "OpenClaw could not complete the channel lifecycle action."
      });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-[760px] gap-0 overflow-hidden rounded-[22px] p-0 shadow-2xl">
        <DialogHeader className="border-b border-border/70 px-5 py-4 pr-12">
          <div className="flex items-center gap-3">
            {selectedProvider ? (
              <button type="button" onClick={() => { loginRunRef.current += 1; setSelectedProviderId(null); setQrDataUrl(null); }} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Back to channel list">
                <ChevronLeft className="h-4 w-4" />
              </button>
            ) : (
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><Plug className="h-[18px] w-[18px]" /></span>
            )}
            <div className="min-w-0">
              <DialogTitle className="text-base">{selectedProvider ? `Connect ${selectedProvider.label}` : "Connect Channels"}</DialogTitle>
              <DialogDescription className="mt-0.5 text-xs">
                {selectedProvider ? selectedProvider.description : "Connect OpenClaw to the messaging services your agents use."}
              </DialogDescription>
            </div>
            {overview?.installedOpenClawVersion ? <Badge variant="muted" className="ml-auto hidden text-[10px] sm:inline-flex">OpenClaw {overview.installedOpenClawVersion}</Badge> : null}
          </div>
        </DialogHeader>

        <div className="max-h-[calc(100vh-10rem)] min-h-[420px] overflow-y-auto px-5 py-4">
          {!overview && !loadError ? <LoadingState /> : null}
          {loadError ? <ErrorState message={loadError} onRetry={() => void loadOverview()} /> : null}
          {overview && !selectedProvider ? (
            <ProviderGrid overview={overview} onSelect={(provider) => { setSelectedProviderId(provider.id); setQrMessage(null); }} />
          ) : null}
          {selectedProvider ? (
            <ProviderSetup
              provider={selectedProvider}
              workspaceId={workspaceId}
              agentId={agentId}
              workspaces={snapshot.workspaces}
              workspaceAgents={workspaceAgents}
              accountName={accountName}
              token={token}
              appToken={appToken}
              qrDataUrl={qrDataUrl}
              qrMessage={qrMessage}
              pairingCode={pairingCode}
              routedAccountIds={routedAccountIds}
              attachedAccountId={attachedAccountId}
              busyAction={busyAction}
              onWorkspaceChange={setWorkspaceId}
              onAgentChange={setAgentId}
              onAccountNameChange={setAccountName}
              onTokenChange={setToken}
              onAppTokenChange={setAppToken}
              onPairingCodeChange={setPairingCode}
              onInstall={() => void handleInstall()}
              onQrStart={(accountId) => void handleQrStart(accountId)}
              onProvision={() => void handleProvision()}
              onAttach={(account) => void handleAttach(account)}
              onLogout={(accountId) => void handleLogout(accountId)}
              onStart={(accountId) => void handleLifecycle("start", accountId)}
              onStop={(accountId) => void handleLifecycle("stop", accountId)}
              onRestart={(accountId) => void handleLifecycle("restart", accountId)}
              onApprovePairing={(accountId) => void handleApprovePairing(accountId)}
            />
          ) : null}
        </div>

        <DialogFooter className="border-t border-border/70 px-5 py-3.5">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProviderGrid({ overview, onSelect }: { overview: Overview; onSelect: (provider: ProviderView) => void }) {
  return (
    <div className="space-y-4">
      {!overview.gatewayAvailable ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-300/50 bg-amber-50/70 p-3 text-amber-950 dark:border-amber-400/20 dark:bg-amber-500/[0.08] dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="text-sm font-medium">Gateway unavailable</p><p className="mt-0.5 text-xs opacity-80">{overview.statusError || "Start or repair the OpenClaw Gateway before connecting channels."}</p></div>
        </div>
      ) : null}
      <div className="grid gap-2.5 sm:grid-cols-2">
        {overview.providers.map((provider) => (
          <button key={provider.id} type="button" onClick={() => onSelect(provider)} className="group flex items-center gap-3 rounded-2xl border border-border/70 bg-card p-3.5 text-left transition hover:border-primary/30 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <SurfaceIcon provider={provider.id} className="h-10 w-10 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2"><span className="text-sm font-semibold">{provider.label}</span><ProviderStatus provider={provider} /></span>
              <span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-muted-foreground">{provider.description}</span>
            </span>
            <span className="text-[10px] font-medium text-muted-foreground">{provider.setupLabel}</span>
          </button>
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">Channel accounts and credentials remain owned by OpenClaw. AgentOS only manages connection setup and workspace routing.</p>
    </div>
  );
}

function ProviderSetup(props: {
  provider: ProviderView;
  workspaceId: string;
  agentId: string;
  workspaces: MissionControlSnapshot["workspaces"];
  workspaceAgents: MissionControlSnapshot["agents"];
  accountName: string;
  token: string;
  appToken: string;
  qrDataUrl: string | null;
  qrMessage: string | null;
  pairingCode: string;
  routedAccountIds: Set<string>;
  attachedAccountId: string | null;
  busyAction: string | null;
  onWorkspaceChange: (value: string) => void;
  onAgentChange: (value: string) => void;
  onAccountNameChange: (value: string) => void;
  onTokenChange: (value: string) => void;
  onAppTokenChange: (value: string) => void;
  onPairingCodeChange: (value: string) => void;
  onInstall: () => void;
  onQrStart: (accountId?: string) => void;
  onProvision: () => void;
  onAttach: (account: ProviderView["accounts"][number]) => void;
  onLogout: (accountId: string) => void;
  onStart: (accountId: string) => void;
  onStop: (accountId: string) => void;
  onRestart: (accountId: string) => void;
  onApprovePairing: (accountId: string) => void;
}) {
  const { provider } = props;
  if (!provider.available) {
    return <UnavailableSetup provider={provider} />;
  }
  if (!provider.pluginInstalled || !provider.pluginEnabled) {
    return <PluginInstallStep {...props} />;
  }
  const activeAccounts = provider.accounts.filter(
    (account) => account.configured || account.linked || account.connected || account.running
  );
  const routedAccounts = activeAccounts.filter(
    (account) => props.routedAccountIds.has(account.accountId) || props.attachedAccountId === account.accountId
  );
  const selectedAgent = props.workspaceAgents.find((agent) => agent.id === props.agentId) ?? null;
  const whatsappAccountNeedingLink = provider.accounts.find((account) => account.authenticationRequired);
  const needsWhatsAppLink = provider.id === "whatsapp" && Boolean(whatsappAccountNeedingLink);

  return (
    <div className="space-y-4">
      {needsWhatsAppLink ? (
        <section className="flex items-start gap-3 rounded-xl border border-amber-300/50 bg-amber-50/70 p-3 text-amber-950 dark:border-amber-400/20 dark:bg-amber-500/[0.08] dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="text-sm font-medium">WhatsApp is not linked yet</p>
            <p className="mt-0.5 text-xs leading-relaxed opacity-80">OpenClaw has an account record, but no active WhatsApp session or linked number. Generate a fresh QR code and finish the link in WhatsApp.</p>
          </div>
        </section>
      ) : null}
      {activeAccounts.length > 0 ? (
        <section className="space-y-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">1 · Choose message destination</p>
            <p className="mt-1 text-xs text-muted-foreground">Select the workspace and agent that should answer incoming messages.</p>
          </div>
          <RoutingFields {...props} />
        </section>
      ) : null}
      {activeAccounts.length > 0 ? (
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">2 · Route channel account</p>
          {activeAccounts.map((account) => (
            <div key={account.accountId} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 p-3">
              <span className={cn("flex h-8 w-8 items-center justify-center rounded-full", account.connected ? "bg-emerald-500/10 text-emerald-600" : account.running ? "bg-blue-500/10 text-blue-600" : "bg-muted text-muted-foreground")}><Check className="h-4 w-4" /></span>
              <div className="min-w-[150px] flex-1"><p className="truncate text-sm font-medium">{account.name}{account.isDefault ? " · Default" : ""}</p><p className="truncate text-xs text-muted-foreground">{account.enabled === false ? "Disabled" : account.connected ? "Connected" : account.running ? "Running" : account.linked ? "Linked" : account.authenticationRequired ? "Needs authentication" : !account.liveStatusAvailable ? "Live status unavailable" : account.configured ? "Stopped" : "Needs setup"}{account.lastError ? ` · ${account.lastError}` : ""}</p></div>
              <Button size="sm" variant="secondary" disabled={!props.workspaceId || !props.agentId || Boolean(props.busyAction)} onClick={() => props.onAttach(account)}>{props.busyAction === `attach:${account.accountId}` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Link2 className="mr-1.5 h-3.5 w-3.5" />}{props.routedAccountIds.has(account.accountId) || props.attachedAccountId === account.accountId ? "Update route" : "Route to agent"}</Button>
              {!account.running && account.enabled && (account.configured || account.linked || account.connected) && !(provider.id === "whatsapp" && !account.linked && !account.connected) ? <Button size="sm" variant="ghost" disabled={Boolean(props.busyAction)} onClick={() => props.onStart(account.accountId)}>{props.busyAction === `start:${account.accountId}` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Play className="mr-1.5 h-3.5 w-3.5" />}Start</Button> : null}
              {account.running ? <><Button size="sm" variant="ghost" disabled={Boolean(props.busyAction)} onClick={() => props.onRestart(account.accountId)}>{props.busyAction === `restart:${account.accountId}` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}Restart</Button><Button size="sm" variant="ghost" disabled={Boolean(props.busyAction)} onClick={() => props.onStop(account.accountId)}>{props.busyAction === `stop:${account.accountId}` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Square className="mr-1.5 h-3.5 w-3.5" />}Stop</Button></> : null}
              {account.configured || account.linked || account.connected || account.running ? <Button size="icon" variant="ghost" disabled={Boolean(props.busyAction)} onClick={() => props.onLogout(account.accountId)} aria-label={`Log out ${account.name}`} title="Logout / unlink — authentication must be established again">{props.busyAction === `logout:${account.accountId}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}</Button> : null}
            </div>
          ))}
        </section>
      ) : null}
      {provider.id === "whatsapp" && routedAccounts[0] ? (
        <WhatsAppChatReady
          account={routedAccounts[0]}
          address={provider.address}
          agentName={selectedAgent ? formatAgentDisplayName(selectedAgent) : props.agentId}
          pairingCode={props.pairingCode}
          busy={props.busyAction === `pairing:${routedAccounts[0].accountId}`}
          onPairingCodeChange={props.onPairingCodeChange}
          onApprove={() => props.onApprovePairing(routedAccounts[0].accountId)}
        />
      ) : null}
      {provider.setupMode === "qr" && (activeAccounts.length === 0 || needsWhatsAppLink) ? (
        <QrSetup {...props} accountId={whatsappAccountNeedingLink?.accountId} />
      ) : provider.setupMode !== "qr" ? (
        <>
          {provider.accounts.length === 0 ? <RoutingFields {...props} /> : null}
        <CredentialSetup {...props} />
        </>
      ) : null}
    </div>
  );
}

function RoutingFields(props: Parameters<typeof ProviderSetup>[0]) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5"><Label htmlFor="channel-workspace">Workspace</Label><select id="channel-workspace" value={props.workspaceId} onChange={(event) => props.onWorkspaceChange(event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring/40"><option value="">Select workspace</option>{props.workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></div>
      <div className="space-y-1.5"><Label htmlFor="channel-agent">Primary agent</Label><select id="channel-agent" value={props.agentId} onChange={(event) => props.onAgentChange(event.target.value)} disabled={!props.workspaceId} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none disabled:opacity-50 focus:ring-2 focus:ring-ring/40"><option value="">No primary agent</option>{props.workspaceAgents.map((agent) => <option key={agent.id} value={agent.id}>{formatAgentDisplayName(agent)}</option>)}</select></div>
    </div>
  );
}

function WhatsAppChatReady({
  account,
  address,
  agentName,
  pairingCode,
  busy,
  onPairingCodeChange,
  onApprove
}: {
  account: ProviderView["accounts"][number];
  address: string | null;
  agentName: string;
  pairingCode: string;
  busy: boolean;
  onPairingCodeChange: (value: string) => void;
  onApprove: () => void;
}) {
  return (
    <section className="rounded-2xl border border-emerald-300/55 bg-emerald-50/65 p-4 dark:border-emerald-400/20 dark:bg-emerald-500/[0.07]">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"><MessageCircle className="h-5 w-5" /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-950 dark:text-emerald-50">3 · Ready to chat with {agentName || "your agent"}</p>
          <p className="mt-1 text-xs leading-relaxed text-emerald-900/75 dark:text-emerald-100/75">{account.name} is connected and routed. WhatsApp messages admitted by OpenClaw will now go to this agent.</p>
        </div>
      </div>

      <ol className="mt-4 space-y-2 text-xs leading-relaxed text-emerald-950/85 dark:text-emerald-50/85">
        <li><span className="font-semibold">1.</span> From another WhatsApp account, send a message such as “Hello” to {address ? <span className="font-semibold">{address}</span> : "the linked WhatsApp number"}.</li>
        <li><span className="font-semibold">2.</span> If WhatsApp replies with a pairing code, paste that code below and approve the sender.</li>
        <li><span className="font-semibold">3.</span> Send the message again. {agentName || "The selected agent"} will answer in the same WhatsApp conversation.</li>
      </ol>

      <div className="mt-4 rounded-xl border border-emerald-300/45 bg-background/75 p-3">
        <Label htmlFor="whatsapp-pairing-code" className="text-xs">Pairing code, if requested</Label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Input
            id="whatsapp-pairing-code"
            value={pairingCode}
            onChange={(event) => onPairingCodeChange(event.target.value)}
            placeholder="Paste the code from WhatsApp"
            autoComplete="one-time-code"
            maxLength={32}
          />
          <Button size="sm" onClick={onApprove} disabled={busy || pairingCode.trim().length < 4} className="shrink-0">
            {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
            {busy ? "Approving…" : "Approve sender"}
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">A dedicated assistant number is recommended. Personal-number self-chat requires OpenClaw self-chat policy.</p>
      </div>
    </section>
  );
}

function QrSetup(props: Parameters<typeof ProviderSetup>[0] & { accountId?: string }) {
  return (
    <section className="rounded-2xl border border-border/70 bg-muted/20 p-4">
      {props.qrDataUrl ? (
        <div className="grid gap-4 sm:grid-cols-[210px_1fr]">
          <div className="rounded-xl bg-white p-2 shadow-sm"><Image unoptimized src={props.qrDataUrl} alt="WhatsApp connection QR code" width={194} height={194} className="h-auto w-full" /></div>
          <div className="flex flex-col justify-center"><span className="mb-3 flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600"><QrCode className="h-5 w-5" /></span><p className="text-sm font-semibold">Scan with WhatsApp</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Open WhatsApp → Settings → Linked devices → Link a device.</p><p className="mt-3 text-xs text-muted-foreground">{props.qrMessage || "Waiting for confirmation…"}</p><Button className="mt-4 self-start" size="sm" variant="secondary" disabled={props.busyAction === "qr"} onClick={() => props.onQrStart(props.accountId)}><RefreshCw className="mr-1.5 h-3.5 w-3.5" />Refresh QR</Button></div>
        </div>
      ) : (
        <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><QrCode className="h-5 w-5" /></span><div className="flex-1"><p className="text-sm font-semibold">Link WhatsApp with a QR code</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">OpenClaw stores the linked session. A dedicated number is recommended for reliable agent routing.</p>{props.qrMessage ? <p className="mt-2 text-xs text-destructive">{props.qrMessage}</p> : null}<Button className="mt-3" size="sm" disabled={props.busyAction === "qr"} onClick={() => props.onQrStart(props.accountId)}>{props.busyAction === "qr" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <QrCode className="mr-1.5 h-3.5 w-3.5" />}Generate QR</Button></div></div>
      )}
    </section>
  );
}

function CredentialSetup(props: Parameters<typeof ProviderSetup>[0]) {
  const isSlack = props.provider.id === "slack";
  return (
    <section className="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-4">
      <div className="flex items-start gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><KeyRound className="h-4 w-4" /></span><div><p className="text-sm font-semibold">{isSlack ? "Socket Mode credentials" : "Bot credentials"}</p><p className="mt-0.5 text-xs text-muted-foreground">Secrets are sent directly to OpenClaw and are never returned to the browser.</p></div></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label htmlFor="channel-name">Account name</Label><Input id="channel-name" value={props.accountName} onChange={(event) => props.onAccountNameChange(event.target.value)} placeholder={`${props.provider.label} account`} /></div>
        <div className="space-y-1.5"><Label htmlFor="channel-token">{isSlack ? "Bot token" : "Bot token"}</Label><Input id="channel-token" type="password" autoComplete="off" value={props.token} onChange={(event) => props.onTokenChange(event.target.value)} placeholder={isSlack ? "xoxb-..." : "Paste token"} /></div>
        {isSlack ? <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="channel-app-token">App token</Label><Input id="channel-app-token" type="password" autoComplete="off" value={props.appToken} onChange={(event) => props.onAppTokenChange(event.target.value)} placeholder="xapp-... (connections:write)" /></div> : null}
      </div>
      <div className="flex items-center justify-between gap-3"><a href={providerSetupUrl(props.provider.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Open setup guide <ExternalLink className="h-3 w-3" /></a><Button size="sm" disabled={!props.workspaceId || Boolean(props.busyAction)} onClick={props.onProvision}>{props.busyAction === "provision" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plug className="mr-1.5 h-3.5 w-3.5" />}Connect</Button></div>
    </section>
  );
}

function PluginInstallStep(props: Parameters<typeof ProviderSetup>[0]) {
  const enabling = props.provider.pluginInstalled;
  const busy = props.busyAction === "install";

  return (
    <div className="mx-auto max-w-lg py-8 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Plug className="h-6 w-6" /></span>
      <h3 className="mt-4 text-base font-semibold">{enabling ? "Enable" : "Install"} the official {props.provider.label} plugin</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        {enabling
          ? "This plugin is already bundled with OpenClaw. AgentOS will enable it and restart the Gateway once."
          : "AgentOS will install the official plugin version matching your OpenClaw runtime, then restart the Gateway once."}
      </p>
      {!enabling ? (
        <p className="mx-auto mt-3 max-w-md rounded-xl border border-amber-300/50 bg-amber-50/70 p-3 text-left text-xs text-amber-950 dark:border-amber-400/20 dark:bg-amber-500/[0.08] dark:text-amber-100">
          This installs allowlisted external plugin code. Custom package input is not accepted.
        </p>
      ) : null}
      <Button className="mt-5" onClick={props.onInstall} disabled={busy}>
        {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
        {busy ? (enabling ? "Enabling plugin…" : "Installing compatible plugin…") : (enabling ? "Enable plugin" : "Install compatible plugin")}
      </Button>
      {busy ? <p className="mt-3 text-xs text-muted-foreground" role="status">This can take up to a minute. Keep this dialog open.</p> : null}
    </div>
  );
}

function UnavailableSetup({ provider }: { provider: ProviderView }) {
  return <div className="mx-auto max-w-lg py-8 text-center"><span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600"><AlertTriangle className="h-6 w-6" /></span><h3 className="mt-4 text-base font-semibold">Host setup required</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{provider.availabilityReason}</p><a href={providerSetupUrl(provider.id)} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">Read the OpenClaw setup guide <ExternalLink className="h-3.5 w-3.5" /></a></div>;
}

function ProviderStatus({ provider }: { provider: ProviderView }) {
  const linked = provider.accounts.some((account) => account.linked || account.connected);
  const needsLink = provider.accounts.some((account) => account.authenticationRequired);
  const label = provider.connected ? "Connected" : provider.running ? "Running" : linked ? "Linked" : needsLink ? "Needs link" : provider.configured ? "Configured" : !provider.available ? "Guided" : provider.pluginInstalled ? "Ready" : "Plugin";
  return <span className={cn("rounded-full px-1.5 py-0.5 text-[9px] font-semibold", provider.connected || provider.running ? "bg-emerald-500/10 text-emerald-600" : needsLink ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : provider.configured || provider.pluginInstalled ? "bg-blue-500/10 text-blue-600" : "bg-muted text-muted-foreground")}>{label}</span>;
}

function LoadingState() {
  return <div className="flex min-h-[360px] flex-col items-center justify-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /><p className="mt-3 text-sm">Inspecting OpenClaw channels…</p></div>;
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="flex min-h-[360px] flex-col items-center justify-center text-center"><AlertTriangle className="h-7 w-7 text-destructive" /><p className="mt-3 max-w-md text-sm text-muted-foreground">{message}</p><Button className="mt-4" variant="secondary" onClick={onRetry}><RefreshCw className="mr-1.5 h-4 w-4" />Retry</Button></div>;
}

function providerSetupUrl(provider: ProviderId) {
  return `https://docs.openclaw.ai/channels/${provider}`;
}
