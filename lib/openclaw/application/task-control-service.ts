import "server-only";

import { getOpenClawAdapter, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  getMissionControlSnapshot,
  invalidateMissionControlSnapshotCache
} from "@/lib/openclaw/application/mission-control-service";
import { getTaskDetail } from "@/lib/openclaw/application/runtime-service";
import type { MissionControlSnapshot, TaskDetailRecord } from "@/lib/openclaw/types";

export type RunningTaskControlAction = "steer" | "inject" | "continue";

export interface RunningTaskControlInput {
  action: RunningTaskControlAction;
  message: string;
  dispatchId?: string | null;
}

export interface RunningTaskControlResult {
  ok: true;
  action: RunningTaskControlAction;
  taskId: string;
  target: RunningTaskControlTarget;
  result: Record<string, unknown>;
}

export interface RunningTaskControlTarget {
  agentId: string | null;
  sessionId: string | null;
  sessionKey: string | null;
  runId: string | null;
}

type TaskControlAdapter = Pick<OpenClawAdapter, "steerSession" | "injectChat"> &
  Partial<Pick<OpenClawAdapter, "runAgentTurn">>;

type TaskControlDeps = {
  adapter?: TaskControlAdapter;
  getTaskDetail?: typeof getTaskDetail;
  getMissionControlSnapshot?: typeof getMissionControlSnapshot;
  invalidateMissionControlSnapshotCache?: typeof invalidateMissionControlSnapshotCache;
};

export async function controlRunningTaskSession(
  taskId: string,
  input: RunningTaskControlInput,
  deps: TaskControlDeps = {}
): Promise<RunningTaskControlResult> {
  const message = input.message.trim();

  if (!message) {
    throw new Error("Control message is required.");
  }

  const loadTaskDetail = deps.getTaskDetail ?? getTaskDetail;
  const taskDetail = await loadTaskDetail(taskId, { dispatchId: input.dispatchId ?? null });
  const target = resolveRunningTaskControlTarget(taskDetail);
  const adapter = deps.adapter ?? getOpenClawAdapter();

  if (input.action === "continue") {
    const result = await continueTaskSession(taskDetail, target, message, adapter, deps);

    (deps.invalidateMissionControlSnapshotCache ?? invalidateMissionControlSnapshotCache)();

    return {
      ok: true,
      action: input.action,
      taskId: taskDetail.task.id,
      target,
      result
    };
  }

  if (!isTaskControlAvailable(taskDetail)) {
    throw new Error("Task is not currently running.");
  }

  if (!target.sessionKey && !target.sessionId) {
    throw new Error("Task does not expose an active OpenClaw session.");
  }

  const result =
    input.action === "steer"
      ? await adapter.steerSession(
          {
            key: target.sessionKey,
            sessionId: target.sessionKey ? null : target.sessionId,
            message
          },
          { timeoutMs: 10000 }
        )
      : await adapter.injectChat(
          {
            sessionKey: target.sessionKey,
            sessionId: target.sessionKey ? null : target.sessionId,
            message
          },
          { timeoutMs: 10000 }
        );

  (deps.invalidateMissionControlSnapshotCache ?? invalidateMissionControlSnapshotCache)();

  return {
    ok: true,
    action: input.action,
    taskId: taskDetail.task.id,
    target,
    result
  };
}

async function continueTaskSession(
  taskDetail: TaskDetailRecord,
  target: RunningTaskControlTarget,
  message: string,
  adapter: TaskControlAdapter,
  deps: TaskControlDeps
) {
  if (!target.agentId) {
    throw new Error("Task does not expose an OpenClaw agent.");
  }

  if (!adapter.runAgentTurn) {
    throw new Error("Task continuation requires OpenClaw mission dispatch support.");
  }

  const snapshot = await (deps.getMissionControlSnapshot ?? getMissionControlSnapshot)({
    includeHidden: true
  }).catch(() => null);
  const dispatchId = taskDetail.task.dispatchId ?? null;
  const sessionId = target.sessionId ?? target.sessionKey ?? undefined;
  const result = await adapter.runAgentTurn(
    {
      agentId: target.agentId,
      sessionId: sessionId ?? undefined,
      message,
      thinking: "medium",
      timeoutSeconds: 45,
      workspace: resolveTaskWorkspacePath(taskDetail, snapshot),
      dispatchId,
      idempotencyKey: dispatchId ? `${dispatchId}:continue:${Date.now()}` : undefined
    },
    { timeoutMs: 60_000 }
  );

  return result as Record<string, unknown>;
}

function resolveRunningTaskControlTarget(taskDetail: TaskDetailRecord): RunningTaskControlTarget {
  const task = taskDetail.task;
  const activeRun = taskDetail.runs.find((run) => isControllableStatus(run.status)) ?? taskDetail.runs[0] ?? null;
  const agentId =
    activeRun?.agentId?.trim() ||
    task.primaryAgentId?.trim() ||
    firstNonEmpty(task.agentIds) ||
    null;
  const sessionId =
    activeRun?.sessionId?.trim() ||
    firstNonEmpty(task.sessionIds) ||
    readMetadataString(task.metadata, "sessionId") ||
    readMetadataString(task.metadata, "gatewaySessionId") ||
    readMetadataString(task.metadata, "openClawSessionId") ||
    null;
  const explicitSessionKey =
    readMetadataString(task.metadata, "sessionKey") ||
    readMetadataString(task.metadata, "gatewaySessionKey") ||
    (activeRun?.key.trim().startsWith("agent:") ? activeRun.key.trim() : null);
  const sessionKey = explicitSessionKey ?? resolveSessionKey(agentId, sessionId);
  const runId = activeRun?.runId?.trim() || firstNonEmpty(task.runIds) || null;

  return {
    agentId,
    sessionId,
    sessionKey,
    runId
  };
}

function isTaskControlAvailable(taskDetail: TaskDetailRecord) {
  return (
    isControllableStatus(taskDetail.task.status) ||
    taskDetail.task.liveRunCount > 0 ||
    taskDetail.runs.some((run) => isControllableStatus(run.status))
  );
}

function isControllableStatus(status: string) {
  return status === "running" || status === "queued";
}

function resolveSessionKey(agentId: string | null, sessionId: string | null) {
  if (!sessionId) {
    return null;
  }

  if (sessionId.startsWith("agent:")) {
    return sessionId;
  }

  if (!agentId) {
    return null;
  }

  return `agent:${agentId}:explicit:${sessionId}`;
}

function resolveTaskWorkspacePath(taskDetail: TaskDetailRecord, snapshot: MissionControlSnapshot | null) {
  const task = taskDetail.task;
  const workspaceId = task.workspaceId?.trim();

  if (!snapshot || !workspaceId) {
    return null;
  }

  return (
    snapshot.workspaces.find((workspace) => workspace.id === workspaceId)?.path ??
    snapshot.agents.find((agent) => agent.id === task.primaryAgentId)?.workspacePath ??
    null
  );
}

function firstNonEmpty(values: string[]) {
  return values.find((value) => value.trim().length > 0)?.trim() ?? null;
}

function readMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
