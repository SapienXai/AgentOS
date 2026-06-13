import { createHash } from "node:crypto";

import { compactMissionText } from "@/lib/openclaw/presenters";
import type { AgentInboxItem, OpenClawAgent, RuntimeRecord, TaskRecord } from "@/lib/openclaw/types";

const explicitHandoffKeys = [
  "handoff",
  "handoffId",
  "handoffResult",
  "handoffSummary",
  "delegated",
  "delegationId",
  "delegatedByAgentId",
  "delegatedFromAgentId",
  "assignedByAgentId",
  "sourceAgentId",
  "fromAgentId",
  "requestingAgentId",
  "parentAgentId",
  "operatorVisible",
  "operatorVisibleResult",
  "notifyOperator"
];

export function buildAgentInboxItems(
  tasks: readonly TaskRecord[],
  runtimes: readonly RuntimeRecord[],
  agents: readonly OpenClawAgent[]
): AgentInboxItem[] {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const runtimesById = new Map(runtimes.map((runtime) => [runtime.id, runtime]));
  const items = new Map<string, AgentInboxItem>();

  for (const task of tasks) {
    const item = buildTaskInboxItem(task, runtimesById, agentsById);
    if (item) {
      items.set(item.id, item);
    }
  }

  for (const runtime of runtimes) {
    const item = buildRuntimeInboxItem(runtime, agentsById);
    if (item && !items.has(item.id)) {
      items.set(item.id, item);
    }
  }

  return [...items.values()]
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
    .slice(0, 100);
}

function buildTaskInboxItem(
  task: TaskRecord,
  runtimesById: Map<string, RuntimeRecord>,
  agentsById: Map<string, OpenClawAgent>
): AgentInboxItem | null {
  const agentId = task.primaryAgentId ?? task.agentIds[0] ?? null;
  if (!agentId || !isTerminalStatus(task.status)) {
    return null;
  }

  const taskRuntimes = task.runtimeIds
    .map((runtimeId) => runtimesById.get(runtimeId))
    .filter((runtime): runtime is RuntimeRecord => Boolean(runtime));
  const sourceAgentId = readAgentIdFromTask(task) ?? taskRuntimes.map(readAgentIdFromRuntime).find(Boolean) ?? null;
  const hasExplicitHandoff = hasExplicitHandoffEvidence(task.metadata) ||
    taskRuntimes.some((runtime) => hasExplicitHandoffEvidence(runtime.metadata));

  if (!hasExplicitHandoff || !hasOperatorVisibleResult(task, taskRuntimes)) {
    return null;
  }

  const runtime = task.primaryRuntimeId ? runtimesById.get(task.primaryRuntimeId) ?? taskRuntimes[0] : taskRuntimes[0];
  const summary = readTaskResultText(task, taskRuntimes);
  if (!summary) {
    return null;
  }

  return {
    id: stableInboxId(["task", task.id, agentId]),
    agentId,
    workspaceId: task.workspaceId,
    kind: "handoff-result",
    status: task.status,
    title: compactMissionText(task.title || task.mission || "Handoff result", 70) || "Handoff result",
    summary,
    sourceAgentId: sourceAgentId ?? undefined,
    sourceAgentName: sourceAgentId ? agentsById.get(sourceAgentId)?.name ?? null : undefined,
    taskId: task.id,
    runtimeId: runtime?.id,
    sessionId: task.sessionIds[0] ?? runtime?.sessionId,
    runId: task.runIds[0] ?? runtime?.runId,
    updatedAt: task.updatedAt,
    provenance: "openclaw-task"
  };
}

