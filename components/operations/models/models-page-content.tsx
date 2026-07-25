"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { BrainCircuit, CircleCheck, Database, Layers, Plug, Plus, RotateCcw, SlidersHorizontal } from "lucide-react";

import { AddModelsDialog } from "@/components/mission-control/add-models/add-models-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import {
  buildSessionModelOverrides,
  type SessionModelOverrideRecord
} from "@/lib/openclaw/domains/session-model-scope";
import { isAddModelsProviderId } from "@/lib/openclaw/model-provider-registry";
import { cn } from "@/lib/utils";
import { buildAgentViews, buildModelViews, type AgentView, type ModelView } from "@/components/operations/operations-data";
import { EmptyState, EntityIcon, InspectorPanelFrame, KeyValue, MiniBadge, OperationsPageLayout, PageHeader, SearchToolbar, SectionCard, StatCard, StatGrid, StatusBadge, ToolbarButton } from "@/components/operations/operations-ui";
import { formatModelSortLabel, readClientError, sortModelViews } from "@/components/operations/operations-shared";

export function ModelsPageContent({
  snapshot,
  rootSnapshot,
  surfaceTheme,
  refresh,
  setSnapshot
}: {
  snapshot: MissionControlSnapshot;
  rootSnapshot: MissionControlSnapshot;
  surfaceTheme: "dark" | "light";
  refresh: () => Promise<void>;
  setSnapshot: Dispatch<SetStateAction<MissionControlSnapshot>>;
}) {
  const models = useMemo(
    () => buildModelViews(snapshot),
    [snapshot]
  );
  const agents = useMemo(
    () => buildAgentViews(snapshot),
    [snapshot]
  );
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("All Providers");
  const [sort, setSort] = useState<"name" | "provider" | "status" | "role">("provider");
  const [selectedId, setSelectedId] = useState(models[0]?.id ?? "");
  const [tab, setTab] = useState<"Details" | "Capabilities">("Details");
  const [isAddModelsDialogOpen, setIsAddModelsDialogOpen] = useState(false);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [resetTargets, setResetTargets] = useState<SessionModelOverrideRecord[] | null>(null);
  const [resettingOverrides, setResettingOverrides] = useState(false);

  const providers = ["All Providers", ...Array.from(new Set(models.map((model) => model.provider)))];
  const sortModes: Array<typeof sort> = ["provider", "name", "status", "role"];
  const filteredModels = models.filter((model) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [model.name, model.provider, model.id, model.role].join(" ").toLowerCase().includes(query);
    const matchesProvider = provider === "All Providers" || model.provider === provider;
    return matchesSearch && matchesProvider;
  }).sort((left, right) => sortModelViews(left, right, sort));
  const selectedModel = filteredModels.find((model) => model.id === selectedId) ?? filteredModels[0] ?? null;
  const selectedModelId = selectedModel?.id ?? null;
  const selectedModelAgents = useMemo(
    () => (selectedModelId ? agents.filter((agent) => agent.source?.modelId === selectedModelId) : []),
    [agents, selectedModelId]
  );
  const connectedProviders = new Set(models.filter((model) => model.statusTone !== "danger").map((model) => model.provider)).size;
  const defaultModelId = snapshot.diagnostics.modelReadiness.resolvedDefaultModel ?? snapshot.diagnostics.modelReadiness.defaultModel;
  const sessionOverrides = useMemo(() => buildSessionModelOverrides(snapshot), [snapshot]);

  const setDefaultModel = async (model: ModelView) => {
    const rawProvider = model.source?.provider;
    if (!rawProvider || !isAddModelsProviderId(rawProvider)) {
      toast.message("Default model change is unavailable.", {
        description: "This model provider is not supported by the model provider API."
      });
      return;
    }

    setSettingDefaultId(model.id);

    try {
      const response = await fetch("/api/models/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-default",
          provider: rawProvider,
          modelId: model.id
        })
      });
      const result = await response.json().catch(() => null) as {
        ok?: boolean;
        message?: string;
        error?: string;
        snapshot?: MissionControlSnapshot;
      } | null;

      if (!response.ok || !result?.ok) {
        throw new Error(result?.error || result?.message || "Default model update failed.");
      }

      if (result.snapshot) {
        setSnapshot(result.snapshot);
      } else {
        await refresh();
      }

      toast.success("Default model updated.", {
        description: result.message
      });
    } catch (error) {
      toast.error("Default model update failed.", {
        description: readClientError(error)
      });
    } finally {
      setSettingDefaultId(null);
    }
  };

  const resetSessionOverrides = async () => {
    if (!resetTargets?.length || resettingOverrides) {
      return;
    }

    setResettingOverrides(true);
    try {
      const response = await fetch("/api/sessions/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: resetTargets.length === 1 ? "inherit" : "inherit-many",
          ...(resetTargets.length === 1
            ? {
                sessionKey: resetTargets[0]?.sessionKey,
                agentId: resetTargets[0]?.agentId
              }
            : {
                sessions: resetTargets.map((override) => ({
                  sessionKey: override.sessionKey,
                  agentId: override.agentId
                }))
              })
        })
      });
      const result = await response.json().catch(() => null) as {
        ok?: boolean;
        resetCount?: number;
        failures?: Array<{ sessionKey: string; error: string }>;
        snapshot?: MissionControlSnapshot;
        error?: string;
      } | null;

      if (!response.ok || !result) {
        throw new Error(result?.error || "Unable to reset session model overrides.");
      }

      if (result.snapshot) {
        setSnapshot(result.snapshot);
      } else {
        await refresh();
      }

      const resetCount = result.resetCount ?? 0;
      const failureCount = result.failures?.length ?? 0;
      if (failureCount > 0) {
        toast.warning(`${resetCount} session override${resetCount === 1 ? "" : "s"} reset.`, {
          description: `${failureCount} reset${failureCount === 1 ? "" : "s"} failed and remain visible.`
        });
      } else {
        toast.success(`${resetCount} session override${resetCount === 1 ? "" : "s"} reset.`, {
          description: "The affected sessions now inherit their agent model."
        });
      }
      setResetTargets(null);
    } catch (error) {
      toast.error("Session model reset failed.", {
        description: readClientError(error)
      });
    } finally {
      setResettingOverrides(false);
    }
  };

  return (
    <>
      <OperationsPageLayout
        main={
          <>
          <PageHeader
            surfaceTheme={surfaceTheme}
            title="Models"
            subtitle="Inspect configured models and manage the OpenClaw global default."
            actions={
              <Button
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs"
                  onClick={() => setIsAddModelsDialogOpen(true)}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add Model
              </Button>
            }
          />

          <SearchToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search models..."
            surfaceTheme={surfaceTheme}
          >
            <ToolbarButton surfaceTheme={surfaceTheme} icon={Database} label={provider} chevron onClick={() => setProvider((current) => providers[(providers.indexOf(current) + 1) % providers.length])} />
            <ToolbarButton surfaceTheme={surfaceTheme} icon={SlidersHorizontal} label={`Sort: ${formatModelSortLabel(sort)}`} chevron onClick={() => setSort((current) => sortModes[(sortModes.indexOf(current) + 1) % sortModes.length])} />
          </SearchToolbar>

          <StatGrid columns={4}>
            <StatCard label="Providers" value={String(connectedProviders)} detail={`${providers.length - 1} configured providers`} icon={Plug} tone="info" />
            <StatCard label="Configured Models" value={String(models.length)} detail={`${models.filter((model) => model.statusTone !== "danger").length} available`} icon={BrainCircuit} tone="success" />
            <StatCard label="Default Model" value={defaultModelId ? "1" : "0"} detail={defaultModelId ?? "No default configured"} icon={CircleCheck} tone="warning" />
            <StatCard label="Session Overrides" value={String(sessionOverrides.length)} detail={sessionOverrides.length ? "Explicit runtime routes" : "All sessions inherit"} icon={Layers} tone="purple" />
          </StatGrid>

          <SectionCard title="Providers & Models">
            {filteredModels.length === 0 ? (
              <EmptyState title="No models found" description="Add models through the existing model setup flow or clear the current search/provider filter." />
            ) : (
              <ModelsTable models={filteredModels} selectedId={selectedModel?.id} settingDefaultId={settingDefaultId} onSelect={setSelectedId} onSetDefault={(model) => void setDefaultModel(model)} />
            )}
          </SectionCard>

          <div className="grid gap-2.5">
            <SectionCard title="OpenClaw Model Scope">
              <div className="divide-y divide-border px-3">
                <KeyValue label="Configured default" value={defaultModelId ?? "Not configured"} />
                <KeyValue label="Readiness" value={snapshot.diagnostics.modelReadiness.ready ? "Ready" : "Needs setup"} />
                <KeyValue label="Available models" value={String(snapshot.diagnostics.modelReadiness.availableModelCount)} />
                <KeyValue label="Missing models" value={String(snapshot.diagnostics.modelReadiness.missingModelCount)} />
              </div>
            </SectionCard>
            <SectionCard
              title="Session Model Overrides"
              action={sessionOverrides.length > 1 ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs"
                  onClick={() => setResetTargets(sessionOverrides)}
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  Reset all
                </Button>
              ) : undefined}
            >
              {sessionOverrides.length === 0 ? (
                <div className="px-3 py-4 text-xs leading-5 text-muted-foreground">
                  No session-specific model routes are active. New and existing sessions inherit their assigned agent model.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {sessionOverrides.map((override) => (
                    <div key={override.runtimeId} className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-foreground">{override.agentName} · {override.title}</p>
                        <p className="mt-1 truncate text-[0.68rem] text-muted-foreground">
                          Session {override.sessionModelId} → Agent {override.agentModelId}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-8 shrink-0 rounded-lg px-3 text-xs"
                        onClick={() => setResetTargets([override])}
                      >
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                        Use agent model
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>
        </>
      }
      inspector={
        selectedModel ? (
          <ModelInspector
            model={selectedModel}
            tab={tab}
            onTabChange={setTab}
            settingDefault={settingDefaultId === selectedModel.id}
            onSetDefault={() => void setDefaultModel(selectedModel)}
            onOpenAddModels={() => setIsAddModelsDialogOpen(true)}
            linkedAgents={selectedModelAgents}
          />
        ) : null
      }
    />
      <AddModelsDialog
        open={isAddModelsDialogOpen}
        onOpenChange={setIsAddModelsDialogOpen}
        snapshot={rootSnapshot}
        onSnapshotChange={setSnapshot}
        surfaceTheme={surfaceTheme}
      />
      <Dialog open={Boolean(resetTargets)} onOpenChange={(open) => {
        if (!open && !resettingOverrides) {
          setResetTargets(null);
        }
      }}>
        <DialogContent className="w-[calc(100vw-32px)] max-w-[520px] rounded-[20px]">
          <DialogHeader>
            <DialogTitle>Reset session model {resetTargets?.length === 1 ? "override" : "overrides"}</DialogTitle>
            <DialogDescription>
              OpenClaw will remove the explicit model from {resetTargets?.length ?? 0} active session{resetTargets?.length === 1 ? "" : "s"}. Session history is preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[280px] space-y-2 overflow-y-auto">
            {resetTargets?.map((override) => (
              <div key={override.runtimeId} className="rounded-xl border border-border bg-muted/35 px-3 py-2.5">
                <p className="text-xs font-semibold text-foreground">{override.agentName}</p>
                <p className="mt-1 truncate text-[0.68rem] text-muted-foreground">{override.sessionModelId} → {override.agentModelId}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button type="button" variant="secondary" disabled={resettingOverrides} onClick={() => setResetTargets(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={resettingOverrides} onClick={() => void resetSessionOverrides()}>
              <RotateCcw className={cn("mr-2 h-4 w-4", resettingOverrides && "animate-spin")} />
              {resettingOverrides ? "Resetting..." : "Reset overrides"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ModelsTable({
  models,
  selectedId,
  settingDefaultId,
  onSelect,
  onSetDefault
}: {
  models: ModelView[];
  selectedId?: string;
  settingDefaultId: string | null;
  onSelect: (id: string) => void;
  onSetDefault: (model: ModelView) => void;
}) {
  return (
    <div>
      <div className="space-y-2 p-2.5 sm:hidden">
        {models.map((model) => (
          <article
            key={model.id}
            className={cn(
              "rounded-xl border bg-card p-3",
              model.id === selectedId ? "border-primary/60 bg-primary/10" : "border-border"
            )}
          >
            <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => onSelect(model.id)}>
              <EntityIcon icon={BrainCircuit} label={model.name} tone={model.statusTone} />
              <span className="min-w-0 flex-1">
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-foreground">{model.name}</span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{model.provider}</span>
                  </span>
                  <StatusBadge label={model.statusLabel} tone={model.statusTone} />
                </span>
                <span className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <span><span className="block text-[0.6rem] uppercase tracking-wider text-muted-foreground">Role</span><span className="mt-1 block font-medium text-foreground">{model.role}</span></span>
                  <span><span className="block text-[0.6rem] uppercase tracking-wider text-muted-foreground">Context</span><span className="mt-1 block font-medium text-foreground">{model.contextLabel}</span></span>
                </span>
              </span>
            </button>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3 h-11 w-full rounded-xl text-xs"
              disabled={settingDefaultId === model.id || model.role === "Primary" || model.statusTone === "danger"}
              title={model.role === "Primary" ? "This model is already the default." : model.statusTone === "danger" ? "Unavailable models cannot be selected as default." : "Set this configured model as the AgentOS default."}
              onClick={() => onSetDefault(model)}
            >
              {settingDefaultId === model.id ? "Saving..." : model.role === "Primary" ? "Current Default" : "Set Default"}
            </Button>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto sm:block">
      <table className="w-full min-w-[900px] text-left text-xs">
        <thead className="border-b border-border text-[0.56rem] uppercase tracking-[0.14em] text-muted-foreground">
          <tr>
            {["Model / Provider", "Status", "Context Window", "Role", "Linked Agents", "Actions"].map((header) => (
              <th key={header} className="px-3 py-2.5 font-semibold">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border text-foreground/80">
          {models.map((model) => (
            <tr key={model.id} onClick={() => onSelect(model.id)} className={cn("cursor-pointer hover:bg-muted/50", model.id === selectedId && "bg-primary/10 outline outline-1 outline-primary/45")}>
              <td className="px-3 py-2.5">
                <div className="flex items-center gap-2.5">
                  <EntityIcon icon={BrainCircuit} label={model.name} tone={model.statusTone} size="sm" />
                  <span><span className="block font-semibold text-foreground">{model.name}</span><span className="text-[0.66rem] text-muted-foreground">{model.provider}</span></span>
                </div>
              </td>
              <td className="px-3 py-2.5"><StatusBadge label={model.statusLabel} tone={model.statusTone} /></td>
              <td className="px-3 py-2.5">{model.contextLabel}</td>
              <td className="px-3 py-2.5"><StatusBadge label={model.role} tone={model.role === "Primary" ? "info" : model.role === "Fallback" ? "purple" : model.role === "Secondary" ? "success" : "warning"} dot={false} /></td>
              <td className="px-3 py-2.5">{model.linkedAgentsLabel}</td>
              <td className="px-3 py-2.5">
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 rounded-[8px] px-2 text-[0.7rem]"
                  disabled={settingDefaultId === model.id || model.role === "Primary" || model.statusTone === "danger"}
                  title={model.role === "Primary" ? "This model is already the default." : model.statusTone === "danger" ? "Unavailable models cannot be selected as default." : "Set this configured model as the AgentOS default."}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSetDefault(model);
                  }}
                >
                  {settingDefaultId === model.id ? "Saving..." : "Set Default"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function ModelInspector({
  model,
  tab,
  onTabChange,
  settingDefault,
  onSetDefault,
  onOpenAddModels,
  linkedAgents
}: {
  model: ModelView;
  tab: "Details" | "Capabilities";
  onTabChange: (tab: "Details" | "Capabilities") => void;
  settingDefault: boolean;
  onSetDefault: () => void;
  onOpenAddModels: () => void;
  linkedAgents: AgentView[];
}) {
  const visibleAgents = linkedAgents.slice(0, 6);
  const hiddenAgentCount = Math.max(0, linkedAgents.length - visibleAgents.length);

  return (
    <InspectorPanelFrame>
      <div className="flex items-start gap-2.5">
        <EntityIcon icon={BrainCircuit} label={model.name} tone={model.statusTone} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-foreground">{model.name}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{model.provider}</p>
            </div>
            <StatusBadge label={model.statusLabel} tone={model.statusTone} />
          </div>
          <p className="mt-2.5 text-xs leading-5 text-foreground/80">Configured model route reported by AgentOS/OpenClaw.</p>
        </div>
      </div>
      <SectionCard title="Linked Agents" className="mt-3">
        {linkedAgents.length === 0 ? (
          <div className="px-3 py-3 text-xs leading-5 text-muted-foreground">
            No agents are currently using this model.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {visibleAgents.map((agent) => (
              <div key={agent.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <EntityIcon icon={agent.icon} label={agent.name} tone={agent.iconTone} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-foreground">{agent.name}</p>
                      <p className="truncate text-[0.66rem] text-muted-foreground">{agent.workspaceName}</p>
                    </div>
                  </div>
                </div>
                <StatusBadge label={agent.statusLabel} tone={agent.statusTone} />
              </div>
            ))}
            {hiddenAgentCount > 0 ? (
              <div className="px-3 py-2.5">
                <MiniBadge>+{hiddenAgentCount} more agents</MiniBadge>
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          size="sm"
          className="col-span-2 h-8 rounded-[9px] bg-primary text-xs text-white hover:bg-primary/90"
          disabled={settingDefault || model.role === "Primary" || model.statusTone === "danger"}
          title={model.role === "Primary" ? "This model is already the default." : model.statusTone === "danger" ? "Unavailable models cannot be selected as default." : "Set this configured model as the AgentOS default."}
          onClick={onSetDefault}
        >
          {settingDefault ? "Saving..." : "Set as Default"}
        </Button>
        <Button variant="secondary" size="sm" className="col-span-2 h-8 rounded-[9px] text-xs" onClick={onOpenAddModels}>Open Model Library</Button>
      </div>
      <div className="mt-3 flex border-b border-border">
        {(["Details", "Capabilities"] as const).map((item) => (
          <button key={item} type="button" onClick={() => onTabChange(item)} className={cn("border-b-2 px-3 py-2.5 text-xs", tab === item ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>{item}</button>
        ))}
      </div>
      {tab === "Details" ? (
        <div className="mt-3 rounded-[10px] border border-border bg-muted/35 px-3">
          <KeyValue label="Provider" value={model.provider} />
          <KeyValue label="API Status" value={model.statusLabel} />
          <KeyValue label="Model ID" value={model.id} />
          <KeyValue label="Context Window" value={model.contextLabel} />
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5">{model.capabilities.map((capability) => <MiniBadge key={capability}>{capability}</MiniBadge>)}</div>
      )}
    </InspectorPanelFrame>
  );
}
