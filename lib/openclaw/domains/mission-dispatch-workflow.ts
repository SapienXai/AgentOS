import {
  composeMissionWithOutputRouting,
  prepareMissionOutputPlan
} from "@/lib/openclaw/domains/mission-routing";
import { stringifyCommandFailure } from "@/lib/openclaw/command-failure";
import { classifyNativeMutationError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { getOpenClawCapabilityMatrix } from "@/lib/openclaw/application/capability-matrix-service";
import { renderWorkspaceSurfaceCoordinationMarkdownForAgent } from "@/lib/openclaw/surface-coordination";
import {
  createMissionDispatchRecord,
  findMissionDispatchRecordForTask,
  isMissionDispatchTerminalStatus,
  normalizeMissionAbortReason,
  readMissionDispatchRecords,
  readMissionDispatchRecordById,
  stopMissionDispatchChildProcess,
  writeMissionDispatchRecord
} from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import type { MissionDispatchRecord } from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import {
  extractMissionCommandPayloads,
  resolveMissionDispatchCompletionDetail
} from "@/lib/openclaw/domains/mission-dispatch-model";
import type { MissionDispatchRecordLike } from "@/lib/openclaw/domains/mission-dispatch-model";
import { resolveMissionDispatchReadinessError } from "@/lib/openclaw/readiness";
import type {
  MissionAbortResponse,
  MissionControlSnapshot,
  MissionDispatchStatus,
  MissionResponse,
  MissionSubmission
} from "@/lib/openclaw/types";
import {
  finalizeBrowserTaskBinding,
  prepareBrowserTaskBinding
} from "@/lib/agentos/application/browser-task-binding-service";
import type { OpenClawCommandOptions } from "@/lib/openclaw/client/types";
import { buildAgentSessionKey } from "@/lib/openclaw/client/native-ws-gateway-mappers";
import {
  capabilityState,
  resolveIsolatedWorktreeEligibility,
  type NativeWorkExecutionMode
} from "@/lib/openclaw/domains/native-work-model";

export type MissionDispatchWorkflowDependencies = {
  getMissionControlSnapshot: (options?: { force?: boolean; includeHidden?: boolean }) => Promise<MissionControlSnapshot>;
  resolveAgentForMission: (snapshot: MissionControlSnapshot, workspaceId?: string) => string | null;
  invalidateMissionControlCaches: () => void;
};

let missionSubmissionQueue: Promise<void> = Promise.resolve();

export async function submitMissionDispatch(
  input: MissionSubmission,
  deps: MissionDispatchWorkflowDependencies,
  gatewayOptions: OpenClawCommandOptions = {}
): Promise<MissionResponse> {
  const run = missionSubmissionQueue.then(() => submitMissionDispatchOnce(input, deps, gatewayOptions));
  missionSubmissionQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function submitMissionDispatchOnce(
  input: MissionSubmission,
  deps: MissionDispatchWorkflowDependencies,
  gatewayOptions: OpenClawCommandOptions
): Promise<MissionResponse> {
  const mission = input.mission.trim();
  const executionMode: NativeWorkExecutionMode = input.executionMode ?? "standard";

  if (!mission) {
    throw new Error("Mission text is required.");
  }

  const snapshot = await deps.getMissionControlSnapshot({ includeHidden: true });
  const requestId = input.requestId?.trim() || null;
  if (requestId) {
    const existing = (await readMissionDispatchRecords()).find((record) => record.clientRequestId === requestId) ?? null;
    if (existing) {
      const visibleSnapshot = await deps.getMissionControlSnapshot({ includeHidden: false });
      const visible = Boolean(
        visibleSnapshot.agents.some((agent) => agent.id === existing.agentId) ||
        (existing.workspaceId && visibleSnapshot.workspaces.some((workspace) => workspace.id === existing.workspaceId))
      );
      if (!visible || (input.workspaceId && input.workspaceId !== existing.workspaceId) || (input.agentId && input.agentId !== existing.agentId) || existing.mission !== mission) {
        throw new Error("This mission request identity is already in use.");
      }
      return missionResponseFromDispatchRecord(existing);
    }
  }
  const agentId = input.agentId || deps.resolveAgentForMission(snapshot, input.workspaceId);

  if (!agentId) {
    throw new Error(
      "No OpenClaw agent is available for mission dispatch. Finish OpenClaw setup, create a workspace, then create or select an agent."
    );
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
  if (
    input.browserAccount &&
    (
      !missionAgent ||
      !missionWorkspace ||
      missionAgent.workspaceId !== missionWorkspace.id
    )
  ) {
    throw new Error(
      "The selected agent must belong to the browser account workspace."
    );
  }
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
  const readinessError = resolveMissionDispatchReadinessError(
    snapshot,
    missionAgent?.modelId === "unassigned" ? null : missionAgent?.modelId
  );

  let dispatchRecord = createMissionDispatchRecord({
    clientRequestId: requestId,
    agentId,
    mission,
    routedMission,
    thinking,
    requestedModelId: missionAgent?.modelId && missionAgent.modelId !== "unassigned" ? missionAgent.modelId : null,
    workspaceId: missionWorkspace?.id ?? null,
    workspacePath: missionWorkspace?.path ?? null,
    outputDir: outputPlan?.absoluteOutputDir ?? null,
    outputDirRelative: outputPlan?.relativeOutputDir ?? null,
    notesDirRelative: outputPlan?.notesDirRelative ?? null,
    executionMode
  });

  const sessionKey = executionMode === "standard"
    ? buildAgentSessionKey(agentId, dispatchRecord.id)
    : null;
  if (sessionKey) {
    dispatchRecord = { ...dispatchRecord, sessionKey };
  }

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
        executionMode,
        outputDir: outputPlan?.absoluteOutputDir,
        outputDirRelative: outputPlan?.relativeOutputDir,
        notesDirRelative: outputPlan?.notesDirRelative
      }
    };
  }

  let admissionMutationStarted = false;
  let admissionConfirmed = false;
  try {
    const capabilityMatrix = await getOpenClawCapabilityMatrix().catch(() => null);

    if (input.browserAccount && capabilityMatrix?.nativeMissionDispatch !== "supported") {
      throw new Error(
        "Secure browser account tasks require native OpenClaw Gateway mission dispatch. CLI fallback is disabled for task-bound browser profiles."
      );
    }

    if (executionMode === "isolated-worktree") {
      if (input.browserAccount) {
        throw new Error("Isolated worktree execution is unavailable for secure browser account missions.");
      }
      const adapter = getOpenClawAdapter();
      if (!adapter.inspectWorktreeBranches || !adapter.createSession) {
        throw new Error("OpenClaw native worktree session methods are unavailable; standard execution was not selected automatically.");
      }
      const repository = await adapter.inspectWorktreeBranches(
        { repoRoot: missionWorkspace?.path ?? "", includeRepositoryStatus: true },
        { ...gatewayOptions, timeoutMs: 15_000 }
      );
      const eligibility = resolveIsolatedWorktreeEligibility({
        requestedMode: executionMode,
        workspacePath: missionWorkspace?.path ?? null,
        worktreesCapability: capabilityState(capabilityMatrix, "worktrees"),
        repositoryStatus: repository.repositoryStatus ?? null
      });
      if (!eligibility.eligible) {
        throw new Error(`${eligibility.reason} Standard execution was not selected automatically.`);
      }
      admissionMutationStarted = true;
      const created = await adapter.createSession(
        {
          agentId,
          task: routedMission,
          cwd: missionWorkspace!.path,
          worktree: true,
          idempotencyKey: dispatchRecord.id,
          label: mission.slice(0, 60)
        },
        { ...gatewayOptions, timeoutMs: 60_000 }
      );
      admissionConfirmed = true;
      const now = new Date().toISOString();
      const createdStatus: MissionDispatchStatus = created.status === "completed"
        ? "completed"
        : created.status === "error" ? "stalled" : "running";
      dispatchRecord = {
        ...dispatchRecord,
        sessionId: created.sessionId ?? dispatchRecord.sessionId,
        sessionKey: created.key ?? created.sessionKey ?? dispatchRecord.sessionKey,
        admissionState: createdStatus === "stalled" ? "rejected" : "accepted",
        status: createdStatus,
        updatedAt: now,
        runner: {
          ...dispatchRecord.runner,
          startedAt: now,
          finishedAt: createdStatus === "completed" ? now : null,
          lastHeartbeatAt: now
        },
        observation: {
          runtimeId: created.runId ? `runtime:gateway:${created.runId}` : dispatchRecord.observation.runtimeId,
          observedAt: now
        },
        result: {
          runId: created.runId,
          sessionKey: created.key ?? created.sessionKey,
          sessionId: created.sessionId,
          status: createdStatus,
          summary: createdStatus === "running" ? "Isolated worktree session accepted by OpenClaw." : "Isolated worktree session completed.",
          payloads: [],
          meta: { executionMode, worktree: created.worktree ?? null }
        },
        error: createdStatus === "stalled" ? "OpenClaw could not start the isolated worktree session." : null
      };
      await writeMissionDispatchRecord(dispatchRecord);
    }

    if (input.browserAccount) {
      const binding = await prepareBrowserTaskBinding({
        request: input.browserAccount,
        workspaceId: missionWorkspace?.id ?? input.workspaceId ?? "",
        agentId,
        dispatchId: dispatchRecord.id,
        openClawSessionKey: sessionKey ?? buildAgentSessionKey(agentId),
        openClawSessionId: null
      });
      dispatchRecord = {
        ...dispatchRecord,
        browserBinding: {
          accountId: binding.accountId,
          profileName: binding.profileName,
          status: "active",
          expiresAt: binding.expiresAt,
          releasedAt: null
        },
        updatedAt: new Date().toISOString()
      };
      await writeMissionDispatchRecord(dispatchRecord);
    }

    if (executionMode === "standard") {
      const adapter = getOpenClawAdapter();
      if (!sessionKey || !adapter.createSession) {
        throw new Error("OpenClaw independent session creation is unavailable. The task was not sent to the agent's shared session.");
      }

      admissionMutationStarted = true;
      const createdSession = await adapter.createSession(
        {
          agentId,
          key: sessionKey,
          idempotencyKey: dispatchRecord.id,
          label: mission.slice(0, 60)
        },
        { ...gatewayOptions, timeoutMs: 30_000, allowCliFallback: false }
      );
      const canonicalSessionKey = createdSession.key?.trim() || createdSession.sessionKey?.trim() || sessionKey;
      dispatchRecord = {
        ...dispatchRecord,
        sessionKey: canonicalSessionKey,
        admissionState: "session-created",
        sessionId: createdSession.sessionId ?? dispatchRecord.sessionId,
        updatedAt: new Date().toISOString()
      };
      await writeMissionDispatchRecord(dispatchRecord);

      const payload = await adapter.runAgentTurn(
        {
          agentId,
          sessionKey: canonicalSessionKey,
          sessionId: dispatchRecord.sessionId ?? undefined,
          message: routedMission,
          thinking,
          timeoutSeconds: 45,
          workspace: missionWorkspace?.path ?? null,
          dispatchId: dispatchRecord.id,
          idempotencyKey: dispatchRecord.id,
          admissionOnly: true,
          sessionAlreadyPrepared: true
        },
        { ...gatewayOptions, timeoutMs: 30_000, allowCliFallback: false }
      );
      admissionConfirmed = true;
      const now = new Date().toISOString();
      const nextStatus = resolveGatewayMissionDispatchStatus(payload.status);
      dispatchRecord = {
        ...dispatchRecord,
        sessionId: payload.sessionId ?? dispatchRecord.sessionId,
        sessionKey: payload.sessionKey ?? canonicalSessionKey,
        admissionState: nextStatus === "stalled" ? "rejected" : "accepted",
        status: nextStatus,
        updatedAt: now,
        runner: {
          ...dispatchRecord.runner,
          startedAt: now,
          finishedAt: nextStatus === "completed" || nextStatus === "stalled" ? now : null,
          lastHeartbeatAt: now
        },
        observation: {
          runtimeId: payload.runId ? `runtime:gateway:${payload.runId}` : dispatchRecord.observation.runtimeId,
          observedAt: now
        },
        result: {
          ...payload,
          sessionKey: payload.sessionKey ?? canonicalSessionKey
        },
        error: nextStatus === "stalled" ? resolveGatewayMissionDispatchError(payload) : null
      };
      await writeMissionDispatchRecord(dispatchRecord);

      if (isMissionDispatchTerminalStatus(dispatchRecord.status) && dispatchRecord.browserBinding) {
        dispatchRecord = await finalizeDispatchBrowserBinding(dispatchRecord);
      }
    }
  } catch (error) {
    if (dispatchRecord.browserBinding?.status === "active") {
      dispatchRecord = await finalizeDispatchBrowserBinding(dispatchRecord).catch(() => ({
        ...dispatchRecord,
        browserBinding: {
          ...dispatchRecord.browserBinding!,
          status: "recovery_required" as const,
          releasedAt: new Date().toISOString()
        }
      }));
    }
    const message = stringifyCommandFailure(error) || "OpenClaw task admission could not be confirmed.";
    const admissionUnknown = admissionMutationStarted && !admissionConfirmed &&
      classifyNativeMutationError(error).disposition === "ambiguous-outcome";
    dispatchRecord = {
      ...dispatchRecord,
      status: admissionUnknown ? "queued" : (admissionConfirmed ? dispatchRecord.status : "stalled"),
      admissionState: admissionUnknown ? "unknown" : admissionConfirmed
        ? dispatchRecord.admissionState ?? "accepted"
        : "rejected",
      updatedAt: new Date().toISOString(),
      error: admissionConfirmed
        ? dispatchRecord.error
        : admissionUnknown
          ? `OpenClaw admission is unconfirmed. Refresh to reconcile before retrying. ${message}`
          : message
    };
    await writeMissionDispatchRecord(dispatchRecord);
    deps.invalidateMissionControlCaches();
    return missionResponseFromDispatchRecord(dispatchRecord);
  }

  deps.invalidateMissionControlCaches();

  const payloads = extractMissionCommandPayloads(dispatchRecord.result);
  const summary = dispatchRecord.error || (
    dispatchRecord.status === "completed" || dispatchRecord.status === "stalled" || dispatchRecord.status === "cancelled"
      ? resolveMissionDispatchCompletionDetail(dispatchRecord)
      : dispatchRecord.result?.summary || "Task accepted by OpenClaw."
  );

  return {
    dispatchId: dispatchRecord.id,
    runId: dispatchRecord.result?.runId ?? null,
    agentId,
    status: dispatchRecord.status,
    summary,
    payloads,
    meta: {
      executionMode,
      admissionState: dispatchRecord.admissionState ?? "unknown",
      sessionKey: dispatchRecord.sessionKey ?? dispatchRecord.result?.sessionKey ?? null,
      outputDir: outputPlan?.absoluteOutputDir,
      outputDirRelative: outputPlan?.relativeOutputDir,
      notesDirRelative: outputPlan?.notesDirRelative
    }
  };
}

