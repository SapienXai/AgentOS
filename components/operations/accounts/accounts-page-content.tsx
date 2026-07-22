"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AlertTriangle, Chrome, Filter, Fingerprint, Gauge, Info, KeyRound, Play, RefreshCw, Search, SlidersHorizontal, SquareArrowOutUpRight, UserCog, X } from "lucide-react";
import Link from "next/link";

import { AccountIcon } from "@/components/mission-control/account-icon";
import { EmptyState, EntityIcon, FilterChip, KeyValue, MiniBadge, OperationsPageLayout, PageHeader, SearchToolbar, SectionCard, StatCard, StatGrid, StatusBadge, ToolbarButton } from "@/components/operations/operations-ui";
import { accountLoginExamples, resolveConnectAccountWebsite, type ConnectAccountWebsiteExample } from "@/components/operations/connect-account-url";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PikoLoader } from "@/components/ui/piko-loader";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAccountsData } from "@/components/operations/accounts/use-accounts-data";
import { useDeploymentCapabilities } from "@/hooks/use-deployment-capabilities";
import type { AccountAccessPermission, AccountAccessRuleView } from "@/lib/agentos/account-access-policy-types";
import type { AccountLoginTargetView } from "@/lib/agentos/account-login-target-types";
import type { AgentRecord, MissionControlSnapshot, WorkspaceRecord } from "@/lib/agentos/contracts";
import type { OpenClawBrowserDriver, OpenClawBrowserProfileView } from "@/lib/openclaw/browser-profile-types";
import { cn } from "@/lib/utils";

type ConnectAccountThemeStyle = CSSProperties & Record<`--ca-${string}`, string>;

const connectAccountThemeStyles: Record<"dark" | "light", ConnectAccountThemeStyle> = {
  dark: {
    "--ca-surface": "radial-gradient(circle at 8% 0%, rgba(124,58,237,0.16), transparent 30%), linear-gradient(135deg, rgba(16,20,31,0.99), rgba(8,11,19,0.99) 66%)",
    "--ca-panel": "rgba(255,255,255,0.045)",
    "--ca-panel-strong": "rgba(2,6,23,0.62)",
    "--ca-panel-hover": "rgba(255,255,255,0.085)",
    "--ca-border": "rgba(255,255,255,0.11)",
    "--ca-border-subtle": "rgba(255,255,255,0.07)",
    "--ca-text-strong": "#f8fafc",
    "--ca-text": "#dbe4f0",
    "--ca-text-muted": "#9ba9ba",
    "--ca-accent": "#c4b5fd",
    "--ca-accent-soft": "rgba(139,92,246,0.17)"
  },
  light: {
    "--ca-surface": "radial-gradient(circle at 8% 0%, rgba(124,58,237,0.1), transparent 32%), linear-gradient(135deg, rgba(255,253,251,0.99), rgba(248,244,240,0.99) 66%)",
    "--ca-panel": "rgba(255,255,255,0.72)",
    "--ca-panel-strong": "rgba(255,255,255,0.92)",
    "--ca-panel-hover": "rgba(109,40,217,0.09)",
    "--ca-border": "rgba(91,70,57,0.2)",
    "--ca-border-subtle": "rgba(91,70,57,0.13)",
    "--ca-text-strong": "#241b16",
    "--ca-text": "#493a31",
    "--ca-text-muted": "#736258",
    "--ca-accent": "#6d28d9",
    "--ca-accent-soft": "rgba(109,40,217,0.1)"
  }
};

