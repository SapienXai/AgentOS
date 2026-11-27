import "server-only";

import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";

import { getHumanControlInbox } from "@/lib/openclaw/application/human-control-inbox-service";
import { getMissionControlSnapshot } from "@/lib/openclaw/application/mission-control-service";
import { getTaskDetail } from "@/lib/openclaw/application/runtime-service";
import {
  inspectWorkspaceDeliverable,
  isWorkspaceDeliverablePath,
  listWorkspaceDeliverablePaths,
  MAX_MISSION_DELIVERABLES,
  readWorkspaceDeliverable
} from "@/lib/openclaw/application/workspace-file-service";
import { missionRequestsFileArtifact } from "@/lib/openclaw/domains/mission-dispatch";
import {
  readMissionDispatchRecords,
  type MissionDispatchRecord
} from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import {
  resolveMissionDispatchCompletionDetail,
  resolveMissionDispatchResultText,
  resolveMissionDispatchRuntimeStatus
} from "@/lib/openclaw/domains/mission-dispatch-model";
import type {
  AttentionItem,
  MissionControlSnapshot,
  RuntimeRecord,
  RuntimeStatus,
  TaskDetailRecord,
  TaskFeedEvent,
  TaskRecord
} from "@/lib/agentos/contracts";
import { redactSecretText } from "@/lib/security/redaction";
import { readTaskReview } from "@/lib/agentos/application/task-review-service";
import { resolveTaskReviewKey } from "@/lib/agentos/workforce/task-review";
import {
  deriveMissionTitle,
  isMissionStateCriticalHumanControlType,
  resolveWorkforceMissionState,
  workforceMissionStateLabel
} from "@/lib/agentos/workforce/mission-state";
import type {
  WorkforceArtifact,
  WorkforceDeliverable,
  WorkforceMissionListResponse,
  WorkforceMissionProjection,
  WorkforceMissionServiceInput,
  WorkforceTimelineEvent,
  WorkforceWorkItem,
  WorkforceWorkerProjection
} from "@/lib/agentos/workforce/types";

type MissionSeed = {
  id: string;
  source: "agentos-dispatch" | "openclaw-task";
  record: MissionDispatchRecord | null;
  tasks: TaskRecord[];
};

type MissionBuildContext = {
  snapshot: MissionControlSnapshot;
  seed: MissionSeed;
  humanControlItems: AttentionItem[];
  detail: TaskDetailRecord | null;
  artifacts?: WorkforceArtifact[];
};

export async function getWorkforceMissionList(
  input: WorkforceMissionServiceInput = {}
): Promise<WorkforceMissionListResponse> {
  const snapshot = input.snapshot ?? await getMissionControlSnapshot();
  const records = await readMissionDispatchRecords();
  // List and detail must use the same state-critical evidence. The inbox
  // service bounds capability resolution; skipping it here creates a
  // correctness contradiction between the two pages.
  const inbox = await getHumanControlInbox({ snapshot });
  const seeds = buildMissionSeeds(snapshot.tasks, records, snapshot);
  const missions = seeds
    .map((seed) => buildMissionProjection({ snapshot, seed, humanControlItems: missionAttention(seed, inbox.items), detail: null }))
    .filter((mission) => matchesMissionFilter(mission, input))
    .sort(compareMissions);

  return {
    missions,
    summary: {
      needsYou: missions.filter((mission) => ["waiting-human", "blocked", "failed"].includes(mission.state)).length,
      running: missions.filter((mission) => ["starting", "running", "waiting-worker", "reconnecting"].includes(mission.state)).length,
      queued: missions.filter((mission) => mission.state === "queued").length,
      completed: missions.filter((mission) => mission.state === "completed").length,
      failed: missions.filter((mission) => mission.state === "failed").length
    },
    generatedAt: new Date().toISOString(),
    revision: snapshot.revision ?? null
  };
}