function missionResponseFromDispatchRecord(dispatchRecord: MissionDispatchRecord): MissionResponse {
  const payloads = extractMissionCommandPayloads(dispatchRecord.result);
  const summary = dispatchRecord.error || (
    dispatchRecord.status === "completed" || dispatchRecord.status === "stalled" || dispatchRecord.status === "cancelled"
      ? resolveMissionDispatchCompletionDetail(dispatchRecord)
      : dispatchRecord.result?.summary || "Task accepted by OpenClaw."
  );
  return {
    dispatchId: dispatchRecord.id,
    runId: dispatchRecord.result?.runId ?? null,
    agentId: dispatchRecord.agentId,
    status: dispatchRecord.status,
    summary,
    payloads,
    meta: {
      executionMode: dispatchRecord.executionMode,
      admissionState: dispatchRecord.admissionState ?? "unknown",
      sessionKey: dispatchRecord.sessionKey ?? dispatchRecord.result?.sessionKey ?? null,
      outputDir: dispatchRecord.outputDir,
      outputDirRelative: dispatchRecord.outputDirRelative,
      notesDirRelative: dispatchRecord.notesDirRelative,
      idempotentReplay: true
    }
  };
}

export async function abortMissionDispatchTask(
  taskId: string,
  reason: string | null | undefined,
  dispatchId: string | null | undefined,
  deps: MissionDispatchWorkflowDependencies,
  gatewayOptions: OpenClawCommandOptions = {}
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
    return abortNativeGatewayTask(task, taskId, reason, deps, gatewayOptions);
  }

  if (isMissionDispatchTerminalStatus(dispatchRecord.status)) {
    const terminalRecord =
      dispatchRecord.browserBinding?.status === "active"
        ? await finalizeDispatchBrowserBinding(dispatchRecord)
        : dispatchRecord;
    return {
      taskId,
      dispatchId: terminalRecord.id,
      status: terminalRecord.status,
      summary: resolveMissionDispatchCompletionDetail(terminalRecord),
      reason: terminalRecord.error,
      runnerPid: terminalRecord.runner.pid,
      childPid: terminalRecord.runner.childPid,
      abortedAt: terminalRecord.runner.finishedAt ?? terminalRecord.updatedAt,
      ...(terminalRecord.status === "cancelled" ? { cancellationStatus: "confirmed" as const } : {})
    };
  }

  const abortedAt = new Date().toISOString();
  const abortReason = normalizeMissionAbortReason(reason);
  let nextRecord: MissionDispatchRecord = {
    ...dispatchRecord,
    updatedAt: abortedAt,
    cancellation: {
      status: "requested",
      requestedAt: abortedAt,
      confirmedAt: null,
      reason: abortReason,
      detail: null
    }
  };

  await writeMissionDispatchRecord(nextRecord);
  deps.invalidateMissionControlCaches();

  let killedChildPid: number | null = null;
  let confirmed = false;
  const failures: string[] = [];
  const runId = dispatchRecord.result?.runId ?? null;
  const adapter = getOpenClawAdapter();

  for (const gatewayTaskId of resolveGatewayTaskCancelIds(task, dispatchRecord)) {
    try {
      const result = await adapter.cancelTask({
        taskId: gatewayTaskId,
        reason: abortReason
      }, { ...gatewayOptions, timeoutMs: 15_000, allowCliFallback: false });
      confirmed ||= isMissionAbortConfirmed(result);
    } catch (error) {
      failures.push(stringifyCommandFailure(error));
    }
  }

  const sessionKey = readDispatchSessionKey(dispatchRecord);
  if (runId || dispatchRecord.sessionId || sessionKey) {
    try {
      if (!adapter.abortAgentTurn) throw new Error("OpenClaw session abort is unavailable.");
      const result = await adapter.abortAgentTurn({
        runId,
        sessionId: dispatchRecord.sessionId,
        sessionKey,
        agentId: dispatchRecord.agentId,
        reason: abortReason
      }, { ...gatewayOptions, timeoutMs: 15_000, allowCliFallback: false });
      confirmed ||= isMissionAbortConfirmed(result);
    } catch (error) {
      failures.push(stringifyCommandFailure(error));
    }
  }

  if (nextRecord.runner.pid || nextRecord.runner.childPid) {
    killedChildPid = await stopMissionDispatchChildProcess(nextRecord);
  }

  const finishedAt = new Date().toISOString();
  const cancellationDetail = confirmed
    ? "OpenClaw confirmed the task stop request."
    : failures.find(Boolean) || "OpenClaw has not confirmed that the task stopped. Refresh task activity to reconcile its state.";
  nextRecord = {
    ...nextRecord,
    status: confirmed ? "cancelled" : dispatchRecord.status,
    updatedAt: finishedAt,
    cancellation: {
      status: confirmed ? "confirmed" : "unknown",
      requestedAt: abortedAt,
      confirmedAt: confirmed ? finishedAt : null,
      reason: abortReason,
      detail: cancellationDetail
    },
    ...(confirmed ? {
      runner: {
        ...nextRecord.runner,
        finishedAt,
        lastHeartbeatAt: finishedAt
      }
    } : {})
  };
  await writeMissionDispatchRecord(nextRecord);
  deps.invalidateMissionControlCaches();

  if (confirmed && nextRecord.browserBinding?.status === "active") {
    nextRecord = await finalizeDispatchBrowserBinding(nextRecord);
  }

  return {
    taskId,
    dispatchId: nextRecord.id,
    status: nextRecord.status,
    summary: cancellationDetail,
    reason: confirmed ? abortReason : cancellationDetail,
    runnerPid: nextRecord.runner.pid,
    childPid: killedChildPid ?? nextRecord.runner.childPid,
    abortedAt: confirmed ? finishedAt : abortedAt,
    requestedAt: abortedAt,
    cancellationStatus: confirmed ? "confirmed" : "unknown"
  };
}

