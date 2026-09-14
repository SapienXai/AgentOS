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
  Radio,
  ShieldCheck,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import {
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
  const title = isComplete ? `${agentName} is online` : `${agentName} is taking shape`;
  const description = isComplete
    ? "The new specialist is live and ready for its first instruction."
    : state === "syncing"
      ? "The profile is created. AgentOS is waiting for the live workspace snapshot to welcome it."
      : "OpenClaw is provisioning the profile and preparing the agent for its first workspace sync.";

  return (
    <div
      className={cn(
        "mx-auto flex min-h-full w-full max-w-[620px] flex-col justify-center py-2 sm:py-4",
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
          "relative overflow-hidden rounded-[24px] border p-5 sm:p-7",
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

        <div className="relative flex flex-col items-center text-center">
          <div className="relative flex h-[142px] w-[142px] items-center justify-center">
            <motion.div
              aria-hidden="true"
              animate={reduceMotion ? { rotate: 0 } : { rotate: 360 }}
              transition={reduceMotion ? { duration: 0 } : { duration: 16, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
              className={cn(
                "absolute inset-1 rounded-full border border-dashed",
                isComplete ? "border-emerald-300/55" : isLight ? "border-[#bd936d]/50" : "border-cyan-200/35"
              )}
            />
            <motion.div
              aria-hidden="true"
              animate={reduceMotion ? { rotate: 0, scale: 1 } : { rotate: -360, scale: [0.94, 1.04, 0.94] }}
              transition={reduceMotion ? { duration: 0 } : { rotate: { duration: 11, repeat: Number.POSITIVE_INFINITY, ease: "linear" }, scale: { duration: 2.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" } }}
              className={cn(
                "absolute inset-[20px] rounded-full border",
                isComplete ? "border-emerald-300/35" : isLight ? "border-[#d9b18d]/55" : "border-violet-200/35"
              )}
            />
            <motion.div
              aria-hidden="true"
              animate={reduceMotion ? { opacity: 0.56, scale: 1 } : { opacity: [0.38, 0.82, 0.38], scale: [0.82, 1.1, 0.82] }}
              transition={reduceMotion ? { duration: 0 } : { duration: 2.2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
              className={cn(
                "absolute inset-[34px] rounded-full blur-xl",
                isComplete ? "bg-emerald-300/30" : isLight ? "bg-[#cf9d70]/35" : "bg-cyan-300/25"
              )}
            />
            <div
              className={cn(
                "relative flex h-[70px] w-[70px] items-center justify-center rounded-[22px] border shadow-[inset_0_1px_0_rgba(255,255,255,0.28)]",
                isComplete
                  ? "border-emerald-200/65 bg-[linear-gradient(145deg,rgba(167,243,208,0.96),rgba(16,185,129,0.82))] text-emerald-950 shadow-[0_0_36px_rgba(52,211,153,0.26)]"
                  : isLight
                    ? "border-[#d9b18d] bg-[linear-gradient(145deg,rgba(255,250,245,0.98),rgba(241,216,195,0.92))] text-[#855c35] shadow-[0_0_34px_rgba(201,158,115,0.26)]"
                    : "border-cyan-100/35 bg-[linear-gradient(145deg,rgba(103,232,249,0.28),rgba(124,58,237,0.26))] text-cyan-100 shadow-[0_0_34px_rgba(34,211,238,0.22)]"
              )}
            >
              {isComplete ? <Check className="h-8 w-8" strokeWidth={2.2} /> : <Bot className="h-8 w-8" strokeWidth={1.7} />}
            </div>
            <motion.span
              aria-hidden="true"
              animate={reduceMotion ? { opacity: 0.82 } : { opacity: [0.38, 1, 0.38], scale: [0.8, 1.18, 0.8] }}
              transition={reduceMotion ? { duration: 0 } : { duration: 1.7, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
              className={cn(
                "absolute right-[18px] top-[30px] h-2.5 w-2.5 rounded-full",
                isComplete ? "bg-emerald-200 shadow-[0_0_14px_rgba(110,231,183,0.9)]" : "bg-cyan-200 shadow-[0_0_14px_rgba(103,232,249,0.9)]"
              )}
            />
            <motion.span
              aria-hidden="true"
              animate={reduceMotion ? { opacity: 0.72 } : { opacity: [0.25, 0.86, 0.25], scale: [0.86, 1.12, 0.86] }}
              transition={reduceMotion ? { duration: 0 } : { duration: 2.15, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut", delay: 0.5 }}
              className={cn(
                "absolute bottom-[26px] left-[18px] h-2 w-2 rounded-full",
                isComplete ? "bg-emerald-300 shadow-[0_0_13px_rgba(52,211,153,0.85)]" : "bg-violet-200 shadow-[0_0_13px_rgba(196,181,253,0.85)]"
              )}
            />
          </div>

          <p className={cn("mt-1 text-[10px] font-semibold uppercase tracking-[0.28em]", isLight ? "text-[#a57d5d]" : "text-cyan-200/75")}>
            {isComplete ? "Agent online" : "Agent birth sequence"}
          </p>
          <h2 className={cn("mt-2 font-display text-[1.55rem] font-semibold tracking-[-0.035em] sm:text-[1.8rem]", isLight ? "text-[#2d241f]" : "text-white")}>
            {title}
          </h2>
          <p className={cn("mt-2 max-w-[470px] text-sm leading-6", isLight ? "text-[#7a685c]" : "text-slate-300/78")}>
            {description}
          </p>

          <div className="mt-5 flex w-full flex-wrap justify-center gap-2">
            <CreationContextChip Icon={FolderOpen} label="Workspace" value={workspaceName} surfaceTheme={surfaceTheme} />
            <CreationContextChip Icon={Cpu} label="Model" value={modelLabel} surfaceTheme={surfaceTheme} />
            <CreationContextChip Icon={ShieldCheck} label="Policy" value="Safe access" surfaceTheme={surfaceTheme} />
            {hasChannelBindings ? (
              <CreationContextChip Icon={Radio} label="Routes" value="Linking" surfaceTheme={surfaceTheme} />
            ) : null}
          </div>
        </div>

        <div className="relative mt-7">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <p className={cn("text-[10px] font-semibold uppercase tracking-[0.22em]", isLight ? "text-[#a57d5d]" : "text-slate-400")}>Lifecycle</p>
              <p className={cn("mt-1 text-xs", isLight ? "text-[#6f5a4b]" : "text-slate-300")}>
                {isComplete ? "All milestones complete" : `${completedSteps + (activeStep ? 1 : 0)} of ${steps.length} milestones in motion`}
              </p>
            </div>
            <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-semibold tabular-nums", isLight ? "border-[#d9b18d] bg-[#fff8f1] text-[#855c35]" : "border-cyan-200/20 bg-cyan-300/10 text-cyan-100")}>
              {progressPercent}%
            </span>
          </div>
          <div
            className={cn("h-2 overflow-hidden rounded-full", isLight ? "bg-[#eadfd5]" : "bg-white/[0.07]")}
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

        <div className="relative mt-4 grid gap-2 sm:grid-cols-2">
          {steps.map((step, index) => (
            <CreationProgressChip key={step.id} step={step} index={index} surfaceTheme={surfaceTheme} reduceMotion={reduceMotion} />
          ))}
        </div>

        {warning ? (
          <div className={cn("relative mt-4 flex items-start gap-2.5 rounded-[14px] border px-3 py-2.5 text-left text-[11px] leading-4", isLight ? "border-amber-300/55 bg-amber-50/80 text-amber-900" : "border-amber-300/20 bg-amber-300/[0.08] text-amber-100")}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>OpenClaw returned a sync note. The agent is live; the card will keep the detail visible for review.</span>
          </div>
        ) : null}
      </motion.section>
    </div>
  );
}

function CreationContextChip({
  Icon,
  label,
  value,
  surfaceTheme
}: {
  Icon: LucideIcon;
  label: string;
  value: string;
  surfaceTheme: SurfaceTheme;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <span className={cn("inline-flex max-w-full items-center gap-2 rounded-full border px-2.5 py-1.5 text-left", isLight ? "border-[#e0cdbd] bg-white/70 text-[#6f5a4b]" : "border-white/[0.1] bg-white/[0.045] text-slate-300")}>
      <Icon className={cn("h-3.5 w-3.5 shrink-0", isLight ? "text-[#a87852]" : "text-cyan-200/80")} aria-hidden="true" />
      <span className="min-w-0">
        <span className={cn("mr-1 text-[9px] uppercase tracking-[0.15em]", isLight ? "text-[#a57d5d]" : "text-slate-500")}>{label}</span>
        <span className="max-w-[148px] truncate text-[10px] font-medium">{value}</span>
      </span>
    </span>
  );
}

function CreationProgressChip({
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
  const statusIcon = step.status === "done" ? (
    <Check className="h-3.5 w-3.5" />
  ) : step.status === "active" ? (
    <LoaderCircle className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
  ) : (
    <CircleDot className="h-3.5 w-3.5" />
  );

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.25, delay: reduceMotion ? 0 : index * 0.045, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "relative overflow-hidden rounded-[14px] border px-3 py-2.5 text-left transition-colors",
        step.status === "done" && (isLight ? "border-emerald-200/80 bg-emerald-50/70" : "border-emerald-300/18 bg-emerald-300/[0.07]"),
        step.status === "active" && (isLight ? "border-[#d9b18d] bg-[#fff8f1] shadow-[0_8px_22px_rgba(201,158,115,0.12)]" : "border-cyan-200/25 bg-cyan-300/[0.09] shadow-[0_8px_24px_rgba(34,211,238,0.08)]"),
        step.status === "pending" && (isLight ? "border-[#eadfd5] bg-white/45" : "border-white/[0.08] bg-white/[0.025]")
      )}
    >
      {step.status === "active" ? (
        <motion.span
          aria-hidden="true"
          animate={reduceMotion ? { opacity: 0 } : { x: ["-120%", "320%"] }}
          transition={reduceMotion ? { duration: 0 } : { duration: 2.1, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent"
        />
      ) : null}
      <div className="relative flex items-center gap-2.5">
        <span className={cn("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border", step.status === "done" ? (isLight ? "border-emerald-300/70 bg-emerald-100 text-emerald-700" : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200") : step.status === "active" ? (isLight ? "border-[#c89e73] bg-[#f3e1d1] text-[#855c35]" : "border-cyan-200/30 bg-cyan-300/10 text-cyan-100") : (isLight ? "border-[#e1d7ce] bg-white/60 text-[#a99484]" : "border-white/[0.1] bg-white/[0.035] text-slate-500"))}>
          {statusIcon}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn("flex items-center justify-between gap-2", isLight ? "text-[#3f332b]" : "text-slate-100")}>
            <span className="truncate text-[11px] font-semibold">{step.label}</span>
            <span className={cn("shrink-0 text-[9px] uppercase tracking-[0.12em]", step.status === "done" ? (isLight ? "text-emerald-700" : "text-emerald-200/80") : step.status === "active" ? (isLight ? "text-[#a87852]" : "text-cyan-200/80") : (isLight ? "text-[#a99484]" : "text-slate-500"))}>{statusLabel}</span>
          </span>
          <span className={cn("mt-0.5 block truncate text-[10px]", isLight ? "text-[#806f63]" : "text-slate-400")}>{step.description}</span>
        </span>
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

  return (
    <div
      aria-hidden="true"
      className={cn(
        "agent-node__birth-layer",
        isOnline ? "agent-node__birth-layer--online" : "agent-node__birth-layer--pending"
      )}
    >
      {!isOnline ? (
        <>
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
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-cyan-200/25 bg-cyan-300/12 text-cyan-100">
                  <Bot className="h-4 w-4" />
                </span>
                <span className="min-w-0 text-left">
                  <span className="block text-[9px] font-semibold uppercase tracking-[0.2em] text-cyan-100/75">Agent birth</span>
                  <span className="mt-0.5 block truncate text-[11px] font-semibold text-white">{agentName} is taking shape</span>
                </span>
                <LoaderCircle className="ml-auto h-4 w-4 shrink-0 animate-spin text-cyan-200 motion-reduce:animate-none" />
              </div>
              <div className="mt-2 flex items-center gap-1.5 overflow-hidden text-[9px] uppercase tracking-[0.12em] text-slate-300/75">
                <span className="rounded-full border border-cyan-200/18 bg-cyan-300/10 px-1.5 py-0.5 text-cyan-100/85">OpenClaw</span>
                <span className="truncate">{modelLabel}</span>
              </div>
            </div>
          </div>
        </>
      ) : (
        <motion.div
          initial={reduceMotion ? { opacity: 0.92 } : { opacity: 0, scale: 0.84 }}
          animate={reduceMotion ? { opacity: 0 } : { opacity: [0, 1, 0.92, 0], scale: [0.84, 1.02, 1.03, 1.08] }}
          transition={{ duration: reduceMotion ? 0.2 : 2.25, times: [0, 0.18, 0.62, 1], ease: [0.22, 1, 0.36, 1] }}
          className="absolute inset-0 flex items-center justify-center"
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
          <div className="relative flex flex-col items-center rounded-[18px] border border-emerald-100/25 bg-slate-950/68 px-4 py-3 text-center shadow-[0_18px_40px_rgba(2,6,23,0.32)] backdrop-blur-xl">
            <span className="flex h-9 w-9 items-center justify-center rounded-full border border-emerald-200/55 bg-emerald-300/18 text-emerald-100 shadow-[0_0_22px_rgba(52,211,153,0.3)]">
              <Check className="h-5 w-5" strokeWidth={2.5} />
            </span>
            <span className="mt-2 text-[9px] font-semibold uppercase tracking-[0.22em] text-emerald-100/80">Agent online</span>
            <span className="mt-0.5 max-w-[190px] truncate text-[12px] font-semibold text-white">{agentName} joined the workspace</span>
          </div>
        </motion.div>
      )}
    </div>
  );
}

export function AgentCreationWarningNotice({ message }: { message: string }) {
  return (
    <div
      className="agent-node__creation-notice mb-2 rounded-[14px] border px-3 py-2.5 text-left"
      title={message}
      role="status"
    >
      <div className="flex items-start gap-2.5">
        <span className="agent-node__creation-notice-icon mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="agent-node__creation-notice-title text-[11px] font-semibold">OpenClaw sync note</p>
            <span className="agent-node__creation-notice-label shrink-0 rounded-full border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.12em]">Review</span>
          </div>
          <p className="agent-node__creation-notice-summary mt-0.5 text-[10px] leading-4">The agent is live; configuration sync may need a refresh.</p>
        </div>
      </div>
      <p className="agent-node__creation-notice-detail mt-2 line-clamp-2 border-t pt-2 text-[10px] leading-4">{message}</p>
    </div>
  );
}
