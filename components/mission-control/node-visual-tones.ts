import type { BadgeProps } from "@/components/ui/badge";
import type { AgentStatus, RuntimeStatus } from "@/lib/agentos/contracts";
import { badgeVariantForRuntimeStatus, toneForRuntimeStatus } from "@/lib/openclaw/presenters";

import type { TaskReviewStatus } from "./task-review-state";

type BadgeVariant = Exclude<BadgeProps["variant"], null | undefined>;

export type TaskNodeToneKey = "aborted" | "review" | "live" | "success" | "fresh" | "default";

export type TaskNodeToneInput = {
  completedNeedsReview?: boolean;
  isAborted?: boolean;
  isJustCreated?: boolean;
  isPendingCreation?: boolean;
  status: RuntimeStatus;
  visibleReviewStatus?: TaskReviewStatus | null;
};

export type TaskNodeVisualTone = Readonly<{
  dot: string;
  glow: string;
  handle: string;
  icon: string;
  key: TaskNodeToneKey;
  outer: string;
  rail: string;
  resultBorder: string;
  topLine: string;
}>;

export type RuntimeNodeToneInput = {
  isPendingCreation?: boolean;
  status: RuntimeStatus;
};

export type RuntimeNodeShellToneKey =
  | "pendingCreation"
  | "fresh"
  | "cancelled"
  | "completed"
  | "default";

export type RuntimeNodeShellToneInput = RuntimeNodeToneInput & {
  isJustCreated?: boolean;
  selected?: boolean;
};

export type RuntimeNodeShellTone = Readonly<{
  key: RuntimeNodeShellToneKey;
  selected: string;
  state: string;
}>;

export type SurfaceRoleTone = "primary" | "owner" | "delegate" | "mixed";

export const FRESH_NODE_BADGE_CLASSES = "gap-1 border-cyan-100/20 bg-cyan-100/12 text-cyan-50";

export const TASK_NODE_SELECTED_CLASSES =
  "border-cyan-300/[0.5] shadow-[0_22px_52px_rgba(34,211,238,0.18)]";

export const TASK_NODE_REVIEW_ACTION_CLASSES = {
  button:
    "nodrag nopan mt-3 flex w-full items-center justify-between gap-3 rounded-[13px] border border-amber-300/24 bg-amber-300/[0.1] px-3 py-2.5 text-left text-amber-50 shadow-[0_10px_24px_rgba(245,158,11,0.12)] transition-colors hover:border-amber-200/38 hover:bg-amber-300/[0.14]",
  chevron: "h-3.5 w-3.5 -rotate-90 text-amber-100/70",
  detail: "block truncate text-[11px] text-amber-100/72",
  icon: "flex h-7 w-7 shrink-0 items-center justify-center rounded-[10px] border border-amber-200/20 bg-amber-200/10"
} as const;

export const RUNTIME_NODE_SELECTED_CLASSES =
  "border-cyan-300/[0.45] shadow-[0_18px_42px_rgba(34,211,238,0.16)]";

export const AGENT_NODE_SELECTED_CLASSES =
  "border-cyan-300/[0.42] shadow-[0_22px_48px_rgba(34,211,238,0.16)]";

export const AGENT_NODE_CREATION_PULSE_CLASSES =
  "border-cyan-200/50 shadow-[0_24px_56px_rgba(34,211,238,0.22)]";

export const AGENT_NODE_ATTENTION_CLASSES =
  "border-cyan-200/[0.54] shadow-[0_24px_56px_rgba(34,211,238,0.22)]";

