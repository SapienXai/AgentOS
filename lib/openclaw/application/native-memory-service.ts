import "server-only";

import { getOpenClawAdapter, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  classifyNativeMutationError,
  NativeGatewayError,
  normalizeClientError
} from "@/lib/openclaw/client/native-ws-gateway-errors";
import type {
  OpenClawCommandOptions,
  OpenClawMemoryDreamActionPayload,
  OpenClawMemorySearchResult,
  OpenClawMemoryStatusPayload
} from "@/lib/openclaw/client/types";
import {
  type WorkerMemoryAction,
  type WorkerMemoryActionResponse,
  type WorkerMemoryDreamDiaryResponse,
  type WorkerMemoryHealthStatus,
  type WorkerMemoryIssue,
  type WorkerMemoryProjection,
  type WorkerMemorySearchResponse,
  type WorkerMemorySearchResult,
  type WorkerMemorySourceStatus
} from "@/lib/openclaw/memory-types";
import { redactSecretText } from "@/lib/security/redaction";

export const NATIVE_MEMORY_SEARCH_MAX_RESULTS = 50;

const MEMORY_ACTION_METHODS: Record<WorkerMemoryAction, keyof OpenClawAdapter> = {
  backfill: "backfillNativeMemoryDreamDiary",
  reset: "resetNativeMemoryDreamDiary",
  resetGroundedShortTerm: "resetNativeGroundedShortTerm",
  repairDreamingArtifacts: "repairNativeDreamingArtifacts",
  dedupeDreamDiary: "dedupeNativeDreamDiary"
};

export async function getWorkerMemoryProjection(
  agentId: string,
  options: { adapter?: OpenClawAdapter; commandOptions?: OpenClawCommandOptions } = {}
): Promise<WorkerMemoryProjection> {
  const normalizedAgentId = requireAgentId(agentId);
  const adapter = options.adapter ?? getOpenClawAdapter();
  const read = adapter.getNativeMemoryDoctorStatus;

  if (!read) {
    return buildUnavailableProjection(normalizedAgentId, "OpenClaw native memory status is not available.");
  }

  try {
    const payload = await read.call(adapter, { agentId: normalizedAgentId }, options.commandOptions);
    return normalizeWorkerMemoryProjection(payload);
  } catch (error) {
    const normalized = normalizeClientError(error);
    const unsupported = normalized.kind === "unsupported" || /native .* unavailable/i.test(normalized.message);
    return buildUnavailableOrUnknownProjection(normalizedAgentId, normalized.message, unsupported);
  }
}

export function normalizeWorkerMemoryProjection(payload: OpenClawMemoryStatusPayload): WorkerMemoryProjection {
  const issues: WorkerMemoryIssue[] = [];
  const embeddingError = payload.embedding.error?.trim();

  if (!payload.embedding.ok) {
    const notChecked = payload.embedding.checked === false || /not checked/i.test(embeddingError ?? "");
    issues.push({
      code: notChecked ? "embedding_not_checked" : "embedding_unavailable",
      message: redactSecretText(embeddingError ?? "OpenClaw did not report ready memory embeddings."),
      severity: notChecked ? "warning" : "error"
    });
  }

  if (payload.dreaming?.storeError) {
    issues.push({
      code: "dreaming_store_error",
      message: redactSecretText(payload.dreaming.storeError),
      severity: "error"
    });
  }
  if (payload.dreaming?.phaseSignalError) {
    issues.push({
      code: "dreaming_phase_error",
      message: redactSecretText(payload.dreaming.phaseSignalError),
      severity: "warning"
    });
  }
  if (payload.embeddingRuntime?.state === "failed") {
    issues.push({
      code: "embedding_unavailable",
      message: redactSecretText(payload.embeddingRuntime.loadError ?? "OpenClaw memory embedding runtime failed."),
      severity: "error"
    });
  }

  const hasErrors = issues.some((issue) => issue.severity === "error");
  const status: WorkerMemoryHealthStatus = issues.length === 0
    ? "healthy"
    : hasErrors
      ? "needs-attention"
      : "degraded";

  return {
    agentId: payload.agentId,
    status,
    explanation: resolveHealthExplanation(status),
    source: "native",
    provider: payload.provider?.trim() || null,
    embedding: {
      ready: payload.embedding.ok,
      checked: payload.embedding.checked ?? null,
      checkedAtMs: payload.embedding.checkedAtMs ?? null
    },
    dreaming: payload.dreaming
      ? {
          enabled: payload.dreaming.enabled,
          shortTermCount: payload.dreaming.shortTermCount,
          promotedTotal: payload.dreaming.promotedTotal,
          promotedToday: payload.dreaming.promotedToday,
          lastPromotedAt: payload.dreaming.lastPromotedAt ?? null
        }
      : null,
    issues,
    checkedAt: new Date().toISOString()
  };
}