export async function getWorkforceMissionDetail(
  missionId: string,
  input: Omit<WorkforceMissionServiceInput, "detail"> = {}
) {
  const snapshot = input.snapshot ?? await getMissionControlSnapshot();
  const records = await readMissionDispatchRecords();
  const inbox = await getHumanControlInbox({ snapshot });
  const seed = buildMissionSeeds(snapshot.tasks, records, snapshot).find((candidate) => candidate.id === missionId) ?? null;

  if (!seed) return null;

  const rootTask = findRootTask(seed);
  let detail: TaskDetailRecord | null = null;
  if (rootTask || seed.record) {
    try {
      detail = await getTaskDetail(rootTask?.id ?? seed.record?.id ?? missionId, {
        dispatchId: seed.record?.id ?? rootTask?.dispatchId ?? null
      });
    } catch {
      // The list projection remains useful while a newly accepted dispatch is
      // waiting for OpenClaw to expose its task/session identity.
      detail = null;
    }
  }

  const workspaceId = seed.record?.workspaceId ?? rootTask?.workspaceId;
  const workspace = snapshot.workspaces.find((candidate) => candidate.id === workspaceId);
  const [artifacts, review] = await Promise.all([
    workspace && detail ? loadMissionArtifacts(workspace.path, detail, seed.id, seed.record?.outputDirRelative) : [],
    input.actorId && rootTask ? readTaskReview(input.actorId, resolveTaskReviewKey(rootTask)) : null
  ]);

  const mission = buildMissionProjection({
    snapshot,
    seed,
    humanControlItems: missionAttention(seed, inbox.items),
    detail,
    artifacts
  });
  if (mission.deliverable && review && Date.parse(review.reviewedAt) >= (rootTask?.updatedAt ?? 0)) {
    mission.deliverable.review = { status: review.status, reviewedAt: review.reviewedAt };
  }
  return mission;
}

export async function downloadWorkforceMissionArtifact(missionId: string, artifactId: string) {
  const snapshot = await getMissionControlSnapshot();
  const mission = await getWorkforceMissionDetail(missionId, { snapshot });
  const artifact = mission?.artifacts.find((candidate) => candidate.id === artifactId && candidate.availability === "available");
  const workspace = snapshot.workspaces.find((candidate) => candidate.id === mission?.workspaceId);
  if (!artifact || !workspace) return null;

  const bytes = await readWorkspaceDeliverable(workspace.path, artifact.path);
  return bytes ? { bytes, filename: path.posix.basename(artifact.path) } : null;
}

export function buildMissionSeeds(tasks: TaskRecord[], records: MissionDispatchRecord[], visibleSnapshot?: MissionControlSnapshot): MissionSeed[] {
  const byDispatchId = new Map<string, MissionSeed>();
  for (const record of records) {
    byDispatchId.set(record.id, {
      id: record.id,
      source: "agentos-dispatch",
      record,
      tasks: []
    });
  }

  const missionTasks = tasks.filter(isMissionTask);
  for (const task of missionTasks) {
    if (task.dispatchId && byDispatchId.has(task.dispatchId)) {
      byDispatchId.get(task.dispatchId)?.tasks.push(task);
      continue;
    }

    const id = task.dispatchId || `task:${task.id}`;
    const existing = byDispatchId.get(id);
    if (existing) {
      existing.tasks.push(task);
      continue;
    }

    byDispatchId.set(id, {
      id,
      source: "openclaw-task",
      record: null,
      tasks: [task]
    });
  }

  const missionTaskIds = new Set(missionTasks.map((task) => task.id));
  for (const task of tasks) {
    if (missionTaskIds.has(task.id)) continue;
    const owner = [...byDispatchId.values()].find((seed) => {
      return hasNativeAncestor(task, seed, tasks);
    });
    if (owner) owner.tasks.push(task);
  }

  return [...byDispatchId.values()].filter((seed) => !visibleSnapshot || isMissionSeedVisible(seed, visibleSnapshot));
}

/** A durable dispatch sidecar is not an authorization source. */
export function isMissionSeedVisible(seed: MissionSeed, snapshot: MissionControlSnapshot) {
  const visibleTaskIds = new Set(snapshot.tasks.map((task) => task.id));
  if (seed.tasks.some((task) => visibleTaskIds.has(task.id))) return true;
  if (!seed.record) return false;

  const visibleWorkspaceIds = new Set(snapshot.workspaces.map((workspace) => workspace.id));
  const visibleAgentIds = new Set(snapshot.agents.map((agent) => agent.id));
  const visibleRuntimeIds = new Set(snapshot.runtimes.map((runtime) => runtime.id));
  if (seed.record.workspaceId) return visibleWorkspaceIds.has(seed.record.workspaceId);
  return Boolean(
    visibleAgentIds.has(seed.record.agentId) ||
    (seed.record.observation.runtimeId && visibleRuntimeIds.has(seed.record.observation.runtimeId))
  );
}

