import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  OPENCLAW_NATIVE_CONTRACT_VERSION,
  OPENCLAW_FINAL_CERTIFICATION_PHASE,
  OPENCLAW_RECOMMENDED_VERSION,
  OPENCLAW_SUPPORTED_BASELINE_VERSION,
  buildOpenClawVersionRoles,
  getOpenClawFinalCertificationArtifactType,
  getOpenClawFinalCertificationFilename,
  type OpenClawVersionRoles
} from "@/lib/openclaw/versions";
import {
  OPENCLAW_IDENTITY_CONTRACT_AGENT_SCHEMA,
  OPENCLAW_IDENTITY_CONTRACT_BUILD,
  OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL,
  OPENCLAW_IDENTITY_CONTRACT_PACKAGE_INTEGRITY,
  OPENCLAW_IDENTITY_CONTRACT_TAG,
  OPENCLAW_IDENTITY_CONTRACT_TAG_OBJECT,
  OPENCLAW_IDENTITY_CONTRACT_GATEWAY_CLIENT_INTEGRITY,
  OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL_INTEGRITY,
  OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT,
  OPENCLAW_IDENTITY_CONTRACT_STATE_SCHEMA,
  OPENCLAW_IDENTITY_CONTRACT_VERSION
} from "@/lib/openclaw/identity/contract";
import { REQUIRED_WORKFORCE_PRODUCT_CHECKS } from "@/scripts/lib/workforce-certification-requirements";

const TARGET_VERSION = OPENCLAW_IDENTITY_CONTRACT_VERSION;
const TARGET_COMMIT = OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT;
const TARGET_BUILD = OPENCLAW_IDENTITY_CONTRACT_BUILD;
const TARGET_TAG = OPENCLAW_IDENTITY_CONTRACT_TAG;
const TARGET_TAG_OBJECT = OPENCLAW_IDENTITY_CONTRACT_TAG_OBJECT;
const TARGET_PROTOCOL = OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL;
const TARGET_STATE_SCHEMA = OPENCLAW_IDENTITY_CONTRACT_STATE_SCHEMA;
const TARGET_AGENT_SCHEMA = OPENCLAW_IDENTITY_CONTRACT_AGENT_SCHEMA;
const TARGET_PACKAGE_INTEGRITY = OPENCLAW_IDENTITY_CONTRACT_PACKAGE_INTEGRITY;
const TARGET_GATEWAY_CLIENT_INTEGRITY = OPENCLAW_IDENTITY_CONTRACT_GATEWAY_CLIENT_INTEGRITY;
const TARGET_GATEWAY_PROTOCOL_INTEGRITY = OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL_INTEGRITY;
const PACKAGE_INPUT = process.env.OPENCLAW_FINAL_CERTIFICATION_PACKAGE?.trim();
const PACKAGE_TARBALL_INPUT = process.env.OPENCLAW_FINAL_CERTIFICATION_PACKAGE_TARBALL?.trim();
const GATEWAY_CLIENT_PACKAGE_INPUT = process.env.OPENCLAW_FINAL_CERTIFICATION_GATEWAY_CLIENT_PACKAGE?.trim();
const GATEWAY_CLIENT_TARBALL_INPUT = process.env.OPENCLAW_FINAL_CERTIFICATION_GATEWAY_CLIENT_TARBALL?.trim();
const GATEWAY_PROTOCOL_PACKAGE_INPUT = process.env.OPENCLAW_FINAL_CERTIFICATION_GATEWAY_PROTOCOL_PACKAGE?.trim();
const GATEWAY_PROTOCOL_TARBALL_INPUT = process.env.OPENCLAW_FINAL_CERTIFICATION_GATEWAY_PROTOCOL_TARBALL?.trim();
const UPSTREAM_EVIDENCE_INPUT = process.env.OPENCLAW_FINAL_CERTIFICATION_UPSTREAM_EVIDENCE?.trim() || `docs/evidence/openclaw-${OPENCLAW_IDENTITY_CONTRACT_VERSION}-intake.json`;
const COMPATIBILITY_REPORT_INPUT = process.env.OPENCLAW_FINAL_CERTIFICATION_COMPATIBILITY_REPORT?.trim() || null;
const CHANNEL_RUNTIME_ACCEPTANCE_INPUT = process.env.OPENCLAW_FINAL_CERTIFICATION_CHANNEL_RUNTIME_ACCEPTANCE?.trim() || null;
const CHANNEL_BROWSER_ACCEPTANCE_INPUT = process.env.OPENCLAW_FINAL_CERTIFICATION_CHANNEL_BROWSER_ACCEPTANCE?.trim() || null;
const CERTIFIED_CODE_HEAD_INPUT = process.env.OPENCLAW_FINAL_CERTIFICATION_CERTIFIED_CODE_HEAD?.trim() || null;
const EVIDENCE_COMMIT_INPUT = process.env.OPENCLAW_FINAL_CERTIFICATION_EVIDENCE_COMMIT?.trim() || null;
const MIGRATION_SOURCE_VERSION = process.env.OPENCLAW_FINAL_CERTIFICATION_MIGRATION_SOURCE_VERSION?.trim() || OPENCLAW_SUPPORTED_BASELINE_VERSION;
const FINAL_CERTIFICATION_ARTIFACT_TYPE = getOpenClawFinalCertificationArtifactType(TARGET_VERSION);
const FINAL_CERTIFICATION_FILENAME = getOpenClawFinalCertificationFilename(TARGET_VERSION);
const OUTPUT_PATH = path.resolve(process.env.OPENCLAW_FINAL_CERTIFICATION_OUTPUT?.trim() || `docs/evidence/${FINAL_CERTIFICATION_FILENAME}`);

