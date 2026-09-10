"use client";

import { SettingsNavigation } from "@/components/settings/settings-navigation";
import { AdvancedSettings } from "@/components/settings/advanced-settings";
import { GeneralSettings } from "@/components/settings/general-settings";
import { RuntimeSettings } from "@/components/settings/runtime-settings";
import { ToolsSettings } from "@/components/settings/tools-settings";
import { WorkspaceSettings } from "@/components/settings/workspace-settings";
import { PikoLoader } from "@/components/ui/piko-loader";
import type { SettingsPageProps } from "@/components/settings/settings-types";
import { cn } from "@/lib/utils";

export function SettingsPage({
  sidebarOpen = false,
  activeSection,
  onSelectSection,
  onOpenAdvancedSection,
  surfaceTheme,
  isSettingsOperationInProgress,
  settingsOperationTitle,
  settingsOperationDescription,
  ...props
}: SettingsPageProps) {
  return (
    <>
      <PikoLoader open={isSettingsOperationInProgress} title={settingsOperationTitle} description={settingsOperationDescription} />
      <main className={cn(
        "relative z-10 min-h-screen",
        surfaceTheme === "light" ? "text-foreground" : "bg-[#080d16] text-slate-100"
      )}>
        <section className={cn("px-4 pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[76px] lg:px-8 lg:pb-12 lg:pt-[92px]", sidebarOpen ? "lg:ml-[308px]" : "lg:ml-[72px]")}>
          <div className="mx-auto max-w-[1080px]">
            <header className="mb-7">
              <h1 className={cn("font-display text-[1.65rem] leading-tight sm:text-[2rem]", surfaceTheme === "light" ? "text-[#1f1712]" : "text-slate-50")}>Settings</h1>
              <p className={cn("mt-1.5 text-sm", surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400")}>Configure AgentOS around the work you want to do.</p>
            </header>

            <div className="grid items-start gap-8 lg:grid-cols-[180px_minmax(0,680px)]">
              <SettingsNavigation activeSection={activeSection} onSelect={onSelectSection} surfaceTheme={surfaceTheme} />
              <div className="min-w-0">
                {activeSection === "general" ? <GeneralSettings {...props} surfaceTheme={surfaceTheme} /> : null}
                {activeSection === "ai-tools" ? <ToolsSettings {...props} surfaceTheme={surfaceTheme} /> : null}
                {activeSection === "workspace" ? <WorkspaceSettings {...props} surfaceTheme={surfaceTheme} /> : null}
                {activeSection === "runtime" ? <RuntimeSettings {...props} surfaceTheme={surfaceTheme} /> : null}
                {activeSection === "advanced" ? <AdvancedSettings surfaceTheme={surfaceTheme} onOpenAdvancedSection={onOpenAdvancedSection} /> : null}
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