export function isMissionTask(task: TaskRecord) {
  if (task.metadata.nativeDelegatedSession === true || typeof task.metadata.operationJobId === "string" ||
    task.metadata.source === "cron" || task.metadata.kind === "cron") {
    return false;
  }
  return Boolean(
    task.dispatchId ||
    task.mission ||
    task.metadata.provenance === "dispatch-derived" ||
    (task.metadata.dispatchId && typeof task.metadata.dispatchId === "string")
  );
}

export function buildMissionProjection(context: MissionBuildContext): WorkforceMissionProjection {
  const { snapshot, seed, humanControlItems, detail } = context;
  const rootTask = findRootTask(seed);
  const runtimeStatuses = relatedRuntimes(snapshot.runtimes, seed);
  const dispatchRuntimeStatus = seed.record ? resolveMissionDispatchRuntimeStatus(seed.record, Date.now()) : null;
  const childTasks = seed.tasks.filter((task) => task.id !== rootTask?.id && hasNativeAncestor(task, seed, seed.tasks));
  const childTaskIds = new Set(childTasks.flatMap((task) => [task.id, readString(task.metadata.openClawTaskId)]).filter((value): value is string => Boolean(value)));
  const childRuntimeIds = new Set(childTasks.flatMap((task) => task.runtimeIds));
  const rootRuntimeStatuses = runtimeStatuses.filter((runtime) =>
    !childRuntimeIds.has(runtime.id) && (!runtime.taskId || !childTaskIds.has(runtime.taskId))
  );
  const connection = resolveConnection(snapshot);
  const derivedRootStatus = rootTask?.status ?? (
    seed.record && (seed.record.observation.runtimeId || seed.record.runner.lastHeartbeatAt)
      ? dispatchRuntimeStatus === "stalled" && seed.record.status !== "stalled" ? "running" : dispatchRuntimeStatus
      : null
  );
  const state = resolveWorkforceMissionState({
    dispatchStatus: seed.record?.status === "stalled" ? "stalled" : seed.record?.status ?? null,
    admissionState: seed.record?.admissionState ?? null,
    runnerStarted: Boolean(seed.record?.runner.startedAt || seed.record?.runner.pid),
    rootStatus: derivedRootStatus,
    childStatuses: childTasks.map((task) => task.status),
    // Child activity is represented by childStatuses. Feeding child runtimes
    // into this field makes waiting-worker unreachable whenever only a child
    // is active.
    activeRuntimeStatuses: rootRuntimeStatuses.map((runtime) => runtime.status),
    pendingHumanControl: humanControlItems.map((item) => item.type).filter(isMissionStateCriticalHumanControlType),
    connection,
    authoritativeFailure: Boolean(seed.record?.status === "stalled" || rootTask?.status === "stalled"),
    authoritativeCompletion: Boolean(seed.record?.status === "completed" || rootTask?.status === "completed")
  });
  const goal = seed.record?.mission || rootTask?.mission || rootTask?.title || "Give your workforce a goal to get started.";
  const title = deriveMissionTitle(goal);
  const primaryAgentId = seed.record?.agentId ?? rootTask?.primaryAgentId ?? null;
  const primaryAgentName = resolveAgentName(snapshot, primaryAgentId, rootTask?.primaryAgentName);
  const workspaceId = seed.record?.workspaceId ?? rootTask?.workspaceId ?? null;
  const workspaceName = workspaceId ? snapshot.workspaces.find((workspace) => workspace.id === workspaceId)?.name ?? null : null;
  const submittedAt = seed.record?.submittedAt ?? null;
  const createdAt = submittedAt || readTaskTimestamp(rootTask, "createdAt") || toIso(rootTask?.updatedAt);
  const startedAt = seed.record?.runner.startedAt || (rootTask && rootTask.status !== "queued" ? createdAt : null);
  const completedAt = seed.record?.runner.finishedAt || (state === "completed" ? toIso(rootTask?.updatedAt) : null);
  const updatedAt = latestTimestamp(seed.record?.updatedAt, rootTask?.updatedAt, ...seed.tasks.map((task) => task.updatedAt));
  // The runtime output list also contains newer conversation turns. The
  // dispatch integrity check scopes the outcome to the task's original work.
  const result = seed.record
    ? detail?.integrity.finalResponseText?.trim() || resolveMissionDispatchResultText(seed.record)
    : detail?.outputs.find((output) => output.finalText?.trim())?.finalText?.trim() || null;
  const error = seed.record?.error ? redactSecretText(seed.record.error) : rootTask?.status === "stalled" ? redactSecretText(rootTask.subtitle) : null;
  const workTree = buildWorkTree(seed, snapshot, state, primaryAgentName);
  const timeline = buildTimeline({ context, state, title, primaryAgentName, workTree, createdAt, startedAt, completedAt, result });
  const artifacts = context.artifacts ?? [];
  const expectedOutcome = seed.record?.expectedOutcome ?? null;
  const acceptanceCriteria = seed.record?.acceptanceCriteria ?? null;
  const deliverable = buildDeliverable(state, [goal, expectedOutcome, acceptanceCriteria].filter(Boolean).join("\n"), result, detail, artifacts);
  const runtime = buildRuntimeReference(seed, detail, runtimeStatuses);

  return {
    id: seed.id,
    title,
    goal,
    expectedOutcome: expectedOutcome ? redactSecretText(expectedOutcome) : null,
    acceptanceCriteria: acceptanceCriteria ? redactSecretText(acceptanceCriteria) : null,
    state,
    stateLabel: workforceMissionStateLabel(state),
    workspaceId,
    workspaceName,
    createdAt,
    submittedAt,
    startedAt,
    completedAt,
    updatedAt,
    durationMs: startedAt ? Math.max(0, Date.parse(completedAt ?? new Date().toISOString()) - Date.parse(startedAt)) : null,
    source: seed.source,
    primaryAgentId,
    primaryAgentName,
    dispatchId: seed.record?.id ?? rootTask?.dispatchId ?? null,
    rootTaskId: rootTask?.id ?? null,
    summary: result ? redactSecretText(result) : seed.record ? redactSecretText(resolveMissionDispatchCompletionDetail(seed.record) ?? "") || null : rootTask?.subtitle || null,
    result: result ? redactSecretText(result) : null,
    error,
    connection,
    activeWorkers: buildActiveWorkers(workTree, seed, state, startedAt),
    workTree,
    humanControlItems,
    timeline,
    artifacts,
    deliverable,
    runtime,
    availableActions: {
      canCancel: ["queued", "starting", "running", "waiting-human", "waiting-worker", "blocked", "reconnecting"].includes(state) && Boolean(rootTask || seed.record),
      canResume: Boolean(rootTask?.metadata.continuationAvailable === true) && ["failed", "blocked"].includes(state),
      canOpenRuntime: runtime.taskIds.length > 0 || runtime.runtimeIds.length > 0 || runtime.sessionIds.length > 0
    },
  };
}

