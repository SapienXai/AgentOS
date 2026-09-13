import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST
} from "@/lib/openclaw/update-compatibility";
import { getOpenClawManifestStatus } from "@/lib/openclaw/upstream/impact-classifier";
import {
  OPENCLAW_FINAL_CERTIFICATION_PHASE,
  OPENCLAW_NATIVE_CONTRACT_VERSION,
  OPENCLAW_RECOMMENDED_VERSION,
  OPENCLAW_SUPPORTED_BASELINE_VERSION,
  getOpenClawFinalCertificationArtifactType,
  getOpenClawFinalCertificationFilename
} from "@/lib/openclaw/versions";
import { buildOpenClawCompatibilityIntake, renderOpenClawCompatibilityIssue } from "@/lib/openclaw/upstream/compatibility-intake";
import { getOpenClawReleaseContractDiff } from "@/lib/openclaw/upstream/contract-diff";
import { createGitHubIssueClient, syncOpenClawCompatibilityIssue, type GitHubIssueClient } from "@/lib/openclaw/upstream/github-issue-client";
import { discoverOfficialOpenClawReleases, assertValidOpenClawReleaseVersion, type ReleaseWatcherFetch } from "@/lib/openclaw/upstream/release-discovery";
import type { OpenClawCompatibilityManifest } from "@/lib/openclaw/update-compatibility";
import type {
  OpenClawCertifiedEvidence,
  OpenClawCertifiedEvidenceLookup,
  OpenClawCompatibilityIntake,
  OpenClawProductionConfigPin,
  OpenClawReleaseCandidate,
  OpenClawReleaseReconciliation
} from "@/lib/openclaw/upstream/types";
import { verifyOfficialOpenClawRelease } from "@/lib/openclaw/upstream/release-identity";

const execFile = promisify(execFileCallback);

export type OpenClawReleaseWatchOptions = {
  mode?: "scheduled" | "manual";
  targetVersion?: string | null;
  includePrerelease?: boolean;
  dryRun?: boolean;
  forceRefresh?: boolean;
  outputDir?: string;
  certifiedEvidenceDir?: string;
  productionConfigPath?: string | null;
  productionConfigText?: string | null;
  githubToken?: string | null;
  githubRepository?: string | null;
  issueClient?: GitHubIssueClient;
  fetchImpl?: ReleaseWatcherFetch;
  agentosCommit?: string;
  agentosVersion?: string;
  now?: () => Date;
  recommendedVersion?: string;
  supportedBaselineVersion?: string;
  nativeContractVersion?: string;
  showHelp?: boolean;
};

export type OpenClawReleaseWatchResult = {
  status: "current" | "intake-generated" | "discovery-failed" | "backlog-truncated" | "intake-blocked";
  discovery: Awaited<ReturnType<typeof discoverOfficialOpenClawReleases>>;
  intakes: Array<{
    version: string;
    intakePath: string | null;
    contractDiffPath: string | null;
    issuePath: string | null;
    issueAction: string;
    intakeHash: string;
    lifecycleStage: string;
    lifecycleStatus: string;
    certifiedEvidenceStatus: OpenClawCertifiedEvidenceLookup["status"];
    certifiedEvidencePath: string | null;
    identityStatus: OpenClawReleaseReconciliation["identityStatus"];
    productionConfigStatus: OpenClawReleaseReconciliation["productionConfigStatus"];
    reconciliationStatus: OpenClawReleaseReconciliation["status"];
    issueMetadataStatus: "missing" | "current" | "stale" | "identity-mismatch" | "not-requested";
  }>;
  productionConfig: OpenClawProductionConfigPin;
  message: string;
};