const REQUIRED_ARTIFACTS = [
  ["contract-diff", process.env.OPENCLAW_FINAL_CERTIFICATION_CONTRACT_DIFF?.trim() || `docs/evidence/openclaw-${MIGRATION_SOURCE_VERSION}-to-${TARGET_VERSION}-contract-diff.json`],
  ["fresh-baseline", `docs/evidence/openclaw-${TARGET_VERSION}-fresh-baseline.json`],
  ["runtime", `docs/evidence/openclaw-${TARGET_VERSION}-runtime-certification.json`],
  ["migration", process.env.OPENCLAW_FINAL_CERTIFICATION_MIGRATION?.trim() || `docs/evidence/openclaw-${MIGRATION_SOURCE_VERSION}-to-${TARGET_VERSION}-migration.json`],
  ["lifecycle", `docs/evidence/openclaw-${TARGET_VERSION}-lifecycle-certification.json`],
  ["identity", `docs/evidence/openclaw-${TARGET_VERSION}-identity-authorization.json`],
  ["multi-user", `docs/evidence/openclaw-${TARGET_VERSION}-multi-user.json`],
  ["multi-user-collaboration", `docs/evidence/openclaw-${TARGET_VERSION}-multi-user-identity-collaboration.json`],
  ["automation", `docs/evidence/openclaw-${TARGET_VERSION}-automation-cron-alignment.json`],
  ["session-task", `docs/evidence/openclaw-${TARGET_VERSION}-session-task-alignment.json`],
  ["workforce", `docs/evidence/openclaw-${TARGET_VERSION}-workforce-acceptance.json`],
  ["official-transport", `docs/evidence/openclaw-${TARGET_VERSION}-official-transport-certification.json`],
  ["official-lifecycle", `docs/evidence/openclaw-${TARGET_VERSION}-official-gateway-lifecycle-certification.json`],
  ["official-production", `docs/evidence/openclaw-${TARGET_VERSION}-final-official-runtime-certification.json`],
  ["native-work", `docs/evidence/openclaw-${TARGET_VERSION}-native-work-hardening.json`],
  ["skills", `docs/evidence/openclaw-${TARGET_VERSION}-skills-effective-capabilities.json`],
  ["memory", `docs/evidence/openclaw-${TARGET_VERSION}-native-memory.json`],
  ["doctor", `docs/evidence/openclaw-${TARGET_VERSION}-doctor-update-recovery.json`],
  ["doctor-hardening", `docs/evidence/openclaw-${TARGET_VERSION}-doctor-update-recovery-hardening.json`],
  ["human-control", `docs/evidence/openclaw-${TARGET_VERSION}-human-control-inbox.json`],
  ["native-update", `docs/evidence/openclaw-${TARGET_VERSION}-native-update-lifecycle.json`]
] as const;

type JsonRecord = Record<string, unknown>;

export type OpenClawExactPackageIdentity = {
  version: string;
  sourceCommit: string;
  buildId: string;
  packageHash: string;
  npmPackageIntegrity: string | null;
  gatewayClientVersion: string | null;
  gatewayClientIntegrity: string | null;
  gatewayProtocolVersion: string | null;
  gatewayProtocolIntegrity: string | null;
  stateSchema: number;
  agentSchema: number;
};

export type OpenClawFinalCertificationReport = {
  schemaVersion: 2;
  artifactType: typeof FINAL_CERTIFICATION_ARTIFACT_TYPE;
  phase: typeof OPENCLAW_FINAL_CERTIFICATION_PHASE;
  generatedAt: string;
  certifiedAt: string;
  agentosHead: string;
  openclawVersion: string;
  openclawSourceSha: string;
  upstreamEvidenceHashes: JsonRecord;
  contractAudit: JsonRecord | null;
  compatibility: JsonRecord | null;
  runtimeAcceptance: JsonRecord | null;
  telegramBrowserAcceptance: JsonRecord | null;
  discordBrowserAcceptance: JsonRecord | null;
  liveTelegram: JsonRecord | null;
  knownExceptions: string[];
  provenance: {
    repository: string;
    certifiedCodeHead: string;
    evidenceCommit: string | null;
    branch: string;
    node: string;
    openClaw: OpenClawExactPackageIdentity | null;
    exactArtifact: "disposable-exact-openclaw-package" | "unavailable";
    expectedOpenClaw: JsonRecord;
    supportedBaseline: string;
    agentosContract: JsonRecord;
  };
  versionRoles: OpenClawVersionRoles;
  tests: {
    status: "PASS" | "FAIL";
    requiredArtifactCount: number;
    passedArtifactCount: number;
    failedArtifactCount: number;
    unknownOutcomeCount: number;
    artifactChecks: JsonRecord;
  };
  skips: number;
  expectedAuthorizationDenials: number;
  production: {
    status: "not-tested";
    gatewayTouched: false;
    configPin: { version: string | null; image: string | null; digest: string | null; status: "found" | "not-found" | "invalid" };
    reason: string;
  };
  matrix: JsonRecord;
  classification: JsonRecord;
  historicalEvidence: { preserved: true; note: string };
  promotion: JsonRecord;
  failures: string[];
  success: boolean;
};

