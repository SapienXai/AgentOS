import type { MissionControlSnapshot, RuntimeRecord, TaskDetailRecord, TaskRecord } from "@/lib/openclaw/types";
import type { MissionDispatchRecord } from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import {
  buildTaskIntegrityRecord as buildTaskIntegrityRecordFromMissionDispatch
} from "@/lib/openclaw/domains/mission-dispatch";
import {
  extractMissionDispatchSessionId,
  reconcileTaskRecordWithDispatchRecord
} from "@/lib/openclaw/domains/mission-dispatch-model";
import {
  buildMissionDispatchFeed as buildMissionDispatchFeedFromDomain,
  buildTaskFeed as buildTaskFeedFromDomain,
  mergeTaskFeedEvents as mergeTaskFeedEventsFromDomain
} from "@/lib/openclaw/domains/task-feed";
import {
  buildTaskRecord,
  dedupeCreatedFiles,
  extractCreatedFilesFromRuntimeMetadata,
  extractWarningsFromRuntimeMetadata
} from "@/lib/openclaw/domains/task-records";
import {
  buildObservedMissionDispatchRuntime,
} from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import {
  createMissionDispatchRuntime as createMissionDispatchRuntimeFromRuntime
} from "@/lib/openclaw/domains/mission-dispatch-runtime";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import { getRuntimeOutputForResolvedRuntime as getRuntimeOutputForResolvedRuntimeFromTranscript } from "@/lib/openclaw/domains/runtime-transcript";

export async function buildTaskDetailFromTaskRecord(
  task: TaskRecord,
  snapshot: MissionControlSnapshot,
  dispatchRecord: MissionDispatchRecord | null
): Promise<TaskDetailRecord> {
  const runs = task.runtimeIds
    .map((runtimeId) => snapshot.runtimes.find((runtime) => runtime.id === runtimeId))
    .filter((runtime): runtime is RuntimeRecord => Boolean(runtime))
    .sort(sortRuntimesByUpdatedAtDesc);

  return buildTaskDetailFromResolvedRuns(task, runs, snapshot, dispatchRecord);
}

export async function buildTaskDetailFromDispatchRecord(
  dispatchRecord: MissionDispatchRecord,
  snapshot: MissionControlSnapshot
): Promise<TaskDetailRecord> {
  const agentNameById = new Map(snapshot.agents.map((agent) => [agent.id, formatAgentDisplayName(agent)]));
  const dispatchRuntimes = snapshot.runtimes
    .filter((runtime) => matchesDispatchRecordRuntime(runtime, dispatchRecord))
    .sort(sortRuntimesByUpdatedAtDesc);
  const fallbackRuntime =
    dispatchRuntimes[0] ??
    (await buildObservedMissionDispatchRuntime(dispatchRecord)) ??
    createMissionDispatchRuntimeFromRuntime(dispatchRecord, Date.now());
  const runs = dispatchRuntimes.length > 0 ? dispatchRuntimes : [fallbackRuntime];
  const task = buildTaskRecord(`dispatch:${dispatchRecord.id}`, runs, agentNameById);

  return buildTaskDetailFromResolvedRuns(task, runs, snapshot, dispatchRecord);
}

async function buildTaskDetailFromResolvedRuns(
  task: TaskRecord,
  runs: RuntimeRecord[],
  snapshot: MissionControlSnapshot,
  dispatchRecord: MissionDispatchRecord | null
): Promise<TaskDetailRecord> {
  const outputs = await Promise.all(
    runs.map((runtime) => getRuntimeOutputForResolvedRuntimeFromTranscript(runtime, snapshot))
  );
  const outputByRuntimeId = new Map(outputs.map((output) => [output.runtimeId, output]));
  const createdFiles = dedupeCreatedFiles(
    outputs.flatMap((output) => output.createdFiles).concat(
      runs.flatMap((runtime) => extractCreatedFilesFromRuntimeMetadata(runtime))
    )
  );
  const warnings = uniqueStrings(
    outputs.flatMap((output) => output.warnings).concat(
      runs.flatMap((runtime) => extractWarningsFromRuntimeMetadata(runtime))
    )
  );
  const reconciledTask = dispatchRecord ? reconcileTaskRecordWithDispatchRecord(task, dispatchRecord) : task;
  const enrichedTask = enrichTaskRecordWithRuntimeOutputs(reconciledTask, outputs, createdFiles, warnings);
  const bootstrapFeed = await buildMissionDispatchFeedFromDomain(enrichedTask, dispatchRecord, snapshot);
  const runtimeFeed = buildTaskFeedFromDomain(enrichedTask, runs, outputByRuntimeId, snapshot);
  const integrity = await buildTaskIntegrityRecordFromMissionDispatch({
    task: enrichedTask,
    runs,
    outputs,
    createdFiles,
    dispatchRecord,
    snapshot
  });

  return {
    task: enrichedTask,
    runs,
    outputs,
    liveFeed: mergeTaskFeedEventsFromDomain(bootstrapFeed, runtimeFeed),
    createdFiles,
    warnings,
    integrity
  };
}

function enrichTaskRecordWithRuntimeOutputs(
  task: TaskRecord,
  outputs: Awaited<ReturnType<typeof getRuntimeOutputForResolvedRuntimeFromTranscript>>[],
  createdFiles: ReturnType<typeof dedupeCreatedFiles>,
  warnings: string[]
): TaskRecord {
  const finalOutput = [...outputs]
    .reverse()
    .find((output) => output.finalText?.trim() || output.errorMessage?.trim()) ?? null;
  const finalText = finalOutput?.finalText?.trim() || null;
  const resultPreview =
    finalText ||
    (typeof task.metadata.resultPreview === "string" ? task.metadata.resultPreview.trim() : "") ||
    task.subtitle;
  const turnCount = outputs.filter((output) => output.items.length > 0).length;

  return {
    ...task,
    subtitle: finalText ? summarizeText(finalText, 160) : task.subtitle,
    artifactCount: createdFiles.length,
    warningCount: warnings.length,
    metadata: {
      ...task.metadata,
      resultPreview,
      turnCount: turnCount || task.metadata.turnCount,
      finalResponseText: finalText,
      finalResponseRuntimeId: finalOutput?.runtimeId ?? null
    }
  };
}

function matchesDispatchRecordRuntime(runtime: RuntimeRecord, dispatchRecord: MissionDispatchRecord) {
  const runtimeDispatchId =
    typeof runtime.metadata.dispatchId === "string" ? runtime.metadata.dispatchId.trim() : "";

  if (runtimeDispatchId === dispatchRecord.id) {
    return true;
  }

  const dispatchSessionId = extractMissionDispatchSessionId(dispatchRecord);
  if (dispatchSessionId && runtime.sessionId === dispatchSessionId && runtime.agentId === dispatchRecord.agentId) {
    return true;
  }

  return false;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function sortRuntimesByUpdatedAtDesc(left: RuntimeRecord, right: RuntimeRecord) {
  return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
}

function summarizeText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}
