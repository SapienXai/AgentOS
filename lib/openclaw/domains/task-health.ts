import type { OpenClawTaskListPayload, StatusPayload } from "@/lib/openclaw/client/gateway-client";
import type {
  OpenClawAgent,
  TaskAuditSummary,
  TaskHealthSummary,
  TaskRunIssueGroup
} from "@/lib/openclaw/types";

const historicalIssueStatuses = new Set(["failed", "timed_out", "lost"]);
const activeStatuses = new Set(["queued", "running"]);

export function buildTaskHealthSummary(input: {
  status?: StatusPayload | null;
  taskList?: OpenClawTaskListPayload | null;
  agents?: OpenClawAgent[];
  generatedAt?: string;
  taskListAvailable?: boolean;
  statusAvailable?: boolean;
  statusTransport?: TaskHealthSummary["source"]["status"];
  taskListTransport?: TaskHealthSummary["source"]["taskList"];
  auditTransport?: TaskHealthSummary["source"]["audit"];
  fallbackReason?: string | null;
}): TaskHealthSummary {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const tasks = readTaskEntries(input.taskList);
  const byStatus = readNumberRecord(input.status?.tasks?.byStatus);
  const active = {
    active: readNumber(input.status?.tasks?.active) ?? countStatuses(tasks, activeStatuses),
    queued: byStatus.queued ?? countStatus(tasks, "queued"),
    running: byStatus.running ?? countStatus(tasks, "running")
  };
  const audit = buildAuditSummary(input.status?.taskAudit);
  const historical = {
    failed: byStatus.failed ?? countStatus(tasks, "failed"),
    timedOut: byStatus.timed_out ?? countStatus(tasks, "timed_out"),
    lost: byStatus.lost ?? countStatus(tasks, "lost"),
    cancelled: byStatus.cancelled ?? countStatus(tasks, "cancelled"),
    succeeded: byStatus.succeeded ?? countStatus(tasks, "succeeded"),
    totalTracked: readNumber(input.status?.tasks?.total) ?? tasks.length
  };
  const historicalIssueCount = historical.failed + historical.timedOut + historical.lost;
  const currentReasons = buildCurrentIssueReasons(audit);
  const agentNameById = new Map((input.agents ?? []).map((agent) => [agent.id, agent.name || agent.id]));
  const groups = buildTaskRunIssueGroups(tasks, agentNameById);

  return {
    generatedAt,
    source: {
      status: input.statusTransport ?? (input.statusAvailable === false ? "unknown" : "gateway-native"),
      taskList: input.taskListTransport ?? (input.taskListAvailable === false ? "unknown" : "gateway-native"),
      audit: input.auditTransport ?? (input.status?.taskAudit ? "gateway-native" : "unknown"),
      fallbackReason: input.fallbackReason ?? null
    },
    active,
    currentIssue: {
      count: audit.errors + audit.warnings,
      severity: audit.errors > 0 ? "critical" : audit.warnings > 0 ? "warning" : audit.state === "unknown" ? "unknown" : "healthy",
      reasons: currentReasons
    },
    historical: {
      ...historical,
      issueCount: historicalIssueCount
    },
    audit,
    groups,
    explanation: resolveTaskHealthExplanation({
      activeCount: active.active + active.queued + active.running,
      audit,
      historicalIssueCount
    })
  };
}

function buildAuditSummary(audit: StatusPayload["taskAudit"] | undefined): TaskAuditSummary {
  if (!audit) {
    return {
      state: "unknown",
      total: 0,
      warnings: 0,
      errors: 0,
      byCode: {},
      explanation: "Task audit state is not reported by the current OpenClaw status payload."
    };
  }

  const total = readNumber(audit.total) ?? 0;
  const warnings = readNumber(audit.warnings) ?? 0;
  const errors = readNumber(audit.errors) ?? 0;
  const state = errors > 0 || warnings > 0 || total > 0 ? "findings" : "clean";

  return {
    state,
    total,
    warnings,
    errors,
    byCode: readNumberRecord(audit.byCode),
    explanation:
      state === "clean"
        ? "Audit found no repairable task state issues."
        : `Audit reported ${errors} error${errors === 1 ? "" : "s"} and ${warnings} warning${warnings === 1 ? "" : "s"}.`
  };
}

function buildCurrentIssueReasons(audit: TaskAuditSummary) {
  const reasons: string[] = [];

  if (audit.errors > 0) {
    reasons.push(`${audit.errors} task audit error${audit.errors === 1 ? "" : "s"}`);
  }

  if (audit.warnings > 0) {
    reasons.push(`${audit.warnings} task audit warning${audit.warnings === 1 ? "" : "s"}`);
  }

  return reasons;
}

