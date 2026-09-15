"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { BellRing, CircleCheck, Clock3, ExternalLink, Gauge, Layers3, LoaderCircle, MessageCircle, PackageOpen, Plug, RefreshCw, SearchCheck, ShieldCheck, SlidersHorizontal, Sparkles, Workflow, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import type { AddModelsProviderId, MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { PluginCatalogProjection } from "@/lib/openclaw/domains/plugin-catalog";
import { cn } from "@/lib/utils";
import { buildIntegrationViews, integrationStatusIcons, type IntegrationStatus, type IntegrationView } from "@/components/operations/operations-data";
import { EmptyState, EntityIcon, InspectorPanelFrame, KeyValue, MiniBadge, MoreButton, OperationsPageLayout, PageHeader, ProgressBar, SearchToolbar, SectionCard, StatCard, StatGrid, StatusBadge, ToolbarButton, ViewToggle, pageSurface } from "@/components/operations/operations-ui";
import { formatIntegrationSortLabel, formatIntegrationStatusFilterLabel, formatIntegrationStatusLabel, formatManagedBy, integrationStatusToneMap, MetricTile, readClientError, sortIntegrations, statusIconClassName, type IntegrationRuntimeOverride, type IntegrationSortMode } from "@/components/operations/operations-shared";

