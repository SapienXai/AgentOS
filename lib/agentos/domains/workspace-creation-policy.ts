import type { KnowledgeIngestionLimits } from "@/lib/agentos/domains/workspace-knowledge-ingestion";

export type WorkspaceCreationDepth = "fast" | "medium" | "high";
/** Legacy values remain readable without rewriting immutable runs. */
export type WorkspaceCreationProfile = WorkspaceCreationDepth | "quick" | "deep";
export const WORKSPACE_CREATION_PROFILES = [
  { id: "fast", label: "Fast", timing: "Fastest", description: "Essential setup", learns: "Project · Identity · Instructions" },
  { id: "medium", label: "Medium", timing: "A little longer", description: "Project + preferences", learns: "Essentials · Preferences · Memory" },
  { id: "high", label: "High", timing: "Most thorough", description: "Full project intelligence", learns: "Memory · Resources · Workflows" }
] as const;
export const WORKSPACE_CREATION_FILES = {
  fast: ["AGENTS.md", "SOUL.md", "IDENTITY.md"],
  medium: ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "MEMORY.md"],
  high: ["AGENTS.md", "SOUL.md", "IDENTITY.md", "USER.md", "MEMORY.md", "context/PROJECT.md", "context/RESOURCES.md", "context/WORKFLOWS.md"]
} as const;
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
  profile: WorkspaceCreationDepth;
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
  profile: "high",
  budget: DEEP_BUDGET,
  contextLimits: {},
  maxSpecialists: 8,
  compositionStrategy: "model",
  stopWhenSufficient: false
};

const QUICK_POLICY: WorkspaceCreationPolicy = {
  profile: "fast",
  budget: QUICK_BUDGET,
  contextLimits: QUICK_CONTEXT_LIMITS,
  maxSpecialists: 2,
  compositionStrategy: "deterministic-safe",
  stopWhenSufficient: true
};

export function resolveWorkspaceCreationPolicy(profile: WorkspaceCreationProfile | null | undefined): WorkspaceCreationPolicy {
  const depth = normalizeWorkspaceCreationProfile(profile);
  if (depth === "high") return { ...DEEP_POLICY, profile: "high" };
  if (depth === "medium") return {
    ...QUICK_POLICY, profile: "medium", stopWhenSufficient: false,
    budget: { ...QUICK_BUDGET, overallAnalysisBudgetMs: 90_000, architectReserveMs: 25_000, intelligenceReserveMs: 25_000, maxArchitectAttemptMs: 25_000, maxIntelligenceAttemptMs: 25_000 },
    contextLimits: { ...QUICK_CONTEXT_LIMITS, maxPagesPerSource: 12, maxDepth: 2, totalRunTimeoutMs: 25_000 }
  };
  return { ...QUICK_POLICY, profile: "fast" };
}

export function normalizeWorkspaceCreationProfile(value: unknown): WorkspaceCreationDepth {
  if (value !== undefined && value !== null && !["quick", "deep", "fast", "medium", "high"].includes(String(value))) {
    throw new Error("Workspace creation profile is invalid.");
  }
  return value === "deep" || value === "high" ? "high" : value === "medium" ? "medium" : "fast";
}

export function normalizeWorkspaceCreationTrigger(value: unknown): WorkspaceCreationTrigger {
  if (value === "manual-refresh") return "manual-refresh";
  if (value === "post-create-enrichment") return "post-create-enrichment";
  return "initial";
}
