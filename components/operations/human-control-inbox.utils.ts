import type { AttentionItem } from "@/lib/agentos/contracts";
import { resolveAttentionDestination } from "@/lib/agentos/attention-destinations";

export const HUMAN_CONTROL_INBOX_REFRESH_DEBOUNCE_MS = 150;

export type HumanControlDisplayGroup = {
  key: string;
  item: AttentionItem;
  items: AttentionItem[];
};

export function groupHumanControlItems(items: AttentionItem[]): HumanControlDisplayGroup[] {
  const groups = new Map<string, HumanControlDisplayGroup>();
  const result: HumanControlDisplayGroup[] = [];

  for (const item of items) {
    const key = groupingKey(item);
    if (!key) {
      result.push({ key: item.id, item, items: [item] });
      continue;
    }
    const current = groups.get(key);
    if (current) {
      current.items.push(item);
      continue;
    }
    const group = { key, item, items: [item] } satisfies HumanControlDisplayGroup;
    groups.set(key, group);
    result.push(group);
  }

  return result;
}

function groupingKey(item: AttentionItem) {
  if (item.type === "approval" || item.type === "question" || !item.worker.id) return null;
  if (item.type === "needs-setup" || item.type === "blocked") {
    const capabilityId = item.evidence?.capabilityId?.trim();
    const reasonCode = item.evidence?.reasonCode?.trim() || "unknown";
    return capabilityId ? `${item.type}:${item.worker.id}:${capabilityId}:${reasonCode}` : null;
  }
  if (item.type === "runtime-issue") {
    const runtimeIssueType = item.evidence?.runtimeIssueType?.trim();
    const reasonCode = item.evidence?.reasonCode?.trim() || runtimeIssueType;
    if (!runtimeIssueType) return null;
    const destination = resolveAttentionDestination(item, "inspect");
    return `runtime-issue:${item.worker.id}:${runtimeIssueType}:${reasonCode ?? "unknown"}:${destination.href}`;
  }
  return null;
}

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
