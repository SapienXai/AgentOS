"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { BellRing, CircleCheck, Clock3, Gauge, Import, Layers3, Plus, Plug, RefreshCw, SearchCheck, ShieldCheck, SlidersHorizontal, Sparkles, Workflow, X } from "lucide-react";

import { AddModelsDialog } from "@/components/mission-control/add-models/add-models-dialog";
import { WorkspaceChannelsDialog } from "@/components/mission-control/workspace-channels-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import type { AddModelsProviderId, MissionControlSnapshot } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";
import { buildIntegrationViews, integrationStatusIcons, type IntegrationStatus, type IntegrationView } from "@/components/operations/operations-data";
import { EmptyState, EntityIcon, InspectorPanelFrame, KeyValue, MiniBadge, MoreButton, OperationsPageLayout, PageHeader, ProgressBar, SearchToolbar, SectionCard, StatCard, StatGrid, StatusBadge, ToolbarButton, ViewToggle, pageSurface } from "@/components/operations/operations-ui";
import { formatIntegrationSortLabel, formatIntegrationStatusFilterLabel, formatIntegrationStatusLabel, formatManagedBy, integrationStatusToneMap, MetricTile, readClientError, sortIntegrations, statusIconClassName, type IntegrationRuntimeOverride, type IntegrationSortMode } from "@/components/operations/operations-shared";

