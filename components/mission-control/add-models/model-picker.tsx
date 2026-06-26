"use client";

import { AlertTriangle, Check, Lock, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getModelProviderDescriptor } from "@/lib/openclaw/model-provider-registry";
import type { AddModelsCatalogModel, AddModelsProviderId } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

function filterModels(models: AddModelsCatalogModel[], search: string) {
  const query = search.trim().toLowerCase();

  if (!query) {
    return models;
  }

  return models.filter((model) => {
    const haystack = `${model.name} ${model.id} ${model.tags.join(" ")}`.toLowerCase();
    return haystack.includes(query);
  });
}

export function ModelPicker({
  provider,
  models,
  selectedModelIds,
  search,
  onSearchChange,
  onToggleModel,
  onAddSelected,
  isAdding,
  surfaceTheme = "dark"
}: {
  provider: AddModelsProviderId;
  models: AddModelsCatalogModel[];
  selectedModelIds: string[];
  search: string;
  onSearchChange: (value: string) => void;
  onToggleModel: (modelId: string) => void;
  onAddSelected: () => void;
  isAdding: boolean;
  surfaceTheme?: "dark" | "light";
}) {
  const isLight = surfaceTheme === "light";
  const recommendedModels = models.filter((model) => model.recommended);
  const availableSelectedCount = selectedModelIds.filter(
    (modelId) => !models.find((model) => model.id === modelId)?.alreadyAdded
  ).length;
  const hasOpenRouterTabs = provider === "openrouter";
  const searchPlaceholder = getModelProviderDescriptor(provider).searchPlaceholder;
  const showSearch = models.length > 8 || Boolean(searchPlaceholder);
  const filteredRecommendedModels = filterModels(recommendedModels, search);
  const filteredAllModels = filterModels(models, search);

  return (
    <div
      className={cn(
        "rounded-[15px] border p-3",
        isLight
          ? "border-[#e3d5c8] bg-[linear-gradient(180deg,rgba(255,252,248,0.98),rgba(247,241,234,0.95))]"
          : "border-white/10 bg-[linear-gradient(180deg,rgba(10,15,26,0.94),rgba(7,11,20,0.96))]"
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className={cn("font-display text-[0.78rem]", isLight ? "text-[#2d241f]" : "text-white")}>
            Select models to add
          </p>
        </div>
        <Badge variant="muted" className="px-1.5 py-0.5 text-[8px] tracking-[0.12em]">
          {models.filter((model) => model.alreadyAdded).length} already added
        </Badge>
      </div>

      {showSearch ? (
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder ?? "Search models"}
            className="h-7 pl-8 text-[10px]"
          />
        </div>
      ) : null}

      {hasOpenRouterTabs ? (
        <Tabs defaultValue="recommended" className="mt-3">
          <TabsList className="h-7 rounded-[14px] p-0.5">
            <TabsTrigger value="recommended" className="rounded-[11px] px-2 py-1 text-[9px]">
              Recommended
            </TabsTrigger>
            <TabsTrigger value="all" className="rounded-[11px] px-2 py-1 text-[9px]">
              All models
            </TabsTrigger>
          </TabsList>
          <TabsContent value="recommended">
            <ModelList
              models={filteredRecommendedModels}
              selectedModelIds={selectedModelIds}
              onToggleModel={onToggleModel}
              emptyMessage="No recommended matches. Switch to All models to browse the full catalog."
              surfaceTheme={surfaceTheme}
            />
          </TabsContent>
          <TabsContent value="all">
            <ModelList
              models={filteredAllModels}
              selectedModelIds={selectedModelIds}
              onToggleModel={onToggleModel}
              emptyMessage="No models matched this search."
              surfaceTheme={surfaceTheme}
            />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="mt-3">
          <ModelList
            models={filteredAllModels}
            selectedModelIds={selectedModelIds}
            onToggleModel={onToggleModel}
            emptyMessage="No models matched this search."
            surfaceTheme={surfaceTheme}
          />
        </div>
      )}

      <div className={cn("mt-3 flex items-center justify-between gap-2 border-t pt-3", isLight ? "border-[#e3d5c8]" : "border-white/10")}>
        <p className={cn("text-[8px] leading-3", isLight ? "text-[#74665c]" : "text-slate-400")}>
          {availableSelectedCount > 0
            ? `${availableSelectedCount} model${availableSelectedCount === 1 ? "" : "s"} selected`
            : "Choose at least one model to add"}
        </p>
        <Button
          type="button"
          onClick={onAddSelected}
          disabled={availableSelectedCount === 0 || isAdding}
          className="h-7 rounded-full px-2.5 text-[9px]"
        >
          {isAdding ? "Adding..." : "Add selected models"}
        </Button>
      </div>
    </div>
  );
}

function ModelList({
  models,
  selectedModelIds,
  onToggleModel,
  emptyMessage,
  surfaceTheme = "dark"
}: {
  models: AddModelsCatalogModel[];
  selectedModelIds: string[];
  onToggleModel: (modelId: string) => void;
  emptyMessage: string;
  surfaceTheme?: "dark" | "light";
}) {
  const isLight = surfaceTheme === "light";

  if (models.length === 0) {
    return (
      <div
        className={cn(
          "rounded-[13px] border border-dashed px-3 py-4 text-center text-[10px]",
          isLight ? "border-[#e3d5c8] bg-white/70 text-[#74665c]" : "border-white/10 bg-white/[0.03] text-slate-400"
        )}
      >
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="max-h-[min(40vh,360px)] space-y-1 overflow-y-auto pr-1">
      {models.map((model) => {
        const selected = selectedModelIds.includes(model.id);
        const needsSetup = !model.alreadyAdded && (model.available === false || model.missing);

        return (
          <button
            key={model.id}
            type="button"
            disabled={model.alreadyAdded}
            onClick={() => onToggleModel(model.id)}
            className={cn(
              "flex w-full items-start justify-between gap-2 rounded-[12px] border px-2.5 py-1.5 text-left transition-all",
              isLight
                ? model.alreadyAdded
                  ? "cursor-not-allowed border-[#e6d8cb] bg-[#f7f1ea] opacity-70"
                  : selected
                    ? "border-cyan-300 bg-cyan-50"
                    : needsSetup
                      ? "border-amber-300 bg-amber-50 hover:border-amber-400"
                    : "border-[#e6d8cb] bg-white/80 hover:border-[#d8c6b8] hover:bg-white"
                : model.alreadyAdded
                  ? "cursor-not-allowed border-white/8 bg-white/[0.02] opacity-70"
                  : selected
                    ? "border-cyan-300/35 bg-cyan-300/[0.08]"
                    : needsSetup
                      ? "border-amber-300/20 bg-amber-300/[0.06] hover:border-amber-300/30 hover:bg-amber-300/[0.08]"
                    : "border-white/8 bg-white/[0.03] hover:border-white/16 hover:bg-white/[0.05]"
            )}
          >
            <div className="flex min-w-0 items-start gap-2">
              <div
                className={cn(
                  "mt-0.5 flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-md border",
                  isLight
                    ? model.alreadyAdded
                      ? "border-[#d9cbbf] bg-white text-[#8c8177]"
                      : selected
                        ? "border-cyan-300 bg-cyan-100 text-cyan-800"
                        : needsSetup
                          ? "border-amber-300 bg-amber-100 text-amber-800"
                        : "border-[#d9cbbf] bg-white text-transparent"
                    : model.alreadyAdded
                      ? "border-white/10 bg-white/[0.03] text-slate-500"
                      : selected
                        ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-100"
                        : needsSetup
                          ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
                        : "border-white/12 bg-white/[0.03] text-transparent"
                )}
              >
                {model.alreadyAdded ? (
                  <Lock className="h-2 w-2" />
                ) : selected ? (
                  <Check className="h-2 w-2" />
                ) : (
                  <AlertTriangle className="h-2 w-2" />
                )}
              </div>
              <div className="min-w-0">
                <p className={cn("truncate text-[10px] font-medium", isLight ? "text-[#2d241f]" : "text-white")}>
                  {model.name}
                </p>
                <p className={cn("mt-0.5 truncate text-[8px] uppercase tracking-[0.16em]", isLight ? "text-[#8c8177]" : "text-slate-500")}>
                  {model.id}
                </p>
                <div className={cn("mt-1 flex flex-wrap gap-1.5 text-[8px]", isLight ? "text-[#74665c]" : "text-slate-400")}>
                  <span>{model.input}</span>
                  {model.contextWindow ? <span>{Intl.NumberFormat().format(model.contextWindow)} ctx</span> : null}
                  {model.isFree ? <span>free</span> : null}
                </div>
                {needsSetup ? (
                  <p className={cn("mt-1 text-[8px] leading-3", isLight ? "text-amber-800" : "text-amber-100/85")}>
                    {resolveSetupHint(model)}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="shrink-0">
              {model.alreadyAdded ? (
                <Badge variant="muted" className="px-1.5 py-0.5 text-[8px] tracking-[0.12em]">
                  Already added
                </Badge>
              ) : needsSetup ? (
                <Badge variant="warning" className="px-1.5 py-0.5 text-[8px] tracking-[0.12em]">
                  Needs setup
                </Badge>
              ) : model.recommended ? (
                <Badge variant="default" className="px-1.5 py-0.5 text-[8px] tracking-[0.12em]">
                  Recommended
                </Badge>
              ) : model.local ? (
                <Badge variant="success" className="px-1.5 py-0.5 text-[8px] tracking-[0.12em]">
                  Local
                </Badge>
              ) : (
                <Badge variant="muted" className="px-1.5 py-0.5 text-[8px] tracking-[0.12em]">
                  Remote
                </Badge>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function resolveSetupHint(model: AddModelsCatalogModel) {
  if (model.missing) {
    return "This model is configured, but not available locally yet. You can still add it now, then finish setup in Providers.";
  }

  if (model.available === false) {
    return "This model needs provider setup before it will work. You can add it now, then connect the provider in Add Models > Providers.";
  }

  return "";
}
