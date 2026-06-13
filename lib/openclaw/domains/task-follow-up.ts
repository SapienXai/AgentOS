import type { RuntimeCreatedFile, TaskRecord } from "@/lib/openclaw/types";

export type TaskFollowUpAvailability = {
  available: boolean;
  reason: string | null;
  warning: string | null;
  context: TaskFollowUpContext;
};

export type TaskFollowUpPromptInput = {
  task: TaskRecord;
  operatorMessage: string;
  latestResult?: string | null;
  createdFiles?: RuntimeCreatedFile[];
  outputSummary?: string | null;
};

export type TaskFollowUpContext = {
  agentId: string | null;
  sessionId: string | null;
  sessionKey: string | null;
  openClawTaskId: string | null;
  dispatchId: string | null;
  provenance: "native-task" | "dispatch-derived" | "runtime-derived" | "unknown";
  confidence: "high" | "medium" | "none";
};

const FOLLOW_UP_LIMIT = 11_600;
const SECTION_LIMITS = {
  operator: 3_000,
  mission: 2_600,
  result: 4_200,
  files: 1_000
};

export function resolveTaskFollowUpAvailability(task: Pick<
  TaskRecord,
  "agentIds" | "dispatchId" | "metadata" | "primaryAgentId" | "sessionIds" | "status"
>): TaskFollowUpAvailability {
  const context = resolveTaskFollowUpContext(task);

  if (!isTaskFollowUpStatus(task.status)) {
    return {
      available: false,
      reason: "Follow-up is available for queued, running, stalled, or completed tasks.",
      warning: null,
      context
    };
  }

  if (!context.agentId) {
    return {
      available: false,
      reason: "This task does not expose an OpenClaw agent to continue.",
      warning: null,
      context
    };
  }

  if (!context.sessionKey && !context.sessionId) {
    return {
      available: false,
      reason: "This task does not expose an OpenClaw session to continue.",
      warning: null,
      context
    };
  }

  return {
    available: true,
    reason: null,
    warning:
      context.confidence === "medium"
        ? "This task is runtime-derived; AgentOS will continue the resolved OpenClaw session context."
        : null,
    context
  };
}

export function resolveTaskFollowUpContext(task: Pick<
  TaskRecord,
  "agentIds" | "dispatchId" | "metadata" | "primaryAgentId" | "sessionIds"
>): TaskFollowUpContext {
  const agentId =
    readTaskMetadataString(task, "primaryAgentId") ||
    task.primaryAgentId?.trim() ||
    firstNonEmpty(task.agentIds);
  const rawSessionKey =
    readTaskMetadataString(task, "continuationSessionKey") ||
    readTaskMetadataString(task, "openClawSessionKey") ||
    readTaskMetadataString(task, "sessionKey") ||
    readTaskMetadataString(task, "gatewaySessionKey") ||
    firstAgentSessionKey(task.sessionIds);
  const rawSessionId =
    readTaskMetadataString(task, "continuationSessionId") ||
    readTaskMetadataString(task, "openClawSessionId") ||
    readTaskMetadataString(task, "sessionId") ||
    readTaskMetadataString(task, "gatewaySessionId") ||
    firstPlainSessionId(task.sessionIds) ||
    extractExplicitSessionId(rawSessionKey);
  const sessionKey = rawSessionKey ?? (rawSessionId && agentId ? `agent:${agentId}:explicit:${rawSessionId}` : null);
  const sessionId = rawSessionId ? extractExplicitSessionId(rawSessionId) ?? rawSessionId : extractExplicitSessionId(sessionKey);
  const provenance = normalizeTaskProvenance(readTaskMetadataString(task, "provenance"));
  const confidence = normalizeContinuationConfidence(
    readTaskMetadataString(task, "continuationConfidence"),
    provenance,
    sessionKey,
    sessionId
  );

  return {
    agentId: agentId ?? null,
    sessionId: sessionId ?? null,
    sessionKey,
    openClawTaskId: readTaskMetadataString(task, "openClawTaskId"),
    dispatchId: task.dispatchId?.trim() || readTaskMetadataString(task, "dispatchId"),
    provenance,
    confidence
  };
}