export function IntegrationsPageContent({
  snapshot,
  rootSnapshot,
  activeWorkspaceId,
  surfaceTheme,
  refresh,
  setSnapshot
}: {
  snapshot: MissionControlSnapshot;
  rootSnapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  surfaceTheme: "dark" | "light";
  refresh: () => Promise<void>;
  setSnapshot: Dispatch<SetStateAction<MissionControlSnapshot>>;
}) {
  const baseIntegrations = useMemo(() => buildIntegrationViews(snapshot), [snapshot]);
  const [runtimeOverrides, setRuntimeOverrides] = useState<Record<string, IntegrationRuntimeOverride>>({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All Categories");
  const [status, setStatus] = useState<"All Statuses" | IntegrationStatus>("All Statuses");
  const [sort, setSort] = useState<IntegrationSortMode>("last-active");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selectedId, setSelectedId] = useState(baseIntegrations[0]?.id ?? "");
  const [runningAction, setRunningAction] = useState<string | null>(null);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [isChannelsDialogOpen, setIsChannelsDialogOpen] = useState(false);
  const [isAddModelsDialogOpen, setIsAddModelsDialogOpen] = useState(false);
  const [initialModelProvider, setInitialModelProvider] = useState<AddModelsProviderId | null>(null);
  const [initialSurfaceProvider, setInitialSurfaceProvider] = useState<IntegrationView["surfaceProvider"] | null>(null);
  const integrations = useMemo(
    () =>
      baseIntegrations.map((integration) => {
        const override = runtimeOverrides[integration.id];
        if (!override) {
          return integration;
        }

        const statusOverride = override.status
          ? {
              status: override.status,
              statusLabel: override.statusLabel ?? integration.statusLabel,
              statusTone: override.statusTone ?? integrationStatusToneMap[override.status]
            }
          : {};

        return {
          ...integration,
          ...override,
          ...statusOverride,
          sourceMethods: Array.from(new Set([
            ...integration.sourceMethods,
            ...(override.sourceMethods ?? [])
          ]))
        };
      }),
    [baseIntegrations, runtimeOverrides]
  );
  const categories = ["All Categories", ...Array.from(new Set(integrations.map((integration) => integration.category)))];
  const statuses: Array<"All Statuses" | IntegrationStatus> = [
    "All Statuses",
    "connected",
    "unknown",
    "pending-setup",
    "missing-credentials",
    "needs-authentication",
    "failed",
    "disabled",
    "unsupported"
  ];
  const sorts: IntegrationSortMode[] = ["last-active", "name", "status", "category"];

  const filteredIntegrations = integrations.filter((integration) => {
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      [
        integration.name,
        integration.category,
        integration.description,
        integration.statusLabel,
        integration.managedBy,
        integration.providerType,
        integration.permissions.join(" "),
        integration.setupRequirements.join(" ")
      ].join(" ").toLowerCase().includes(query);
    const matchesCategory = category === "All Categories" || integration.category === category;
    const matchesStatus = status === "All Statuses" || integration.status === status;
    return matchesSearch && matchesCategory && matchesStatus;
  }).sort((left, right) => sortIntegrations(left, right, sort));
  const selectedIntegration = filteredIntegrations.find((integration) => integration.id === selectedId) ?? filteredIntegrations[0] ?? null;
  const connectedCount = filteredIntegrations.filter((integration) => integration.status === "connected").length;
  const pendingCount = filteredIntegrations.filter((integration) =>
    integration.status === "pending-setup" ||
    integration.status === "missing-credentials" ||
    integration.status === "needs-authentication"
  ).length;
  const failedCount = filteredIntegrations.filter((integration) => integration.status === "failed").length;

  const openSurfaceSetup = (surfaceProvider: IntegrationView["surfaceProvider"] | null = null) => {
    if (!activeWorkspaceId) {
      toast.error("Select a workspace before configuring workspace integrations.", {
        description: "All Workspaces is read-only for integration setup. Pick a workspace from the sidebar first."
      });
      return;
    }

    setInitialSurfaceProvider(surfaceProvider);
    setIsChannelsDialogOpen(true);
  };

  const openModelSetup = (provider: AddModelsProviderId | null = null) => {
    setInitialModelProvider(provider);
    setIsAddModelsDialogOpen(true);
  };

  const handleConfigureIntegration = (integration: IntegrationView) => {
    if (!integration.actionSupport.configure.supported) {
      toast.message("Configure is not available.", {
        description: integration.actionSupport.configure.reason
      });
      return;
    }

    if (integration.modelProvider) {
      openModelSetup(integration.modelProvider);
      return;
    }

    if (integration.surfaceProvider) {
      openSurfaceSetup(integration.surfaceProvider);
      return;
    }

    toast.message("No setup flow is wired for this integration.", {
      description: integration.actionSupport.configure.reason
    });
  };

  const handleReconnectIntegration = async (integration: IntegrationView) => {
    if (!integration.actionSupport.reconnect.supported) {
      toast.message("Reconnect is not available.", {
        description: integration.actionSupport.reconnect.reason
      });
      return;
    }

    const actionKey = `${integration.id}:reconnect`;
    setRunningAction(actionKey);

    try {
      if (integration.modelProvider) {
        const response = await fetch("/api/models/providers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "status",
            provider: integration.modelProvider,
            includeSnapshot: true
          })
        });
        const result = await response.json().catch(() => null) as {
          ok?: boolean;
          message?: string;
          error?: string;
          connection?: {
            connected?: boolean;
            detail?: string | null;
            canConnect?: boolean;
          };
          snapshot?: MissionControlSnapshot;
        } | null;

        if (!response.ok || !result) {
          throw new Error(result?.error || "Model provider status check failed.");
        }

        if (result.snapshot) {
          setSnapshot(result.snapshot);
        }

        const nextStatus: IntegrationStatus = result.connection?.connected
          ? "connected"
          : integration.modelProvider === "ollama"
            ? "pending-setup"
            : "missing-credentials";
        setRuntimeOverrides((current) => ({
          ...current,
          [integration.id]: {
            status: nextStatus,
            statusLabel: formatIntegrationStatusLabel(nextStatus),
            statusTone: integrationStatusToneMap[nextStatus],
            connectionHealth: {
              label: result.connection?.connected ? "Provider status verified" : "Provider not connected",
              detail: result.connection?.detail ?? result.message ?? "Provider status was refreshed through /api/models/providers."
            },
            lastSyncLabel: "Checked just now",
            sourceMethods: ["/api/models/providers"]
          }
        }));

        toast.message(result.connection?.connected ? "Provider is ready." : "Provider needs setup.", {
          description: result.connection?.detail ?? result.message
        });
        return;
      }

      if (integration.surfaceProvider) {
        const response = await fetch(`/api/integrations/${encodeURIComponent(integration.id)}/status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" }
        });
        const result = await response.json().catch(() => null) as {
          ok?: boolean;
          status?: IntegrationStatus;
          statusLabel?: string;
          connectionHealth?: IntegrationView["connectionHealth"];
          lastSyncLabel?: string;
          uptimeLabel?: string;
          rateLimitLabel?: string;
          errorMessage?: string | null;
          sourceMethods?: string[];
          error?: string;
        } | null;

        const resultStatus = result?.status;
        if (!response.ok || !resultStatus) {
          throw new Error(result?.error || "Integration status check failed.");
        }

        setRuntimeOverrides((current) => ({
          ...current,
          [integration.id]: {
            status: resultStatus,
            statusLabel: result.statusLabel ?? formatIntegrationStatusLabel(resultStatus),
            statusTone: integrationStatusToneMap[resultStatus],
            connectionHealth: result.connectionHealth ?? {
              label: formatIntegrationStatusLabel(resultStatus),
              detail: "OpenClaw channel status was refreshed."
            },
            lastSyncLabel: result.lastSyncLabel ?? "Checked just now",
            uptimeLabel: result.uptimeLabel,
            rateLimitLabel: result.rateLimitLabel,
            errorMessage: result.errorMessage,
            sourceMethods: result.sourceMethods
          }
        }));

        toast.message(result.status === "connected" ? "Integration status verified." : "Status check completed.", {
          description: result.connectionHealth?.detail
        });
        return;
      }

      toast.message("Reconnect is not wired for this integration.", {
        description: integration.actionSupport.reconnect.reason
      });
    } catch (error) {
      const message = readClientError(error);
      setRuntimeOverrides((current) => ({
        ...current,
        [integration.id]: {
          status: "unknown",
          statusLabel: "Unknown",
          statusTone: "muted",
          connectionHealth: {
            label: "Status check failed",
            detail: message
          },
          lastSyncLabel: "Check failed",
          errorMessage: message
        }
      }));
      toast.error("Reconnect failed.", {
        description: message
      });
    } finally {
      setRunningAction(null);
    }
  };

  const handleDisableIntegration = async (integration: IntegrationView) => {
    if (!integration.actionSupport.disable.supported) {
      toast.message("Disable is not available.", {
        description: integration.actionSupport.disable.reason
      });
      return;
    }

    if (!activeWorkspaceId) {
      toast.error("Select a workspace before disabling an integration.", {
        description: "All Workspaces cannot safely remove a workspace-specific binding."
      });
      return;
    }

    if (integration.channelIds.length === 0) {
      toast.message("No workspace binding found.", {
        description: "There is no AgentOS workspace integration binding to disconnect."
      });
      return;
    }

    const actionKey = `${integration.id}:disable`;
    setRunningAction(actionKey);

    try {
      for (const channelId of integration.channelIds) {
        const response = await fetch(`/api/workspaces/${encodeURIComponent(activeWorkspaceId)}/channels`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channelId, scope: "workspace" })
        });
        const result = await response.json().catch(() => null) as { error?: string } | null;

        if (!response.ok) {
          throw new Error(result?.error || `Unable to disconnect ${channelId}.`);
        }
      }

      await refresh();
      setRuntimeOverrides((current) => ({
        ...current,
        [integration.id]: {
          status: "disabled",
          statusLabel: "Disabled",
          statusTone: "muted",
          connectionHealth: {
            label: "Disconnected from workspace",
            detail: "The workspace integration binding was removed through the channels API."
          },
          lastSyncLabel: "Updated just now",
          sourceMethods: ["/api/workspaces/[workspaceId]/channels DELETE"]
        }
      }));
      toast.success(`${integration.name} disconnected from this workspace.`);
    } catch (error) {
      toast.error("Disable failed.", {
        description: readClientError(error)
      });
    } finally {
      setRunningAction(null);
    }
  };

  return (
    <>
      <OperationsPageLayout
        main={
          <>
            <PageHeader
              surfaceTheme={surfaceTheme}
              title="Integrations"
              subtitle="Connect channels, tools, and external systems to extend AgentOS capabilities and power automations."
              secondaryAction={{ label: "Import Integration", icon: Import, onClick: () => setIsImportDialogOpen(true) }}
              primaryAction={{ label: "Add Integration", icon: Plus, onClick: () => setIsAddDialogOpen(true) }}
            />

            <SearchToolbar
              search={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search integrations..."
              surfaceTheme={surfaceTheme}
              right={<ViewToggle value={view} onChange={setView} surfaceTheme={surfaceTheme} />}
            >
              <ToolbarButton surfaceTheme={surfaceTheme} icon={Layers3} label={category} chevron onClick={() => setCategory((current) => categories[(categories.indexOf(current) + 1) % categories.length])} />
              <ToolbarButton surfaceTheme={surfaceTheme} icon={SearchCheck} label={formatIntegrationStatusFilterLabel(status)} chevron onClick={() => setStatus((current) => statuses[(statuses.indexOf(current) + 1) % statuses.length])} />
              <ToolbarButton surfaceTheme={surfaceTheme} icon={SlidersHorizontal} label={`Sort: ${formatIntegrationSortLabel(sort)}`} chevron onClick={() => setSort((current) => sorts[(sorts.indexOf(current) + 1) % sorts.length])} />
            </SearchToolbar>

            <StatGrid columns={5}>
              <StatCard label="Total Integrations" value={String(filteredIntegrations.length)} detail={`${integrations.length} registered`} icon={Plug} tone="info" />
              <StatCard label="Connected" value={String(connectedCount)} detail={`${Math.round((connectedCount / Math.max(1, filteredIntegrations.length)) * 100)}% of filtered`} icon={CircleCheck} tone="success" />
              <StatCard label="Pending Setup" value={String(pendingCount)} detail="Needs setup or credentials" icon={Clock3} tone="warning" />
              <StatCard label="Failed" value={String(failedCount)} detail="Real errors only" icon={X} tone="danger" />
              <StatCard label="Automations Using" value="-" detail="Metrics unavailable from snapshot" icon={Workflow} tone="purple" />
            </StatGrid>

            {filteredIntegrations.length === 0 ? (
              <EmptyState
                title="No integrations match"
                description="Adjust search, category, or status filters to inspect another integration set."
              />
            ) : (
              <div className="space-y-3">
                {Array.from(new Set(filteredIntegrations.map((integration) => integration.category))).map((section) => (
                  <section key={section}>
                    <h2 className="mb-2 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-muted-foreground">{section} ({filteredIntegrations.filter((integration) => integration.category === section).length})</h2>
                    <div className={cn(view === "grid" ? "grid gap-2.5 lg:grid-cols-2 min-[1400px]:grid-cols-3" : "flex flex-col gap-2.5")}>
                      {filteredIntegrations.filter((integration) => integration.category === section).map((integration) => (
                        <IntegrationCard
                          key={integration.id}
                          integration={integration}
                          selected={integration.id === selectedIntegration?.id}
                          list={view === "list"}
                          actionBusy={runningAction?.startsWith(`${integration.id}:`) ?? false}
                          onSelect={() => setSelectedId(integration.id)}
                          onConfigure={() => handleConfigureIntegration(integration)}
                          onReconnect={() => void handleReconnectIntegration(integration)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}

            <AutomationImpactSummary integrations={integrations} />
          </>
        }
        inspector={selectedIntegration ? (
          <IntegrationInspector
            integration={selectedIntegration}
            actionBusy={runningAction?.startsWith(`${selectedIntegration.id}:`) ?? false}
            activeWorkspaceId={activeWorkspaceId}
            onConfigure={() => handleConfigureIntegration(selectedIntegration)}
            onReconnect={() => void handleReconnectIntegration(selectedIntegration)}
            onDisable={() => void handleDisableIntegration(selectedIntegration)}
          />
        ) : null}
      />
      <IntegrationAddDialog
        open={isAddDialogOpen}
        integrations={integrations}
        onOpenChange={setIsAddDialogOpen}
        onSelect={(integration) => {
          setIsAddDialogOpen(false);
          handleConfigureIntegration(integration);
        }}
      />
      <IntegrationImportDialog
        open={isImportDialogOpen}
        onOpenChange={setIsImportDialogOpen}
        onOpenSurfaceSetup={() => {
          setIsImportDialogOpen(false);
          openSurfaceSetup(null);
        }}
        onOpenModelSetup={() => {
          setIsImportDialogOpen(false);
          openModelSetup(null);
        }}
      />
      <WorkspaceChannelsDialog
        snapshot={rootSnapshot}
        workspaceId={activeWorkspaceId}
        open={isChannelsDialogOpen}
        initialProvider={initialSurfaceProvider}
        onOpenChange={setIsChannelsDialogOpen}
        onRefresh={refresh}
        onSnapshotChange={(updater) => setSnapshot((current) => updater(current))}
      />
      <AddModelsDialog
        open={isAddModelsDialogOpen}
        onOpenChange={setIsAddModelsDialogOpen}
        snapshot={rootSnapshot}
        initialProvider={initialModelProvider}
        onSnapshotChange={setSnapshot}
      />
    </>
  );
}

function IntegrationCard({
  integration,
  selected,
  list,
  actionBusy,
  onSelect,
  onConfigure,
  onReconnect
}: {
  integration: IntegrationView;
  selected: boolean;
  list: boolean;
  actionBusy: boolean;
  onSelect: () => void;
  onConfigure: () => void;
  onReconnect: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "rounded-lg border p-3 text-left transition-all hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        pageSurface,
        selected && "border-primary/60 bg-primary/10"
      )}
    >
      <div className={cn("flex gap-3", list ? "items-center" : "items-start")}>
        <EntityIcon icon={integration.icon} label={integration.name} tone={integration.iconTone} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[0.88rem] font-semibold text-foreground">{integration.name}</h3>
              <p className="mt-1 truncate text-[0.68rem] text-muted-foreground">{integration.connectionHealth.label}</p>
              <p className="mt-1 text-[0.68rem] text-muted-foreground">Linked: {integration.linkedAgentCount} agents</p>
            </div>
            <StatusBadge label={integration.statusLabel} tone={integration.statusTone} />
          </div>
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap gap-1.5">
              <MiniBadge>{integration.category.split(" ")[0]}</MiniBadge>
              <MiniBadge>{integration.managedBy}</MiniBadge>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="h-7 rounded-[8px] px-2"
                disabled={actionBusy || !integration.actionSupport.configure.supported}
                title={integration.actionSupport.configure.reason}
                onClick={(event) => {
                  event.stopPropagation();
                  onConfigure();
                }}
              >
                <Gauge className="h-3 w-3" />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="h-7 rounded-[8px] px-2"
                disabled={actionBusy || !integration.actionSupport.reconnect.supported}
                title={integration.actionSupport.reconnect.reason}
                onClick={(event) => {
                  event.stopPropagation();
                  onReconnect();
                }}
              >
                <RefreshCw className={cn("h-3 w-3", actionBusy && "animate-spin")} />
              </Button>
              <MoreButton />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IntegrationInspector({
  integration,
  actionBusy,
  activeWorkspaceId,
  onConfigure,
  onReconnect,
  onDisable
}: {
  integration: IntegrationView;
  actionBusy: boolean;
  activeWorkspaceId: string | null;
  onConfigure: () => void;
  onReconnect: () => void;
  onDisable: () => void;
}) {
  const StatusIcon = integrationStatusIcons[integration.status];
  const disableReason = activeWorkspaceId
    ? integration.actionSupport.disable.reason
    : "Select a workspace before disabling workspace-specific integration bindings.";
  return (
    <InspectorPanelFrame>
      <div className="flex items-start gap-3">
        <EntityIcon icon={integration.icon} label={integration.name} tone={integration.iconTone} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-foreground">{integration.name}</h2>
              <StatusBadge label={integration.statusLabel} tone={integration.statusTone} className="mt-1.5" />
            </div>
            <MoreButton />
          </div>
          <MiniBadge>{integration.category}</MiniBadge>
          <p className="mt-2.5 text-xs leading-5 text-foreground/80">{integration.description}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="h-8 rounded-[9px] px-2 text-xs"
          disabled={actionBusy || !integration.actionSupport.reconnect.supported}
          title={integration.actionSupport.reconnect.reason}
          onClick={onReconnect}
        >
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", actionBusy && "animate-spin")} />Reconnect
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 rounded-[9px] px-2 text-xs"
          disabled={actionBusy || !integration.actionSupport.configure.supported}
          title={integration.actionSupport.configure.reason}
          onClick={onConfigure}
        >
          Configure
        </Button>
        <Button
          variant="destructive"
          size="sm"
          className="h-8 rounded-[9px] px-2 text-xs"
          disabled={actionBusy || !integration.actionSupport.disable.supported || !activeWorkspaceId}
          title={disableReason}
          onClick={onDisable}
        >
          Disable
        </Button>
      </div>
      <SectionCard title="Connection Health" className="mt-3">
        <div className="px-3 py-2.5">
          <KeyValue label="Health" value={<span className="inline-flex items-center gap-1.5"><StatusIcon className={cn("h-3.5 w-3.5", statusIconClassName(integration.status))} />{integration.connectionHealth.label}</span>} />
          <KeyValue label="Last sync" value={integration.lastSyncLabel} />
          <KeyValue label="Uptime" value={integration.uptimeLabel} />
          <KeyValue label="Rate limit" value={integration.rateLimitLabel} />
          <KeyValue label="Source" value={integration.sourceMethods.join(", ")} />
          <p className="border-t border-border py-2 text-xs leading-5 text-muted-foreground">{integration.connectionHealth.detail}</p>
          <ProgressBar value={integration.status === "connected" ? 84 : integration.status === "failed" ? 8 : 28} tone={integration.statusTone} />
        </div>
      </SectionCard>
      <SectionCard title="Scopes / Permissions" className="mt-3">
        <div className="space-y-1.5 p-3 text-xs text-foreground/80">
          {integration.permissions.map((scope) => (
            <div key={scope} className="flex items-center gap-1.5"><CircleCheck className="h-3.5 w-3.5 text-[hsl(var(--status-success-foreground))]" />{scope}</div>
          ))}
        </div>
      </SectionCard>
      <SectionCard title={`Linked Agents (${integration.linkedAgentCount})`} className="mt-3">
        <div className="divide-y divide-border px-3">
          {integration.linkedAgents.length > 0 ? integration.linkedAgents.map((agent) => (
            <div key={agent.id} className="py-2.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-foreground/80">{agent.name}</span>
                <span className="shrink-0 text-muted-foreground">{agent.workspaceName}</span>
              </div>
              <p className="mt-1 truncate text-[0.66rem] text-muted-foreground">{agent.reason}</p>
            </div>
          )) : (
            <div className="py-3 text-xs text-muted-foreground">
              {integration.managedBy === "unsupported" ? "Linkage unavailable until this connector exists." : "No linked agents found in the current workspace snapshot."}
            </div>
          )}
        </div>
      </SectionCard>
      <SectionCard title="Setup Notes" className="mt-3">
        <div className="space-y-2 p-3 text-xs leading-5 text-foreground/80">
          <KeyValue label="Managed by" value={formatManagedBy(integration.managedBy)} />
          <KeyValue label="Provider type" value={integration.providerType} />
          <KeyValue label="Accounts" value={integration.accountIds.length ? integration.accountIds.join(", ") : "None"} />
          <KeyValue label="Channels" value={integration.channelIds.length ? integration.channelIds.join(", ") : "None"} />
          <KeyValue label="Models" value={integration.modelIds.length ? integration.modelIds.join(", ") : "None"} />
          {integration.errorMessage ? <p className="rounded-[9px] border border-destructive/20 bg-destructive/10 p-2 text-destructive">{integration.errorMessage}</p> : null}
          {integration.missingConfiguration.length > 0 ? (
            <div>
              <p className="text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Required setup</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {integration.missingConfiguration.map((item) => <MiniBadge key={item}>{item}</MiniBadge>)}
              </div>
            </div>
          ) : null}
          <div className="rounded-[9px] border border-border bg-muted/35 p-2 text-muted-foreground">
            <p>Configure: {integration.actionSupport.configure.reason}</p>
            <p>Reconnect: {integration.actionSupport.reconnect.reason}</p>
            <p>Disable: {integration.actionSupport.disable.reason}</p>
          </div>
        </div>
      </SectionCard>
    </InspectorPanelFrame>
  );
}

function AutomationImpactSummary({ integrations }: { integrations: IntegrationView[] }) {
  const connected = integrations.filter((integration) => integration.status === "connected");
  const linked = integrations
    .filter((integration) => integration.linkedAgentCount > 0)
    .sort((left, right) => right.linkedAgentCount - left.linkedAgentCount);
  return (
    <SectionCard title="Automation Impact Summary">
      <div className="grid gap-2.5 p-3 lg:grid-cols-[repeat(4,minmax(0,1fr))_1.4fr_0.8fr]">
        <MetricTile icon={Workflow} label="Automations" value="-" detail="OpenClaw metric unavailable" tone="info" />
        <MetricTile icon={Sparkles} label="Triggers fired" value="-" detail="OpenClaw metric unavailable" tone="success" />
        <MetricTile icon={BellRing} label="Actions executed" value="-" detail="OpenClaw metric unavailable" tone="purple" />
        <MetricTile icon={ShieldCheck} label="Success rate" value="-" detail="OpenClaw metric unavailable" tone="success" />
        <div className="rounded-[10px] border border-border bg-muted/35 p-2.5">
          <p className="mb-2.5 text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Top linked integrations</p>
          {linked.slice(0, 3).map((integration) => (
            <div key={integration.id} className="mb-2 grid grid-cols-[80px_1fr_auto] items-center gap-2 text-[0.68rem]">
              <span className="truncate text-foreground/80">{integration.name}</span>
              <ProgressBar value={Math.min(100, 20 + integration.linkedAgentCount * 18)} />
              <span className="text-muted-foreground">{integration.linkedAgentCount} agents</span>
            </div>
          ))}
          {linked.length === 0 ? <p className="text-[0.68rem] text-muted-foreground">No linked integrations found in the current snapshot.</p> : null}
        </div>
        <div className="rounded-[10px] border border-border bg-muted/35 p-2.5">
          <p className="mb-2.5 text-[0.58rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Recently observed</p>
          {connected.slice(0, 3).map((integration) => (
            <div key={integration.id} className="flex justify-between gap-2 py-1 text-[0.68rem]">
              <span className="text-foreground/80">{integration.name}</span>
              <span className="text-muted-foreground">{integration.lastSyncLabel}</span>
            </div>
          ))}
          {connected.length === 0 ? <p className="text-[0.68rem] text-muted-foreground">No verified connected integrations yet.</p> : null}
        </div>
      </div>
    </SectionCard>
  );
}

function IntegrationAddDialog({
  open,
  integrations,
  onOpenChange,
  onSelect
}: {
  open: boolean;
  integrations: IntegrationView[];
  onOpenChange: (open: boolean) => void;
  onSelect: (integration: IntegrationView) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl rounded-[18px] p-4">
        <DialogHeader>
          <DialogTitle>Add Integration</DialogTitle>
          <DialogDescription>
            Choose a real AgentOS/OpenClaw setup path. Unsupported connectors are shown with their blocking reason.
          </DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[62vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
          {integrations.map((integration) => (
            <button
              key={integration.id}
              type="button"
              onClick={() => onSelect(integration)}
              className={cn(
                "rounded-[12px] border p-3 text-left transition hover:bg-muted/60",
                pageSurface,
                !integration.actionSupport.configure.supported && "opacity-70"
              )}
            >
              <div className="flex items-start gap-3">
                <EntityIcon icon={integration.icon} label={integration.name} tone={integration.iconTone} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-sm font-semibold text-foreground">{integration.name}</h3>
                    <StatusBadge label={integration.statusLabel} tone={integration.statusTone} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{integration.description}</p>
                  <p className="mt-2 text-[0.68rem] text-muted-foreground">{integration.actionSupport.configure.reason}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IntegrationImportDialog({
  open,
  onOpenChange,
  onOpenSurfaceSetup,
  onOpenModelSetup
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenSurfaceSetup: () => void;
  onOpenModelSetup: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-[18px] p-4">
        <DialogHeader>
          <DialogTitle>Import Integration</DialogTitle>
          <DialogDescription>
            Secure bulk import is not available because this codebase does not expose a credential import contract or secret store handoff.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-[12px] border border-[hsl(var(--status-warning)/0.24)] bg-[hsl(var(--status-warning)/0.10)] p-3 text-xs leading-5 text-[hsl(var(--status-warning-foreground))]">
          Importing tokens, OAuth secrets, bot credentials, or webhook secrets from the browser would expose sensitive values. Use the existing setup flows so OpenClaw handles credentials through its supported config paths.
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button className="h-9 rounded-[9px] bg-primary text-white hover:bg-primary/90" onClick={onOpenSurfaceSetup}>
            Open Integration Setup
          </Button>
          <Button variant="secondary" className="h-9 rounded-[9px]" onClick={onOpenModelSetup}>
            Open Model Setup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
