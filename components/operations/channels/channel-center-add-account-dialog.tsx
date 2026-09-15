"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ExternalLink, Link2, Loader2, Plus } from "lucide-react";

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
import type { ChannelCenterSnapshot } from "@/lib/openclaw/application/channel-center-service";
import { presentChannelAccountState } from "@/lib/openclaw/domains/channel-account-presentation";
import {
  classifyChannelAccountPollState,
  pollChannelAccount
} from "@/lib/openclaw/domains/channel-account-polling";

type AddAccountDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  onRefresh: () => Promise<void>;
};

type ChannelCenterResponse = ChannelCenterSnapshot & { error?: string };

/**
 * Thin account-entry surface for Agent connections and Channel Center.
 * OpenClaw owns discovery and runtime lifecycle; this component only creates or
 * attaches an account to the selected AgentOS workspace.
 */
export function ChannelCenterAddAccountDialog({
  open,
  onOpenChange,
  snapshot,
  activeWorkspaceId,
  onRefresh
}: AddAccountDialogProps) {
  const [center, setCenter] = useState<ChannelCenterSnapshot | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState(activeWorkspaceId ?? snapshot.workspaces[0]?.id ?? "");
  const [accountName, setAccountName] = useState("");
  const [token, setToken] = useState("");
  const [botToken, setBotToken] = useState("");
  const [appToken, setAppToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setupControllerRef = useRef<AbortController | null>(null);

  const workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId) ?? null;
  const providers = center?.providers ?? [];
  const selectedProvider = providers.find((provider) => provider.id === providerId) ?? providers[0] ?? null;
  const accounts = selectedProvider?.accounts ?? [];
  const attachedAccountIds = useMemo(
    () => new Set((workspace?.channels ?? []).filter((channel) => channel.type === selectedProvider?.id).map((channel) => channel.id)),
    [selectedProvider?.id, workspace?.channels]
  );
  const canCreateTokenAccount = Boolean(
    selectedProvider?.capabilities.supportsTokenSetup
      && accountName.trim()
      && (selectedProvider.setupMode === "app-tokens" ? botToken.trim() && appToken.trim() : token.trim())
  );

  const loadCenter = useCallback(async (signal?: AbortSignal): Promise<ChannelCenterSnapshot | null> => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/openclaw/channels/center", { cache: "no-store", signal });
      const payload = await response.json() as ChannelCenterResponse;
      if (!response.ok) throw new Error(payload.error ?? "OpenClaw channel inventory is unavailable.");
      setCenter(payload);
      return payload;
    } catch (loadError) {
      if (loadError instanceof Error && loadError.name === "AbortError") return null;
      setCenter(null);
      setError(loadError instanceof Error ? loadError.message : "OpenClaw channel inventory is unavailable.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    setWorkspaceId(activeWorkspaceId ?? snapshot.workspaces[0]?.id ?? "");
    setProviderId(null);
    setAccountName("");
    setToken("");
    setBotToken("");
    setAppToken("");
    setError(null);
    void loadCenter();
  }, [activeWorkspaceId, loadCenter, open, snapshot.workspaces]);

  useEffect(() => {
    return () => setupControllerRef.current?.abort();
  }, []);

  const selectedProviderId = selectedProvider?.id;
  useEffect(() => {
    if (!selectedProviderId) return;
    setAccountName("");
    setToken("");
    setBotToken("");
    setAppToken("");
    setError(null);
  }, [selectedProviderId]);

  async function createTokenAccount() {
    if (!workspace || !selectedProvider || !canCreateTokenAccount) return;
    const body: Record<string, unknown> = {
      type: selectedProvider.id,
      name: accountName.trim(),
      workspacePath: workspace.path
    };

    if (selectedProvider.setupMode === "app-tokens") {
      body.botToken = botToken.trim();
      body.appToken = appToken.trim();
    } else {
      body.token = token.trim();
    }

    await saveAccount(body, `${selectedProvider.label} account created for ${workspace.name}.`, true);
  }

  async function saveAccount(body: Record<string, unknown>, successMessage: string, created = false) {
    if (!workspace || !selectedProvider) {
      toast.error("Choose a workspace before adding an account.");
      return;
    }

    setSaving(true);
    setError(null);
    setupControllerRef.current?.abort();
    const controller = new AbortController();
    setupControllerRef.current = controller;
    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspace.id)}/channels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const payload = await response.json() as {
        error?: string;
        account?: { id?: string; accountId?: string; name?: string; type?: string };
      };
      if (!response.ok) throw new Error(payload.error ?? "The account could not be added.");

      const accountId = payload.account?.accountId?.trim()
        || payload.account?.id?.trim()
        || (typeof body.channelId === "string" ? body.channelId.trim() : null)
        || null;
      const accountName = payload.account?.name ?? body.name;
      const verifiedPoll = await pollChannelAccount({
        signal: controller.signal,
        read: async () => {
          const refreshedCenter = await loadCenter(controller.signal);
          const refreshedProvider = refreshedCenter?.providers.find((provider) => provider.id === selectedProvider.id) ?? null;
          const refreshedAccount = refreshedProvider?.accounts.find((candidate) =>
            (accountId && candidate.accountId === accountId) || candidate.name === accountName
          ) ?? null;
          return {
            center: refreshedCenter,
            provider: refreshedProvider,
            account: refreshedAccount,
            presentation: refreshedAccount ? presentChannelAccountState({
              accountId: refreshedAccount.accountId,
              configured: refreshedAccount.configured,
              enabled: refreshedAccount.enabled,
              linked: refreshedAccount.linked,
              running: refreshedAccount.running,
              connected: refreshedAccount.connected,
              liveStatusAvailable: refreshedAccount.liveStatusAvailable,
              authenticationRequired: refreshedAccount.authenticationRequired,
              lastError: refreshedAccount.lastError,
              healthState: refreshedAccount.healthState,
              credentialState: refreshedAccount.credentialState
            }, { statusError: refreshedCenter?.statusError }) : null
          };
        },
        classify: (value) => value.account
          ? classifyChannelAccountPollState({ operation: "post-create", state: value.presentation?.state })
          : "RETRY"
      });
      const verified = verifiedPoll.value;
      const verifiedCenter = verified.center;
      const verifiedProvider = verified.provider;
      const verifiedAccount = verified.account;

      if (!verifiedProvider || !verifiedAccount) {
        throw new Error(verifiedPoll.timedOut
          ? `${selectedProvider.label} was saved, but OpenClaw did not return a verifiable account state within the expected time.`
          : `${selectedProvider.label} was saved, but OpenClaw did not return a verifiable account state.`);
      }

      let presentation = verified.presentation ?? presentChannelAccountState({
        accountId: verifiedAccount.accountId,
        configured: verifiedAccount.configured,
        enabled: verifiedAccount.enabled,
        linked: verifiedAccount.linked,
        running: verifiedAccount.running,
        connected: verifiedAccount.connected,
        liveStatusAvailable: verifiedAccount.liveStatusAvailable,
        authenticationRequired: verifiedAccount.authenticationRequired,
        lastError: verifiedAccount.lastError,
        healthState: verifiedAccount.healthState,
        credentialState: verifiedAccount.credentialState
      }, { statusError: verifiedCenter?.statusError });

      if ((presentation.state === "READY" || presentation.state === "STOPPED") && verifiedProvider.capabilities.supportsStart) {
        const startResponse = await fetch("/api/openclaw/channels/connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start", provider: selectedProvider.id, accountId: verifiedAccount.accountId }),
          signal: controller.signal
        });
        const startPayload = await startResponse.json().catch(() => null) as { error?: string } | null;
        if (!startResponse.ok) {
          throw new Error(startPayload?.error ?? `${selectedProvider.label} was saved, but OpenClaw could not start the account.`);
        }

        const polledResult = await pollChannelAccount({
          signal: controller.signal,
          read: async () => {
            const refreshedCenter = await loadCenter(controller.signal);
            const refreshedProvider = refreshedCenter?.providers.find((provider) => provider.id === selectedProvider.id) ?? null;
            const refreshedAccount = refreshedProvider?.accounts.find((account) => account.accountId === verifiedAccount.accountId) ?? null;
            if (!refreshedAccount) return { center: refreshedCenter, account: null, presentation: null };
            return {
              center: refreshedCenter,
              account: refreshedAccount,
              presentation: presentChannelAccountState({
                accountId: refreshedAccount.accountId,
                configured: refreshedAccount.configured,
                enabled: refreshedAccount.enabled,
                linked: refreshedAccount.linked,
                running: refreshedAccount.running,
                connected: refreshedAccount.connected,
                liveStatusAvailable: refreshedAccount.liveStatusAvailable,
                authenticationRequired: refreshedAccount.authenticationRequired,
                lastError: refreshedAccount.lastError,
                healthState: refreshedAccount.healthState,
                credentialState: refreshedAccount.credentialState
              }, { statusError: refreshedCenter?.statusError })
            };
          },
          classify: (value) => classifyChannelAccountPollState({
            operation: "start",
            state: value.presentation?.state
          })
        });
        const polled = polledResult.value;
        if (polled.presentation) {
          presentation = polled.presentation;
        }
        if (polledResult.timedOut && presentation.state !== "ONLINE") {
          throw new Error(`${selectedProvider.label} did not come online within the expected time. Current state: ${presentation.label}.`);
        }
      }

      if (presentation.state !== "ONLINE") {
        throw new Error(`${successMessage} OpenClaw reported “${presentation.label}”: ${presentation.detail}`);
      }

      toast.success(`${selectedProvider.label} account is online.`, {
        description: created ? "OpenClaw confirmed the account. Choose a real group or channel next." : successMessage
      });
      setToken("");
      setBotToken("");
      setAppToken("");
      await onRefresh();
      onOpenChange(false);
    } catch (saveError) {
      if (saveError instanceof Error && saveError.name === "AbortError") return;
      const message = saveError instanceof Error ? saveError.message : "The account could not be added.";
      setError(message);
      toast.error("Account setup failed.", { description: message });
    } finally {
      if (setupControllerRef.current === controller) setupControllerRef.current = null;
      setSaving(false);
    }
  }

  const openControlUi = async () => {
    try {
      const response = await fetch("/api/openclaw/dashboard", { method: "POST", cache: "no-store" });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to open the OpenClaw Control UI.");
      toast.success("OpenClaw Control UI opened.");
      onOpenChange(false);
    } catch (openError) {
      toast.error(openError instanceof Error ? openError.message : "Unable to open the OpenClaw Control UI.");
    }
  };

  const setupMode = selectedProvider?.setupMode;
  const needsExternalSetup = !selectedProvider?.capabilities.supportsTokenSetup && setupMode !== "qr";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-[620px] rounded-[22px]">
        <DialogHeader>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Plus className="h-5 w-5" />
            </span>
            <div>
              <DialogTitle>Connect account</DialogTitle>
              <DialogDescription className="mt-1">
                Choose an existing account or connect a new one. After it is online, choose a real group or channel for the selected Agent.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading OpenClaw providers…
          </div>
        ) : error && !selectedProvider ? (
          <div className="rounded-xl border border-destructive/25 bg-destructive/10 p-3 text-xs text-destructive">{error}</div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Workspace" htmlFor="channel-center-workspace">
                <select
                  id="channel-center-workspace"
                  value={workspaceId}
                  onChange={(event) => setWorkspaceId(event.target.value)}
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                  disabled={saving}
                >
                  {snapshot.workspaces.length === 0 ? <option value="">No workspace available</option> : null}
                  {snapshot.workspaces.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </select>
              </Field>
              <Field label="Provider" htmlFor="channel-center-provider">
                <select
                  id="channel-center-provider"
                  value={selectedProvider?.id ?? ""}
                  onChange={(event) => setProviderId(event.target.value || null)}
                  className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground"
                  disabled={saving || providers.length === 0}
                >
                  {providers.length === 0 ? <option value="">No provider reported</option> : null}
                  {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
                </select>
              </Field>
            </div>

            {selectedProvider ? (
              <div className="rounded-xl border border-border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-foreground">{selectedProvider.label}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{selectedProvider.description}</p>
                  </div>
                  <Badge variant="muted" className="rounded-full px-2 text-[10px]">
                    {selectedProvider.capabilities.supportsAccounts ? `${accounts.length} runtime account${accounts.length === 1 ? "" : "s"}` : "Setup required"}
                  </Badge>
                </div>

                {accounts.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Existing accounts</p>
                    {accounts.map((account) => {
                      const attached = attachedAccountIds.has(account.accountId);
                      const presentation = presentChannelAccountState({
                        accountId: account.accountId,
                        configured: account.configured,
                        enabled: account.enabled,
                        linked: account.linked,
                        running: account.running,
                        connected: account.connected,
                        liveStatusAvailable: account.liveStatusAvailable,
                        authenticationRequired: account.authenticationRequired,
                        lastError: account.lastError,
                        healthState: account.healthState,
                        credentialState: account.credentialState
                      }, { statusError: center?.statusError });
                      const usable = presentation.state === "ONLINE" || presentation.state === "READY" || presentation.state === "STOPPED";
                      return (
                        <div key={account.accountId} className="flex flex-col gap-2 rounded-lg border border-border bg-background/60 p-2.5 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2"><p className="truncate text-xs font-medium text-foreground">{account.name}</p><Badge variant="muted" className="h-5 rounded-full px-2 text-[9px]">{presentation.label}</Badge></div>
                            <p className="truncate font-mono text-[10px] text-muted-foreground">{account.accountId}</p>
                            {!usable ? <p className="mt-1 text-[10px] leading-4 text-amber-700 dark:text-amber-200">{presentation.detail}</p> : null}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant={attached ? "ghost" : "secondary"}
                            className="h-8 rounded-lg px-3 text-[11px]"
                            disabled={attached || saving || !workspace || !usable}
                            onClick={() => {
                              void saveAccount({
                                channelId: account.accountId,
                                type: selectedProvider.id,
                                name: account.name,
                                workspacePath: workspace?.path ?? ""
                              }, `${account.name} is attached to ${workspace?.name ?? "the workspace"}.`);
                            }}
                          >
                            {attached ? "Attached" : "Attach"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {selectedProvider.capabilities.supportsTokenSetup ? (
                  <div className="mt-4 space-y-3 border-t border-border pt-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Connect a new account</p>
                      <p className="mt-1 text-xs text-muted-foreground">Credentials are sent to OpenClaw for setup and are not rendered back into the UI.</p>
                    </div>
                    <Field label="Account name" htmlFor="channel-center-account-name">
                      <Input id="channel-center-account-name" value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder={`${selectedProvider.label} account`} disabled={saving} />
                    </Field>
                    {selectedProvider.setupMode === "app-tokens" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Bot token" htmlFor="channel-center-bot-token"><Input id="channel-center-bot-token" type="password" value={botToken} onChange={(event) => setBotToken(event.target.value)} autoComplete="off" disabled={saving} /></Field>
                        <Field label="App token" htmlFor="channel-center-app-token"><Input id="channel-center-app-token" type="password" value={appToken} onChange={(event) => setAppToken(event.target.value)} autoComplete="off" disabled={saving} /></Field>
                      </div>
                    ) : (
                      <Field label="Bot token" htmlFor="channel-center-token"><Input id="channel-center-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" placeholder="Paste the token into this field" disabled={saving} /></Field>
                    )}
                    <Button type="button" className="w-full sm:w-auto" disabled={!workspace || !canCreateTokenAccount || saving} onClick={() => void createTokenAccount()}>
                      {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Link2 className="mr-1.5 h-4 w-4" />}
                      Connect account
                    </Button>
                  </div>
                ) : setupMode === "qr" || needsExternalSetup ? (
                  <div className="mt-4 flex flex-col gap-3 rounded-lg border border-amber-300/30 bg-amber-50/60 p-3 dark:border-amber-300/20 dark:bg-amber-400/[0.06] sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-xs font-medium text-foreground">Use OpenClaw native setup</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">This provider requires a native QR, host, or external CLI flow that AgentOS does not reproduce.</p>
                    </div>
                    <Button type="button" variant="secondary" size="sm" className="h-8 rounded-lg px-3 text-[11px]" onClick={() => void openControlUi()}>
                      Open Control UI <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={saving}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
