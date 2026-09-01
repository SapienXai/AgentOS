import type { RuntimeRecord } from "@/lib/openclaw/types";

export type ExecutionIdentityProvenance = "authoritative" | "correlated" | "derived" | "heuristic";

/**
 * The bounded identity envelope AgentOS may use to correlate one execution.
 * OpenClaw task/session/run identifiers are runtime facts; dispatch IDs are
 * AgentOS bootstrap identifiers and are never treated as runtime authority.
 */
export type OpenClawExecutionIdentity = {
  dispatchId: string | null;
  openClawTaskId: string | null;
  sessionKey: string | null;
  sessionId: string | null;
  runId: string | null;
  agentId: string | null;
  workspaceId: string | null;
  provenance: ExecutionIdentityProvenance;
};

export type AutomationIdentitySourceOfTruth =
  | "openclaw.cron.job"
  | "openclaw.cron.runs"
  | "openclaw.tasks"
  | "agentos.dispatch"
  | "compatibility";

/**
 * The canonical identity vocabulary for scheduled work. An AgentOS automation
 * key is a correlation key; OpenClaw cron/task/session/run values remain the
 * runtime authorities and are never interchangeable.
 */
export type OpenClawAutomationExecutionIdentity = OpenClawExecutionIdentity & {
  automationId: string | null;
  cronJobId: string | null;
  cronRunId: string | null;
  taskId: string | null;
  sourceOfTruth: AutomationIdentitySourceOfTruth;
};

export function automationExecutionIdentityFromCron(input: {
  automationId?: string | null;
  cronJobId?: string | null;
  cronRunId?: string | null;
  taskId?: string | null;
  sessionKey?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
  workspaceId?: string | null;
  dispatchId?: string | null;
  provenance?: ExecutionIdentityProvenance;
  sourceOfTruth?: AutomationIdentitySourceOfTruth;
}): OpenClawAutomationExecutionIdentity {
  const taskId = cleanIdentityValue(input.taskId);
  const cronRunId = cleanIdentityValue(input.cronRunId);
  const cronJobId = cleanIdentityValue(input.cronJobId);
  const sessionKey = cleanIdentityValue(input.sessionKey);
  const sessionId = cleanIdentityValue(input.sessionId);
  const dispatchId = cleanIdentityValue(input.dispatchId);
  const provenance = input.provenance ?? (taskId || cronRunId ? "authoritative" : sessionKey || sessionId || dispatchId ? "correlated" : "derived");
  const sourceOfTruth = input.sourceOfTruth ?? (taskId ? "openclaw.tasks" : cronRunId ? "openclaw.cron.runs" : cronJobId ? "openclaw.cron.job" : dispatchId ? "agentos.dispatch" : "compatibility");

  return {
    dispatchId,
    openClawTaskId: taskId,
    sessionKey,
    sessionId,
    runId: cronRunId,
    agentId: cleanIdentityValue(input.agentId),
    workspaceId: cleanIdentityValue(input.workspaceId),
    provenance,
    automationId: cleanIdentityValue(input.automationId),
    cronJobId,
    cronRunId,
    taskId,
    sourceOfTruth
  };
}

export type NormalizedOpenClawTaskSummary = {
  id: string;
  status: string;
  kind: string | null;
  runtime: string | null;
  title: string | null;
  agentId: string | null;
  sessionKey: string | null;
  childSessionKey: string | null;
  ownerKey: string | null;
  runId: string | null;
  taskId: string | null;
  flowId: string | null;
  parentTaskId: string | null;
  sourceId: string | null;
  createdAt: string | number | null;
  updatedAt: string | number | null;
  endedAt: string | number | null;
  progress: number | null;
  summary: string | null;
  error: string | null;
};

