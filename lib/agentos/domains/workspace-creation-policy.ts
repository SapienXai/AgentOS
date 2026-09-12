import type { KnowledgeIngestionLimits } from "@/lib/agentos/domains/workspace-knowledge-ingestion";

export type WorkspaceCreationProfile = "quick" | "deep";
export type WorkspaceCreationTrigger = "initial" | "manual-refresh" | "post-create-enrichment";

export type WorkspaceCreationExecutionBudget = {
  overallAnalysisBudgetMs: number;
  architectReserveMs: number;
  intelligenceReserveMs: number;
  maxArchitectAttempts: number;
  maxArchitectAttemptMs: number;
  maxIntelligenceAttempts: number;
  maxIntelligenceAttemptMs: number;
  composerReserveMs: number;
  maxComposerAttempts: number;
  maxComposerAttemptMs: number;
};

export type WorkspaceCreationPolicy = {
  profile: WorkspaceCreationProfile;
  budget: WorkspaceCreationExecutionBudget;
  contextLimits: Partial<KnowledgeIngestionLimits>;
  maxSpecialists: number;
  compositionStrategy: "model" | "deterministic-safe";
  stopWhenSufficient: boolean;
};

const DEEP_BUDGET: WorkspaceCreationExecutionBudget = {
  overallAnalysisBudgetMs: 300_000,
  architectReserveMs: 90_000,
  intelligenceReserveMs: 90_000,
  maxArchitectAttempts: 3,
  maxArchitectAttemptMs: 90_000,
  maxIntelligenceAttempts: 2,
  maxIntelligenceAttemptMs: 75_000,
  composerReserveMs: 45_000,
  maxComposerAttempts: 2,
  maxComposerAttemptMs: 60_000
};

const QUICK_BUDGET: WorkspaceCreationExecutionBudget = {
  overallAnalysisBudgetMs: 30_000,
  architectReserveMs: 8_000,
  intelligenceReserveMs: 6_000,
  maxArchitectAttempts: 1,
  maxArchitectAttemptMs: 8_000,
  maxIntelligenceAttempts: 1,
  maxIntelligenceAttemptMs: 6_000,
  composerReserveMs: 5_000,
  maxComposerAttempts: 1,
  maxComposerAttemptMs: 5_000
};

const QUICK_CONTEXT_LIMITS: Partial<KnowledgeIngestionLimits> = {
  maxPagesPerSource: 6,
  maxDepth: 1,
  maxBytesPerDocument: 512_000,
  maxTotalBytesPerSource: 2_000_000,
  maxRedirects: 2,
  requestTimeoutMs: 3_000,
  totalRunTimeoutMs: 8_000,
  maxConcurrentRequests: 2,
  maxSitemaps: 2
};

const DEEP_POLICY: WorkspaceCreationPolicy = {
  profile: "deep",
  budget: DEEP_BUDGET,
  contextLimits: {},
  maxSpecialists: 8,
  compositionStrategy: "model",
  stopWhenSufficient: false
};

const QUICK_POLICY: WorkspaceCreationPolicy = {
  profile: "quick",
  budget: QUICK_BUDGET,
  contextLimits: QUICK_CONTEXT_LIMITS,
  maxSpecialists: 2,
  compositionStrategy: "deterministic-safe",
  stopWhenSufficient: true
};

export function resolveWorkspaceCreationPolicy(profile: WorkspaceCreationProfile | null | undefined): WorkspaceCreationPolicy {
  return profile === "deep" ? DEEP_POLICY : QUICK_POLICY;
}

export function normalizeWorkspaceCreationProfile(value: unknown): WorkspaceCreationProfile {
  if (value !== undefined && value !== null && value !== "quick" && value !== "deep") {
    throw new Error("Workspace creation profile is invalid.");
  }
  return value === "deep" ? "deep" : "quick";
}

export function normalizeWorkspaceCreationTrigger(value: unknown): WorkspaceCreationTrigger {
  if (value === "manual-refresh") return "manual-refresh";
  if (value === "post-create-enrichment") return "post-create-enrichment";
  return "initial";
}
