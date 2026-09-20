import type { AgentRecord, MissionControlSnapshot } from "@/lib/agentos/contracts";
import { formatRelativeTime, formatTokens, resolveRelativeTimeReferenceMs } from "@/lib/openclaw/presenters";

export type AgentDetailSessionView = {
  id: string;
  key: string;
  title: string;
  subtitle: string;
  status: string;
  updatedLabel: string;
  modelLabel: string;
  tokenLabel: string;
  taskIds: string[];
  source: "runtime" | "task";
};

export type AgentDetailActivityView = {
  id: string;
  title: string;
  detail: string;
  status: string;
  updatedLabel: string;
  taskId?: string;
  sessionId?: string;
};

export function resolveAgentDetailWorkspace(
  snapshot: MissionControlSnapshot,
  agent: AgentRecord
) {
  return snapshot.workspaces.find((workspace) => workspace.id === agent.workspaceId) ?? null;
}

export function buildAgentDetailSessions(
  snapshot: MissionControlSnapshot,
  agentId: string
): AgentDetailSessionView[] {
  const referenceMs = resolveRelativeTimeReferenceMs(snapshot.generatedAt);
  const agentRuntimes = snapshot.runtimes
    .filter((runtime) => runtime.agentId === agentId)
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  const tasks = snapshot.tasks.filter((task) =>
    task.primaryAgentId === agentId || task.agentIds.includes(agentId)
  );
  const sessions = new Map<string, AgentDetailSessionView>();

  for (const runtime of agentRuntimes) {
    const key = runtime.key || runtime.sessionId || runtime.id;
    sessions.set(key, {
      id: runtime.sessionId || runtime.id,
      key,
      title: runtime.title || "OpenClaw session",
      subtitle: runtime.subtitle || runtime.source,
      status: runtime.status,
      updatedLabel: formatRelativeTime(runtime.updatedAt, referenceMs),
      modelLabel: runtime.modelId || "Inherited model",
      tokenLabel: formatTokens(runtime.tokenUsage?.total),
      taskIds: runtime.taskId ? [runtime.taskId] : [],
      source: "runtime"
    });
  }

  for (const task of tasks) {
    for (const sessionId of task.sessionIds) {
      const current = Array.from(sessions.values()).find((entry) => entry.id === sessionId || entry.key === sessionId);
      if (current) {
        current.taskIds = Array.from(new Set([...current.taskIds, task.id]));
        continue;
      }

      sessions.set(sessionId, {
        id: sessionId,
        key: sessionId,
        title: task.title || "OpenClaw session",
        subtitle: "Referenced by a task record",
        status: task.status,
        updatedLabel: formatRelativeTime(task.updatedAt, referenceMs),
        modelLabel: "Inherited model",
        tokenLabel: formatTokens(task.tokenUsage?.total),
        taskIds: [task.id],
        source: "task"
      });
    }
  }

  return Array.from(sessions.values()).slice(0, 24);
}

export function buildAgentDetailActivity(
  snapshot: MissionControlSnapshot,
  agentId: string
): AgentDetailActivityView[] {
  const referenceMs = resolveRelativeTimeReferenceMs(snapshot.generatedAt);
  const tasks = snapshot.tasks
    .filter((task) => task.primaryAgentId === agentId || task.agentIds.includes(agentId))
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  const runtimes = snapshot.runtimes
    .filter((runtime) => runtime.agentId === agentId)
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  const activity: AgentDetailActivityView[] = [];

  for (const task of tasks) {
    activity.push({
      id: `task:${task.id}`,
      title: task.title || task.mission || "Untitled task",
      detail: task.subtitle || task.mission || "Task record from OpenClaw runtime evidence.",
      status: task.status,
      updatedLabel: formatRelativeTime(task.updatedAt, referenceMs),
      taskId: task.id,
      sessionId: task.sessionIds[0]
    });
  }

  for (const runtime of runtimes) {
    if (runtime.taskId || activity.some((entry) => entry.sessionId === runtime.sessionId)) {
      continue;
    }

    activity.push({
      id: `runtime:${runtime.id}`,
      title: runtime.title || "Runtime activity",
      detail: runtime.subtitle || "Runtime evidence from OpenClaw.",
      status: runtime.status,
      updatedLabel: formatRelativeTime(runtime.updatedAt, referenceMs),
      sessionId: runtime.sessionId
    });
  }

  return activity.slice(0, 8);
}

export function resolveAgentCurrentWork(agent: AgentRecord, snapshot: MissionControlSnapshot) {
  const runtime = snapshot.runtimes
    .filter((entry) => entry.agentId === agent.id)
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))[0];
  const task = snapshot.tasks.find((entry) =>
    entry.primaryAgentId === agent.id && (entry.status === "running" || entry.status === "queued")
  );

  return {
    label: agent.currentAction?.trim() || runtime?.title || task?.title || "No active work reported",
    detail: runtime?.subtitle || task?.subtitle || "Current work is limited to confirmed OpenClaw runtime evidence.",
    runtimeId: runtime?.id ?? null,
    taskId: task?.id ?? runtime?.taskId ?? null,
    status: runtime?.status || task?.status || agent.status
  };
}
