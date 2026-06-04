import { compactPath, formatAgentDisplayName } from "@/lib/openclaw/presenters";
import { isOpenClawOnboardingSystemReady } from "@/lib/openclaw/readiness";
import { OPENCLAW_RECOMMENDED_VERSION } from "@/lib/openclaw/versions";
import type {
  MissionControlSnapshot,
  OpenClawModelOnboardingPhase,
  OperationProgressSnapshot,
  OperationProgressStepSnapshot,
  OperationProgressStepStatus,
  TaskFeedEvent,
  WorkspaceCreateResult,
  WorkItemRecord
} from "@/lib/agentos/contracts";

type UpdateRunState = "idle" | "running" | "success" | "error";
type SurfaceTheme = "dark" | "light";
type ModelOnboardingIntent = "auto" | "refresh" | "discover" | "set-default" | "login-provider";
const workspaceSelectionStorageKeyPrefix = "mission-control-active-workspace-id";
const workspaceSelectionStorageAllValue = "__all__";

export type OptimisticMissionTask = {
  requestId: string;
  dispatchId: string | null;
  task: WorkItemRecord;
};

export type LaunchpadWorkspaceSetupReadiness = {
  workspaceVisible: boolean;
  primaryAgentVisible: boolean;
  agentsVisible: boolean;
  ready: boolean;
  workspaceName: string | null;
  workspacePath: string | null;
  visibleAgentCount: number;
  expectedAgentCount: number;
};

const launchpadCanvasHandoffStepId = "canvas-handoff";

type MissionDispatchStart = {
  requestId: string;
  mission: string;
  agentId: string;
  workspaceId: string | null;
  submittedAt: number;
  abortController: AbortController;
};

export function resolveUpdateDialogTitle(runState: UpdateRunState) {
  if (runState === "running") {
    return "Updating OpenClaw";
  }

  if (runState === "success") {
    return "Update complete";
  }

  if (runState === "error") {
    return "Update failed";
  }

  return "Update OpenClaw";
}

export function resolveUpdateDialogDescription(runState: UpdateRunState) {
  if (runState === "running") {
    return "OpenClaw is being updated now. Local gateway activity may pause briefly while the CLI is replaced.";
  }

  if (runState === "success") {
    return "The CLI update finished. Review the result below, then close this panel when you are done.";
  }

  if (runState === "error") {
    return "The update did not complete cleanly. Review the result and captured output before trying again.";
  }

  return "This runs openclaw update against the installed CLI and may briefly interrupt local gateway activity.";
}

export function resolveUpdateResultPanelClassName(runState: UpdateRunState, surfaceTheme: SurfaceTheme) {
  if (runState === "success") {
    return surfaceTheme === "light"
      ? "border-emerald-300 bg-emerald-50/80 text-emerald-950"
      : "border-emerald-300/25 bg-emerald-300/10 text-emerald-50";
  }

  if (runState === "error") {
    return surfaceTheme === "light"
      ? "border-rose-300 bg-rose-50/90 text-rose-950"
      : "border-rose-300/25 bg-rose-300/10 text-rose-50";
  }

  return surfaceTheme === "light"
    ? "border-rose-300 bg-rose-50/90 text-rose-950"
    : "border-rose-300/25 bg-rose-300/10 text-rose-50";
}

export function resolveUpdateResultIconWrapClassName(runState: UpdateRunState, surfaceTheme: SurfaceTheme) {
  if (runState === "success") {
    return surfaceTheme === "light"
      ? "border-emerald-300 bg-white/80 text-emerald-700"
      : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200";
  }

  if (runState === "error") {
    return surfaceTheme === "light"
      ? "border-rose-300 bg-white/80 text-rose-700"
      : "border-rose-300/25 bg-rose-300/10 text-rose-200";
  }

  return surfaceTheme === "light"
    ? "border-rose-300 bg-white/80 text-rose-700"
    : "border-rose-300/25 bg-rose-300/10 text-rose-200";
}

export type OpenClawInstallSummary = {
  label: string;
  detail: string;
  root: string | null;
};

function isLocalPrefixRoot(root: string | null) {
  return Boolean(root && /[\\/]\.openclaw([\\/]|$)/.test(root));
}

