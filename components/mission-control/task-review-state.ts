import type { MissionControlSnapshot, TaskFeedEvent, WorkItemRecord } from "@/lib/agentos/contracts";

export const taskReviewStateStorageKey = "mission-control-task-review-state-v1";

export type TaskReviewStatus = "accepted" | "continued" | "retried" | "dismissed";

export type TaskReviewResolution = {
  taskId: string;
  taskKey: string;
  status: TaskReviewStatus;
  action: string;
  reviewedAt: string;
};

export type TaskReviewStateMap = Record<string, TaskReviewResolution>;

export const taskReviewContinuationGraceMs = 2 * 60_000;

export type TaskReviewDisplayOptions = {
  nowMs?: number;
  hasLiveActivity?: boolean;
  latestEvidenceAt?: string | null;
};

export function resolveTaskReviewKey(task: Pick<WorkItemRecord, "id" | "key" | "dispatchId">) {
  const key = typeof task.key === "string" ? task.key.trim() : "";
  const dispatchId = typeof task.dispatchId === "string" ? task.dispatchId.trim() : "";
  return key || dispatchId || task.id;
}

export function createTaskReviewResolution(
  task: WorkItemRecord,
  status: TaskReviewStatus,
  action: string,
  reviewedAt = new Date().toISOString()
): TaskReviewResolution {
  return {
    taskId: task.id,
    taskKey: resolveTaskReviewKey(task),
    status,
    action,
    reviewedAt
  };
}

export function parseTaskReviewState(value: string | null): TaskReviewStateMap {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    const next: TaskReviewStateMap = {};

    for (const [key, resolution] of Object.entries(parsed)) {
      if (!isTaskReviewResolution(resolution)) {
        continue;
      }

      next[key] = {
        ...resolution,
        taskKey: resolution.taskKey || key
      };
    }

    return next;
  } catch {
    return {};
  }
}

export function applyTaskReviewStateToSnapshot(
  snapshot: MissionControlSnapshot,
  reviewState: TaskReviewStateMap
): MissionControlSnapshot {
  const reviewKeys = Object.keys(reviewState);

  if (reviewKeys.length === 0) {
    return snapshot;
  }

  let changed = false;
  const tasks = snapshot.tasks.map((task) => {
    const review = reviewState[resolveTaskReviewKey(task)];

    if (!review) {
      return task;
    }

    changed = true;
    return applyTaskReviewResolution(task, review);
  });

  return changed ? { ...snapshot, tasks } : snapshot;
}

export function applyTaskReviewResolution(
  task: WorkItemRecord,
  review: TaskReviewResolution
): WorkItemRecord {
  return {
    ...task,
    metadata: {
      ...task.metadata,
      reviewStatus: review.status,
      reviewAction: review.action,
      reviewedAt: review.reviewedAt,
      reviewEvents: [buildTaskReviewFeedEvent(task, review)]
    }
  };
}

export function readTaskReviewStatus(task: WorkItemRecord): TaskReviewStatus | null {
  const value = task.metadata.reviewStatus;
  return isTaskReviewStatus(value) ? value : null;
}

export function readTaskReviewReviewedAt(task: WorkItemRecord) {
  const value = task.metadata.reviewedAt;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function readTaskReviewAction(task: WorkItemRecord) {
  const value = task.metadata.reviewAction;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function resolveEffectiveTaskReviewStatus(
  task: WorkItemRecord,
  options: TaskReviewDisplayOptions = {}
): TaskReviewStatus | null {
  const status = readTaskReviewStatus(task);

  if (status !== "continued") {
    return status;
  }

  return isTaskReviewContinuationPending(task, options) ? status : null;
}

export function isTaskReviewContinuationPending(
  task: WorkItemRecord,
  options: TaskReviewDisplayOptions = {}
) {
  const reviewedAt = readTaskReviewReviewedAt(task);
  const reviewedAtMs = reviewedAt ? Date.parse(reviewedAt) : Number.NaN;

  if (!Number.isNaN(reviewedAtMs) && evidenceArrivedAfterReview(options.latestEvidenceAt, reviewedAtMs)) {
    return false;
  }

  if (options.hasLiveActivity) {
    return true;
  }

  if (Number.isNaN(reviewedAtMs)) {
    return false;
  }

  return (options.nowMs ?? Date.now()) - reviewedAtMs < taskReviewContinuationGraceMs;
}

export function resolveTaskReviewBadgeLabel(status: TaskReviewStatus) {
  switch (status) {
    case "accepted":
      return "accepted";
    case "continued":
      return "continuing";
    case "retried":
      return "retry drafted";
    case "dismissed":
      return "dismissed";
  }
}

export function resolveTaskReviewFooterLabel(status: TaskReviewStatus) {
  switch (status) {
    case "accepted":
      return "review accepted";
    case "continued":
      return "continuation accepted";
    case "retried":
      return "retry drafted";
    case "dismissed":
      return "review dismissed";
  }
}

export function resolveTaskReviewSummary(status: TaskReviewStatus) {
  switch (status) {
    case "accepted":
      return "An operator accepted the captured result. The original warning remains available for audit.";
    case "continued":
      return "OpenClaw accepted a continuation in the existing task session.";
    case "retried":
      return "An operator drafted a retry from the original mission.";
    case "dismissed":
      return "An operator dismissed this review item without accepting the captured result.";
  }
}

function buildTaskReviewFeedEvent(task: WorkItemRecord, review: TaskReviewResolution): TaskFeedEvent {
  return {
    id: `task-review:${review.taskKey}:${review.status}`,
    kind: review.status === "accepted" || review.status === "continued" ? "status" : "warning",
    timestamp: review.reviewedAt,
    title: resolveTaskReviewEventTitle(review.status),
    detail: `${resolveTaskReviewSummary(review.status)} Task: ${task.title.trim() || task.id}.`
  };
}

function evidenceArrivedAfterReview(evidenceAt: string | null | undefined, reviewedAtMs: number) {
  if (!evidenceAt) {
    return false;
  }

  const evidenceAtMs = Date.parse(evidenceAt);
  return !Number.isNaN(evidenceAtMs) && evidenceAtMs > reviewedAtMs;
}

function resolveTaskReviewEventTitle(status: TaskReviewStatus) {
  switch (status) {
    case "accepted":
      return "Review accepted";
    case "continued":
      return "Continuation accepted";
    case "retried":
      return "Retry drafted";
    case "dismissed":
      return "Review dismissed";
  }
}

function isTaskReviewResolution(value: unknown): value is TaskReviewResolution {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as TaskReviewResolution;
  return (
    typeof candidate.taskId === "string" &&
    typeof candidate.taskKey === "string" &&
    isTaskReviewStatus(candidate.status) &&
    typeof candidate.action === "string" &&
    typeof candidate.reviewedAt === "string"
  );
}

function isTaskReviewStatus(value: unknown): value is TaskReviewStatus {
  return value === "accepted" || value === "continued" || value === "retried" || value === "dismissed";
}
