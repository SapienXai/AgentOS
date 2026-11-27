export type TaskReviewStatus = "accepted" | "continued" | "retried" | "dismissed";

export type TaskReviewResolution = {
  taskId: string;
  taskKey: string;
  status: TaskReviewStatus;
  action: string;
  reviewedAt: string;
};

export type TaskReviewStateMap = Record<string, TaskReviewResolution>;

export function resolveTaskReviewKey(task: { id: string; key: string; dispatchId?: string | null; metadata?: Record<string, unknown> }) {
  const dispatchId = task.dispatchId?.trim();
  if (dispatchId) return dispatchId;
  const nativeTaskId = typeof task.metadata?.openClawTaskId === "string" ? task.metadata.openClawTaskId.trim() : "";
  return nativeTaskId || (typeof task.key === "string" ? task.key.trim() : "") || task.id;
}
