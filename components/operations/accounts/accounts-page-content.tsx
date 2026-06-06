"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Chrome, Filter, Fingerprint, Gauge, KeyRound, Play, RefreshCw, Search, SlidersHorizontal, SquareArrowOutUpRight, UserCog, X } from "lucide-react";

import { AccountIcon } from "@/components/mission-control/account-icon";
import { EmptyState, EntityIcon, FilterChip, KeyValue, MiniBadge, OperationsPageLayout, PageHeader, SearchToolbar, SectionCard, StatCard, StatGrid, StatusBadge, ToolbarButton } from "@/components/operations/operations-ui";
import { accountLoginExamples, resolveConnectAccountWebsite, type ConnectAccountWebsiteExample } from "@/components/operations/connect-account-url";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { Textarea } from "@/components/ui/textarea";
import { useAccountsData } from "@/components/operations/accounts/use-accounts-data";
import type { AccountAccessPermission, AccountAccessRuleView } from "@/lib/agentos/account-access-policy-types";
import type { AccountLoginTargetView } from "@/lib/agentos/account-login-target-types";
import type { AgentRecord, MissionControlSnapshot, WorkspaceRecord } from "@/lib/agentos/contracts";
import type { OpenClawBrowserDriver, OpenClawBrowserProfileView } from "@/lib/openclaw/browser-profile-types";
import { cn } from "@/lib/utils";

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
  const workspaceAgents = useMemo(
    () => snapshot.agents.filter((agent) => !activeWorkspaceId || agent.workspaceId === activeWorkspaceId),
    [activeWorkspaceId, snapshot.agents]
  );
  const browserAgentCount = workspaceAgents.filter(agentHasBrowserAccess).length;
  const runnableAccessRuleCount = accessRules.filter((rule) => rule.permission === "use_browser_profile").length;
  const approvalBlockedAccessRuleCount = accessRules.filter((rule) => rule.permission === "requires_approval").length;
  const usableProfiles = useMemo(() => profiles.filter(isUsableAccountBrowserProfile), [profiles]);
  const hiddenUnavailableProfiles = useMemo(() => profiles.filter((profile) => !isUsableAccountBrowserProfile(profile)), [profiles]);
  const runningCount = usableProfiles.filter((profile) => profile.running).length;
  const managedCount = usableProfiles.filter((profile) => profile.driver === "openclaw").length;
  const existingSessionCount = usableProfiles.filter((profile) => profile.driver === "existing-session").length;
  const tabCount = usableProfiles.reduce((total, profile) => total + profile.tabCount, 0);
  const driverFilters: Array<"all" | OpenClawBrowserDriver> = ["all", "openclaw", "existing-session"];
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
    if (params.get("connect") === "1") {
      setConnectDialogOpen(true);
    }
  }, [activeWorkspaceId]);

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

  const connectAccount = async (input: ConnectBrowserProfileInput) => {
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
                disabled: !activeWorkspaceId,
                title: activeWorkspaceId
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

            <div className="rounded-[12px] border border-cyan-300/18 bg-cyan-400/10 px-3 py-2.5 text-xs leading-5 text-cyan-100">
              AgentOS does not store raw passwords. Sessions are stored in OpenClaw browser profiles.
            </div>

            {hiddenUnavailableProfiles.length > 0 ? (
              <div className="rounded-[12px] border border-amber-300/20 bg-amber-400/10 px-3 py-2.5 text-xs leading-5 text-amber-100">
                {hiddenUnavailableProfiles.length} OpenClaw browser profile{hiddenUnavailableProfiles.length === 1 ? "" : "s"} reported by Gateway are hidden because they are not attached or usable for account login yet.
              </div>
            ) : null}

            <SectionCard title="Browser Profile Access">
              <div className="grid gap-3 p-3 text-xs leading-5 text-slate-300 lg:grid-cols-2">
                <div>
                  <p className="font-semibold text-white">What works here</p>
                  <p className="mt-1 text-slate-400">AgentOS reads OpenClaw browser profiles, starts a profile, opens a login URL, and records the workspace login target after that browser action succeeds.</p>
                </div>
                <div>
                  <p className="font-semibold text-white">What is not exposed yet</p>
                  <p className="mt-1 text-slate-400">OpenClaw does not expose verified website account identities or a direct browser-profile dispatch parameter to AgentOS. Agent access is enforced by AgentOS before account-target task launch.</p>
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
                      <h2 className="text-sm font-semibold text-white">Account login targets are unavailable</h2>
                      <p className="mt-1 text-xs leading-5 text-slate-400">{targetsError ?? accessRulesError}</p>
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
                <div className="p-4 text-xs text-slate-400">Loading login targets...</div>
              ) : filteredLoginTargets.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    title={loginTargets.length === 0 ? "No login targets connected" : "No login targets match"}
                    description={loginTargets.length === 0
                      ? "Use Connect Account to open a login page in a real OpenClaw browser profile. AgentOS will list the target here after the browser action succeeds."
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
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <EntityIcon icon={AlertTriangle} label="OpenClaw browser unavailable" tone="warning" />
                    <div className="min-w-0">
                      <h2 className="text-sm font-semibold text-white">OpenClaw browser profiles are unavailable</h2>
                      <p className="mt-1 text-xs leading-5 text-slate-400">{error}</p>
                    </div>
                  </div>
                  <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" onClick={() => void loadProfiles()}>
                    Retry
                  </Button>
                </div>
              </SectionCard>
            ) : loading ? (
              <EmptyState title="Loading browser profiles" description="Reading OpenClaw browser profile state through the Gateway." />
            ) : filteredProfiles.length === 0 ? (
              <EmptyState
                title={profiles.length === 0 ? "No browser profiles reported" : usableProfiles.length === 0 ? "No usable browser profiles" : "No profiles match"}
                description={profiles.length === 0 || usableProfiles.length === 0
                  ? "Create, enable, or attach a usable OpenClaw browser profile first, then use Connect Account to open a manual login flow in that profile."
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
            <h2 className="truncate text-sm font-semibold text-white">{profile.name}</h2>
            <p className="mt-1 truncate text-[0.7rem] text-slate-400">{profile.driverLabel}</p>
          </div>
        </div>
        <StatusBadge label={profile.statusLabel} tone={profile.statusTone} />
      </div>
      <div className="grid gap-2 border-t border-white/[0.07] p-3 sm:grid-cols-2">
        <KeyValue label="Transport" value={profile.transportLabel} />
        <KeyValue label="Tabs" value={String(profile.tabCount)} />
        <KeyValue label="Default" value={profile.isDefault ? "Yes" : "No"} />
        <KeyValue label="Remote" value={profile.isRemote ? "Yes" : "No"} />
        <KeyValue label="CDP Port" value={profile.cdpPort == null ? "Not reported" : String(profile.cdpPort)} />
        <KeyValue label="CDP URL" value={profile.cdpUrl ?? "Not reported"} />
      </div>
      {profile.missingFromConfig || profile.reconcileReason ? (
        <div className="border-t border-white/[0.07] px-3 py-2 text-[0.68rem] leading-5 text-amber-100">
          {profile.reconcileReason ?? "This profile was reported by OpenClaw but is missing from config."}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] p-3">
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
    <div className="rounded-[12px] border border-white/[0.08] bg-white/[0.035]">
      <div className="flex items-start justify-between gap-3 p-3">
        <div className="flex min-w-0 items-start gap-3">
          <EntityIcon icon={KeyRound} label={target.serviceName} tone="warning" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-white">{target.serviceName}</h2>
            <p className="mt-1 truncate text-[0.7rem] text-slate-400">{target.primaryDomain}</p>
          </div>
        </div>
        <StatusBadge label={target.statusLabel} tone={target.statusTone} />
      </div>
      <div className="grid gap-2 border-t border-white/[0.07] p-3 sm:grid-cols-2">
        <KeyValue label="Browser profile" value={target.browserProfileName} />
        <KeyValue label="Workspace" value={target.workspaceName} />
        <KeyValue label="Last opened" value={formatAccountTimestamp(target.lastOpenedAt)} />
        <KeyValue label="Opened" value={`${target.openCount} time${target.openCount === 1 ? "" : "s"}`} />
        <KeyValue label="Login URL" value={target.loginUrl} />
        <KeyValue label="Source" value="Connect Account" />
      </div>
      <div className="border-t border-white/[0.07] px-3 py-2 text-[0.68rem] leading-5 text-slate-400">
        AgentOS records that this login target was opened in the selected browser profile. Website account identity is not verified by OpenClaw.
      </div>
      <div className="border-t border-white/[0.07] px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-slate-500">Agent Access</p>
          <div className="flex flex-wrap gap-1.5">
            <MiniBadge>{runnableRules.length} runnable</MiniBadge>
            {approvalRules.length > 0 ? <MiniBadge>{approvalRules.length} approval-blocked</MiniBadge> : null}
          </div>
        </div>
        {runnableRules.length === 0 && approvalRules.length === 0 ? (
          <p className="mt-2 text-[0.68rem] leading-5 text-slate-500">
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
        <p className="mt-2 text-[0.66rem] leading-5 text-slate-500">
          AgentOS blocks account-target dispatch for agents without access. OpenClaw does not expose a direct browser-profile dispatch parameter yet.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] p-3">
        <Button
          variant="secondary"
          size="sm"
          className="h-7 rounded-[8px] px-2 text-[0.7rem]"
          disabled={busy || !profileAvailable}
          title={profileAvailable ? "Open this login page in its OpenClaw browser profile." : "The saved browser profile is not reported by OpenClaw."}
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      {target ? (
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto rounded-[18px] border-white/[0.10] bg-[#08111f]/95 p-4">
          <DialogHeader>
            <DialogTitle>Manage Account Access</DialogTitle>
            <DialogDescription>
              Select which workspace agents may use this saved browser profile session.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-[10px] border border-cyan-300/18 bg-cyan-400/10 px-3 py-2 text-xs leading-5 text-cyan-100">
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
            <div className="rounded-[12px] border border-white/[0.08] bg-white/[0.03]">
              {sortedAgents.map((agent) => {
                const canUseBrowser = agentHasBrowserAccess(agent);
                const agentDraft = draft[agent.id] ?? { permission: "no_access" as AccountAccessPermission, notes: "" };

                return (
                  <div key={agent.id} className="grid gap-3 border-b border-white/[0.07] p-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_180px]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-semibold text-white">{agent.name}</p>
                        <MiniBadge>{canUseBrowser ? "Browser-capable" : "Browser tools missing"}</MiniBadge>
                      </div>
                      <p className="mt-1 text-[0.68rem] leading-5 text-slate-500">
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
                        className="mt-2 h-8 rounded-[9px] bg-slate-950/50 text-xs"
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
                        className="h-9 rounded-[10px] border border-white/[0.10] bg-slate-950/50 px-3 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
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

          {error ? <div className="rounded-[10px] border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">{error}</div> : null}

          <DialogFooter>
            <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-8 rounded-[9px] bg-blue-500 text-xs text-white hover:bg-blue-400" disabled={saving || sortedAgents.length === 0} onClick={() => void save()}>
              {saving ? "Saving..." : "Save access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      {target ? (
        <DialogContent className="max-w-xl rounded-[18px] border-white/[0.10] bg-[#08111f]/95 p-4">
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

          <div className="rounded-[10px] border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
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
                  className="h-9 rounded-[10px] border border-white/[0.10] bg-slate-950/50 px-3 text-xs text-white"
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
                className="min-h-32 rounded-[12px] border-white/[0.10] bg-slate-950/50 text-sm text-slate-100"
              />
            </>
          )}

          {error ? <div className="rounded-[10px] border border-rose-300/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">{error}</div> : null}

          <DialogFooter>
            <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8 rounded-[9px] bg-blue-500 text-xs text-white hover:bg-blue-400"
              disabled={submitting || allowedAgents.length === 0 || !selectedAgentId || !mission.trim()}
              onClick={() => void submit()}
            >
              {submitting ? "Submitting..." : "Submit task"}
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

type ConnectBrowserProfileInput = {
  mode: ConnectBrowserProfileMode;
  profileName: string;
  loginUrl: string;
  label: string;
  serviceId: string;
  serviceName: string;
  primaryDomain: string;
};

type ConnectBrowserProfileMode = "existing" | "signed-in-chrome";

function ConnectAccountWizard({
  open,
  workspace,
  onOpenChange,
  onSubmit,
  profiles
}: {
  open: boolean;
  workspace: WorkspaceRecord | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: ConnectBrowserProfileInput) => Promise<void>;
  profiles: OpenClawBrowserProfileView[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? (
        <ConnectAccountWizardContent
          key={workspace?.id ?? "no-workspace"}
          workspace={workspace}
          profiles={profiles}
          onCancel={() => onOpenChange(false)}
          onSubmit={onSubmit}
        />
      ) : null}
    </Dialog>
  );
}

function ConnectAccountWizardContent({
  workspace,
  profiles,
  onCancel,
  onSubmit
}: {
  workspace: WorkspaceRecord | null;
  profiles: OpenClawBrowserProfileView[];
  onCancel: () => void;
  onSubmit: (input: ConnectBrowserProfileInput) => Promise<void>;
}) {
  const defaultExistingProfileName = profiles.find((profile) => profile.name === "openclaw")?.name ?? profiles[0]?.name ?? "";
  const signedInChromeProfile = profiles.find((profile) => profile.name === "user") ?? null;
  const hasSignedInChromeProfile = Boolean(signedInChromeProfile);
  const signedInChromeReady = signedInChromeProfile?.running === true;
  const [websiteInput, setWebsiteInput] = useState("");
  const [mode, setMode] = useState<ConnectBrowserProfileMode>("existing");
  const [existingProfileName, setExistingProfileName] = useState(defaultExistingProfileName);
  const [submitting, setSubmitting] = useState(false);
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
    signedInChromeReady
  });

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
    <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto rounded-[18px] border-white/[0.10] bg-[#08111f]/95 p-4">
      <div className="border-b border-white/[0.08] p-4">
        <DialogHeader>
          <DialogTitle>Connect Account</DialogTitle>
          <DialogDescription>
            Open a login flow in a real OpenClaw browser profile for this workspace.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-3 rounded-[10px] border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
          AgentOS does not store raw passwords. Use manual login inside the assigned browser profile or connect through supported integrations.
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4 p-4">
        <WizardSectionTitle
          title="Login Target"
          description="Type one website or choose a shortcut. AgentOS opens that URL in the selected OpenClaw browser profile."
        />
        <div className="min-w-0 max-w-full rounded-[22px] border border-white/[0.08] bg-white/[0.035] p-3 shadow-[0_20px_48px_rgba(0,0,0,0.24)]">
          <div className="flex h-12 items-center gap-3 rounded-full border border-white/[0.10] bg-slate-950/70 px-4 shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_18px_40px_rgba(15,23,42,0.25)]">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
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
              className="h-10 min-w-0 border-0 bg-transparent px-0 text-sm text-white shadow-none outline-none placeholder:text-slate-500 focus-visible:ring-0"
            />
            {resolvedWebsite ? (
              <AccountIcon
                serviceId={resolvedWebsite.serviceId}
                serviceName={resolvedWebsite.serviceName}
                primaryDomain={resolvedWebsite.primaryDomain}
                className="h-7 w-7 shrink-0 border-white/10 bg-slate-950/40 shadow-none"
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
            <select id="connect-existing-profile" value={existingProfileName} onChange={(event) => setExistingProfileName(event.target.value)} className="h-9 rounded-[10px] border border-white/[0.10] bg-slate-950/50 px-3 text-xs text-white">
              <option value="">Select a browser profile</option>
              {profiles.map((profile) => (
                <option key={profile.name} value={profile.name}>{profile.name} ({profile.driverLabel})</option>
              ))}
            </select>
          </div>
        ) : null}

        {mode === "signed-in-chrome" ? (
          <div className="rounded-[12px] border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs leading-5 text-amber-100">
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

      <DialogFooter className="border-t border-white/[0.08] p-4">
        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[0.7rem] text-slate-500">{validationMessage ?? "Ready to open a real OpenClaw browser login flow."}</p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" onClick={onCancel}>Cancel</Button>
            <Button size="sm" className="h-8 rounded-[9px] bg-blue-500 text-xs text-white hover:bg-blue-400" disabled={Boolean(validationMessage) || submitting} onClick={() => void submit()}>
              {submitting ? "Opening..." : "Connect Account"}
            </Button>
          </div>
        </div>
      </DialogFooter>
    </DialogContent>
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
        active ? "border-blue-300/45 bg-blue-400/12" : "border-white/[0.08] bg-white/[0.035]"
      )}
    >
      <p className="text-xs font-semibold text-white">{title}</p>
      <p className="mt-1 text-[0.68rem] leading-5 text-slate-500">{description}</p>
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
        "group flex w-[76px] shrink-0 flex-col items-center gap-2 rounded-[14px] border border-transparent px-2 py-2 text-center transition hover:border-blue-300/24 hover:bg-blue-400/10",
        active && "border-blue-300/35 bg-blue-400/12"
      )}
      title={example.loginUrl}
    >
      <AccountIcon
        serviceId={example.id}
        serviceName={example.service}
        primaryDomain={primaryDomain}
        className="h-11 w-11 border-white/12 bg-white/[0.04] shadow-[0_10px_22px_rgba(0,0,0,0.18)] transition group-hover:border-blue-200/28"
      />
      <span className="w-full truncate text-[0.68rem] font-medium text-slate-300">{example.label}</span>
    </button>
  );
}

function WizardSectionTitle({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-slate-400">{description}</p>
    </div>
  );
}

function ValidationMessage({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return (
    <div className="rounded-[10px] border border-amber-300/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
      {message}
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
}) {
  if (!input.workspace) {
    return "Select a workspace before connecting accounts.";
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