export function AccountsPageContent({
  snapshot,
  activeWorkspace,
  activeWorkspaceId,
  surfaceTheme
}: {
  snapshot: MissionControlSnapshot;
  activeWorkspace: WorkspaceRecord | null;
  activeWorkspaceId: string | null;
  surfaceTheme: "dark" | "light";
}) {
  const deployment = useDeploymentCapabilities();
  const interactiveBrowserLoginSupported = deployment.interactiveBrowserLogin === "supported";
  const {
    profiles,
    loginTargets,
    accessRules,
    loading,
    targetsLoading,
    accessRulesLoading,
    error,
    targetsError,
    accessRulesError,
    loadProfiles,
    loadLoginTargets,
    loadAccessRules,
    postProfileMutation,
    saveLoginTarget,
    saveAccessRulesForTarget,
    deleteLoginTarget
  } = useAccountsData(activeWorkspaceId);
  const [profileSearch, setProfileSearch] = useState("");
  const [driverFilter, setDriverFilter] = useState<"all" | OpenClawBrowserDriver>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "running" | "stopped">("all");
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [manageAccessTarget, setManageAccessTarget] = useState<AccountLoginTargetView | null>(null);
  const [missionTarget, setMissionTarget] = useState<AccountLoginTargetView | null>(null);
  const [busyProfileName, setBusyProfileName] = useState<string | null>(null);
  const [busyLoginTargetId, setBusyLoginTargetId] = useState<string | null>(null);
  const [recoveryActionBusy, setRecoveryActionBusy] = useState<"restart" | null>(null);
  const workspaceAgents = useMemo(
    () => snapshot.agents.filter((agent) => !activeWorkspaceId || agent.workspaceId === activeWorkspaceId),
    [activeWorkspaceId, snapshot.agents]
  );
  const browserAgentCount = workspaceAgents.filter(agentHasBrowserAccess).length;
  const runnableAccessRuleCount = accessRules.filter((rule) => rule.permission === "use_browser_profile").length;
  const approvalBlockedAccessRuleCount = accessRules.filter((rule) => rule.permission === "requires_approval").length;
  const visibleProfiles = useMemo(
    () => deployment.existingBrowserSession === "supported"
      ? profiles
      : profiles.filter((profile) => profile.driver !== "existing-session"),
    [deployment.existingBrowserSession, profiles]
  );
  const usableProfiles = useMemo(() => visibleProfiles.filter(isUsableAccountBrowserProfile), [visibleProfiles]);
  const hiddenUnavailableProfiles = useMemo(() => visibleProfiles.filter((profile) => !isUsableAccountBrowserProfile(profile)), [visibleProfiles]);
  const runningCount = usableProfiles.filter((profile) => profile.running).length;
  const managedCount = usableProfiles.filter((profile) => profile.driver === "openclaw").length;
  const existingSessionCount = usableProfiles.filter((profile) => profile.driver === "existing-session").length;
  const tabCount = usableProfiles.reduce((total, profile) => total + profile.tabCount, 0);
  const driverFilters: Array<"all" | OpenClawBrowserDriver> = deployment.existingBrowserSession === "supported"
    ? ["all", "openclaw", "existing-session"]
    : ["all", "openclaw"];
  const statusFilters: Array<"all" | "running" | "stopped"> = ["all", "running", "stopped"];
  const profileNames = useMemo(() => new Set(usableProfiles.map((profile) => profile.name)), [usableProfiles]);
  const accessRulesByTargetId = useMemo(() => {
    const rulesByTarget = new Map<string, AccountAccessRuleView[]>();

    for (const rule of accessRules) {
      const current = rulesByTarget.get(rule.targetId) ?? [];
      current.push(rule);
      rulesByTarget.set(rule.targetId, current);
    }

    return rulesByTarget;
  }, [accessRules]);
  const agentsByWorkspaceId = useMemo(() => {
    const byWorkspace = new Map<string, AgentRecord[]>();

    for (const agent of snapshot.agents) {
      const current = byWorkspace.get(agent.workspaceId) ?? [];
      current.push(agent);
      byWorkspace.set(agent.workspaceId, current);
    }

    return byWorkspace;
  }, [snapshot.agents]);
  const searchQuery = profileSearch.trim().toLowerCase();
  const filteredLoginTargets = loginTargets.filter((target) => {
    if (!searchQuery) {
      return true;
    }

    return [
      target.serviceName,
      target.primaryDomain,
      target.browserProfileName,
      target.workspaceName,
      target.statusLabel,
      target.loginUrl
    ].join(" ").toLowerCase().includes(searchQuery);
  });
  const filteredProfiles = usableProfiles.filter((profile) => {
    const matchesSearch =
      !searchQuery ||
      [
        profile.name,
        profile.driverLabel,
        profile.transportLabel,
        profile.statusLabel,
        profile.cdpUrl ?? "",
        profile.reconcileReason ?? ""
      ].join(" ").toLowerCase().includes(searchQuery);
    const matchesDriver = driverFilter === "all" || profile.driver === driverFilter;
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "running" ? profile.running : !profile.running);

    return matchesSearch && matchesDriver && matchesStatus;
  });

  useEffect(() => {
    if (!activeWorkspaceId || typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("connect") === "1" && interactiveBrowserLoginSupported) {
      setConnectDialogOpen(true);
    }
  }, [activeWorkspaceId, interactiveBrowserLoginSupported]);

  const removeLoginTarget = async (target: AccountLoginTargetView) => {
    setBusyLoginTargetId(target.id);

    try {
      await deleteLoginTarget(target);
      await loadAccessRules();
      toast.success("Login target forgotten.", {
        description: "Only the AgentOS account list entry was removed. Browser profile sessions were not changed."
      });
    } catch (removeError) {
      toast.error("Login target was not removed.", {
        description: readBrowserProfileError(removeError, "Unable to remove account login target.")
      });
    } finally {
      setBusyLoginTargetId(null);
    }
  };

  const openLoginTarget = async (target: AccountLoginTargetView) => {
    if (!interactiveBrowserLoginSupported) {
      toast.error("Interactive browser login is unavailable in Railway.", {
        description: "The managed Chromium browser is headless. Use browser automation for public pages or a supported integration for authenticated access."
      });
      return;
    }

    setBusyLoginTargetId(target.id);

    try {
      await postProfileMutation(
        {
          action: "open-login",
          profileName: target.browserProfileName,
          loginUrl: target.loginUrl,
          label: buildConnectAccountTabLabel(target.serviceId)
        },
        "Unable to open the login URL in OpenClaw."
      );
      await saveLoginTarget({
        workspaceId: target.workspaceId,
        workspaceName: target.workspaceName,
        workspacePath: target.workspacePath,
        serviceId: target.serviceId,
        serviceName: target.serviceName,
        primaryDomain: target.primaryDomain,
        loginUrl: target.loginUrl,
        browserProfileName: target.browserProfileName
      });
      await loadProfiles();
      toast.success("Login browser opened.", {
        description: `${target.serviceName} opened in ${target.browserProfileName}.`
      });
    } catch (openError) {
      toast.error("Login browser did not open.", {
        description: readBrowserProfileError(openError, "Unable to open the login URL in OpenClaw.")
      });
    } finally {
      setBusyLoginTargetId(null);
    }
  };

  const startProfile = async (profile: OpenClawBrowserProfileView) => {
    setBusyProfileName(profile.name);

    try {
      await postProfileMutation(
        { action: "start-profile", profileName: profile.name },
        `Unable to start ${profile.name}.`
      );
      toast.success("Browser profile started.", {
        description: `${profile.name} is now available through OpenClaw.`
      });
      await loadProfiles();
    } catch (startError) {
      toast.error("Browser profile did not start.", {
        description: readBrowserProfileError(startError, `Unable to start ${profile.name}.`)
      });
    } finally {
      setBusyProfileName(null);
    }
  };

  const restartGatewayForProfiles = async () => {
    setRecoveryActionBusy("restart");

    try {
      const response = await fetch("/api/gateway/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restart" })
      });
      const payload = await response.json().catch(() => null) as { message?: string; error?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to restart the OpenClaw Gateway.");
      }

      toast.success(payload?.message ?? "Gateway restart requested.", {
        description: "Retrying browser profile discovery after the Gateway restart."
      });
      await loadProfiles();
    } catch (restartError) {
      toast.error("Gateway restart did not complete.", {
        description: readBrowserProfileError(restartError, "Open diagnostics to inspect the OpenClaw Gateway state.")
      });
    } finally {
      setRecoveryActionBusy(null);
    }
  };

  const connectAccount = async (input: ConnectBrowserProfileInput) => {
    if (!interactiveBrowserLoginSupported) {
      toast.error("Interactive browser login is unavailable in Railway.");
      return;
    }

    if (!activeWorkspace) {
      toast.error("Select a workspace before connecting an account.");
      return;
    }

    setBusyProfileName(input.profileName);

    try {
      await postProfileMutation(
        {
          action: "open-login",
          profileName: input.profileName,
          loginUrl: input.loginUrl,
          label: input.label
        },
        "Unable to open the login URL in OpenClaw."
      );

      await saveLoginTarget({
        workspaceId: activeWorkspace.id,
        workspaceName: activeWorkspace.name,
        workspacePath: activeWorkspace.path ?? null,
        serviceId: input.serviceId,
        serviceName: input.serviceName,
        primaryDomain: input.primaryDomain,
        loginUrl: input.loginUrl,
        browserProfileName: input.profileName
      });

      toast.success("Login browser opened.", {
        description: "Complete the login in the OpenClaw browser profile. AgentOS saved only the login target."
      });
      setConnectDialogOpen(false);
      await loadProfiles();
    } catch (connectError) {
      toast.error("Connect Account did not complete.", {
        description: readBrowserProfileError(connectError, "Unable to open the login browser.")
      });
    } finally {
      setBusyProfileName(null);
    }
  };

  return (
    <>
      <OperationsPageLayout
        main={
          <>
            <PageHeader
              surfaceTheme={surfaceTheme}
              title="Accounts"
              subtitle="Manage real OpenClaw browser profiles used for reusable account sessions."
              primaryAction={{
                label: "Connect Account",
                icon: KeyRound,
                onClick: () => setConnectDialogOpen(true),
                disabled: !activeWorkspaceId || !interactiveBrowserLoginSupported,
                title: !interactiveBrowserLoginSupported
                  ? "Interactive login is unavailable because Railway runs the managed Chromium browser headlessly."
                  : activeWorkspaceId
                    ? "Open a login flow in an OpenClaw browser profile for this workspace."
                  : "Select a workspace before connecting account sessions."
              }}
            >
              <div className="flex flex-wrap items-center gap-2">
                <MiniBadge>Workspace: {activeWorkspace?.name ?? "All workspaces"}</MiniBadge>
                <MiniBadge>{activeWorkspace?.path ?? activeWorkspace?.slug ?? "Read-only overview"}</MiniBadge>
                <MiniBadge>Source: OpenClaw profiles + AgentOS login targets</MiniBadge>
              </div>
            </PageHeader>

            <StatGrid columns={5}>
              <StatCard label="Profiles" value={loading ? "-" : String(usableProfiles.length)} detail={`${managedCount} managed, ${existingSessionCount} attached session`} icon={Chrome} tone="info" />
              <StatCard label="Login Targets" value={targetsLoading ? "-" : String(loginTargets.length)} detail="Created through Connect Account" icon={KeyRound} tone={loginTargets.length > 0 ? "success" : "muted"} />
              <StatCard label="Running" value={loading ? "-" : String(runningCount)} detail={`${tabCount} open browser tabs`} icon={Fingerprint} tone={runningCount > 0 ? "success" : "muted"} />
              <StatCard label="Runnable Access" value={accessRulesLoading ? "-" : String(runnableAccessRuleCount)} detail={`${browserAgentCount} browser-capable agents · ${approvalBlockedAccessRuleCount} approval-blocked`} icon={UserCog} tone={runnableAccessRuleCount > 0 ? "success" : "muted"} />
              <StatCard label="Gateway State" value={error ? "Blocked" : loading ? "Checking" : "Ready"} detail={error ? "OpenClaw browser unavailable" : "Real browser profile API"} icon={Gauge} tone={error ? "warning" : "success"} />
            </StatGrid>

            <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-xs leading-5 text-foreground">
              {deployment.browserAutomation === "server-headless"
                ? "Railway runs OpenClaw browser automation in headless Chromium. Agents can navigate, click, type, and capture screenshots, but operators cannot complete interactive login or two-factor prompts in that browser."
                : "AgentOS does not store raw passwords. Sessions are stored in OpenClaw browser profiles."}
            </div>

            {hiddenUnavailableProfiles.length > 0 ? (
              <div className="rounded-[12px] border border-[hsl(var(--status-warning)/0.24)] bg-[hsl(var(--status-warning)/0.10)] px-3 py-2.5 text-xs leading-5 text-[hsl(var(--status-warning-foreground))]">
                {hiddenUnavailableProfiles.length} OpenClaw browser profile{hiddenUnavailableProfiles.length === 1 ? "" : "s"} reported by Gateway are hidden because they are not attached or usable for account login yet.
              </div>
            ) : null}

            <SectionCard title="Browser Profile Access">
              <div className="grid gap-3 p-3 text-xs leading-5 text-foreground/80 lg:grid-cols-2">
                <div>
                  <p className="font-semibold text-foreground">What works here</p>
                  <p className="mt-1 text-muted-foreground">
                    {deployment.browserAutomation === "server-headless"
                      ? "AgentOS reads and starts managed OpenClaw profiles for headless agent automation, including navigation, clicks, typing, and screenshots."
                      : "AgentOS reads OpenClaw browser profiles, starts a profile, opens a login URL, and records the workspace login target after that browser action succeeds."}
                  </p>
                </div>
                <div>
                  <p className="font-semibold text-foreground">What is not exposed yet</p>
                  <p className="mt-1 text-muted-foreground">OpenClaw does not expose verified website account identities or a direct browser-profile dispatch parameter to AgentOS. Agent access is enforced by AgentOS before account-target task launch.</p>
                </div>
              </div>
            </SectionCard>

            <SearchToolbar
              search={profileSearch}
              onSearchChange={setProfileSearch}
              searchPlaceholder="Search login targets and browser profiles..."
              surfaceTheme={surfaceTheme}
            >
              <ToolbarButton
                surfaceTheme={surfaceTheme}
                icon={Filter}
                label={`State: ${formatBrowserProfileStateFilter(statusFilter)}`}
                active={statusFilter !== "all"}
                chevron
                onClick={() => setStatusFilter((current) => statusFilters[(statusFilters.indexOf(current) + 1) % statusFilters.length])}
              />
              <ToolbarButton
                surfaceTheme={surfaceTheme}
                icon={SlidersHorizontal}
                label={`Driver: ${formatBrowserDriverFilter(driverFilter)}`}
                active={driverFilter !== "all"}
                chevron
                onClick={() => setDriverFilter((current) => driverFilters[(driverFilters.indexOf(current) + 1) % driverFilters.length])}
              />
              <ToolbarButton
                surfaceTheme={surfaceTheme}
                icon={RefreshCw}
                label={loading || targetsLoading || accessRulesLoading ? "Refreshing" : "Refresh"}
                active={loading || targetsLoading || accessRulesLoading}
                onClick={() => {
                  void loadProfiles();
                  void loadLoginTargets();
                  void loadAccessRules();
                }}
              />
            </SearchToolbar>

            <SectionCard title="Connected Login Targets">
              {targetsError || accessRulesError ? (
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <EntityIcon icon={AlertTriangle} label="Login targets unavailable" tone="warning" />
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-foreground">Account login targets are unavailable</h2>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{targetsError ?? accessRulesError}</p>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" onClick={() => {
                    void loadLoginTargets();
                    void loadAccessRules();
                  }}>
                    Retry
                  </Button>
                </div>
              ) : targetsLoading || accessRulesLoading ? (
                <div className="p-4 text-xs text-muted-foreground">Loading login targets...</div>
              ) : filteredLoginTargets.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    title={loginTargets.length === 0 ? "No login targets connected" : "No login targets match"}
                    description={loginTargets.length === 0
                      ? interactiveBrowserLoginSupported
                        ? "Use Connect Account to open a login page in a real OpenClaw browser profile. AgentOS will list the target here after the browser action succeeds."
                        : "Interactive browser login is unavailable in Railway. Use supported integrations for authenticated services."
                      : "Clear search to inspect another login target."}
                  />
                </div>
              ) : (
                <div className="grid gap-2.5 p-3 lg:grid-cols-2 min-[1500px]:grid-cols-3">
                  {filteredLoginTargets.map((target) => (
                    <LoginTargetCard
                      key={target.id}
                      target={target}
                      profileAvailable={profileNames.has(target.browserProfileName)}
                      accessRules={accessRulesByTargetId.get(target.id) ?? []}
                      workspaceAgents={agentsByWorkspaceId.get(target.workspaceId) ?? []}
                      busy={busyLoginTargetId === target.id}
                      interactiveBrowserLoginSupported={interactiveBrowserLoginSupported}
                      onOpen={() => void openLoginTarget(target)}
                      onForget={() => void removeLoginTarget(target)}
                      onManageAccess={() => setManageAccessTarget(target)}
                      onRunTask={() => setMissionTarget(target)}
                    />
                  ))}
                </div>
              )}
            </SectionCard>

            <div className="flex flex-wrap items-center gap-2">
              {statusFilters.map((status) => (
                <FilterChip
                  key={status}
                  label={formatBrowserProfileStateFilter(status)}
                  count={status === "all" ? usableProfiles.length : usableProfiles.filter((profile) => status === "running" ? profile.running : !profile.running).length}
                  active={statusFilter === status}
                  tone={status === "running" ? "success" : status === "stopped" ? "muted" : "info"}
                  surfaceTheme={surfaceTheme}
                  onClick={() => setStatusFilter(status)}
                />
              ))}
              {driverFilters.map((driver) => (
                <FilterChip
                  key={driver}
                  label={formatBrowserDriverFilter(driver)}
                  count={driver === "all" ? usableProfiles.length : usableProfiles.filter((profile) => profile.driver === driver).length}
                  active={driverFilter === driver}
                  tone={driver === "existing-session" ? "warning" : driver === "openclaw" ? "info" : "purple"}
                  surfaceTheme={surfaceTheme}
                  onClick={() => setDriverFilter(driver)}
                />
              ))}
            </div>

            {error ? (
              <SectionCard>
                <BrowserProfileRecoveryPanel
                  error={error}
                  variant="section"
                  restartBusy={recoveryActionBusy === "restart"}
                  onRetry={() => void loadProfiles()}
                  onRestartGateway={() => void restartGatewayForProfiles()}
                />
              </SectionCard>
            ) : loading ? (
              <EmptyState title="Loading browser profiles" description="Reading OpenClaw browser profile state through the Gateway." />
            ) : filteredProfiles.length === 0 ? (
              <EmptyState
                title={profiles.length === 0 ? "No browser profiles reported" : usableProfiles.length === 0 ? "No usable browser profiles" : "No profiles match"}
                description={profiles.length === 0 || usableProfiles.length === 0
                  ? interactiveBrowserLoginSupported
                    ? "Create, enable, or attach a usable OpenClaw browser profile first, then use Connect Account to open a manual login flow in that profile."
                    : "No managed OpenClaw browser profiles are currently available for headless automation."
                  : "Clear search or filters to inspect another OpenClaw browser profile."}
              />
            ) : (
              <div className="grid gap-2.5 lg:grid-cols-2 min-[1500px]:grid-cols-3">
                {filteredProfiles.map((profile) => (
                  <BrowserProfileCard
                    key={profile.name}
                    profile={profile}
                    busy={busyProfileName === profile.name}
                    onStart={() => void startProfile(profile)}
                  />
                ))}
              </div>
            )}
          </>
        }
        inspector={null}
      />
      <ConnectAccountWizard
        open={connectDialogOpen}
        workspace={activeWorkspace}
        onOpenChange={setConnectDialogOpen}
        onSubmit={connectAccount}
        profiles={usableProfiles}
        profilesError={error}
        onRetryProfiles={() => void loadProfiles()}
        onRestartGateway={() => void restartGatewayForProfiles()}
        restartGatewayBusy={recoveryActionBusy === "restart"}
        surfaceTheme={surfaceTheme}
      />
      <ManageAccountAccessDialog
        open={Boolean(manageAccessTarget)}
        target={manageAccessTarget}
        agents={manageAccessTarget ? agentsByWorkspaceId.get(manageAccessTarget.workspaceId) ?? [] : []}
        accessRules={manageAccessTarget ? accessRulesByTargetId.get(manageAccessTarget.id) ?? [] : []}
        onOpenChange={(open) => setManageAccessTarget(open ? manageAccessTarget : null)}
        onSave={saveAccessRulesForTarget}
      />
      <AccountTargetMissionDialog
        open={Boolean(missionTarget)}
        target={missionTarget}
        agents={missionTarget ? agentsByWorkspaceId.get(missionTarget.workspaceId) ?? [] : []}
        accessRules={missionTarget ? accessRulesByTargetId.get(missionTarget.id) ?? [] : []}
        onOpenChange={(open) => setMissionTarget(open ? missionTarget : null)}
        onSubmitted={async () => {
          setMissionTarget(null);
          await loadProfiles();
        }}
      />
    </>
  );
}