export async function runOpenClawReleaseWatch(options: OpenClawReleaseWatchOptions = {}): Promise<OpenClawReleaseWatchResult> {
  const mode = options.mode ?? (options.targetVersion ? "manual" : "scheduled");
  const productionConfig = await readOpenClawProductionConfigPin({
    configPath: options.productionConfigPath,
    configText: options.productionConfigText
  });
  const recommendedVersion = assertValidOpenClawReleaseVersion(
    options.recommendedVersion ?? OPENCLAW_RECOMMENDED_VERSION,
    "Recommended OpenClaw version"
  );
  const supportedBaselineVersion = assertValidOpenClawReleaseVersion(
    options.supportedBaselineVersion ?? OPENCLAW_SUPPORTED_BASELINE_VERSION,
    "Supported OpenClaw baseline version"
  );
  const nativeContractVersion = assertValidOpenClawReleaseVersion(
    options.nativeContractVersion ?? OPENCLAW_NATIVE_CONTRACT_VERSION,
    "Native OpenClaw contract version"
  );
  const targetVersion = options.targetVersion ? assertValidOpenClawReleaseVersion(options.targetVersion, "Target OpenClaw version") : null;
  const discovery = await discoverOfficialOpenClawReleases({
    currentRecommendedVersion: recommendedVersion,
    targetVersion,
    includePrerelease: options.includePrerelease,
    githubToken: options.githubToken,
    fetchImpl: options.fetchImpl
  });

  if (discovery.status === "discovery-failed") {
    await writeWatcherSummary(`## OpenClaw Release Watch\n\n**Status:** DISCOVERY_FAILED\n\n${safeSummary(discovery.error ?? "Official discovery failed.")}`, options);
    return { status: "discovery-failed", discovery, intakes: [], productionConfig, message: discovery.error ?? "Official discovery failed." };
  }

  const releasesForIntake = selectOpenClawReleasesForIntake(discovery.releases, LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST);
  if (releasesForIntake.length === 0) {
    const message = `OpenClaw upstream check\nAgentOS recommended: ${recommendedVersion}\nLatest official stable: ${discovery.latestStableVersion ?? "unknown"}\nStatus: current`;
    await writeWatcherSummary(`## OpenClaw Release Watch\n\n${message.replaceAll("\n", "\n\n")}`, options);
    return { status: "current", discovery, intakes: [], productionConfig, message };
  }

  const outputDir = options.outputDir ?? path.join(process.cwd(), ".openclaw-release-intake");
  await mkdir(outputDir, { recursive: true });
  const agentosCommit = options.agentosCommit ?? await readGitCommit();
  const agentosVersion = options.agentosVersion ?? await readAgentOsVersion();
  const issueClient = options.issueClient ?? createIssueClientFromEnvironment(options);
  const intakes: OpenClawReleaseWatchResult["intakes"] = [];
  let blockedIntakeCount = 0;
  let baseVersion = recommendedVersion;

  for (const release of releasesForIntake) {
    const verification = await verifyOfficialOpenClawRelease({
      version: release.version,
      githubToken: options.githubToken,
      fetchImpl: options.fetchImpl
    });
    const contractDiff = await getOpenClawReleaseContractDiff({
      fromVersion: baseVersion,
      targetVersion: release.version,
      fetchImpl: options.fetchImpl,
      bypassCache: options.forceRefresh
    });
    const intake = buildOpenClawCompatibilityIntake({
      generatedAt: (options.now ?? (() => new Date()))().toISOString(),
      intakeMode: mode,
      agentosCommit,
      agentosVersion,
      recommendedOpenClaw: recommendedVersion,
      supportedBaselineOpenClaw: supportedBaselineVersion,
      nativeContractOpenClaw: nativeContractVersion,
      identity: verification.identity,
      contractDiff,
      releaseNotes: verification.releaseNotes,
      manifest: LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST
    });
    const certifiedEvidence = await loadOpenClawCertifiedEvidence({
      version: release.version,
      evidenceDir: options.certifiedEvidenceDir
    });
    const reconciliation = reconcileOpenClawReleaseEvidence({
      intake,
      certifiedEvidence,
      productionConfig
    });
    const intakePath = await writeArtifact(outputDir, `openclaw-${release.version}-intake.json`, intake);
    const contractDiffPath = await writeArtifact(outputDir, `openclaw-${release.version}-contract-diff.json`, contractDiff);
    const issuePath = await writeTextArtifact(outputDir, `openclaw-${release.version}-issue.md`, renderOpenClawCompatibilityIssue(intake));
    let issueAction = "not-requested";
    let issueMetadataStatus: OpenClawReleaseWatchResult["intakes"][number]["issueMetadataStatus"] = "not-requested";
    if (reconciliation.status === "blocked") {
      issueAction = "identity-mismatch";
      issueMetadataStatus = "identity-mismatch";
    } else if (issueClient) {
      const issueResult = await syncOpenClawCompatibilityIssue({ intake, client: issueClient, dryRun: options.dryRun });
      issueAction = issueResult.action;
      issueMetadataStatus = issueResult.metadataStatus;
    }
    intakes.push({
      version: release.version,
      intakePath,
      contractDiffPath,
      issuePath,
      issueAction,
      intakeHash: intake.intakeHash,
      lifecycleStage: intake.lifecycle.currentStage,
      lifecycleStatus: intake.lifecycle.stages.find((stage) => stage.id === intake.lifecycle.currentStage)?.status ?? "unknown",
      certifiedEvidenceStatus: certifiedEvidence.status,
      certifiedEvidencePath: certifiedEvidence.path,
      identityStatus: reconciliation.identityStatus,
      productionConfigStatus: reconciliation.productionConfigStatus,
      reconciliationStatus: reconciliation.status,
      issueMetadataStatus
    });
    if (
      reconciliation.status === "blocked" ||
      intake.identity.status !== "verified" ||
      intake.contractDiff.status === "unknown" ||
      intake.contractDiff.evidenceGaps.length > 0
    ) {
      blockedIntakeCount += 1;
    }
    baseVersion = release.version;
  }

  const truncated = discovery.truncated;
  const status = truncated
    ? "backlog-truncated"
    : blockedIntakeCount > 0
      ? "intake-blocked"
      : "intake-generated";
  const message = truncated
    ? `Processed ${intakes.length} release(s), but ${discovery.remainingReleaseCount} additional release(s) remain outside the bounded intake limit.`
    : blockedIntakeCount > 0
      ? `Generated ${intakes.length} intake(s), but ${blockedIntakeCount} require additional authoritative evidence before review can proceed.`
    : `Generated ${intakes.length} OpenClaw compatibility intake(s).`;
  await writeWatcherSummary(buildWatcherSummary({ discovery, intakes, message, productionConfig }), options);
  return { status, discovery, intakes, productionConfig, message };
}

