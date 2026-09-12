import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  normalizeClientError,
  resolveGatewayRecoveryMessage
} from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  normalizeOpenClawTaskHistoryInput,
  type OpenClawTaskHistoryInput,
  type OpenClawTaskHistoryPayload
} from "@/lib/openclaw/client/types";
import type {
  MissionControlSnapshot,
  RuntimeRecord,
  TaskHistoryRecord,
  TaskRecord
} from "@/lib/openclaw/types";

const NATIVE_HISTORY_LABEL = "Native OpenClaw task history";
const LEGACY_HISTORY_LABEL = "Legacy session history fallback (bounded)";
const LEGACY_HISTORY_RECOVERY = "Update OpenClaw to 2026.9.4 for native task history.";

export type TaskHistoryLoadResult = {
  record: TaskHistoryRecord;
  payload: OpenClawTaskHistoryPayload | null;
};

export async function loadTaskHistoryForTask({
  task,
  runs,
  snapshot,
  cursor,
  limit
}: {
  task: TaskRecord;
  runs: RuntimeRecord[];
  snapshot: Pick<MissionControlSnapshot, "mode">;
  cursor?: string | null;
  limit?: number;
}): Promise<TaskHistoryLoadResult | null> {
  const taskId = resolveNativeTaskId(task, runs);
  if (!taskId) {
    return null;
  }

  const request = normalizeOpenClawTaskHistoryInput({ taskId, cursor, limit });
  const adapter = getOpenClawAdapter();
  let fallbackReason: string | null = null;

  if (snapshot.mode !== "fallback" && adapter.getTaskHistory) {
    try {
      const payload = await adapter.getTaskHistory(request, { timeoutMs: 8_000 });
      const messages = readTaskHistoryMessages(payload);

      if (!messages) {
        return {
          record: createTaskHistoryRecord({
            taskId,
            source: "native",
            status: "failed",
            request,
            messageCount: 0,
            nextCursor: null,
            label: NATIVE_HISTORY_LABEL,
            reason: "OpenClaw tasks.history returned no messages array.",
            recovery: "Update OpenClaw or report the incompatible tasks.history response shape."
          }),
          payload: null
        };
      }

      return {
        record: createTaskHistoryRecord({
          taskId,
          source: "native",
          status: messages.length > 0 ? "available" : "empty",
          request,
          messageCount: messages.length,
          nextCursor: readNextCursor(payload),
          label: NATIVE_HISTORY_LABEL,
          reason: messages.length > 0 ? null : "OpenClaw returned an empty task history.",
          recovery: messages.length > 0 ? null : "Wait for OpenClaw to record a task message, then refresh the task."
        }),
        payload
      };
    } catch (error) {
      const normalized = normalizeClientError(error);
      if (normalized.kind !== "unsupported") {
        return {
          record: createTaskHistoryRecord({
            taskId,
            source: "native",
            status: classifyTaskHistoryFailure(normalized.kind, normalized.message),
            request,
            messageCount: 0,
            nextCursor: null,
            label: NATIVE_HISTORY_LABEL,
            reason: normalized.message,
            recovery: resolveGatewayRecoveryMessage(normalized)
          }),
          payload: null
        };
      }

      fallbackReason = "OpenClaw does not expose tasks.history on this supported version.";
    }
  } else {
    fallbackReason = snapshot.mode === "fallback"
      ? "Native OpenClaw task history is unavailable in the current degraded runtime."
      : "OpenClaw does not expose tasks.history on this supported version.";
  }

  const sessionKey = resolveLegacySessionKey(task, runs);
  if (!sessionKey) {
    return {
      record: createTaskHistoryRecord({
        taskId,
        source: "legacy-session-history",
        status: "unavailable",
        request,
        messageCount: 0,
        nextCursor: null,
        label: LEGACY_HISTORY_LABEL,
        reason: `${fallbackReason} No authoritative session key is available for legacy recovery.`,
        recovery: LEGACY_HISTORY_RECOVERY
      }),
      payload: null
    };
  }

  try {
    const payload = await adapter.getSessionHistory(
      {
        sessionKey,
        limit: request.limit,
        ...(request.cursor ? { cursor: request.cursor } : {})
      },
      { timeoutMs: 8_000 }
    );
    const messages = readSessionHistoryMessages(payload);

    return {
      record: createTaskHistoryRecord({
        taskId,
        source: "legacy-session-history",
        status: messages.length > 0 ? "recovered" : "empty",
        request,
        messageCount: messages.length,
        nextCursor: null,
        label: LEGACY_HISTORY_LABEL,
        reason: messages.length > 0 ? fallbackReason : `${fallbackReason} The bounded session history is empty.`,
        recovery: LEGACY_HISTORY_RECOVERY
      }),
      payload: messages.length > 0 ? payload : { ...payload, messages: [] }
    };
  } catch (error) {
    const normalized = normalizeClientError(error);
    return {
      record: createTaskHistoryRecord({
        taskId,
        source: "legacy-session-history",
        status: classifyTaskHistoryFailure(normalized.kind, normalized.message),
        request,
        messageCount: 0,
        nextCursor: null,
        label: LEGACY_HISTORY_LABEL,
        reason: normalized.message,
        recovery: resolveGatewayRecoveryMessage(normalized)
      }),
      payload: null
    };
  }
}

