"use client";

import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLink, Layers3, LoaderCircle, MessageCircle, PackageOpen, RefreshCw, SearchCheck, ArrowUpRight, Slack, SlidersHorizontal } from "lucide-react";

import { siDiscord, siGithub, siGmail, siGooglechat, siGooglechrome, siGoogledrive, siLinear, siNotion, siOllama, siOpenrouter, siTelegram, siWhatsapp, siX } from "simple-icons";

import { MissionControlDialogShell } from "@/components/mission-control/mission-control-dialog-shell";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import type { AddModelsProviderId, MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { PluginCatalogProjection } from "@/lib/openclaw/domains/plugin-catalog";
import { cn } from "@/lib/utils";
import { buildIntegrationViews, type IntegrationStatus, type IntegrationView } from "@/components/operations/operations-data";
import { EmptyState, EntityIcon, KeyValue, MiniBadge, OperationsPageLayout, PageHeader, SearchToolbar, SectionCard, StatusBadge, ToolbarButton, ViewToggle } from "@/components/operations/operations-ui";
import { formatIntegrationSortLabel, formatIntegrationStatusFilterLabel, formatIntegrationStatusLabel, formatManagedBy, integrationStatusToneMap, readClientError, sortIntegrations, type IntegrationRuntimeOverride, type IntegrationSortMode } from "@/components/operations/operations-shared";

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
  const [view, setView] = useState<"grid" | "list">("list");
  const [section, setSection] = useState<"discover" | "connected" | "attention">("discover");
  const [showAllMobileIntegrations, setShowAllMobileIntegrations] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
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
    if (!showAdvanced) return;
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
  }, [activeWorkspaceId, showAdvanced, snapshot.agents]);
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
  const selectedIntegration = filteredIntegrations.find((integration) => integration.id === selectedId) ?? null;
  const apps = filteredIntegrations.filter(integration => integration.id !== "cron" && integration.managedBy !== "unsupported" &&
    (integration.surfaceProvider || integration.modelProvider || integration.accountIds.length));
  const nativeCapabilities = filteredIntegrations.filter(integration => integration.id !== "cron" && !apps.includes(integration));
  const connected = apps.filter(integration => integration.status === "connected" || integration.status === "running");
  const needsAttention = apps.filter(integration =>
    ["failed", "needs-authentication", "missing-credentials", "stopped"].includes(integration.status));
  const available = apps.filter(integration => !connected.includes(integration) && !needsAttention.includes(integration));
  const directory = section === "connected" ? connected : section === "attention" ? needsAttention : available;
  const visibleIntegrations = showAllMobileIntegrations ? nativeCapabilities : nativeCapabilities.slice(0, 6);

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
              subtitle="Connect the apps your company uses and manage what each employee can do."
              actions={
                <>
                  <Button variant="secondary" size="sm" className="h-11 rounded-xl px-3 text-xs sm:h-8 sm:rounded-lg" onClick={() => router.push("/channels")}>
                    <MessageCircle className="mr-1.5 h-3.5 w-3.5" /> Channels
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
              searchPlaceholder="Find an integration"
              surfaceTheme={surfaceTheme}
              right={<div className="hidden sm:block"><ViewToggle value={view} onChange={setView} surfaceTheme={surfaceTheme} /></div>}
            >
              <ToolbarButton surfaceTheme={surfaceTheme} icon={Layers3} label={category} chevron onClick={() => setCategory((current) => categories[(categories.indexOf(current) + 1) % categories.length])} />
              <ToolbarButton surfaceTheme={surfaceTheme} icon={SearchCheck} label={formatIntegrationStatusFilterLabel(status)} chevron onClick={() => setStatus((current) => statuses[(statuses.indexOf(current) + 1) % statuses.length])} />
              <div className="hidden sm:block"><ToolbarButton surfaceTheme={surfaceTheme} icon={SlidersHorizontal} label={`Sort: ${formatIntegrationSortLabel(sort)}`} chevron onClick={() => setSort((current) => sorts[(sorts.indexOf(current) + 1) % sorts.length])} /></div>
            </SearchToolbar>

            <nav aria-label="Integration views" className="flex flex-wrap items-center gap-1 border-b border-border/75">
              {([["discover", "Discover"], ["connected", "Connected"], ["attention", "Needs attention"]] as const).map(([id, label]) =>
                <button key={id} type="button" aria-pressed={section === id} onClick={() => setSection(id)}
                  className={cn("min-h-11 border-b-2 px-3 py-2 text-sm font-medium",
                    section === id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{label}</button>
              )}
            </nav>
            {directory.length ? (
              <div className={cn(view === "grid" ? "grid gap-3 md:grid-cols-2 xl:grid-cols-3" : "workforce-panel divide-y divide-border/80 overflow-hidden")}>
                {directory.map(integration => (
                  <IntegrationCard key={integration.id} integration={integration}
                    selected={integration.id === selectedIntegration?.id} list={view === "list"}
                    actionBusy={runningAction?.startsWith(integration.id + ":") ?? false}
                    onSelect={() => setSelectedId(integration.id)}
                    onConfigure={() => handleConfigureIntegration(integration)}
                    onReconnect={() => void handleReconnectIntegration(integration)} />
                ))}
              </div>
            ) : (
              <div className="workforce-panel p-5 sm:p-6">
                <h2 className="workforce-section-title">{section === "connected" ? "No connected applications" :
                  section === "attention" ? "No applications need attention" : "No matching applications"}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{search ? "Clear the search or choose another view." :
                  section === "connected" ? "Browse applications to set up the ones your company uses." :
                  "Native capabilities and current configuration are available below."}</p>
                {section === "connected" && <Button variant="secondary" size="sm" className="mt-4" onClick={() => setSection("discover")}>Discover applications</Button>}
              </div>
            )}

            <section className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-5">
              <div>
                <h2 className="workforce-section-title">Employee access</h2>
                <p className="mt-1 text-sm text-muted-foreground">Check which tools, skills and permissions are effective for each person.</p>
              </div>
              <Link href="/team" className="inline-flex min-h-11 items-center gap-2 text-sm font-medium hover:underline">Open Team <ArrowUpRight aria-hidden="true" className="size-4" /></Link>
            </section>

            <details className="workforce-panel space-y-4 p-5" onToggle={event => setShowAdvanced(event.currentTarget.open)}>
              <summary className="cursor-pointer font-semibold">Native tools, skills, plugins and automation</summary>
              {showAdvanced ? (
                <>
                  <PluginCatalogPanel catalog={pluginCatalog} loading={pluginCatalogLoading} error={pluginCatalogError} onOpenSurface={handleOpenPluginSurface} />
                  <div className="grid gap-3 md:grid-cols-2">
                    {visibleIntegrations.map(integration => (
                      <IntegrationCard key={integration.id} integration={integration}
                        selected={integration.id === selectedIntegration?.id} list={false}
                        actionBusy={runningAction?.startsWith(`${integration.id}:`) ?? false}
                        onSelect={() => setSelectedId(current => current === integration.id ? "" : integration.id)}
                        onConfigure={() => handleConfigureIntegration(integration)}
                        onReconnect={() => void handleReconnectIntegration(integration)} />
                    ))}
                  </div>
                  {!showAllMobileIntegrations && nativeCapabilities.length > visibleIntegrations.length ? (
                    <Button variant="secondary" onClick={() => setShowAllMobileIntegrations(true)}>Show all capabilities</Button>
                  ) : null}
                  <div className="border-t border-border pt-3 text-sm">
                    <Link className="font-medium hover:underline" href="/missions?view=scheduled">Manage schedules in Tasks</Link>
                  </div>
                </>
              ) : null}
            </details>
          </>
        }
        inspector={null}
      />
      {selectedIntegration ? (
        <MissionControlDialogShell open onOpenChange={open => { if (!open) setSelectedId(""); }}
          surfaceTheme={surfaceTheme} variant="quiet" title={selectedIntegration.name}
          description={selectedIntegration.category}
          contentClassName={cn("workforce-setup-card sm:w-[min(92vw,640px)]", surfaceTheme === "light" && "workforce-setup-light")}
          bodyClassName="space-y-5 px-5 py-5 sm:px-7"
          footer={<>
            <Button variant="ghost" onClick={() => setSelectedId("")}>Close</Button>
            {selectedIntegration.actionSupport.configure.supported && <Button onClick={() => {
              setSelectedId("");
              handleConfigureIntegration(selectedIntegration);
            }}>{selectedIntegration.status === "connected" || selectedIntegration.status === "running" ? "Manage connection" : "Set up"}</Button>}
          </>}>
          <IntegrationInspector integration={selectedIntegration}
            actionBusy={runningAction?.startsWith(selectedIntegration.id + ":") ?? false}
            onReconnect={() => void handleReconnectIntegration(selectedIntegration)} />
        </MissionControlDialogShell>
      ) : null}
    </>
  );
}

