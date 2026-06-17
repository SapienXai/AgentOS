import "server-only";

import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  OpenClawCodexFixBundle,
  OpenClawCompatibilityCertificationPromotion,
  OpenClawCompatibilityLabReport
} from "@/lib/openclaw/compatibility-lab/types";
import type { OpenClawCertificationScorecardReport } from "@/lib/openclaw/types";
import type { OpenClawCompatibilityManifest } from "@/lib/openclaw/update-compatibility";

const compatibilityLabRoot = path.join(process.cwd(), ".mission-control", "openclaw-compatibility-lab");
const reportsDir = path.join(compatibilityLabRoot, "reports");
const fixBundlesDir = path.join(compatibilityLabRoot, "fix-bundles");
const scorecardsDir = path.join(compatibilityLabRoot, "scorecards");
const promotionsDir = path.join(compatibilityLabRoot, "promotions");
const manifestOverridePath = path.join(compatibilityLabRoot, "compatibility-manifest.override.json");

export async function persistOpenClawCompatibilityLabReport(report: OpenClawCompatibilityLabReport) {
  await mkdir(reportsDir, { recursive: true });
  const reportPath = getOpenClawCompatibilityLabReportPath(report.id);
  await writeJsonArtifact(reportPath, report);
  return reportPath;
}

export async function readLatestOpenClawCompatibilityLabReport() {
  const reports = await listOpenClawCompatibilityLabReports();
  return reports[0] ?? null;
}

export async function readOpenClawCompatibilityLabReport(reportId: string) {
  const normalizedId = normalizeArtifactId(reportId);
  if (!normalizedId) {
    return null;
  }

  return readJsonArtifact<OpenClawCompatibilityLabReport>(
    getOpenClawCompatibilityLabReportPath(normalizedId),
    isCompatibilityLabReport
  );
}

export async function listOpenClawCompatibilityLabReports() {
  let entries: string[];

  try {
    entries = await readdir(reportsDir);
  } catch {
    return [];
  }

  const reports = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => readJsonArtifact<OpenClawCompatibilityLabReport>(
        path.join(reportsDir, entry),
        isCompatibilityLabReport
      ))
  );

  return reports
    .filter((report): report is OpenClawCompatibilityLabReport => Boolean(report))
    .sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt));
}

export async function persistOpenClawCodexFixBundle(bundle: OpenClawCodexFixBundle) {
  await mkdir(fixBundlesDir, { recursive: true });
  const bundlePath = getOpenClawCodexFixBundlePath(bundle.reportId);
  await writeJsonArtifact(bundlePath, bundle);
  return bundlePath;
}

export async function readOpenClawCodexFixBundle(reportId: string) {
  const normalizedId = normalizeArtifactId(reportId);
  if (!normalizedId) {
    return null;
  }

  return readJsonArtifact<OpenClawCodexFixBundle>(
    getOpenClawCodexFixBundlePath(normalizedId),
    isCodexFixBundle
  );
}

export async function persistOpenClawCertificationScorecard(scorecard: OpenClawCertificationScorecardReport) {
  await mkdir(scorecardsDir, { recursive: true });
  const scorecardPath = getOpenClawCertificationScorecardPath(scorecard);
  await writeJsonArtifact(scorecardPath, scorecard);
  return scorecardPath;
}

export async function listOpenClawCertificationScorecards() {
  let entries: string[];

  try {
    entries = await readdir(scorecardsDir);
  } catch {
    return [];
  }

  const scorecards = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .map((entry) => readJsonArtifact<OpenClawCertificationScorecardReport>(
        path.join(scorecardsDir, entry),
        isCertificationScorecard
      ))
  );

  return scorecards
    .filter((scorecard): scorecard is OpenClawCertificationScorecardReport => Boolean(scorecard))
    .sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt));
}

export async function persistOpenClawCompatibilityCertificationPromotion(
  promotion: OpenClawCompatibilityCertificationPromotion
) {
  await mkdir(promotionsDir, { recursive: true });
  const promotionPath = path.join(promotionsDir, `${normalizeArtifactId(promotion.id) ?? "invalid"}.json`);
  await writeJsonArtifact(promotionPath, promotion);
  return promotionPath;
}

export async function persistOpenClawCompatibilityManifestOverride(manifest: OpenClawCompatibilityManifest) {
  await mkdir(compatibilityLabRoot, { recursive: true });
  await writeJsonArtifact(manifestOverridePath, manifest);
  return manifestOverridePath;
}

export async function readOpenClawCompatibilityManifestOverride() {
  return readJsonArtifact<OpenClawCompatibilityManifest>(
    manifestOverridePath,
    isCompatibilityManifest
  );
}

export function getOpenClawCompatibilityLabReportPath(reportId: string) {
  return path.join(reportsDir, `${normalizeArtifactId(reportId) ?? "invalid"}.json`);
}

export function getOpenClawCodexFixBundlePath(reportId: string) {
  return path.join(fixBundlesDir, `${normalizeArtifactId(reportId) ?? "invalid"}.json`);
}

function getOpenClawCertificationScorecardPath(scorecard: OpenClawCertificationScorecardReport) {
  const seed = [
    scorecard.targetVersion,
    scorecard.baselineVersion,
    scorecard.generatedAt
  ].join(":");
  return path.join(scorecardsDir, `${normalizeArtifactId(`scorecard-${seed}`) ?? "invalid"}.json`);
}

function normalizeArtifactId(value: string | null | undefined) {
  const normalized = value?.trim().replace(/[^A-Za-z0-9_.:-]+/g, "-");
  return normalized || null;
}

async function writeJsonArtifact(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await chmod(filePath, 0o600).catch(() => {});
}

async function readJsonArtifact<TValue>(
  filePath: string,
  predicate: (value: unknown) => value is TValue
) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
    return predicate(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isCompatibilityLabReport(value: unknown): value is OpenClawCompatibilityLabReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Partial<OpenClawCompatibilityLabReport>;
  return record.schemaVersion === 1 &&
    typeof record.id === "string" &&
    typeof record.generatedAt === "string" &&
    typeof record.targetOpenClawVersion === "string" &&
    Array.isArray(record.areas);
}

function isCodexFixBundle(value: unknown): value is OpenClawCodexFixBundle {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Partial<OpenClawCodexFixBundle>;
  return record.schemaVersion === 1 &&
    typeof record.reportId === "string" &&
    typeof record.createdAt === "string" &&
    Array.isArray(record.failures);
}

function isCertificationScorecard(value: unknown): value is OpenClawCertificationScorecardReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Partial<OpenClawCertificationScorecardReport>;
  return typeof record.generatedAt === "string" &&
    typeof record.baselineVersion === "string" &&
    typeof record.targetVersion === "string" &&
    typeof record.score === "number" &&
    Array.isArray(record.hardBlockers) &&
    Boolean(record.roundTripEvidence);
}

function isCompatibilityManifest(value: unknown): value is OpenClawCompatibilityManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const record = value as Partial<OpenClawCompatibilityManifest>;
  return record.schemaVersion === 1 &&
    record.source === "override" &&
    typeof record.recommendedVersion === "string" &&
    Array.isArray(record.versions);
}
