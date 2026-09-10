import { Copy, LoaderCircle, RotateCcw, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingsList, SettingsRow, SettingsSection } from "@/components/settings/settings-section";
import type { SettingsPageProps } from "@/components/settings/settings-types";
import { cn } from "@/lib/utils";

export function WorkspaceSettings({
  snapshot,
  surfaceTheme,
  workspaceRootDraft,
  isSavingWorkspaceRoot,
  onWorkspaceRootDraftChange,
  onSaveWorkspaceRootSettings
}: Pick<SettingsPageProps, "snapshot" | "surfaceTheme" | "workspaceRootDraft" | "isSavingWorkspaceRoot" | "onWorkspaceRootDraftChange" | "onSaveWorkspaceRootSettings">) {
  const currentRoot = snapshot.diagnostics.workspaceRoot || "Not configured";

  const copyRoot = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(workspaceRootDraft || currentRoot);
    }
  };

  return (
    <SettingsSection title="Workspace" description="Choose where AgentOS keeps the active workspace." surfaceTheme={surfaceTheme}>
      <SettingsList surfaceTheme={surfaceTheme}>
        <SettingsRow label="Workspace folder" description="The folder used for workspace files and AgentOS projects." surfaceTheme={surfaceTheme} className="flex-col items-stretch sm:flex-row sm:items-center">
          <div className="flex w-full flex-col gap-2 sm:max-w-[430px] sm:flex-row">
            <div className="flex min-w-0 flex-1 gap-2">
              <Input
                aria-label="Workspace folder"
                value={workspaceRootDraft}
                onChange={(event) => onWorkspaceRootDraftChange(event.target.value)}
                placeholder="~/Documents/AgentOS"
                className="min-h-11 rounded-md sm:min-h-9"
              />
              <button type="button" aria-label="Copy workspace folder" onClick={copyRoot} className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-md border outline-none focus-visible:ring-2 focus-visible:ring-ring/40 sm:h-9 sm:w-9", surfaceTheme === "light" ? "border-border text-muted-foreground hover:bg-muted" : "border-white/[0.12] text-slate-400 hover:bg-white/[0.06]")}>
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex gap-2 sm:shrink-0">
              <Button type="button" size="sm" onClick={() => void onSaveWorkspaceRootSettings(workspaceRootDraft.trim() || null)} disabled={isSavingWorkspaceRoot} className="min-h-11 flex-1 rounded-md text-xs sm:min-h-9 sm:flex-none">
                {isSavingWorkspaceRoot ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => void onSaveWorkspaceRootSettings(null)} disabled={isSavingWorkspaceRoot} className="min-h-11 rounded-md text-xs sm:min-h-9">
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            </div>
          </div>
        </SettingsRow>
        <SettingsRow label="Current folder" value={currentRoot} surfaceTheme={surfaceTheme} />
      </SettingsList>
    </SettingsSection>
  );
}
