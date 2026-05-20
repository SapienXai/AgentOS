import {
  composeMissionWithOutputRouting,
  prepareMissionOutputPlan
} from "@/lib/openclaw/domains/mission-routing";
import { stringifyCommandFailure } from "@/lib/openclaw/command-failure";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { getOpenClawCapabilityMatrix } from "@/lib/openclaw/application/capability-matrix-service";
import { renderWorkspaceSurfaceCoordinationMarkdownForAgent } from "@/lib/openclaw/surface-coordination";
import {
  createMissionDispatchRecord,
  findMissionDispatchRecordForTask,
  isMissionDispatchTerminalStatus,
  launchMissionDispatchRunner,
  normalizeMissionAbortReason,
  readMissionDispatchRecordById,
  stopMissionDispatchChildProcess,
  writeMissionDispatchRecord
} from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import { resolveMissionDispatchCompletionDetail } from "@/lib/openclaw/domains/mission-dispatch-model";
import { resolveMissionDispatchReadinessError } from "@/lib/openclaw/readiness";
import type { MissionAbortResponse, MissionControlSnapshot, MissionResponse, MissionSubmission } from "@/lib/openclaw/types";

export type MissionDispatchWorkflowDependencies = {
  getMissionControlSnapshot: (options?: { force?: boolean; includeHidden?: boolean }) => Promise<MissionControlSnapshot>;
  resolveAgentForMission: (snapshot: MissionControlSnapshot, workspaceId?: string) => string | null;
  invalidateMissionControlCaches: () => void;
};

