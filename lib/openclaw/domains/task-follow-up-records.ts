import type { RuntimeCreatedFile, RuntimeOutputRecord, RuntimeRecord, TaskRecord } from "@/lib/openclaw/types";
import { createHash } from "node:crypto";

const FOLLOW_UP_STALE_MS = 90_000;
type TaskFollowUpTokenUsage = NonNullable<RuntimeRecord["tokenUsage"]>;

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
  tokenUsage?: TaskFollowUpTokenUsage;
  createdFiles?: RuntimeCreatedFile[];
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

export function resolveTaskFollowUpDisplayMessage(followUp: Pick<TaskFollowUpRecord, "message" | "prompt" | "summary">) {
  const prompt = normalizeTaskFollowUpPrompt(followUp.prompt);
  return (
    normalizeTaskFollowUpMessage(followUp.message) ??
    readOperatorFollowUp(followUp.prompt) ??
    (prompt && !looksLikeStructuredFollowUpPrompt(prompt) ? prompt : null) ??
    normalizeTaskFollowUpMessage(followUp.summary) ??
    null
  );
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
    const groupKey = resolveFollowUpGroupKey(dispatchId, runtime);
    if (!groupKey) {
      continue;
    }

    const group = groups.get(groupKey) ?? [];
    group.push(runtime);
    groups.set(groupKey, group);
  }

  return Array.from(groups.entries())
    .map(([runId, group]) => {
      const sortedGroup = [...group].sort(sortRuntimeByUpdatedAtAsc);
      const newestRuntime = [...group].sort(sortRuntimeByUpdatedAtDesc)[0] ?? null;
      const resolvedRunId =
        sortedGroup
          .map((runtime) => runtime.runId?.trim() || readRuntimeMetadataString(runtime, "runId"))
          .find((value): value is string => Boolean(value)) ??
        (runId.startsWith("run:") ? runId.slice(4) : null);
      const prompt = readFollowUpPrompt(group, outputByRuntimeId);
      const message = readOperatorFollowUp(prompt) ?? "";
      const output = resolveBestFollowUpOutput(group, outputByRuntimeId);
      const summary = output?.finalText?.trim() || readMeaningfulRuntimeSubtitle(group) || null;
      const createdAt = readFollowUpCreatedAt(resolvedRunId ?? runId, sortedGroup[0]?.updatedAt ?? newestRuntime?.updatedAt ?? null);
      const tokenUsage = aggregateFollowUpTokenUsage(group, output);
      const createdFiles = readFollowUpCreatedFiles(group, output);

      return {
        id: `follow-up:${task.id}:${resolvedRunId ?? runId}`,
        message,
        prompt: prompt ?? message,
        createdAt,
        taskId: task.id,
        dispatchId,
        runId: resolvedRunId,
        sessionId: readFollowUpSessionId(group, task.sessionIds),
        status: resolveFollowUpGroupStatus(group, output, summary),
        summary,
        tokenUsage,
        createdFiles
      };
    })
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .map((followUp, index) => {
      const message = resolveTaskFollowUpDisplayMessage(followUp) || `Follow-up ${index + 1}`;
      return {
        ...followUp,
        message,
        prompt: followUp.prompt || message
      };
    });
}

function resolveFollowUpGroupKey(dispatchId: string, runtime: RuntimeRecord) {
  const runId = runtime.runId?.trim() || readRuntimeMetadataString(runtime, "runId");
  if (runId && runId.startsWith(`${dispatchId}:continue:`)) {
    return `run:${runId}`;
  }

  const prompt =
    readRuntimeMetadataString(runtime, "turnPrompt") ??
    readRuntimeMetadataString(runtime, "prompt") ??
    readRuntimeMetadataString(runtime, "mission") ??
    readRuntimeMetadataString(runtime, "routedMission");

  if (prompt && /Operator follow-up:/i.test(prompt)) {
    return `prompt:${createHash("sha1").update(prompt).digest("hex").slice(0, 12)}`;
  }

  return null;
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

  const prompt = readString(entry.prompt) ?? message;
  const summary = readString(entry.summary);
  const resolvedMessage = resolveTaskFollowUpDisplayMessage({
    message,
    prompt,
    summary
  }) ?? message;

  return {
    id,
    message: resolvedMessage,
    prompt: prompt || resolvedMessage,
    createdAt,
    taskId: readString(entry.taskId),
    dispatchId: readString(entry.dispatchId),
    runId: readString(entry.runId),
    sessionId: readString(entry.sessionId),
    status: readString(entry.status),
    summary,
    tokenUsage: readTokenUsage(entry.tokenUsage),
    createdFiles: readCreatedFiles(entry.createdFiles)
  };
}

function mergeTaskFollowUpRecord(base: TaskFollowUpRecord, incoming: TaskFollowUpRecord): TaskFollowUpRecord {
  const merged = {
    ...base,
    ...incoming,
    summary: incoming.summary ?? base.summary,
    status: incoming.status ?? base.status,
    sessionId: incoming.sessionId ?? base.sessionId,
    tokenUsage: incoming.tokenUsage ?? base.tokenUsage,
    createdFiles: incoming.createdFiles ?? base.createdFiles
  };
  const message = resolveTaskFollowUpDisplayMessage(merged) ?? normalizeTaskFollowUpMessage(base.message) ?? base.prompt;

  return {
    ...merged,
    message,
    prompt: merged.prompt || message
  };
}