function isNodeModulesRoot(root: string | null) {
  return Boolean(root && /[\\/]node_modules[\\/]/.test(root));
}

function formatPackageManagerLabel(packageManager: string | null) {
  return packageManager?.trim() || null;
}

function resolveOpenClawInstallLabel(params: {
  root: string | null;
  installKind: string | null;
  packageManager: string | null;
}) {
  const { root, installKind, packageManager } = params;
  const managerLabel = formatPackageManagerLabel(packageManager);

  if (installKind === "git") {
    return "Git checkout";
  }

  if (installKind === "package") {
    if (isLocalPrefixRoot(root)) {
      return managerLabel ? `Local prefix · ${managerLabel}` : "Local prefix";
    }

    if (isNodeModulesRoot(root)) {
      return managerLabel ? `${managerLabel} package` : "Package install";
    }

    return managerLabel ? `${managerLabel} package` : "Package install";
  }

  if (isLocalPrefixRoot(root)) {
    return managerLabel ? `Local prefix · ${managerLabel}` : "Local prefix";
  }

  if (isNodeModulesRoot(root)) {
    return managerLabel ? `${managerLabel} package` : "Package install";
  }

  if (managerLabel) {
    return `${managerLabel} package`;
  }

  if (root) {
    return "Detected install";
  }

  return "Install unavailable";
}

export function resolveOpenClawInstallSummary(snapshot: Pick<MissionControlSnapshot, "diagnostics">): OpenClawInstallSummary {
  const root = snapshot.diagnostics.updateRoot?.trim() || null;
  const installKind = snapshot.diagnostics.updateInstallKind?.trim().toLowerCase() || null;
  const packageManager = snapshot.diagnostics.updatePackageManager?.trim().toLowerCase() || null;
  const label = resolveOpenClawInstallLabel({
    root,
    installKind,
    packageManager
  });

  const detailParts: string[] = [];

  if (root) {
    detailParts.push(`Install root: ${compactPath(root)}`);
  }

  if (packageManager) {
    detailParts.push(`Updater: ${packageManager}`);
  }

  if (detailParts.length === 0) {
    detailParts.push("Install root unavailable.");
  }

  return {
    label,
    detail: detailParts.join(" · "),
    root
  };
}

export function resolveTaskPrompt(task: WorkItemRecord) {
  if (task.mission?.trim()) {
    return task.mission.trim();
  }

  if (task.title.trim()) {
    return task.title.trim();
  }

  return task.subtitle.trim() || "Continue this task.";
}

export function resolveTaskDispatchStatus(task: WorkItemRecord) {
  return typeof task.metadata.dispatchStatus === "string" ? task.metadata.dispatchStatus : null;
}

export function isTaskAborted(task: WorkItemRecord) {
  const dispatchStatus = resolveTaskDispatchStatus(task);
  const runtimeStatus = task.status as string;
  return (
    dispatchStatus === "cancelled" ||
    dispatchStatus === "aborted" ||
    runtimeStatus === "cancelled" ||
    runtimeStatus === "aborted"
  );
}

export function isTaskAbortable(task: WorkItemRecord) {
  if (isTaskAborted(task)) {
    return false;
  }

  const runtimeStatus = task.status as string;
  return runtimeStatus === "running" || runtimeStatus === "queued";
}

export function mergeSnapshotWithOptimisticTasks(
  snapshot: MissionControlSnapshot,
  optimisticMissionTasks: OptimisticMissionTask[]
) {
  if (optimisticMissionTasks.length === 0) {
    return snapshot;
  }

  const visibleOptimisticTasks = optimisticMissionTasks
    .filter((entry) => !findReplacementTaskForOptimisticTask(snapshot.tasks, entry))
    .map((entry) => entry.task);

  if (visibleOptimisticTasks.length === 0) {
    return snapshot;
  }

  return {
    ...snapshot,
    tasks: [...visibleOptimisticTasks, ...snapshot.tasks]
  };
}

export function findReplacementTaskForOptimisticTask(tasks: WorkItemRecord[], optimisticTask: OptimisticMissionTask) {
  return tasks.find((task) => matchesOptimisticTaskReplacement(task, optimisticTask)) ?? null;
}

