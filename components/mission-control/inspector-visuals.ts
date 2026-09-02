import type { RuntimeStatus } from "@/lib/agentos/contracts";
import type { AgentOsSurfaceTheme } from "@/components/ui/design-system";

export type InspectorSurfaceTheme = AgentOsSurfaceTheme;
export type InspectorSummaryAction =
  | "steer-task"
  | "review-result"
  | "view-result"
  | "open-chat"
  | "view-activity"
  | "view-details";

export type InspectorSurfaceTone = Readonly<{
  shell: string;
  rail: string;
  content: string;
  eyebrow: string;
  title: string;
  mutedText: string;
  section: string;
  fact: string;
  subtleButton: string;
  primaryButton: string;
  tabTrack: string;
  tabActive: string;
  tabIdle: string;
}>;

export function resolveInspectorSurfaceTone(surfaceTheme: InspectorSurfaceTheme): InspectorSurfaceTone {
  if (surfaceTheme === "light") {
    return {
      shell: "border-[#ddcec3] bg-[#fbf7f3] shadow-[0_22px_60px_rgba(107,75,55,0.16)]",
      rail: "border-[#e5d6cc] bg-[#fbf4ee]",
      content: "bg-[#fffdfa]",
      eyebrow: "text-[#98765f]",
      title: "text-[#30251f]",
      mutedText: "text-[#826d5d]",
      section: "border-[#e6d7cd] bg-white/[0.72] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]",
      fact: "border-[#eadcd2] bg-[#fffdfa]/84",
      subtleButton: "border-[#e1d1c6] bg-white/[0.72] text-[#70594a] hover:border-[#cda98f] hover:bg-[#fbf1e9] hover:text-[#33271f]",
      primaryButton: "bg-[#3a2c23] text-[#fffaf4] hover:bg-[#50392d]",
      tabTrack: "border-[#e4d5cb] bg-white/[0.62]",
      tabActive: "border-[#d5bda9] bg-[#f8ebe1] text-[#3c2e24] shadow-[0_6px_16px_rgba(107,75,55,0.10)]",
      tabIdle: "text-[#816b5b] hover:bg-white/[0.72] hover:text-[#3d2e25]"
    };
  }

  return {
    shell: "border-white/[0.09] bg-[linear-gradient(180deg,rgba(7,14,25,0.97),rgba(3,8,17,0.99))] shadow-[0_24px_70px_rgba(0,0,0,0.46)]",
    rail: "border-sky-100/[0.09] bg-[linear-gradient(180deg,rgba(4,10,20,0.92),rgba(2,6,13,0.98))]",
    content: "bg-[linear-gradient(180deg,rgba(5,12,24,0.86),rgba(3,8,17,0.96))]",
    eyebrow: "text-sky-200/65",
    title: "text-white",
    mutedText: "text-slate-400",
    section: "border-white/[0.08] bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
    fact: "border-white/[0.075] bg-slate-950/[0.22]",
    subtleButton: "border-white/[0.09] bg-white/[0.04] text-slate-300 hover:border-sky-100/[0.18] hover:bg-white/[0.075] hover:text-white",
    primaryButton: "bg-sky-100 text-slate-950 hover:bg-white",
    tabTrack: "border-white/[0.08] bg-slate-950/[0.34]",
    tabActive: "border-sky-100/[0.16] bg-sky-200/[0.12] text-sky-50 shadow-[0_6px_16px_rgba(14,165,233,0.12)]",
    tabIdle: "text-slate-400 hover:bg-white/[0.05] hover:text-slate-100"
  };
}

export function resolveInspectorSummaryAction(input: {
  entity: "workspace" | "agent" | "task" | "runtime" | "model" | "overview";
  status?: RuntimeStatus;
  needsReview?: boolean;
}): InspectorSummaryAction {
  if (input.entity === "task") {
    if (input.status === "running" || input.status === "queued") {
      return "steer-task";
    }

    if (input.needsReview) {
      return "review-result";
    }

    return input.status === "completed" ? "view-result" : "view-activity";
  }

  if (input.entity === "agent") {
    return "open-chat";
  }

  return input.entity === "runtime" ? "view-activity" : "view-details";
}
