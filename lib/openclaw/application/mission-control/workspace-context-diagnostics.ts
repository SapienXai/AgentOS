import type {
  OpenClawAgent,
  RuntimeRecord,
  TaskRecord,
  WorkspaceProject
} from "@/lib/openclaw/types";

const nonLiveContextStatuses = new Set(["idle", "completed", "stalled", "cancelled"]);

export type WorkspaceContextDiagnosticReport = {
  issues: string[];
  hasActiveIssues: boolean;
};

export function buildWorkspaceContextDiagnostics(input: {
  workspaces: WorkspaceProject[];
  agents: OpenClawAgent[];
  runtimes: RuntimeRecord[];
  tasks: TaskRecord[];
}): WorkspaceContextDiagnosticReport {
  const workspaceIds = new Set(input.workspaces.map((workspace) => workspace.id));
  const agentWorkspaceById = new Map(input.agents.map((agent) => [agent.id, agent.workspaceId]));
  const runtimeById = new Map(input.runtimes.map((runtime) => [runtime.id, runtime]));
  const issues: string[] = [];

  const runtimesMissingWorkspace = input.runtimes.filter(
    (runtime) => Boolean(runtime.workspaceId) && !workspaceIds.has(runtime.workspaceId as string)
  );
  const tasksMissingWorkspace = input.tasks.filter(
    (task) => Boolean(task.workspaceId) && !workspaceIds.has(task.workspaceId as string)
  );
  const runtimeAgentMismatches = input.runtimes.filter((runtime) => {
    if (!runtime.workspaceId || !runtime.agentId) {
      return false;
    }

    const agentWorkspaceId = agentWorkspaceById.get(runtime.agentId);
    return Boolean(agentWorkspaceId && agentWorkspaceId !== runtime.workspaceId);
  });
  const taskRuntimeMismatches = input.tasks.filter((task) => {
    if (!task.workspaceId) {
      return false;
    }

    return task.runtimeIds.some((runtimeId) => {
      const runtimeWorkspaceId = runtimeById.get(runtimeId)?.workspaceId;
      return Boolean(runtimeWorkspaceId && runtimeWorkspaceId !== task.workspaceId);
    });
  });

  const activeRuntimesMissingWorkspace = runtimesMissingWorkspace.filter((runtime) =>
    needsWorkspaceContextReview(runtime.status)
  );
  const activeTasksMissingWorkspace = tasksMissingWorkspace.filter((task) =>
    needsWorkspaceContextReview(task.status)
  );
  const activeRuntimeAgentMismatches = runtimeAgentMismatches.filter((runtime) =>
    needsWorkspaceContextReview(runtime.status)
  );
  const activeTaskRuntimeMismatches = taskRuntimeMismatches.filter((task) =>
    needsWorkspaceContextReview(task.status) || task.runtimeIds.some((runtimeId) => {
      const runtime = runtimeById.get(runtimeId);
      return Boolean(runtime && needsWorkspaceContextReview(runtime.status));
    })
  );

  if (runtimesMissingWorkspace.length > 0) {
    issues.push(
      `workspaceContext: ${countLabel(runtimesMissingWorkspace.length, "runtime")} with missing workspace context (${countLabel(activeRuntimesMissingWorkspace.length, "active record")}). ${activeRuntimesMissingWorkspace.length > 0 ? "Refresh OpenClaw state before reviewing or continuing those runs." : "No live runs are affected; verify historical context before continuing any of them."}`
    );
  }

  if (tasksMissingWorkspace.length > 0) {
    issues.push(
      `workspaceContext: ${countLabel(tasksMissingWorkspace.length, "task")} with missing workspace context (${countLabel(activeTasksMissingWorkspace.length, "active record")}). ${activeTasksMissingWorkspace.length > 0 ? "Refresh OpenClaw state before reviewing or continuing those tasks." : "No live tasks are affected; verify historical context before continuing any of them."}`
    );
  }

  if (runtimeAgentMismatches.length > 0) {
    issues.push(
      `workspaceContext: ${countLabel(runtimeAgentMismatches.length, "runtime")} ${runtimeAgentMismatches.length === 1 ? "has" : "have"} workspace metadata that differs from its assigned agent (${countLabel(activeRuntimeAgentMismatches.length, "active record")}). ${activeRuntimeAgentMismatches.length > 0 ? "Verify OpenClaw runtime metadata before continuing those runs." : "No live runs are affected; historical metadata remains available for diagnostics."}`
    );
  }

  if (taskRuntimeMismatches.length > 0) {
    issues.push(
      `workspaceContext: ${countLabel(taskRuntimeMismatches.length, "task")} have runtime workspace metadata that differs from the task workspace (${countLabel(activeTaskRuntimeMismatches.length, "active record")}). ${activeTaskRuntimeMismatches.length > 0 ? "Verify linked context before continuing active tasks." : "No live tasks are affected; historical metadata remains available for diagnostics."}`
    );
  }

  return {
    issues,
    hasActiveIssues: [
      activeRuntimesMissingWorkspace,
      activeTasksMissingWorkspace,
      activeRuntimeAgentMismatches,
      activeTaskRuntimeMismatches
    ].some((records) => records.length > 0)
  };
}

export function buildWorkspaceContextDiagnosticIssues(input: {
  workspaces: WorkspaceProject[];
  agents: OpenClawAgent[];
  runtimes: RuntimeRecord[];
  tasks: TaskRecord[];
}) {
  return buildWorkspaceContextDiagnostics(input).issues;
}

function needsWorkspaceContextReview(status: string | undefined) {
  // Only queued and running work reduces live Gateway readiness. Stalled and
  // terminal records remain visible as diagnostics but are no longer live.
  // Unknown statuses stay conservative because their liveness is unproven.
  return status === undefined || !nonLiveContextStatuses.has(status.toLowerCase());
}

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
