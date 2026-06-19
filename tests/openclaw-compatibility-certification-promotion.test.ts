import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPromotedManifestOverride,
  validatePromotionEvidence
} from "@/lib/openclaw/compatibility-lab/certification-promotion-service";
import type { OpenClawCompatibilityLabReport } from "@/lib/openclaw/compatibility-lab/types";
import type { OpenClawCertificationScorecardReport } from "@/lib/openclaw/types";

test("certification promotion builds a local override manifest for the target", () => {
  const scorecard = createEligibleScorecard();
  const manifest = buildPromotedManifestOverride({
    targetVersion: "2026.7.0",
    minRequiredAgentOsVersion: "0.7.2",
    promotedAt: "2026-06-17T12:00:00.000Z",
    reportId: "openclaw-lab-2026.7.0",
    scorecard
  });

  const promoted = manifest.versions.find((entry) => entry.version === "2026.7.0");

  assert.equal(manifest.source, "override");
  assert.equal(manifest.recommendedVersion, "2026.7.0");
  assert.equal(promoted?.status, "certified");
  assert.match(promoted?.reason ?? "", /openclaw-lab-2026\.7\.0/);
});

test("certification promotion allows manifest policy blocker but rejects runtime blockers and missing artifacts", () => {
  const policyOnlyReport = createReport({
    certificationBlocked: true,
    areas: [
      {
        id: "manifest-policy",
        name: "Manifest and certification policy",
        status: "warning",
        evidence: ["Manifest decision: unknown."],
        expectedBehaviorOrShape: {},
        actualBehaviorOrShape: {},
        affectedAgentOsFiles: [],
        suggestedFixScope: "Promote only after evidence passes.",
        recommendedNextAction: "Certify target after target evidence passes.",
        blocksCertification: true
      }
    ]
  });
  const runtimeBlockedReport = createReport({
    certificationBlocked: true,
    areas: [
      {
        id: "runtime-smoke",
        name: "Runtime smoke behavior",
        status: "failed",
        evidence: ["Runtime smoke failed."],
        expectedBehaviorOrShape: {},
        actualBehaviorOrShape: {},
        affectedAgentOsFiles: [],
        suggestedFixScope: "Fix runtime smoke.",
        recommendedNextAction: "Rerun smoke.",
        blocksCertification: true
      }
    ]
  });
  const scorecard = createEligibleScorecard();

  assert.doesNotThrow(() => validatePromotionEvidence(policyOnlyReport, scorecard));
  assert.throws(
    () => validatePromotionEvidence(runtimeBlockedReport, scorecard),
    /still has certification blockers/
  );

  assert.throws(
    () => validatePromotionEvidence(createReport(), { ...scorecard, artifact: null }),
    /artifact is missing/
  );
});

test("certification promotion rejects non-passing round trip evidence", () => {
  const scorecard = createEligibleScorecard({
    roundTripEvidence: {
      ...createEligibleScorecard().roundTripEvidence,
      status: "failed"
    }
  });

  assert.throws(
    () => validatePromotionEvidence(createReport(), scorecard),
    /Round-trip certification evidence has not passed/
  );
});

function createReport(
  overrides: Partial<OpenClawCompatibilityLabReport> = {}
): OpenClawCompatibilityLabReport {
  return {
    schemaVersion: 1,
    id: "openclaw-lab-2026.7.0",
    generatedAt: "2026-06-17T11:59:00.000Z",
    targetOpenClawVersion: "2026.7.0",
    currentCertifiedBaseline: "2026.6.8",
    installedOpenClawVersion: "2026.7.0",
    manifestDecision: {
      version: "2026.7.0",
      status: "unknown",
      allowed: false,
      defaultVisible: false,
      requiresExplicitOptIn: true,
      requiresAgentOsUpdate: false,
      minRequiredAgentOsVersion: "0.7.2",
      reason: "Unknown OpenClaw versions are hidden from the default update path.",
      notes: null
    },
    probeTimestamp: "2026-06-17T11:59:00.000Z",
    status: "passed",
    certificationBlocked: false,
    acceptedWarnings: [],
    summary: {
      passed: 10,
      warnings: 0,
      failed: 0,
      unknown: 0,
      recommendedNextAction: "Target is eligible for certification promotion."
    },
    areas: [],
    ...overrides
  };
}

function createEligibleScorecard(
  overrides: Partial<OpenClawCertificationScorecardReport> = {}
): OpenClawCertificationScorecardReport {
  const base: OpenClawCertificationScorecardReport = {
    generatedAt: "2026-06-17T12:00:00.000Z",
    baselineVersion: "2026.6.8",
    targetVersion: "2026.7.0",
    score: 96,
    status: "pre_certified_eligible",
    globalCertification: "not_certified",
    hardBlockers: [],
    warnings: [],
    unknowns: [],
    categories: [],
    capabilityDiff: null,
    capabilityBlockerRows: [],
    pluginConfigFindings: [],
    roundTripEvidence: {
      status: "passed",
      baselineVersion: "2026.6.8",
      targetVersion: "2026.7.0",
      startedAt: "2026-06-17T11:50:00.000Z",
      finishedAt: "2026-06-17T12:00:00.000Z",
      steps: [],
      failureMessage: null
    },
    artifact: {
      schemaVersion: 1,
      generatedAt: "2026-06-17T12:00:00.000Z",
      baselineVersion: "2026.6.8",
      targetVersion: "2026.7.0",
      score: 96,
      status: "pre_certified_eligible",
      globalCertification: "not_certified",
      hardBlockers: [],
      warnings: [],
      unknowns: [],
      categories: [],
      capabilityDiff: null,
      capabilityBlockerRows: [],
      pluginConfigFindings: [],
      roundTripEvidence: {
        status: "passed",
        baselineVersion: "2026.6.8",
        targetVersion: "2026.7.0",
        startedAt: "2026-06-17T11:50:00.000Z",
        finishedAt: "2026-06-17T12:00:00.000Z",
        steps: [],
        failureMessage: null
      }
    }
  };

  return {
    ...base,
    ...overrides
  };
}
