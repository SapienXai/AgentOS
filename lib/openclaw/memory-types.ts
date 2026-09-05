import type {
  OpenClawMemoryDreamAction,
  OpenClawMemoryDreamDiaryPayload,
  OpenClawMemorySearchResult,
  OpenClawMemoryStatusPayload
} from "@/lib/openclaw/client/types";

export type WorkerMemoryHealthStatus = "healthy" | "needs-attention" | "degraded" | "unavailable" | "unknown";
export type WorkerMemorySourceStatus = "native" | "unavailable" | "unknown";
export type WorkerMemoryResultStatus = "available" | "unavailable" | "unknown";

export type WorkerMemoryIssueCode =
  | "embedding_unavailable"
  | "embedding_not_checked"
  | "dreaming_store_error"
  | "dreaming_phase_error"
  | "runtime_unavailable"
  | "native_method_unavailable"
  | "native_read_failed"
  | "mutation_rejected"
  | "mutation_outcome_unknown"
  | "unknown";

export type WorkerMemoryIssue = {
  code: WorkerMemoryIssueCode;
  message: string;
  severity: "warning" | "error";
};

export type WorkerMemoryProjection = {
  agentId: string;
  status: WorkerMemoryHealthStatus;
  explanation: string;
  source: WorkerMemorySourceStatus;
  provider: string | null;
  embedding: {
    ready: boolean | null;
    checked: boolean | null;
    checkedAtMs: number | null;
  };
  dreaming: {
    enabled: boolean | null;
    shortTermCount: number | null;
    promotedTotal: number | null;
    promotedToday: number | null;
    lastPromotedAt: string | null;
  } | null;
  issues: WorkerMemoryIssue[];
  checkedAt: string;
};

export type WorkerMemorySearchResult = Pick<
  OpenClawMemorySearchResult,
  | "path"
  | "startLine"
  | "endLine"
  | "score"
  | "vectorScore"
  | "textScore"
  | "snippet"
  | "source"
  | "importance"
  | "triggers"
  | "projectKey"
  | "citation"
  | "provenance"
>;

export type WorkerMemorySearchResponse = {
  status: WorkerMemoryResultStatus;
  agentId: string;
  provider: string | null;
  searchMode: "hybrid" | "fts-only" | null;
  results: WorkerMemorySearchResult[];
  stale: boolean;
  warning: string | null;
  action: string | null;
  issue: WorkerMemoryIssue | null;
};

export type WorkerMemoryDreamDiaryResponse = {
  status: WorkerMemoryResultStatus;
  agentId: string;
  found: boolean | null;
  path: string | null;
  content: string | null;
  updatedAtMs: number | null;
  issue: WorkerMemoryIssue | null;
};

export type WorkerMemoryAction = OpenClawMemoryDreamAction;
export type WorkerMemoryMutationOutcome = "succeeded" | "failed" | "unknown";
export type WorkerMemoryReconciliationStatus = "not-attempted" | "confirmed" | "inconclusive" | "read-failed";

export type WorkerMemoryActionResponse = {
  agentId: string;
  action: WorkerMemoryAction;
  outcome: WorkerMemoryMutationOutcome;
  retryable: false;
  message: string;
  projection: WorkerMemoryProjection | null;
  reconciliation: {
    attempted: boolean;
    status: WorkerMemoryReconciliationStatus;
    readMethods: string[];
  };
  result: {
    found?: boolean;
    scannedFiles?: number;
    written?: number;
    replaced?: number;
    removedEntries?: number;
    removedShortTermEntries?: number;
    changed?: boolean;
    archivedDreamsDiary?: boolean;
    archivedSessionCorpus?: boolean;
    archivedSessionIngestion?: boolean;
    warnings?: string[];
    dedupedEntries?: number;
    keptEntries?: number;
  } | null;
  issue: WorkerMemoryIssue | null;
};

export type NativeMemoryPayloads = {
  status: OpenClawMemoryStatusPayload;
  dreamDiary: OpenClawMemoryDreamDiaryPayload;
};
