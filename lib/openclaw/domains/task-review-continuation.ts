import { buildTaskFollowUpPrompt } from "@/lib/openclaw/domains/task-follow-up";
import type { TaskRecord } from "@/lib/openclaw/types";

function limitTaskReviewMessageSection(value: string, maxLength: number) {
  const normalized = value.trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength).trimEnd()}\n\n[truncated for task continuation]`;
}

export function buildTaskReviewContinuationPrompt(
  task: TaskRecord,
  capturedOutput: string,
  operatorMessage?: string
) {
  const followUp = operatorMessage?.trim() || "Continue from the captured output, finish the remaining work, and verify the result.";

  return buildTaskFollowUpPrompt({
    task,
    operatorMessage: followUp,
    latestResult: limitTaskReviewMessageSection(capturedOutput, 7600)
  });
}