function buildMissionAttention(seed: MissionSeed, items: AttentionItem[]) {
  return items.filter((item) => {
    if (item.status !== "pending") return false;
    if (!isMissionStateCriticalHumanControlType(item.type)) return false;
    if (item.mission?.id === seed.id) return true;
    const taskId = item.source.taskId;
    return Boolean(taskId && seed.tasks.some((task) => task.id === taskId));
  });
}

function missionAttention(seed: MissionSeed, items: AttentionItem[]) {
  return buildMissionAttention(seed, items);
}

function buildWorkTree(seed: MissionSeed, snapshot: MissionControlSnapshot, state: WorkforceMissionProjection["state"], primaryAgentName: string): WorkforceWorkItem[] {
  const rootTask = findRootTask(seed);
  const sortedTasks = [...seed.tasks].sort((left, right) => (left.updatedAt ?? 0) - (right.updatedAt ?? 0) || left.id.localeCompare(right.id));
  const workItems: WorkforceWorkItem[] = [];
  if (rootTask) {
    workItems.push(taskToWorkItem(rootTask, snapshot, "primary", null, primaryAgentName));
  } else if (seed.record) {
    workItems.push({
      id: `dispatch:${seed.record.id}`,
      title: deriveMissionTitle(seed.record.mission),
      state,
      agentId: seed.record.agentId,
      agentName: resolveAgentName(snapshot, seed.record.agentId, primaryAgentName),
      relationship: "primary",
      parentId: null,
      taskId: null,
      runtimeId: seed.record.observation.runtimeId,
      source: "agentos-dispatch",
      startedAt: seed.record.runner.startedAt,
      updatedAt: seed.record.updatedAt
    });
  }
  for (const task of sortedTasks) {
    if (task.id === rootTask?.id) continue;
    const parentId = resolveParentId(task, rootTask, seed.tasks);
    if (!parentId) continue;
    workItems.push(taskToWorkItem(task, snapshot, "delegated", parentId, null));
  }
  return workItems;
}

