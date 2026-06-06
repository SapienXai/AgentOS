import type {
  OpenClawAgent,
  RuntimeRecord,
  TaskRecord,
  WorkspaceProject
} from "@/lib/openclaw/types";

export function buildWorkspaceContextDiagnosticIssues(input: {
  workspaces: WorkspaceProject[];
  agents: OpenClawAgent[];
  runtimes: RuntimeRecord[];
  tasks: TaskRecord[];
}) {
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

  if (runtimesMissingWorkspace.length > 0) {
    issues.push(
      `workspaceContext: ${countLabel(runtimesMissingWorkspace.length, "runtime")} with missing workspace context. Refresh OpenClaw state before reviewing or continuing those runs.`
    );
  }

  if (tasksMissingWorkspace.length > 0) {
    issues.push(
      `workspaceContext: ${countLabel(tasksMissingWorkspace.length, "task")} with missing workspace context. Refresh OpenClaw state before reviewing or continuing those tasks.`
    );
  }

  if (runtimeAgentMismatches.length > 0) {
    issues.push(
      `workspaceContext: ${countLabel(runtimeAgentMismatches.length, "runtime")} with workspace metadata that differs from their assigned agent. Verify OpenClaw runtime metadata before continuing those runs.`
    );
  }

  if (taskRuntimeMismatches.length > 0) {
    issues.push(
      `workspaceContext: ${countLabel(taskRuntimeMismatches.length, "task")} with runtime workspace metadata that differs from the task workspace. Verify the linked workspace before reviewing results.`
    );
  }

  return issues;
}

function countLabel(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