async function main() {
  const failures: string[] = [];
  const artifacts: Record<string, JsonRecord> = {};
  const matrix: Record<string, Record<string, unknown>> = {};
  const packageIdentity = PACKAGE_INPUT && GATEWAY_CLIENT_PACKAGE_INPUT && GATEWAY_PROTOCOL_PACKAGE_INPUT ? await readPackageIdentity(
    path.resolve(PACKAGE_INPUT),
    path.resolve(GATEWAY_CLIENT_PACKAGE_INPUT),
    path.resolve(GATEWAY_PROTOCOL_PACKAGE_INPUT),
    PACKAGE_TARBALL_INPUT ? path.resolve(PACKAGE_TARBALL_INPUT) : null,
    GATEWAY_CLIENT_TARBALL_INPUT ? path.resolve(GATEWAY_CLIENT_TARBALL_INPUT) : null,
    GATEWAY_PROTOCOL_TARBALL_INPUT ? path.resolve(GATEWAY_PROTOCOL_TARBALL_INPUT) : null
  ).catch((error) => {
    failures.push(`cannot inspect exact OpenClaw package: ${safeError(error)}`);
    return null;
  }) : null;
  const upstreamEvidence = await readOptionalJson(UPSTREAM_EVIDENCE_INPUT, "upstream evidence", failures);
  const compatibilityReport = await readOptionalJson(COMPATIBILITY_REPORT_INPUT, "compatibility report", failures);
  const channelRuntimeAcceptance = await readOptionalJson(CHANNEL_RUNTIME_ACCEPTANCE_INPUT, "channel runtime acceptance", failures);
  const channelBrowserAcceptance = await readOptionalJson(CHANNEL_BROWSER_ACCEPTANCE_INPUT, "channel browser acceptance", failures);
  if (!CHANNEL_BROWSER_ACCEPTANCE_INPUT) {
    failures.push("OPENCLAW_FINAL_CERTIFICATION_CHANNEL_BROWSER_ACCEPTANCE is required for final human UX acceptance");
  } else {
    const telegramBrowserAcceptance = asRecord(channelBrowserAcceptance?.telegramBrowserAcceptance);
    const discordBrowserAcceptance = asRecord(channelBrowserAcceptance?.discordBrowserAcceptance);
    const liveTelegram = asRecord(channelBrowserAcceptance?.liveTelegram);
    if (telegramBrowserAcceptance.passed !== true || telegramBrowserAcceptance.stepsPassed !== 26 || telegramBrowserAcceptance.stepsTotal !== 26) {
      failures.push("Telegram browser acceptance must pass all 26 steps");
    }
    if (discordBrowserAcceptance.passed !== true) {
      failures.push("Discord browser acceptance must pass");
    }
    if (!["VERIFIED", "PARTIALLY_VERIFIED", "BLOCKED_BY_ENVIRONMENT"].includes(String(liveTelegram.classification ?? ""))) {
      failures.push("Live Telegram classification must be VERIFIED, PARTIALLY_VERIFIED, or BLOCKED_BY_ENVIRONMENT");
    }
  }
  if (!PACKAGE_INPUT) failures.push("OPENCLAW_FINAL_CERTIFICATION_PACKAGE is not set");
  if (!PACKAGE_TARBALL_INPUT) failures.push("OPENCLAW_FINAL_CERTIFICATION_PACKAGE_TARBALL is not set");
  if (!GATEWAY_CLIENT_PACKAGE_INPUT) failures.push("OPENCLAW_FINAL_CERTIFICATION_GATEWAY_CLIENT_PACKAGE is not set");
  if (!GATEWAY_CLIENT_TARBALL_INPUT) failures.push("OPENCLAW_FINAL_CERTIFICATION_GATEWAY_CLIENT_TARBALL is not set");
  if (!GATEWAY_PROTOCOL_PACKAGE_INPUT) failures.push("OPENCLAW_FINAL_CERTIFICATION_GATEWAY_PROTOCOL_PACKAGE is not set");
  if (!GATEWAY_PROTOCOL_TARBALL_INPUT) failures.push("OPENCLAW_FINAL_CERTIFICATION_GATEWAY_PROTOCOL_TARBALL is not set");
  if (!UPSTREAM_EVIDENCE_INPUT) failures.push("OPENCLAW_FINAL_CERTIFICATION_UPSTREAM_EVIDENCE is not set");
  if (OPENCLAW_RECOMMENDED_VERSION !== TARGET_VERSION || OPENCLAW_NATIVE_CONTRACT_VERSION !== TARGET_VERSION || OPENCLAW_IDENTITY_CONTRACT_VERSION !== TARGET_VERSION) {
    failures.push(`AgentOS recommended, native, and identity contracts are not promoted to ${TARGET_VERSION}`);
  }
  if (OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT !== TARGET_COMMIT || OPENCLAW_IDENTITY_CONTRACT_BUILD !== TARGET_BUILD || OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL !== TARGET_PROTOCOL || OPENCLAW_IDENTITY_CONTRACT_STATE_SCHEMA !== TARGET_STATE_SCHEMA || OPENCLAW_IDENTITY_CONTRACT_AGENT_SCHEMA !== TARGET_AGENT_SCHEMA) {
    failures.push(`AgentOS identity contract does not match the verified ${TARGET_VERSION} identity`);
  }
  if (path.basename(OUTPUT_PATH) !== FINAL_CERTIFICATION_FILENAME) {
    failures.push(`Final certification output must use ${FINAL_CERTIFICATION_FILENAME}.`);
  }
  if (!packageIdentity) {
    // Keep the report deterministic; the failure has already been recorded.
  } else if (packageIdentity.version !== TARGET_VERSION || packageIdentity.sourceCommit !== TARGET_COMMIT || packageIdentity.buildId !== TARGET_BUILD || packageIdentity.gatewayClientVersion !== TARGET_VERSION || packageIdentity.gatewayProtocolVersion !== TARGET_VERSION || packageIdentity.stateSchema !== TARGET_STATE_SCHEMA || packageIdentity.agentSchema !== TARGET_AGENT_SCHEMA) {
    failures.push(`exact ${TARGET_VERSION} package identity, Gateway package versions, build, or schema does not match the verified target`);
  } else if (packageIdentity.npmPackageIntegrity !== TARGET_PACKAGE_INTEGRITY || packageIdentity.gatewayClientIntegrity !== TARGET_GATEWAY_CLIENT_INTEGRITY || packageIdentity.gatewayProtocolIntegrity !== TARGET_GATEWAY_PROTOCOL_INTEGRITY) {
    failures.push(`npm tarball integrity does not match the independently verified ${TARGET_VERSION} package metadata`);
  }
  const intakeIdentity = asRecord(upstreamEvidence?.identity);
  const intakeMismatches = readStringArray(intakeIdentity.mismatches);
  const intakeMissingEvidence = readStringArray(intakeIdentity.missingEvidence);
  if (intakeIdentity.status !== "verified" || intakeIdentity.version !== TARGET_VERSION || intakeIdentity.tag !== TARGET_TAG || intakeIdentity.sourceCommit !== TARGET_COMMIT || intakeIdentity.packageIntegrity !== TARGET_PACKAGE_INTEGRITY || asRecord(intakeIdentity.gatewayClientPackage).integrity !== TARGET_GATEWAY_CLIENT_INTEGRITY || asRecord(intakeIdentity.gatewayProtocolPackage).integrity !== TARGET_GATEWAY_PROTOCOL_INTEGRITY || intakeMismatches.length > 0 || intakeMissingEvidence.length > 0) {
    failures.push(`authenticated upstream release intake does not establish the exact ${TARGET_VERSION} release identity and package integrity`);
  }
  if (!EVIDENCE_COMMIT_INPUT) {
    failures.push("OPENCLAW_FINAL_CERTIFICATION_EVIDENCE_COMMIT is required for final evidence provenance");
  } else if (!resolveRepositoryCommit(EVIDENCE_COMMIT_INPUT)) {
    failures.push("OPENCLAW_FINAL_CERTIFICATION_EVIDENCE_COMMIT must resolve to a Git commit in the repository");
  }

  for (const [name, relativePath] of REQUIRED_ARTIFACTS) {
    try {
      const artifact = JSON.parse(await readFile(path.resolve(relativePath), "utf8")) as JsonRecord;
      artifacts[name] = artifact;
      const result = assessOpenClawCertificationArtifact(name, artifact);
      matrix[name] = { path: relativePath, ...result };
      if (result.status !== "PASS") failures.push(`${name}: ${String(result.reason ?? "artifact did not pass")}`);
    } catch (error) {
      matrix[name] = { path: relativePath, status: "FAIL", skips: 0, environmentLimited: 0, expectedDenials: 0, reason: safeError(error) };
      failures.push(`${name}: ${safeError(error)}`);
    }
  }

  const contract = artifacts["contract-diff"];
  const migration = artifacts.migration;
  if (contract?.success !== true || !hasPassingBooleanChecks(contract?.checks)) failures.push("contract audit checks are incomplete");
  const migrationProvenance = asRecord(migration?.provenance);
  const migrationSource = asRecord(migrationProvenance.source);
  const migrationTarget = asRecord(migrationProvenance.target);
  if (migration?.success !== true || !hasPassingBooleanChecks(migration?.checks) || migrationSource.version !== MIGRATION_SOURCE_VERSION || migrationTarget.version !== TARGET_VERSION) {
    failures.push(`${MIGRATION_SOURCE_VERSION} to ${TARGET_VERSION} migration checks are incomplete or target a different exact release`);
  }

  const deploymentPin = await readRepositoryDeploymentPin();
  const certifiedCodeHead = await gitOutput(["rev-parse", CERTIFIED_CODE_HEAD_INPUT || "HEAD"]);
  if (!resolveRepositoryCommit(certifiedCodeHead)) failures.push("The certified code HEAD does not resolve to a Git commit in the repository");
  if (EVIDENCE_COMMIT_INPUT && EVIDENCE_COMMIT_INPUT.toLowerCase() === certifiedCodeHead.toLowerCase()) failures.push("Certified code and evidence commits must be distinct bindings");
  const report = buildOpenClawFinalCertificationReport({
    generatedAt: new Date().toISOString(),
    certifiedCodeHead,
    evidenceCommit: EVIDENCE_COMMIT_INPUT && resolveRepositoryCommit(EVIDENCE_COMMIT_INPUT) ? EVIDENCE_COMMIT_INPUT : null,
    branch: await gitOutput(["branch", "--show-current"]),
    packageIdentity,
    artifacts,
    matrix,
    deploymentPin,
    upstreamEvidence,
    compatibilityReport,
    channelRuntimeAcceptance,
    channelBrowserAcceptance,
    failures,
    repositoryPath: process.cwd()
  });

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`OPENCLAW ${TARGET_VERSION} FINAL CERTIFICATION: ${report.success ? "PASS" : "FAIL"}`);
  console.log(`Evidence: ${OUTPUT_PATH}`);
  if (!report.success) process.exitCode = 1;
}