export function IntegrationsPageContent({
  snapshot,
  activeWorkspaceId,
  surfaceTheme,
  setSnapshot
}: {
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  surfaceTheme: "dark" | "light";
  setSnapshot: Dispatch<SetStateAction<MissionControlSnapshot>>;
}) {
  const router = useRouter();
  const baseIntegrations = useMemo(() => buildIntegrationViews(snapshot), [snapshot]);
  const [runtimeOverrides, setRuntimeOverrides] = useState<Record<string, IntegrationRuntimeOverride>>({});
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All Categories");
  const [status, setStatus] = useState<"All Statuses" | IntegrationStatus>("All Statuses");
  const [sort, setSort] = useState<IntegrationSortMode>("last-active");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [showAllMobileIntegrations, setShowAllMobileIntegrations] = useState(true);
  const [selectedId, setSelectedId] = useState(baseIntegrations[0]?.id ?? "");
  const [runningAction, setRunningAction] = useState<string | null>(null);

  useEffect(() => {
    if (window.matchMedia("(max-width: 639px)").matches) {
      const frame = window.requestAnimationFrame(() => setShowAllMobileIntegrations(false));
      return () => window.cancelAnimationFrame(frame);
    }
  }, []);
  const [pluginCatalog, setPluginCatalog] = useState<PluginCatalogProjection | null>(null);
  const [pluginCatalogLoading, setPluginCatalogLoading] = useState(true);
  const [pluginCatalogError, setPluginCatalogError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPluginCatalogLoading(true);
    setPluginCatalogError(null);

    const query = new URLSearchParams({ pageSize: "100" });
    if (activeWorkspaceId) {
      query.set("workspaceId", activeWorkspaceId);
    }
    const contextAgentId = snapshot.agents.find((agent) => !activeWorkspaceId || agent.workspaceId === activeWorkspaceId)?.id;
    if (contextAgentId) {
      query.set("agentId", contextAgentId);
    }

    void fetch(`/api/openclaw/capabilities?${query.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { pluginCatalog?: PluginCatalogProjection; error?: string } | null;
        if (!response.ok || !payload?.pluginCatalog) {
          throw new Error(payload?.error || "The native OpenClaw plugin catalog is unavailable.");
        }
        return payload.pluginCatalog;
      })
      .then((catalog) => {
        if (!cancelled) {
          setPluginCatalog(catalog);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPluginCatalog(null);
          setPluginCatalogError(readClientError(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPluginCatalogLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, snapshot.agents]);
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
    "running",
    "linked",
    "configured",
    "stopped",
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
    integration.status === "running" ||
    integration.status === "linked" ||
    integration.status === "pending-setup" ||
    integration.status === "configured" ||
    integration.status === "stopped" ||
    integration.status === "missing-credentials" ||
    integration.status === "needs-authentication"
  ).length;
  const failedCount = filteredIntegrations.filter((integration) => integration.status === "failed").length;
  const visibleIntegrations = showAllMobileIntegrations ? filteredIntegrations : filteredIntegrations.slice(0, 6);

  const openSurfaceSetup = (surfaceProvider: IntegrationView["surfaceProvider"] | null = null) => {
    void surfaceProvider;
    router.push("/channels");
  };

  const openModelSetup = (provider: AddModelsProviderId | null = null) => {
    void provider;
    router.push("/models");
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

  const handleOpenPluginSurface = (entry: PluginCatalogProjection["items"][number]) => {
    const destination = resolvePluginCatalogDestination(entry);
    if (destination.href) {
      router.push(destination.href);
      return;
    }

    const controlUiUrl = snapshot.diagnostics.dashboardUrl?.trim();
    if (!controlUiUrl) {
      toast.message("OpenClaw Control UI is unavailable.", {
        description: "OpenClaw did not report a dashboard URL for this capability."
      });
      return;
    }

    window.open(controlUiUrl, "_blank", "noopener,noreferrer");
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

  return (
    <>
      <OperationsPageLayout
        main={
          <>
            <PageHeader
              surfaceTheme={surfaceTheme}
              title="Integrations"
              subtitle="Inspect the native OpenClaw capability catalog, then continue in the canonical surface that owns each capability."
              actions={
                <>
                  <Button variant="secondary" size="sm" className="h-11 rounded-xl px-3 text-xs sm:h-8 sm:rounded-lg" onClick={() => router.push("/channels")}>
                    <MessageCircle className="mr-1.5 h-3.5 w-3.5" /> Channels
                  </Button>
                  <Button variant="secondary" size="sm" className="h-11 rounded-xl px-3 text-xs sm:h-8 sm:rounded-lg" onClick={() => router.push("/models")}>
                    <Gauge className="mr-1.5 h-3.5 w-3.5" /> Models
                  </Button>
                  <Button variant="secondary" size="sm" className="h-11 rounded-xl px-3 text-xs sm:h-8 sm:rounded-lg" onClick={() => router.push("/accounts")}>
                    <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Accounts
                  </Button>
                </>
              }
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

            <PluginCatalogPanel
              catalog={pluginCatalog}
              loading={pluginCatalogLoading}
              error={pluginCatalogError}
              onOpenSurface={handleOpenPluginSurface}
            />

            {filteredIntegrations.length === 0 ? (
              <EmptyState
                title="No integrations match"
                description="Adjust search, category, or status filters to inspect another integration set."
              />
            ) : (
              <div className="space-y-3">
                {Array.from(new Set(visibleIntegrations.map((integration) => integration.category))).map((section) => (
                  <section key={section}>
                    <h2 className="mb-2 text-[0.62rem] font-bold uppercase tracking-[0.16em] text-muted-foreground">{section} ({filteredIntegrations.filter((integration) => integration.category === section).length})</h2>
                    <div className={cn(view === "grid" ? "grid gap-2.5 lg:grid-cols-2 min-[1400px]:grid-cols-3" : "flex flex-col gap-2.5")}>
                      {visibleIntegrations.filter((integration) => integration.category === section).map((integration) => (
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
                {!showAllMobileIntegrations && filteredIntegrations.length > visibleIntegrations.length ? (
                  <Button variant="secondary" className="h-11 w-full rounded-xl text-xs" onClick={() => setShowAllMobileIntegrations(true)}>
                    Show {filteredIntegrations.length - visibleIntegrations.length} more integrations
                  </Button>
                ) : null}
              </div>
            )}

            <AutomationImpactSummary integrations={integrations} />
          </>
        }
        inspector={selectedIntegration ? (
          <IntegrationInspector
            integration={selectedIntegration}
            actionBusy={runningAction?.startsWith(`${selectedIntegration.id}:`) ?? false}
            onConfigure={() => handleConfigureIntegration(selectedIntegration)}
            onReconnect={() => void handleReconnectIntegration(selectedIntegration)}
          />
        ) : null}
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
          <div className="mt-2.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap gap-1.5">
              <MiniBadge>{integration.category.split(" ")[0]}</MiniBadge>
              <MiniBadge>{integration.managedBy}</MiniBadge>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                className="h-7 rounded-[8px] px-2"
                disabled={actionBusy || !integration.actionSupport.configure.supported}
                title={integration.actionSupport.configure.reason}
                aria-label={integration.modelProvider ? `Open ${integration.name} model setup` : `Open ${integration.name} setup`}
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
                aria-label={`Refresh ${integration.name} status`}
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
  onConfigure,
  onReconnect
}: {
  integration: IntegrationView;
  actionBusy: boolean;
  onConfigure: () => void;
  onReconnect: () => void;
}) {
  const StatusIcon = integrationStatusIcons[integration.status];
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
      <div className="mt-3 grid grid-cols-2 gap-2">
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
            <p>Lifecycle: {integration.surfaceProvider ? "Manage channels in Channels." : integration.modelProvider ? "Manage providers in Models." : "Use the native OpenClaw surface."}</p>
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

type PluginCatalogDestination = {
  label: string;
  href: "/channels" | "/models" | "/accounts" | "/operations" | null;
};

export function resolvePluginCatalogDestination(
  entry: PluginCatalogProjection["items"][number]
): PluginCatalogDestination {
  const categories = new Set(entry.catalog.categories.map((category) => category.toLowerCase()));
  const entryText = [entry.id, entry.catalog.name, entry.catalog.packageName].filter(Boolean).join(" ").toLowerCase();

  if (categories.has("channels") || categories.has("channel") || /telegram|discord|slack|whatsapp|signal|matrix/.test(entryText)) {
    return { label: "Open Channels", href: "/channels" };
  }

  if (categories.has("models") || categories.has("model") || categories.has("providers") || /model|ollama|openai|anthropic|gemini/.test(entryText)) {
    return { label: "Open Models", href: "/models" };
  }

  if (categories.has("browser") || /browser|playwright|puppeteer/.test(entryText)) {
    return { label: "Open Browser Accounts", href: "/accounts" };
  }

  if (categories.has("automations") || categories.has("automation") || categories.has("tasks") || categories.has("cron") || /automation|cron|schedule|task/.test(entryText)) {
    return { label: "Open Automations", href: "/operations" };
  }

  return { label: "Open Control UI", href: null };
}

function pluginCatalogStateTone(state: PluginCatalogProjection["items"][number]["local"]["state"]): "success" | "warning" | "danger" | "muted" {
  if (state === "enabled") {
    return "success";
  }

  if (state === "needs-setup") {
    return "warning";
  }

  if (state === "error") {
    return "danger";
  }

  return "muted";
}

function pluginCatalogStateLabel(state: PluginCatalogProjection["items"][number]["local"]["state"]) {
  return state === "not-installed" ? "Available" : state.replace(/-/g, " ");
}

function PluginCatalogPanel({
  catalog,
  loading,
  error,
  onOpenSurface
}: {
  catalog: PluginCatalogProjection | null;
  loading: boolean;
  error: string | null;
  onOpenSurface: (entry: PluginCatalogProjection["items"][number]) => void;
}) {
  return (
    <SectionCard title="Native OpenClaw capability catalog">
      <div className="space-y-3 p-3">
        <p className="text-xs text-muted-foreground">Live catalog metadata and local plugin state. Installation and credential changes stay in OpenClaw.</p>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-border bg-muted/25 p-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <PackageOpen className="h-4 w-4 shrink-0 text-primary" />
            <p className="text-xs text-foreground/80">Channels, models, automations, browser, and other OpenClaw-owned capabilities.</p>
          </div>
          {catalog ? <StatusBadge label={catalog.state} tone={catalog.state === "ready" ? "success" : catalog.state === "degraded" ? "warning" : "danger"} /> : null}
        </div>

        {loading && !catalog ? (
          <div className="flex items-center gap-2 rounded-[10px] border border-border bg-muted/25 p-3 text-xs text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" /> Loading the native OpenClaw catalog…
          </div>
        ) : null}

        {error && !catalog ? (
          <div className="rounded-[10px] border border-[hsl(var(--status-danger)/0.24)] bg-[hsl(var(--status-danger)/0.08)] p-3 text-xs leading-5 text-[hsl(var(--status-danger-foreground))]">
            <p className="font-medium">Native catalog unavailable</p>
            <p className="mt-1">{error}</p>
            <p className="mt-1 text-[hsl(var(--status-danger-foreground)/0.78)]">Refresh this page after checking OpenClaw Gateway diagnostics.</p>
          </div>
        ) : null}

        {catalog ? (
          <>
            {catalog.remoteError ? (
              <div className="rounded-[10px] border border-[hsl(var(--status-warning)/0.24)] bg-[hsl(var(--status-warning)/0.08)] p-3 text-xs leading-5 text-[hsl(var(--status-warning-foreground))]">
                Remote catalog metadata is unavailable; local OpenClaw facts remain visible. {catalog.remoteError}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              {catalog.categories.slice(0, 8).map((category) => <MiniBadge key={category.slug}>{category.label}</MiniBadge>)}
              {catalog.categories.length > 8 ? <MiniBadge>+{catalog.categories.length - 8} more categories</MiniBadge> : null}
            </div>
            {catalog.items.length > 0 ? (
              <div className="grid gap-2.5 lg:grid-cols-2">
                {catalog.items.map((entry) => {
                  const destination = resolvePluginCatalogDestination(entry);
                  return (
                    <div key={entry.id} className="rounded-[10px] border border-border bg-muted/20 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="truncate text-sm font-semibold text-foreground">{entry.catalog.name}</h3>
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{entry.catalog.summary || "No summary was provided by OpenClaw."}</p>
                        </div>
                        <StatusBadge label={pluginCatalogStateLabel(entry.local.state)} tone={pluginCatalogStateTone(entry.local.state)} />
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {entry.catalog.categories.slice(0, 3).map((category) => <MiniBadge key={`${entry.id}:${category}`}>{category}</MiniBadge>)}
                        {entry.catalog.official ? <MiniBadge>Official</MiniBadge> : null}
                      </div>
                      <p className="mt-2 truncate text-[0.66rem] text-muted-foreground" title={entry.catalog.packageName}>{entry.catalog.packageName || entry.id}</p>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="text-[0.66rem] text-muted-foreground">{entry.local.present ? "Present locally" : "Catalog only"}</span>
                        <Button variant="secondary" size="sm" className="h-8 rounded-[9px] px-2.5 text-xs" onClick={() => onOpenSurface(entry)}>
                          <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> {destination.label}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="No catalog entries returned" description="OpenClaw did not return any capability entries for this context." />
            )}
            {catalog.failures.length > 0 ? (
              <p className="text-xs text-muted-foreground">Some catalog operations degraded: {catalog.failures.map((failure) => failure.message).join(" ")}</p>
            ) : null}
          </>
        ) : null}
      </div>
    </SectionCard>
  );
}
