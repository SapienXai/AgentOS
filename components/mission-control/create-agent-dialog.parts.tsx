"use client";

import type { ReactNode } from "react";
import { Search } from "lucide-react";

import type { AgentPreset, MissionControlSnapshot } from "@/lib/agentos/contracts";
import { getAgentPresetMeta } from "@/lib/openclaw/agent-presets";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type SurfaceTheme = "dark" | "light";

export const QUICK_ROLE_OPTIONS: Array<{
  value: Exclude<AgentPreset, "custom">;
  label: string;
  helper: string;
}> = [
  { value: "worker", label: "General", helper: "Balanced workspace agent" },
  { value: "setup", label: "Setup", helper: "Prepare and unblock work" },
  { value: "browser", label: "Browser", helper: "Research and validate online" },
  { value: "monitoring", label: "Monitoring", helper: "Watch for drift and issues" }
];

export function FormField({
  label,
  htmlFor,
  children,
  helper,
  surfaceTheme = "dark"
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  helper?: string;
  surfaceTheme?: SurfaceTheme;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={htmlFor}
        className={cn("text-xs font-medium", isLight ? "text-[#5d5047]" : "text-slate-200")}
      >
        {label}
      </Label>
      {helper ? (
        <p className={cn("text-[11px] leading-4", isLight ? "text-[#8a7769]" : "text-slate-400")}>
          {helper}
        </p>
      ) : null}
      {children}
    </div>
  );
}

export function QuickRoleSelector({
  value,
  onChange,
  surfaceTheme = "dark"
}: {
  value: AgentPreset | null;
  onChange: (preset: Exclude<AgentPreset, "custom">) => void;
  surfaceTheme?: SurfaceTheme;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div role="radiogroup" aria-label="Role baseline" className="grid gap-2 sm:grid-cols-4">
      {QUICK_ROLE_OPTIONS.map((option) => {
        const selected = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-14 rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2",
              isLight
                ? "border-[#ded5cc] bg-white text-[#3f332b] hover:border-[#bfa994] hover:bg-[#fffaf5] focus-visible:ring-[#7c3aed]/30"
                : "border-white/10 bg-white/[0.035] text-slate-100 hover:border-white/20 hover:bg-white/[0.06] focus-visible:ring-violet-300/35",
              selected && (isLight
                ? "border-violet-400/70 bg-violet-50 text-violet-950 shadow-[0_0_0_1px_rgba(124,58,237,0.12)]"
                : "border-violet-300/55 bg-violet-400/[0.12] shadow-[0_0_0_1px_rgba(167,139,250,0.12)]")
            )}
          >
            <span className="block text-[12px] font-semibold">{option.label}</span>
            <span className={cn("mt-0.5 block text-[10px] leading-4", isLight ? "text-[#806f63]" : "text-slate-400")}>
              {option.helper}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function AgentSetupSummary({
  workspaceName,
  modelLabel,
  heartbeatEnabled,
  surfaceTheme = "dark"
}: {
  workspaceName: string | null;
  modelLabel: string;
  heartbeatEnabled: boolean;
  surfaceTheme?: SurfaceTheme;
}) {
  const isLight = surfaceTheme === "light";
  const items = [workspaceName ?? "No workspace", modelLabel, "Safe access"];

  if (heartbeatEnabled) {
    items.push("Scheduled monitoring");
  }

  return (
    <div
      className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4", isLight ? "text-[#7a685c]" : "text-slate-400")}
      aria-label="Automatic setup summary"
    >
      {items.map((item, index) => (
        <span key={`${item}-${index}`} className="inline-flex items-center gap-2">
          {index > 0 ? <span aria-hidden="true" className={isLight ? "text-[#c9b8aa]" : "text-slate-600"}>·</span> : null}
          {item}
        </span>
      ))}
    </div>
  );
}

export function CloneAgentPicker({
  candidates,
  workspaceNames,
  search,
  selectedAgentId,
  onSearchChange,
  onSelect,
  surfaceTheme = "dark"
}: {
  candidates: MissionControlSnapshot["agents"];
  workspaceNames: Map<string, string>;
  search: string;
  selectedAgentId: string | null;
  onSearchChange: (value: string) => void;
  onSelect: (agentId: string) => void;
  surfaceTheme?: SurfaceTheme;
}) {
  const isLight = surfaceTheme === "light";
  return (
    <div
      className={cn("space-y-3 rounded-md border p-3", isLight ? "border-[#e1d7ce] bg-[#faf7f3]" : "border-white/10 bg-white/[0.025]")}
    >
      <div>
        <p className={cn("text-xs font-semibold", isLight ? "text-[#3f332b]" : "text-slate-100")}>Clone existing agent</p>
        <p className={cn("mt-1 text-[11px] leading-4", isLight ? "text-[#806f63]" : "text-slate-400")}>
          Prefill this form from an existing agent. Credentials and browser sessions stay separate.
        </p>
      </div>

      <div className="relative">
        <Search className={cn("pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2", isLight ? "text-[#9b887a]" : "text-slate-500")} aria-hidden="true" />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search agents"
          aria-label="Search agents to clone"
          className={cn(
            "h-9 pl-9 text-xs",
            isLight
              ? "border-[#ded5cc] bg-white text-[#3f332b] placeholder:text-[#9b887a]"
              : "border-white/10 bg-white/[0.04] text-white placeholder:text-slate-500"
          )}
        />
      </div>

      <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
        {candidates.length > 0 ? candidates.map((agent) => {
          const presetMeta = getAgentPresetMeta(agent.policy.preset);
          const selected = selectedAgentId === agent.id;
          const role = agent.workerProfile?.employment.role ?? presetMeta.label;

          return (
            <button
              key={agent.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onSelect(agent.id)}
              className={cn(
                "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2",
                isLight
                  ? "border-[#e5ddd5] bg-white hover:border-[#bfa994] focus-visible:ring-violet-400/30"
                  : "border-white/[0.08] bg-white/[0.025] hover:border-white/20 focus-visible:ring-violet-300/35",
                selected && (isLight ? "border-violet-400/60 bg-violet-50" : "border-violet-300/45 bg-violet-400/[0.1]")
              )}
            >
              <span className="min-w-0">
                <span className={cn("block truncate text-xs font-medium", isLight ? "text-[#3f332b]" : "text-slate-100")}>
                  {formatAgentDisplayName(agent)}
                </span>
                <span className={cn("mt-0.5 block truncate text-[10px]", isLight ? "text-[#806f63]" : "text-slate-400")}>
                  {workspaceNames.get(agent.workspaceId)} · {role}
                </span>
              </span>
              <span className={cn("shrink-0 text-[10px]", isLight ? "text-[#806f63]" : "text-slate-400")}>
                {presetMeta.label}
              </span>
            </button>
          );
        }) : (
          <p className={cn("rounded-md border border-dashed px-3 py-4 text-xs", isLight ? "border-[#e1d7ce] text-[#806f63]" : "border-white/10 text-slate-400")}>
            No agents match that search.
          </p>
        )}
      </div>
    </div>
  );
}