export function matchesOptimisticTaskReplacement(task: WorkItemRecord, optimisticTask: OptimisticMissionTask) {
  const dispatchId = optimisticTask.dispatchId?.trim();

  if (!dispatchId) {
    return false;
  }

  return task.dispatchId === dispatchId || task.key === `dispatch:${dispatchId}`;
}

export function createOptimisticMissionTaskRecord(
  event: MissionDispatchStart,
  snapshot: MissionControlSnapshot
): OptimisticMissionTask {
  const submittedAtIso = new Date(event.submittedAt).toISOString();
  const agent = snapshot.agents.find((entry) => entry.id === event.agentId);
  const feedEvent: TaskFeedEvent = {
    id: `optimistic:${event.requestId}:submitted`,
    kind: "user",
    timestamp: submittedAtIso,
    title: "Mission submitted",
    detail: summarizeTaskTitle(event.mission, 220),
    agentId: event.agentId
  };

  return {
    requestId: event.requestId,
    dispatchId: null,
    task: {
      id: `optimistic-task:${event.requestId}`,
      key: `optimistic:${event.requestId}`,
      title: summarizeTaskTitle(event.mission, 86),
      mission: event.mission,
      subtitle: "Sending mission to AgentOS. Waiting for a dispatch id.",
      status: "queued",
      updatedAt: event.submittedAt,
      ageMs: 0,
      workspaceId: event.workspaceId ?? undefined,
      primaryAgentId: event.agentId,
      primaryAgentName: formatAgentDisplayName(agent ?? { name: "OpenClaw" }),
      runtimeIds: [],
      agentIds: [event.agentId],
      sessionIds: [],
      runIds: [],
      runtimeCount: 0,
      updateCount: 0,
      liveRunCount: 0,
      artifactCount: 0,
      warningCount: 0,
      metadata: {
        optimistic: true,
        optimisticRequestId: event.requestId,
        bootstrapStage: "submitting",
        dispatchSubmittedAt: submittedAtIso,
        optimisticEvents: [feedEvent]
      }
    }
  };
}

export function updateOptimisticMissionTask(
  task: WorkItemRecord,
  input: {
    dispatchId?: string;
    status: WorkItemRecord["status"];
    subtitle: string;
    bootstrapStage: string;
    feedEvent: TaskFeedEvent;
  }
): WorkItemRecord {
  const events = readOptimisticTaskEvents(task).concat(input.feedEvent);

  return {
    ...task,
    dispatchId: input.dispatchId ?? task.dispatchId,
    status: input.status,
    subtitle: input.subtitle,
    updatedAt: Date.now(),
    liveRunCount: input.status === "stalled" || input.status === "cancelled" ? 0 : 1,
    warningCount: input.status === "stalled" || input.status === "cancelled" ? 1 : task.warningCount,
    metadata: {
      ...task.metadata,
      bootstrapStage: input.bootstrapStage,
      optimisticEvents: dedupeOptimisticTaskEvents(events)
    }
  };
}

export function readOptimisticTaskEvents(task: WorkItemRecord) {
  const value = task.metadata.optimisticEvents;

  if (!Array.isArray(value)) {
    return [] as TaskFeedEvent[];
  }

  return value.filter(isTaskFeedEvent);
}

export function dedupeOptimisticTaskEvents(events: TaskFeedEvent[]) {
  const byId = new Map<string, TaskFeedEvent>();

  for (const event of events) {
    byId.set(event.id, event);
  }

  return [...byId.values()].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

export function isTaskHiddenByPreferences(
  task: WorkItemRecord,
  hiddenRuntimeIds: string[],
  hiddenTaskKeys: string[],
  lockedTaskKeys: string[]
) {
  const safeHiddenRuntimeIds = Array.isArray(hiddenRuntimeIds) ? hiddenRuntimeIds : [];
  const safeHiddenTaskKeys = Array.isArray(hiddenTaskKeys) ? hiddenTaskKeys : [];
  const safeLockedTaskKeys = Array.isArray(lockedTaskKeys) ? lockedTaskKeys : [];

  if (safeLockedTaskKeys.includes(task.key)) {
    return false;
  }

  if (safeHiddenTaskKeys.includes(task.key)) {
    return true;
  }

  if (task.runtimeIds.length === 0) {
    return false;
  }

  return task.runtimeIds.every((runtimeId) => safeHiddenRuntimeIds.includes(runtimeId));
}

export function isDirectChatRuntime(runtime: { metadata: Record<string, unknown> }) {
  return typeof runtime.metadata.kind === "string" && runtime.metadata.kind === "direct";
}

export function isTaskFeedEvent(value: unknown): value is TaskFeedEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TaskFeedEvent).id === "string" &&
    typeof (value as TaskFeedEvent).kind === "string" &&
    typeof (value as TaskFeedEvent).timestamp === "string" &&
    typeof (value as TaskFeedEvent).title === "string" &&
    typeof (value as TaskFeedEvent).detail === "string"
  );
}