const TASK_NODE_TONES = {
  aborted: {
    dot: "bg-rose-300",
    glow: "bg-rose-400/[0.12]",
    handle: "!bg-rose-300/70",
    icon: "border-rose-300/20 bg-rose-400/[0.09] text-rose-100",
    key: "aborted",
    outer: "border-rose-300/[0.24]",
    rail: "bg-gradient-to-b from-rose-300 via-rose-400/70 to-rose-500/20",
    resultBorder: "border-rose-300/20",
    topLine: "bg-gradient-to-r from-rose-300/55 via-rose-400/[0.16] to-transparent"
  },
  review: {
    dot: "bg-amber-300",
    glow: "bg-amber-300/[0.16]",
    handle: "!bg-amber-300/75",
    icon: "border-amber-300/[0.22] bg-amber-400/[0.1] text-amber-100",
    key: "review",
    outer: "border-amber-300/[0.26] shadow-[0_22px_50px_rgba(245,158,11,0.12)]",
    rail: "bg-gradient-to-b from-amber-200 via-amber-400/80 to-amber-500/[0.22]",
    resultBorder: "border-amber-300/[0.24]",
    topLine: "bg-gradient-to-r from-amber-200/[0.62] via-amber-400/[0.18] to-transparent"
  },
  live: {
    dot: "bg-cyan-300",
    glow: "bg-cyan-300/[0.14]",
    handle: "!bg-cyan-300/75",
    icon: "border-cyan-300/20 bg-cyan-300/[0.09] text-cyan-100",
    key: "live",
    outer: "border-cyan-300/[0.22] shadow-[0_22px_50px_rgba(34,211,238,0.12)]",
    rail: "bg-gradient-to-b from-cyan-200 via-cyan-400/[0.78] to-sky-500/[0.22]",
    resultBorder: "border-cyan-300/[0.22]",
    topLine: "bg-gradient-to-r from-cyan-200/[0.58] via-cyan-400/[0.18] to-transparent"
  },
  success: {
    dot: "bg-emerald-300",
    glow: "bg-emerald-300/10",
    handle: "!bg-emerald-300/65",
    icon: "border-emerald-300/[0.18] bg-emerald-300/[0.07] text-emerald-100",
    key: "success",
    outer: "border-emerald-300/[0.16]",
    rail: "bg-gradient-to-b from-emerald-200 via-emerald-400/[0.58] to-emerald-500/[0.16]",
    resultBorder: "border-emerald-300/[0.16]",
    topLine: "bg-gradient-to-r from-emerald-200/[0.42] via-emerald-400/[0.12] to-transparent"
  },
  fresh: {
    dot: "bg-sky-300",
    glow: "bg-sky-300/[0.14]",
    handle: "!bg-sky-300/70",
    icon: "border-sky-300/20 bg-sky-300/[0.08] text-sky-100",
    key: "fresh",
    outer: "border-sky-300/[0.24]",
    rail: "bg-gradient-to-b from-sky-200 via-sky-400/70 to-cyan-500/20",
    resultBorder: "border-sky-300/[0.18]",
    topLine: "bg-gradient-to-r from-sky-200/[0.52] via-sky-400/[0.14] to-transparent"
  },
  default: {
    dot: "bg-slate-400",
    glow: "bg-slate-200/[0.08]",
    handle: "!bg-white/35",
    icon: "border-white/[0.08] bg-white/[0.045] text-slate-200",
    key: "default",
    outer: "border-white/[0.085]",
    rail: "bg-gradient-to-b from-slate-300/70 via-slate-500/[0.42] to-slate-600/[0.12]",
    resultBorder: "border-white/[0.1]",
    topLine: "bg-gradient-to-r from-white/[0.24] via-white/[0.06] to-transparent"
  }
} as const satisfies Record<TaskNodeToneKey, TaskNodeVisualTone>;

const RUNTIME_NODE_SHELL_TONES = {
  pendingCreation: {
    key: "pendingCreation",
    selected: "",
    state:
      "border-cyan-300/30 bg-[linear-gradient(180deg,rgba(17,31,52,0.98),rgba(8,16,30,0.98))] shadow-[0_24px_54px_rgba(34,211,238,0.22)]"
  },
  fresh: {
    key: "fresh",
    selected: "",
    state:
      "border-cyan-200/40 bg-[linear-gradient(180deg,rgba(20,28,43,0.98),rgba(10,15,28,0.98))] shadow-[0_22px_52px_rgba(125,211,252,0.18)]"
  },
  cancelled: {
    key: "cancelled",
    selected: "",
    state:
      "border-rose-300/30 bg-[linear-gradient(180deg,rgba(43,14,19,0.96),rgba(19,8,12,0.96))] shadow-[0_22px_52px_rgba(244,63,94,0.14)]"
  },
  completed: {
    key: "completed",
    selected: "",
    state:
      "border-white/[0.06] bg-[linear-gradient(180deg,rgba(13,18,30,0.88),rgba(8,12,22,0.88))] opacity-[0.86]"
  },
  default: {
    key: "default",
    selected: "",
    state: ""
  }
} as const satisfies Record<RuntimeNodeShellToneKey, RuntimeNodeShellTone>;

export function resolveTaskNodeToneKey({
  completedNeedsReview = false,
  isAborted = false,
  isJustCreated = false,
  isPendingCreation = false,
  status,
  visibleReviewStatus = null
}: TaskNodeToneInput): TaskNodeToneKey {
  if (isAborted) {
    return "aborted";
  }

  if (completedNeedsReview) {
    return "review";
  }

  if (isPendingCreation || status === "running" || status === "queued") {
    return "live";
  }

  if (visibleReviewStatus === "accepted" || status === "completed") {
    return "success";
  }

  if (isJustCreated) {
    return "fresh";
  }

  return "default";
}

export function resolveTaskNodeVisualTone(input: TaskNodeToneInput): TaskNodeVisualTone {
  return TASK_NODE_TONES[resolveTaskNodeToneKey(input)];
}

