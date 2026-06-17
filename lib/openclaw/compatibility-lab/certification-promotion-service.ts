import "server-only";

import { createHash } from "node:crypto";

import {
  listOpenClawCertificationScorecards,
  persistOpenClawCompatibilityCertificationPromotion,
  persistOpenClawCompatibilityManifestOverride,
  readOpenClawCompatibilityLabReport
} from "@/lib/openclaw/compatibility-lab/store";
import type {
  OpenClawCompatibilityCertificationPromotion,
  OpenClawCompatibilityLabReport
} from "@/lib/openclaw/compatibility-lab/types";
import type { OpenClawCertificationScorecardReport } from "@/lib/openclaw/types";
import {
  LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST,
  type OpenClawCompatibilityManifest
} from "@/lib/openclaw/update-compatibility";
import { redactSecrets } from "@/lib/security/redaction";

export async function promoteOpenClawCompatibilityCertification(input: {
  reportId: string;
}) {
  const report = await readOpenClawCompatibilityLabReport(input.reportId);
  if (!report) {
    throw new Error("OpenClaw compatibility lab report was not found.");
  }

  const scorecard = await findMatchingCertificationScorecard(report);
  if (!scorecard) {
    throw new Error("Run target certification before promoting this OpenClaw version.");
  }

  validatePromotionEvidence(report, scorecard);

  const promotedAt = new Date().toISOString();
  const promotion = redactSecrets(buildPromotionArtifact({
    report,
    scorecard,
    promotedAt
  }));
  const manifest = buildPromotedManifestOverride({
    targetVersion: report.targetOpenClawVersion,
    minRequiredAgentOsVersion: report.manifestDecision.minRequiredAgentOsVersion,
    promotedAt,
    reportId: report.id,
    scorecard
  });

  await persistOpenClawCompatibilityManifestOverride(redactSecrets(manifest));
  await persistOpenClawCompatibilityCertificationPromotion(promotion);

  return {
    promotion,
    manifest
  };
}

async function findMatchingCertificationScorecard(report: OpenClawCompatibilityLabReport) {
  const scorecards = await listOpenClawCertificationScorecards();

  return scorecards.find((scorecard) =>
    normalizeVersion(scorecard.targetVersion) === normalizeVersion(report.targetOpenClawVersion) &&
      normalizeVersion(scorecard.baselineVersion) === normalizeVersion(report.currentCertifiedBaseline)
  ) ?? null;
}

export function validatePromotionEvidence(
  report: OpenClawCompatibilityLabReport,
  scorecard: OpenClawCertificationScorecardReport
) {
  const nonPolicyBlockers = report.areas.filter((area) =>
    area.id !== "manifest-policy" &&
      area.blocksCertification &&
      area.status !== "passed"
  );

  if (nonPolicyBlockers.length > 0) {
    throw new Error("OpenClaw compatibility lab report still has certification blockers.");
  }

  if (!scorecard.artifact) {
    throw new Error("Certification scorecard artifact is missing.");
  }

  if (scorecard.hardBlockers.length > 0) {
    throw new Error("Certification scorecard still has hard blockers.");
  }

  if (scorecard.roundTripEvidence.status !== "passed") {
    throw new Error("Round-trip certification evidence has not passed.");
  }

  if (scorecard.status !== "pre_certified_eligible" && scorecard.status !== "certified") {
    throw new Error(`Certification scorecard is not eligible for promotion: ${scorecard.status}.`);
  }
}

function buildPromotionArtifact(input: {
  report: OpenClawCompatibilityLabReport;
  scorecard: OpenClawCertificationScorecardReport;
  promotedAt: string;
}): OpenClawCompatibilityCertificationPromotion {
  const idSeed = [
    input.report.id,
    input.scorecard.generatedAt,
    input.promotedAt
  ].join(":");

  return {
    schemaVersion: 1,
    id: `openclaw-cert-${input.report.targetOpenClawVersion}-${createHash("sha256").update(idSeed).digest("hex").slice(0, 12)}`,
    reportId: input.report.id,
    promotedAt: input.promotedAt,
    targetOpenClawVersion: input.report.targetOpenClawVersion,
    previousCertifiedBaseline: input.report.currentCertifiedBaseline,
    promotedRecommendedVersion: input.report.targetOpenClawVersion,
    scorecardGeneratedAt: input.scorecard.generatedAt,
    scorecardStatus: input.scorecard.status,
    score: input.scorecard.score,
    evidence: {
      roundTripStatus: input.scorecard.roundTripEvidence.status,
      hardBlockers: input.scorecard.hardBlockers,
      warnings: input.scorecard.warnings,
      artifactAvailable: Boolean(input.scorecard.artifact)
    },
    operatorAction: "certify-target"
  };
}

export function buildPromotedManifestOverride(input: {
  targetVersion: string;
  minRequiredAgentOsVersion?: string | null;
  promotedAt: string;
  reportId: string;
  scorecard: OpenClawCertificationScorecardReport;
}): OpenClawCompatibilityManifest {
  const targetVersion = normalizeVersion(input.targetVersion) ?? input.targetVersion;
  const versions = new Map(
    LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST.versions.map((entry) => [
      normalizeVersion(entry.version) ?? entry.version,
      { ...entry }
    ])
  );

  versions.set(targetVersion, {
    version: targetVersion,
    status: "certified",
    minRequiredAgentOsVersion:
      normalizeVersion(input.minRequiredAgentOsVersion) ??
      LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST.minRequiredAgentOsVersion,
    notes: `Certified locally by OpenClaw Compatibility Lab on ${input.promotedAt}.`,
    reason:
      `Local certification promotion from report ${input.reportId}; score ${input.scorecard.score}/100; round-trip ${input.scorecard.roundTripEvidence.status}.`
  });

  return {
    ...LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST,
    source: "override",
    recommendedVersion: targetVersion,
    versions: Array.from(versions.values()).sort((left, right) =>
      compareVersions(left.version, right.version)
    )
  };
}

function normalizeVersion(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^v/i, "");
  return normalized || null;
}

function compareVersions(left: string, right: string) {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) {
      return delta;
    }
  }

  return 0;
}
