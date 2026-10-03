import type { WorkItemRecord } from "@/lib/agentos/contracts";
import { isSystemOwnedMonitorTask } from "@/lib/openclaw/domains/operation-task-projection";
import { resolveEffectiveTaskReviewStatus } from "@/components/mission-control/task-review-state";

/** Presentation only: OpenClaw remains the owner of monitor jobs and schedules. */
export function backgroundActivityNeedsAttention(task: WorkItemRecord) {
  if (!isSystemOwnedMonitorTask(task)) return false;
  const reviewedAt = typeof task.metadata.reviewedAt === "string" ? Date.parse(task.metadata.reviewedAt) : Number.NaN;
  const hasNewEvidence = Number.isFinite(reviewedAt) && task.updatedAt !== null && task.updatedAt > reviewedAt;
  if (resolveEffectiveTaskReviewStatus(task) && !hasNewEvidence) return false;
  return task.status === "stalled" ||
    task.metadata.lastRunStatus === "error" || task.status === "completed" ||
    (typeof task.metadata.resultPreview === "string" && task.metadata.resultPreview.trim().length > 0);
}

export function backgroundActivityLabel(task: WorkItemRecord) {
  return task.metadata.systemOwnedMonitor === "heartbeat" ? "Heartbeat" : "Skill Workshop";
}