function BrowserProfileCard({
  profile,
  busy,
  onStart
}: {
  profile: OpenClawBrowserProfileView;
  busy: boolean;
  onStart: () => void;
}) {
  return (
    <SectionCard>
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="flex min-w-0 items-start gap-3">
          <EntityIcon icon={Chrome} label={profile.name} tone="info" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">{profile.name}</h2>
            <p className="mt-1 truncate text-[0.7rem] text-muted-foreground">{profile.driverLabel}</p>
          </div>
        </div>
        <StatusBadge label={profile.statusLabel} tone={profile.statusTone} />
      </div>
      <div className="grid gap-2 border-t border-border p-3 sm:grid-cols-2">
        <KeyValue label="Transport" value={profile.transportLabel} />
        <KeyValue label="Tabs" value={String(profile.tabCount)} />
        <KeyValue label="Default" value={profile.isDefault ? "Yes" : "No"} />
        <KeyValue label="Remote" value={profile.isRemote ? "Yes" : "No"} />
        <KeyValue label="CDP Port" value={profile.cdpPort == null ? "Not reported" : String(profile.cdpPort)} />
        <KeyValue label="CDP URL" value={profile.cdpUrl ?? "Not reported"} />
      </div>
      {profile.missingFromConfig || profile.reconcileReason ? (
        <div className="border-t border-border px-3 py-2 text-[0.68rem] leading-5 text-[hsl(var(--status-warning-foreground))]">
          {profile.reconcileReason ?? "This profile was reported by OpenClaw but is missing from config."}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-border p-3">
        <Button
          variant="secondary"
          size="sm"
          className="h-7 rounded-[8px] px-2 text-[0.7rem]"
          disabled={busy}
          onClick={onStart}
        >
          {profile.running ? "Restart / attach" : "Start profile"}
        </Button>
        <MiniBadge>{profile.driver}</MiniBadge>
        <MiniBadge>{profile.running ? "Browser control active" : "Browser control stopped"}</MiniBadge>
      </div>
    </SectionCard>
  );
}

function LoginTargetCard({
  target,
  profileAvailable,
  accessRules,
  workspaceAgents,
  busy,
  interactiveBrowserLoginSupported,
  onOpen,
  onForget,
  onManageAccess,
  onRunTask
}: {
  target: AccountLoginTargetView;
  profileAvailable: boolean;
  accessRules: AccountAccessRuleView[];
  workspaceAgents: AgentRecord[];
  busy: boolean;
  interactiveBrowserLoginSupported: boolean;
  onOpen: () => void;
  onForget: () => void;
  onManageAccess: () => void;
  onRunTask: () => void;
}) {
  const workspaceAgentIds = new Set(workspaceAgents.map((agent) => agent.id));
  const runnableRules = accessRules.filter(
    (rule) => workspaceAgentIds.has(rule.agentId) && rule.permission === "use_browser_profile"
  );
  const approvalRules = accessRules.filter(
    (rule) => workspaceAgentIds.has(rule.agentId) && rule.permission === "requires_approval"
  );
  const browserCapableRunnableRules = runnableRules.filter((rule) => {
    const agent = workspaceAgents.find((entry) => entry.id === rule.agentId);
    return agent ? agentHasBrowserAccess(agent) : false;
  });

  return (
    <div className="rounded-[12px] border border-border bg-card">
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="flex min-w-0 items-start gap-3">
          <EntityIcon icon={KeyRound} label={target.serviceName} tone="warning" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">{target.serviceName}</h2>
            <p className="mt-1 truncate text-[0.7rem] text-muted-foreground">{target.primaryDomain}</p>
          </div>
        </div>
        <StatusBadge label={target.statusLabel} tone={target.statusTone} />
      </div>
      <div className="grid gap-2 border-t border-border p-3 sm:grid-cols-2">
        <KeyValue label="Browser profile" value={target.browserProfileName} />
        <KeyValue label="Workspace" value={target.workspaceName} />
        <KeyValue label="Last opened" value={formatAccountTimestamp(target.lastOpenedAt)} />
        <KeyValue label="Opened" value={`${target.openCount} time${target.openCount === 1 ? "" : "s"}`} />
        <KeyValue label="Login URL" value={target.loginUrl} />
        <KeyValue label="Source" value="Connect Account" />
      </div>
      <div className="border-t border-border px-3 py-2 text-[0.68rem] leading-5 text-muted-foreground">
        AgentOS records that this login target was opened in the selected browser profile. Website account identity is not verified by OpenClaw.
      </div>
      <div className="border-t border-border px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Agent Access</p>
          <div className="flex flex-wrap gap-1.5">
            <MiniBadge>{runnableRules.length} runnable</MiniBadge>
            {approvalRules.length > 0 ? <MiniBadge>{approvalRules.length} approval-blocked</MiniBadge> : null}
          </div>
        </div>
        {runnableRules.length === 0 && approvalRules.length === 0 ? (
          <p className="mt-2 text-[0.68rem] leading-5 text-muted-foreground">
            No agent can use this account target until access is granted.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {runnableRules.slice(0, 4).map((rule) => (
              <MiniBadge key={rule.id}>{rule.agentName}</MiniBadge>
            ))}
            {runnableRules.length > 4 ? <MiniBadge>+{runnableRules.length - 4} more</MiniBadge> : null}
            {approvalRules.length > 0 ? <MiniBadge>Approval required until dispatch support exists</MiniBadge> : null}
          </div>
        )}
        <p className="mt-2 text-[0.66rem] leading-5 text-muted-foreground">
          AgentOS blocks account-target dispatch for agents without access. OpenClaw does not expose a direct browser-profile dispatch parameter yet.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border p-3">
        <Button
          variant="secondary"
          size="sm"
          className="h-7 rounded-[8px] px-2 text-[0.7rem]"
          disabled={busy || !profileAvailable || !interactiveBrowserLoginSupported}
          title={!interactiveBrowserLoginSupported
            ? "Interactive browser login is unavailable in Railway headless mode."
            : profileAvailable
              ? "Open this login page in its OpenClaw browser profile."
              : "The saved browser profile is not reported by OpenClaw."}
          onClick={onOpen}
        >
          <SquareArrowOutUpRight className="mr-1 h-3 w-3" />
          Open login
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 rounded-[8px] px-2 text-[0.7rem]"
          disabled={busy || !profileAvailable}
          title="Select which workspace agents can use this account target."
          onClick={onManageAccess}
        >
          <UserCog className="mr-1 h-3 w-3" />
          Manage access
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 rounded-[8px] px-2 text-[0.7rem]"
          disabled={busy || !profileAvailable || browserCapableRunnableRules.length === 0}
          title={browserCapableRunnableRules.length > 0 ? "Run a task with an allowed browser-capable agent." : "Grant runnable access to a browser-capable agent first."}
          onClick={onRunTask}
        >
          <Play className="mr-1 h-3 w-3" />
          Run task
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-7 rounded-[8px] px-2 text-[0.7rem]"
          disabled={busy}
          title="Remove this AgentOS list entry only. Browser profile sessions are not changed."
          onClick={onForget}
        >
          <X className="mr-1 h-3 w-3" />
          Forget
        </Button>
        <MiniBadge>{profileAvailable ? "Profile available" : "Profile missing"}</MiniBadge>
      </div>
    </div>
  );
}

type AccountAccessDraft = Record<string, {
  permission: AccountAccessPermission;
  notes: string;
}>;

function ManageAccountAccessDialog({
  open,
  target,
  agents,
  accessRules,
  onOpenChange,
  onSave
}: {
  open: boolean;
  target: AccountLoginTargetView | null;
  agents: AgentRecord[];
  accessRules: AccountAccessRuleView[];
  onOpenChange: (open: boolean) => void;
  onSave: (
    target: AccountLoginTargetView,
    rules: Array<{
      agentId: string;
      agentName: string;
      permission: AccountAccessPermission;
      notes?: string | null;
    }>
  ) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState<AccountAccessDraft>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sortedAgents = useMemo(
    () => [...agents].sort((left, right) => left.name.localeCompare(right.name)),
    [agents]
  );

  useEffect(() => {
    if (!open || !target) {
      return;
    }

    const nextDraft: AccountAccessDraft = {};
    for (const agent of sortedAgents) {
      const rule = accessRules.find((entry) => entry.agentId === agent.id);
      nextDraft[agent.id] = {
        permission: rule?.permission === "requires_approval" ? "requires_approval" : rule?.permission === "use_browser_profile" ? "use_browser_profile" : "no_access",
        notes: rule?.notes ?? ""
      };
    }

    setDraft(nextDraft);
    setError(null);
  }, [accessRules, open, sortedAgents, target]);

  const save = async () => {
    if (!target) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await onSave(
        target,
        sortedAgents.map((agent) => {
          const agentDraft = draft[agent.id] ?? { permission: "no_access" as AccountAccessPermission, notes: "" };
          return {
            agentId: agent.id,
            agentName: agent.name,
            permission: agentHasBrowserAccess(agent) ? agentDraft.permission : "no_access",
            notes: agentDraft.notes
          };
        })
      );
      toast.success("Account access saved.", {
        description: `Agent access for ${target.serviceName} now uses AgentOS policy state.`
      });
      onOpenChange(false);
    } catch (saveError) {
      const message = readBrowserProfileError(saveError, "Unable to save account access rules.");
      setError(message);
      toast.error("Account access was not saved.", {
        description: message
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PikoLoader
        open={saving}
        title="Saving account access"
        description="Updating which workspace agents may use this browser profile."
      />
      <Dialog open={open} onOpenChange={onOpenChange}>
      {target ? (
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto rounded-[18px] p-4">
          <DialogHeader>
            <DialogTitle>Manage Account Access</DialogTitle>
            <DialogDescription>
              Select which workspace agents may use this saved browser profile session.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs leading-5 text-foreground">
            AgentOS enforces this before account-target task launch. Requires approval rules stay blocked until approval dispatch exists.
          </div>

          <SectionCard>
            <div className="grid gap-2 p-3 sm:grid-cols-2">
              <KeyValue label="Account target" value={target.serviceName} />
              <KeyValue label="Domain" value={target.primaryDomain} />
              <KeyValue label="Browser profile" value={target.browserProfileName} />
              <KeyValue label="Workspace" value={target.workspaceName} />
            </div>
          </SectionCard>

          {sortedAgents.length === 0 ? (
            <EmptyState title="No workspace agents" description="Create an agent in this workspace before granting account access." />
          ) : (
            <div className="rounded-[12px] border border-border bg-muted/25">
              {sortedAgents.map((agent) => {
                const canUseBrowser = agentHasBrowserAccess(agent);
                const agentDraft = draft[agent.id] ?? { permission: "no_access" as AccountAccessPermission, notes: "" };

                return (
                  <div key={agent.id} className="grid gap-3 border-b border-border p-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_180px]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-foreground">{agent.name}</p>
                        <MiniBadge>{canUseBrowser ? "Browser-capable" : "Browser tools missing"}</MiniBadge>
                      </div>
                      <p className="mt-1 text-[0.68rem] leading-5 text-muted-foreground">
                        {canUseBrowser
                          ? "This agent can be granted account-target task access."
                          : "Enable browser/chrome tools before this agent can use account sessions."}
                      </p>
                      <Input
                        value={agentDraft.notes}
                        disabled={!canUseBrowser || agentDraft.permission === "no_access"}
                        onChange={(event) => {
                          const notes = event.target.value;
                          setDraft((current) => ({
                            ...current,
                            [agent.id]: {
                              ...(current[agent.id] ?? { permission: "no_access" as AccountAccessPermission, notes: "" }),
                              notes
                            }
                          }));
                        }}
                        placeholder="Optional policy note"
                        className="mt-2 h-8 rounded-[9px] text-xs"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`access-${target.id}-${agent.id}`}>Permission</Label>
                      <select
                        id={`access-${target.id}-${agent.id}`}
                        value={agentDraft.permission}
                        disabled={!canUseBrowser}
                        onChange={(event) => {
                          const permission = normalizeAccessPermission(event.target.value);
                          setDraft((current) => ({
                            ...current,
                            [agent.id]: {
                              ...(current[agent.id] ?? { permission: "no_access" as AccountAccessPermission, notes: "" }),
                              permission
                            }
                          }));
                        }}
                        className="h-9 rounded-[10px] border border-input bg-card px-3 text-xs text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <option value="no_access">No access</option>
                        <option value="use_browser_profile">Can use profile</option>
                        <option value="requires_approval" disabled>Requires approval (coming soon)</option>
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {error ? <div className="rounded-[10px] border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}

          <DialogFooter>
            <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-8 rounded-[9px] bg-primary text-xs text-white hover:bg-primary/90" disabled={saving || sortedAgents.length === 0} onClick={() => void save()}>
              {saving ? "Saving..." : "Save access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
      </Dialog>
    </>
  );
}

function AccountTargetMissionDialog({
  open,
  target,
  agents,
  accessRules,
  onOpenChange,
  onSubmitted
}: {
  open: boolean;
  target: AccountLoginTargetView | null;
  agents: AgentRecord[];
  accessRules: AccountAccessRuleView[];
  onOpenChange: (open: boolean) => void;
  onSubmitted: () => Promise<void>;
}) {
  const allowedAgents = useMemo(() => {
    const ruleByAgentId = new Map(accessRules.map((rule) => [rule.agentId, rule]));
    return agents
      .filter((agent) => agentHasBrowserAccess(agent))
      .filter((agent) => {
        const rule = ruleByAgentId.get(agent.id);
        return rule?.permission === "use_browser_profile";
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [accessRules, agents]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [mission, setMission] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setSelectedAgentId(allowedAgents[0]?.id ?? "");
    setMission("");
    setError(null);
  }, [allowedAgents, open]);

  const submit = async () => {
    if (!target || !selectedAgentId || !mission.trim()) {
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/mission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mission: mission.trim(),
          agentId: selectedAgentId,
          workspaceId: target.workspaceId,
          accountTargetId: target.id
        })
      });
      const result = await response.json().catch(() => null) as { error?: string; summary?: string } | null;

      if (!response.ok || result?.error) {
        throw new Error(result?.error || "Mission dispatch failed.");
      }

      toast.success("Task submitted.", {
        description: result?.summary ?? `${target.serviceName} account target context was attached.`
      });
      onOpenChange(false);
      await onSubmitted();
    } catch (submitError) {
      const message = readBrowserProfileError(submitError, "Mission dispatch failed.");
      setError(message);
      toast.error("Task was not submitted.", {
        description: message
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <PikoLoader
        open={submitting}
        title="Submitting account task"
        description="Dispatching the task with the selected browser-profile context."
      />
      <Dialog open={open} onOpenChange={onOpenChange}>
      {target ? (
        <DialogContent className="max-w-xl rounded-[18px] p-4">
          <DialogHeader>
            <DialogTitle>Run Task With Account</DialogTitle>
            <DialogDescription>
              Dispatch to an allowed browser-capable agent with account target context.
            </DialogDescription>
          </DialogHeader>

          <SectionCard>
            <div className="grid gap-2 p-3 sm:grid-cols-2">
              <KeyValue label="Account target" value={target.serviceName} />
              <KeyValue label="Browser profile" value={target.browserProfileName} />
              <KeyValue label="Domain" value={target.primaryDomain} />
              <KeyValue label="Dispatch enforcement" value="AgentOS policy guard" />
            </div>
          </SectionCard>

          <div className="rounded-[10px] border border-[hsl(var(--status-warning)/0.24)] bg-[hsl(var(--status-warning)/0.10)] px-3 py-2 text-xs leading-5 text-[hsl(var(--status-warning-foreground))]">
            OpenClaw does not expose a direct browser-profile dispatch parameter yet. AgentOS blocks unauthorized agents and includes the selected profile/session as task context.
          </div>

          {allowedAgents.length === 0 ? (
            <EmptyState title="No allowed browser-capable agents" description="Grant account access to a browser-capable agent before running a task with this login target." />
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`account-task-agent-${target.id}`}>Agent</Label>
                <select
                  id={`account-task-agent-${target.id}`}
                  value={selectedAgentId}
                  onChange={(event) => setSelectedAgentId(event.target.value)}
                  className="h-9 rounded-[10px] border border-input bg-card px-3 text-xs text-foreground"
                >
                  {allowedAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </select>
              </div>
              <Textarea
                value={mission}
                onChange={(event) => setMission(event.target.value)}
                placeholder={`Describe what the agent should do using ${target.serviceName}...`}
                className="min-h-32 rounded-[12px] text-sm"
              />
            </>
          )}

          {error ? <div className="rounded-[10px] border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div> : null}

          <DialogFooter>
            <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 rounded-[9px] bg-primary text-xs text-white hover:bg-primary/90"
              disabled={submitting || allowedAgents.length === 0 || !selectedAgentId || !mission.trim()}
              onClick={() => void submit()}
            >
              {submitting ? "Submitting..." : "Submit task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
      </Dialog>
    </>
  );
}

export type ConnectBrowserProfileInput = {
  mode: ConnectBrowserProfileMode;
  profileName: string;
  loginUrl: string;
  label: string;
  serviceId: string;
  serviceName: string;
  primaryDomain: string;
};

type ConnectBrowserProfileMode = "existing" | "signed-in-chrome";

export function ConnectAccountWizard({
  open,
  workspace,
  onOpenChange,
  onSubmit,
  profiles,
  profilesError = null,
  onRetryProfiles,
  onRestartGateway,
  restartGatewayBusy = false,
  surfaceTheme = "dark"
}: {
  open: boolean;
  workspace: WorkspaceRecord | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: ConnectBrowserProfileInput) => Promise<void>;
  profiles: OpenClawBrowserProfileView[];
  profilesError?: string | null;
  onRetryProfiles?: () => void;
  onRestartGateway?: () => void;
  restartGatewayBusy?: boolean;
  surfaceTheme?: "dark" | "light";
}) {
  const deployment = useDeploymentCapabilities();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        deployment.interactiveBrowserLogin === "supported" ? <ConnectAccountWizardContent
          key={workspace?.id ?? "no-workspace"}
          workspace={workspace}
          profiles={profiles}
          profilesError={profilesError}
          onRetryProfiles={onRetryProfiles}
          onRestartGateway={onRestartGateway}
          restartGatewayBusy={restartGatewayBusy}
          surfaceTheme={surfaceTheme}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        /> : (
          <DialogContent
            style={connectAccountThemeStyles[surfaceTheme]}
            overlayClassName="bg-black/78 backdrop-blur-lg"
            className="flex h-dvh max-h-dvh w-screen max-w-none flex-col rounded-none border-0 bg-[image:var(--ca-surface)] p-5 pt-[max(1.25rem,env(safe-area-inset-top))] text-[var(--ca-text)] sm:h-auto sm:w-[min(520px,calc(100vw-2rem))] sm:rounded-[18px] sm:border-[var(--ca-border)]"
          >
            <DialogHeader className="pr-10">
              <DialogTitle className="text-[var(--ca-text-strong)]">Interactive browser login is unavailable</DialogTitle>
              <DialogDescription className="text-[var(--ca-text-muted)]">
                Railway runs the managed Chromium browser headlessly. Agents can automate public pages, but an operator cannot complete passwords or two-factor prompts in that browser. Use a supported integration for authenticated access.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-auto pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <Button type="button" variant="secondary" className="h-10 w-full rounded-[8px] sm:w-auto" onClick={() => onOpenChange(false)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        )
      ) : null}
    </Dialog>
  );
}

function ConnectAccountWizardContent({
  workspace,
  profiles,
  profilesError,
  onRetryProfiles,
  onRestartGateway,
  restartGatewayBusy,
  onCancel,
  onSubmit,
  surfaceTheme
}: {
  workspace: WorkspaceRecord | null;
  profiles: OpenClawBrowserProfileView[];
  profilesError: string | null;
  onRetryProfiles?: () => void;
  onRestartGateway?: () => void;
  restartGatewayBusy: boolean;
  onCancel: () => void;
  onSubmit: (input: ConnectBrowserProfileInput) => Promise<void>;
  surfaceTheme: "dark" | "light";
}) {
  const usableProfiles = useMemo(() => profiles.filter(isUsableAccountBrowserProfile), [profiles]);
  const defaultExistingProfileName = useMemo(
    () => usableProfiles.find((profile) => profile.name === "openclaw")?.name ?? usableProfiles[0]?.name ?? "",
    [usableProfiles]
  );
  const signedInChromeProfile = profiles.find((profile) => profile.name === "user") ?? null;
  const hasSignedInChromeProfile = Boolean(signedInChromeProfile);
  const signedInChromeReady = signedInChromeProfile?.running === true;
  const [websiteInput, setWebsiteInput] = useState("");
  const [mode, setMode] = useState<ConnectBrowserProfileMode>("existing");
  const [existingProfileName, setExistingProfileName] = useState(defaultExistingProfileName);
  const [submitting, setSubmitting] = useState(false);
  const [securityTipOpen, setSecurityTipOpen] = useState(false);
  const resolvedWebsite = useMemo(() => resolveConnectAccountWebsite(websiteInput), [websiteInput]);
  const resolvedServiceName = resolvedWebsite?.serviceName ?? "Website";
  const resolvedLoginUrl = resolvedWebsite?.loginUrl ?? "";
  const resolvedDomain = resolvedWebsite?.primaryDomain ?? "";
  const resolvedProfileName =
    mode === "signed-in-chrome"
      ? "user"
      : existingProfileName.trim();
  const validationMessage = validateConnectBrowserProfileInput({
    workspace,
    website: resolvedWebsite,
    mode,
    profileName: resolvedProfileName,
    existingProfileName,
    hasSignedInChromeProfile,
    signedInChromeReady,
    profilesError
  });

  useEffect(() => {
    if (mode !== "existing" || !defaultExistingProfileName) {
      return;
    }

    setExistingProfileName((currentProfileName) => {
      const trimmedProfileName = currentProfileName.trim();
      const currentProfileIsAvailable = trimmedProfileName
        ? usableProfiles.some((profile) => profile.name === trimmedProfileName)
        : false;

      return currentProfileIsAvailable ? currentProfileName : defaultExistingProfileName;
    });
  }, [defaultExistingProfileName, mode, usableProfiles]);

  const submit = async () => {
    if (validationMessage || !workspace || !resolvedWebsite) {
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({
        mode,
        profileName: resolvedProfileName,
        loginUrl: resolvedWebsite.loginUrl,
        label: buildConnectAccountTabLabel(resolvedWebsite.serviceId),
        serviceId: resolvedWebsite.serviceId,
        serviceName: resolvedWebsite.serviceName,
        primaryDomain: resolvedWebsite.primaryDomain
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <TooltipProvider delayDuration={150}>
      <PikoLoader
        open={submitting}
        title="Opening account login"
        description="Opening the selected login URL in its OpenClaw browser profile."
      />
      <DialogContent
        style={connectAccountThemeStyles[surfaceTheme]}
        overlayClassName="bg-black/78 backdrop-blur-lg"
        closeClassName="right-[max(0.75rem,env(safe-area-inset-right))] top-[max(0.75rem,env(safe-area-inset-top))] z-20 h-9 w-9 text-[var(--ca-text)] hover:bg-[var(--ca-panel-hover)] hover:text-[var(--ca-text-strong)]"
        className="flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 bg-[image:var(--ca-surface)] p-0 text-[var(--ca-text)] shadow-[0_0_0_1px_rgba(124,58,237,0.12),0_24px_80px_rgba(0,0,0,0.42)] sm:h-[min(92dvh,760px)] sm:max-h-[92dvh] sm:w-[min(720px,calc(100vw-2rem))] sm:rounded-[18px] sm:border-[var(--ca-border)]"
      >
      <div className="border-b border-[var(--ca-border-subtle)] px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] pr-12 sm:px-5 sm:py-4">
        <DialogHeader>
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--ca-accent-soft)] text-[var(--ca-accent)] shadow-[0_0_20px_rgba(124,58,237,0.2)]">
              <KeyRound className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <DialogTitle className="text-[17px] leading-5 text-[var(--ca-text-strong)]">Connect Account</DialogTitle>
                <Tooltip open={securityTipOpen} onOpenChange={setSecurityTipOpen}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="Account login security information"
                      onClick={() => setSecurityTipOpen(true)}
                      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--ca-text-muted)] transition-colors hover:bg-[var(--ca-panel-hover)] hover:text-[var(--ca-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/60"
                    >
                      <Info className="h-3.5 w-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start" className="z-[10000] max-w-[280px] border-violet-300/25 bg-slate-950 px-3 py-2.5 text-[11px] leading-5 text-slate-100 shadow-[0_12px_32px_rgba(0,0,0,0.32)] dark:border-violet-300/25">
                    AgentOS does not store raw passwords. Complete login manually in the assigned browser profile, or use a supported integration.
                  </TooltipContent>
                </Tooltip>
              </div>
              <DialogDescription className="mt-0.5 text-xs text-[var(--ca-text-muted)]">
                {workspace ? `Open a login flow for ${workspace.name}.` : "Open a login flow in a real OpenClaw browser profile."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
      <div className="flex min-w-0 flex-col gap-4">
        <WizardSectionTitle
          title="Login Target"
          description="Type one website or choose a shortcut. AgentOS opens that URL in the selected OpenClaw browser profile."
        />
        <div className="min-w-0 max-w-full rounded-[14px] border border-[var(--ca-border)] bg-[var(--ca-panel)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
          <div className="flex h-12 items-center gap-3 rounded-[10px] border border-[var(--ca-border)] bg-[var(--ca-panel-strong)] px-4">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input
              id="connect-website-url"
              value={websiteInput}
              onChange={(event) => setWebsiteInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void submit();
                }
              }}
              placeholder="Search or type a website URL"
              className="h-10 min-w-0 border-0 bg-transparent px-0 text-sm text-[var(--ca-text-strong)] shadow-none outline-none placeholder:text-[var(--ca-text-muted)] focus-visible:ring-0"
            />
            {resolvedWebsite ? (
              <AccountIcon
                serviceId={resolvedWebsite.serviceId}
                serviceName={resolvedWebsite.serviceName}
                primaryDomain={resolvedWebsite.primaryDomain}
                className="h-7 w-7 shrink-0 border-border bg-card shadow-none"
              />
            ) : null}
          </div>

          <div className="mt-4 w-full min-w-0 max-w-full overflow-x-auto pb-1" aria-label="Common login targets">
            <div className="flex w-max gap-2 pr-1">
              {accountLoginExamples.map((example) => (
                <WebsiteShortcutButton
                  key={example.id}
                  example={example}
                  active={resolvedWebsite?.serviceId === example.id}
                  onClick={() => setWebsiteInput(example.loginUrl)}
                />
              ))}
            </div>
          </div>
        </div>

        <WizardSectionTitle
          title="Browser Profile"
          description="Select a profile reported by OpenClaw. AgentOS cannot create persistent browser profiles through the current Gateway browser request API."
        />
        {profilesError ? (
          <BrowserProfileRecoveryPanel
            error={profilesError}
            variant="inline"
            restartBusy={restartGatewayBusy}
            onRetry={onRetryProfiles}
            onRestartGateway={onRestartGateway}
          />
        ) : null}
        <div className="grid gap-2 md:grid-cols-2">
          <ProfileModeOption
            active={mode === "existing"}
            title="Existing profile"
            description="Use a profile reported by OpenClaw."
            onClick={() => setMode("existing")}
          />
          {hasSignedInChromeProfile ? (
            <ProfileModeOption
              active={mode === "signed-in-chrome"}
              title="Signed-in Chrome"
              description="Attach to the already-open signed-in Chrome profile reported as user."
              onClick={() => setMode("signed-in-chrome")}
            />
          ) : null}
        </div>

        {mode === "existing" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="connect-existing-profile">Existing browser profile</Label>
            <select id="connect-existing-profile" value={existingProfileName} onChange={(event) => setExistingProfileName(event.target.value)} className="h-9 rounded-[10px] border border-input bg-card px-3 text-xs text-foreground">
              <option value="">Select a browser profile</option>
              {profiles.map((profile) => (
                <option key={profile.name} value={profile.name}>{profile.name} ({profile.driverLabel})</option>
              ))}
            </select>
          </div>
        ) : null}

        {mode === "signed-in-chrome" ? (
          <div className="rounded-[12px] border border-[hsl(var(--status-warning)/0.24)] bg-[hsl(var(--status-warning)/0.10)] px-3 py-2 text-xs leading-5 text-[hsl(var(--status-warning-foreground))]">
            {signedInChromeReady
              ? "Signed-in Chrome is attached through OpenClaw. Use it only when existing cookies matter and the operator is present."
              : "Signed-in Chrome is not attached through OpenClaw yet. Start or attach the user profile from Browser Profiles after launching Chrome with remote debugging, or use the managed openclaw profile."}
          </div>
        ) : null}

        <SectionCard>
          <div className="grid gap-2 p-3 sm:grid-cols-2">
            <KeyValue label="Workspace" value={workspace?.name ?? "No workspace selected"} />
            <KeyValue label="Login target" value={resolvedServiceName} />
            <KeyValue label="Login URL" value={resolvedLoginUrl || "Not set"} />
            <KeyValue label="Primary domain" value={resolvedDomain || "Not set"} />
            <KeyValue label="Browser profile" value={resolvedProfileName || "Not set"} />
            <KeyValue label="Action" value="Open login URL in selected profile" />
          </div>
        </SectionCard>

        <ValidationMessage message={validationMessage} />
      </div>
      </div>

      <DialogFooter className="!flex-row border-t border-[var(--ca-border-subtle)] px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-5 sm:py-3">
        <div className="flex w-full items-center justify-between gap-3">
          <p className="hidden min-w-0 truncate text-[0.7rem] text-[var(--ca-text-muted)] sm:block">{validationMessage ?? "Ready to open a real OpenClaw browser login flow."}</p>
          <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
            <Button variant="secondary" size="sm" className="h-10 flex-1 rounded-[8px] border-[var(--ca-border)] bg-[var(--ca-panel)] text-xs text-[var(--ca-text)] hover:bg-[var(--ca-panel-hover)] sm:h-8 sm:flex-none" onClick={onCancel}>Cancel</Button>
            <Button size="sm" className="h-10 flex-1 rounded-[8px] border border-violet-200/35 bg-[linear-gradient(180deg,rgba(139,92,246,0.98),rgba(109,40,217,0.96))] text-xs text-white shadow-[0_6px_16px_rgba(124,58,237,0.28)] hover:bg-violet-500 sm:h-8 sm:flex-none" disabled={Boolean(validationMessage) || submitting} onClick={() => void submit()}>
              {submitting ? "Opening..." : "Connect Account"}
            </Button>
          </div>
        </div>
      </DialogFooter>
      </DialogContent>
    </TooltipProvider>
  );
}

function ProfileModeOption({
  active,
  title,
  description,
  onClick
}: {
  active: boolean;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[12px] border p-3 text-left",
        active ? "border-primary/40 bg-primary/10" : "border-border bg-muted/25"
      )}
    >
      <p className="text-xs font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-[0.68rem] leading-5 text-muted-foreground">{description}</p>
    </button>
  );
}

function WebsiteShortcutButton({
  example,
  active,
  onClick
}: {
  example: ConnectAccountWebsiteExample;
  active: boolean;
  onClick: () => void;
}) {
  const primaryDomain = example.domains[0] ?? example.loginUrl;

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-[76px] shrink-0 flex-col items-center gap-2 rounded-[14px] border border-transparent px-2 py-2 text-center transition hover:border-primary/25 hover:bg-primary/10",
        active && "border-primary/40 bg-primary/10"
      )}
      title={example.loginUrl}
    >
      <AccountIcon
        serviceId={example.id}
        serviceName={example.service}
        primaryDomain={primaryDomain}
        className="h-11 w-11 border-border bg-card/75 shadow-card transition group-hover:border-primary/30"
      />
      <span className="w-full truncate text-[0.68rem] font-medium text-foreground/80">{example.label}</span>
    </button>
  );
}

function WizardSectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

function ValidationMessage({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <div className="rounded-[10px] border border-[hsl(var(--status-warning)/0.24)] bg-[hsl(var(--status-warning)/0.10)] px-3 py-2 text-xs text-[hsl(var(--status-warning-foreground))]">
      {message}
    </div>
  );
}

function BrowserProfileRecoveryPanel({
  error,
  variant,
  restartBusy,
  onRetry,
  onRestartGateway
}: {
  error: string;
  variant: "section" | "inline";
  restartBusy: boolean;
  onRetry?: () => void;
  onRestartGateway?: () => void;
}) {
  const content = (
    <>
      <div className="flex min-w-0 items-start gap-3">
        <EntityIcon icon={AlertTriangle} label="OpenClaw browser unavailable" tone="warning" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">OpenClaw browser profiles are unavailable</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{error}</p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Recovery path: update OpenClaw if this Gateway does not include browser.request, restart the Gateway after updating or enabling capabilities, then retry profile discovery.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {onRetry ? (
          <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {onRestartGateway ? (
          <Button
            variant="secondary"
            size="sm"
            className="h-8 rounded-[9px] text-xs"
            disabled={restartBusy}
            onClick={onRestartGateway}
          >
            {restartBusy ? "Restarting..." : "Restart Gateway"}
          </Button>
        ) : null}
        <Button asChild variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs">
          <Link href="/settings#diagnostics">Open Diagnostics</Link>
        </Button>
        <Button asChild variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs">
          <Link href="/updates">Update OpenClaw</Link>
        </Button>
      </div>
    </>
  );

  if (variant === "section") {
    return <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">{content}</div>;
  }

  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-[hsl(var(--status-warning)/0.24)] bg-[hsl(var(--status-warning)/0.10)] p-3">
      {content}
    </div>
  );
}

function formatAccountTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function validateConnectBrowserProfileInput(input: {
  workspace: WorkspaceRecord | null;
  website: ReturnType<typeof resolveConnectAccountWebsite>;
  mode: ConnectBrowserProfileMode;
  profileName: string;
  existingProfileName: string;
  hasSignedInChromeProfile: boolean;
  signedInChromeReady: boolean;
  profilesError: string | null;
}) {
  if (!input.workspace) {
    return "Select a workspace before connecting accounts.";
  }

  if (input.profilesError) {
    return "OpenClaw browser profiles are unavailable. Connect Account is disabled until OpenClaw reports usable browser profiles.";
  }

  if (!input.website) {
    return "Enter a valid website URL.";
  }

  if (input.mode === "existing" && !input.existingProfileName.trim()) {
    return "Select an existing OpenClaw browser profile.";
  }

  if (input.mode === "signed-in-chrome" && !input.hasSignedInChromeProfile) {
    return "The signed-in Chrome profile is not reported by OpenClaw.";
  }

  if (input.mode === "signed-in-chrome" && !input.signedInChromeReady) {
    return "Signed-in Chrome is reported by OpenClaw but is not attached yet. Start or attach the user browser profile first, or use the managed openclaw profile.";
  }

  return null;
}

function buildConnectAccountTabLabel(serviceId: string) {
  const base = slugifyClient(serviceId) || "account";
  return `${base}-login-${Date.now().toString(36)}`;
}

function normalizeAccessPermission(value: string): AccountAccessPermission {
  return value === "use_browser_profile" || value === "requires_approval" ? value : "no_access";
}

function formatBrowserProfileStateFilter(status: "all" | "running" | "stopped") {
  return status === "all" ? "All" : status === "running" ? "Running" : "Stopped";
}

function formatBrowserDriverFilter(driver: "all" | OpenClawBrowserDriver) {
  return driver === "all" ? "All" : driver === "existing-session" ? "Existing session" : "Managed";
}

function isUsableAccountBrowserProfile(profile: OpenClawBrowserProfileView) {
  return !(profile.name === "user" && profile.driver === "existing-session" && !profile.running);
}

function readBrowserProfileError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function agentHasBrowserAccess(agent: AgentRecord) {
  const tools = [...(agent.tools ?? []), ...(agent.observedTools ?? [])].map((tool) => tool.toLowerCase());
  return agent.policy.preset === "browser" || tools.some((tool) => tool === "browser" || tool.includes("chrome"));
}

function slugifyClient(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}