export function buildOpenClawFinalCertificationReport(input: {
  generatedAt: string;
  certifiedCodeHead: string;
  evidenceCommit: string | null;
  branch: string;
  packageIdentity: OpenClawExactPackageIdentity | null;
  artifacts: Record<string, JsonRecord>;
  matrix: Record<string, Record<string, unknown>>;
  deploymentPin: RepositoryDeploymentPin;
  upstreamEvidence?: JsonRecord | null;
  compatibilityReport?: JsonRecord | null;
  channelRuntimeAcceptance?: JsonRecord | null;
  channelBrowserAcceptance?: JsonRecord | null;
  failures: string[];
  repositoryPath?: string;
}): OpenClawFinalCertificationReport {
  const statuses = Object.values(input.artifacts).flatMap(collectStatusValues);
  const passedArtifactCount = Object.values(input.matrix).filter((entry) => entry.status === "PASS").length;
  const failedArtifactCount = Object.values(input.matrix).filter((entry) => entry.status === "FAIL").length;
  const unknownOutcomeCount = statuses.filter((value) => value === "UNKNOWN").length;
  const skippedCount = statuses.filter((value) => value === "SKIPPED").length;
  const expectedAuthorizationDenialCount = statuses.filter((value) => value === "EXPECTED-DENIAL" || value === "EXPECTED_DENIAL").length;
  const exactSourceIdentity = Boolean(
    input.packageIdentity &&
    isGitCommit(input.packageIdentity.sourceCommit) &&
    input.packageIdentity.sourceCommit === TARGET_COMMIT
  );
  const exactPackageMatchesTarget = Boolean(
    input.packageIdentity &&
    input.packageIdentity.version === TARGET_VERSION &&
    exactSourceIdentity &&
    input.packageIdentity.buildId === TARGET_BUILD &&
    input.packageIdentity.npmPackageIntegrity === TARGET_PACKAGE_INTEGRITY &&
    input.packageIdentity.gatewayClientVersion === TARGET_VERSION &&
    input.packageIdentity.gatewayClientIntegrity === TARGET_GATEWAY_CLIENT_INTEGRITY &&
    input.packageIdentity.gatewayProtocolVersion === TARGET_VERSION &&
    input.packageIdentity.gatewayProtocolIntegrity === TARGET_GATEWAY_PROTOCOL_INTEGRITY &&
    isSha256(input.packageIdentity.packageHash) &&
    input.packageIdentity.stateSchema === TARGET_STATE_SCHEMA &&
    input.packageIdentity.agentSchema === TARGET_AGENT_SCHEMA
  );
  const migrationProvenance = readMigrationProvenance(input.artifacts.migration);
  const runtimeProvenance = readRuntimeProvenance(input.artifacts.runtime);
  const resolvedCertifiedCodeHead = resolveRepositoryCommit(input.certifiedCodeHead, input.repositoryPath);
  const resolvedEvidenceCommit = resolveRepositoryCommit(input.evidenceCommit, input.repositoryPath);
  const validCommitBinding = Boolean(
    resolvedCertifiedCodeHead &&
    resolvedEvidenceCommit &&
    resolvedCertifiedCodeHead !== resolvedEvidenceCommit
  );
  const reportFailures = [...input.failures];
  if (!resolvedCertifiedCodeHead && !reportFailures.some((failure) => /certified code HEAD|certifiedCodeHead/i.test(failure))) {
    reportFailures.push("The certifiedCodeHead does not resolve to a Git commit in the repository.");
  }
  if (!resolvedEvidenceCommit && !reportFailures.some((failure) => /evidence commit|evidenceCommit/i.test(failure))) {
    reportFailures.push("The evidenceCommit does not resolve to a Git commit in the repository.");
  }
  if (resolvedCertifiedCodeHead && resolvedEvidenceCommit && resolvedCertifiedCodeHead === resolvedEvidenceCommit && !reportFailures.some((failure) => /distinct bindings/i.test(failure))) {
    reportFailures.push("Certified code and evidence commits must be distinct bindings.");
  }
  if (input.packageIdentity && !exactSourceIdentity && !reportFailures.some((failure) => /source identity|package identity/i.test(failure))) {
    reportFailures.push("The exact OpenClaw source identity is malformed or does not match the verified release commit.");
  }
  const completeTestAssessment = reportFailures.length === 0 && exactPackageMatchesTarget && passedArtifactCount > 0 && passedArtifactCount === Object.keys(input.matrix).length && failedArtifactCount === 0 && unknownOutcomeCount === 0 && !statuses.includes("FAIL") && !statuses.includes("UNKNOWN");
  const resolvedAgentosHead = resolvedCertifiedCodeHead ?? input.certifiedCodeHead;
  const compatibilitySummary = asRecord(asRecord(input.compatibilityReport?.report).summary);
  const knownExceptions = Array.from(new Set([
    ...readStringArray(input.upstreamEvidence?.knownExceptions),
    ...readStringArray(input.channelRuntimeAcceptance?.knownExceptions),
    ...(readStringArray(compatibilitySummary.degradedSurfaces).length > 0
      ? [`Compatibility degraded optional surfaces: ${readStringArray(compatibilitySummary.degradedSurfaces).join(", ")}.`]
      : []),
    ...(readStringArray(compatibilitySummary.unsupportedSurfaces).length > 0
      ? [`Compatibility unsupported optional surfaces: ${readStringArray(compatibilitySummary.unsupportedSurfaces).join(", ")}.`]
      : [])
  ]));

  return {
    schemaVersion: 2,
    artifactType: FINAL_CERTIFICATION_ARTIFACT_TYPE,
    phase: OPENCLAW_FINAL_CERTIFICATION_PHASE,
    generatedAt: input.generatedAt,
    certifiedAt: input.generatedAt,
    agentosHead: resolvedAgentosHead,
    openclawVersion: TARGET_VERSION,
    openclawSourceSha: TARGET_COMMIT,
    upstreamEvidenceHashes: asRecord(input.upstreamEvidence?.hashes),
    contractAudit: input.artifacts["contract-diff"] ?? null,
    compatibility: input.compatibilityReport ?? null,
    runtimeAcceptance: input.channelRuntimeAcceptance ?? null,
    telegramBrowserAcceptance: input.channelBrowserAcceptance ? asRecord(input.channelBrowserAcceptance.telegramBrowserAcceptance) : null,
    discordBrowserAcceptance: input.channelBrowserAcceptance ? asRecord(input.channelBrowserAcceptance.discordBrowserAcceptance) : null,
    liveTelegram: input.channelBrowserAcceptance ? asRecord(input.channelBrowserAcceptance.liveTelegram) : null,
    knownExceptions,
    provenance: {
      repository: "SapienXai/AgentOS",
      certifiedCodeHead: resolvedAgentosHead,
      evidenceCommit: resolvedEvidenceCommit ?? input.evidenceCommit,
      branch: input.branch,
      node: process.version,
      openClaw: input.packageIdentity,
      exactArtifact: exactPackageMatchesTarget ? "disposable-exact-openclaw-package" : "unavailable",
      expectedOpenClaw: {
        version: TARGET_VERSION,
        tag: TARGET_TAG,
        tagObjectSha: TARGET_TAG_OBJECT,
        sourceCommit: TARGET_COMMIT,
        buildId: TARGET_BUILD,
        packageIntegrity: TARGET_PACKAGE_INTEGRITY,
        gatewayProtocol: TARGET_PROTOCOL,
        stateSchema: TARGET_STATE_SCHEMA,
        agentSchema: TARGET_AGENT_SCHEMA,
        gatewayClient: TARGET_VERSION,
        gatewayClientIntegrity: TARGET_GATEWAY_CLIENT_INTEGRITY,
        gatewayProtocolPackage: TARGET_VERSION,
        gatewayProtocolIntegrity: TARGET_GATEWAY_PROTOCOL_INTEGRITY
      },
      supportedBaseline: OPENCLAW_SUPPORTED_BASELINE_VERSION,
      agentosContract: {
        recommendedVersion: OPENCLAW_RECOMMENDED_VERSION,
        nativeContractVersion: OPENCLAW_NATIVE_CONTRACT_VERSION,
        identityContractVersion: OPENCLAW_IDENTITY_CONTRACT_VERSION,
        sourceCommit: OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT,
        buildId: OPENCLAW_IDENTITY_CONTRACT_BUILD,
        gatewayProtocol: OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL,
        stateSchema: OPENCLAW_IDENTITY_CONTRACT_STATE_SCHEMA,
        agentSchema: OPENCLAW_IDENTITY_CONTRACT_AGENT_SCHEMA
      }
    },
    versionRoles: buildOpenClawVersionRoles({
      supportedMinimumVersion: OPENCLAW_SUPPORTED_BASELINE_VERSION,
      recommendedVersion: OPENCLAW_RECOMMENDED_VERSION,
      nativeContractVersion: OPENCLAW_NATIVE_CONTRACT_VERSION,
      packageVersions: {
        openClaw: input.packageIdentity?.version ?? null,
        gatewayClient: input.packageIdentity?.gatewayClientVersion ?? null,
        gatewayProtocol: input.packageIdentity?.gatewayProtocolVersion ?? null
      },
      deploymentPin: {
        version: input.deploymentPin.version,
        image: input.deploymentPin.image,
        digest: input.deploymentPin.digest,
        status: input.deploymentPin.status === "found" ? "verified" : "not-tested",
        evidence: input.deploymentPin.reason
      },
      migration: migrationProvenance,
      certifiedIdentity: {
        version: input.packageIdentity?.version ?? null,
        tag: TARGET_TAG,
        sourceCommit: input.packageIdentity?.sourceCommit ?? null,
        buildId: input.packageIdentity?.buildId ?? null,
        packageHash: input.packageIdentity?.packageHash ?? null,
        status: exactPackageMatchesTarget ? "verified" : input.packageIdentity ? "mismatch" : "not-tested",
        evidence: exactPackageMatchesTarget
          ? "Exact OpenClaw package version, source commit, build, and schema identity matched the certification target."
          : "Exact OpenClaw package identity did not fully match the certification target."
      },
      liveRuntime: runtimeProvenance
    }),
    tests: {
      status: completeTestAssessment && validCommitBinding ? "PASS" : "FAIL",
      requiredArtifactCount: Object.keys(input.matrix).length,
      passedArtifactCount,
      failedArtifactCount,
      unknownOutcomeCount,
      artifactChecks: input.matrix
    },
    skips: skippedCount,
    expectedAuthorizationDenials: expectedAuthorizationDenialCount,
    production: {
      status: "not-tested",
      gatewayTouched: false,
      configPin: {
        version: input.deploymentPin.version,
        image: input.deploymentPin.image,
        digest: input.deploymentPin.digest,
        status: input.deploymentPin.status
      },
      reason: "The repository deployment pin was read for consistency only; Railway production was not inspected, mutated, or deployed."
    },
    matrix: input.matrix,
    classification: {
      pass: passedArtifactCount,
      fail: failedArtifactCount,
      skipped: skippedCount,
      environmentLimited: Object.values(input.matrix).reduce((sum, entry) => sum + Number(entry.environmentLimited ?? 0), 0),
      expectedAuthorizationDenials: expectedAuthorizationDenialCount,
      productionGatewayTouched: false,
      railwayMutated: false,
      realCredentialsAccessed: false
    },
    historicalEvidence: {
      preserved: true,
      note: "Existing certification evidence is historical input and was not overwritten by this aggregation."
    },
    promotion: {
      recommendedVersion: TARGET_VERSION,
      nativeContractVersion: TARGET_VERSION,
      supportedBaseline: OPENCLAW_SUPPORTED_BASELINE_VERSION,
      railwayImagePin: "NOT-PERFORMED",
      decision: completeTestAssessment && validCommitBinding ? "PROMOTE" : "BLOCK",
      decisionKind: "recommendation-only"
    },
    failures: reportFailures,
    success: completeTestAssessment && validCommitBinding
  };
}

