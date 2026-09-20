"use client";

import Link from "next/link";

import type { OperatorRuntimeProjection } from "@/lib/agentos/ui/operator-runtime-projection";
import { cn } from "@/lib/utils";

export function OperatorTruthBadge({
  projection,
  surfaceTheme = "dark",
  compact = false
}: {
  projection: OperatorRuntimeProjection;
  surfaceTheme?: "dark" | "light";
  compact?: boolean;
}) {
  return (
    <span
      title={`${projection.explanation} Authority: ${projection.authority.label}.`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold uppercase tracking-[0.16em]",
        compact ? "px-2 py-1 text-[9px]" : "px-2.5 py-1.5 text-[10px]",
        operatorToneClassName(projection.tone, surfaceTheme)
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", operatorDotClassName(projection.tone))} />
      {projection.stateLabel}
      {projection.authority.mode !== "native-gateway" ? (
        <span className="normal-case tracking-normal opacity-75">· {projection.authority.label}</span>
      ) : null}
    </span>
  );
}

export function OperatorScopeFreshness({
  projection,
  compact = false,
  className
}: {
  projection: OperatorRuntimeProjection;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground",
        compact ? "max-w-[min(52vw,260px)]" : "max-w-full",
        className
      )}
      title={`${projection.scope.detail}. ${projection.freshness.label}.`}
    >
      <span className="min-w-0 truncate">
        <span className="font-medium text-foreground">{projection.scope.label}</span>
        <span className="mx-1.5 opacity-50">·</span>
        <span>{projection.scope.detail}</span>
      </span>
      <span aria-hidden="true" className="opacity-40">·</span>
      <span className="shrink-0 whitespace-nowrap">{projection.freshness.label}</span>
    </div>
  );
}

export function OperatorRecoveryLink({
  projection,
  surfaceTheme = "dark"
}: {
  projection: OperatorRuntimeProjection;
  surfaceTheme?: "dark" | "light";
}) {
  if (!projection.primaryRecovery) {
    return null;
  }

  return (
    <Link
      href={projection.primaryRecovery.href}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold transition-colors",
        surfaceTheme === "light"
          ? "border-border bg-card text-foreground hover:bg-muted"
          : "border-white/10 bg-white/[0.05] text-slate-200 hover:bg-white/[0.10]"
      )}
    >
      {projection.primaryRecovery.label}
    </Link>
  );
}

function operatorToneClassName(
  tone: OperatorRuntimeProjection["tone"],
  surfaceTheme: "dark" | "light"
) {
  if (tone === "success") {
    return surfaceTheme === "light"
      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
      : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200";
  }

  if (tone === "warning") {
    return surfaceTheme === "light"
      ? "border-amber-300 bg-amber-50 text-amber-800"
      : "border-amber-300/30 bg-amber-300/10 text-amber-100";
  }

  if (tone === "danger") {
    return surfaceTheme === "light"
      ? "border-rose-300 bg-rose-50 text-rose-800"
      : "border-rose-300/30 bg-rose-300/10 text-rose-100";
  }

  return surfaceTheme === "light"
    ? "border-border bg-card text-muted-foreground"
    : "border-white/10 bg-white/[0.04] text-slate-300";
}

function operatorDotClassName(tone: OperatorRuntimeProjection["tone"]) {
  switch (tone) {
    case "success":
      return "bg-emerald-400";
    case "warning":
      return "bg-amber-300";
    case "danger":
      return "bg-rose-300";
    default:
      return "bg-slate-400";
  }
}
