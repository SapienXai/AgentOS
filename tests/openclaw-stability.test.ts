import assert from "node:assert/strict";
import { test } from "node:test";

import {
  mapOpenClawStabilityStatus,
  normalizeOpenClawReleaseVersion,
  parseOpenClawStabilityReleases
} from "@/lib/openclaw/stability";

test("OpenClaw stability parser normalizes release radar payloads", () => {
  const releases = parseOpenClawStabilityReleases(
    [
      {
        tag: "v2026.6.10",
        name: "openclaw 2026.6.10",
        publishedAt: "2026-06-24T03:06:38Z",
        htmlUrl: "https://github.com/openclaw/openclaw/releases/tag/v2026.6.10",
        finalScore: 9.4,
        band: "solid",
        status: "eligible",
        recommended: true,
        reason: "latest",
        negativeIssues: 858,
        positiveIssues: 0,
        brokenSurfaces: [{ label: "Codex" }],
        advisories: {
          affected: {
            total: 0
          }
        }
      },
      {
        tag: "v2026.5.26",
        finalScore: 4.2,
        band: "skip",
        status: "skip-cve",
        recommended: false,
        publishedAt: "2026-05-27T11:27:24Z",
        advisories: {
          affected: {
            total: 2
          }
        }
      }
    ],
    Date.parse("2026-06-28T03:06:38Z")
  );

  assert.equal(releases.length, 2);
  assert.equal(releases[0].version, "2026.6.10");
  assert.equal(releases[0].score, 9.4);
  assert.equal(releases[0].uiStatus, "recommended");
  assert.equal(releases[0].brokenSurfaceCount, 1);
  assert.equal(releases[0].releaseAgeMs, 4 * 24 * 60 * 60 * 1000);
  assert.equal(releases[1].uiStatus, "skip");
  assert.equal(releases[1].affectedAdvisoryCount, 2);
});

test("OpenClaw stability parser accepts public payload release containers", () => {
  const releases = parseOpenClawStabilityReleases({
    repo: "openclaw/openclaw",
    releases: [
      {
        tag: "v2026.6.9",
        score: 9.8,
        band: "solid",
        status: "eligible"
      }
    ]
  });

  assert.equal(releases.length, 1);
  assert.equal(releases[0].version, "2026.6.9");
  assert.equal(releases[0].score, 9.8);
  assert.equal(releases[0].uiStatus, "stable");
});

test("OpenClaw stability status mapping treats score as advisory", () => {
  assert.equal(mapOpenClawStabilityStatus({ score: 9.9, band: "solid", status: "eligible", recommended: false }), "stable");
  assert.equal(mapOpenClawStabilityStatus({ score: 6.4, band: "caution", status: "eligible", recommended: false }), "caution");
  assert.equal(mapOpenClawStabilityStatus({ score: 4.2, band: "solid", status: "skip-cve", recommended: false }), "skip");
});

test("OpenClaw release versions normalize tags and names", () => {
  assert.equal(normalizeOpenClawReleaseVersion("v2026.6.10"), "2026.6.10");
  assert.equal(normalizeOpenClawReleaseVersion("openclaw 2026.6.10"), "2026.6.10");
  assert.equal(normalizeOpenClawReleaseVersion(""), null);
});
