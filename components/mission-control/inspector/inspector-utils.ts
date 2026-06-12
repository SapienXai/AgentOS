import type {
  MissionControlSnapshot,
  RuntimeActivityRecord,
  TaskDetailRecord,
  WorkItemRecord
} from "@/lib/agentos/contracts";
import {
  resolveTaskFollowUpAvailability,
  type TaskFollowUpAvailability,
  type TaskFollowUpContext
} from "@/lib/openclaw/domains/task-follow-up";

export type InspectorTaskSessionView = {
  openClawTaskId: string | null;
  openClawTaskIdSource: "metadata" | "normalized-task" | "unknown";
  sessionIds: string[];
  sessionKey: string | null;
  runIds: string[];
  runtimeIds: string[];
  dispatchId: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  agentId: string | null;
  agentName: string | null;
  provenance: TaskFollowUpContext["provenance"];
  provenanceLabel: string;
  sessionConfidence: TaskFollowUpContext["confidence"];
  sessionConfidenceLabel: string;
  followUpAvailability: TaskFollowUpAvailability;
};

export type InspectorAgentRuntimeView = {
  activeRuntimeIds: string[];
  activeSessionIds: string[];
  activeRunIds: string[];
  recordedSessionCount: number;
  recoveredRuntimeCount: number;
};

export type InspectorRuntimeEvidenceView = {
  runtimeIds: string[];
  sessionIds: string[];
  runIds: string[];
  createdFileCount: number;
  warningCount: number;
};

export type PollingFallbackNotice = {
  visible: boolean;
  mode: NonNullable<MissionControlSnapshot["diagnostics"]["eventBridge"]>["mode"] | "unknown";
  title: string;
  message: string | null;
  recovery: string | null;
};

export function buildInspectorTaskSessionView({
  snapshot,
  task,
  taskDetail
}: {
  snapshot: MissionControlSnapshot;
  task: WorkItemRecord;
  taskDetail?: TaskDetailRecord | null;
}): InspectorTaskSessionView {
  const selectedTask = taskDetail?.task ?? task;
  const runs = taskDetail?.runs ?? snapshot.runtimes.filter((runtime) => selectedTask.runtimeIds.includes(runtime.id));
  const followUpAvailability = resolveTaskFollowUpAvailability(selectedTask);
  const followUpContext = followUpAvailability.context;
  const workspaceId =
    selectedTask.workspaceId?.trim() ||
    firstNonEmpty(runs.map((runtime) => runtime.workspaceId)) ||
    readMetadataString(selectedTask.metadata, "workspaceId");
  const workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);
  const agentId =
    followUpContext.agentId ||
    selectedTask.primaryAgentId?.trim() ||
    firstNonEmpty(selectedTask.agentIds) ||
    firstNonEmpty(runs.map((runtime) => runtime.agentId)) ||
    readMetadataString(selectedTask.metadata, "agentId");
  const agent = snapshot.agents.find((entry) => entry.id === agentId);
  const metadataOpenClawTaskId =
    followUpContext.openClawTaskId ||
    readMetadataString(selectedTask.metadata, "taskId") ||
    readMetadataString(selectedTask.metadata, "openClawId");
  const openClawTaskId = metadataOpenClawTaskId || selectedTask.id || null;

  return {
    openClawTaskId,
    openClawTaskIdSource: metadataOpenClawTaskId ? "metadata" : selectedTask.id ? "normalized-task" : "unknown",
    sessionIds: uniqueStrings([
      followUpContext.sessionId,
      ...selectedTask.sessionIds,
      ...runs.map((runtime) => runtime.sessionId),
      taskDetail?.integrity.dispatchSessionId
    ]),
    sessionKey: followUpContext.sessionKey,
    runIds: uniqueStrings([
      ...selectedTask.runIds,
      ...runs.map((runtime) => runtime.runId),
      readMetadataString(selectedTask.metadata, "runId")
    ]),
    runtimeIds: uniqueStrings([
      ...selectedTask.runtimeIds,
      ...runs.map((runtime) => runtime.id),
      selectedTask.primaryRuntimeId
    ]),
    dispatchId: followUpContext.dispatchId,
    workspaceId: workspaceId ?? null,
    workspaceName: workspace?.name ?? null,
    agentId: agentId ?? null,
    agentName: agent?.name ?? selectedTask.primaryAgentName ?? null,
    provenance: followUpContext.provenance,
    provenanceLabel: formatTaskProvenanceLabel(followUpContext.provenance),
    sessionConfidence: followUpContext.confidence,
    sessionConfidenceLabel: formatSessionConfidenceLabel(followUpContext.confidence),
    followUpAvailability
  };
}

export function buildInspectorAgentRuntimeView({
  snapshot,
  agentId
}: {
  snapshot: MissionControlSnapshot;
  agentId: string;
}): InspectorAgentRuntimeView {
  const agent = snapshot.agents.find((entry) => entry.id === agentId);
  const runtimes = snapshot.runtimes.filter((runtime) => runtime.agentId === agentId || agent?.activeRuntimeIds.includes(runtime.id));

  return {
    activeRuntimeIds: uniqueStrings(runtimes.map((runtime) => runtime.id)),
    activeSessionIds: uniqueStrings(runtimes.map((runtime) => runtime.sessionId)),
    activeRunIds: uniqueStrings(runtimes.map((runtime) => runtime.runId)),
    recordedSessionCount: agent?.sessionCount ?? 0,
    recoveredRuntimeCount: runtimes.length
  };
}

export function buildInspectorRuntimeEvidenceView({
  runtime,
  output
}: {
  runtime: RuntimeActivityRecord;
  output?: {
    createdFiles?: Array<{ path: string; displayPath: string }>;
    warnings?: string[];
  } | null;
}): InspectorRuntimeEvidenceView {
  return {
    runtimeIds: [runtime.id],
    sessionIds: uniqueStrings([runtime.sessionId]),
    runIds: uniqueStrings([runtime.runId]),
    createdFileCount: output?.createdFiles?.length ?? 0,
    warningCount: output?.warnings?.length ?? 0
  };
}

export function resolvePollingFallbackNotice(
  eventBridge: MissionControlSnapshot["diagnostics"]["eventBridge"] | undefined
): PollingFallbackNotice {
  const mode = eventBridge?.mode ?? "unknown";
  const visible = mode === "polling" || mode === "reconnecting";

  return {
    visible,
    mode,
    title: mode === "reconnecting" ? "Gateway events reconnecting" : "Gateway events using polling",
    message: eventBridge?.message?.trim() || null,
    recovery: eventBridge?.recovery?.trim() || null
  };
}

export function formatTaskProvenanceLabel(provenance: TaskFollowUpContext["provenance"]) {
  switch (provenance) {
    case "native-task":
      return "Native OpenClaw task";
    case "dispatch-derived":
      return "Mission dispatch";
    case "runtime-derived":
      return "Runtime-derived";
    default:
      return "Unknown";
  }
}

export function formatSessionConfidenceLabel(confidence: TaskFollowUpContext["confidence"]) {
  switch (confidence) {
    case "high":
      return "High confidence";
    case "medium":
      return "Medium confidence";
    case "none":
      return "No session confidence";
  }
}

function readMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function firstNonEmpty(values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
}