export async function submitMissionDispatch(
  input: MissionSubmission,
  deps: MissionDispatchWorkflowDependencies
): Promise<MissionResponse> {
  const mission = input.mission.trim();

  if (!mission) {
    throw new Error("Mission text is required.");
  }

  const snapshot = await deps.getMissionControlSnapshot({ includeHidden: true });
  const agentId = input.agentId || deps.resolveAgentForMission(snapshot, input.workspaceId);

  if (!agentId) {
    throw new Error("No OpenClaw agent is available for mission dispatch.");
  }

  const missionAgent = snapshot.agents.find((entry) => entry.id === agentId);
  const missionWorkspace =
    snapshot.workspaces.find((entry) => entry.id === (input.workspaceId || missionAgent?.workspaceId)) ??
    (missionAgent
      ? {
          id: missionAgent.workspaceId,
          path: missionAgent.workspacePath
        }
      : null);
  const workspaceAgents = missionWorkspace
    ? snapshot.agents.filter((entry) => entry.workspaceId === missionWorkspace.id)
    : [];
  const setupAgentId =
    workspaceAgents.find((entry) => entry.policy.preset === "setup" && entry.id !== missionAgent?.id)?.id ?? null;
  const outputPlan = missionWorkspace
    ? await prepareMissionOutputPlan(missionWorkspace.path, mission)
    : null;
  const thinking = input.thinking ?? "medium";
  const workspaceSurfacePrompt = renderWorkspaceSurfaceCoordinationMarkdownForAgent(agentId, snapshot);
  const routedMission = outputPlan
    ? composeMissionWithOutputRouting(
        mission,
        outputPlan,
        missionAgent?.policy,
        setupAgentId,
        workspaceSurfacePrompt,
        missionAgent ? { id: missionAgent.id, name: missionAgent.name } : null
      )
    : mission;
  const readinessError = resolveMissionDispatchReadinessError(snapshot);

  let dispatchRecord = createMissionDispatchRecord({
    agentId,
    mission,
    routedMission,
    thinking,
    workspaceId: missionWorkspace?.id ?? null,
    workspacePath: missionWorkspace?.path ?? null,
    outputDir: outputPlan?.absoluteOutputDir ?? null,
    outputDirRelative: outputPlan?.relativeOutputDir ?? null,
    notesDirRelative: outputPlan?.notesDirRelative ?? null
  });

  await writeMissionDispatchRecord(dispatchRecord);

  if (readinessError) {
    dispatchRecord = {
      ...dispatchRecord,
      status: "stalled",
      updatedAt: new Date().toISOString(),
      error: readinessError
    };
    await writeMissionDispatchRecord(dispatchRecord);
    deps.invalidateMissionControlCaches();

    return {
      dispatchId: dispatchRecord.id,
      runId: null,
      agentId,
      status: dispatchRecord.status,
      summary: readinessError,
      payloads: [],
      meta: {
        outputDir: outputPlan?.absoluteOutputDir,
        outputDirRelative: outputPlan?.relativeOutputDir,
        notesDirRelative: outputPlan?.notesDirRelative
      }
    };
  }

  try {
    const capabilityMatrix = await getOpenClawCapabilityMatrix().catch(() => null);

    if (capabilityMatrix?.nativeMissionDispatch !== "unsupported") {
      const payload = await getOpenClawAdapter().runAgentTurn(
        {
          agentId,
          sessionId: dispatchRecord.sessionId ?? undefined,
          message: routedMission,
          thinking,
          timeoutSeconds: 45,
          workspace: missionWorkspace?.path ?? null,
          dispatchId: dispatchRecord.id
        },
        { timeoutMs: 60_000 }
      );
      const now = new Date().toISOString();
      dispatchRecord = {
        ...dispatchRecord,
        status: payload.status === "completed" ? "completed" : payload.status === "stalled" ? "stalled" : "running",
        updatedAt: now,
        runner: {
          ...dispatchRecord.runner,
          startedAt: now,
          finishedAt: payload.status === "completed" || payload.status === "stalled" ? now : null,
          lastHeartbeatAt: now
        },
        observation: {
          runtimeId: payload.runId ? `runtime:gateway:${payload.runId}` : dispatchRecord.observation.runtimeId,
          observedAt: now
        },
        result: payload,
        error: payload.status === "stalled" ? payload.summary ?? "OpenClaw Gateway dispatch stalled." : null
      };
      await writeMissionDispatchRecord(dispatchRecord);
    } else {
      dispatchRecord = await launchMissionDispatchRunner(dispatchRecord);
    }
  } catch (error) {
    dispatchRecord = {
      ...dispatchRecord,
      status: "stalled",
      updatedAt: new Date().toISOString(),
      error: stringifyCommandFailure(error) || "Mission dispatch runner could not be started."
    };
    await writeMissionDispatchRecord(dispatchRecord);
    deps.invalidateMissionControlCaches();
    throw new Error(dispatchRecord.error ?? "Mission dispatch runner could not be started.");
  }

  deps.invalidateMissionControlCaches();

  return {
    dispatchId: dispatchRecord.id,
    runId: dispatchRecord.result?.runId ?? null,
    agentId,
    status: dispatchRecord.status,
    summary: "Mission accepted and queued for OpenClaw execution.",
    payloads: [],
    meta: {
      outputDir: outputPlan?.absoluteOutputDir,
      outputDirRelative: outputPlan?.relativeOutputDir,
      notesDirRelative: outputPlan?.notesDirRelative
    }
  };
}