function taskToWorkItem(task: TaskRecord, snapshot: MissionControlSnapshot, relationship: "primary" | "delegated", parentId: string | null, fallbackAgentName: string | null): WorkforceWorkItem {
  // An idle parent waiting on a child is not itself an active worker. The
  // mission state carries the waiting-worker presentation; the work item must
  // preserve the native idle evidence so activeWorkers remains truthful.
  const state = task.status === "idle" ? "idle" : resolveTaskState(task.status);
  return {
    id: task.id,
    title: task.title || task.mission || "OpenClaw work item",
    state,
    agentId: task.primaryAgentId ?? null,
    agentName: resolveAgentName(snapshot, task.primaryAgentId ?? null, task.primaryAgentName || fallbackAgentName),
    relationship,
    parentId,
    taskId: task.id,
    runtimeId: task.primaryRuntimeId ?? task.runtimeIds[0] ?? null,
    source: "openclaw-task",
    startedAt: readTaskStartTimestamp(task),
    updatedAt: toIso(task.updatedAt)
  };
}

function buildActiveWorkers(workTree: WorkforceWorkItem[], seed: MissionSeed, missionState: WorkforceMissionProjection["state"], startedAt: string | null): WorkforceWorkerProjection[] {
  const active = workTree.filter((item) => ["queued", "starting", "running", "waiting-worker", "reconnecting"].includes(item.state));
  if (active.length > 0) {
    return active.map((item) => ({
      id: item.agentId,
      name: item.agentName,
      state: item.state,
      activity: item.title,
      relationship: item.relationship,
      parentTaskId: item.parentId,
      taskId: item.taskId,
      runtimeId: item.runtimeId,
      startedAt: item.startedAt ?? (item.relationship === "primary" ? startedAt : null),
      elapsedMs: item.startedAt || (item.relationship === "primary" ? startedAt : null)
        ? Math.max(0, Date.now() - Date.parse(item.startedAt ?? startedAt!))
        : null
    }));
  }
  if (seed.record && ["queued", "starting", "running", "waiting-worker", "reconnecting"].includes(missionState)) {
    return [{
      id: seed.record.agentId,
      name: seed.record.agentId,
      state: missionState,
      activity: deriveMissionTitle(seed.record.mission),
      relationship: "primary",
      parentTaskId: null,
      taskId: null,
      runtimeId: seed.record.observation.runtimeId,
      startedAt,
      elapsedMs: startedAt ? Math.max(0, Date.now() - Date.parse(startedAt)) : null
    }];
  }
  return [];
}

function buildTimeline(input: {
  context: MissionBuildContext;
  state: WorkforceMissionProjection["state"];
  title: string;
  primaryAgentName: string;
  workTree: WorkforceWorkItem[];
  createdAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  result: string | null;
}) {
  const { context, state, title, primaryAgentName, workTree, createdAt, startedAt, completedAt, result } = input;
  const events: WorkforceTimelineEvent[] = [];
  if (createdAt) events.push({ id: "mission-created", at: createdAt, kind: "created", title: "Mission created", detail: title, workerLabel: null, source: "agentos" });
  if (createdAt && primaryAgentName) events.push({ id: "mission-assigned", at: createdAt, kind: "assigned", title: "Assigned to worker", detail: null, workerLabel: primaryAgentName, source: "agentos" });
  if (startedAt) events.push({ id: "mission-started", at: startedAt, kind: "started", title: "Mission started", detail: null, workerLabel: primaryAgentName, source: "openclaw" });
  for (const item of workTree.filter((candidate) => candidate.relationship === "delegated")) {
    if (!item.updatedAt) continue;
    events.push({ id: `delegated:${item.id}`, at: item.updatedAt, kind: "delegated", title: "Delegated work started", detail: item.title, workerLabel: item.agentName, source: "openclaw" });
  }
  for (const item of context.humanControlItems) {
    if (!item.createdAt) continue;
    events.push({ id: `attention:${item.id}`, at: item.createdAt, kind: item.type === "approval" || item.type === "question" ? "approval" : "blocked", title: item.title, detail: item.summary, workerLabel: item.worker.label, source: "openclaw" });
  }
  if (completedAt && state === "completed") events.push({ id: "mission-completed", at: completedAt, kind: "completed", title: "Mission completed", detail: result ? redactSecretText(result).slice(0, 220) : null, workerLabel: primaryAgentName, source: "openclaw" });
  if (state === "failed" && completedAt) events.push({ id: "mission-failed", at: completedAt, kind: "failed", title: "Mission needs recovery", detail: result ? redactSecretText(result).slice(0, 220) : null, workerLabel: primaryAgentName, source: "openclaw" });
  if (context.detail) {
    for (const event of context.detail.liveFeed.filter(isUserFacingFeedEvent)) {
      events.push(feedEventToTimeline(event));
    }
  }
  return events.sort((left, right) => Date.parse(left.at) - Date.parse(right.at) || left.id.localeCompare(right.id));
}