function buildTaskRunIssueGroups(
  tasks: Record<string, unknown>[],
  agentNameById: Map<string, string>
): TaskRunIssueGroup[] {
  const issueTasks = tasks.filter((task) => historicalIssueStatuses.has(readStatus(task)));
  const issueGroupKeys = new Set(issueTasks.map(groupKeyForTask));
  const grouped = new Map<string, Record<string, unknown>[]>();

  for (const task of tasks) {
    const groupKey = groupKeyForTask(task);
    if (!issueGroupKeys.has(groupKey)) {
      continue;
    }

    const entries = grouped.get(groupKey) ?? [];
    entries.push(task);
    grouped.set(groupKey, entries);
  }

  return Array.from(grouped.entries())
    .map(([id, entries]) => buildTaskRunIssueGroup(id, entries, agentNameById))
    .sort((left, right) => Date.parse(right.lastErrorAt ?? "") - Date.parse(left.lastErrorAt ?? ""));
}

function buildTaskRunIssueGroup(
  id: string,
  entries: Record<string, unknown>[],
  agentNameById: Map<string, string>
): TaskRunIssueGroup {
  const issueEntries = entries.filter((entry) => historicalIssueStatuses.has(readStatus(entry)));
  const latestIssue = issueEntries
    .slice()
    .sort((left, right) => readTaskTime(right) - readTaskTime(left))[0] ?? issueEntries[0] ?? entries[0];
  const agentId = readString(latestIssue?.agentId) ?? readString(entries.find((entry) => readString(entry.agentId))?.agentId);

  return {
    id,
    agentId,
    agentName: agentId ? agentNameById.get(agentId) ?? agentId : null,
    runtime: readString(latestIssue?.runtime) ?? "unknown",
    sourceId: readString(latestIssue?.sourceId),
    ownerKey: readString(latestIssue?.ownerKey),
    requesterSessionKey: readString(latestIssue?.requesterSessionKey),
    childSessionKey: readString(latestIssue?.childSessionKey),
    statusCounts: countTaskStatuses(entries),
    issueCount: issueEntries.length,
    lastErrorAt: readTaskIsoTime(latestIssue),
    lastSummary: readString(latestIssue?.progressSummary) ?? readString(latestIssue?.label) ?? readString(latestIssue?.task),
    lastError: readString(latestIssue?.error),
    taskIds: uniqueStrings(entries.map((entry) => readString(entry.taskId))),
    runIds: uniqueStrings(entries.map((entry) => readString(entry.runId))),
    sessionKeys: uniqueStrings(entries.flatMap((entry) => [
      readString(entry.requesterSessionKey),
      readString(entry.ownerKey),
      readString(entry.childSessionKey)
    ]))
  };
}

function groupKeyForTask(task: Record<string, unknown>) {
  return [
    readString(task.agentId) ?? "unknown-agent",
    readString(task.runtime) ?? "unknown-runtime",
    readString(task.sourceId) ?? readString(task.ownerKey) ?? readString(task.requesterSessionKey) ?? readString(task.childSessionKey) ?? "unknown-source"
  ].join("::");
}

function resolveTaskHealthExplanation(input: {
  activeCount: number;
  audit: TaskAuditSummary;
  historicalIssueCount: number;
}) {
  if (input.audit.errors > 0 || input.audit.warnings > 0) {
    return "Current task audit findings need operator review.";
  }

  if (input.activeCount === 0 && input.audit.state === "clean" && input.historicalIssueCount > 0) {
    return "Current runtime healthy, but past task failures were recorded.";
  }

  if (input.activeCount === 0 && input.audit.state === "clean") {
    return "No active task issues.";
  }

  return "Active task work is present. No repairable audit findings were reported.";
}

function readTaskEntries(payload: OpenClawTaskListPayload | null | undefined) {
  return Array.isArray(payload?.tasks) ? payload.tasks.filter(isRecord) : [];
}

function countStatus(tasks: Record<string, unknown>[], status: string) {
  return tasks.filter((task) => readStatus(task) === status).length;
}

function countStatuses(tasks: Record<string, unknown>[], statuses: Set<string>) {
  return tasks.filter((task) => statuses.has(readStatus(task))).length;
}

function countTaskStatuses(tasks: Record<string, unknown>[]) {
  const counts: Record<string, number> = {};

  for (const task of tasks) {
    const status = readStatus(task);
    counts[status] = (counts[status] ?? 0) + 1;
  }

  return counts;
}

function readStatus(task: Record<string, unknown>) {
  return readString(task.status) ?? readString(task.state) ?? "unknown";
}

function readTaskIsoTime(task: Record<string, unknown> | undefined) {
  if (!task) {
    return null;
  }

  const value =
    readString(task.endedAt) ??
    readString(task.lastEventAt) ??
    readString(task.startedAt) ??
    readString(task.createdAt);

  if (value) {
    return value;
  }

  const timestamp = readTaskTime(task);
  return timestamp > 0 ? new Date(timestamp).toISOString() : null;
}

function readTaskTime(task: Record<string, unknown>) {
  const candidates = [task.endedAt, task.lastEventAt, task.startedAt, task.createdAt];

  for (const candidate of candidates) {
    const value = readString(candidate);
    const parsed = value ? Date.parse(value) : NaN;

    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function readNumberRecord(value: unknown) {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, readNumber(entry)])
      .filter((entry): entry is [string, number] => typeof entry[1] === "number")
  );
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