type RepositoryDeploymentPin = {
  status: "found" | "not-found" | "invalid";
  version: string | null;
  image: string | null;
  digest: string | null;
  reason: string;
};

async function readRepositoryDeploymentPin(): Promise<RepositoryDeploymentPin> {
  const configPath = path.resolve("Dockerfile.railway");
  let source: string;
  try {
    source = await readFile(configPath, "utf8");
  } catch {
    return { status: "not-found", version: null, image: null, digest: null, reason: "Dockerfile.railway was not found." };
  }
  const match = /^\s*FROM\s+(ghcr\.io\/openclaw\/openclaw):([0-9]{4}\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)@sha256:([a-f0-9]{64})\s*$/m.exec(source);
  if (!match) {
    return { status: "invalid", version: null, image: null, digest: null, reason: "Dockerfile.railway has no exact OpenClaw image digest pin." };
  }
  return {
    status: "found",
    version: match[2],
    image: `${match[1]}:${match[2]}`,
    digest: match[3],
    reason: "Dockerfile.railway contains an exact OpenClaw image digest pin."
  };
}

function readMigrationProvenance(artifact: JsonRecord | undefined) {
  const provenance = asRecord(artifact?.provenance);
  const source = asRecord(provenance.source);
  const target = asRecord(provenance.target);
  const checks = Object.values(asRecord(artifact?.checks));
  const success = artifact?.success === true && checks.length > 0 && checks.every(Boolean);
  return {
    sourceVersion: readString(source.version),
    targetVersion: readString(target.version),
    status: success ? "verified" as const : artifact ? "unverified" as const : "not-tested" as const,
    evidence: success
      ? "Migration source and target were exercised by the isolated disposable runtime evidence."
      : "Migration evidence was not a passing isolated runtime result."
  };
}