export function resolveTaskNodeBadgeVariant({
  completedNeedsReview = false,
  isAborted = false,
  isPendingCreation = false,
  status,
  visibleReviewStatus = null
}: TaskNodeToneInput): BadgeVariant {
  if (isPendingCreation) {
    return "warning";
  }

  if (isAborted) {
    return "danger";
  }

  if (completedNeedsReview) {
    return "warning";
  }

  if (visibleReviewStatus === "accepted") {
    return "success";
  }

  if (visibleReviewStatus) {
    return "muted";
  }

  return badgeVariantForRuntimeStatus(status);
}

export function resolveTaskNodeTokenTone({
  completedNeedsReview = false,
  isAborted = false,
  status,
  visibleReviewStatus = null
}: TaskNodeToneInput): string {
  if (isAborted) {
    return "text-rose-200";
  }

  if (completedNeedsReview) {
    return "text-amber-200";
  }

  if (visibleReviewStatus === "accepted") {
    return "text-emerald-200";
  }

  return toneForRuntimeStatus(status);
}

export function resolveRuntimeNodeStatusDotTone({
  isPendingCreation = false,
  status
}: RuntimeNodeToneInput): string {
  if (isPendingCreation || status === "running") {
    return "bg-cyan-300";
  }

  if (status === "cancelled") {
    return "bg-rose-300";
  }

  if (status === "completed") {
    return "bg-emerald-300";
  }

  if (status === "stalled" || status === "queued") {
    return "bg-amber-200";
  }

  return "bg-amber-200";
}

export function resolveRuntimeNodeBadgeVariant({
  isPendingCreation = false,
  status
}: RuntimeNodeToneInput): BadgeVariant {
  return isPendingCreation ? "warning" : badgeVariantForRuntimeStatus(status);
}

export function resolveRuntimeNodeTokenTone({ status }: RuntimeNodeToneInput): string {
  return toneForRuntimeStatus(status);
}

export function resolveRuntimeNodeShellToneKey({
  isPendingCreation = false,
  isJustCreated = false,
  status
}: RuntimeNodeShellToneInput): RuntimeNodeShellToneKey {
  if (isPendingCreation) {
    return "pendingCreation";
  }

  if (isJustCreated) {
    return "fresh";
  }

  if (status === "cancelled") {
    return "cancelled";
  }

  if (status === "completed") {
    return "completed";
  }

  return "default";
}

export function resolveRuntimeNodeShellTone(input: RuntimeNodeShellToneInput): RuntimeNodeShellTone {
  const shellTone = RUNTIME_NODE_SHELL_TONES[resolveRuntimeNodeShellToneKey(input)];

  return input.selected
    ? {
        ...shellTone,
        selected: RUNTIME_NODE_SELECTED_CLASSES
      }
    : shellTone;
}

export function resolveAgentStatusDotTone(status: AgentStatus): string {
  switch (status) {
    case "engaged":
      return "bg-cyan-300";
    case "monitoring":
      return "bg-emerald-300";
    case "ready":
      return "bg-amber-200";
    case "offline":
      return "bg-rose-300";
    default:
      return "bg-slate-500";
  }
}

export function resolveAgentStatusBadgeVariant(status: AgentStatus): BadgeVariant {
  switch (status) {
    case "engaged":
      return "default";
    case "monitoring":
      return "success";
    case "ready":
      return "warning";
    case "offline":
      return "danger";
    default:
      return "muted";
  }
}

export function resolveWorkspaceHealthBadgeClasses(health: AgentStatus): string {
  switch (health) {
    case "engaged":
      return "border-cyan-300/30 bg-cyan-300/14 text-cyan-50";
    case "monitoring":
      return "border-emerald-300/30 bg-emerald-300/14 text-emerald-50";
    case "ready":
      return "border-amber-300/30 bg-amber-300/14 text-amber-50";
    case "offline":
      return "border-rose-300/30 bg-rose-300/14 text-rose-50";
    default:
      return "border-white/12 bg-white/[0.07] text-slate-100";
  }
}

export function resolveSurfaceRoleDotClasses(roleTone: SurfaceRoleTone): string {
  switch (roleTone) {
    case "owner":
      return "bg-emerald-100 shadow-[0_0_12px_rgba(52,211,153,0.9)]";
    case "delegate":
      return "bg-amber-100 shadow-[0_0_12px_rgba(251,191,36,0.9)]";
    case "mixed":
      return "bg-violet-100 shadow-[0_0_12px_rgba(196,181,253,0.9)]";
    case "primary":
    default:
      return "bg-cyan-100 shadow-[0_0_12px_rgba(103,232,249,0.9)]";
  }
}
