import type { RuntimeOutputRecord, RuntimeRecord, TaskRecord } from "@/lib/openclaw/types";

const FOLLOW_UP_STALE_MS = 90_000;

export type TaskFollowUpRecord = {
  id: string;
  message: string;
  prompt: string;
  createdAt: string;
  taskId?: string | null;
  dispatchId?: string | null;
  runId?: string | null;
  sessionId?: string | null;
  status?: string | null;
  summary?: string | null;
};

export function readTaskFollowUpsFromMetadata(metadata: Record<string, unknown>): TaskFollowUpRecord[] {
  const value = metadata.followUps;
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => (isObjectRecord(entry) ? normalizeTaskFollowUpRecord(entry) : null))
    .filter((entry): entry is TaskFollowUpRecord => Boolean(entry));
}

export function deriveTaskFollowUpsFromRuntimes(
  task: Pick<TaskRecord, "dispatchId" | "id" | "sessionIds">,
  runtimes: RuntimeRecord[],
  outputs: RuntimeOutputRecord[] = []
): TaskFollowUpRecord[] {
  const dispatchId = task.dispatchId?.trim();
  if (!dispatchId) {
    return [];
  }

  const outputByRuntimeId = new Map(outputs.map((output) => [output.runtimeId, output]));
  const groups = new Map<string, RuntimeRecord[]>();

  for (const runtime of runtimes) {
    const runId = runtime.runId?.trim() || readRuntimeMetadataString(runtime, "runId");
    if (!runId || !runId.startsWith(`${dispatchId}:continue:`)) {
      continue;
    }

    const group = groups.get(runId) ?? [];
    group.push(runtime);
    groups.set(runId, group);
  }

  return Array.from(groups.entries())
    .map(([runId, group]) => {
      const sortedGroup = [...group].sort(sortRuntimeByUpdatedAtAsc);
      const newestRuntime = [...group].sort(sortRuntimeByUpdatedAtDesc)[0] ?? null;
      const prompt = readFollowUpPrompt(group);
      const message = readOperatorFollowUp(prompt) ?? "";
      const output = resolveBestFollowUpOutput(group, outputByRuntimeId);
      const summary = output?.finalText?.trim() || readMeaningfulRuntimeSubtitle(group) || null;
      const createdAt = readFollowUpCreatedAt(runId, sortedGroup[0]?.updatedAt ?? newestRuntime?.updatedAt ?? null);

      return {
        id: `follow-up:${task.id}:${runId}`,
        message,
        prompt: prompt ?? message,
        createdAt,
        taskId: task.id,
        dispatchId,
        runId,
        sessionId: readFollowUpSessionId(group, task.sessionIds),
        status: resolveFollowUpGroupStatus(group, output, summary),
        summary
      };
    })
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .map((followUp, index) => {
      const message = followUp.message || `Recovered follow-up ${index + 1}`;
      return {
        ...followUp,
        message,
        prompt: followUp.prompt || message
      };
    });
}

