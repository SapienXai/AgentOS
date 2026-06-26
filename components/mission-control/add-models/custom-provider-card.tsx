"use client";

import { SquareTerminal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function CustomProviderCard({
  active,
  compact = false,
  connected = false,
  detail,
  surfaceTheme = "dark",
  onClick
}: {
  active: boolean;
  compact?: boolean;
  connected?: boolean;
  detail?: string | null;
  surfaceTheme?: "dark" | "light";
  onClick: () => void;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group w-full rounded-[20px] border text-left transition-all",
        compact ? "p-2.5" : "p-3.5",
        isLight
          ? active
            ? "border-cyan-200 bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(242,248,250,0.92))] shadow-[0_12px_26px_rgba(71,85,105,0.10)]"
            : "border-[#e3dbd0] bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(248,243,236,0.88))] hover:border-[#d8cfc2] hover:bg-white"
          : active
            ? "border-cyan-300/40 bg-[linear-gradient(180deg,rgba(23,32,52,0.98),rgba(11,18,31,0.98))] shadow-[0_16px_36px_rgba(10,16,28,0.26)]"
            : "border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(10,15,28,0.92))] hover:border-white/18 hover:bg-[linear-gradient(180deg,rgba(20,29,49,0.96),rgba(12,18,31,0.96))]"
      )}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-[16px] border",
            isLight
              ? "border-cyan-200 bg-cyan-50 text-cyan-800"
              : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100"
          )}
          aria-hidden="true"
        >
          <SquareTerminal className="h-4 w-4" />
        </div>
        <Badge
          variant={connected ? "success" : active ? "default" : "muted"}
          className={cn(
            "tracking-[0.12em]",
            isLight && connected && "border-emerald-300 bg-emerald-50 text-emerald-800",
            isLight && active && !connected && "border-cyan-300 bg-cyan-50 text-cyan-800",
            compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]"
          )}
        >
          {connected ? "Configured" : active ? "Selected" : "Custom"}
        </Badge>
      </div>

      <div className="mt-3">
        <p className={cn("font-display", isLight ? "text-[#2d241f]" : "text-white", compact ? "text-[0.82rem]" : "text-[0.94rem]")}>
          Custom
        </p>
        <p
          className={cn(
            "mt-1",
            isLight ? "text-[#71675d]" : "text-slate-300",
            compact ? "text-[9px] leading-[0.95rem]" : "text-[11px] leading-5"
          )}
        >
          Use an OpenAI-compatible endpoint with a base URL and API key.
        </p>
        <p
          className={cn(
            "mt-2.5 uppercase tracking-[0.18em]",
            isLight ? "text-[#8c8177]" : "text-slate-500",
            compact ? "text-[8px]" : "text-[9px]"
          )}
        >
          {detail || "OpenClaw stores custom routes under models.providers.<id>."}
        </p>
      </div>
    </button>
  );
}
