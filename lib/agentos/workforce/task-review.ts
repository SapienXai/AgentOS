export type TaskReviewStatus = "accepted" | "continued" | "retried" | "dismissed";

export type TaskReviewResolution = {
  taskId: string;
  taskKey: string;
  status: TaskReviewStatus;
  action: string;
  reviewedAt: string;
};

export type TaskReviewStateMap = Record<string, TaskReviewResolution>;
