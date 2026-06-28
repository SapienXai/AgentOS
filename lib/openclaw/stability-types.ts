export type OpenClawStabilityUiStatus = "recommended" | "stable" | "caution" | "wait" | "risky" | "skip" | "unknown";
export type OpenClawStabilitySource = "network" | "cache" | "unavailable";

export type OpenClawStabilityRelease = {
  version: string;
  tag: string;
  name: string | null;
  publishedAt: string | null;
  releaseAgeMs: number | null;
  url: string | null;
  score: number | null;
  band: string | null;
  status: string | null;
  uiStatus: OpenClawStabilityUiStatus;
  recommended: boolean;
  reason: string | null;
  negativeIssues: number | null;
  positiveIssues: number | null;
  watchIssueCount: number | null;
  brokenSurfaceCount: number | null;
  affectedAdvisoryCount: number | null;
  scoredAt: string | null;
};

export type OpenClawStabilitySnapshot = {
  source: OpenClawStabilitySource;
  fetchedAt: string | null;
  cacheAgeMs: number | null;
  repo: string | null;
  latestVersion: string | null;
  recommendedVersion: string | null;
  releases: OpenClawStabilityRelease[];
  error: string | null;
};