export async function loadMissionArtifacts(workspacePath: string, detail: TaskDetailRecord, missionId: string, outputDirectory?: string | null): Promise<WorkforceArtifact[]> {
  const realWorkspacePath = await realpath(workspacePath).catch(() => null);
  const roots = [path.resolve(workspacePath), ...(realWorkspacePath ? [realWorkspacePath] : [])];
  const files = new Map<string, { runtimeId: string | null; source: WorkforceArtifact["source"] }>();

  // Output records are already scoped to the mission's native runs. Other
  // references are accepted only in the mission's assigned output directory.
  for (const output of detail.outputs) {
    for (const file of output.createdFiles) {
      const relative = toWorkspaceDeliverablePath(file.path, roots);
      if (relative && files.size < MAX_MISSION_DELIVERABLES) {
        files.set(relative, { runtimeId: output.runtimeId, source: "openclaw-runtime" });
      }
    }
  }
  if (outputDirectory) {
    const discovered = await listWorkspaceDeliverablePaths(workspacePath, outputDirectory);
    const referenced = detail.createdFiles.map((file) => toWorkspaceDeliverablePath(file.path, roots))
      .filter((file): file is string => Boolean(file?.startsWith(`${outputDirectory}/`)));
    for (const relative of [...discovered, ...referenced]) {
      if (files.size === MAX_MISSION_DELIVERABLES) break;
      if (!files.has(relative)) files.set(relative, { runtimeId: null, source: "workspace-output" });
    }
  }

  return Promise.all([...files].map(async ([relative, origin]) => {
    const bytes = await inspectWorkspaceDeliverable(workspacePath, relative);
    return {
      id: createHash("sha256").update(missionId).update("\0").update(relative).digest("hex").slice(0, 24),
      path: relative,
      displayPath: path.posix.basename(relative),
      category: artifactCategory(relative),
      source: origin.source,
      taskId: detail.task.id,
      runtimeId: origin.runtimeId,
      availability: bytes === null ? "unavailable" : "available",
      bytes
    };
  }));
}

