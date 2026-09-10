export const WORKSPACE_CREATION_RUN_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_CREATION_EVENT_SCHEMA_VERSION = 1 as const;
export const WORKSPACE_CREATION_MAX_EVENTS = 256 as const;

export const workspaceCreationStates = ["pending", "running", "review-ready", "failed", "cancelled"] as const;
export type WorkspaceCreationState = (typeof workspaceCreationStates)[number];

export const workspaceCreationStages = [
  "intake",
  "context-staging",
  "source-ingestion",
  "architect-runtime-preparation",
  "architect-reasoning",
  "architect-validation",
  "review-preparation"
] as const;
export type WorkspaceCreationStage = (typeof workspaceCreationStages)[number];

export type WorkspaceCreationFailureKind =
  | "runtime-bootstrap"
  | "gateway"
  | "authorization"
  | "model"
  | "structured-output"
  | "timeout"
  | "cancelled"
  | "unknown";

export type WorkspaceCreationRetryability = "terminal" | "transient" | "repairable" | "cancelled";

export type WorkspaceCreationFailure = {
  kind: WorkspaceCreationFailureKind;
  code: string;
  retryability: WorkspaceCreationRetryability;
  message: string;
};

export type WorkspaceCreationContextSnapshot = {
  status: "not-requested" | "pending" | "ready" | "partial" | "failed";
  generationId: string | null;
  sourceCount: number;
  usableEvidence: boolean;
  warningCodes: string[];
  sourceProgress: WorkspaceCreationSourceProgress[];
};

export type WorkspaceCreationSourceProgress = {
  sourceId: string;
  sourceKind: "prompt" | "website" | "repository" | "file" | "folder" | "connector";
  state: "pending" | "discovering" | "fetching" | "normalizing" | "ready" | "partial" | "failed";
  discoveredItems: number;
  fetchedItems: number;
  storedDocuments: number;
  warningCount: number;
  currentActivity: string | null;
  currentLocator: string | null;
};

export type WorkspaceCreationActivityCode =
  | "source-started"
  | "page-discovered"
  | "page-fetch-started"
  | "page-fetched"
  | "document-stored"
  | "source-partial"
  | "source-completed"
  | "source-failed"
  | "architect-started"
  | "architect-runtime-ready"
  | "architect-attempt-started"
  | "architect-model-started"
  | "architect-model-completed"
  | "architect-structured-output-rejected"
  | "architect-attempt-failed"
  | "architect-retry-scheduled"
  | "architect-attempt-completed"
  | "architect-fallback"
  | "architect-completed";

export type WorkspaceCreationActivityData = {
  sourceKind?: WorkspaceCreationSourceProgress["sourceKind"];
  sourceState?: WorkspaceCreationSourceProgress["state"];
  discoveredItems?: number;
  fetchedItems?: number;
  storedDocuments?: number;
  warningCount?: number;
  currentActivity?: string | null;
  currentLocator?: string | null;
  runtimeMode?: "openclaw-agent" | "model-runtime" | "deterministic-safe-fallback" | "unknown";
  modelId?: string | null;
  structuredOutputAccepted?: boolean;
  retryability?: WorkspaceCreationRetryability;
  remoteRunId?: string | null;
  remoteSessionKey?: string | null;
};

export type WorkspaceCreationArchitectSnapshot = {
  status: "pending" | "model" | "fallback" | "blocked";
  attempts: number;
  modelId: string | null;
  elapsedMs: number;
  failure: WorkspaceCreationFailure | null;
  modelExecutionOccurred: boolean;
  structuredOutputAccepted: boolean;
  retryAvailable: boolean;
  partialContext: boolean;
};

export type WorkspaceCreationSnapshot = {
  state: WorkspaceCreationState;
  stage: WorkspaceCreationStage | null;
  context: WorkspaceCreationContextSnapshot;
  architect: WorkspaceCreationArchitectSnapshot;
  elapsedMs: number;
  cancelRequested: boolean;
  provisioningHandoffReady: boolean;
  provisioningRunId: string | null;
};

export type WorkspaceCreationEvent = {
  schemaVersion: typeof WORKSPACE_CREATION_EVENT_SCHEMA_VERSION;
  sequence: number;
  createdAt: string;
  kind: "state-changed" | "context-updated" | "architect-updated" | "warning" | "cancel-requested" | "handoff-ready";
  stage: WorkspaceCreationStage | null;
  snapshot: WorkspaceCreationSnapshot;
  attempt: number;
  maxAttempts: number;
  elapsedMs: number;
  sourceId: string | null;
  warningCode: string | null;
  failure: Pick<WorkspaceCreationFailure, "kind" | "code" | "retryability"> | null;
  activityCode?: WorkspaceCreationActivityCode | null;
  activityData?: WorkspaceCreationActivityData | null;
};