export function buildTaskFollowUpPrompt(input: TaskFollowUpPromptInput) {
  const operatorMessage = limitSection(input.operatorMessage, SECTION_LIMITS.operator);
  const mission = limitSection(resolveOriginalMission(input.task), SECTION_LIMITS.mission);
  const latestResult = limitSection(
    input.latestResult || readTaskMetadataString(input.task, "finalResponseText") ||
      readTaskMetadataString(input.task, "resultPreview") ||
      input.task.subtitle,
    SECTION_LIMITS.result
  );
  const files = limitSection(formatCreatedFiles(input.task, input.createdFiles), SECTION_LIMITS.files);
  const outputSummary = limitSection(input.outputSummary ?? "", SECTION_LIMITS.result);

  return limitSection(
    [
      "Continue this task in the existing task context. Use the current OpenClaw session state and previous result; do not restart unless the operator explicitly asks for a retry.",
      "",
      "Operator follow-up:",
      operatorMessage,
      "",
      "Original mission:",
      mission,
      latestResult ? "" : null,
      latestResult ? "Latest result:" : null,
      latestResult || null,
      outputSummary ? "" : null,
      outputSummary ? "Output context:" : null,
      outputSummary || null,
      files ? "" : null,
      files ? "Existing output/files:" : null,
      files || null
    ]
      .filter((entry): entry is string => typeof entry === "string")
      .join("\n"),
    FOLLOW_UP_LIMIT
  );
}

export function normalizeTaskFollowUpSessionId(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  return extractExplicitSessionId(trimmed) ?? trimmed;
}

export function formatTaskFollowUpConfidenceLabel(confidence: TaskFollowUpContext["confidence"]) {
  switch (confidence) {
    case "high":
      return "high";
    case "medium":
      return "medium warning";
    case "none":
      return "none disabled";
  }
}

function isTaskFollowUpStatus(status: string) {
  return status === "queued" || status === "running" || status === "stalled" || status === "completed";
}

function resolveOriginalMission(task: TaskRecord) {
  return task.mission?.trim() || task.title.trim() || "Untitled task";
}

function readTaskMetadataString(task: Pick<TaskRecord, "metadata">, key: string) {
  const value = task.metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function firstNonEmpty(values: string[]) {
  return values.find((value) => value.trim().length > 0)?.trim() ?? null;
}

function firstAgentSessionKey(values: string[]) {
  return values.find((value) => value.trim().startsWith("agent:"))?.trim() ?? null;
}

function firstPlainSessionId(values: string[]) {
  return values
    .map((value) => value.trim())
    .find((value) => value.length > 0 && !value.startsWith("agent:")) ?? null;
}

function normalizeTaskProvenance(value: string | null): TaskFollowUpContext["provenance"] {
  return value === "native-task" || value === "dispatch-derived" || value === "runtime-derived"
    ? value
    : "unknown";
}

function normalizeContinuationConfidence(
  value: string | null,
  provenance: TaskFollowUpContext["provenance"],
  sessionKey: string | null,
  sessionId: string | null
): TaskFollowUpContext["confidence"] {
  if (value === "high" || value === "medium" || value === "none") {
    return value;
  }

  if (!sessionKey && !sessionId) {
    return "none";
  }

  return provenance === "runtime-derived" || provenance === "unknown" ? "medium" : "high";
}

function extractExplicitSessionId(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }

  const marker = ":explicit:";
  const markerIndex = normalized.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  return normalized.slice(markerIndex + marker.length).trim() || null;
}

function formatCreatedFiles(task: TaskRecord, createdFiles: RuntimeCreatedFile[] | undefined) {
  const entries = (createdFiles ?? [])
    .map((file) => file.displayPath || file.path)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .slice(0, 8);

  if (entries.length > 0) {
    return entries.join("\n");
  }

  if (task.artifactCount > 0) {
    return `${task.artifactCount} file${task.artifactCount === 1 ? "" : "s"} reported by this task.`;
  }

  return "";
}

function limitSection(value: string, maxLength: number) {
  const normalized = value.replace(/\s+\n/g, "\n").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 39, 1)).trimEnd()}\n\n[truncated for task follow-up]`;
}
