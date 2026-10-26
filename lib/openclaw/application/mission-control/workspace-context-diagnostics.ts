import type {
  OpenClawAgent,
  RuntimeRecord,
  TaskRecord,
  WorkspaceProject
} from "@/lib/openclaw/types";

const contextSensitiveStatuses = new Set(["queued", "running", "stalled"]);

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
      `workspaceContext: ${countLabel(runtimesMissingWorkspace.length, "runtime")} with missing workspace context (${countLabel(activeRuntimesMissingWorkspace.length, "active record")}). Refresh OpenClaw state before reviewing or continuing those runs.`
    );
  }

  if (tasksMissingWorkspace.length > 0) {
    issues.push(
      `workspaceContext: ${countLabel(tasksMissingWorkspace.length, "task")} with missing workspace context (${countLabel(activeTasksMissingWorkspace.length, "active record")}). Refresh OpenClaw state before reviewing or continuing those tasks.`
    );
  }

  if (runtimeAgentMismatches.length > 0) {
    issues.push(
      `workspaceContext: ${countLabel(runtimeAgentMismatches.length, "runtime")} have workspace metadata that differs from their assigned agent (${countLabel(activeRuntimeAgentMismatches.length, "active record")}). Verify OpenClaw runtime metadata before continuing those runs.`
    );
  }

  if (taskRuntimeMismatches.length > 0) {
    issues.push(
      `workspaceContext: ${countLabel(taskRuntimeMismatches.length, "task")} have runtime workspace metadata that differs from the task workspace (${countLabel(activeTaskRuntimeMismatches.length, "active record")}). Verify linked context before continuing active tasks.`
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
  // Unknown statuses remain conservative; terminal and idle records are kept
  // visible as diagnostics but do not reduce live Gateway readiness.
  return status === undefined || contextSensitiveStatuses.has(status);
}

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