export async function searchWorkerMemory(
  input: {
    agentId: string;
    query: string;
    maxResults?: number;
    minScore?: number;
  },
  options: { adapter?: OpenClawAdapter; commandOptions?: OpenClawCommandOptions } = {}
): Promise<WorkerMemorySearchResponse> {
  const agentId = requireAgentId(input.agentId);
  const query = input.query.trim();
  if (!query) {
    throw new Error("Memory search query is required.");
  }
  const maxResults = clampSearchLimit(input.maxResults);
  const adapter = options.adapter ?? getOpenClawAdapter();
  const search = adapter.searchMemory;

  if (!search) {
    return buildUnavailableSearch(agentId, "OpenClaw native memory.search is not available.");
  }

  try {
    const payload = await search.call(adapter, {
      agentId,
      query,
      maxResults,
      ...(input.minScore === undefined ? {} : { minScore: input.minScore })
    }, options.commandOptions);
    return normalizeWorkerMemorySearch(payload.results, payload.agentId, payload.provider, payload.searchMode, payload.stale === true, payload.warning, payload.action);
  } catch (error) {
    const normalized = normalizeClientError(error);
    const unsupported = normalized.kind === "unsupported" || /native .* unavailable/i.test(normalized.message);
    return buildUnavailableOrUnknownSearch(agentId, normalized.message, unsupported);
  }
}

export function normalizeWorkerMemorySearch(
  results: OpenClawMemorySearchResult[],
  agentId: string,
  provider: string,
  searchMode: "hybrid" | "fts-only",
  stale: boolean,
  warning?: string,
  action?: string
): WorkerMemorySearchResponse {
  return {
    status: "available",
    agentId,
    provider: provider.trim() || null,
    searchMode,
    results: results.map(normalizeSearchResult),
    stale,
    warning: warning ? redactSecretText(warning) : null,
    action: action ? redactSecretText(action) : null,
    issue: null
  };
}

export async function readWorkerDreamDiary(
  agentId: string,
  options: { adapter?: OpenClawAdapter; commandOptions?: OpenClawCommandOptions } = {}
): Promise<WorkerMemoryDreamDiaryResponse> {
  const normalizedAgentId = requireAgentId(agentId);
  const adapter = options.adapter ?? getOpenClawAdapter();
  const read = adapter.getNativeMemoryDreamDiary;
  if (!read) {
    return buildUnavailableDiary(normalizedAgentId, "OpenClaw native dream diary is not available.");
  }

  try {
    const payload = await read.call(adapter, { agentId: normalizedAgentId }, options.commandOptions);
    return normalizeWorkerDreamDiary(payload);
  } catch (error) {
    const normalized = normalizeClientError(error);
    const unsupported = normalized.kind === "unsupported" || /native .* unavailable/i.test(normalized.message);
    return buildUnavailableOrUnknownDiary(normalizedAgentId, normalized.message, unsupported);
  }
}

