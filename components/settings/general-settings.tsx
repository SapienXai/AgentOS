import Link from "next/link";
import { Check, LoaderCircle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SettingsList, SettingsRow, SettingsSection } from "@/components/settings/settings-section";
import type { SettingsPageProps } from "@/components/settings/settings-types";
import { cn } from "@/lib/utils";

export function GeneralSettings({
  snapshot,
  surfaceTheme,
  selectedModelId,
  onSelectedModelIdChange,
  modelOnboardingRunState,
  onRunModelSetDefault,
  onOpenAddModels
}: Pick<SettingsPageProps, "snapshot" | "surfaceTheme" | "selectedModelId" | "onSelectedModelIdChange" | "modelOnboardingRunState" | "onRunModelSetDefault" | "onOpenAddModels">) {
  const defaultModel = snapshot.diagnostics.modelReadiness.resolvedDefaultModel || snapshot.diagnostics.modelReadiness.defaultModel || "";
  const selectedModel = selectedModelId || defaultModel;
  const hasModels = snapshot.models.length > 0;

  return (
    <SettingsSection title="General" description="A small set of product preferences for your AgentOS workspace." surfaceTheme={surfaceTheme}>
      <SettingsList surfaceTheme={surfaceTheme}>
        <SettingsRow
          label="Default model"
          description="The model used when a task does not specify one."
          surfaceTheme={surfaceTheme}
          className="flex-col items-stretch sm:flex-row sm:items-center"
        >
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <select
              aria-label="Default model"
              value={selectedModel}
              onChange={(event) => onSelectedModelIdChange(event.target.value)}
              className={cn(
                "min-h-11 min-w-0 rounded-md border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:min-h-9 sm:w-[230px]",
                surfaceTheme === "light" ? "border-border bg-background text-foreground" : "border-white/[0.12] bg-[#101a2a] text-slate-100"
              )}
            >
              {!hasModels ? <option value="">No models connected</option> : null}
              {snapshot.models.map((model) => <option key={model.id} value={model.id}>{model.name || model.id}</option>)}
            </select>
            <Button
              type="button"
              size="sm"
              onClick={() => void onRunModelSetDefault(selectedModel)}
              disabled={!selectedModel || modelOnboardingRunState === "running"}
              className="min-h-11 rounded-md text-xs sm:min-h-9"
            >
              {modelOnboardingRunState === "running" ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Use model
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow
          label="Model management"
          description="Connect providers, add models, and manage credentials."
          surfaceTheme={surfaceTheme}
          className="flex-col items-start sm:flex-row sm:items-center"
          action={
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => onOpenAddModels(null)} className="min-h-10 rounded-md text-xs sm:min-h-9">
                <Plus className="h-3.5 w-3.5" />
                Add models
              </Button>
              <Button asChild type="button" size="sm" variant="ghost" className="min-h-10 rounded-md px-2 text-xs sm:min-h-9">
                <Link href="/models">Manage models <span aria-hidden="true">→</span></Link>
              </Button>
            </div>
          }
        />
      </SettingsList>
    </SettingsSection>
  );
}
