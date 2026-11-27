import type { MissionSubmission, ModelRecord } from "@/lib/openclaw/types";

export const DEFAULT_TASK_THINKING = "medium";

type TaskThinking = NonNullable<MissionSubmission["thinking"]>;

export function findTaskReasoningModel(
  models: Pick<ModelRecord, "id" | "thinkingLevels">[],
  modelId?: string | null
) {
  if (!modelId) return undefined;
  return models.find((entry) => entry.id === modelId) ??
    models.find((entry) => entry.id === modelId.split("@", 1)[0]);
}

export function resolveBalancedTaskThinking(model?: Pick<ModelRecord, "thinkingLevels">): TaskThinking | undefined {
  if (model?.thinkingLevels?.some(({ id }) => id === DEFAULT_TASK_THINKING)) return DEFAULT_TASK_THINKING;
  // Let OpenClaw choose its native default for a model without Balanced.
  return undefined;
}

export function readTaskThinkingRejection(...candidates: Array<string | null | undefined>) {
  // Some OpenClaw versions return this validation failure as a successful text turn.
  return candidates.map((candidate) => candidate?.trim()).find((candidate) =>
    candidate && /^Thinking level "[\w-]+" is not supported for [^\s]+\. Use one of: [\w,-]+(?: [\w,-]+)*\.$/.test(candidate)
  ) ?? null;
}