export async function runWorkerMemoryAction(
  agentId: string,
  action: WorkerMemoryAction,
  options: { adapter?: OpenClawAdapter; commandOptions?: OpenClawCommandOptions } = {}
): Promise<OpenClawMemoryDreamActionPayload> {
  const normalizedAgentId = requireAgentId(agentId);
  const adapter = options.adapter ?? getOpenClawAdapter();
  const method = MEMORY_ACTION_METHODS[action];
  const operation = adapter[method];
  if (typeof operation !== "function") {
    throw new NativeGatewayError(`OpenClaw native memory action ${action} is unavailable.`, { kind: "unsupported" });
  }
  return (operation as (input: { agentId: string }, commandOptions?: OpenClawCommandOptions) => Promise<OpenClawMemoryDreamActionPayload>).call(
    adapter,
    { agentId: normalizedAgentId },
    options.commandOptions
  );
}

export async function executeWorkerMemoryAction(
  agentId: string,
  action: WorkerMemoryAction,
  options: { adapter?: OpenClawAdapter; commandOptions?: OpenClawCommandOptions } = {}
): Promise<WorkerMemoryActionResponse> {
  try {
    const actionResult = await runWorkerMemoryAction(agentId, action, options);
    const projection = await getWorkerMemoryProjection(agentId, options);
    return buildMemoryActionResponse(actionResult, projection);
  } catch (error) {
    const classification = classifyNativeMutationError(error);
    if (classification.disposition === "definite-rejection") {
      return buildFailedMemoryActionResponse(agentId, action, classification.message);
    }

    const reconciliation = await reconcileAmbiguousMemoryAction(agentId, action, options);
    if (reconciliation.status === "confirmed") {
      return buildReconciledMemoryActionResponse(agentId, action, reconciliation);
    }

    return buildUnknownMemoryActionResponse(agentId, action, reconciliation);
  }
}

export function buildMemoryActionResponse(
  action: OpenClawMemoryDreamActionPayload,
  projection: WorkerMemoryProjection
): WorkerMemoryActionResponse {
  return {
    agentId: action.agentId,
    action: action.action,
    outcome: "succeeded",
    retryable: false,
    message: "OpenClaw applied the native memory action.",
    projection,
    reconciliation: {
      attempted: false,
      status: "not-attempted",
      readMethods: []
    },
    result: summarizeMemoryActionResult(action),
    issue: null
  };
}

type MemoryActionReconciliation = {
  status: "confirmed" | "inconclusive" | "read-failed";
  readMethods: string[];
  projection: WorkerMemoryProjection | null;
};

async function reconcileAmbiguousMemoryAction(
  agentId: string,
  action: WorkerMemoryAction,
  options: { adapter?: OpenClawAdapter; commandOptions?: OpenClawCommandOptions }
): Promise<MemoryActionReconciliation> {
  if (action === "reset" || action === "backfill" || action === "dedupeDreamDiary") {
    const diary = await readWorkerDreamDiary(agentId, options);
    if (diary.status !== "available") {
      return {
        status: "read-failed",
        readMethods: ["doctor.memory.dreamDiary"],
        projection: null
      };
    }
    if (action === "reset" && diary.found === false) {
      return {
        status: "confirmed",
        readMethods: ["doctor.memory.dreamDiary"],
        projection: null
      };
    }
    return {
      status: "inconclusive",
      readMethods: ["doctor.memory.dreamDiary"],
      projection: null
    };
  }

  const projection = await getWorkerMemoryProjection(agentId, options);
  if (projection.source !== "native") {
    return {
      status: "read-failed",
      readMethods: ["doctor.memory.status"],
      projection
    };
  }
  if (action === "resetGroundedShortTerm" && projection.dreaming?.shortTermCount === 0) {
    return {
      status: "confirmed",
      readMethods: ["doctor.memory.status"],
      projection
    };
  }
  return {
    status: "inconclusive",
    readMethods: ["doctor.memory.status"],
    projection
  };
}

