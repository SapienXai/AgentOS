import type { AttentionItem } from "@/lib/agentos/contracts";

export const HUMAN_CONTROL_INBOX_REFRESH_DEBOUNCE_MS = 150;

export function shouldScheduleHumanControlRefresh(input: {
  open: boolean;
  loading: boolean;
  pendingAction: boolean;
}) {
  return input.open && !input.loading && !input.pendingAction;
}

export function preserveQuestionAnswers(
  items: AttentionItem[],
  current: Record<string, string[]>
) {
  const visibleQuestionIds = new Set(
    items
      .filter((item) => item.type === "question")
      .flatMap((item) => item.question?.map((question) => question.questionId) ?? [])
  );

  return Object.fromEntries(
    Object.entries(current).filter(([questionId]) => visibleQuestionIds.has(questionId))
  );
}
