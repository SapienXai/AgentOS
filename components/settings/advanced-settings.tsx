import Link from "next/link";
import { AlertTriangle, ChevronRight, Code2, Database, Gauge, KeyRound, Microscope, ShieldCheck, TerminalSquare, Wrench } from "lucide-react";

import { SettingsList, SettingsRow, SettingsSection } from "@/components/settings/settings-section";
import type { SettingsPageProps } from "@/components/settings/settings-types";

const advancedLinks = [
  { hash: "openclaw", label: "OpenClaw runtime", description: "Binary selection, install details, and native runtime settings.", icon: Code2 },
  { hash: "gateway", label: "Gateway & authentication", description: "Endpoints, credentials, lifecycle controls, and native auth repair.", icon: KeyRound },
  { hash: "diagnostics", label: "Diagnostics & recovery", description: "Runtime inbox, command output, fallback diagnostics, and recovery actions.", icon: TerminalSquare },
  { hash: "capabilities", label: "Capabilities & contracts", description: "Gateway capability matrix and AgentOS/OpenClaw contract evidence.", icon: ShieldCheck },
  { hash: "developer", label: "Compatibility Lab", description: "Preflight, shadow probes, certification, and update engineering tools.", icon: Microscope },
  { hash: "developer", label: "Config update pacing", description: "Developer controls for Gateway config queue behavior.", icon: Gauge },
  { href: "/updates", label: "Update management", description: "Open the canonical Updates surface for normal update flows.", icon: Database },
  { hash: "danger-zone", label: "Reset or uninstall", description: "Destructive actions with explicit confirmation.", icon: AlertTriangle }
] as const;

export function AdvancedSettings({ surfaceTheme, onOpenAdvancedSection }: Pick<SettingsPageProps, "surfaceTheme" | "onOpenAdvancedSection">) {
  return (
    <SettingsSection title="Advanced" description="Developer and troubleshooting tools for operators who need the underlying runtime details." surfaceTheme={surfaceTheme}>
      <SettingsList surfaceTheme={surfaceTheme}>
        {advancedLinks.map((entry) => {
          const Icon = entry.icon;
          const href = "href" in entry ? entry.href : `/settings#${entry.hash}`;
          return (
            <SettingsRow key={href} label={entry.label} description={entry.description} surfaceTheme={surfaceTheme} action={<ChevronRight className="h-4 w-4 opacity-50" aria-hidden="true" />}>
              <Link href={href} scroll={false} onClick={(event) => { if (!("href" in entry)) { event.preventDefault(); onOpenAdvancedSection(entry.hash); } }} className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40" aria-label={`Open ${entry.label}`} />
              <Icon className="order-first h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            </SettingsRow>
          );
        })}
      </SettingsList>
      <div className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground"><Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Advanced tools preserve the native OpenClaw controls without adding them to the normal settings flow.</div>
    </SettingsSection>
  );
}