function buildFailedMemoryActionResponse(agentId: string, action: WorkerMemoryAction, message: string): WorkerMemoryActionResponse {
  return {
    agentId,
    action,
    outcome: "failed",
    retryable: false,
    message: redactSecretText(message || "OpenClaw rejected the native memory action."),
    projection: null,
    reconciliation: {
      attempted: false,
      status: "not-attempted",
      readMethods: []
    },
    result: null,
    issue: {
      code: "mutation_rejected",
      message: redactSecretText(message || "OpenClaw rejected the native memory action."),
      severity: "error"
    }
  };
}

function buildReconciledMemoryActionResponse(
  agentId: string,
  action: WorkerMemoryAction,
  reconciliation: MemoryActionReconciliation
): WorkerMemoryActionResponse {
  return {
    agentId,
    action,
    outcome: "succeeded",
    retryable: false,
    message: "OpenClaw may have delayed the response, but the native postcondition was confirmed.",
    projection: reconciliation.projection,
    reconciliation: {
      attempted: true,
      status: reconciliation.status,
      readMethods: reconciliation.readMethods
    },
    result: null,
    issue: null
  };
}

function buildUnknownMemoryActionResponse(
  agentId: string,
  action: WorkerMemoryAction,
  reconciliation: MemoryActionReconciliation
): WorkerMemoryActionResponse {
  const message = "OpenClaw may have applied this action, but AgentOS could not verify the final state. Refresh diagnostics before deciding what to do next.";
  return {
    agentId,
    action,
    outcome: "unknown",
    retryable: false,
    message,
    projection: reconciliation.projection,
    reconciliation: {
      attempted: true,
      status: reconciliation.status,
      readMethods: reconciliation.readMethods
    },
    result: null,
    issue: {
      code: "mutation_outcome_unknown",
      message,
      severity: "warning"
    }
  };
}

function summarizeMemoryActionResult(action: OpenClawMemoryDreamActionPayload) {
  return {
    ...(action.found === undefined ? {} : { found: action.found }),
    ...(action.scannedFiles === undefined ? {} : { scannedFiles: action.scannedFiles }),
    ...(action.written === undefined ? {} : { written: action.written }),
    ...(action.replaced === undefined ? {} : { replaced: action.replaced }),
    ...(action.removedEntries === undefined ? {} : { removedEntries: action.removedEntries }),
    ...(action.removedShortTermEntries === undefined ? {} : { removedShortTermEntries: action.removedShortTermEntries }),
    ...(action.changed === undefined ? {} : { changed: action.changed }),
    ...(action.archivedDreamsDiary === undefined ? {} : { archivedDreamsDiary: action.archivedDreamsDiary }),
    ...(action.archivedSessionCorpus === undefined ? {} : { archivedSessionCorpus: action.archivedSessionCorpus }),
    ...(action.archivedSessionIngestion === undefined ? {} : { archivedSessionIngestion: action.archivedSessionIngestion }),
    ...(action.warnings === undefined ? {} : { warnings: action.warnings.map((warning) => redactSecretText(warning)) }),
    ...(action.dedupedEntries === undefined ? {} : { dedupedEntries: action.dedupedEntries }),
    ...(action.keptEntries === undefined ? {} : { keptEntries: action.keptEntries })
  };
}

function normalizeSearchResult(result: OpenClawMemorySearchResult): WorkerMemorySearchResult {
  return {
    path: result.path,
    startLine: result.startLine,
    endLine: result.endLine,
    score: result.score,
    ...(result.vectorScore === undefined ? {} : { vectorScore: result.vectorScore }),
    ...(result.textScore === undefined ? {} : { textScore: result.textScore }),
    snippet: redactSecretText(result.snippet),
    source: result.source,
    ...(result.importance === undefined ? {} : { importance: result.importance }),
    ...(result.triggers === undefined ? {} : { triggers: redactSecretText(result.triggers) }),
    ...(result.projectKey === undefined ? {} : { projectKey: result.projectKey }),
    ...(result.citation === undefined ? {} : { citation: redactSecretText(result.citation) }),
    ...(result.provenance === undefined ? {} : { provenance: result.provenance })
  };
}