function readRuntimeProvenance(artifact: JsonRecord | undefined) {
  const runtime = asRecord(artifact?.runtime);
  const targetVersion = readString(runtime.targetVersion);
  const installedVersion = readString(runtime.installedVersion);
  const protocolValue = typeof runtime.protocolVersion === "number" ? runtime.protocolVersion : null;
  const summary = asRecord(runtime.summary);
  const verified = targetVersion === TARGET_VERSION && installedVersion === TARGET_VERSION && protocolValue === TARGET_PROTOCOL && summary.failed === 0 && summary.requiredFailures === 0 && summary.unknown === 0;
  return {
    installedVersion,
    protocolVersion: protocolValue,
    status: verified ? "verified" as const : artifact ? "unverified" as const : "not-tested" as const,
    evidence: verified
      ? "Disposable OpenClaw Gateway runtime reported the exact target version and protocol; this is not production proof."
      : "No passing exact disposable Gateway runtime result was supplied."
  };
}

export function assessOpenClawCertificationArtifact(name: string, artifact: JsonRecord) {
  const statuses = collectStatusValues(artifact);
  const failures: string[] = [];
  if (name === "contract-diff") {
    const target = asRecord(asRecord(artifact.provenance)?.target);
    const checks = asRecord(artifact.checks);
    if (target?.version !== TARGET_VERSION || target?.sourceCommit !== TARGET_COMMIT || target?.stateSchema !== TARGET_STATE_SCHEMA || target?.agentSchema !== TARGET_AGENT_SCHEMA || target?.protocol !== TARGET_PROTOCOL) failures.push("contract target identity/schema/protocol mismatch");
    if (!hasPassingBooleanChecks(checks)) failures.push("contract audit checks are empty or contain a failed check");
  } else if (name === "migration") {
    if (artifact.success !== true) failures.push("migration success is not true");
    if (!hasPassingBooleanChecks(artifact.checks)) failures.push("migration checks are empty or contain a failed check");
  } else if (name === "runtime") {
    const runtime = asRecord(artifact.runtime);
    const summary = asRecord(runtime?.summary);
    if (runtime?.targetVersion !== TARGET_VERSION || runtime?.installedVersion !== TARGET_VERSION || runtime?.protocolVersion !== TARGET_PROTOCOL) failures.push("runtime target identity or protocol mismatch");
    if (summary?.failed !== 0 || summary?.requiredFailures !== 0 || summary?.unknown !== 0) failures.push("runtime contains failures, required failures, or unknown outcomes");
    const staticContract = asRecord(asRecord(artifact.contract).static);
    const descriptorChanges = Array.isArray(staticContract.changes)
      ? staticContract.changes.map(asRecord)
      : [];
    const expectedObservationMethods = [
      "agent.wait",
      "device.scopes.waitUpgrade",
      "exec.approval.waitDecision",
      "plugin.approval.waitDecision",
      "question.waitAnswer"
    ];
    const observationMethods = descriptorChanges
      .filter((change) => change.targetLifetime === "observation")
      .map((change) => change.method)
      .filter((method): method is string => typeof method === "string");
    const unknownLifetimes = descriptorChanges.filter((change) =>
      change.targetLifetime !== null &&
      change.targetLifetime !== undefined &&
      change.targetLifetime !== "observation"
    );
    if (expectedObservationMethods.some((method) => !observationMethods.includes(method)) || unknownLifetimes.length > 0) {
      failures.push("runtime static contract evidence did not preserve the five 2026.9.7 observation lifetimes or contains an unknown lifetime");
    }
  } else if (name === "workforce") {
    const summary = asRecord(artifact.summary);
    const checks = asRecord(artifact.checks);
    const cleanup = asRecord(artifact.cleanup);
    const certification = asRecord(artifact.certification);
    if (summary.failed !== 0 || REQUIRED_WORKFORCE_PRODUCT_CHECKS.some((checkId) => asRecord(checks[checkId]).status !== "PASS")) {
      failures.push("workforce core AgentOS product-path checks are incomplete or failed");
    }
    if (!asRecord(artifact.productPath) || artifact.failure !== null) {
      failures.push("workforce evidence has no completed product path or records an execution failure");
    }
    if (cleanup.disposableRootRemoved !== true || cleanup.gatewayStopped !== true || cleanup.productionGatewayTouched !== false) {
      failures.push("workforce disposable runtime cleanup is incomplete or production was touched");
    }
    if (![
      "FULLY_CERTIFIED",
      "PRODUCT_PATH_CERTIFIED_WITH_UPSTREAM_TASK_GAPS"
    ].includes(String(certification.status))) {
      failures.push("workforce evidence does not report a completed product-path certification");
    }
    const checkStatuses = Object.values(checks).map((check) => asRecord(check).status);
    const expectedPassed = checkStatuses.filter((status) => status === "PASS").length;
    const expectedSkipped = checkStatuses.filter((status) => status === "SKIPPED").length;
    const expectedFailed = checkStatuses.filter((status) => status === "FAIL").length;
    if (summary.passed !== expectedPassed || summary.skipped !== expectedSkipped || summary.failed !== expectedFailed) {
      failures.push("workforce summary counts do not match the recorded check outcomes");
    }
  } else if (name === "official-transport") {
    const requests = asRecord(artifact.requests);
    const denial = asRecord(artifact.authorizationDenial);
    const taskList = asRecord(requests["tasks.list"]);
    const requiredRequestFailure = Object.entries(requests).some(([method, entry]) => {
      const request = asRecord(entry);
      if (method === "tasks.list" && request.status === "skipped" && request.kind === "unsupported") return false;
      return request.status !== "passed";
    });
    const optionalTaskEvidenceInvalid = taskList.status !== "passed" && !(taskList.status === "skipped" && taskList.kind === "unsupported");
    if (requiredRequestFailure || optionalTaskEvidenceInvalid || denial.status !== "denied" || asRecord(artifact.target).protocol !== TARGET_PROTOCOL) {
      failures.push("official transport probes or expected authorization denial failed");
    }
  } else if (name === "native-update") {
    const target = asRecord(artifact.target);
    const update = asRecord(artifact.update);
    const nativeRun = asRecord(update.nativeCliRun);
    const runtime = asRecord(artifact.runtime);
    const restart = asRecord(update.restart);
    if (artifact.artifactType !== `openclaw-${TARGET_VERSION}-native-update-lifecycle-certification` || target.version !== TARGET_VERSION || target.sourceCommit !== TARGET_COMMIT || target.buildId !== TARGET_BUILD || target.gatewayProtocol !== TARGET_PROTOCOL || target.stateSchema !== TARGET_STATE_SCHEMA || target.agentSchema !== TARGET_AGENT_SCHEMA) {
      failures.push("native update evidence does not identify the exact target package contract");
    }
    if (update.mutationOwner !== "OpenClaw native updater" || update.agentOsInvokedUpdateMutation !== false || nativeRun.status !== "succeeded" || nativeRun.target !== TARGET_VERSION || nativeRun.after !== TARGET_VERSION || nativeRun.recoveryVersion !== TARGET_VERSION) {
      failures.push("native update evidence does not establish a successful OpenClaw-owned update and recovery record");
    }
    if (runtime.health !== "PASS" || runtime.installedVersion !== TARGET_VERSION || runtime.updateStatus !== "current" || runtime.activeUpdateRun !== false || runtime.configuration !== "valid" || restart.gatewayFreshlyReconnected !== true) {
      failures.push("native update post-restart runtime verification is incomplete");
    }
    if (!hasPassingBooleanChecks(artifact.checks)) failures.push("native update checks are empty or contain a failed check");
  } else if (artifact.success !== true && !(typeof artifact.gate === "string" && artifact.gate.endsWith("PASS")) && artifact.result !== "PASS") {
    failures.push("artifact success/gate/result is not PASS");
  }
  if (statuses.includes("FAIL") || statuses.includes("UNKNOWN")) failures.push("artifact contains FAIL or UNKNOWN status");
  if (!collectStrings(artifact).includes(TARGET_VERSION)) failures.push(`artifact does not identify OpenClaw ${TARGET_VERSION}`);
  return { status: failures.length === 0 ? "PASS" : "FAIL", skips: statuses.filter((value) => value === "SKIPPED").length, environmentLimited: statuses.filter((value) => value === "ENVIRONMENT-LIMITED").length, expectedDenials: statuses.filter((value) => value === "EXPECTED-DENIAL" || value === "EXPECTED_DENIAL").length, ...(failures.length ? { reason: failures.join("; ") } : {}) };
}

