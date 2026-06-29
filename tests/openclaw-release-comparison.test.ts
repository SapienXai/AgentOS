import assert from "node:assert/strict";
import { test } from "node:test";

import { compareOpenClawReleases } from "@/lib/openclaw/release-comparison";
import type { OpenClawStabilityRelease } from "@/lib/openclaw/stability-types";

test("release comparison reports upgrade confidence and risk deltas", () => {
  const installed = release("2026.6.8", { score: 72, negativeIssues: 4, affectedAdvisoryCount: 2 });
  const target = release("2026.6.10", { score: 84, negativeIssues: 2, affectedAdvisoryCount: 1 });
  const comparison = compareOpenClawReleases({
    installedVersion: installed.version,
    installedRelease: installed,
    targetRelease: target,
    releases: [target, release("2026.6.9"), installed]
  });

  assert.equal(comparison.direction, "upgrade");
  assert.equal(comparison.confidenceChange, "improved");
  assert.equal(comparison.scoreDelta, 12);
  assert.equal(comparison.negativeIssueDelta, -2);
  assert.equal(comparison.advisoryDelta, -1);
  assert.equal(comparison.crossedReleaseCount, 2);
});

test("release comparison keeps unavailable advisory data unknown", () => {
  const comparison = compareOpenClawReleases({
    installedVersion: "2026.6.10",
    installedRelease: null,
    targetRelease: release("2026.6.8"),
    releases: []
  });

  assert.equal(comparison.direction, "downgrade");
  assert.equal(comparison.confidenceChange, "unknown");
  assert.equal(comparison.scoreDelta, null);
  assert.equal(comparison.negativeIssueDelta, null);
  assert.equal(comparison.crossedReleaseCount, 0);
});

function release(
  version: string,
  overrides: Partial<OpenClawStabilityRelease> = {}
): OpenClawStabilityRelease {
  return {
    version,
    tag: `v${version}`,
    name: null,
    publishedAt: null,
    releaseAgeMs: null,
    url: null,
    score: null,
    band: null,
    status: null,
    uiStatus: "unknown",
    recommended: false,
    reason: null,
    negativeIssues: null,
    positiveIssues: null,
    watchIssueCount: null,
    brokenSurfaceCount: null,
    affectedAdvisoryCount: null,
    scoredAt: null,
    ...overrides
  };
}
