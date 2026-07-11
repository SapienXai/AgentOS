export type OperationTrigger =
  | { kind: "at"; at: string; timezone?: string | null }
  | { kind: "cron"; expression: string; timezone?: string | null }
  | { kind: "every"; everyMs: number };

export type OperationAction = "create" | "update" | "run" | "pause" | "resume" | "cancel" | "retry" | "disable";

export type OperationSafety = {
  accountTargetId?: string | null;
  requiresApproval?: boolean;
  fileLease?: string | null;
  concurrency: "allow" | "forbid" | "replace";
};

export type OperationJob = {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  status: "active" | "scheduled" | "running" | "failed" | "paused" | "completed" | "unknown";
  agentId: string | null;
  workspaceId: string | null;
  prompt: string | null;
  model: string | null;
  thinking: string | null;
  trigger: OperationTrigger | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  /** Gateway transcript projection for the most recent completed cron turn. */
  latestOutput?: string | null;
  recentResults?: OperationResult[];
  sessionKey?: string | null;
  sessionId?: string | null;
  safety: OperationSafety | null;
  health: { consecutiveFailures: number; successRate: number | null; degraded: boolean };
  capabilities: { readable: boolean; mutable: boolean; runHistory: boolean; reason: string | null };
};

export type OperationRun = {
  id: string;
  jobId: string;
  status: "queued" | "running" | "ok" | "error" | "skipped" | "unknown";
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  sessionId: string | null;
  output: string | null;
  error: string | null;
  tokens: number | null;
  cost: number | null;
  artifacts: string[];
};

export type OperationResult = {
  id: string;
  timestamp: string;
  text: string;
};

export type OperationAuditEntry = {
  id: string;
  at: string;
  action: OperationAction;
  jobId: string | null;
  outcome: "accepted" | "blocked" | "failed";
  detail: string;
  requestId: string;
};

export type OperationsSnapshot = {
  generatedAt: string;
  source: "openclaw.cron" | "unavailable";
  scheduler: { enabled: boolean | null; nextWakeAt: string | null; state: "available" | "unsupported" | "degraded" };
  jobs: OperationJob[];
  runs: OperationRun[];
  audit: OperationAuditEntry[];
  notices: Array<{ severity: "warning" | "error"; title: string; detail: string }>;
};

export type OperationJobInput = {
  name: string;
  description?: string | null;
  agentId: string;
  workspaceId: string;
  prompt: string;
  model?: string | null;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
  trigger: OperationTrigger;
  context?: { sessionTarget?: "isolated" | "main" | `session:${string}`; lightContext?: boolean };
  safety?: Partial<OperationSafety>;
};