export function normalizeOpenClawTaskSummary(value: unknown): NormalizedOpenClawTaskSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value.id) ?? readString(value.taskId);
  const status = readString(value.status);

  if (!id || !status) {
    return null;
  }

  return {
    id,
    status,
    kind: readString(value.kind),
    runtime: readString(value.runtime),
    title: readString(value.title),
    agentId: readString(value.agentId),
    sessionKey: readString(value.sessionKey),
    childSessionKey: readString(value.childSessionKey),
    ownerKey: readString(value.ownerKey),
    runId: readString(value.runId),
    taskId: readString(value.taskId),
    flowId: readString(value.flowId),
    parentTaskId: readString(value.parentTaskId),
    sourceId: readString(value.sourceId),
    createdAt: readTimestampValue(value.createdAt),
    updatedAt: readTimestampValue(value.updatedAt),
    endedAt: readTimestampValue(value.endedAt),
    progress: readFiniteNumber(value.progress),
    summary: readString(value.summary) ?? readString(value.terminalSummary),
    error: readString(value.error) ?? readString(value.errorMessage)
  };
}

export function readExecutionIdentity(value: unknown): OpenClawExecutionIdentity | null {
  if (!isRecord(value)) {
    return null;
  }

  const identity = {
    dispatchId: readString(value.dispatchId),
    openClawTaskId: readString(value.openClawTaskId) ?? readString(value.taskId),
    sessionKey: readString(value.sessionKey),
    sessionId: readString(value.sessionId),
    runId: readString(value.runId),
    agentId: readString(value.agentId),
    workspaceId: readString(value.workspaceId),
    provenance: readProvenance(value.provenance)
  } satisfies OpenClawExecutionIdentity;

  return Object.entries(identity).some(
    ([key, entry]) => key !== "provenance" && typeof entry === "string" && entry.length > 0
  )
    ? identity
    : null;
}

export function executionIdentityFromTaskSummary(
  summary: NormalizedOpenClawTaskSummary,
  context: { workspaceId?: string | null; dispatchId?: string | null } = {}
): OpenClawExecutionIdentity {
  return {
    dispatchId: context.dispatchId ?? null,
    openClawTaskId: summary.id,
    sessionKey: summary.sessionKey ?? summary.childSessionKey,
    sessionId: extractExplicitSessionId(summary.sessionKey ?? summary.childSessionKey),
    runId: summary.runId,
    agentId: summary.agentId,
    workspaceId: context.workspaceId ?? null,
    provenance: "authoritative"
  };
}

export function executionIdentityFromRuntime(runtime: RuntimeRecord): OpenClawExecutionIdentity {
  const metadataIdentity = readExecutionIdentity(runtime.metadata.executionIdentity);
  if (metadataIdentity) {
    return metadataIdentity;
  }

  const dispatchId = readString(runtime.metadata.dispatchId);
  const taskId = runtime.taskId?.trim() || readString(runtime.metadata.openClawTaskId) || null;
  const sessionKey =
    readString(runtime.metadata.openClawSessionKey) ??
    readString(runtime.metadata.sessionKey) ??
    readString(runtime.metadata.gatewaySessionKey) ??
    (runtime.key.trim().startsWith("agent:") ? runtime.key.trim() : null);
  const sessionId = runtime.sessionId?.trim() || extractExplicitSessionId(sessionKey);
  const provenance: ExecutionIdentityProvenance = taskId
    ? "authoritative"
    : dispatchId || sessionKey || sessionId || runtime.runId
      ? "correlated"
      : "heuristic";

  return {
    dispatchId,
    openClawTaskId: taskId,
    sessionKey,
    sessionId,
    runId: runtime.runId?.trim() || readString(runtime.metadata.openClawRunId),
    agentId: runtime.agentId?.trim() || readString(runtime.metadata.primaryAgentId),
    workspaceId: runtime.workspaceId?.trim() || readString(runtime.metadata.workspaceId),
    provenance
  };
}

export function extractExplicitSessionId(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  const marker = ":explicit:";
  const markerIndex = normalized.indexOf(marker);
  return markerIndex === -1 ? null : normalized.slice(markerIndex + marker.length).trim() || null;
}

function readProvenance(value: unknown): ExecutionIdentityProvenance {
  return value === "authoritative" || value === "correlated" || value === "derived" || value === "heuristic"
    ? value
    : "heuristic";
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanIdentityValue(value: string | null | undefined) {
  return value?.trim() || null;
}

function readFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readTimestampValue(value: unknown): string | number | null {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value)) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
