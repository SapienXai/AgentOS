"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Bot,
  Check,
  CircleDot,
  Cpu,
  FolderOpen,
  LoaderCircle,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import {
  resolveAgentCreationProgressSteps,
  type AgentCreationCardPhase,
  type AgentCreationProgressState,
  type AgentCreationProgressStep
} from "@/components/mission-control/agent-creation-progress.utils";

type SurfaceTheme = "dark" | "light";

export function AgentCreationProgress({
  state,
  agentName,
  workspaceName,
  modelLabel,
  hasChannelBindings,
  warning,
  surfaceTheme = "dark"
}: {
  state: AgentCreationProgressState;
  agentName: string;
  workspaceName: string;
  modelLabel: string;
  hasChannelBindings: boolean;
  warning?: string | null;
  surfaceTheme?: SurfaceTheme;
}) {
  const isLight = surfaceTheme === "light";
  const reduceMotion = useReducedMotion() ?? false;
  const steps = resolveAgentCreationProgressSteps(state, hasChannelBindings);
  const activeStep = steps.find((step) => step.status === "active");
  const isComplete = state === "complete";
  const statusCopy = isComplete
    ? "Ready for its first instruction."
    : state === "syncing"
      ? "Joining the workspace and checking the live state."
      : "Creating the agent.";
  const activeLabel = isComplete ? "Ready" : activeStep?.label ?? "Preparing";

  return (
    <div
      className={cn(
        "mx-auto flex h-full min-h-0 w-full max-w-[620px] items-center justify-center py-1 sm:py-2",
        isLight ? "text-[#2d241f]" : "text-white"
      )}
      role="status"
      aria-live="polite"
      aria-label={isComplete ? "Agent created" : "Agent creation progress"}
    >
      <motion.section
        initial={reduceMotion ? false : { opacity: 0, y: 10, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.38, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          "relative max-h-full w-full overflow-hidden rounded-[22px] border p-4 sm:p-5",
          isLight
            ? "border-[#e8d7c8] bg-[radial-gradient(circle_at_50%_0%,rgba(255,219,185,0.62),transparent_42%),linear-gradient(145deg,rgba(255,253,250,0.98),rgba(250,243,237,0.96))] shadow-[0_22px_58px_rgba(111,74,45,0.12)]"
            : "border-cyan-200/15 bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.14),transparent_38%),radial-gradient(circle_at_80%_18%,rgba(168,85,247,0.14),transparent_30%),linear-gradient(145deg,rgba(13,24,38,0.98),rgba(9,13,24,0.98))] shadow-[0_24px_70px_rgba(2,8,23,0.32),0_0_50px_rgba(34,211,238,0.08)]"
        )}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-[24px]">
          <motion.div
            animate={reduceMotion ? { opacity: 0.3 } : { opacity: [0.18, 0.48, 0.18], x: ["-55%", "80%"] }}
            transition={reduceMotion ? { duration: 0 } : { duration: 3.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            className={cn(
              "absolute inset-y-0 left-0 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/10 to-transparent",
              isLight ? "via-white/60" : "via-cyan-200/10"
            )}
          />
          <div className={cn("absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent", isLight ? "via-[#c89e73]/55" : "via-cyan-200/35")} />
        </div>

        <div className="relative">
          <div className="flex items-center gap-3.5 sm:gap-5">
            <CreationOrb isComplete={isComplete} isLight={isLight} reduceMotion={reduceMotion} />
            <div className="min-w-0 flex-1 text-left">
              <div className="flex items-center gap-2">
                <p className={cn("truncate text-[10px] font-semibold uppercase tracking-[0.24em]", isLight ? "text-[#a57d5d]" : "text-cyan-200/75")}>
                  {isComplete ? "Agent ready" : "Agent setup"}
                </p>
              </div>
              <h2 className={cn("mt-1 truncate font-display text-[1.35rem] font-semibold tracking-[-0.035em] sm:text-[1.65rem]", isLight ? "text-[#2d241f]" : "text-white")}>
                {agentName} {isComplete ? "is ready" : "is being created"}
              </h2>
              <p className={cn("mt-1 line-clamp-2 text-[11px] leading-4 sm:text-xs", isLight ? "text-[#7a685c]" : "text-slate-300/78")}>
                {statusCopy}
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-1.5">
            <CreationMetaItem Icon={FolderOpen} value={workspaceName} surfaceTheme={surfaceTheme} />
            <CreationMetaItem Icon={Cpu} value={modelLabel} surfaceTheme={surfaceTheme} />
          </div>

          <div className={cn("relative mt-4 rounded-xl border px-3 py-2", isLight ? "border-[#ead8c9] bg-white/65" : "border-white/[0.1] bg-white/[0.04]")}>
            <p className={cn("text-[9px] font-semibold uppercase tracking-[0.22em]", isLight ? "text-[#a57d5d]" : "text-slate-400")}>Current step</p>
            <p className={cn("mt-1 text-xs font-medium", isLight ? "text-[#4d3d32]" : "text-slate-200")}>{activeLabel}</p>
          </div>

          <div className="relative mt-3 grid grid-cols-4 gap-1.5 sm:gap-2">
            {steps.map((step, index) => (
              <CreationProgressRailStep key={step.id} step={step} index={index} surfaceTheme={surfaceTheme} reduceMotion={reduceMotion} />
            ))}
          </div>

          {warning ? (
            <div className={cn("relative mt-3 flex min-w-0 items-center gap-2 rounded-[10px] border px-2.5 py-1.5 text-[10px]", isLight ? "border-amber-300/55 bg-amber-50/80 text-amber-900" : "border-amber-300/20 bg-amber-300/[0.08] text-amber-100")}>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{warning}</span>
            </div>
          ) : null}
        </div>
      </motion.section>
    </div>
  );
}

function CreationOrb({
  isComplete,
  isLight,
  reduceMotion
}: {
  isComplete: boolean;
  isLight: boolean;
  reduceMotion: boolean;
}) {
  return (
    <div className="relative flex h-[88px] w-[88px] shrink-0 items-center justify-center sm:h-[104px] sm:w-[104px]">
      <motion.div
        aria-hidden="true"
        animate={reduceMotion ? { rotate: 0 } : { rotate: 360 }}
        transition={reduceMotion ? { duration: 0 } : { duration: 12, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
        className={cn("absolute inset-0 rounded-full border border-dashed", isComplete ? "border-emerald-300/55" : isLight ? "border-[#bd936d]/50" : "border-cyan-200/35")}
      />
      <motion.div
        aria-hidden="true"
        animate={reduceMotion ? { rotate: 0, scale: 1 } : { rotate: -360, scale: [0.9, 1.06, 0.9] }}
        transition={reduceMotion ? { duration: 0 } : { rotate: { duration: 8, repeat: Number.POSITIVE_INFINITY, ease: "linear" }, scale: { duration: 2.1, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" } }}
        className={cn("absolute inset-[14px] rounded-full border", isComplete ? "border-emerald-300/35" : isLight ? "border-[#d9b18d]/55" : "border-violet-200/35")}
      />
      <motion.div
        aria-hidden="true"
        animate={reduceMotion ? { opacity: 0.56, scale: 1 } : { opacity: [0.34, 0.86, 0.34], scale: [0.72, 1.16, 0.72] }}
        transition={reduceMotion ? { duration: 0 } : { duration: 1.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        className={cn("absolute inset-[25px] rounded-full blur-lg", isComplete ? "bg-emerald-300/30" : isLight ? "bg-[#cf9d70]/35" : "bg-cyan-300/25")}
      />
      <div
        className={cn(
          "relative flex h-[48px] w-[48px] items-center justify-center rounded-[15px] border shadow-[inset_0_1px_0_rgba(255,255,255,0.28)] sm:h-[56px] sm:w-[56px]",
          isComplete
            ? "border-emerald-200/65 bg-[linear-gradient(145deg,rgba(167,243,208,0.96),rgba(16,185,129,0.82))] text-emerald-950 shadow-[0_0_30px_rgba(52,211,153,0.26)]"
            : isLight
              ? "border-[#d9b18d] bg-[linear-gradient(145deg,rgba(255,250,245,0.98),rgba(241,216,195,0.92))] text-[#855c35] shadow-[0_0_28px_rgba(201,158,115,0.26)]"
              : "border-cyan-100/35 bg-[linear-gradient(145deg,rgba(103,232,249,0.28),rgba(124,58,237,0.26))] text-cyan-100 shadow-[0_0_28px_rgba(34,211,238,0.22)]"
        )}
      >
        {isComplete ? <Check className="h-6 w-6" strokeWidth={2.2} /> : <Bot className="h-6 w-6" strokeWidth={1.7} />}
      </div>
      <motion.span
        aria-hidden="true"
        animate={reduceMotion ? { opacity: 0.82 } : { opacity: [0.38, 1, 0.38], scale: [0.8, 1.18, 0.8] }}
        transition={reduceMotion ? { duration: 0 } : { duration: 1.35, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        className={cn("absolute right-[12px] top-[20px] h-2 w-2 rounded-full", isComplete ? "bg-emerald-200 shadow-[0_0_12px_rgba(110,231,183,0.9)]" : "bg-cyan-200 shadow-[0_0_12px_rgba(103,232,249,0.9)]")}
      />
      <motion.span
        aria-hidden="true"
        animate={reduceMotion ? { opacity: 0.72 } : { opacity: [0.25, 0.86, 0.25], scale: [0.86, 1.12, 0.86] }}
        transition={reduceMotion ? { duration: 0 } : { duration: 1.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut", delay: 0.35 }}
        className={cn("absolute bottom-[18px] left-[12px] h-1.5 w-1.5 rounded-full", isComplete ? "bg-emerald-300 shadow-[0_0_11px_rgba(52,211,153,0.85)]" : "bg-violet-200 shadow-[0_0_11px_rgba(196,181,253,0.85)]")}
      />
    </div>
  );
}

function CreationMetaItem({
  Icon,
  value,
  surfaceTheme
}: {
  Icon: LucideIcon;
  value: string;
  surfaceTheme: SurfaceTheme;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 rounded-full border px-2 py-1.5", isLight ? "border-[#e0cdbd] bg-white/70 text-[#6f5a4b]" : "border-white/[0.1] bg-white/[0.045] text-slate-300")}>
      <Icon className={cn("h-3 w-3 shrink-0", isLight ? "text-[#a87852]" : "text-cyan-200/80")} aria-hidden="true" />
      <span className="truncate text-[10px] font-medium">{value}</span>
    </span>
  );
}

function CreationProgressRailStep({
  step,
  index,
  surfaceTheme,
  reduceMotion
}: {
  step: AgentCreationProgressStep;
  index: number;
  surfaceTheme: SurfaceTheme;
  reduceMotion: boolean;
}) {
  const isLight = surfaceTheme === "light";
  const statusLabel = step.status === "done" ? "Ready" : step.status === "active" ? "In progress" : "Queued";
  const shortLabel = step.label;
  const statusIcon = step.status === "done" ? (
    <Check className="h-2.5 w-2.5" />
  ) : step.status === "active" ? (
    <LoaderCircle className="h-2.5 w-2.5 animate-spin motion-reduce:animate-none" />
  ) : (
    <CircleDot className="h-2.5 w-2.5" />
  );

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, delay: reduceMotion ? 0 : index * 0.04, ease: [0.22, 1, 0.36, 1] }}
      className="min-w-0"
      title={`${step.label}: ${statusLabel}. ${step.description}`}
      aria-label={`${step.label}: ${statusLabel}. ${step.description}`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <span className={cn("inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border", step.status === "done" ? (isLight ? "border-emerald-300/70 bg-emerald-100 text-emerald-700" : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200") : step.status === "active" ? (isLight ? "border-[#c89e73] bg-[#f3e1d1] text-[#855c35]" : "border-cyan-200/30 bg-cyan-300/10 text-cyan-100") : (isLight ? "border-[#e1d7ce] bg-white/60 text-[#a99484]" : "border-white/[0.1] bg-white/[0.035] text-slate-500"))}>
          {statusIcon}
        </span>
        <span className={cn("min-w-0 truncate text-[9px] font-semibold", isLight ? "text-[#3f332b]" : "text-slate-200")}>{shortLabel}</span>
      </div>
      <div className={cn("mt-1 h-1 overflow-hidden rounded-full", isLight ? "bg-[#eadfd5]" : "bg-white/[0.07]")}>
        <motion.span
          initial={{ width: 0 }}
          animate={{ width: step.status === "done" ? "100%" : step.status === "active" ? "62%" : "0%" }}
          transition={{ duration: reduceMotion ? 0 : 0.45, delay: reduceMotion ? 0 : index * 0.04, ease: [0.22, 1, 0.36, 1] }}
          className={cn("block h-full rounded-full", step.status === "done" ? "bg-emerald-400" : step.status === "active" ? (isLight ? "bg-[#c89e73]" : "bg-cyan-300") : (isLight ? "bg-[#d9cabc]" : "bg-slate-600"))}
        />
      </div>
    </motion.div>
  );
}

export function AgentCreationCardOverlay({
  phase,
  agentName,
  modelLabel
}: {
  phase: AgentCreationCardPhase;
  agentName: string;
  modelLabel: string;
}) {
  const isOnline = phase === "online";

  return (
    <div
      aria-hidden="true"
      className={cn("agent-node__creation-layer", isOnline ? "agent-node__creation-layer--ready" : "agent-node__creation-layer--pending")}
    >
      <div className="agent-node__creation-card absolute inset-x-4 top-1/2 mx-auto flex max-w-[226px] -translate-y-1/2 items-center gap-2.5 rounded-[16px] border px-3 py-2.5 shadow-[0_18px_34px_rgba(2,6,23,0.28)] backdrop-blur-xl">
        <span className="agent-node__creation-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border">
          {isOnline ? <Check className="h-4 w-4" strokeWidth={2.5} /> : <Bot className="h-4 w-4" />}
        </span>
        <span className="min-w-0 text-left">
          <span className="agent-node__creation-kicker block text-[9px] font-semibold uppercase tracking-[0.2em]">{isOnline ? "Agent ready" : "Creating agent"}</span>
          <span className="agent-node__creation-title mt-0.5 block truncate text-[11px] font-semibold">{isOnline ? `${agentName} joined the workspace` : `${agentName} is being created`}</span>
          <span className="agent-node__creation-meta mt-1 block truncate text-[9px]">{modelLabel}</span>
        </span>
        {!isOnline ? <LoaderCircle className="ml-auto h-4 w-4 shrink-0 animate-spin text-cyan-200 motion-reduce:animate-none" /> : null}
      </div>
    </div>
  );
}
