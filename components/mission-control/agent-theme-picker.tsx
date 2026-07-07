"use client";

import {
  AGENT_VISUAL_THEME_OPTIONS,
  normalizeAgentVisualThemeValue
} from "@/components/mission-control/agent-profile-visuals";
import { cn } from "@/lib/utils";

type AgentThemePickerProps = {
  value: string;
  onChange: (value: string) => void;
  surfaceTheme?: "dark" | "light";
};

export function AgentThemePicker({ value, onChange, surfaceTheme = "dark" }: AgentThemePickerProps) {
  const selectedValue = normalizeAgentVisualThemeValue(value);
  const isLight = surfaceTheme === "light";

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {AGENT_VISUAL_THEME_OPTIONS.map((theme) => {
        const selected = selectedValue === theme.value;

        return (
          <button
            key={theme.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(theme.value)}
            className={cn(
              "group flex min-h-12 items-center gap-2 rounded-[12px] border px-2.5 py-2 text-left text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2",
              isLight
                ? "border-[#dfd1c6] bg-white/80 text-[#4d392e] hover:border-[#cdbdad] hover:bg-[#fffaf5] focus-visible:ring-[#d8c2ae]"
                : "border-white/10 bg-white/[0.04] text-slate-200 hover:border-white/18 hover:bg-white/[0.07] focus-visible:ring-cyan-300/35",
              selected && (isLight
                ? "border-[#b9a390] bg-[#fff7ef] shadow-[0_0_0_1px_rgba(185,163,144,0.32)]"
                : "border-white/25 bg-white/[0.08] shadow-[0_0_0_1px_rgba(255,255,255,0.08)]")
            )}
          >
            <span
              aria-hidden="true"
              className="h-5 w-5 shrink-0 rounded-full border border-white/40 shadow-[0_0_16px_rgba(0,0,0,0.16)]"
              style={{
                background: `linear-gradient(135deg, rgb(${theme.accentA}), rgb(${theme.accentB}))`
              }}
            />
            <span className="min-w-0 truncate">{theme.label}</span>
          </button>
        );
      })}
    </div>
  );
}
