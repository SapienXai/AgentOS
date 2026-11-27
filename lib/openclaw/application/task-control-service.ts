import "server-only";

import { createHash } from "node:crypto";

import { getOpenClawAdapter, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  getMissionControlSnapshot,
  invalidateMissionControlSnapshotCache
} from "@/lib/openclaw/application/mission-control-service";
import { getTaskDetail } from "@/lib/openclaw/application/runtime-service";
import { hasScopedTaskSession, resolveTaskFollowUpContext } from "@/lib/openclaw/domains/task-follow-up";
import { readExecutionIdentity } from "@/lib/openclaw/domains/execution-identity";
import { findTaskReasoningModel, resolveBalancedTaskThinking } from "@/lib/openclaw/task-reasoning";
import { classifyNativeMutationError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import { buildAgentSessionKey } from "@/lib/openclaw/client/native-ws-gateway-mappers";
import type { OpenClawCommandOptions } from "@/lib/openclaw/client/types";
import type { MissionControlSnapshot, TaskDetailRecord } from "@/lib/openclaw/types";

export type RunningTaskControlAction = "steer" | "inject" | "continue" | "message";

export class TaskMessageDeliveryUnknown extends Error {}

export interface RunningTaskControlInput {
  action: RunningTaskControlAction;
  message: string;
  dispatchId?: string | null;
  idempotencyKey?: string | null;
  taskSessionOnly?: boolean;
}

export interface RunningTaskControlResult {
  ok: true;
  action: RunningTaskControlAction;
  taskId: string;
  target: RunningTaskControlTarget;
  result: Record<string, unknown>;
  warning?: string | null;
  transport?: RunningTaskControlTransport;
}

export interface RunningTaskControlTransport {
  requestedMethod: string;
  actualMethod: string;
  fallback: "none" | "gateway-compatibility";
  reason?: string | null;
}

export interface RunningTaskControlTarget {
  agentId: string | null;
  sessionId: string | null;
  sessionKey: string | null;
  runId: string | null;
  openClawTaskId: string | null;
  provenance: string | null;
  confidence: "high" | "medium" | "none";
}

type TaskControlAdapter = Pick<OpenClawAdapter, "steerSession" | "injectChat"> &
  Partial<Pick<OpenClawAdapter, "runAgentTurn" | "listSessions">>;

type TaskControlDeps = {
  adapter?: TaskControlAdapter;
  getTaskDetail?: typeof getTaskDetail;
  getMissionControlSnapshot?: typeof getMissionControlSnapshot;
  invalidateMissionControlSnapshotCache?: typeof invalidateMissionControlSnapshotCache;
};

export async function controlRunningTaskSession(
  taskId: string,
  input: RunningTaskControlInput,
  deps: TaskControlDeps = {},
  gatewayOptions: OpenClawCommandOptions = {}
): Promise<RunningTaskControlResult> {
  const message = input.message.trim();

  if (!message) {
    throw new Error("Control message is required.");
  }

  const loadTaskDetail = deps.getTaskDetail ?? getTaskDetail;
  const taskDetail = await loadTaskDetail(taskId, { dispatchId: input.dispatchId ?? null });
  const scoped = input.taskSessionOnly || input.action === "message";
  if (scoped && !hasScopedTaskSession(resolveTaskFollowUpContext(taskDetail.task))) {
    throw new Error("OpenClaw has not confirmed a dedicated session for this task.");
  }
  const target = resolveRunningTaskControlTarget(taskDetail);
  const adapter = deps.adapter ?? getOpenClawAdapter();

  if (input.action === "message" && taskDetail.task.dispatchId &&
      (!target.agentId || target.sessionKey !== buildAgentSessionKey(target.agentId, taskDetail.task.dispatchId))) {
    throw new Error("OpenClaw has not confirmed a dedicated session for this task.");
  }
  if (scoped) {
    if (!target.sessionKey || !target.sessionId || !adapter.listSessions) {
      throw new Error("The task session could not be verified. Open the task again before sending.");
    }
    const { sessions } = await adapter.listSessions({ search: target.sessionKey, agentId: target.agentId ?? undefined, limit: 5 },
      { ...gatewayOptions, allowCliFallback: false, timeoutMs: 5_000 });
    if (!sessions.some((session) => session.key === target.sessionKey && session.sessionId === target.sessionId)) {
      throw new Error("The OpenClaw task session changed. Reopen the task before sending.");
    }
  }

  if (input.action === "message") {
    try {
      const control = await steerSession(adapter, target, message, { ...input, taskSessionOnly: true },
        taskDetail.task.id, gatewayOptions);
      // A missing native acknowledgement cannot establish whether the input ran.
      if (!control.result.runId) throw new TaskMessageDeliveryUnknown();
      (deps.invalidateMissionControlSnapshotCache ?? invalidateMissionControlSnapshotCache)();
      return { ok: true, action: input.action, taskId: taskDetail.task.id, target, ...control };
    } catch (error) {
      if (error instanceof TaskMessageDeliveryUnknown ||
          classifyNativeMutationError(error).disposition === "ambiguous-outcome") {
        throw new TaskMessageDeliveryUnknown("OpenClaw did not confirm delivery. Check this conversation before sending again.");
      }
      throw error;
    }
  }

  if (input.action === "continue") {
    const result = await continueTaskSession(taskDetail, target, message, input, adapter, deps, gatewayOptions);
    const warning = resolveContinuationWarning(target);

    (deps.invalidateMissionControlSnapshotCache ?? invalidateMissionControlSnapshotCache)();

    return {
      ok: true,
      action: input.action,
      taskId: taskDetail.task.id,
      target,
      result,
      warning
    };
  }

  if (!isTaskControlAvailable(taskDetail)) {
    throw new Error("Task is not currently running.");
  }

  if (!target.sessionKey && !target.sessionId) {
    throw new Error("Task does not expose an active OpenClaw session.");
  }

  const control =
    input.action === "steer"
      ? await steerSession(adapter, target, message, input, taskDetail.task.id, gatewayOptions)
      : {
          result: await adapter.injectChat(
            {
              sessionKey: target.sessionKey,
              sessionId: target.sessionKey ? null : target.sessionId,
              agentId: target.agentId,
              message
            },
            { ...gatewayOptions, timeoutMs: 10000 }
          ),
          transport: {
            requestedMethod: "chat.inject",
            actualMethod: "chat.inject",
            fallback: "none" as const,
            reason: null
          }
        };

  (deps.invalidateMissionControlSnapshotCache ?? invalidateMissionControlSnapshotCache)();

  return {
    ok: true,
    action: input.action,
    taskId: taskDetail.task.id,
    target,
    result: control.result,
    transport: control.transport
  };
}

async function steerSession(
  adapter: TaskControlAdapter,
  target: RunningTaskControlTarget,
  message: string,
  input: RunningTaskControlInput,
  taskId: string,
  gatewayOptions: OpenClawCommandOptions
) {
  const result = await adapter.steerSession(
    {
      key: target.sessionKey,
      sessionId: input.taskSessionOnly || !target.sessionKey ? target.sessionId : null,
      agentId: target.agentId,
      message,
      ...(input.action === "message" ? { queueMode: "followup" as const } : {}),
      idempotencyKey: resolveControlIdempotencyKey({
        taskId,
        dispatchId: input.dispatchId ?? null,
        runId: target.runId,
        inputKey: input.idempotencyKey,
        message
      })
    },
    { ...gatewayOptions, timeoutMs: 10000 }
  );

  return {
    result,
    transport: {
      requestedMethod: "chat.send",
      actualMethod: "chat.send",
      fallback: "none" as const,
      reason: null
    }
  };
}

async function continueTaskSession(
  taskDetail: TaskDetailRecord,
  target: RunningTaskControlTarget,
  message: string,
  input: RunningTaskControlInput,
  adapter: TaskControlAdapter,
  deps: TaskControlDeps,
  gatewayOptions: OpenClawCommandOptions
) {
  if (target.confidence === "none") {
    throw new Error("Task continuation is disabled because AgentOS could not resolve a trusted OpenClaw session context.");
  }

  if (!target.agentId) {
    throw new Error("Task does not expose an OpenClaw agent.");
  }

  if (!adapter.runAgentTurn) {
    throw new Error("Task continuation requires OpenClaw mission dispatch support.");
  }

  if (!target.sessionKey && !target.sessionId) {
    throw new Error("Task continuation requires an existing OpenClaw session context.");
  }

  const snapshot = await (deps.getMissionControlSnapshot ?? getMissionControlSnapshot)({
    includeHidden: true
  }).catch(() => null);
  const dispatchId = taskDetail.task.dispatchId ?? null;
  const agent = snapshot?.agents.find((entry) => entry.id === target.agentId);
  const thinking = resolveBalancedTaskThinking(findTaskReasoningModel(snapshot?.models ?? [], agent?.modelId));
  const idempotencyKey = resolveContinuationIdempotencyKey({
    taskId: taskDetail.task.id,
    dispatchId,
    inputKey: input.idempotencyKey,
    message
  });
  const result = await adapter.runAgentTurn(
    {
      agentId: target.agentId,
      sessionKey: target.sessionKey ?? undefined,
      sessionId: target.sessionId ?? undefined,
      message,
      thinking,
      timeoutSeconds: 45,
      workspace: resolveTaskWorkspacePath(taskDetail, snapshot),
      dispatchId,
      idempotencyKey,
      admissionOnly: true,
      sessionAlreadyPrepared: true
    },
    { ...gatewayOptions, timeoutMs: 30_000, allowCliFallback: false }
  );

  return result as Record<string, unknown>;
}

function resolveContinuationWarning(target: RunningTaskControlTarget) {
  return target.confidence === "medium"
    ? "AgentOS resolved this continuation from runtime-derived OpenClaw session metadata. Verify the target session if the task context looks unexpected."
    : null;
}

function resolveRunningTaskControlTarget(taskDetail: TaskDetailRecord): RunningTaskControlTarget {
  const task = taskDetail.task;
  const activeRun = taskDetail.runs.find((run) => isControllableStatus(run.status)) ?? taskDetail.runs[0] ?? null;
  const executionIdentity = readExecutionIdentity(task.metadata.executionIdentity);
  const followUpContext = resolveTaskFollowUpContext(task);
  const agentId =
    executionIdentity?.agentId ||
    followUpContext.agentId ||
    activeRun?.agentId?.trim() ||
    task.primaryAgentId?.trim() ||
    firstNonEmpty(task.agentIds) ||
    null;
  const sessionId =
    executionIdentity?.sessionId ||
    followUpContext.sessionId ||
    readMetadataString(activeRun?.metadata, "openClawSessionId") ||
    readMetadataString(activeRun?.metadata, "sessionId") ||
    readMetadataString(activeRun?.metadata, "gatewaySessionId") ||
    normalizeSessionId(activeRun?.sessionId) ||
    normalizeSessionId(firstNonEmpty(task.sessionIds)) ||
    readMetadataString(task.metadata, "sessionId") ||
    readMetadataString(task.metadata, "gatewaySessionId") ||
    readMetadataString(task.metadata, "openClawSessionId") ||
    null;
  const explicitSessionKey =
    executionIdentity?.sessionKey ||
    followUpContext.sessionKey ||
    readMetadataString(task.metadata, "continuationSessionKey") ||
    readMetadataString(task.metadata, "openClawSessionKey") ||
    readMetadataString(task.metadata, "sessionKey") ||
    readMetadataString(task.metadata, "gatewaySessionKey") ||
    readMetadataString(activeRun?.metadata, "openClawSessionKey") ||
    readMetadataString(activeRun?.metadata, "sessionKey") ||
    readMetadataString(activeRun?.metadata, "gatewaySessionKey") ||
    (activeRun?.key.trim().startsWith("agent:") ? activeRun.key.trim() : null);
  const sessionKey = explicitSessionKey ?? resolveSessionKey(agentId, sessionId);
  const runId = executionIdentity?.runId || activeRun?.runId?.trim() || firstNonEmpty(task.runIds) || null;
  const provenance = executionIdentity?.provenance ?? followUpContext.provenance;
  const confidence = executionIdentity
    ? executionIdentity.provenance === "authoritative"
      ? "high"
      : executionIdentity.provenance === "correlated"
        ? "medium"
        : "none"
    : followUpContext.confidence;

  return {
    agentId,
    sessionId,
    sessionKey,
    runId,
    openClawTaskId: followUpContext.openClawTaskId,
    provenance,
    confidence
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

function readMetadataString(metadata: Record<string, unknown> | null | undefined, key: string) {
  if (!metadata) {
    return null;
  }

  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeSessionId(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized || normalized.startsWith("agent:")) {
    return null;
  }

  return normalized;
}

function resolveContinuationIdempotencyKey(input: {
  taskId: string;
  dispatchId: string | null;
  inputKey?: string | null;
  message: string;
}) {
  const normalizedInputKey = input.inputKey?.trim();
  if (normalizedInputKey) {
    return normalizedInputKey;
  }

  const stableSource = `${input.taskId}\n${input.dispatchId ?? ""}\n${input.message}`;
  const digest = createHash("sha256").update(stableSource).digest("hex").slice(0, 20);
  return `${input.dispatchId || input.taskId}:continue:${digest}`;
}

function resolveControlIdempotencyKey(input: {
  taskId: string;
  dispatchId: string | null;
  runId: string | null;
  inputKey?: string | null;
  message: string;
}) {
  const normalizedInputKey = input.inputKey?.trim();
  if (normalizedInputKey) {
    return normalizedInputKey;
  }

  const stableSource = `${input.taskId}\n${input.dispatchId ?? ""}\n${input.runId ?? ""}\n${input.message}`;
  const digest = createHash("sha256").update(stableSource).digest("hex").slice(0, 20);
  return `${input.dispatchId || input.taskId}:control:${digest}`;
}