function readFollowUpCreatedFiles(
  group: RuntimeRecord[],
  output: RuntimeOutputRecord | null
): RuntimeCreatedFile[] | undefined {
  const createdFiles = dedupeCreatedFiles([
    ...(output?.createdFiles ?? []),
    ...group.flatMap((runtime) => readCreatedFiles(runtime.metadata.createdFiles) ?? [])
  ]);

  if (createdFiles.length > 0) {
    return createdFiles;
  }

  return output ? [] : undefined;
}

function aggregateFollowUpTokenUsage(
  group: RuntimeRecord[],
  output: RuntimeOutputRecord | null
): TaskFollowUpTokenUsage | undefined {
  const entries = [
    ...group.map((runtime) => ({
      id: runtime.id,
      tokenUsage: runtime.tokenUsage
    })),
    output
      ? {
          id: output.runtimeId,
          tokenUsage: output.tokenUsage
        }
      : null
  ].filter((entry): entry is { id: string; tokenUsage: TaskFollowUpTokenUsage | undefined } => Boolean(entry));
  const seen = new Set<string>();
  const relevant = entries.filter((entry) => {
    if (!entry.tokenUsage) {
      return false;
    }

    const key = [
      entry.id,
      entry.tokenUsage.input,
      entry.tokenUsage.output,
      entry.tokenUsage.total,
      entry.tokenUsage.cacheRead ?? 0
    ].join(":");

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });

  if (relevant.length === 0) {
    return undefined;
  }

  return relevant.reduce(
    (aggregate, entry) => ({
      input: aggregate.input + (entry.tokenUsage?.input ?? 0),
      output: aggregate.output + (entry.tokenUsage?.output ?? 0),
      total: aggregate.total + (entry.tokenUsage?.total ?? 0),
      cacheRead: (aggregate.cacheRead ?? 0) + (entry.tokenUsage?.cacheRead ?? 0)
    }),
    {
      input: 0,
      output: 0,
      total: 0,
      cacheRead: 0
    }
  );
}

function readFollowUpPrompt(
  group: RuntimeRecord[],
  outputByRuntimeId: Map<string, RuntimeOutputRecord>
) {
  for (const runtime of group) {
    const mission =
      readRuntimeMetadataString(runtime, "turnPrompt") ??
      readRuntimeMetadataString(runtime, "prompt") ??
      readRuntimeMetadataString(runtime, "mission") ??
      readRuntimeMetadataString(runtime, "routedMission");
    if (mission && /Operator follow-up:/i.test(mission)) {
      return mission;
    }
  }

  for (const runtime of group) {
    const output = outputByRuntimeId.get(runtime.id);
    const userPrompt = output?.items.find((item) => item.role === "user" && item.text.trim().length > 0)?.text?.trim();
    if (userPrompt && /Operator follow-up:/i.test(userPrompt)) {
      return userPrompt;
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

function normalizeTaskFollowUpPrompt(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";

  return trimmed.length > 0 ? trimmed : null;
}

function looksLikeStructuredFollowUpPrompt(prompt: string) {
  return (
    /^Continue this task in the existing task context\./i.test(prompt) ||
    /^Operator follow-up:/i.test(prompt) ||
    /Original mission:/i.test(prompt) ||
    /Latest result:/i.test(prompt) ||
    /Output context:/i.test(prompt) ||
    /Existing output\/files:/i.test(prompt)
  );
}

function normalizeTaskFollowUpMessage(value: string | null | undefined) {
  const trimmed = typeof value === "string" ? value.trim() : "";

  if (!trimmed || /^Follow-up \d+$/i.test(trimmed)) {
    return null;
  }

  return trimmed;
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

function readTokenUsage(value: unknown): TaskFollowUpTokenUsage | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  const input = readFiniteNumber(value.input);
  const output = readFiniteNumber(value.output);
  const total = readFiniteNumber(value.total);

  if (input === null || output === null || total === null) {
    return undefined;
  }

  const cacheRead = readFiniteNumber(value.cacheRead);
  return {
    input,
    output,
    total,
    ...(cacheRead === null ? {} : { cacheRead })
  };
}

function readFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readCreatedFiles(value: unknown): RuntimeCreatedFile[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.flatMap((entry) => {
    if (!isObjectRecord(entry)) {
      return [];
    }

    const path = readString(entry.path);
    const displayPath = readString(entry.displayPath) ?? path;

    if (!path || !displayPath) {
      return [];
    }

    return [{ path, displayPath } satisfies RuntimeCreatedFile];
  });
}

function dedupeCreatedFiles(createdFiles: RuntimeCreatedFile[]) {
  const seen = new Set<string>();
  const deduped: RuntimeCreatedFile[] = [];

  for (const file of createdFiles) {
    const key = `${file.path}:${file.displayPath}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(file);
  }

  return deduped;
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