export type WorkspaceCreationRunInput = {
  brief: string;
  mode: "automatic" | "review";
  operatorConstraints: string[];
  materialization: unknown;
  sources: unknown[];
};

export type WorkspaceCreationRun = {
  schemaVersion: typeof WORKSPACE_CREATION_RUN_SCHEMA_VERSION;
  runId: string;
  actorHash: string;
  idempotencyKeyHash: string;
  createdAt: string;
  updatedAt: string;
  attempt: number;
  input: WorkspaceCreationRunInput;
  /** Immutable canonical fingerprint of the complete normalized creation intent. */
  inputFingerprint?: string;
  draftContextId: string | null;
  snapshot: WorkspaceCreationSnapshot;
  result: unknown | null;
  events: WorkspaceCreationEvent[];
  oldestRetainedSequence: number;
  cancelRequestedAt: string | null;
  remoteExecution: {
    idempotencyKey: string;
    runId: string | null;
    sessionKey: string | null;
    outcome: "not-started" | "in-flight" | "completed" | "ambiguous";
  };
};

export function isWorkspaceCreationTerminal(state: WorkspaceCreationState) {
  return state === "review-ready" || state === "failed" || state === "cancelled";
}

export function createInitialWorkspaceCreationSnapshot(sourceCount: number): WorkspaceCreationSnapshot {
  return {
    state: "pending",
    stage: "intake",
    context: {
      status: sourceCount > 0 ? "pending" : "not-requested",
      generationId: null,
      sourceCount,
      usableEvidence: false,
      warningCodes: [],
      sourceProgress: []
    },
    architect: {
      status: "pending",
      attempts: 0,
      modelId: null,
      elapsedMs: 0,
      failure: null,
      modelExecutionOccurred: false,
      structuredOutputAccepted: false,
      retryAvailable: false,
      partialContext: false
    },
    elapsedMs: 0,
    cancelRequested: false,
    provisioningHandoffReady: false,
    provisioningRunId: null
  };
}

export function validateWorkspaceCreationRun(value: unknown): value is WorkspaceCreationRun {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const snapshot = candidate.snapshot;
  const input = candidate.input;
  const remote = candidate.remoteExecution;
  return candidate.schemaVersion === WORKSPACE_CREATION_RUN_SCHEMA_VERSION
    && hasOnlyKeys(candidate, ["schemaVersion", "runId", "actorHash", "idempotencyKeyHash", "createdAt", "updatedAt", "attempt", "input", "inputFingerprint", "draftContextId", "snapshot", "result", "events", "oldestRetainedSequence", "cancelRequestedAt", "remoteExecution"])
    && typeof candidate.runId === "string"
    && typeof candidate.actorHash === "string"
    && typeof candidate.idempotencyKeyHash === "string"
    && typeof candidate.createdAt === "string"
    && typeof candidate.updatedAt === "string"
    && Number.isSafeInteger(candidate.attempt)
    && (candidate.attempt as number) > 0
    && (candidate.inputFingerprint === undefined || typeof candidate.inputFingerprint === "string" && /^[a-f0-9]{64}$/i.test(candidate.inputFingerprint))
    && typeof input === "object"
    && input !== null
    && hasOnlyKeys(input as Record<string, unknown>, ["brief", "mode", "operatorConstraints", "materialization", "sources"])
    && typeof (input as Record<string, unknown>).brief === "string"
    && ((input as Record<string, unknown>).mode === "automatic" || (input as Record<string, unknown>).mode === "review")
    && arrayOfStrings((input as Record<string, unknown>).operatorConstraints)
    && Array.isArray((input as Record<string, unknown>).sources)
    && validateWorkspaceCreationSnapshot(snapshot)
    && Array.isArray(candidate.events)
    && candidate.events.every(validateWorkspaceCreationEvent)
    && Number.isSafeInteger(candidate.oldestRetainedSequence)
    && (candidate.oldestRetainedSequence as number) > 0
    && (candidate.draftContextId === null || typeof candidate.draftContextId === "string")
    && (candidate.cancelRequestedAt === null || typeof candidate.cancelRequestedAt === "string")
    && typeof remote === "object"
    && remote !== null
    && hasOnlyKeys(remote as Record<string, unknown>, ["idempotencyKey", "runId", "sessionKey", "outcome"])
    && typeof (remote as Record<string, unknown>).idempotencyKey === "string"
    && ((remote as Record<string, unknown>).runId === null || typeof (remote as Record<string, unknown>).runId === "string")
    && ((remote as Record<string, unknown>).sessionKey === null || typeof (remote as Record<string, unknown>).sessionKey === "string")
    && ["not-started", "in-flight", "completed", "ambiguous"].includes((remote as Record<string, unknown>).outcome as string);
}

