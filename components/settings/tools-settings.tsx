import { CheckCircle2, LoaderCircle, XCircle } from "lucide-react";

import { SettingsList, SettingsRow, SettingsSection } from "@/components/settings/settings-section";
import type { SettingsPageProps } from "@/components/settings/settings-types";
import { cn } from "@/lib/utils";

const toolDefinitions = [
  { id: "browser" as const, label: "Browser access", description: "Allow agents to interact with websites." },
  { id: "web-search" as const, label: "Web search", description: "Allow agents to search the web." },
  { id: "web-fetch" as const, label: "Web fetch", description: "Allow agents to retrieve content from web pages." }
];

export function ToolsSettings({
  surfaceTheme,
  browserToolEnabled,
  webFetchToolEnabled,
  webSearchToolEnabled,
  isLoadingToolSettings,
  savingToolSettingId,
  toolSettingsSaveState,
  toolSettingsError,
  onSaveToolSetting
}: Pick<SettingsPageProps, "surfaceTheme" | "browserToolEnabled" | "webFetchToolEnabled" | "webSearchToolEnabled" | "isLoadingToolSettings" | "savingToolSettingId" | "toolSettingsSaveState" | "toolSettingsError" | "onSaveToolSetting">) {
  const values = { browser: browserToolEnabled, "web-fetch": webFetchToolEnabled, "web-search": webSearchToolEnabled };

  return (
    <SettingsSection title="AI & Tools" description="Choose what agents are allowed to use. Changes save automatically." surfaceTheme={surfaceTheme}>
      <SettingsList surfaceTheme={surfaceTheme}>
        {toolDefinitions.map((tool) => {
          const enabled = values[tool.id];
          const loading = isLoadingToolSettings || enabled === null || savingToolSettingId === tool.id;
          return (
            <SettingsRow key={tool.id} label={tool.label} description={tool.description} surfaceTheme={surfaceTheme}>
              <button
                type="button"
                role="switch"
                aria-checked={enabled === true}
                aria-label={`${tool.label}: ${enabled === true ? "enabled" : "disabled"}`}
                disabled={loading || savingToolSettingId !== null}
                onClick={() => onSaveToolSetting(tool.id, !enabled)}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-wait disabled:opacity-60 sm:min-h-9 sm:min-w-10"
              >
                <span className={cn(
                  "relative h-5 w-9 rounded-full border transition-colors",
                  enabled === true ? "border-primary/45 bg-primary" : surfaceTheme === "light" ? "border-slate-300 bg-slate-200" : "border-white/[0.12] bg-[#1a2638]"
                )}>
                  {loading ? <LoaderCircle className={cn("absolute left-2 top-0.5 h-4 w-4 animate-spin", surfaceTheme === "light" ? "text-slate-500" : "text-slate-300")} /> : <span className={cn("absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform", enabled === true && "translate-x-4")} />}
                </span>
              </button>
            </SettingsRow>
          );
        })}
      </SettingsList>

      <div className="mt-3 flex min-h-5 items-center justify-between gap-3">
        {toolSettingsError ? <p className={cn("text-xs leading-5", surfaceTheme === "light" ? "text-red-700" : "text-rose-300")} role="alert">{toolSettingsError}</p> : <span />}
        {toolSettingsSaveState === "saving" ? <span className={cn("flex items-center gap-1.5 text-xs", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")} role="status"><LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Saving</span> : null}
        {toolSettingsSaveState === "saved" ? <span className="flex items-center gap-1.5 text-xs text-emerald-600" role="status"><CheckCircle2 className="h-3.5 w-3.5" /> Saved</span> : null}
        {toolSettingsSaveState === "error" ? <span className="flex items-center gap-1.5 text-xs text-red-600" role="status"><XCircle className="h-3.5 w-3.5" /> Not saved</span> : null}
      </div>
    </SettingsSection>
  );
}