export function summarizeTaskTitle(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}

export function formatGatewayDraft(gatewayUrl: string) {
  return gatewayUrl.replace(/\/$/, "");
}

export function resolveGatewayDraft(snapshot: MissionControlSnapshot) {
  return formatGatewayDraft(snapshot.diagnostics.configuredGatewayUrl || snapshot.diagnostics.gatewayUrl);
}

export function resolveWorkspaceRootDraft(snapshot: MissionControlSnapshot) {
  return compactPath(snapshot.diagnostics.configuredWorkspaceRoot || snapshot.diagnostics.workspaceRoot);
}

export function buildWorkspaceSelectionStorageKey(workspaceRoot: string) {
  return `${workspaceSelectionStorageKeyPrefix}:${workspaceRoot}`;
}

export function serializeWorkspaceSelection(workspaceId: string | null) {
  return workspaceId ?? workspaceSelectionStorageAllValue;
}

export function resolveWorkspaceSelection(
  workspaceIds: string[],
  storedWorkspaceId: string | null,
  currentWorkspaceId: string | null = null
) {
  if (storedWorkspaceId === workspaceSelectionStorageAllValue) {
    return null;
  }

  if (storedWorkspaceId && workspaceIds.includes(storedWorkspaceId)) {
    return storedWorkspaceId;
  }

  if (currentWorkspaceId && workspaceIds.includes(currentWorkspaceId)) {
    return currentWorkspaceId;
  }

  return workspaceIds[0] ?? null;
}

export function shouldDeferWorkspaceSelectionHydration(snapshot: Pick<MissionControlSnapshot, "mode" | "diagnostics">) {
  return snapshot.mode === "fallback" && snapshot.diagnostics.loaded && !snapshot.diagnostics.rpcOk;
}

export function resolveModelOnboardingStartPhase(intent: ModelOnboardingIntent): OpenClawModelOnboardingPhase {
  if (intent === "refresh") {
    return "refreshing";
  }

  if (intent === "discover") {
    return "discovering";
  }

  if (intent === "set-default") {
    return "configuring-default";
  }

  return "detecting";
}

export function resolveModelOnboardingActionCopy(intent: ModelOnboardingIntent) {
  if (intent === "discover") {
    return {
      statusMessage: "Scanning models...",
      successTitle: "Models discovered.",
      errorTitle: "Model discovery failed."
    };
  }

  if (intent === "login-provider") {
    return {
      statusMessage: "Checking auth...",
      successTitle: "Provider connected.",
      errorTitle: "Provider auth needs attention."
    };
  }

  if (intent === "refresh") {
    return {
      statusMessage: "Refreshing...",
      successTitle: "Model setup refreshed.",
      errorTitle: "Model refresh failed."
    };
  }

  if (intent === "set-default") {
    return {
      statusMessage: "Saving default model...",
      successTitle: "Default model saved.",
      errorTitle: "Default model save failed."
    };
  }

  return {
    statusMessage: "Checking models...",
    successTitle: "Model setup ready.",
    errorTitle: "Model setup failed."
  };
}