function validateWorkspaceCreationSnapshot(value: unknown): value is WorkspaceCreationSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Record<string, unknown>;
  const context = snapshot.context;
  const architect = snapshot.architect;
  return hasOnlyKeys(snapshot, ["state", "stage", "context", "architect", "elapsedMs", "cancelRequested", "provisioningHandoffReady", "provisioningRunId"])
    && typeof snapshot.state === "string"
    && workspaceCreationStates.includes(snapshot.state as WorkspaceCreationState)
    && (snapshot.stage === null || workspaceCreationStages.includes(snapshot.stage as WorkspaceCreationStage))
    && Number.isSafeInteger(snapshot.elapsedMs)
    && (snapshot.elapsedMs as number) >= 0
    && typeof snapshot.cancelRequested === "boolean"
    && typeof snapshot.provisioningHandoffReady === "boolean"
    && (snapshot.provisioningRunId === null || typeof snapshot.provisioningRunId === "string")
    && validateWorkspaceCreationContextSnapshot(context)
    && validateWorkspaceCreationArchitectSnapshot(architect);
}

function validateWorkspaceCreationContextSnapshot(value: unknown): value is WorkspaceCreationSnapshot["context"] {
  if (!value || typeof value !== "object") return false;
  const context = value as Record<string, unknown>;
  return hasOnlyKeys(context, ["status", "generationId", "sourceCount", "usableEvidence", "warningCodes", "sourceProgress"])
    && ["not-requested", "pending", "ready", "partial", "failed"].includes(context.status as string)
    && (context.generationId === null || typeof context.generationId === "string")
    && Number.isSafeInteger(context.sourceCount)
    && (context.sourceCount as number) >= 0
    && typeof context.usableEvidence === "boolean"
    && arrayOfStrings(context.warningCodes)
    && (context.sourceProgress === undefined || Array.isArray(context.sourceProgress) && context.sourceProgress.every(validateWorkspaceCreationSourceProgress));
}

function validateWorkspaceCreationSourceProgress(value: unknown): value is WorkspaceCreationSourceProgress {
  if (!value || typeof value !== "object") return false;
  const progress = value as Record<string, unknown>;
  return hasOnlyKeys(progress, ["sourceId", "sourceKind", "state", "discoveredItems", "fetchedItems", "storedDocuments", "warningCount", "currentActivity", "currentLocator"])
    && typeof progress.sourceId === "string"
    && ["prompt", "website", "repository", "file", "folder", "connector"].includes(progress.sourceKind as string)
    && ["pending", "discovering", "fetching", "normalizing", "ready", "partial", "failed"].includes(progress.state as string)
    && ["discoveredItems", "fetchedItems", "storedDocuments", "warningCount"].every((key) => Number.isSafeInteger(progress[key]) && (progress[key] as number) >= 0)
    && (progress.currentActivity === null || typeof progress.currentActivity === "string")
    && (progress.currentLocator === null || typeof progress.currentLocator === "string");
}

function validateWorkspaceCreationArchitectSnapshot(value: unknown): value is WorkspaceCreationSnapshot["architect"] {
  if (!value || typeof value !== "object") return false;
  const architect = value as Record<string, unknown>;
  return hasOnlyKeys(architect, ["status", "attempts", "modelId", "elapsedMs", "failure", "modelExecutionOccurred", "structuredOutputAccepted", "retryAvailable", "partialContext"])
    && ["pending", "model", "fallback", "blocked"].includes(architect.status as string)
    && Number.isSafeInteger(architect.attempts)
    && (architect.attempts as number) >= 0
    && (architect.modelId === null || typeof architect.modelId === "string")
    && Number.isSafeInteger(architect.elapsedMs)
    && (architect.elapsedMs as number) >= 0
    && (architect.failure === null || validateWorkspaceCreationFailure(architect.failure))
    && typeof architect.modelExecutionOccurred === "boolean"
    && typeof architect.structuredOutputAccepted === "boolean"
    && typeof architect.retryAvailable === "boolean"
    && typeof architect.partialContext === "boolean";
}

