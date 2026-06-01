import type { RuntimeStatus, TaskFeedEvent, WorkItemRecord } from "@/lib/agentos/contracts";

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
      return "going live";
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