export function resolveOnboardingAction(snapshot: MissionControlSnapshot) {
  if (!snapshot.diagnostics.installed) {
    return {
      label: "Install OpenClaw",
      description: `Download the CLI and get AgentOS ready. Recommended setup target: v${OPENCLAW_RECOMMENDED_VERSION}.`
    };
  }

  if (isOpenClawOnboardingSystemReady(snapshot)) {
    if (!hasAgentOSWorkspaceSetup(snapshot)) {
      return {
        label: "Continue setup",
        description: "Create the first AgentOS workspace and agent before entering the canvas."
      };
    }

    return {
      label: "Enter AgentOS",
      description: "OpenClaw is online. Runtime checks continue in the background."
    };
  }

  if (!snapshot.diagnostics.loaded) {
    return {
      label: "Prepare local gateway",
      description: "Register and start the local gateway."
    };
  }

  if (!snapshot.diagnostics.rpcOk) {
    return {
      label: "Start OpenClaw",
      description: "Start the local gateway and wait for RPC."
    };
  }

  return {
    label: "Start OpenClaw",
    description: "Start the local gateway and wait for RPC."
  };
}

export function hasAgentOSWorkspaceSetup(snapshot: Pick<MissionControlSnapshot, "workspaces" | "agents">) {
  return (snapshot.workspaces?.length ?? 0) > 0 && (snapshot.agents?.length ?? 0) > 0;
}

export function resolveLaunchpadWorkspaceSetupReadiness(
  snapshot: Pick<MissionControlSnapshot, "workspaces" | "agents">,
  target: Pick<WorkspaceCreateResult, "workspaceId" | "agentIds" | "primaryAgentId"> | null
): LaunchpadWorkspaceSetupReadiness {
  const workspace = target
    ? snapshot.workspaces.find((entry) => entry.id === target.workspaceId) ?? null
    : snapshot.workspaces[0] ?? null;
  const workspaceAgents = workspace
    ? snapshot.agents.filter((agent) => agent.workspaceId === workspace.id)
    : [];
  const expectedAgentIds = target?.agentIds?.filter(Boolean) ?? workspace?.agentIds?.filter(Boolean) ?? [];
  const expectedAgentIdSet = new Set(expectedAgentIds);
  const visibleExpectedAgentCount =
    expectedAgentIdSet.size > 0
      ? workspaceAgents.filter((agent) => expectedAgentIdSet.has(agent.id)).length
      : workspaceAgents.length;
  const expectedAgentCount = Math.max(expectedAgentIdSet.size, workspaceAgents.length > 0 ? 1 : 0);
  const primaryAgentVisible = target?.primaryAgentId
    ? workspaceAgents.some((agent) => agent.id === target.primaryAgentId)
    : workspaceAgents.length > 0;
  const agentsVisible =
    expectedAgentIdSet.size > 0
      ? visibleExpectedAgentCount >= expectedAgentIdSet.size
      : workspaceAgents.length > 0;
  const workspaceVisible = Boolean(workspace);

  return {
    workspaceVisible,
    primaryAgentVisible,
    agentsVisible,
    ready: workspaceVisible && primaryAgentVisible && agentsVisible,
    workspaceName: workspace?.name ?? null,
    workspacePath: workspace?.path ?? null,
    visibleAgentCount: visibleExpectedAgentCount,
    expectedAgentCount
  };
}

export function describeLaunchpadWorkspaceSetupReadiness(readiness: LaunchpadWorkspaceSetupReadiness) {
  if (!readiness.workspaceVisible) {
    return "Waiting for the workspace shell to appear in the AgentOS snapshot.";
  }

  if (!readiness.primaryAgentVisible) {
    return "Workspace shell is visible. Waiting for the starter agent to appear on the canvas.";
  }

  if (!readiness.agentsVisible) {
    return `Starter agent is visible. Waiting for ${Math.max(
      1,
      readiness.expectedAgentCount - readiness.visibleAgentCount
    )} workspace agent${readiness.expectedAgentCount - readiness.visibleAgentCount === 1 ? "" : "s"} to sync.`;
  }

  return "Workspace and starter agent are visible. Opening the AgentOS canvas.";
}

