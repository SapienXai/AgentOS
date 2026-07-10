import type { RuntimeStatus, TaskFeedEvent, WorkItemRecord } from "@/lib/agentos/contracts";

export type TaskCardPrimaryAction = "open-live-activity" | "view-result" | "review-result" | "view-details";

export type TaskReviewPresentation = {
  deliveryUnconfirmed: boolean;
  technicalDetail: string | null;
  badgeLabel: string | null;
  footerLabel: string | null;
  evidenceLabel: string;
  followUpLabel: string;
  followUpPlaceholder: string;
};

export type TaskCardEvidencePresentation = {
  label: "Live activity" | "Last captured activity" | "Latest result";
  prioritizeActivity: boolean;
};

export function resolveTaskCardPrimaryAction(input: {
  status: RuntimeStatus;
  completedNeedsReview?: boolean;
}): TaskCardPrimaryAction {
  if (input.completedNeedsReview) {
    return "review-result";
  }

  if (input.status === "running" || input.status === "queued") {
    return "open-live-activity";
  }

  if (input.status === "completed") {
    return "view-result";
  }

  return "view-details";
}

export function resolveTaskBadgeLabel(
  bootstrapStage: string | null,
  status: RuntimeStatus,
  isPendingCreation: boolean,
  isAborted: boolean,
  hasRuntimeOutputEvidence = false
) {
  if (isAborted) {
    return "aborted";
  }

  if (status === "stalled" || bootstrapStage === "stalled") {
    return hasRuntimeOutputEvidence ? "needs review" : "waiting output";
  }

  if (!isPendingCreation || !bootstrapStage) {
    return status;
  }

  switch (bootstrapStage) {
    case "submitting":
      return "submitting";
    case "accepted":
      return "accepted";
    case "waiting-for-heartbeat":
      return "starting runner";
    case "waiting-for-runtime":
      return "awaiting runtime";
    case "runtime-observed":
      return hasRuntimeOutputEvidence ? status : "waiting output";
    case "completed":
      return "completed";
    default:
      return status;
  }
}

export function readTaskResultPreview(task: WorkItemRecord) {
  const resultPreview =
    typeof task.metadata.resultPreview === "string" ? task.metadata.resultPreview.trim() : "";

  if (resultPreview && !isLowSignalTaskResultCopy(resultPreview)) {
    return resultPreview;
  }

  const subtitle = task.subtitle.trim();
  return subtitle && !isWaitingForOutputCopy(subtitle) ? subtitle : "Waiting for the first OpenClaw update.";
}

export function hasTaskRuntimeOutputEvidence(task: WorkItemRecord, feed: TaskFeedEvent[]) {
  if (hasCapturedTaskOutput(task)) {
    return true;
  }

  if (readTaskTurnCount(task) > 0 || task.artifactCount > 0 || task.warningCount > 0) {
    return true;
  }

  return feed.some(
    (event) =>
      event.kind === "assistant" ||
      event.kind === "tool" ||
      event.kind === "artifact" ||
      event.kind === "warning"
  );
}

export function resolveTaskDispatchIssueDetail(
  task: WorkItemRecord,
  integrity?: { issues?: Array<{ id: string; detail?: string | null }> } | null
) {
  const dispatchIssueDetail = integrity?.issues?.find((issue) => issue.id === "dispatch-stalled")?.detail?.trim();

  if (dispatchIssueDetail) {
    return dispatchIssueDetail;
  }

  if (task.status !== "stalled") {
    return null;
  }

  const dispatchError =
    typeof task.metadata.dispatchError === "string" ? task.metadata.dispatchError.trim() : "";

  return dispatchError || null;
}

export function isGatewayWaitTimeoutDetail(detail: string | null | undefined) {
  return Boolean(detail && /OpenClaw Gateway wait timed out/i.test(detail));
}

export function resolveTaskReviewPresentation(
  task: WorkItemRecord,
  integrity?: { issues?: Array<{ id: string; detail?: string | null }> } | null
): TaskReviewPresentation {
  const technicalDetail = resolveTaskDispatchIssueDetail(task, integrity);
  const deliveryUnconfirmed = isGatewayWaitTimeoutDetail(technicalDetail);

  return {
    deliveryUnconfirmed,
    technicalDetail,
    badgeLabel: deliveryUnconfirmed ? "delivery unconfirmed" : null,
    footerLabel: deliveryUnconfirmed ? "delivery unconfirmed" : null,
    evidenceLabel: deliveryUnconfirmed ? "Last captured response — unverified" : "Latest result",
    followUpLabel: deliveryUnconfirmed ? "Ask agent to verify" : "Follow up",
    followUpPlaceholder: deliveryUnconfirmed
      ? "Ask the agent to verify whether delivery completed…"
      : "Ask a follow-up…"
  };
}

export function resolveTaskCardEvidencePresentation(input: {
  hasActivity: boolean;
  hasLiveActivity: boolean;
  deliveryUnconfirmed: boolean;
}): TaskCardEvidencePresentation {
  if (input.deliveryUnconfirmed) {
    return {
      label: "Last captured activity",
      prioritizeActivity: input.hasActivity
    };
  }

  if (input.hasLiveActivity) {
    return {
      label: "Live activity",
      prioritizeActivity: input.hasActivity
    };
  }

  return {
    label: "Latest result",
    prioritizeActivity: false
  };
}

export function isWaitingForOutputCopy(value: string) {
  return (
    /No transcript file was found for this runtime session/i.test(value) ||
    /No transcript entries were found for this runtime/i.test(value) ||
    /waiting for (the first )?(transcript|output)/i.test(value) ||
    /working silently/i.test(value)
  );
}

function hasCapturedTaskOutput(task: WorkItemRecord) {
  const finalResponse =
    typeof task.metadata.finalResponseText === "string" ? task.metadata.finalResponseText.trim() : "";
  const resultPreview =
    typeof task.metadata.resultPreview === "string" ? task.metadata.resultPreview.trim() : "";
  const candidate = finalResponse || resultPreview;

  return Boolean(candidate && !isWaitingForOutputCopy(candidate) && !isLowSignalTaskResultCopy(candidate));
}

function readTaskTurnCount(task: WorkItemRecord) {
  const metadataCount = task.metadata.turnCount;
  return typeof metadataCount === "number" && Number.isFinite(metadataCount)
    ? metadataCount
    : task.runtimeCount;
}

function isLowSignalTaskResultCopy(value: string) {
  return /^(agent|chat|session\.message|sessions\.changed)$/i.test(value.trim());
}