export function selectOpenClawReleasesForIntake(
  releases: OpenClawReleaseCandidate[],
  manifest: OpenClawCompatibilityManifest
) {
  return releases.filter((release) => getOpenClawManifestStatus({ manifest, version: release.version }).status !== "certified");
}

export async function loadOpenClawCertifiedEvidence(input: {
  version: string;
  evidenceDir?: string;
}): Promise<OpenClawCertifiedEvidenceLookup> {
  const evidenceRoot = input.evidenceDir ?? path.join(process.cwd(), "docs/evidence");
  const evidencePath = path.resolve(evidenceRoot, getOpenClawFinalCertificationFilename(input.version));
  let raw: string;
  try {
    raw = await readFile(evidencePath, "utf8");
  } catch {
    const historicalPath = await findHistoricalCertificationPath(evidenceRoot, input.version);
    if (historicalPath) {
      return {
        status: "invalid",
        path: historicalPath,
        evidence: null,
        reason: "Only historical certification evidence was found; it is not promotable as pre-merge final evidence."
      };
    }
    return {
      status: "missing",
      path: evidencePath,
      evidence: null,
      reason: "No repository-certified final evidence file was found for this release."
    };
  }

  try {
    const record = JSON.parse(raw) as unknown;
    const invalidReason = validateCertifiedEvidenceRecord(record, input.version);
    if (invalidReason) {
      return { status: "invalid", path: evidencePath, evidence: null, reason: invalidReason };
    }
    const evidence = parseCertifiedEvidence(record);
    return {
      status: "found",
      path: evidencePath,
      evidence,
      reason: "Repository-certified pre-merge final evidence passed its identity, test, and commit-binding checks."
    };
  } catch {
    return {
      status: "invalid",
      path: evidencePath,
      evidence: null,
      reason: "The repository-certified evidence could not be parsed safely."
    };
  }
}