export function buildLaunchpadWorkspaceHandoffProgress(input: {
  progress: OperationProgressSnapshot | null;
  readiness: LaunchpadWorkspaceSetupReadiness;
  state: "syncing" | "ready" | "error";
  errorDetail?: string;
}): OperationProgressSnapshot {
  const handoffPercent = input.state === "ready"
    ? 100
    : input.state === "error"
      ? 100
      : input.readiness.primaryAgentVisible
        ? 82
        : input.readiness.workspaceVisible
          ? 58
          : 34;
  const handoffStatus: OperationProgressStepStatus = input.state === "ready"
    ? "done"
    : input.state === "error"
      ? "error"
      : "active";
  const sourceSteps = (input.progress?.steps ?? []).filter((step) => step.id !== launchpadCanvasHandoffStepId);
  const completedSteps: OperationProgressStepSnapshot[] = sourceSteps.map((step) => ({
    ...step,
    status: "done" as const,
    percent: 100
  }));
  const handoffDetail =
    input.errorDetail ?? describeLaunchpadWorkspaceSetupReadiness(input.readiness);
  const handoffStep: OperationProgressStepSnapshot = {
    id: launchpadCanvasHandoffStepId,
    label: "Opening workspace canvas",
    description: "AgentOS is refreshing the graph and waiting for the starter agent before leaving setup.",
    status: handoffStatus,
    percent: handoffPercent,
    detail: handoffDetail,
    activities: [
      {
        id: "handoff-workspace",
        message: input.readiness.workspaceVisible
          ? "Workspace shell is visible in AgentOS."
          : "Waiting for workspace shell in AgentOS.",
        status: input.readiness.workspaceVisible ? "done" : handoffStatus
      },
      {
        id: "handoff-agent",
        message: input.readiness.primaryAgentVisible
          ? "Starter agent is visible on the canvas."
          : "Waiting for the starter agent card.",
        status: input.readiness.primaryAgentVisible
          ? "done"
          : input.readiness.workspaceVisible
            ? handoffStatus
            : "pending"
      },
      {
        id: "handoff-open",
        message: input.state === "ready"
          ? "Opening the workspace."
          : input.state === "error"
            ? "Canvas handoff needs attention."
            : "Keeping setup open until the graph is usable.",
        status: input.state === "ready"
          ? "done"
          : input.state === "error"
            ? "error"
            : "pending"
      }
    ]
  };
  const steps = [
    ...completedSteps,
    handoffStep
  ];

  return {
    title: input.state === "error" ? "Workspace setup needs attention" : "Opening workspace",
    description: input.state === "ready"
      ? "The workspace and starter agent are ready on the canvas."
      : "AgentOS is waiting for OpenClaw state to sync before showing the canvas.",
    percent: calculateLaunchpadProgressPercent(steps),
    steps
  };
}

function calculateLaunchpadProgressPercent(steps: OperationProgressSnapshot["steps"]) {
  if (steps.length === 0) {
    return 0;
  }

  return Math.round(steps.reduce((sum, step) => sum + step.percent, 0) / steps.length);
}

export function hasWorkspaceBackedModelSetup(snapshot: MissionControlSnapshot) {
  const defaultModel =
    snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
    snapshot.diagnostics.modelReadiness.defaultModel ||
    null;

  return hasAgentOSWorkspaceSetup(snapshot) && (
    Boolean(defaultModel) ||
    Boolean(resolveUsableWorkspaceAgentModel(snapshot))
  );
}

export function shouldShowOnboardingLaunchpad(
  snapshot: MissionControlSnapshot,
  options: {
    hasSeenMissionReady?: boolean;
    modelSwitchSucceeded?: boolean;
  } = {}
) {
  if (!isOpenClawOnboardingSystemReady(snapshot)) {
    return false;
  }

  return (
    Boolean(options.hasSeenMissionReady) ||
    Boolean(options.modelSwitchSucceeded) ||
    hasWorkspaceBackedModelSetup(snapshot)
  );
}

function resolveUsableWorkspaceAgentModel(snapshot: MissionControlSnapshot) {
  return snapshot.agents
    .map((agent) => normalizeModelId(agent.modelId))
    .find((modelId) => modelId && isSnapshotModelUsable(snapshot, modelId));
}

function normalizeModelId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized !== "unassigned" ? normalized : null;
}

function isSnapshotModelUsable(snapshot: MissionControlSnapshot, modelId: string) {
  const model = snapshot.models.find((entry) => entry.id === modelId);

  if (!model) {
    return false;
  }

  return model.missing !== true && model.available !== false;
}