export async function abortMissionDispatchTask(
  taskId: string,
  reason: string | null | undefined,
  dispatchId: string | null | undefined,
  deps: MissionDispatchWorkflowDependencies
): Promise<MissionAbortResponse> {
  const snapshot = await deps.getMissionControlSnapshot({ includeHidden: true });
  const task = snapshot.tasks.find((entry) => entry.id === taskId);
  const dispatchRecord = task
    ? await findMissionDispatchRecordForTask(task)
    : dispatchId
      ? await readMissionDispatchRecordById(dispatchId)
      : null;

  if (!task && !dispatchRecord) {
    throw new Error("Task was not found in the current OpenClaw snapshot.");
  }

  if (!dispatchRecord) {
    return abortNativeGatewayTask(task, taskId, reason, deps);
  }

  if (isMissionDispatchTerminalStatus(dispatchRecord.status)) {
    return {
      taskId,
      dispatchId: dispatchRecord.id,
      status: dispatchRecord.status,
      summary: resolveMissionDispatchCompletionDetail(dispatchRecord),
      reason: dispatchRecord.error,
      runnerPid: dispatchRecord.runner.pid,
      childPid: dispatchRecord.runner.childPid,
      abortedAt: dispatchRecord.runner.finishedAt ?? dispatchRecord.updatedAt
    };
  }

  const abortedAt = new Date().toISOString();
  const abortReason = normalizeMissionAbortReason(reason);
  const nextRecord = {
    ...dispatchRecord,
    status: "cancelled" as const,
    updatedAt: abortedAt,
    error: abortReason,
    runner: {
      ...dispatchRecord.runner,
      finishedAt: abortedAt,
      lastHeartbeatAt: abortedAt
    }
  };

  await writeMissionDispatchRecord(nextRecord);
  deps.invalidateMissionControlCaches();

  let killedChildPid: number | null = null;
  const runId = dispatchRecord.result?.runId ?? null;
  const adapter = getOpenClawAdapter();

  for (const gatewayTaskId of resolveGatewayTaskCancelIds(task, dispatchRecord)) {
    await adapter.cancelTask({
      taskId: gatewayTaskId,
      reason: abortReason
    }, { timeoutMs: 15_000 }).catch(() => null);
  }

  if (runId || dispatchRecord.sessionId) {
    await adapter.abortAgentTurn({
      runId,
      sessionId: dispatchRecord.sessionId,
      agentId: dispatchRecord.agentId,
      reason: abortReason
    }, { timeoutMs: 15_000 }).catch(() => null);
  }

  killedChildPid = await stopMissionDispatchChildProcess(nextRecord);

  return {
    taskId,
    dispatchId: nextRecord.id,
    status: nextRecord.status,
    summary: abortReason,
    reason: abortReason,
    runnerPid: nextRecord.runner.pid,
    childPid: killedChildPid ?? nextRecord.runner.childPid,
    abortedAt
  };
}

function resolveGatewayTaskCancelIds(
  task: MissionControlSnapshot["tasks"][number] | undefined,
  dispatchRecord: { id: string; result?: Record<string, unknown> | null } | null
) {
  const candidates = [
    readGatewayTaskId(dispatchRecord?.result),
    readGatewayTaskId(dispatchRecord?.result?.task),
    readGatewayTaskId(task?.metadata),
    task?.metadata.gatewayObjectKind === "task" ? task.metadata.taskId : null,
    task?.metadata.gatewayObjectKind === "task" ? task?.key : null
  ];
  const unique = new Set<string>();

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() && candidate !== dispatchRecord?.id) {
      unique.add(candidate.trim());
    }
  }

  return [...unique];
}

async function abortNativeGatewayTask(
  task: MissionControlSnapshot["tasks"][number] | undefined,
  taskId: string,
  reason: string | null | undefined,
  deps: MissionDispatchWorkflowDependencies
): Promise<MissionAbortResponse> {
  if (!task) {
    throw new Error("Task was not found in the current OpenClaw snapshot.");
  }

  if (task.status === "completed" || task.status === "stalled" || task.status === "cancelled") {
    return {
      taskId,
      dispatchId: null,
      status: task.status,
      summary: task.subtitle || "Task is already terminal.",
      reason: null,
      runnerPid: null,
      childPid: null,
      abortedAt: new Date().toISOString()
    };
  }

  const abortReason = normalizeMissionAbortReason(reason);
  const gatewayTaskIds = resolveGatewayTaskCancelIds(task, null);

  if (gatewayTaskIds.length === 0) {
    throw new Error("Mission dispatch record was not found and the task does not expose a Gateway task id.");
  }

  for (const gatewayTaskId of gatewayTaskIds) {
    await getOpenClawAdapter().cancelTask({
      taskId: gatewayTaskId,
      reason: abortReason
    }, { timeoutMs: 15_000 });
  }

  deps.invalidateMissionControlCaches();

  return {
    taskId,
    dispatchId: null,
    status: "cancelled",
    summary: abortReason,
    reason: abortReason,
    runnerPid: null,
    childPid: null,
    abortedAt: new Date().toISOString()
  };
}

function readGatewayTaskId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const taskId =
    record.gatewayTaskId ??
    record.openClawTaskId ??
    record.taskId ??
    record.id;

  return typeof taskId === "string" && taskId.trim() ? taskId.trim() : null;
}
