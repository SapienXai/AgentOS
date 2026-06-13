import type { RuntimeRecord } from "@/lib/openclaw/types";

export type RuntimeHistoryMergeResult = {
  runtimes: RuntimeRecord[];
  cache: Map<string, RuntimeRecord>;
};

export function mergeRuntimeHistory(
  currentRuntimes: RuntimeRecord[],
  previousRuntimeCache: Map<string, RuntimeRecord>,
  options: {
    excludeFromCache?: (runtime: RuntimeRecord) => boolean;
  } = {}
): RuntimeHistoryMergeResult {
  const nextHistory = new Map<string, RuntimeRecord>();
  const currentIds = new Set(currentRuntimes.map((runtime) => runtime.id));

  for (const runtime of currentRuntimes) {
    nextHistory.set(runtime.id, runtime);
  }

  for (const [runtimeId, runtime] of previousRuntimeCache.entries()) {
    if (currentIds.has(runtimeId)) {
      continue;
    }

    const historicalRuntime = {
      ...runtime,
      status:
        runtime.status === "stalled"
          ? "stalled"
          : runtime.status === "cancelled"
            ? "cancelled"
            : "completed",
      metadata: {
        ...runtime.metadata,
        historical: true
      }
    } satisfies RuntimeRecord;

    nextHistory.set(runtimeId, historicalRuntime);
  }

  const prunedHistory = pruneRuntimeHistory(Array.from(nextHistory.values()));
  const nextCache = new Map(
    prunedHistory
      .filter((runtime) => !options.excludeFromCache?.(runtime))
      .map((runtime) => [runtime.id, runtime])
  );

  return {
    runtimes: prunedHistory.sort(sortRuntimesByUpdatedAtDesc),
    cache: nextCache
  };
}

export function sortRuntimesByUpdatedAtDesc(left: RuntimeRecord, right: RuntimeRecord) {
  return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
}

function pruneRuntimeHistory(runtimes: RuntimeRecord[]) {
  const grouped = new Map<string, RuntimeRecord[]>();

  for (const runtime of runtimes) {
    const groupKey = runtime.agentId || runtime.workspaceId || "global";
    const list = grouped.get(groupKey) ?? [];
    list.push(runtime);
    grouped.set(groupKey, list);
  }

  return Array.from(grouped.values()).flatMap((entries) => {
    const sorted = entries.sort(sortRuntimesByUpdatedAtDesc);
    const retained = new Map(sorted.slice(0, 8).map((runtime) => [runtime.id, runtime]));

    for (const runtime of sorted) {
      if (isCurrentDispatchRuntime(runtime)) {
        retained.set(runtime.id, runtime);
      }
    }

    for (const runtime of sorted.filter(isOperatorVisibleAgentMessage).slice(0, 8)) {
      retained.set(runtime.id, runtime);
    }

    return Array.from(retained.values()).sort(sortRuntimesByUpdatedAtDesc);
  });
}

function isCurrentDispatchRuntime(runtime: RuntimeRecord) {
  return (
    typeof runtime.metadata.dispatchId === "string" &&
    runtime.metadata.dispatchId.trim().length > 0 &&
    runtime.metadata.historical !== true
  );
}

function isOperatorVisibleAgentMessage(runtime: RuntimeRecord) {
  return (
    runtime.metadata.interSessionMessage === true ||
    runtime.metadata.agentToAgentMessage === true ||
    runtime.toolNames?.includes("sessions_send") === true
  );
}