function buildRuntimeInboxItem(
  runtime: RuntimeRecord,
  agentsById: Map<string, OpenClawAgent>
): AgentInboxItem | null {
  if (!runtime.agentId) {
    return null;
  }

  const hasAgentToAgentEvidence = hasExplicitHandoffEvidence(runtime.metadata) ||
    runtime.metadata.interSessionMessage === true ||
    runtime.metadata.agentToAgentMessage === true ||
    runtime.toolNames?.includes("sessions_send") === true;

  if (
    (runtime.metadata.origin === "agent-chat" || runtime.metadata.origin === "agentos-direct-chat") &&
    !hasAgentToAgentEvidence
  ) {
    return null;
  }

  if (!isTerminalStatus(runtime.status) && !hasAgentToAgentEvidence) {
    return null;
  }

  const hasExplicitHandoff = hasExplicitHandoffEvidence(runtime.metadata) || hasAgentToAgentEvidence;
  if (!hasExplicitHandoff) {
    return null;
  }

  const summary = readRuntimeResultText(runtime);
  if (!summary) {
    return null;
  }

  const sourceAgentId = readAgentIdFromRuntime(runtime);

  return {
    id: stableInboxId(["runtime", runtime.id, runtime.agentId]),
    agentId: runtime.agentId,
    workspaceId: runtime.workspaceId,
    kind: runtime.status === "completed" ? "handoff-result" : "handoff-update",
    status: runtime.status,
    title: compactMissionText(runtime.title || "OpenClaw agent result", 70) || "OpenClaw agent result",
    summary,
    sourceAgentId: sourceAgentId ?? undefined,
    sourceAgentName: sourceAgentId ? agentsById.get(sourceAgentId)?.name ?? null : undefined,
    runtimeId: runtime.id,
    sessionId: runtime.sessionId,
    runId: runtime.runId,
    updatedAt: runtime.updatedAt,
    provenance: "openclaw-runtime"
  };
}

function hasExplicitHandoffEvidence(metadata: Record<string, unknown>) {
  return explicitHandoffKeys.some((key) => {
    const value = metadata[key];
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value === "string") {
      return value.trim().length > 0;
    }

    return value !== undefined && value !== null;
  });
}

function hasOperatorVisibleResult(task: TaskRecord, runtimes: RuntimeRecord[]) {
  if (readBooleanMetadata(task.metadata, "notifyOperator") || readBooleanMetadata(task.metadata, "operatorVisible")) {
    return true;
  }

  return Boolean(readTaskResultText(task, runtimes));
}

function readTaskResultText(task: TaskRecord, runtimes: RuntimeRecord[]) {
  return readStringMetadata(task.metadata, "handoffResult") ??
    readStringMetadata(task.metadata, "handoffSummary") ??
    readStringMetadata(task.metadata, "resultPreview") ??
    runtimes.map(readRuntimeResultText).find(Boolean) ??
    null;
}

function readRuntimeResultText(runtime: RuntimeRecord) {
  return readStringMetadata(runtime.metadata, "handoffResult") ??
    readStringMetadata(runtime.metadata, "handoffSummary") ??
    readStringMetadata(runtime.metadata, "resultPreview") ??
    (isMeaningfulInboxSummary(runtime.subtitle) ? runtime.subtitle.trim() : null);
}

function readAgentIdFromTask(task: TaskRecord) {
  return readStringMetadata(task.metadata, "sourceAgentId") ??
    readStringMetadata(task.metadata, "fromAgentId") ??
    readStringMetadata(task.metadata, "requestingAgentId") ??
    readStringMetadata(task.metadata, "parentAgentId") ??
    readStringMetadata(task.metadata, "delegatedByAgentId") ??
    readStringMetadata(task.metadata, "assignedByAgentId");
}

function readAgentIdFromRuntime(runtime: RuntimeRecord) {
  return readStringMetadata(runtime.metadata, "sourceAgentId") ??
    readStringMetadata(runtime.metadata, "fromAgentId") ??
    readStringMetadata(runtime.metadata, "requestingAgentId") ??
    readStringMetadata(runtime.metadata, "parentAgentId") ??
    readStringMetadata(runtime.metadata, "delegatedByAgentId") ??
    readStringMetadata(runtime.metadata, "assignedByAgentId");
}

function readStringMetadata(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readBooleanMetadata(metadata: Record<string, unknown>, key: string) {
  return metadata[key] === true || metadata[key] === "true";
}

function isTerminalStatus(status: TaskRecord["status"] | RuntimeRecord["status"]) {
  return status === "completed" || status === "stalled" || status === "cancelled";
}

function isMeaningfulInboxSummary(value: string | null | undefined) {
  const normalized = value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
  return Boolean(normalized) &&
    normalized !== "session.message" &&
    normalized !== "sessions.changed" &&
    normalized !== "chat";
}

function stableInboxId(parts: string[]) {
  return `agent-inbox:${createHash("sha1").update(parts.join(":")).digest("hex").slice(0, 16)}`;
}
