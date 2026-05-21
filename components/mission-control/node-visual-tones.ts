import type { BadgeProps } from "@/components/ui/badge";
import type { RuntimeStatus } from "@/lib/agentos/contracts";
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