function toWorkspaceDeliverablePath(candidate: string, roots: string[]) {
  const value = candidate.trim();
  if (redactSecretText(value) !== value) return null;
  const relative = path.isAbsolute(value)
    ? roots.map((root) => path.relative(root, value).split(path.sep).join("/")).find(isWorkspaceDeliverablePath)
    : value.replace(/^\.\//, "");
  return relative && isWorkspaceDeliverablePath(relative) ? relative : null;
}

function buildDeliverable(
  state: WorkforceMissionProjection["state"],
  goal: string,
  result: string | null,
  detail: TaskDetailRecord | null,
  artifacts: WorkforceArtifact[]
): WorkforceDeliverable | null {
  const artifactCount = artifacts.filter((artifact) => artifact.availability === "available").length;
  const summary = result ? redactSecretText(result) : null;
  const evidence = (detail?.integrity.issues ?? []).map((issue) => redactSecretText(issue.title));
  const hasOutput = Boolean(summary || artifactCount);
  const terminal = state === "completed" || state === "failed" || state === "cancelled";
  if (!terminal && !artifactCount) return null;

  if (artifacts.some((artifact) => artifact.availability === "unavailable")) {
    evidence.push("Some reported files are missing or unavailable.");
  }
  if (state === "failed" || state === "cancelled") {
    return { outcome: hasOutput ? "partial" : "failed", summary, evidence, artifactCount };
  }
  if (!terminal) return { outcome: "partial", summary, evidence, artifactCount };
  if (!detail) return { outcome: "unverified", summary, evidence, artifactCount };

  if (missionRequestsFileArtifact(goal) && !artifactCount) {
    evidence.push("No accessible file was verified for the requested deliverable.");
    return { outcome: hasOutput ? "partial" : "unverified", summary, evidence, artifactCount };
  }
  if (!hasOutput) return { outcome: "unverified", summary, evidence, artifactCount };
  if (evidence.length > 0 || /^(?:send|email|publish|submit|delete|deploy|book|purchase|buy)\b/i.test(goal.trim())) {
    return { outcome: "needs-review", summary, evidence, artifactCount };
  }
  return { outcome: "delivered", summary, evidence, artifactCount };
}

function buildRuntimeReference(seed: MissionSeed, detail: TaskDetailRecord | null, runtimes: RuntimeRecord[]) {
  const taskIds = new Set(seed.tasks.map((task) => task.id));
  const runtimeIds = new Set<string>();
  const sessionIds = new Set<string>();
  const runIds = new Set<string>();
  for (const task of seed.tasks) {
    task.runtimeIds.forEach((id) => runtimeIds.add(id));
    task.sessionIds.forEach((id) => sessionIds.add(id));
    task.runIds.forEach((id) => runIds.add(id));
  }
  for (const runtime of runtimes) {
    runtimeIds.add(runtime.id);
    if (runtime.sessionId) sessionIds.add(runtime.sessionId);
    if (runtime.runId) runIds.add(runtime.runId);
  }
  for (const output of detail?.outputs ?? []) {
    runtimeIds.add(output.runtimeId);
    if (output.sessionId) sessionIds.add(output.sessionId);
    if (output.taskId) taskIds.add(output.taskId);
  }
  if (seed.record?.observation.runtimeId) runtimeIds.add(seed.record.observation.runtimeId);
  if (seed.record?.sessionId) sessionIds.add(seed.record.sessionId);
  return {
    dispatchId: seed.record?.id ?? null,
    taskIds: [...taskIds],
    runtimeIds: [...runtimeIds],
    sessionIds: [...sessionIds],
    runIds: [...runIds]
  };
}

function relatedRuntimes(runtimes: RuntimeRecord[], seed: MissionSeed) {
  const taskIds = new Set(seed.tasks.map((task) => task.id));
  const runtimeIds = new Set(seed.tasks.flatMap((task) => task.runtimeIds));
  if (seed.record?.observation.runtimeId) runtimeIds.add(seed.record.observation.runtimeId);
  return runtimes.filter((runtime) => Boolean(
    runtime.taskId && taskIds.has(runtime.taskId) ||
    runtimeIds.has(runtime.id) ||
    (seed.record?.id && runtime.metadata.dispatchId === seed.record.id)
  ));
}

function findRootTask(seed: MissionSeed) {
  return seed.tasks.find((task) => task.dispatchId === seed.record?.id) ?? seed.tasks.find((task) => !resolveParentId(task, null, seed.tasks)) ?? seed.tasks[0] ?? null;
}

function hasNativeAncestor(task: TaskRecord, seed: MissionSeed, allTasks: TaskRecord[]) {
  const seedTaskIds = new Set(seed.tasks.map((candidate) => candidate.id));
  let current: TaskRecord | undefined = task;
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    const parentId = resolveParentId(current, null, allTasks);
    if (!parentId) return false;
    if (seedTaskIds.has(parentId)) return true;
    current = allTasks.find((candidate) => candidate.id === parentId);
  }
  return false;
}

function readTaskStartTimestamp(task: TaskRecord) {
  return readTaskTimestamp(task, "startedAt") || readTaskTimestamp(task, "dispatchRunnerStartedAt") || readTaskTimestamp(task, "createdAt");
}

