"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BadgeCheck,
  Bot,
  Check,
  CircleDot,
  Cpu,
  FolderOpen,
  LoaderCircle,
  Sparkles,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import {
  AGENT_CREATION_BIRTH_DURATION_MS,
  resolveAgentCreationProgressPercent,
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
  const completedSteps = steps.filter((step) => step.status === "done").length;
  const activeStep = steps.find((step) => step.status === "active");
  const progressPercent = resolveAgentCreationProgressPercent(state);
  const isComplete = state === "complete";
  const statusCopy = isComplete
    ? "Live and ready for its first instruction."
    : state === "syncing"
      ? "Waiting for the live workspace snapshot."
      : "Provisioning the native profile in OpenClaw.";
  const activeLabel = isComplete ? "All systems ready" : activeStep?.label ?? "Preparing";

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
                  {isComplete ? "Agent online" : "Agent birth sequence"}
                </p>
                <span className={cn("shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-semibold tabular-nums", isComplete ? (isLight ? "border-emerald-300/60 bg-emerald-50 text-emerald-700" : "border-emerald-200/25 bg-emerald-300/10 text-emerald-100") : (isLight ? "border-[#d9b18d] bg-[#fff8f1] text-[#855c35]" : "border-cyan-200/20 bg-cyan-300/10 text-cyan-100"))}>
                  {progressPercent}%
                </span>
              </div>
              <h2 className={cn("mt-1 truncate font-display text-[1.35rem] font-semibold tracking-[-0.035em] sm:text-[1.65rem]", isLight ? "text-[#2d241f]" : "text-white")}>
                {agentName} {isComplete ? "is online" : "is taking shape"}
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

          <div className="relative mt-4">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <p className={cn("truncate text-[9px] font-semibold uppercase tracking-[0.22em]", isLight ? "text-[#a57d5d]" : "text-slate-400")}>Birth progress</p>
              <p className={cn("min-w-0 truncate text-[10px] tabular-nums", isLight ? "text-[#806f63]" : "text-slate-400")}>
                {activeLabel} · {isComplete ? "4 / 4" : `${completedSteps + (activeStep ? 1 : 0)} / ${steps.length}`}
              </p>
            </div>
            <div
              className={cn("h-1.5 overflow-hidden rounded-full", isLight ? "bg-[#eadfd5]" : "bg-white/[0.07]")}
              role="progressbar"
              aria-label="Agent creation lifecycle"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent}
            >
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${progressPercent}%` }}
                transition={{ duration: reduceMotion ? 0 : 0.55, ease: [0.22, 1, 0.36, 1] }}
                className={cn("relative h-full overflow-hidden rounded-full", isComplete ? "bg-[linear-gradient(90deg,#34d399,#22c55e)]" : isLight ? "bg-[linear-gradient(90deg,#c89e73,#a87852)]" : "bg-[linear-gradient(90deg,#22d3ee,#8b5cf6)]")}
              >
                <motion.span
                  aria-hidden="true"
                  animate={reduceMotion ? { opacity: 0 } : { x: ["-100%", "300%"] }}
                  transition={reduceMotion ? { duration: 0 } : { duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                  className="absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/70 to-transparent"
                />
              </motion.div>
            </div>
          </div>

          <div className="relative mt-3 grid grid-cols-4 gap-1.5 sm:gap-2">
            {steps.map((step, index) => (
              <CreationProgressRailStep key={step.id} step={step} index={index} surfaceTheme={surfaceTheme} reduceMotion={reduceMotion} />
            ))}
          </div>

          {warning ? (
            <div className={cn("relative mt-3 flex min-w-0 items-center gap-2 rounded-[10px] border px-2.5 py-1.5 text-[10px]", isLight ? "border-amber-300/55 bg-amber-50/80 text-amber-900" : "border-amber-300/20 bg-amber-300/[0.08] text-amber-100")}>
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">Native sync is finishing in the background; the agent will settle into its normal state.</span>
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
  const shortLabel = step.id === "identity" ? "Identity" : step.id === "openclaw" ? "OpenClaw" : step.id === "workspace" ? "Workspace" : "Canvas";
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
  const reduceMotion = useReducedMotion() ?? false;
  const isOnline = phase === "online";
  const onlineDuration = AGENT_CREATION_BIRTH_DURATION_MS / 1000;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "agent-node__birth-layer",
        isOnline ? "agent-node__birth-layer--online" : "agent-node__birth-layer--pending"
      )}
    >
      <AnimatePresence mode="wait" initial={false}>
        {!isOnline ? (
          <motion.div
            key="pending"
            initial={reduceMotion ? false : { opacity: 1, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96, filter: "blur(6px)" }}
            transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0"
          >
          <motion.div
            animate={reduceMotion ? { opacity: 0.36 } : { opacity: [0.18, 0.68, 0.18], x: ["-130%", "330%"] }}
            transition={reduceMotion ? { duration: 0 } : { duration: 2.2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            className="agent-node__birth-scan absolute inset-y-0 left-0 w-[34%]"
          />
          <motion.div
            aria-hidden="true"
            animate={reduceMotion ? { rotate: 0, scale: 1 } : { rotate: 360, scale: [0.92, 1.04, 0.92] }}
            transition={reduceMotion ? { duration: 0 } : { rotate: { duration: 13, repeat: Number.POSITIVE_INFINITY, ease: "linear" }, scale: { duration: 2.5, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" } }}
            className="absolute left-1/2 top-[42%] h-[118px] w-[118px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-cyan-200/25 border-dashed"
          />
          <motion.div
            aria-hidden="true"
            animate={reduceMotion ? { opacity: 0.45 } : { opacity: [0.25, 0.7, 0.25], scale: [0.76, 1.18, 0.76] }}
            transition={reduceMotion ? { duration: 0 } : { duration: 2.1, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
            className="absolute left-1/2 top-[42%] h-[82px] w-[82px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-300/10 blur-xl"
          />
          <div className="absolute inset-x-4 top-1/2 -translate-y-1/2">
            <div className="agent-node__birth-hud mx-auto max-w-[218px] rounded-[16px] border px-3 py-2.5 shadow-[0_18px_34px_rgba(2,6,23,0.32)] backdrop-blur-xl">
              <div className="flex items-center gap-2.5">
                <span className="agent-node__birth-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-cyan-200/25 bg-cyan-300/12 text-cyan-100">
                  <Bot className="h-4 w-4" />
                </span>
                <span className="min-w-0 text-left">
                  <span className="agent-node__birth-kicker block text-[9px] font-semibold uppercase tracking-[0.2em] text-cyan-100/75">Agent birth</span>
                  <span className="agent-node__birth-title mt-0.5 block truncate text-[11px] font-semibold text-white">{agentName} is taking shape</span>
                </span>
                <LoaderCircle className="agent-node__birth-loader ml-auto h-4 w-4 shrink-0 animate-spin text-cyan-200 motion-reduce:animate-none" />
              </div>
              <div className="agent-node__birth-meta mt-2 flex items-center gap-1.5 overflow-hidden text-[9px] uppercase tracking-[0.12em] text-slate-300/75">
                <span className="agent-node__birth-provider rounded-full border border-cyan-200/18 bg-cyan-300/10 px-1.5 py-0.5 text-cyan-100/85">OpenClaw</span>
                <span className="agent-node__birth-model truncate">{modelLabel}</span>
              </div>
            </div>
          </div>
          <BirthInfoGrid phase="pending" reduceMotion={reduceMotion} />
          <BirthStatusRail phase="pending" reduceMotion={reduceMotion} />
          </motion.div>
        ) : (
          <motion.div
            key="online"
            initial={reduceMotion ? false : { opacity: 1, scale: 0.96 }}
            animate={reduceMotion ? { opacity: 1, scale: 1 } : { opacity: [1, 1, 0.98, 0], scale: [0.96, 1, 1.02, 1.08] }}
            transition={{ duration: reduceMotion ? 0 : onlineDuration, times: [0, 0.08, 0.84, 1], ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-0"
          >
          <motion.div
            aria-hidden="true"
            initial={{ scale: 0.52, opacity: 0.1 }}
            animate={reduceMotion ? { scale: 1, opacity: 0 } : { scale: [0.52, 1.24, 1.52], opacity: [0.5, 0.2, 0] }}
            transition={{ duration: reduceMotion ? 0.2 : 1.9, ease: "easeOut" }}
            className="absolute h-40 w-40 rounded-full border border-emerald-200/70 shadow-[0_0_44px_rgba(52,211,153,0.3)]"
          />
          <motion.div
            aria-hidden="true"
            initial={{ scale: 0.72, opacity: 0.1 }}
            animate={reduceMotion ? { scale: 1, opacity: 0 } : { scale: [0.72, 1.08, 1.24], opacity: [0.65, 0.24, 0] }}
            transition={{ duration: reduceMotion ? 0.2 : 1.45, delay: 0.08, ease: "easeOut" }}
            className="absolute h-24 w-24 rounded-full border border-cyan-100/75"
          />
          <div className="absolute inset-x-4 top-[11%] flex justify-center">
            <div className="relative flex w-full max-w-[218px] items-center gap-2.5 rounded-[16px] border border-emerald-100/25 bg-slate-950/68 px-3 py-2.5 text-left shadow-[0_18px_40px_rgba(2,6,23,0.32)] backdrop-blur-xl">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-emerald-200/55 bg-emerald-300/18 text-emerald-100 shadow-[0_0_22px_rgba(52,211,153,0.3)]">
                <Check className="h-4 w-4" strokeWidth={2.5} />
              </span>
              <span className="min-w-0">
                <span className="agent-node__birth-online-kicker block text-[9px] font-semibold uppercase tracking-[0.22em] text-emerald-100/80">Agent online</span>
                <span className="agent-node__birth-online-title mt-0.5 block truncate text-[11px] font-semibold text-white">{agentName} joined the workspace</span>
              </span>
              <Sparkles className="ml-auto h-3.5 w-3.5 shrink-0 text-emerald-200/80" aria-hidden="true" />
            </div>
          </div>
          <BirthInfoGrid phase="online" reduceMotion={reduceMotion} />
          <BirthStatusRail phase="online" reduceMotion={reduceMotion} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BirthInfoGrid({ phase, reduceMotion }: { phase: AgentCreationCardPhase; reduceMotion: boolean }) {
  const isOnline = phase === "online";
  const steps = [
    { label: "Identity", detail: isOnline ? "Profile live" : "Profile drafted", state: "ready", Icon: BadgeCheck },
    { label: "OpenClaw", detail: isOnline ? "Runtime ready" : "Runtime forming", state: isOnline ? "ready" : "active", Icon: Cpu },
    { label: "Workspace", detail: isOnline ? "Workspace joined" : "Joining workspace", state: isOnline ? "ready" : "queued", Icon: FolderOpen },
    { label: "Canvas", detail: isOnline ? "Live on canvas" : "Reveal queued", state: isOnline ? "ready" : "queued", Icon: Sparkles }
  ] as const;

  return (
    <div className={cn("agent-node__birth-sequence absolute inset-x-3.5 rounded-[12px] border px-2.5 py-2", isOnline ? "top-[39%]" : "top-[55%]")}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="agent-node__birth-sequence-label text-[8px] font-semibold uppercase tracking-[0.2em]">Provisioning steps</span>
        <span className="agent-node__birth-sequence-count rounded-full border px-1.5 py-0.5 text-[8px] font-semibold tabular-nums">{isOnline ? "4 / 4" : "2 / 4"}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {steps.map((step, index) => {
          const stateClassName = `agent-node__birth-info-card--${step.state}`;
          const progressWidth = step.state === "ready" ? "100%" : step.state === "active" ? "58%" : "0%";
          const statusLabel = step.state === "ready" ? "Ready" : step.state === "active" ? "In progress" : "Queued";

          return (
            <motion.div
              key={step.label}
              initial={reduceMotion ? false : { opacity: 0.72, y: 5, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: reduceMotion ? 0 : 0.24, delay: reduceMotion ? 0 : index * 0.06, ease: [0.22, 1, 0.36, 1] }}
              className={cn("agent-node__birth-info-card min-w-0 rounded-[9px] border px-2 py-1.5", stateClassName)}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="agent-node__birth-info-icon flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border">
                  <step.Icon className="h-2.5 w-2.5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="agent-node__birth-info-title block truncate text-[8px] font-semibold">{step.label}</span>
                  <span className="agent-node__birth-info-detail block truncate text-[7px]">{step.detail}</span>
                </span>
                <motion.span
                  aria-hidden="true"
                  animate={reduceMotion || step.state !== "active" ? { opacity: step.state === "ready" ? 1 : 0.55 } : { opacity: [0.35, 1, 0.35], scale: [0.86, 1.18, 0.86] }}
                  transition={reduceMotion || step.state !== "active" ? { duration: 0 } : { duration: 1.35, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
                  className="agent-node__birth-info-dot h-1.5 w-1.5 shrink-0 rounded-full"
                />
              </div>
              <div className="agent-node__birth-info-track mt-1 h-0.5 overflow-hidden rounded-full">
                <motion.span
                  aria-hidden="true"
                  initial={{ width: 0 }}
                  animate={{ width: progressWidth }}
                  transition={{ duration: reduceMotion ? 0 : 0.45, delay: reduceMotion ? 0 : index * 0.06, ease: [0.22, 1, 0.36, 1] }}
                  className="agent-node__birth-info-fill block h-full rounded-full"
                />
              </div>
              <span className="agent-node__birth-info-state mt-1 block text-[7px] font-semibold uppercase tracking-[0.12em]">{statusLabel}</span>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

function BirthStatusRail({ phase, reduceMotion }: { phase: AgentCreationCardPhase; reduceMotion: boolean }) {
  const isOnline = phase === "online";
  const steps = [
    { label: "Identity", state: "ready" },
    { label: "Runtime", state: isOnline ? "ready" : "active" },
    { label: "Canvas", state: isOnline ? "ready" : "queued" }
  ] as const;

  return (
    <div className="agent-node__birth-rail absolute inset-x-3.5 bottom-4 rounded-[12px] border px-2.5 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="agent-node__birth-rail-label text-[8px] font-semibold uppercase tracking-[0.2em]">Lifecycle</span>
        <motion.span
          aria-hidden="true"
          animate={reduceMotion ? { opacity: 0.7 } : { opacity: [0.35, 1, 0.35] }}
          transition={reduceMotion ? { duration: 0 } : { duration: 1.5, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          className="h-1.5 w-1.5 rounded-full bg-cyan-200 shadow-[0_0_10px_rgba(103,232,249,0.85)]"
        />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {steps.map((step, index) => (
          <div key={step.label} className="min-w-0">
            <div className="flex items-center gap-1">
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", step.state === "ready" ? "bg-emerald-300" : step.state === "active" ? "bg-cyan-200 shadow-[0_0_8px_rgba(103,232,249,0.75)]" : "bg-slate-500")} />
              <span className="agent-node__birth-rail-step truncate text-[8px]">{step.label}</span>
            </div>
            <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-white/10">
              <motion.span
                aria-hidden="true"
                initial={{ width: 0 }}
                animate={{ width: step.state === "ready" ? "100%" : step.state === "active" ? "58%" : "0%" }}
                transition={{ duration: reduceMotion ? 0 : 0.45, delay: reduceMotion ? 0 : index * 0.08, ease: [0.22, 1, 0.36, 1] }}
                className={cn("block h-full rounded-full", step.state === "ready" ? "bg-emerald-300" : step.state === "active" ? "bg-cyan-200" : "bg-slate-600")}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