export async function readOpenClawProductionConfigPin(input: {
  configPath?: string | null;
  configText?: string | null;
} = {}): Promise<OpenClawProductionConfigPin> {
  const configPath = input.configPath === null
    ? null
    : path.resolve(input.configPath ?? path.join(process.cwd(), "Dockerfile.railway"));
  if (!configPath) {
    return {
      status: "missing",
      path: null,
      version: null,
      image: null,
      digest: null,
      reason: "No production deployment configuration was supplied for reconciliation."
    };
  }

  let configText = input.configText;
  if (configText === undefined) {
    try {
      configText = await readFile(configPath, "utf8");
    } catch {
      return {
        status: "missing",
        path: configPath,
        version: null,
        image: null,
        digest: null,
        reason: "The repository production deployment configuration was not found."
      };
    }
  }
  if (configText === null) {
    return {
      status: "missing",
      path: configPath,
      version: null,
      image: null,
      digest: null,
      reason: "No production deployment configuration was supplied for reconciliation."
    };
  }

  const match = /^\s*FROM\s+(ghcr\.io\/openclaw\/openclaw):([0-9]{4}\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)@sha256:([a-f0-9]{64})\s*$/m.exec(configText);
  if (!match) {
    return {
      status: "invalid",
      path: configPath,
      version: null,
      image: null,
      digest: null,
      reason: "The repository production deployment configuration has no exact OpenClaw image digest pin."
    };
  }
  return {
    status: "found",
    path: configPath,
    version: match[2],
    image: `${match[1]}:${match[2]}`,
    digest: match[3],
    reason: "The repository production deployment configuration contains an exact OpenClaw image digest pin."
  };
}

export function reconcileOpenClawReleaseEvidence(input: {
  intake: OpenClawCompatibilityIntake;
  certifiedEvidence: OpenClawCertifiedEvidenceLookup;
  productionConfig: OpenClawProductionConfigPin;
}): OpenClawReleaseReconciliation {
  const reasons: string[] = [];
  let identityStatus: OpenClawReleaseReconciliation["identityStatus"] = "unavailable";
  if (input.certifiedEvidence.status !== "found" || !input.certifiedEvidence.evidence) {
    reasons.push(input.certifiedEvidence.reason);
  } else {
    const evidence = input.certifiedEvidence.evidence;
    const mismatches = [
      evidence.version !== input.intake.identity.version ? `certified evidence version is ${evidence.version}, expected ${input.intake.identity.version}` : null,
      evidence.sourceCommit !== input.intake.identity.sourceCommit ? "certified evidence source commit does not match the intake identity" : null,
      evidence.buildId !== input.intake.identity.buildId ? "certified evidence build ID does not match the intake identity" : null
    ].filter((value): value is string => Boolean(value));
    identityStatus = mismatches.length > 0 ? "mismatch" : "match";
    reasons.push(...mismatches);
    if (!evidence.certifiedCodeHead) {
      reasons.push("Certified evidence has no fresh certifiedCodeHead provenance field.");
    }
  }

  let productionConfigStatus: OpenClawReleaseReconciliation["productionConfigStatus"] = "unknown";
  if (input.productionConfig.status !== "found") {
    reasons.push(input.productionConfig.reason);
  } else if (input.productionConfig.version !== input.intake.upstream.version) {
    productionConfigStatus = "mismatch";
    reasons.push(`Repository production pin is ${input.productionConfig.version}, while this intake targets ${input.intake.upstream.version}.`);
  } else {
    productionConfigStatus = "match";
    const certifiedPin = input.certifiedEvidence.evidence?.deploymentPin;
    if (certifiedPin?.version && certifiedPin.version !== input.productionConfig.version) {
      productionConfigStatus = "mismatch";
      reasons.push("Repository production pin does not match the deployment pin recorded by certified evidence.");
    }
    if (certifiedPin?.digest && certifiedPin.digest !== input.productionConfig.digest) {
      productionConfigStatus = "mismatch";
      reasons.push("Repository production image digest does not match the deployment pin recorded by certified evidence.");
    }
  }

  return {
    status: identityStatus === "mismatch" || input.certifiedEvidence.status === "invalid" ? "blocked" : "reviewable",
    identityStatus,
    certifiedEvidenceStatus: input.certifiedEvidence.status,
    productionConfigStatus,
    reasons
  };
}

