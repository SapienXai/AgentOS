"use client";

import { SquareTerminal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function CustomProviderCard({
  active,
  connected = false,
  detail,
  surfaceTheme = "dark",
  onClick
}: {
  active: boolean;
  connected?: boolean;
  detail?: string | null;
  surfaceTheme?: "dark" | "light";
  onClick: () => void;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div
      className={cn(
        "group flex h-[164px] w-full flex-col overflow-hidden rounded-[14px] border text-left transition-all",
        isLight
          ? active
            ? "border-primary/45 bg-primary/10 shadow-[0_18px_44px_rgba(124,58,237,0.12)]"
            : "border-border bg-card hover:border-primary/25 hover:bg-accent/60"
          : active
            ? "border-violet-400 bg-[radial-gradient(circle_at_8%_0%,rgba(124,58,237,0.20),transparent_36%),linear-gradient(180deg,rgba(20,27,48,0.92),rgba(10,15,28,0.92))] shadow-[0_0_0_1px_rgba(168,85,247,0.22),0_0_34px_rgba(124,58,237,0.16)]"
            : "border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.78),rgba(10,15,28,0.86))] hover:border-violet-300/35 hover:bg-white/[0.055]"
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="min-h-0 w-full flex-1 overflow-hidden p-2.5 pb-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/55 focus-visible:ring-inset"
      >
        <div className="flex items-start justify-between gap-2.5">
          <div
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] border",
              isLight
                ? "border-primary/20 bg-primary/10 text-primary"
                : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100"
            )}
            aria-hidden="true"
          >
            <SquareTerminal className="h-4 w-4" />
          </div>
          <Badge
            variant={connected ? "success" : "muted"}
            className={cn(
              "px-2 py-0.5 text-[0.62rem] tracking-[0.12em]",
              isLight && connected && "border-emerald-300 bg-emerald-50 text-emerald-800",
              isLight && !connected && "border-amber-300 bg-amber-50 text-amber-800",
              !isLight && connected && "border-emerald-300/20 bg-emerald-400/10 text-emerald-200",
              !isLight && !connected && "border-amber-300/20 bg-amber-400/10 text-amber-200"
            )}
          >
            {connected ? "Connected" : "Add provider"}
          </Badge>
        </div>

        <div className="mt-2.5">
          <p className={cn("font-display text-[0.87rem]", isLight ? "text-foreground" : "text-white")}>
            Custom provider
          </p>
          <p
            className={cn(
              "mt-1 line-clamp-2 text-[0.72rem] leading-[1.15]",
              isLight ? "text-muted-foreground" : "text-slate-300"
            )}
          >
            Add another OpenAI-compatible endpoint with a base URL and API key.
          </p>
          <p
            className={cn(
              "mt-2 line-clamp-1 text-[0.64rem] leading-4",
              isLight ? "text-muted-foreground" : "text-slate-400"
            )}
          >
            {detail || "Stored under models.providers.<id>."}
          </p>
        </div>
      </button>

      <div className="flex min-h-8 shrink-0 items-end px-2.5 pb-2.5">
        <span className={cn("inline-flex h-6 items-center rounded-[9px] border px-2.5 text-[0.64rem] font-medium", isLight ? "border-border bg-muted/45 text-foreground" : "border-white/10 bg-white/[0.04] text-white")}>
          {active ? "Selected" : "New connection"}
        </span>
      </div>
    </div>
  );
}