function readDispatchSessionKey(record: MissionDispatchRecordLike) {
  const directSessionKey = typeof record.sessionKey === "string" ? record.sessionKey.trim() : "";
  if (directSessionKey) return directSessionKey;
  const result = record.result;
  if (!result || typeof result !== "object") {
    return null;
  }

  const value = (result as Record<string, unknown>).sessionKey;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function finalizeDispatchBrowserBinding<T extends MissionDispatchRecordLike>(record: T): Promise<T> {
  if (!record.browserBinding || record.browserBinding.status !== "active") return record;
  const result = await finalizeBrowserTaskBinding(record.id);
  const now = new Date().toISOString();
  const nextRecord = {
    ...record,
    updatedAt: now,
    browserBinding: {
      ...record.browserBinding,
      status: result.cleanupFailed ? "recovery_required" as const : "released" as const,
      releasedAt: now
    }
  };
  await writeMissionDispatchRecord(nextRecord);
  return nextRecord as T;
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
  deps: MissionDispatchWorkflowDependencies,
  gatewayOptions: OpenClawCommandOptions
): Promise<MissionAbortResponse> {
  if (!task) {
    throw new Error("Task was not found in the current OpenClaw snapshot.");
  }

  if (task.status === "completed" || task.status === "stalled" || task.status === "cancelled") {
    const status: MissionDispatchStatus = task.status === "completed"
      ? "completed"
      : task.status === "cancelled" ? "cancelled" : "stalled";
    return {
      taskId,
      dispatchId: null,
      status,
      summary: task.status === "cancelled"
        ? task.subtitle || "Task is already cancelled."
        : "Task is already terminal; no stop request was sent.",
      reason: null,
      runnerPid: null,
      childPid: null,
      abortedAt: new Date().toISOString(),
      ...(task.status === "cancelled" ? { cancellationStatus: "confirmed" as const } : {})
    };
  }

  const abortReason = normalizeMissionAbortReason(reason);
  const gatewayTaskIds = resolveGatewayTaskCancelIds(task, null);

  if (gatewayTaskIds.length === 0) {
    throw new Error("Mission dispatch record was not found and the task does not expose a Gateway task id.");
  }

  for (const gatewayTaskId of gatewayTaskIds) {
    const result = await getOpenClawAdapter().cancelTask({
      taskId: gatewayTaskId,
      reason: abortReason
    }, { ...gatewayOptions, timeoutMs: 15_000, allowCliFallback: false });
    if (!isMissionAbortConfirmed(result)) {
      const requestedAt = new Date().toISOString();
      return {
        taskId,
        dispatchId: null,
        status: task.status === "idle" ? "queued" : task.status,
        summary: "OpenClaw accepted the stop request but has not confirmed cancellation.",
        reason: "Refresh task activity to reconcile its state.",
        runnerPid: null,
        childPid: null,
        abortedAt: requestedAt,
        requestedAt,
        cancellationStatus: "unknown"
      };
    }
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
    abortedAt: new Date().toISOString(),
    cancellationStatus: "confirmed"
  };
}

function isMissionAbortConfirmed(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  const status = typeof payload.status === "string" ? payload.status.trim().toLowerCase() : "";
  return payload.aborted === true || payload.cancelled === true || payload.canceled === true ||
    status === "aborted" || status === "cancelled" || status === "canceled" || status === "stopped";
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

function resolveGatewayMissionDispatchStatus(status: string | undefined): MissionDispatchStatus {
  const normalized = status?.trim().toLowerCase();

  if (normalized === "completed" || normalized === "complete" || normalized === "succeeded" || normalized === "success") {
    return "completed";
  }

  if (normalized === "cancelled" || normalized === "canceled") {
    return "cancelled";
  }

  if (
    normalized === "stalled" ||
    normalized === "timeout" ||
    normalized === "timed_out" ||
    normalized === "failed" ||
    normalized === "error"
  ) {
    return "stalled";
  }

  return "running";
}

function resolveGatewayMissionDispatchError(payload: { status?: string; summary?: string }) {
  const summary = payload.summary?.trim();
  if (summary) {
    return summary;
  }

  const status = payload.status?.trim().toLowerCase();
  const timeoutPhase =
    typeof (payload as Record<string, unknown>).timeoutPhase === "string"
      ? ((payload as Record<string, unknown>).timeoutPhase as string).trim()
      : "";

  if (status === "timeout" || status === "timed_out") {
    return timeoutPhase
      ? `OpenClaw Gateway wait timed out during ${timeoutPhase}.`
      : "OpenClaw Gateway wait timed out before an agent response was captured.";
  }

  return "OpenClaw Gateway dispatch stalled before an agent response was captured.";
}