function parseCertifiedEvidence(value: unknown): OpenClawCertifiedEvidence {
  const record = asRecord(value);
  const provenance = asRecord(record?.provenance);
  const openClaw = asRecord(provenance?.openClaw);
  const roles = asRecord(record?.versionRoles);
  const deploymentPin = asRecord(roles?.deploymentPin);
  const image = readString(deploymentPin?.image);
  const imageVersion = image ? /:([^:]+)$/.exec(image)?.[1] ?? null : null;
  return {
    schemaVersion: typeof record?.schemaVersion === "number" ? record.schemaVersion : null,
    artifactType: readString(record?.artifactType),
    phase: readString(record?.phase),
    success: typeof record?.success === "boolean" ? record.success : null,
    tests: parseTestAssessment(record?.tests),
    version: readString(openClaw?.version),
    sourceCommit: readString(openClaw?.sourceCommit),
    buildId: readString(openClaw?.buildId),
    packageHash: readString(openClaw?.packageHash),
    gatewayClientVersion: readString(openClaw?.gatewayClientVersion),
    gatewayProtocolVersion: readString(openClaw?.gatewayProtocolVersion),
    stateSchema: readNumber(openClaw?.stateSchema),
    agentSchema: readNumber(openClaw?.agentSchema),
    certifiedCodeHead: readString(provenance?.certifiedCodeHead),
    evidenceCommit: readString(provenance?.evidenceCommit),
    deploymentPin: deploymentPin
      ? {
          version: readString(deploymentPin.version) ?? imageVersion,
          image,
          digest: readString(deploymentPin.digest) ?? readString(deploymentPin.indexDigest)
        }
      : null
  };
}

function validateCertifiedEvidenceRecord(value: unknown, version: string): string | null {
  const record = asRecord(value);
  const provenance = asRecord(record?.provenance);
  const openClaw = asRecord(provenance?.openClaw);
  const tests = asRecord(record?.tests);
  if (record?.schemaVersion !== 2) return "Certified evidence schemaVersion must be 2.";
  if (record?.artifactType !== getOpenClawFinalCertificationArtifactType(version)) return "Certified evidence artifactType does not match the pre-merge final identity.";
  if (record?.phase !== OPENCLAW_FINAL_CERTIFICATION_PHASE) return "Certified evidence phase does not identify pre-merge final certification.";
  if (record?.success !== true) return "Certified evidence success must be true.";
  if (tests?.status !== "PASS") return "Certified evidence tests must have PASS status.";
  const requiredArtifactCount = readNumber(tests?.requiredArtifactCount);
  const passedArtifactCount = readNumber(tests?.passedArtifactCount);
  const failedArtifactCount = readNumber(tests?.failedArtifactCount);
  const unknownOutcomeCount = readNumber(tests?.unknownOutcomeCount);
  if (requiredArtifactCount === null || requiredArtifactCount < 1 || passedArtifactCount !== requiredArtifactCount || failedArtifactCount !== 0 || unknownOutcomeCount !== 0) {
    return "Certified evidence tests are incomplete or contain failed/unknown outcomes.";
  }
  const stateSchema = readNumber(openClaw?.stateSchema);
  const agentSchema = readNumber(openClaw?.agentSchema);
  if (!openClaw || openClaw.version !== version || !readString(openClaw.sourceCommit) || !isGitCommit(readString(openClaw.sourceCommit) ?? "") || !readString(openClaw.buildId) || !isSha256(readString(openClaw.packageHash) ?? "") || openClaw.gatewayClientVersion !== version || openClaw.gatewayProtocolVersion !== version || stateSchema === null || stateSchema < 1 || agentSchema === null || agentSchema < 1) {
    return "Certified evidence does not contain the exact OpenClaw package identity.";
  }
  const certifiedCodeHead = readString(provenance?.certifiedCodeHead);
  const evidenceCommit = readString(provenance?.evidenceCommit);
  if (!isGitCommit(certifiedCodeHead ?? "") || !isGitCommit(evidenceCommit ?? "")) {
    return "Certified evidence must bind 40-character Git commits for both code and evidence.";
  }
  if (certifiedCodeHead === evidenceCommit) return "Certified code and evidence commits must be distinct bindings.";
  return null;
}

