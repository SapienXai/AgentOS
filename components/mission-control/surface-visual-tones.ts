import type { DiagnosticHealth } from "@/lib/agentos/contracts";

export type SurfaceTheme = "dark" | "light";
export type GatewayModeTone = "success" | "warning" | "danger" | "neutral";

export function resolveDiagnosticHealthBadgeClasses(
  health: DiagnosticHealth,
  surfaceTheme: SurfaceTheme
): string {
  switch (health) {
    case "healthy":
      return surfaceTheme === "light"
        ? "border-emerald-300/80 bg-emerald-50 text-emerald-700"
        : "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
    case "degraded":
      return surfaceTheme === "light"
        ? "border-amber-300/90 bg-amber-50 text-amber-700"
        : "border-amber-300/25 bg-amber-300/10 text-amber-200";
    default:
      return surfaceTheme === "light"
        ? "border-rose-300/80 bg-rose-50 text-rose-700"
        : "border-rose-300/25 bg-rose-300/10 text-rose-200";
  }
}

export function resolveDiagnosticHealthDotClasses(health: DiagnosticHealth): string {
  switch (health) {
    case "healthy":
      return "bg-emerald-400";
    case "degraded":
      return "bg-amber-300";
    default:
      return "bg-rose-300";
  }
}

export function resolveGatewayModeBadgeClasses(
  tone: GatewayModeTone,
  surfaceTheme: SurfaceTheme
): string {
  if (tone === "success") {
    return surfaceTheme === "light"
      ? "border-emerald-300/80 bg-emerald-50 text-emerald-700"
      : "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
  }

  if (tone === "danger") {
    return surfaceTheme === "light"
      ? "border-rose-300/80 bg-rose-50 text-rose-700"
      : "border-rose-300/25 bg-rose-300/10 text-rose-200";
  }

  if (tone === "warning") {
    return surfaceTheme === "light"
      ? "border-amber-300/80 bg-amber-50 text-amber-700"
      : "border-amber-300/25 bg-amber-300/10 text-amber-200";
  }

  return surfaceTheme === "light"
    ? "border-[#d0bcae] bg-[#efe5dc] text-[#7f6554]"
    : "border-white/12 bg-white/[0.08] text-slate-300";
}
