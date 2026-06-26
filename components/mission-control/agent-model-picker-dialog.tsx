"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  Bot,
  Boxes,
  Check,
  ChevronRight,
  Cpu,
  Database,
  Grid2X2,
  Info,
  LoaderCircle,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Zap
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  formatModelProviderLabel,
  getModelProviderDescriptor,
  isAddModelsProviderId
} from "@/lib/openclaw/model-provider-registry";
import {
  isKnownOpenAiCodexModelId,
  modelRecordIdentityKey,
  normalizeOpenAiCodexModelId
} from "@/lib/openclaw/domains/model-provider-connection";
import { formatAgentDisplayName, formatContextWindow, formatModelLabel } from "@/lib/openclaw/presenters";
import type { AddModelsProviderId, MissionControlSnapshot } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

type AgentModelRecord = MissionControlSnapshot["models"][number];

export function AgentModelPickerDialog({
  open,
  agentId,
  snapshot,
  onOpenChange,
  onSnapshotChange,
  onRefresh,
  onOpenAddModels,
  surfaceTheme = "dark"
}: {
  open: boolean;
  agentId: string | null;
  snapshot: MissionControlSnapshot;
  onOpenChange: (open: boolean) => void;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onRefresh?: () => Promise<void>;
  onOpenAddModels: (provider?: AddModelsProviderId | null) => void;
  surfaceTheme?: "dark" | "light";
}) {
  const isLight = surfaceTheme === "light";
  const agent = agentId ? snapshot.agents.find((entry) => entry.id === agentId) ?? null : null;
  const currentModelId = agent?.modelId && agent.modelId !== "unassigned" ? normalizeOpenAiCodexModelId(agent.modelId) : "";
  const [selectedModelId, setSelectedModelId] = useState(currentModelId);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [sortMode, setSortMode] = useState("recent");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snapshotRef = useRef(snapshot);
  const modelOptions = useMemo(() => dedupeSnapshotModels(snapshot.models), [snapshot.models]);
  const currentModel = currentModelId ? findModelByCanonicalId(modelOptions, currentModelId) : null;
  const currentModelSelectable = currentModel ? isSelectableModel(currentModel) : false;

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (!open || !agentId) {
      return;
    }

    const currentAgent = snapshotRef.current.agents.find((entry) => entry.id === agentId);

    if (!currentAgent) {
      return;
    }

    setSelectedModelId(currentAgent.modelId === "unassigned" ? "" : normalizeOpenAiCodexModelId(currentAgent.modelId));
    setSearch("");
    setProviderFilter("all");
    setTypeFilter("all");
    setSortMode("recent");
    setError(null);
  }, [agentId, open]);

  const visibleModels = useMemo(() => {
    const query = search.trim().toLowerCase();

    return [...modelOptions]
      .sort((left, right) => {
        if (sortMode === "context") {
          return (right.contextWindow ?? 0) - (left.contextWindow ?? 0);
        }

        if (sortMode === "provider") {
          const providerDelta = resolvePickerModelProvider(left).localeCompare(resolvePickerModelProvider(right));
          if (providerDelta !== 0) {
            return providerDelta;
          }
        }

        const leftUnavailable = !isSelectableModel(left);
        const rightUnavailable = !isSelectableModel(right);

        if (leftUnavailable !== rightUnavailable) {
          return leftUnavailable ? 1 : -1;
        }

        const providerDelta = resolvePickerModelProvider(left).localeCompare(resolvePickerModelProvider(right));
        if (providerDelta !== 0) {
          return providerDelta;
        }

        const nameDelta = left.name.localeCompare(right.name);
        if (nameDelta !== 0) {
          return nameDelta;
        }

        return left.id.localeCompare(right.id);
      })
      .filter((model) => {
        const provider = resolvePickerModelProvider(model);

        if (providerFilter !== "all" && provider !== providerFilter) {
          return false;
        }

        if (typeFilter === "local" && !model.local) {
          return false;
        }

        if (typeFilter === "remote" && model.local) {
          return false;
        }

        if (typeFilter === "ready" && !isSelectableModel(model)) {
          return false;
        }

        if (typeFilter === "needs-setup" && isSelectableModel(model)) {
          return false;
        }

        if (!query) {
          return true;
        }

        const haystack =
          `${model.name} ${model.id} ${resolvePickerModelProvider(model)} ${model.provider} ${model.input} ${model.tags.join(" ")}`
            .toLowerCase();
        return haystack.includes(query);
      });
  }, [modelOptions, providerFilter, search, sortMode, typeFilter]);

  const selectedModel = selectedModelId
    ? findModelByCanonicalId(modelOptions, selectedModelId)
    : null;
  const selectedModelSelectable = selectedModel ? isSelectableModel(selectedModel) : false;
  const hasChanges = Boolean(selectedModelId) && selectedModelId !== currentModelId;
  const providerOptions = useMemo(
    () =>
      Array.from(new Set(modelOptions.map((model) => resolvePickerModelProvider(model))))
        .filter(Boolean)
        .sort((left, right) => formatModelProviderLabel(left).localeCompare(formatModelProviderLabel(right))),
    [modelOptions]
  );
  const currentStatusLabel = currentModel
    ? resolveModelStatusLabel(currentModel)
    : currentModelId
      ? "Unknown"
      : "Default route";

  const saveModel = async () => {
    if (!agent || !selectedModel || !selectedModelSelectable || !hasChanges) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/agents", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          id: agent.id,
          modelId: selectedModelId
        })
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok || payload.error) {
        throw new Error(payload.error || "Unable to update the agent model.");
      }

      onSnapshotChange?.((current) => updateSnapshotAgentModel(current, agent.id, selectedModelId));
      toast.success("Agent model updated.", {
        description: selectedModel.name
      });
      onOpenChange(false);

      const refreshPromise = onRefresh?.();
      if (refreshPromise) {
        void refreshPromise.catch(() => undefined);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update the agent model.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenAddModels = () => {
    onOpenAddModels(null);
    onOpenChange(false);
  };

  if (!agent) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex h-[min(88dvh,860px)] max-h-[88dvh] w-[calc(100vw-16px)] max-w-[1500px] flex-col gap-0 overflow-hidden rounded-[28px] p-0 sm:w-[min(1500px,calc(100vw-42px))]",
          isLight
            ? "agentos-light-modal border-border bg-card text-card-foreground shadow-[0_30px_90px_rgba(63,47,34,0.18),0_0_0_1px_rgba(120,92,66,0.08)]"
            : "border-violet-400/45 bg-[#070a14] text-white shadow-[0_0_0_1px_rgba(168,85,247,0.18),0_30px_120px_rgba(3,7,18,0.72),0_0_80px_rgba(124,58,237,0.20)]"
        )}
      >
        <DialogHeader
          className={cn(
            "relative shrink-0 overflow-hidden border-b px-6 py-4 pr-14",
            isLight
              ? "border-border bg-[radial-gradient(circle_at_15%_20%,rgba(236,72,153,0.10),transparent_32%),radial-gradient(circle_at_92%_12%,rgba(124,58,237,0.12),transparent_30%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--muted)/0.64))]"
              : "border-white/10 bg-[radial-gradient(circle_at_15%_20%,rgba(236,72,153,0.16),transparent_32%),radial-gradient(circle_at_92%_12%,rgba(124,58,237,0.20),transparent_30%),linear-gradient(135deg,rgba(12,18,34,0.98),rgba(8,10,23,0.98))]"
          )}
        >
          <div className={cn("absolute inset-x-12 bottom-0 h-px bg-gradient-to-r from-transparent to-transparent", isLight ? "via-primary/25" : "via-violet-400/60")} />
          <div className="flex items-center gap-4">
            <div
              className={cn(
                "flex h-14 w-14 items-center justify-center rounded-[18px] border",
                isLight
                  ? "border-primary/20 bg-primary/10 text-primary shadow-[0_18px_42px_rgba(124,58,237,0.10)]"
                  : "border-pink-400/25 bg-[linear-gradient(145deg,rgba(236,72,153,0.20),rgba(124,58,237,0.14))] text-pink-300 shadow-[0_0_36px_rgba(236,72,153,0.18)]"
              )}
            >
              <Grid2X2 className="h-6 w-6" />
            </div>
            <div>
              <DialogTitle className={cn("font-display text-[1.45rem] leading-none tracking-[-0.04em]", isLight ? "text-foreground" : "text-white")}>
                Change Model
              </DialogTitle>
              <DialogDescription className={cn("mt-1.5 max-w-[620px] text-[0.82rem] leading-5", isLight ? "text-muted-foreground" : "text-slate-300")}>
                Choose the model this agent will use.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden p-4 lg:grid-cols-[330px_minmax(0,1fr)]",
            isLight
              ? "bg-[radial-gradient(circle_at_8%_85%,hsl(var(--primary)/0.08),transparent_28%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--muted)/0.42))]"
              : "bg-[radial-gradient(circle_at_8%_85%,rgba(34,211,238,0.10),transparent_28%),linear-gradient(180deg,rgba(4,7,17,0.96),rgba(3,6,14,0.98))]"
          )}
        >
          <aside
            className={cn(
              "min-h-0 overflow-y-auto rounded-[20px] border p-3",
              isLight
                ? "border-border bg-card shadow-card"
                : "border-white/10 bg-[linear-gradient(180deg,rgba(17,24,43,0.90),rgba(9,13,25,0.92))] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
            )}
          >
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "flex h-14 w-14 items-center justify-center rounded-[18px] border",
                  isLight
                    ? "border-primary/20 bg-[radial-gradient(circle_at_50%_15%,rgba(255,255,255,0.65),transparent_28%),linear-gradient(145deg,hsl(var(--primary)/0.16),hsl(var(--muted)))] text-primary shadow-[0_18px_42px_rgba(124,58,237,0.10)]"
                    : "border-violet-300/25 bg-[radial-gradient(circle_at_50%_15%,rgba(255,255,255,0.18),transparent_25%),linear-gradient(145deg,rgba(124,58,237,0.72),rgba(30,41,59,0.82))] text-white shadow-[0_18px_48px_rgba(124,58,237,0.28)]"
                )}
              >
                <Bot className="h-7 w-7" />
              </div>
              <div className="min-w-0">
                <p className={cn("truncate font-display text-[1.05rem]", isLight ? "text-foreground" : "text-white")}>{formatAgentDisplayName(agent)}</p>
                <p className={cn("mt-0.5 truncate text-[0.74rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>{agent.id}</p>
                <Badge className={cn("mt-1.5 px-2 py-0.5 text-[9px] uppercase tracking-[0.14em]", isLight ? "border-primary/25 bg-primary/10 text-primary" : "border-violet-400/30 bg-violet-400/15 text-violet-100")}>
                  Current agent
                </Badge>
              </div>
            </div>

            <div className={cn("mt-4 rounded-[16px] border p-3", isLight ? "border-border bg-muted/35" : "border-white/10 bg-white/[0.035]")}>
              <div className="flex items-center gap-3">
                <div className={cn("flex h-9 w-9 items-center justify-center rounded-[12px] border", isLight ? "border-primary/20 bg-primary/10 text-primary" : "border-violet-300/20 bg-violet-400/15 text-violet-100")}>
                  <ProviderGlyph provider={currentModel ? resolvePickerModelProvider(currentModel) : "openai-codex"} />
                </div>
                <div className="min-w-0">
                  <p className={cn("text-[0.66rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>Current model</p>
                  <p className={cn("truncate text-[0.86rem] font-semibold", isLight ? "text-foreground" : "text-white")}>
                    {currentModel?.name || (currentModelId ? currentModelId : "OpenClaw default")}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <MetricTile label="Provider" value={currentModel ? formatPickerModelProviderLabel(currentModel) : "Default"} surfaceTheme={surfaceTheme} />
              <MetricTile label="Context window" value={currentModel ? formatContextWindow(currentModel.contextWindow) : "Unknown"} surfaceTheme={surfaceTheme} />
              <MetricTile label="Status" value={currentStatusLabel} tone={currentModelSelectable ? "success" : "warning"} surfaceTheme={surfaceTheme} />
            </div>

            <div className={cn("mt-3 rounded-[16px] border p-3", isLight ? "border-border bg-muted/35" : "border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.74),rgba(15,23,42,0.34))]")}>
              <div className="flex items-center gap-3">
                <div className={cn("relative flex h-12 w-12 items-center justify-center rounded-full border", isLight ? "border-primary/20 bg-primary/10" : "border-violet-400/20 bg-violet-500/10")}>
                  <div className={cn("absolute inset-1 rounded-full border-[5px] border-r-transparent opacity-70", isLight ? "border-primary/50" : "border-violet-500/55")} />
                  <span className={cn("text-[0.68rem] font-semibold", isLight ? "text-primary" : "text-white")}>N/A</span>
                </div>
                <div>
                  <p className={cn("text-[0.66rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>Context capacity</p>
                  <p className={cn("mt-0.5 text-[0.98rem] font-semibold", isLight ? "text-foreground" : "text-white")}>
                    {currentModel ? formatContextWindow(currentModel.contextWindow) : "Unknown"}
                  </p>
                  <p className={cn("mt-0.5 text-[0.66rem]", isLight ? "text-muted-foreground" : "text-slate-500")}>Live token usage is not available from OpenClaw yet</p>
                </div>
              </div>
            </div>

            <div className={cn("mt-3 rounded-[16px] border p-2.5", isLight ? "border-border bg-muted/35" : "border-white/10 bg-white/[0.035]")}>
              <p className={cn("px-1 text-[0.66rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>Quick actions</p>
              <button
                type="button"
                onClick={handleOpenAddModels}
                className={cn(
                  "mt-2 flex w-full items-center justify-between rounded-[13px] border px-2.5 py-2.5 text-left transition",
                  isLight
                    ? "border-border bg-card text-foreground hover:border-primary/25 hover:bg-accent"
                    : "border-white/8 bg-white/[0.04] hover:border-violet-300/30 hover:bg-violet-400/10"
                )}
              >
                <span className="flex items-center gap-3">
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-[10px]", isLight ? "bg-primary/10 text-primary" : "bg-white/[0.06] text-slate-200")}>
                    <Database className="h-3.5 w-3.5" />
                  </span>
                  <span>
                    <span className={cn("block text-[0.78rem] font-medium", isLight ? "text-foreground" : "text-white")}>Open Model Library</span>
                    <span className={cn("block text-[0.66rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>Manage providers & models</span>
                  </span>
                </span>
                <ChevronRight className={cn("h-4 w-4", isLight ? "text-muted-foreground" : "text-slate-500")} />
              </button>
              <button
                type="button"
                className={cn(
                  "mt-1.5 flex w-full cursor-not-allowed items-center justify-between rounded-[13px] border px-2.5 py-2.5 text-left opacity-70",
                  isLight ? "border-border bg-muted/55 text-muted-foreground" : "border-white/8 bg-white/[0.025]"
                )}
                title="Model settings are managed by provider setup for now."
              >
                <span className="flex items-center gap-3">
                  <span className={cn("flex h-8 w-8 items-center justify-center rounded-[10px]", isLight ? "bg-muted text-muted-foreground" : "bg-white/[0.06] text-slate-300")}>
                    <Settings className="h-3.5 w-3.5" />
                  </span>
                  <span>
                    <span className={cn("block text-[0.78rem] font-medium", isLight ? "text-foreground" : "text-white")}>Model Settings</span>
                    <span className={cn("block text-[0.66rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>Default params & routing</span>
                  </span>
                </span>
                <ChevronRight className={cn("h-4 w-4", isLight ? "text-muted-foreground" : "text-slate-500")} />
              </button>
            </div>
          </aside>

          <section
            className={cn(
              "min-h-0 overflow-hidden rounded-[20px] border p-3",
              isLight
                ? "border-border bg-card shadow-card"
                : "border-white/10 bg-[linear-gradient(180deg,rgba(10,15,30,0.82),rgba(5,8,18,0.86))] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
            )}
          >
            <div className="flex flex-col gap-2 xl:flex-row">
              <div className="relative min-w-0 flex-1">
                <Search className={cn("pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2", isLight ? "text-muted-foreground" : "text-slate-500")} />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search models..."
                  className={cn("h-10 rounded-[12px] pl-10 text-[0.82rem]", isLight ? "border-input bg-card text-foreground" : "border-white/10 bg-slate-950/45 text-slate-100")}
                />
              </div>
              <NativeFilter value={providerFilter} onChange={setProviderFilter} ariaLabel="Provider filter" surfaceTheme={surfaceTheme}>
                <option value="all">All providers</option>
                {providerOptions.map((provider) => (
                  <option key={provider} value={provider}>{formatModelProviderLabel(provider)}</option>
                ))}
              </NativeFilter>
              <NativeFilter value={typeFilter} onChange={setTypeFilter} ariaLabel="Type filter" surfaceTheme={surfaceTheme}>
                <option value="all">All types</option>
                <option value="remote">Remote</option>
                <option value="local">Local</option>
                <option value="ready">Ready</option>
                <option value="needs-setup">Needs setup</option>
              </NativeFilter>
              <NativeFilter value={sortMode} onChange={setSortMode} ariaLabel="Sort models" surfaceTheme={surfaceTheme}>
                <option value="recent">Sort: Recent</option>
                <option value="context">Sort: Context</option>
                <option value="provider">Sort: Provider</option>
              </NativeFilter>
              <Button type="button" variant="secondary" className="h-10 rounded-[12px] px-3">
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-3 min-h-0 overflow-y-auto pr-1 lg:max-h-[calc(88dvh-205px)]">
              <div className="space-y-1.5">
                {visibleModels.length > 0 ? (
                  visibleModels.map((model) => {
                    const selected = selectedModelId === model.id;
                    const selectable = isSelectableModel(model);
                    const provider = resolvePickerModelProvider(model);

                    return (
                      <button
                        key={model.id}
                        type="button"
                        disabled={!selectable}
                        aria-pressed={selected}
                        onClick={() => selectable && setSelectedModelId(model.id)}
                        className={cn(
                          "grid w-full grid-cols-[24px_1fr] items-center gap-3 rounded-[15px] border px-3 py-2.5 text-left transition lg:grid-cols-[24px_1.15fr_112px_104px_104px_74px_20px]",
                          selected
                            ? isLight
                              ? "border-primary/55 bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary)/0.14),0_18px_40px_rgba(124,58,237,0.12)]"
                              : "border-violet-400/85 bg-[radial-gradient(circle_at_10%_50%,rgba(124,58,237,0.28),transparent_36%),linear-gradient(180deg,rgba(39,25,79,0.80),rgba(12,18,35,0.86))] shadow-[0_0_0_1px_rgba(168,85,247,0.28),0_0_36px_rgba(124,58,237,0.28)]"
                            : isLight
                              ? "border-border bg-card hover:border-primary/25 hover:bg-accent/60"
                              : "border-white/8 bg-white/[0.035] hover:border-violet-300/25 hover:bg-white/[0.055]",
                          !selectable && "cursor-not-allowed opacity-60"
                        )}
                      >
                        <span className={cn(
                          "flex h-5 w-5 items-center justify-center rounded-full border",
                          selected
                            ? "border-primary bg-primary text-primary-foreground"
                            : isLight
                              ? "border-border bg-card"
                              : "border-slate-500/70 bg-slate-950/40"
                        )}>
                          {selected ? <Check className="h-3 w-3" /> : null}
                        </span>

                        <span className="flex min-w-0 items-center gap-3">
                          <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] border", getProviderIconTone(provider, surfaceTheme))}>
                            <ProviderGlyph provider={provider} />
                          </span>
                          <span className="min-w-0">
                            <span className={cn("block truncate text-[0.88rem] font-semibold", isLight ? "text-foreground" : "text-white")}>{formatModelLabel(model.id)}</span>
                            <span className={cn("mt-0.5 block truncate text-[0.74rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>{model.name}</span>
                            <span className="mt-1.5 flex flex-wrap gap-1">
                              <Badge variant="muted" className="px-1.5 py-0.5 text-[9px]">{formatModelProviderLabel(provider)}</Badge>
                              {model.contextWindow ? (
                                <Badge variant="muted" className="px-1.5 py-0.5 text-[9px]">{formatContextWindow(model.contextWindow)} context window</Badge>
                              ) : null}
                            </span>
                            {!selectable ? <span className={cn("mt-2 block text-[0.72rem]", isLight ? "text-amber-800" : "text-amber-200")}>{resolveModelSetupHint(model)}</span> : null}
                          </span>
                        </span>

                        <MetricInline icon={<Cpu className="h-4 w-4" />} value={formatContextWindow(model.contextWindow)} label="Context window" surfaceTheme={surfaceTheme} />
                        <MetricInline icon={<Zap className="h-4 w-4" />} value={resolvePerformanceLabel(model)} label="Performance" surfaceTheme={surfaceTheme} />
                        <MetricInline icon={<span className={cn("h-3 w-3 rounded-full", selectable ? "bg-emerald-400" : "bg-amber-400")} />} value={selectable ? "Ready" : "Needs setup"} label="Status" tone={selectable ? "success" : "warning"} surfaceTheme={surfaceTheme} />
                        <Badge className={cn("justify-self-start rounded-[8px] px-2 py-0.5 text-[0.66rem]", model.local ? (isLight ? "border-cyan-300 bg-cyan-50 text-cyan-800" : "border-cyan-300/30 bg-cyan-400/10 text-cyan-100") : (isLight ? "border-primary/25 bg-primary/10 text-primary" : "border-violet-300/30 bg-violet-500/10 text-violet-100"))}>
                          {model.local ? "Local" : "Remote"}
                        </Badge>
                        <ChevronRight className={cn("hidden h-5 w-5 justify-self-end lg:block", isLight ? "text-muted-foreground" : "text-slate-400")} />
                      </button>
                    );
                  })
                ) : (
                  <div className={cn("rounded-[18px] border border-dashed px-4 py-12 text-center", isLight ? "border-border bg-muted/35" : "border-white/12 bg-white/[0.03]")}>
                    <p className={cn("text-sm", isLight ? "text-muted-foreground" : "text-slate-300")}>{search.trim() ? "No models matched this search." : "No usable models are available yet."}</p>
                    <Button type="button" className="mt-4 rounded-full" onClick={handleOpenAddModels}>
                      <Plus className="mr-2 h-4 w-4" />
                      Open Model Library
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {error ? (
              <div className={cn("mt-3 rounded-[16px] border px-4 py-3 text-[0.82rem]", isLight ? "border-rose-200 bg-rose-50 text-rose-800" : "border-rose-400/25 bg-rose-400/[0.10] text-rose-100")}>
                {error}
              </div>
            ) : null}
          </section>
        </div>

        <div className={cn("shrink-0 border-t px-6 py-3", isLight ? "border-border bg-card" : "border-white/[0.08] bg-slate-950/55")}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className={cn("flex items-center gap-2 text-[0.76rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>
              <Info className={cn("h-4 w-4", isLight ? "text-muted-foreground" : "text-slate-500")} />
              <span>Models marked <span className={cn(isLight ? "text-amber-800" : "text-amber-300")}>Needs setup</span> require provider connection first.</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                className="h-10 rounded-[12px] px-6 text-[0.82rem]"
                disabled={saving}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="h-10 rounded-[12px] bg-[linear-gradient(135deg,#7c3aed,#ec4899)] px-6 text-[0.82rem] font-semibold shadow-[0_18px_45px_rgba(124,58,237,0.35)]"
                disabled={saving || !hasChanges || !selectedModelSelectable}
                onClick={() => {
                  void saveModel();
                }}
              >
                {saving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                Save Model
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function isSelectableModel(model: AgentModelRecord) {
  return !model.missing && model.available !== false;
}

function ProviderGlyph({ provider }: { provider: string }) {
  if (provider === "openai-codex" || provider === "openai") {
    return <Sparkles className="h-5 w-5" />;
  }

  if (provider === "ollama") {
    return <Bot className="h-5 w-5" />;
  }

  if (provider === "openrouter") {
    return <Boxes className="h-5 w-5" />;
  }

  return <Database className="h-5 w-5" />;
}

function MetricTile({
  label,
  value,
  tone = "default",
  surfaceTheme = "dark"
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "warning";
  surfaceTheme?: "dark" | "light";
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div className={cn("rounded-[13px] border p-2", isLight ? "border-border bg-card" : "border-white/10 bg-white/[0.035]")}>
      <p className={cn("text-[0.6rem] leading-3", isLight ? "text-muted-foreground" : "text-slate-400")}>{label}</p>
      <p
        className={cn(
          "mt-1.5 truncate text-[0.76rem] font-semibold",
          tone === "success"
            ? isLight ? "text-emerald-700" : "text-emerald-300"
            : tone === "warning"
              ? isLight ? "text-amber-800" : "text-amber-300"
              : isLight ? "text-foreground" : "text-white"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function MetricInline({
  icon,
  value,
  label,
  tone = "default",
  surfaceTheme = "dark"
}: {
  icon: ReactNode;
  value: string;
  label: string;
  tone?: "default" | "success" | "warning";
  surfaceTheme?: "dark" | "light";
}) {
  const isLight = surfaceTheme === "light";
  const toneText =
    tone === "success"
      ? isLight ? "text-emerald-700" : "text-emerald-300"
      : tone === "warning"
        ? isLight ? "text-amber-800" : "text-amber-300"
        : isLight ? "text-foreground" : "text-white";

  return (
    <span className="hidden min-w-0 items-center gap-3 lg:flex">
      <span className={cn(isLight ? "text-muted-foreground" : "text-slate-300", toneText)}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className={cn("block truncate text-[0.78rem] font-semibold", toneText)}>
          {value}
        </span>
        <span className={cn("block text-[0.64rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>{label}</span>
      </span>
    </span>
  );
}

function NativeFilter({
  value,
  onChange,
  ariaLabel,
  children,
  surfaceTheme = "dark"
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  children: ReactNode;
  surfaceTheme?: "dark" | "light";
}) {
  const isLight = surfaceTheme === "light";

  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "h-10 min-w-[118px] rounded-[12px] border px-3 text-[0.78rem] font-medium outline-none transition",
        isLight
          ? "border-input bg-card text-foreground hover:border-primary/30 focus:border-primary/50"
          : "border-white/10 bg-slate-950/45 text-slate-100 hover:border-violet-300/30 focus:border-violet-300/50"
      )}
    >
      {children}
    </select>
  );
}

function getProviderIconTone(provider: string, surfaceTheme: "dark" | "light" = "dark") {
  const isLight = surfaceTheme === "light";

  if (provider === "openai-codex" || provider === "openai") {
    return isLight
      ? "border-primary/20 bg-primary/10 text-primary shadow-[0_16px_34px_rgba(124,58,237,0.10)]"
      : "border-violet-300/25 bg-violet-500/15 text-violet-100 shadow-[0_0_28px_rgba(124,58,237,0.16)]";
  }

  if (provider === "openrouter") {
    return isLight
      ? "border-slate-300 bg-slate-100 text-slate-700"
      : "border-slate-300/20 bg-slate-400/10 text-slate-100";
  }

  if (provider === "ollama") {
    return isLight
      ? "border-cyan-300 bg-cyan-50 text-cyan-800"
      : "border-cyan-300/25 bg-cyan-400/10 text-cyan-100";
  }

  return isLight
    ? "border-amber-300 bg-amber-50 text-amber-800"
    : "border-amber-300/25 bg-amber-400/10 text-amber-100";
}

function resolvePerformanceLabel(model: AgentModelRecord) {
  if (model.local) {
    return "Local";
  }

  if ((model.contextWindow ?? 0) >= 250_000) {
    return "High";
  }

  if ((model.contextWindow ?? 0) >= 100_000) {
    return "Balanced";
  }

  return "Fast";
}

function resolveModelSetupHint(model: AgentModelRecord) {
  const provider = resolvePickerModelProvider(model);
  const descriptor = isAddModelsProviderId(provider)
    ? getModelProviderDescriptor(provider)
    : null;

  if (model.missing) {
    if (descriptor?.connectKind === "local") {
      return `${descriptor.shortLabel} is installed, but this model is not pulled locally yet.`;
    }

    return descriptor
      ? `${descriptor.shortLabel} does not have this model available yet. Open Add Models > Providers to connect or refresh it.`
      : "This model is not available yet.";
  }

  if (model.available === false) {
    if (descriptor?.connectKind === "apiKey") {
      return `Connect your ${descriptor.shortLabel} API key in Add Models > Providers to use this model.`;
    }

    if (descriptor?.connectKind === "oauth") {
      return `Connect your ${descriptor.shortLabel} account in Add Models > Providers to use this model.`;
    }

    if (descriptor?.connectKind === "local") {
      return `Pull this model locally with Ollama, then refresh the list.`;
    }

    return descriptor
      ? `Open Add Models > Providers to finish setup for ${descriptor.shortLabel}.`
      : "Open Add Models > Providers to finish setup.";
  }

  return "This model is not ready for assignment.";
}

function formatPickerModelProviderLabel(model: AgentModelRecord) {
  return formatModelProviderLabel(resolvePickerModelProvider(model));
}

function resolvePickerModelProvider(model: AgentModelRecord) {
  const canonicalModelId = normalizeOpenAiCodexModelId(model.id);

  if (
    model.provider === "codex" ||
    model.provider === "openai-codex" ||
    isKnownOpenAiCodexModelId(canonicalModelId)
  ) {
    return "openai-codex";
  }

  return model.provider;
}

function resolveModelStatusLabel(model: AgentModelRecord) {
  if (model.missing) {
    return "Missing";
  }

  if (model.available === false) {
    return "Unavailable";
  }

  if (model.local) {
    return "Local";
  }

  return "Remote";
}

function updateSnapshotAgentModel(
  snapshot: MissionControlSnapshot,
  agentId: string,
  modelId: string
) {
  const canonicalModelId = normalizeOpenAiCodexModelId(modelId);
  const nextAgents = snapshot.agents.map((agent) =>
    agent.id === agentId
      ? {
          ...agent,
          modelId: canonicalModelId
        }
      : agent
  );

  const modelUsage = new Map<string, number>();
  for (const agent of nextAgents) {
    const assignedModelId = agent.modelId?.trim();

    if (!assignedModelId || assignedModelId === "unassigned") {
      continue;
    }

    const canonicalAssignedModelId = normalizeOpenAiCodexModelId(assignedModelId);
    modelUsage.set(canonicalAssignedModelId, (modelUsage.get(canonicalAssignedModelId) ?? 0) + 1);
  }

  return {
    ...snapshot,
    agents: nextAgents,
    models: dedupeSnapshotModels(snapshot.models).map((model) => ({
      ...model,
      usageCount: modelUsage.get(model.id) ?? 0
    }))
  };
}

function findModelByCanonicalId(
  models: AgentModelRecord[],
  modelId: string
) {
  const canonicalModelId = normalizeOpenAiCodexModelId(modelId);

  return models.find((entry) => normalizeOpenAiCodexModelId(entry.id) === canonicalModelId) ?? null;
}

function dedupeSnapshotModels(models: AgentModelRecord[]) {
  const recordsByIdentity = new Map<string, AgentModelRecord>();

  for (const model of models) {
    const canonicalId = normalizeOpenAiCodexModelId(model.id);
    const provider = resolvePickerModelProvider(model);
    const normalizedModel = canonicalId === model.id
      ? {
          ...model,
          provider
        }
      : {
          ...model,
          id: canonicalId,
          provider
        };
    const identityKey = modelRecordIdentityKey(model.id, provider);
    const existing = recordsByIdentity.get(identityKey);

    recordsByIdentity.set(
      identityKey,
      existing ? mergeSnapshotModelRecords(existing, normalizedModel) : normalizedModel
    );
  }

  return Array.from(recordsByIdentity.values());
}

function mergeSnapshotModelRecords(
  existing: AgentModelRecord,
  candidate: AgentModelRecord
) {
  const preferred = scoreSnapshotModelRecord(candidate) > scoreSnapshotModelRecord(existing) ? candidate : existing;
  const fallback = preferred === candidate ? existing : candidate;

  return {
    ...preferred,
    contextWindow: preferred.contextWindow ?? fallback.contextWindow,
    local: preferred.local ?? fallback.local,
    available: preferred.available === true || fallback.available === true
      ? true
      : preferred.available ?? fallback.available,
    missing: preferred.missing && fallback.missing,
    tags: Array.from(new Set([...preferred.tags, ...fallback.tags].filter(Boolean))),
    usageCount: Math.max(preferred.usageCount, fallback.usageCount)
  };
}

function scoreSnapshotModelRecord(model: AgentModelRecord) {
  let score = 0;

  if (model.available === true) {
    score += 100;
  }

  if (!model.missing) {
    score += 50;
  }

  if (model.provider === "openai-codex") {
    score += 10;
  }

  if (model.usageCount > 0) {
    score += 5;
  }

  return score;
}