async function findHistoricalCertificationPath(evidenceRoot: string, version: string) {
  for (const filename of [
    `openclaw-${version}-phase-1-final-certification.json`,
    `openclaw-${version}-final-certification.json`
  ]) {
    const candidatePath = path.resolve(evidenceRoot, filename);
    try {
      await readFile(candidatePath, "utf8");
      return candidatePath;
    } catch {
      // Historical evidence is only reported when a file is actually present.
    }
  }
  return null;
}

function parseTestAssessment(value: unknown): OpenClawCertifiedEvidence["tests"] {
  const tests = asRecord(value);
  return tests
    ? {
        status: tests.status === "PASS" || tests.status === "FAIL" ? tests.status : null,
        requiredArtifactCount: readNumber(tests.requiredArtifactCount),
        passedArtifactCount: readNumber(tests.passedArtifactCount),
        failedArtifactCount: readNumber(tests.failedArtifactCount),
        unknownOutcomeCount: readNumber(tests.unknownOutcomeCount)
      }
    : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isGitCommit(value: string) {
  return /^[0-9a-f]{40}$/i.test(value);
}

function isSha256(value: string) {
  return /^[0-9a-f]{64}$/i.test(value);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.showHelp) return;
  const result = await runOpenClawReleaseWatch(options);
  console.log(result.message);
  if (result.status === "discovery-failed" || result.status === "backlog-truncated" || result.status === "intake-blocked") {
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): OpenClawReleaseWatchOptions {
  const options: OpenClawReleaseWatchOptions = {
    mode: process.env.GITHUB_EVENT_NAME === "workflow_dispatch" ? "manual" : "scheduled",
    targetVersion: process.env.OPENCLAW_WATCH_TARGET_VERSION?.trim() || null,
    includePrerelease: process.env.OPENCLAW_WATCH_INCLUDE_PRERELEASE === "true",
    dryRun: process.env.OPENCLAW_WATCH_DRY_RUN === "true",
    forceRefresh: process.env.OPENCLAW_WATCH_FORCE_REFRESH === "true",
    outputDir: process.env.OPENCLAW_WATCH_OUTPUT_DIR?.trim() || undefined,
    certifiedEvidenceDir: process.env.OPENCLAW_WATCH_CERTIFIED_EVIDENCE_DIR?.trim() || undefined,
    productionConfigPath: process.env.OPENCLAW_WATCH_PRODUCTION_CONFIG?.trim() || undefined,
    githubToken: process.env.GITHUB_TOKEN?.trim() || null,
    githubRepository: process.env.GITHUB_REPOSITORY?.trim() || null
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--target") {
      if (!next || next.startsWith("-")) throw new Error("--target requires a valid OpenClaw version.");
      options.targetVersion = assertValidOpenClawReleaseVersion(next, "Target OpenClaw version");
      options.mode = "manual";
      index += 1;
    } else if (arg === "--include-prerelease") {
      options.includePrerelease = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--force-refresh") {
      options.forceRefresh = true;
    } else if (arg === "--output-dir") {
      if (!next || next.startsWith("-")) throw new Error("--output-dir requires a path.");
      options.outputDir = path.resolve(next);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: pnpm openclaw:release-watch [--target VERSION] [--include-prerelease] [--dry-run] [--force-refresh] [--output-dir PATH]");
      options.showHelp = true;
      return options;
    } else {
      throw new Error(`Unknown release watcher option: ${arg}`);
    }
  }
  if (options.targetVersion && options.mode !== "manual") options.mode = "manual";
  if (!options.githubToken) options.dryRun = true;
  return options;
}