function resolveParentId(task: TaskRecord, rootTask: TaskRecord | null, tasks: TaskRecord[]) {
  const explicit = readString(task.metadata.parentTaskId) || readString(task.metadata.parentId);
  if (explicit) return tasks.find((candidate) => candidate.id === explicit || readString(candidate.metadata.openClawTaskId) === explicit)?.id ?? null;
  const parentKey = readString(task.metadata.ownerKey) || readString(task.metadata.requesterSessionKey);
  if (!parentKey) return null;
  const matches = tasks.filter((candidate) => candidate.id !== task.id &&
    (!task.workspaceId || candidate.workspaceId === task.workspaceId) &&
    (candidate.key === parentKey || readString(candidate.metadata.openClawSessionKey) === parentKey));
  if (task.metadata.nativeDelegatedSession === true && matches.length !== 1) return null;
  const parent = matches[0];
  if (parent && parent.id !== task.id) return parent.id;
  if (rootTask && (rootTask.key === parentKey || readString(rootTask.metadata.openClawSessionKey) === parentKey) && rootTask.id !== task.id) return rootTask.id;
  return null;
}

function resolveTaskState(status: RuntimeStatus): WorkforceMissionProjection["state"] {
  if (status === "running") return "running";
  if (status === "queued") return "queued";
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "stalled") return "failed";
  return "queued";
}

function resolveConnection(snapshot: MissionControlSnapshot): "live" | "reconnecting" | "unknown" {
  if (snapshot.mode === "fallback" || snapshot.diagnostics.rpcOk === false) return "reconnecting";
  if (snapshot.diagnostics.health === "healthy") return "live";
  return "unknown";
}

function resolveAgentName(snapshot: MissionControlSnapshot, agentId: string | null | undefined, fallback?: string | null) {
  return fallback?.trim() || (agentId ? snapshot.agents.find((agent) => agent.id === agentId)?.name : null) || agentId || "Unassigned";
}

function readTaskTimestamp(task: TaskRecord | null, key: string) {
  return task ? toIso(task.metadata[key]) : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function toIso(value: unknown) {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  return null;
}

function latestTimestamp(...values: Array<string | number | null | undefined>) {
  const dates = values.map((value) => typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN).filter(Number.isFinite);
  return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
}

function artifactCategory(pathValue: string): WorkforceArtifact["category"] {
  const lower = pathValue.toLowerCase();
  if (lower.endsWith(".md") || lower.endsWith(".doc") || lower.endsWith(".docx")) return "document";
  if (lower.endsWith(".pdf") || lower.endsWith(".csv") || lower.endsWith(".xlsx")) return "report";
  if (lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".js") || lower.endsWith(".py")) return "code-output";
  return "file";
}

function isUserFacingFeedEvent(event: TaskFeedEvent) {
  return ["status", "assistant", "artifact", "warning"].includes(event.kind) && !event.title.toLowerCase().includes("tool");
}

function feedEventToTimeline(event: TaskFeedEvent): WorkforceTimelineEvent {
  return {
    id: `feed:${event.id}`,
    at: event.timestamp,
    kind: event.kind === "artifact" ? "artifact" : event.isError || event.kind === "warning" ? "failed" : event.kind === "status" ? "note" : "note",
    title: event.title,
    detail: event.detail || null,
    workerLabel: null,
    source: "openclaw"
  };
}

function matchesMissionFilter(mission: WorkforceMissionProjection, input: WorkforceMissionServiceInput) {
  if (input.workspaceId && mission.workspaceId !== input.workspaceId) return false;
  if (input.state && mission.state !== input.state) return false;
  if (input.agentId && mission.primaryAgentId !== input.agentId) return false;
  const search = input.search?.trim().toLowerCase();
  return !search || [mission.title, mission.goal, mission.primaryAgentName, mission.workspaceName ?? ""].some((value) => value.toLowerCase().includes(search));
}

function compareMissions(left: WorkforceMissionProjection, right: WorkforceMissionProjection) {
  const rank = (state: WorkforceMissionProjection["state"]) => {
    if (["waiting-human", "blocked", "failed"].includes(state)) return 0;
    if (["running", "starting", "waiting-worker", "reconnecting"].includes(state)) return 1;
    if (state === "queued") return 2;
    return 3;
  };
  return rank(left.state) - rank(right.state) || (Date.parse(right.updatedAt ?? right.createdAt ?? "") || 0) - (Date.parse(left.updatedAt ?? left.createdAt ?? "") || 0) || left.id.localeCompare(right.id);
}