export function resolveNativeTaskId(task: TaskRecord, runs: RuntimeRecord[] = []) {
  const metadataTaskId = readMetadataString(task.metadata, "openClawTaskId");
  if (metadataTaskId) {
    return metadataTaskId;
  }

  const sourceOfTruth = readMetadataString(task.metadata, "sourceOfTruth");
  if (sourceOfTruth === "openclaw-tasks.list") {
    return readMetadataString(task.metadata, "taskId");
  }

  for (const runtime of runs) {
    if (runtime.metadata.gatewayObjectKind !== "task") {
      continue;
    }

    const taskId = runtime.taskId?.trim() || readMetadataString(runtime.metadata, "openClawTaskId");
    if (taskId) {
      return taskId;
    }
  }

  return null;
}

function resolveLegacySessionKey(task: TaskRecord, runs: RuntimeRecord[]) {
  const candidates = [
    task.metadata.openClawSessionKey,
    task.metadata.sessionKey,
    task.metadata.gatewaySessionKey,
    ...runs.flatMap((runtime) => [
      runtime.metadata.openClawSessionKey,
      runtime.metadata.sessionKey,
      runtime.metadata.gatewaySessionKey,
      runtime.key.startsWith("agent:") ? runtime.key : null
    ]),
    task.key.startsWith("agent:") ? task.key : null
  ];

  return candidates.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}

function readTaskHistoryMessages(payload: OpenClawTaskHistoryPayload) {
  return Array.isArray(payload.messages) ? payload.messages : null;
}

function readSessionHistoryMessages(payload: { messages?: unknown[]; turns?: unknown[]; items?: unknown[] }) {
  if (Array.isArray(payload.messages)) return payload.messages;
  if (Array.isArray(payload.turns)) return payload.turns;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

function createTaskHistoryRecord({
  taskId,
  source,
  status,
  request,
  nextCursor,
  messageCount,
  label,
  reason,
  recovery
}: {
  taskId: string;
  source: TaskHistoryRecord["source"];
  status: TaskHistoryRecord["status"];
  request: OpenClawTaskHistoryInput;
  nextCursor: string | null;
  messageCount: number;
  label: string;
  reason: string | null;
  recovery: string | null;
}): TaskHistoryRecord {
  return {
    taskId,
    source,
    status,
    cursor: request.cursor ?? null,
    nextCursor,
    limit: request.limit ?? 200,
    messageCount,
    label,
    reason,
    recovery
  };
}

function readNextCursor(payload: OpenClawTaskHistoryPayload) {
  return typeof payload.nextCursor === "string" && payload.nextCursor.trim()
    ? payload.nextCursor.trim()
    : null;
}

function classifyTaskHistoryFailure(kind: ReturnType<typeof normalizeClientError>["kind"], message: string): TaskHistoryRecord["status"] {
  if (kind === "auth" || kind === "scope-limited") return "denied";
  if (kind === "timeout" || kind === "unreachable" || kind === "unsupported") return "unavailable";
  if (/not found|missing|does not exist|unknown task/i.test(message)) return "missing";
  return "failed";
}

function readMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
