import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";
import type { OpenClawStabilityRelease } from "@/lib/openclaw/stability-types";

export type OpenClawReleaseDirection = "upgrade" | "downgrade" | "same" | "unknown";
export type OpenClawReleaseConfidenceChange = "improved" | "reduced" | "unchanged" | "unknown";

export type OpenClawReleaseComparison = {
  direction: OpenClawReleaseDirection;
  confidenceChange: OpenClawReleaseConfidenceChange;
  scoreDelta: number | null;
  negativeIssueDelta: number | null;
  advisoryDelta: number | null;
  watchIssueDelta: number | null;
  crossedReleaseCount: number | null;
};

export function compareOpenClawReleases(input: {
  installedVersion: string | null;
  installedRelease: OpenClawStabilityRelease | null;
  targetRelease: OpenClawStabilityRelease | null;
  releases: OpenClawStabilityRelease[];
}): OpenClawReleaseComparison {
  const targetVersion = input.targetRelease?.version ?? null;
  const direction = resolveDirection(input.installedVersion, targetVersion);
  const scoreDelta = subtractNullable(input.targetRelease?.score, input.installedRelease?.score);

  return {
    direction,
    confidenceChange: resolveConfidenceChange(scoreDelta),
    scoreDelta,
    negativeIssueDelta: subtractNullable(
      input.targetRelease?.negativeIssues,
      input.installedRelease?.negativeIssues
    ),
    advisoryDelta: subtractNullable(
      input.targetRelease?.affectedAdvisoryCount,
      input.installedRelease?.affectedAdvisoryCount
    ),
    watchIssueDelta: subtractNullable(
      input.targetRelease?.watchIssueCount,
      input.installedRelease?.watchIssueCount
    ),
    crossedReleaseCount: countCrossedReleases(input.installedVersion, targetVersion, input.releases)
  };
}

function resolveDirection(currentVersion: string | null, targetVersion: string | null): OpenClawReleaseDirection {
  if (!currentVersion || !targetVersion) {
    return "unknown";
  }

  const comparison = compareVersionStrings(targetVersion, currentVersion);

  if (comparison > 0) {
    return "upgrade";
  }

  if (comparison < 0) {
    return "downgrade";
  }

  return "same";
}

function resolveConfidenceChange(scoreDelta: number | null): OpenClawReleaseConfidenceChange {
  if (scoreDelta == null) {
    return "unknown";
  }

  if (scoreDelta > 0) {
    return "improved";
  }

  if (scoreDelta < 0) {
    return "reduced";
  }

  return "unchanged";
}

function subtractNullable(next: number | null | undefined, current: number | null | undefined) {
  return typeof next === "number" && typeof current === "number" ? next - current : null;
}

function countCrossedReleases(
  currentVersion: string | null,
  targetVersion: string | null,
  releases: OpenClawStabilityRelease[]
) {
  if (!currentVersion || !targetVersion) {
    return null;
  }

  const lowerVersion = compareVersionStrings(currentVersion, targetVersion) < 0 ? currentVersion : targetVersion;
  const upperVersion = lowerVersion === currentVersion ? targetVersion : currentVersion;

  return releases.filter((release) => (
    compareVersionStrings(release.version, lowerVersion) > 0 &&
    compareVersionStrings(release.version, upperVersion) <= 0
  )).length;
}