function normalizeWorkerDreamDiary(payload: {
  agentId: string;
  found: boolean;
  path: string;
  content?: string;
  updatedAtMs?: number;
}): WorkerMemoryDreamDiaryResponse {
  return {
    status: "available",
    agentId: payload.agentId,
    found: payload.found,
    path: payload.path || null,
    content: payload.content === undefined ? null : redactSecretText(payload.content),
    updatedAtMs: payload.updatedAtMs ?? null,
    issue: null
  };
}

function buildUnavailableProjection(agentId: string, message: string): WorkerMemoryProjection {
  return buildUnavailableOrUnknownProjection(agentId, message, true);
}

function buildUnavailableOrUnknownProjection(agentId: string, message: string, unavailable: boolean): WorkerMemoryProjection {
  const issue: WorkerMemoryIssue = {
    code: unavailable ? "native_method_unavailable" : "native_read_failed",
    message: redactSecretText(message),
    severity: "error"
  };
  const source: WorkerMemorySourceStatus = unavailable ? "unavailable" : "unknown";
  const status: WorkerMemoryHealthStatus = unavailable ? "unavailable" : "unknown";
  return {
    agentId,
    status,
    explanation: unavailable
      ? "OpenClaw native memory operations are not available for this runtime."
      : "AgentOS could not verify memory health from the current OpenClaw runtime.",
    source,
    provider: null,
    embedding: { ready: null, checked: null, checkedAtMs: null },
    dreaming: null,
    issues: [issue],
    checkedAt: new Date().toISOString()
  };
}

function buildUnavailableSearch(agentId: string, message: string): WorkerMemorySearchResponse {
  return buildUnavailableOrUnknownSearch(agentId, message, true);
}

function buildUnavailableOrUnknownSearch(agentId: string, message: string, unavailable: boolean): WorkerMemorySearchResponse {
  return {
    status: unavailable ? "unavailable" : "unknown",
    agentId,
    provider: null,
    searchMode: null,
    results: [],
    stale: false,
    warning: null,
    action: null,
    issue: {
      code: unavailable ? "native_method_unavailable" : "native_read_failed",
      message: redactSecretText(message),
      severity: "error"
    }
  };
}

function buildUnavailableDiary(agentId: string, message: string): WorkerMemoryDreamDiaryResponse {
  return buildUnavailableOrUnknownDiary(agentId, message, true);
}

function buildUnavailableOrUnknownDiary(agentId: string, message: string, unavailable: boolean): WorkerMemoryDreamDiaryResponse {
  return {
    status: unavailable ? "unavailable" : "unknown",
    agentId,
    found: null,
    path: null,
    content: null,
    updatedAtMs: null,
    issue: {
      code: unavailable ? "native_method_unavailable" : "native_read_failed",
      message: redactSecretText(message),
      severity: "error"
    }
  };
}

function resolveHealthExplanation(status: WorkerMemoryHealthStatus) {
  switch (status) {
    case "healthy":
      return "OpenClaw reports memory operations ready for this worker.";
    case "needs-attention":
      return "OpenClaw reports a memory dependency or maintenance issue for this worker.";
    case "degraded":
      return "OpenClaw memory is available with a reported limitation.";
    default:
      return "AgentOS cannot determine memory health reliably from the current native facts.";
  }
}

function clampSearchLimit(value: number | undefined) {
  if (value === undefined) return 20;
  if (!Number.isFinite(value)) throw new Error("maxResults must be a finite number.");
  return Math.min(NATIVE_MEMORY_SEARCH_MAX_RESULTS, Math.max(1, Math.floor(value)));
}

function requireAgentId(agentId: string) {
  const normalized = agentId.trim();
  if (!normalized) throw new Error("Agent is required.");
  return normalized;
}