const applicationIcons: Partial<Record<IntegrationView["id"], { path: string; hex: string }>> = {
  chrome: siGooglechrome, discord: siDiscord, github: siGithub, gmail: siGmail,
  "google-chat": siGooglechat, "google-drive": siGoogledrive, linear: siLinear,
  notion: siNotion, ollama: siOllama, openrouter: siOpenrouter,
  telegram: siTelegram, whatsapp: siWhatsapp, "x-twitter": siX
};

function ApplicationIcon({ integration }: { integration: IntegrationView }) {
  const mark = applicationIcons[integration.id];
  if (!mark && integration.id !== "slack") {
    return <EntityIcon icon={integration.icon} label={integration.name} tone={integration.iconTone} size="lg" />;
  }
  return (
    <span className="grid size-12 shrink-0 place-items-center rounded-2xl border border-border bg-background" aria-hidden="true">
      {mark ? (
        <svg viewBox="0 0 24 24" className="size-[22px]" fill={mark.hex === "000000" ? "currentColor" : `#${mark.hex}`}>
          <path d={mark.path} />
        </svg>
      ) : <Slack className="size-[22px] text-[#a84d90]" />}
    </span>
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
    <article className={cn("flex min-w-0 gap-3 px-4 py-4", list ? "flex-wrap items-start sm:items-center" : "workforce-panel flex-col", selected && "bg-muted/45")}>
      <ApplicationIcon integration={integration} />
      <div className="min-w-0 flex-1 basis-[10rem]">
        <h3 className="break-words text-base font-semibold">{integration.name}</h3>
        <p className="mt-1 text-sm leading-5 text-muted-foreground">{integration.description}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">{integration.status === "unknown" ? "Availability unverified" : integration.statusLabel}</span>
          {integration.linkedAgentCount ? <span className="text-xs text-muted-foreground">{integration.linkedAgentCount} linked</span> : null}
        </div>
      </div>
      <div className={cn("flex flex-wrap items-center gap-1.5", list && "ml-auto")}>
        {integration.actionSupport.configure.supported ? (
          <Button variant="secondary" size="sm" disabled={actionBusy} onClick={onConfigure}
            aria-label={integration.modelProvider ? `Open ${integration.name} model setup` : `Open ${integration.name} setup`}>
            {integration.status === "connected" || integration.status === "running" ? "Manage" : "Set up"}
          </Button>
        ) : null}
        {integration.actionSupport.reconnect.supported ? (
          <Button variant="ghost" size="icon" disabled={actionBusy} aria-label={`Refresh ${integration.name} status`} onClick={onReconnect}>
            <RefreshCw className={cn("size-4", actionBusy && "animate-spin")} />
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" aria-expanded={selected} onClick={onSelect}>{selected ? "Hide details" : "Details"}</Button>
      </div>
    </article>
  );
}

function IntegrationInspector({
  integration,
  actionBusy,
  onReconnect
}: {
  integration: IntegrationView;
  actionBusy: boolean;
  onReconnect: () => void;
}) {
  const unverified = integration.status === "unknown";
  const error = integration.errorMessage === integration.connectionHealth.detail ? null : integration.errorMessage;
  return (
    <>
      <div className="flex items-start gap-3">
        <ApplicationIcon integration={integration} />
        <div className="min-w-0">
          <p className="text-sm leading-6">{integration.description}</p>
          <p role="status" className="mt-1 text-sm font-medium text-muted-foreground">
            {integration.status === "unknown" ? "Availability unverified" : integration.statusLabel}
          </p>
        </div>
      </div>
      <section aria-label="Connection status" className="border-t border-border pt-4">
        <h2 className="workforce-section-title">Connection</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          {unverified
            ? integration.actionSupport.reconnect.supported ? "Refresh status to check this connection." : "Check the setup details for this connection."
            : integration.connectionHealth.detail}
        </p>
        {error && !unverified && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
        {integration.missingConfiguration.length > 0 && <ul aria-label="Required setup" className="mt-2 list-inside list-disc text-sm text-muted-foreground">
          {integration.missingConfiguration.map(item => <li key={item}>{item}</li>)}
        </ul>}
        {integration.actionSupport.reconnect.supported && <Button className="mt-3" type="button" variant="secondary" size="sm" disabled={actionBusy} onClick={onReconnect}>
          <RefreshCw className={cn("mr-2 size-4", actionBusy && "motion-safe:animate-spin")} />Refresh status
        </Button>}
      </section>
      <section aria-label="Employee access" className="border-t border-border pt-4">
        <h2 className="workforce-section-title">Employee access</h2>
        {integration.linkedAgents.length > 0 ? (
          <ul className="mt-2 divide-y divide-border">
            {integration.linkedAgents.map(employee => <li key={employee.id} className="py-2">
              <Link href={"/agents/" + encodeURIComponent(employee.id) + "?tab=capabilities"} className="font-medium hover:underline">{employee.name}</Link>
              <p className="text-sm text-muted-foreground">{employee.reason} · {employee.workspaceName}</p>
            </li>)}
          </ul>
        ) : <p className="mt-1 text-sm text-muted-foreground">No employee access has been confirmed.</p>}
      </section>
      <details className="border-t border-border pt-4">
        <summary className="cursor-pointer text-sm font-medium">Advanced connection details</summary>
        <div className="mt-2 space-y-2 text-sm">
          {unverified && <p className="text-muted-foreground">{error ?? integration.connectionHealth.detail}</p>}
          <KeyValue label="Last sync" value={integration.lastSyncLabel} />
          <KeyValue label="Uptime" value={integration.uptimeLabel} />
          <KeyValue label="Rate limit" value={integration.rateLimitLabel} />
          <KeyValue label="Source" value={integration.sourceMethods.join(", ")} />
          <KeyValue label="Managed by" value={formatManagedBy(integration.managedBy)} />
          <KeyValue label="Provider type" value={integration.providerType} />
          <KeyValue label="Accounts" value={integration.accountIds.join(", ") || "None"} />
          <KeyValue label="Channels" value={integration.channelIds.join(", ") || "None"} />
          <KeyValue label="Models" value={integration.modelIds.join(", ") || "None"} />
          {integration.permissions.length > 0 && <ul aria-label="Permissions" className="list-inside list-disc text-muted-foreground">
            {integration.permissions.map(scope => <li key={scope}>{scope}</li>)}
          </ul>}
          {!integration.actionSupport.configure.supported && <p>{integration.actionSupport.configure.reason}</p>}
          {!integration.actionSupport.reconnect.supported && <p>{integration.actionSupport.reconnect.reason}</p>}
        </div>
      </details>
    </>
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