function collectStatusValues(value: unknown): string[] { if (Array.isArray(value)) return value.flatMap(collectStatusValues); if (!value || typeof value !== "object") return []; const record = value as JsonRecord; const current = Object.entries(record).filter(([key, entry]) => ["status", "result", "outcome"].includes(key) && typeof entry === "string").map(([, entry]) => entry as string); return [...current, ...Object.values(record).flatMap(collectStatusValues)]; }
function hasPassingBooleanChecks(value: unknown) { const checks = Object.values(asRecord(value)); return checks.length > 0 && checks.every((check) => check === true); }
function collectStrings(value: unknown): string[] { if (Array.isArray(value)) return value.flatMap(collectStrings); if (typeof value === "string") return [value]; if (!value || typeof value !== "object") return []; return Object.values(value as JsonRecord).flatMap(collectStrings); }
function asRecord(value: unknown): JsonRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function readStringArray(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim()) : []; }
function readString(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function isGitCommit(value: string | null | undefined): value is string { return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value.trim()); }
function resolveRepositoryCommit(value: string | null | undefined, repositoryPath = process.cwd()): string | null { if (!isGitCommit(value)) return null; const candidate = value.trim().toLowerCase(); try { const resolved = execFileSync("git", ["-C", repositoryPath, "rev-parse", "--verify", `${candidate}^{commit}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().toLowerCase(); return isGitCommit(resolved) && resolved === candidate ? resolved : null; } catch { return null; } }
function isSha256(value: string): boolean { return /^[0-9a-f]{64}$/i.test(value); }
export async function readPackageIdentity(
  packageRoot: string,
  gatewayClientPackageRoot: string,
  gatewayProtocolPackageRoot: string,
  packageTarballPath: string | null = null,
  gatewayClientTarballPath: string | null = null,
  gatewayProtocolTarballPath: string | null = null
) {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as JsonRecord;
  const buildInfo = JSON.parse(await readFile(path.join(packageRoot, "dist", "build-info.json"), "utf8")) as JsonRecord;
  const hash = createHash("sha256");
  for (const relativePath of ["package.json", "openclaw.mjs", "dist/build-info.json"]) {
    hash.update(relativePath);
    hash.update(await readFile(path.join(packageRoot, relativePath)));
  }
  return {
    version: String(packageJson.version ?? ""),
    sourceCommit: String(buildInfo.commit ?? ""),
    buildId: String(buildInfo.buildId ?? ""),
    packageHash: hash.digest("hex"),
    npmPackageIntegrity: await readNpmTarballIntegrity(packageTarballPath),
    gatewayClientVersion: await readExactPackageVersion(gatewayClientPackageRoot, "@openclaw/gateway-client"),
    gatewayClientIntegrity: await readNpmTarballIntegrity(gatewayClientTarballPath),
    gatewayProtocolVersion: await readExactPackageVersion(gatewayProtocolPackageRoot, "@openclaw/gateway-protocol"),
    gatewayProtocolIntegrity: await readNpmTarballIntegrity(gatewayProtocolTarballPath),
    stateSchema: Number(asRecord(packageJson.openclaw).schemaVersions ? asRecord(asRecord(packageJson.openclaw).schemaVersions).state : 0),
    agentSchema: Number(asRecord(asRecord(packageJson.openclaw).schemaVersions).agent ?? 0)
  };
}
async function readNpmTarballIntegrity(tarballPath: string | null) {
  if (!tarballPath) return null;
  return `sha512-${createHash("sha512").update(await readFile(tarballPath)).digest("base64")}`;
}
async function readExactPackageVersion(packageRoot: string, expectedName: string) {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as JsonRecord;
  const actualName = readString(packageJson.name);
  if (actualName !== expectedName) throw new Error(`${expectedName} package root contains ${actualName ?? "an unnamed package"}.`);
  const version = readString(packageJson.version);
  if (!version) throw new Error(`${expectedName} package root has no version.`);
  return version;
}
async function gitOutput(args: string[]) { const { execFile } = await import("node:child_process"); return await new Promise<string>((resolve) => execFile("git", args, { cwd: process.cwd(), encoding: "utf8" }, (_error, stdout) => resolve(stdout.trim()))); }
function safeError(error: unknown) { return error instanceof Error ? error.message : String(error); }

async function readOptionalJson(input: string | null, label: string, failures: string[]) {
  if (!input) {
    return null;
  }

  try {
    return JSON.parse(await readFile(path.resolve(input), "utf8")) as JsonRecord;
  } catch (error) {
    failures.push(`cannot inspect ${label}: ${safeError(error)}`);
    return null;
  }
}

if (process.argv[1]?.endsWith("openclaw-current-final-certification.ts")) {
  void main();
}