function validateWorkspaceCreationEvent(value: unknown): value is WorkspaceCreationEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  return hasOnlyKeys(event, ["schemaVersion", "sequence", "createdAt", "kind", "stage", "snapshot", "attempt", "maxAttempts", "elapsedMs", "sourceId", "warningCode", "failure", "activityCode", "activityData"])
    && event.schemaVersion === WORKSPACE_CREATION_EVENT_SCHEMA_VERSION
    && Number.isSafeInteger(event.sequence)
    && (event.sequence as number) > 0
    && typeof event.createdAt === "string"
    && ["state-changed", "context-updated", "architect-updated", "warning", "cancel-requested", "handoff-ready"].includes(event.kind as string)
    && (event.stage === null || workspaceCreationStages.includes(event.stage as WorkspaceCreationStage))
    && validateWorkspaceCreationSnapshot(event.snapshot)
    && Number.isSafeInteger(event.attempt)
    && (event.attempt as number) > 0
    && Number.isSafeInteger(event.maxAttempts)
    && (event.maxAttempts as number) > 0
    && Number.isSafeInteger(event.elapsedMs)
    && (event.elapsedMs as number) >= 0
    && (event.sourceId === null || typeof event.sourceId === "string")
    && (event.warningCode === null || typeof event.warningCode === "string")
    && (event.failure === null || validateWorkspaceCreationEventFailure(event.failure))
    && (event.activityCode === undefined || event.activityCode === null || workspaceCreationActivityCodes.includes(event.activityCode as WorkspaceCreationActivityCode))
    && (event.activityData === undefined || event.activityData === null || validateWorkspaceCreationActivityData(event.activityData));
}

const workspaceCreationActivityCodes: readonly WorkspaceCreationActivityCode[] = [
  "source-started", "page-discovered", "page-fetch-started", "page-fetched", "document-stored", "source-partial", "source-completed", "source-failed",
  "architect-started", "architect-runtime-ready", "architect-attempt-started", "architect-model-started", "architect-model-completed", "architect-structured-output-rejected", "architect-attempt-failed", "architect-retry-scheduled", "architect-attempt-completed", "architect-fallback", "architect-completed"
];

function validateWorkspaceCreationActivityData(value: unknown): value is WorkspaceCreationActivityData {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return hasOnlyKeys(data, ["sourceKind", "sourceState", "discoveredItems", "fetchedItems", "storedDocuments", "warningCount", "currentActivity", "currentLocator", "runtimeMode", "modelId", "structuredOutputAccepted", "retryability", "remoteRunId", "remoteSessionKey"])
    && (data.sourceKind === undefined || ["prompt", "website", "repository", "file", "folder", "connector"].includes(data.sourceKind as string))
    && (data.sourceState === undefined || ["pending", "discovering", "fetching", "normalizing", "ready", "partial", "failed"].includes(data.sourceState as string))
    && ["discoveredItems", "fetchedItems", "storedDocuments", "warningCount"].every((key) => data[key] === undefined || Number.isSafeInteger(data[key]) && (data[key] as number) >= 0)
    && ["currentActivity", "currentLocator", "modelId", "remoteRunId", "remoteSessionKey"].every((key) => data[key] === undefined || data[key] === null || typeof data[key] === "string")
    && (data.runtimeMode === undefined || ["openclaw-agent", "model-runtime", "deterministic-safe-fallback", "unknown"].includes(data.runtimeMode as string))
    && (data.structuredOutputAccepted === undefined || typeof data.structuredOutputAccepted === "boolean")
    && (data.retryability === undefined || ["terminal", "transient", "repairable", "cancelled"].includes(data.retryability as string));
}

function validateWorkspaceCreationFailure(value: unknown): value is WorkspaceCreationFailure {
  if (!value || typeof value !== "object") return false;
  const failure = value as Record<string, unknown>;
  return hasOnlyKeys(failure, ["kind", "code", "retryability", "message"])
    && ["runtime-bootstrap", "gateway", "authorization", "model", "structured-output", "timeout", "cancelled", "unknown"].includes(failure.kind as string)
    && typeof failure.code === "string"
    && ["terminal", "transient", "repairable", "cancelled"].includes(failure.retryability as string)
    && typeof failure.message === "string";
}

function validateWorkspaceCreationEventFailure(value: unknown): value is WorkspaceCreationEvent["failure"] {
  if (!value || typeof value !== "object") return false;
  const failure = value as Record<string, unknown>;
  return hasOnlyKeys(failure, ["kind", "code", "retryability"])
    && ["runtime-bootstrap", "gateway", "authorization", "model", "structured-output", "timeout", "cancelled", "unknown"].includes(failure.kind as string)
    && typeof failure.code === "string"
    && ["terminal", "transient", "repairable", "cancelled"].includes(failure.retryability as string);
}

function arrayOfStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

export function appendWorkspaceCreationEvent(run: WorkspaceCreationRun, event: Omit<WorkspaceCreationEvent, "sequence">): WorkspaceCreationRun {
  const sequence = (run.events.at(-1)?.sequence ?? run.oldestRetainedSequence - 1) + 1;
  const nextEvents = [...run.events, { ...event, sequence }];
  const truncated = nextEvents.length > WORKSPACE_CREATION_MAX_EVENTS
    ? nextEvents.slice(nextEvents.length - WORKSPACE_CREATION_MAX_EVENTS)
    : nextEvents;
  return {
    ...run,
    snapshot: event.snapshot,
    events: truncated,
    oldestRetainedSequence: truncated[0]?.sequence ?? sequence + 1,
    updatedAt: event.createdAt
  };
}
