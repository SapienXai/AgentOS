"use client";

import Link from "next/link";
import { Activity, Bot, Folder, LockKeyhole, Settings2, Wrench } from "lucide-react";

import type { SettingsArea } from "@/components/settings/settings-types";
import { cn } from "@/lib/utils";

const sections: Array<{ id: SettingsArea; label: string; scope: string; icon: typeof Settings2 }> = [
  { id: "general", label: "General", scope: "Personal", icon: Settings2 },
  { id: "ai-tools", label: "AI & Models", scope: "Instance", icon: Bot },
  { id: "workspace", label: "Workspace", scope: "Company", icon: Folder },
  { id: "runtime", label: "Runtime", scope: "Instance", icon: Activity },
  { id: "security", label: "Security", scope: "Instance", icon: LockKeyhole },
  { id: "advanced", label: "Advanced", scope: "Instance", icon: Wrench }
];

export function SettingsNavigation({
  activeSection,
  onSelect,
  surfaceTheme
}: {
  activeSection: SettingsArea;
  onSelect: (section: SettingsArea) => void;
  surfaceTheme: "dark" | "light";
}) {

  return (
    <nav aria-label="Settings sections" className="min-w-0">
      <div className="grid grid-cols-2 gap-1 border-b border-border pb-3 sm:grid-cols-3 lg:hidden">
        {sections.map((section) => (
          <SettingsNavigationLink
            key={section.id}
            section={section}
            active={activeSection === section.id}
            onSelect={onSelect}
            surfaceTheme={surfaceTheme}
            compact
          />
        ))}
      </div>

      <div className={cn(
        "hidden space-y-0.5 lg:block",
        surfaceTheme === "light" ? "text-muted-foreground" : "text-slate-400"
      )}>
        {sections.map((section) => (
          <SettingsNavigationLink
            key={section.id}
            section={section}
            active={activeSection === section.id}
            onSelect={onSelect}
            surfaceTheme={surfaceTheme}
          />
        ))}
      </div>
    </nav>
  );
}

function SettingsNavigationLink({
  section,
  active,
  onSelect,
  surfaceTheme,
  compact = false
}: {
  section: (typeof sections)[number];
  active: boolean;
  onSelect: (section: SettingsArea) => void;
  surfaceTheme: "dark" | "light";
  compact?: boolean;
}) {
  const Icon = section.icon;

  return (
    <Link
      href={`/settings#${section.id}`}
      scroll={false}
      aria-current={active ? "page" : undefined}
      onClick={() => onSelect(section.id)}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        compact ? "min-h-[2.75rem] px-3 text-sm" : "min-h-12 w-full px-3 text-sm",
        active
          ? surfaceTheme === "light"
            ? "bg-primary/10 text-primary"
            : "bg-primary/15 text-primary"
          : surfaceTheme === "light"
            ? "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-100"
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{section.label}{!compact && <span className="block text-[11px] font-normal text-muted-foreground">{section.scope}</span>}</span>
    </Link>
  );
}