export function mergeTaskFollowUps(
  base: TaskFollowUpRecord[],
  incoming: TaskFollowUpRecord[]
): TaskFollowUpRecord[] {
  const byKey = new Map<string, TaskFollowUpRecord>();

  for (const entry of [...base, ...incoming]) {
    const key = entry.runId || entry.id;
    const current = byKey.get(key);
    byKey.set(key, current ? mergeTaskFollowUpRecord(current, entry) : entry);
  }

  return Array.from(byKey.values()).sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

function normalizeTaskFollowUpRecord(entry: Record<string, unknown>): TaskFollowUpRecord | null {
  const id = readString(entry.id);
  const message = readString(entry.message);
  const createdAt = readString(entry.createdAt);
  if (!id || !message || !createdAt) {
    return null;
  }

  return {
    id,
    message,
    prompt: readString(entry.prompt) ?? message,
    createdAt,
    taskId: readString(entry.taskId),
    dispatchId: readString(entry.dispatchId),
    runId: readString(entry.runId),
    sessionId: readString(entry.sessionId),
    status: readString(entry.status),
    summary: readString(entry.summary)
  };
}

function mergeTaskFollowUpRecord(base: TaskFollowUpRecord, incoming: TaskFollowUpRecord): TaskFollowUpRecord {
  return {
    ...base,
    ...incoming,
    message: incoming.message.startsWith("Recovered follow-up") ? base.message : incoming.message,
    prompt: incoming.prompt.startsWith("Recovered follow-up") ? base.prompt : incoming.prompt,
    summary: incoming.summary ?? base.summary,
    status: incoming.status ?? base.status,
    sessionId: incoming.sessionId ?? base.sessionId
  };
}

function readFollowUpPrompt(group: RuntimeRecord[]) {
  for (const runtime of group) {
    const mission = readRuntimeMetadataString(runtime, "mission") ?? readRuntimeMetadataString(runtime, "routedMission");
    if (mission && /Operator follow-up:/i.test(mission)) {
      return mission;
    }
  }

  return null;
}

function readOperatorFollowUp(prompt: string | null) {
  if (!prompt) {
    return null;
  }

  const match = prompt.match(/Operator follow-up:\s*([\s\S]*?)(?:\n\s*Original mission:|\n\s*Latest result:|\n\s*Output context:|\n\s*Existing output\/files:|$)/i);
  return match?.[1]?.trim() || null;
}

function resolveBestFollowUpOutput(
  group: RuntimeRecord[],
  outputByRuntimeId: Map<string, RuntimeOutputRecord>
) {
  const outputs = group
    .map((runtime) => outputByRuntimeId.get(runtime.id))
    .filter((output): output is RuntimeOutputRecord => Boolean(output));

  return (
    outputs.find((output) => output.finalText?.trim()) ??
    outputs.find((output) => output.errorMessage?.trim()) ??
    outputs[0] ??
    null
  );
}

function readMeaningfulRuntimeSubtitle(group: RuntimeRecord[]) {
  return group
    .map((runtime) => runtime.subtitle.trim())
    .find((value) => Boolean(value && !isTechnicalRuntimeSubtitle(value)));
}

function resolveFollowUpGroupStatus(
  group: RuntimeRecord[],
  output: RuntimeOutputRecord | null,
  summary: string | null
) {
  if (output?.finalText || summary) {
    return "completed";
  }

  if (group.some((runtime) => runtime.status === "cancelled")) {
    return "cancelled";
  }

  if (group.some((runtime) => runtime.status === "stalled")) {
    return "stalled";
  }

  if (group.some((runtime) => runtime.status === "completed")) {
    return "completed";
  }

  if (group.some((runtime) => runtime.status === "queued")) {
    return "queued";
  }

  if (group.some((runtime) => runtime.status === "running") && isFollowUpGroupStale(group)) {
    return "stalled";
  }

  return "running";
}

function isFollowUpGroupStale(group: RuntimeRecord[]) {
  const latestUpdatedAt = Math.max(...group.map((runtime) => runtime.updatedAt ?? 0));
  return latestUpdatedAt > 0 && Date.now() - latestUpdatedAt > FOLLOW_UP_STALE_MS;
}

function readFollowUpCreatedAt(runId: string, fallbackUpdatedAt: number | null) {
  const timestamp = Number(runId.split(":continue:")[1]);
  if (Number.isFinite(timestamp) && timestamp > 0) {
    return new Date(timestamp).toISOString();
  }

  return new Date(fallbackUpdatedAt && fallbackUpdatedAt > 0 ? fallbackUpdatedAt : Date.now()).toISOString();
}

function readFollowUpSessionId(group: RuntimeRecord[], taskSessionIds: string[]) {
  const normalizedTaskSessions = new Set(taskSessionIds.flatMap((value) => normalizeSessionReference(value)));
  return (
    group
      .map((runtime) => runtime.sessionId?.trim())
      .find((sessionId): sessionId is string => Boolean(sessionId && normalizedTaskSessions.has(sessionId))) ??
    group.map((runtime) => runtime.sessionId?.trim()).find((sessionId): sessionId is string => Boolean(sessionId)) ??
    null
  );
}

function normalizeSessionReference(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return [];
  }

  const matches = trimmed.match(/^agent:([^:]+):explicit:(.+)$/);
  return matches ? [trimmed, matches[2] ?? ""] : [trimmed];
}

function readRuntimeMetadataString(runtime: RuntimeRecord, key: string) {
  const value = runtime.metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isTechnicalRuntimeSubtitle(value: string) {
  return ["chat", "agent", "sessions.changed", "session.message", "openclaw runtime event", "gateway runtime event"].includes(value.toLowerCase());
}

function sortRuntimeByUpdatedAtAsc(left: RuntimeRecord, right: RuntimeRecord) {
  return (left.updatedAt ?? 0) - (right.updatedAt ?? 0);
}

function sortRuntimeByUpdatedAtDesc(left: RuntimeRecord, right: RuntimeRecord) {
  return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
}
