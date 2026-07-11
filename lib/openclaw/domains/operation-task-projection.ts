import type { OperationJob, OperationRun, OperationsSnapshot } from "@/lib/agentos/operations/types";
import type { OpenClawAgent, TaskRecord } from "@/lib/openclaw/types";

/** A read-only task-card projection of OpenClaw cron jobs. It never schedules work. */
export function buildOperationTaskProjections(snapshot: OperationsSnapshot, agents: OpenClawAgent[]): TaskRecord[] {
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
  return snapshot.jobs.map((job) => buildOperationTaskProjection(job, agentNames));
}

/**
 * Reconciles a Gateway runtime task with its cron job projection. A cron run is
 * represented by both data sources, but operators must see one card and the
 * cron run history is authoritative for terminal success or failure.
 */
export function mergeOperationTaskProjections(
  snapshot: OperationsSnapshot,
  runtimeTasks: TaskRecord[],
  agents: OpenClawAgent[]
): TaskRecord[] {
  const jobsById = new Map(snapshot.jobs.map((job) => [job.id, job]));
  const runtimeJobIds = new Set<string>();
  const mergedRuntimeTasks = runtimeTasks.map((task) => {
    const jobId = operationJobIdForRuntimeTask(task, jobsById);
    if (!jobId) return task;
    runtimeJobIds.add(jobId);
    const job = jobsById.get(jobId)!;
    const latestRun = latestOperationRun(snapshot.runs, jobId);
    const status = terminalTaskStatus(job, latestRun) ?? task.status;
    const detail = latestRun?.status === "error" ? latestRun.error ?? "OpenClaw cron run failed."
      : latestRun?.status === "ok" ? latestRun.output ?? "OpenClaw cron run completed."
      : null;
    return {
      ...task,
      status,
      subtitle: detail ?? `${task.subtitle} · ${describeSchedule(job)}`,
      liveRunCount: status === "running" ? task.liveRunCount : 0,
      warningCount: Math.max(task.warningCount, job.health.degraded || status === "stalled" ? 1 : 0),
      metadata: {
        ...task.metadata,
        ...operationMetadata(job),
        operationRunId: latestRun?.id ?? null,
        operationRunStatus: latestRun?.status ?? null,
        operationLastError: latestRun?.error ?? null
      }
    };
  });
  const projections = buildOperationTaskProjections(snapshot, agents);
  return [...mergedRuntimeTasks, ...projections.filter((task) => !runtimeJobIds.has(String(task.metadata.operationJobId)))];
}

function buildOperationTaskProjection(job: OperationJob, agentNames: Map<string, string>): TaskRecord {
  const updatedAt = job.lastRunAt ? Date.parse(job.lastRunAt) : job.nextRunAt ? Date.parse(job.nextRunAt) : null;
  return {
    id: `operation:${job.id}`, key: `openclaw-cron:${job.id}`, title: job.name, mission: job.prompt,
    subtitle: describeSchedule(job), status: taskStatus(job), updatedAt: Number.isFinite(updatedAt) ? updatedAt : null, ageMs: null,
    workspaceId: job.workspaceId ?? undefined, primaryAgentId: job.agentId ?? undefined,
    primaryAgentName: job.agentId ? agentNames.get(job.agentId) ?? job.agentId : null,
    runtimeIds: [], agentIds: job.agentId ? [job.agentId] : [], sessionIds: [], runIds: [], runtimeCount: 0, updateCount: 0,
    liveRunCount: job.status === "running" ? 1 : 0, artifactCount: 0, warningCount: job.health.degraded ? 1 : 0,
    metadata: operationMetadata(job)
  };
}

function operationMetadata(job: OperationJob) {
  return { source: "openclaw-cron", operationJobId: job.id, scheduleLabel: describeSchedule(job), scheduledAt: job.nextRunAt,
    dueLabel: job.nextRunAt ? `Next run ${new Date(job.nextRunAt).toLocaleString()}` : "No next run reported", cronExpression: job.trigger?.kind === "cron" ? job.trigger.expression : null,
    timezone: job.trigger?.kind === "cron" ? job.trigger.timezone : null, lastRunStatus: job.lastRunStatus, operationStatus: job.status,
    recurrence: job.trigger?.kind ?? null, concurrency: job.safety?.concurrency ?? null, nextRunAt: job.nextRunAt,
    resultPreview: job.latestOutput ?? null, openClawSessionKey: job.sessionKey ?? null, openClawSessionId: job.sessionId ?? null,
    operationFeed: job.recentResults?.map((result) => ({ id: `operation:${job.id}:${result.id}`, kind: "assistant", timestamp: result.timestamp, title: "Scheduled result", detail: result.text })) ?? [] };
}

function operationJobIdForRuntimeTask(task: TaskRecord, jobsById: Map<string, OperationJob>) {
  const direct = typeof task.metadata.operationJobId === "string" ? task.metadata.operationJobId : null;
  if (direct && jobsById.has(direct)) return direct;
  const runIds = [...task.runIds, typeof task.metadata.openClawRunId === "string" ? task.metadata.openClawRunId : ""];
  return [...jobsById.keys()].find((jobId) => runIds.some((runId) => runId.startsWith(`cron:${jobId}:`))) ?? null;
}

function latestOperationRun(runs: OperationRun[], jobId: string) {
  return runs.filter((run) => run.jobId === jobId).sort((left, right) => Date.parse(right.endedAt ?? right.startedAt ?? "") - Date.parse(left.endedAt ?? left.startedAt ?? ""))[0] ?? null;
}

function terminalTaskStatus(job: OperationJob, latestRun: OperationRun | null): TaskRecord["status"] | null {
  if (latestRun?.status === "error" || job.status === "failed") return "stalled";
  if (latestRun?.status === "ok" && job.trigger?.kind === "at") return "completed";
  if (job.status === "completed") return "completed";
  return null;
}

function taskStatus(job: OperationJob): TaskRecord["status"] {
  if (job.status === "running") return "running";
  if (job.status === "failed") return "stalled";
  if (job.status === "paused") return "cancelled";
  if (job.status === "completed") return "completed";
  return "queued";
}

export function describeSchedule(job: OperationJob) {
  if (!job.trigger) return "OpenClaw schedule unavailable";
  if (job.trigger.kind === "at") return `One time · ${new Date(job.trigger.at).toLocaleString()}`;
  if (job.trigger.kind === "every") return `Every ${formatInterval(job.trigger.everyMs)}`;
  return `${job.trigger.expression} · ${job.trigger.timezone ?? "Gateway local time"}`;
}
function formatInterval(ms: number) { return ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : ms % 60_000 === 0 ? `${ms / 60_000}m` : `${Math.round(ms / 1_000)}s`; }
