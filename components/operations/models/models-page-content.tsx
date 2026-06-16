"use client";

import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { BrainCircuit, CircleCheck, Database, Filter, Import, Plug, Plus, SlidersHorizontal, Sparkles } from "lucide-react";

import { AddModelsDialog } from "@/components/mission-control/add-models/add-models-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { isAddModelsProviderId } from "@/lib/openclaw/model-provider-registry";
import { cn } from "@/lib/utils";
import { buildModelViews, formatBigNumber, summarizeTokens, type ModelView } from "@/components/operations/operations-data";
import { EmptyState, EntityIcon, InspectorPanelFrame, KeyValue, MiniBadge, OperationsPageLayout, PageHeader, SearchToolbar, SectionCard, StatCard, StatGrid, StatusBadge, ToolbarButton } from "@/components/operations/operations-ui";
import { formatModelSortLabel, MetricMini, readClientError, sortModelViews, UnsupportedPanel } from "@/components/operations/operations-shared";

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
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState("All Providers");
  const [sort, setSort] = useState<"name" | "provider" | "status" | "role">("provider");
  const [selectedId, setSelectedId] = useState(models[0]?.id ?? "");
  const [tab, setTab] = useState<"Details" | "Capabilities" | "Performance">("Details");
  const [isAddModelsDialogOpen, setIsAddModelsDialogOpen] = useState(false);
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);

  const providers = ["All Providers", ...Array.from(new Set(models.map((model) => model.provider)))];
  const sortModes: Array<typeof sort> = ["provider", "name", "status", "role"];
  const filteredModels = models.filter((model) => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || [model.name, model.provider, model.id, model.role].join(" ").toLowerCase().includes(query);
    const matchesProvider = provider === "All Providers" || model.provider === provider;
    return matchesSearch && matchesProvider;
  }).sort((left, right) => sortModelViews(left, right, sort));
  const selectedModel = filteredModels.find((model) => model.id === selectedId) ?? filteredModels[0] ?? null;
  const connectedProviders = new Set(models.filter((model) => model.statusTone !== "danger").map((model) => model.provider)).size;
  const tokenTotal = summarizeTokens(snapshot);
  const defaultModelId = snapshot.diagnostics.modelReadiness.resolvedDefaultModel ?? snapshot.diagnostics.modelReadiness.defaultModel;

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

  return (
    <>
      <OperationsPageLayout
        main={
          <>
          <PageHeader
            surfaceTheme={surfaceTheme}
            title="Models"
            subtitle="Configure default models, providers, routing, and runtime preferences for your AI agents."
            actions={
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs"
                  disabled
                  title="Model import is handled by the Add Models flow; there is no separate import backend."
                >
                  <Import className="mr-1.5 h-3.5 w-3.5" />
                  Import Model
                </Button>
                <Button
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs"
                  onClick={() => setIsAddModelsDialogOpen(true)}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add Model
                </Button>
              </>
            }
          />

          <SearchToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search models..."
            surfaceTheme={surfaceTheme}
          >
            <ToolbarButton surfaceTheme={surfaceTheme} icon={Database} label={provider} chevron onClick={() => setProvider((current) => providers[(providers.indexOf(current) + 1) % providers.length])} />
            <ToolbarButton surfaceTheme={surfaceTheme} icon={Filter} label="Configured models" disabled title="Only configured models are exposed by the current model snapshot." />
            <ToolbarButton surfaceTheme={surfaceTheme} icon={SlidersHorizontal} label={`Sort: ${formatModelSortLabel(sort)}`} chevron onClick={() => setSort((current) => sortModes[(sortModes.indexOf(current) + 1) % sortModes.length])} />
          </SearchToolbar>

          <StatGrid columns={4}>
            <StatCard label="Providers" value={String(connectedProviders)} detail={`${providers.length - 1} configured providers`} icon={Plug} tone="info" />
            <StatCard label="Configured Models" value={String(models.length)} detail={`${models.filter((model) => model.statusTone !== "danger").length} available`} icon={BrainCircuit} tone="success" />
            <StatCard label="Default Model" value={defaultModelId ? "1" : "0"} detail={defaultModelId ?? "No default configured"} icon={CircleCheck} tone="warning" />
            <StatCard label="Runtime Tokens" value={formatBigNumber(tokenTotal)} detail={tokenTotal ? "From live runtimes" : "No token usage reported"} icon={Sparkles} tone="purple" />
          </StatGrid>

          <SectionCard title="Providers & Models">
            {filteredModels.length === 0 ? (
              <EmptyState title="No models found" description="Add models through the existing model setup flow or clear the current search/provider filter." />
            ) : (
              <ModelsTable models={filteredModels} selectedId={selectedModel?.id} settingDefaultId={settingDefaultId} onSelect={setSelectedId} onSetDefault={(model) => void setDefaultModel(model)} />
            )}
          </SectionCard>

          <div className="grid gap-2.5 xl:grid-cols-[0.9fr_1.6fr]">
            <SectionCard title="Default Route">
              <div className="divide-y divide-border px-3">
                <KeyValue label="Configured default" value={defaultModelId ?? "Not configured"} />
                <KeyValue label="Readiness" value={snapshot.diagnostics.modelReadiness.ready ? "Ready" : "Needs setup"} />
                <KeyValue label="Available models" value={String(snapshot.diagnostics.modelReadiness.availableModelCount)} />
                <KeyValue label="Missing models" value={String(snapshot.diagnostics.modelReadiness.missingModelCount)} />
              </div>
            </SectionCard>
            <SectionCard title="Model Usage">
              <div className="p-3">
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <MetricMini label="Requests" value="Not reported" />
                  <MetricMini label="Total Tokens" value={formatBigNumber(tokenTotal)} />
                  <MetricMini label="Avg Latency" value="Not reported" />
                </div>
                <UnsupportedPanel
                  className="mt-4"
                  title="Live routing metrics unavailable"
                  description="The current snapshot does not expose model request, cost, latency, or route split analytics. AgentOS shows configured models and runtime token usage only."
                />
              </div>
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
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-left text-xs">
        <thead className="border-b border-border text-[0.56rem] uppercase tracking-[0.14em] text-muted-foreground">
          <tr>
            {["Model / Provider", "Status", "Context Window", "Role", "Usage", "Actions"].map((header) => (
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
              <td className="px-3 py-2.5">{model.lastActiveLabel}</td>
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
  );
}

function ModelInspector({
  model,
  tab,
  onTabChange,
  settingDefault,
  onSetDefault,
  onOpenAddModels
}: {
  model: ModelView;
  tab: "Details" | "Capabilities" | "Performance";
  onTabChange: (tab: "Details" | "Capabilities" | "Performance") => void;
  settingDefault: boolean;
  onSetDefault: () => void;
  onOpenAddModels: () => void;
}) {
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
        <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" disabled title="Fallback routing is not exposed by the current model provider API.">Set as Fallback</Button>
        <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" onClick={onOpenAddModels}>Add Models</Button>
        <Button variant="secondary" size="sm" className="h-8 rounded-[9px] text-xs" disabled title="Model removal/disable is not exposed by the current model provider API.">Disable</Button>
      </div>
      <div className="mt-3 flex border-b border-border">
        {(["Details", "Capabilities", "Performance"] as const).map((item) => (
          <button key={item} type="button" onClick={() => onTabChange(item)} className={cn("border-b-2 px-3 py-2.5 text-xs", tab === item ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground")}>{item}</button>
        ))}
      </div>
      {tab === "Details" ? (
        <div className="mt-3 rounded-[10px] border border-border bg-muted/35 px-3">
          <KeyValue label="Provider" value={model.provider} />
          <KeyValue label="API Status" value={model.statusLabel} />
          <KeyValue label="Model ID" value={model.id} />
          <KeyValue label="Context Window" value={model.contextLabel} />
          <KeyValue label="Latency" value={model.latencyLabel} />
          <KeyValue label="Rate Limit" value={model.rateLimitLabel} />
          <KeyValue label="Cost / 1M" value={model.costLabel} />
        </div>
      ) : tab === "Capabilities" ? (
        <div className="mt-3 flex flex-wrap gap-1.5">{model.capabilities.map((capability) => <MiniBadge key={capability}>{capability}</MiniBadge>)}</div>
      ) : (
        <div className="mt-4">
          <UnsupportedPanel
            title="Performance metrics unavailable"
            description="The current snapshot does not expose per-model latency, cost, request volume, or route split analytics."
          />
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <MetricMini label="Latency" value={model.latencyLabel} />
            <MetricMini label="Rate Limit" value={model.rateLimitLabel} />
          </div>
        </div>
      )}
    </InspectorPanelFrame>
  );
}