function createIssueClientFromEnvironment(options: OpenClawReleaseWatchOptions) {
  if (options.dryRun) return null;
  if (!options.githubToken) throw new Error("GITHUB_TOKEN is required for non-dry-run issue synchronization.");
  if (!options.githubRepository) throw new Error("GITHUB_REPOSITORY is required for non-dry-run issue synchronization.");
  return createGitHubIssueClient({ repository: options.githubRepository, token: options.githubToken });
}

async function writeArtifact(outputDir: string, fileName: string, value: unknown) {
  const filePath = safeArtifactPath(outputDir, fileName);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

async function writeTextArtifact(outputDir: string, fileName: string, value: string) {
  const filePath = safeArtifactPath(outputDir, fileName);
  await writeFile(filePath, `${value}\n`, "utf8");
  return filePath;
}

function safeArtifactPath(outputDir: string, fileName: string) {
  if (!/^openclaw-20\d{2}\.\d{1,2}\.\d{1,2}(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?-(?:intake|contract-diff|issue)\.(?:json|md)$/.test(fileName)) {
    throw new Error("Release watcher artifact name is invalid.");
  }
  const resolvedDir = path.resolve(outputDir);
  const resolvedPath = path.resolve(resolvedDir, fileName);
  if (!resolvedPath.startsWith(`${resolvedDir}${path.sep}`)) throw new Error("Release watcher artifact path escaped its output directory.");
  return resolvedPath;
}

async function readGitCommit() {
  const result = await execFile("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), maxBuffer: 1_000_000 });
  const commit = result.stdout.trim();
  return /^[0-9a-f]{40}$/i.test(commit) ? commit : "unknown";
}

async function readAgentOsVersion() {
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "packages/agentos/package.json"), "utf8")) as { version?: unknown };
  return typeof packageJson.version === "string" ? packageJson.version : "unknown";
}

async function writeWatcherSummary(summary: string, options: OpenClawReleaseWatchOptions) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) await appendFile(summaryPath, `${summary}\n`, "utf8");
  if (options.outputDir) {
    await mkdir(options.outputDir, { recursive: true });
    await writeFile(path.join(options.outputDir, "openclaw-release-watch-summary.md"), `${summary}\n`, "utf8");
  }
}

function buildWatcherSummary(input: {
  discovery: Awaited<ReturnType<typeof discoverOfficialOpenClawReleases>>;
  intakes: OpenClawReleaseWatchResult["intakes"];
  productionConfig: OpenClawProductionConfigPin;
  message: string;
}) {
  return [
    "## OpenClaw Release Watch",
    "",
    `- AgentOS recommended: \`${input.discovery.currentRecommendedVersion}\``,
    `- Latest official stable: \`${input.discovery.latestStableVersion ?? "unknown"}\``,
    `- Discovered releases: ${input.discovery.releases.map((release) => `\`${release.version}\``).join(", ") || "none"}`,
    `- Repository production pin: **${input.productionConfig.status}**${input.productionConfig.version ? ` — \`${input.productionConfig.version}\`` : ""}`,
    `- Production reconciliation: ${safeSummary(input.productionConfig.reason)}`,
    `- Result: ${input.message}`,
    ...input.intakes.map((intake) => `- ${intake.version}: lifecycle **${intake.lifecycleStage}/${intake.lifecycleStatus}**; certified evidence **${intake.certifiedEvidenceStatus}/${intake.identityStatus}**; production pin **${intake.productionConfigStatus}**; issue metadata **${intake.issueMetadataStatus}**; issue action **${intake.issueAction}**; evidence hash \`${intake.intakeHash}\``),
    "",
    "The watcher only creates compatibility-review evidence. Certification and version promotion remain human decisions."
  ].join("\n");
}

function safeSummary(value: string) {
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 1_000);
}

if (process.argv[1]?.endsWith("openclaw-release-watch.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "OpenClaw release watcher failed.");
    process.exitCode = 1;
  });
}
