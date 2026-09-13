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
  OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT,
  OPENCLAW_IDENTITY_CONTRACT_STATE_SCHEMA,
  OPENCLAW_IDENTITY_CONTRACT_VERSION
} from "@/lib/openclaw/identity/contract";

const TARGET_VERSION = "2026.9.4";
const TARGET_COMMIT = "3a9d69db306cd7f081e06254cb89c4bcc14a7107";
const TARGET_BUILD = "2026.9.4-release-3a9d69db306c-2026-09-10T22-53-16.719Z";
const PACKAGE_INPUT = process.env.OPENCLAW_FINAL_CERTIFICATION_9_4_PACKAGE?.trim();
const EVIDENCE_COMMIT_INPUT = process.env.OPENCLAW_FINAL_CERTIFICATION_9_4_EVIDENCE_COMMIT?.trim() || null;
const FINAL_CERTIFICATION_ARTIFACT_TYPE = getOpenClawFinalCertificationArtifactType(TARGET_VERSION);
const FINAL_CERTIFICATION_FILENAME = getOpenClawFinalCertificationFilename(TARGET_VERSION);
const OUTPUT_PATH = path.resolve(process.env.OPENCLAW_FINAL_CERTIFICATION_9_4_OUTPUT?.trim() || `docs/evidence/${FINAL_CERTIFICATION_FILENAME}`);

const REQUIRED_ARTIFACTS = [
  ["contract-diff", `docs/evidence/openclaw-2026.9.3-to-${TARGET_VERSION}-contract-diff.json`],
  ["fresh-baseline", `docs/evidence/openclaw-${TARGET_VERSION}-fresh-baseline.json`],
  ["runtime", `docs/evidence/openclaw-${TARGET_VERSION}-runtime-certification.json`],
  ["migration", `docs/evidence/openclaw-2026.9.3-to-${TARGET_VERSION}-migration.json`],
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
  ["human-control", `docs/evidence/openclaw-${TARGET_VERSION}-human-control-inbox.json`]
] as const;

type JsonRecord = Record<string, unknown>;

export type OpenClawExactPackageIdentity = {
  version: string;
  sourceCommit: string;
  buildId: string;
  packageHash: string;
  gatewayClientVersion: string | null;
  gatewayProtocolVersion: string | null;
  stateSchema: number;
  agentSchema: number;
};

export type OpenClawFinalCertificationReport = {
  schemaVersion: 2;
  artifactType: typeof FINAL_CERTIFICATION_ARTIFACT_TYPE;
  phase: typeof OPENCLAW_FINAL_CERTIFICATION_PHASE;
  generatedAt: string;
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
  const packageIdentity = PACKAGE_INPUT ? await readPackageIdentity(path.resolve(PACKAGE_INPUT)).catch((error) => {
    failures.push(`cannot inspect exact OpenClaw package: ${safeError(error)}`);
    return null;
  }) : null;
  if (!PACKAGE_INPUT) failures.push("OPENCLAW_FINAL_CERTIFICATION_9_4_PACKAGE is not set");
  if (OPENCLAW_RECOMMENDED_VERSION !== TARGET_VERSION || OPENCLAW_NATIVE_CONTRACT_VERSION !== TARGET_VERSION || OPENCLAW_IDENTITY_CONTRACT_VERSION !== TARGET_VERSION) {
    failures.push("AgentOS recommended, native, and identity contracts are not promoted to 2026.9.4");
  }
  if (OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT !== TARGET_COMMIT || OPENCLAW_IDENTITY_CONTRACT_BUILD !== TARGET_BUILD || OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL !== 4 || OPENCLAW_IDENTITY_CONTRACT_STATE_SCHEMA !== 17 || OPENCLAW_IDENTITY_CONTRACT_AGENT_SCHEMA !== 19) {
    failures.push("AgentOS identity contract does not match the verified 2026.9.4 identity");
  }
  if (path.basename(OUTPUT_PATH) !== FINAL_CERTIFICATION_FILENAME) {
    failures.push(`Final certification output must use ${FINAL_CERTIFICATION_FILENAME}.`);
  }
  if (!packageIdentity) {
    // Keep the report deterministic; the failure has already been recorded.
  } else if (packageIdentity.version !== TARGET_VERSION || packageIdentity.sourceCommit !== TARGET_COMMIT || packageIdentity.buildId !== TARGET_BUILD || packageIdentity.gatewayClientVersion !== TARGET_VERSION || packageIdentity.gatewayProtocolVersion !== TARGET_VERSION || packageIdentity.stateSchema !== 17 || packageIdentity.agentSchema !== 19) {
    failures.push("exact 2026.9.4 package identity, Gateway package versions, build, or schema does not match the verified target");
  }
  if (!EVIDENCE_COMMIT_INPUT) {
    failures.push("OPENCLAW_FINAL_CERTIFICATION_9_4_EVIDENCE_COMMIT is required for final evidence provenance");
  } else if (!resolveRepositoryCommit(EVIDENCE_COMMIT_INPUT)) {
    failures.push("OPENCLAW_FINAL_CERTIFICATION_9_4_EVIDENCE_COMMIT must resolve to a Git commit in the repository");
  }

  for (const [name, relativePath] of REQUIRED_ARTIFACTS) {
    try {
      const artifact = JSON.parse(await readFile(path.resolve(relativePath), "utf8")) as JsonRecord;
      artifacts[name] = artifact;
      const result = assessArtifact(name, artifact);
      matrix[name] = { path: relativePath, ...result };
      if (result.status !== "PASS") failures.push(`${name}: ${String(result.reason ?? "artifact did not pass")}`);
    } catch (error) {
      matrix[name] = { path: relativePath, status: "FAIL", skips: 0, environmentLimited: 0, expectedDenials: 0, reason: safeError(error) };
      failures.push(`${name}: ${safeError(error)}`);
    }
  }

  const contract = artifacts["contract-diff"];
  const migration = artifacts.migration;
  if (contract?.success !== true || !Object.values(asRecord(contract?.checks)).every(Boolean)) failures.push("contract audit checks are incomplete");
  if (migration?.success !== true || !Object.values(asRecord(migration?.checks)).every(Boolean)) failures.push("9.3 to 9.4 migration checks are incomplete");

  const deploymentPin = await readRepositoryDeploymentPin();
  const certifiedCodeHead = await gitOutput(["rev-parse", "HEAD"]);
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
    input.packageIdentity.gatewayClientVersion === TARGET_VERSION &&
    input.packageIdentity.gatewayProtocolVersion === TARGET_VERSION &&
    isSha256(input.packageIdentity.packageHash) &&
    input.packageIdentity.stateSchema === 17 &&
    input.packageIdentity.agentSchema === 19
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

  return {
    schemaVersion: 2,
    artifactType: FINAL_CERTIFICATION_ARTIFACT_TYPE,
    phase: OPENCLAW_FINAL_CERTIFICATION_PHASE,
    generatedAt: input.generatedAt,
    provenance: {
      repository: "SapienXai/AgentOS",
      certifiedCodeHead: resolvedCertifiedCodeHead ?? input.certifiedCodeHead,
      evidenceCommit: resolvedEvidenceCommit ?? input.evidenceCommit,
      branch: input.branch,
      node: process.version,
      openClaw: input.packageIdentity,
      exactArtifact: exactPackageMatchesTarget ? "disposable-exact-openclaw-package" : "unavailable",
      expectedOpenClaw: {
        version: TARGET_VERSION,
        tag: "v2026.9.4",
        signedTagObject: "8bec206f3c1f787e1e9c45cfd34d3de2a78c7b8e",
        sourceCommit: TARGET_COMMIT,
        buildId: TARGET_BUILD,
        gatewayProtocol: 4,
        stateSchema: 17,
        agentSchema: 19,
        gatewayClient: TARGET_VERSION,
        gatewayProtocolPackage: TARGET_VERSION
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
        tag: "v2026.9.4",
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
  const verified = targetVersion === TARGET_VERSION && installedVersion === TARGET_VERSION && protocolValue === 4 && summary.failed === 0 && summary.requiredFailures === 0 && summary.unknown === 0;
  return {
    installedVersion,
    protocolVersion: protocolValue,
    status: verified ? "verified" as const : artifact ? "unverified" as const : "not-tested" as const,
    evidence: verified
      ? "Disposable OpenClaw Gateway runtime reported the exact target version and protocol; this is not production proof."
      : "No passing exact disposable Gateway runtime result was supplied."
  };
}

function assessArtifact(name: string, artifact: JsonRecord) {
  const statuses = collectStatusValues(artifact);
  const failures: string[] = [];
  if (name === "contract-diff") {
    const target = asRecord(asRecord(artifact.provenance)?.target);
    const checks = asRecord(artifact.checks);
    if (target?.version !== TARGET_VERSION || target?.sourceCommit !== TARGET_COMMIT || target?.stateSchema !== 17 || target?.agentSchema !== 19 || target?.protocol !== 4) failures.push("contract target identity/schema/protocol mismatch");
    if (!Object.values(checks).every(Boolean)) failures.push("contract audit contains a failed check");
  } else if (name === "migration") {
    if (artifact.success !== true) failures.push("migration success is not true");
    if (!Object.values(asRecord(artifact.checks)).every(Boolean)) failures.push("migration contains a failed check");
  } else if (name === "runtime") {
    const runtime = asRecord(artifact.runtime);
    const summary = asRecord(runtime?.summary);
    if (runtime?.targetVersion !== TARGET_VERSION || runtime?.installedVersion !== TARGET_VERSION || runtime?.protocolVersion !== 4) failures.push("runtime target identity or protocol mismatch");
    if (summary?.failed !== 0 || summary?.requiredFailures !== 0 || summary?.unknown !== 0) failures.push("runtime contains failures, required failures, or unknown outcomes");
  } else if (name === "workforce") {
    if (asRecord(artifact.summary).failed !== 0) failures.push("workforce summary contains failures");
  } else if (name === "official-transport") {
    const requests = asRecord(artifact.requests);
    const denial = asRecord(artifact.authorizationDenial);
    if (Object.values(requests).some((entry) => asRecord(entry).status !== "passed") || denial.status !== "denied" || asRecord(artifact.target).protocol !== 4) {
      failures.push("official transport probes or expected authorization denial failed");
    }
  } else if (artifact.success !== true && !(typeof artifact.gate === "string" && artifact.gate.endsWith("PASS")) && artifact.result !== "PASS") {
    failures.push("artifact success/gate/result is not PASS");
  }
  if (statuses.includes("FAIL") || statuses.includes("UNKNOWN")) failures.push("artifact contains FAIL or UNKNOWN status");
  if (!collectStrings(artifact).includes(TARGET_VERSION)) failures.push(`artifact does not identify OpenClaw ${TARGET_VERSION}`);
  return { status: failures.length === 0 ? "PASS" : "FAIL", skips: statuses.filter((value) => value === "SKIPPED").length, environmentLimited: statuses.filter((value) => value === "ENVIRONMENT-LIMITED").length, expectedDenials: statuses.filter((value) => value === "EXPECTED-DENIAL" || value === "EXPECTED_DENIAL").length, ...(failures.length ? { reason: failures.join("; ") } : {}) };
}

function collectStatusValues(value: unknown): string[] { if (Array.isArray(value)) return value.flatMap(collectStatusValues); if (!value || typeof value !== "object") return []; const record = value as JsonRecord; const current = Object.entries(record).filter(([key, entry]) => ["status", "result", "outcome"].includes(key) && typeof entry === "string").map(([, entry]) => entry as string); return [...current, ...Object.values(record).flatMap(collectStatusValues)]; }
function collectStrings(value: unknown): string[] { if (Array.isArray(value)) return value.flatMap(collectStrings); if (typeof value === "string") return [value]; if (!value || typeof value !== "object") return []; return Object.values(value as JsonRecord).flatMap(collectStrings); }
function asRecord(value: unknown): JsonRecord { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {}; }
function readString(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
function isGitCommit(value: string | null | undefined): value is string { return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value.trim()); }
function resolveRepositoryCommit(value: string | null | undefined, repositoryPath = process.cwd()): string | null { if (!isGitCommit(value)) return null; const candidate = value.trim().toLowerCase(); try { const resolved = execFileSync("git", ["-C", repositoryPath, "rev-parse", "--verify", `${candidate}^{commit}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().toLowerCase(); return isGitCommit(resolved) && resolved === candidate ? resolved : null; } catch { return null; } }
function isSha256(value: string): boolean { return /^[0-9a-f]{64}$/i.test(value); }
async function readPackageIdentity(packageRoot: string) { const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as JsonRecord; const buildInfo = JSON.parse(await readFile(path.join(packageRoot, "dist", "build-info.json"), "utf8")) as JsonRecord; const hash = createHash("sha256"); for (const relativePath of ["package.json", "openclaw.mjs", "dist/build-info.json"]) { hash.update(relativePath); hash.update(await readFile(path.join(packageRoot, relativePath))); } const dependencies = { ...asRecord(packageJson.dependencies), ...asRecord(packageJson.optionalDependencies) }; return { version: String(packageJson.version ?? ""), sourceCommit: String(buildInfo.commit ?? ""), buildId: String(buildInfo.buildId ?? ""), packageHash: hash.digest("hex"), gatewayClientVersion: readDependencyVersion(dependencies, "@openclaw/gateway-client"), gatewayProtocolVersion: readDependencyVersion(dependencies, "@openclaw/gateway-protocol"), stateSchema: Number(asRecord(packageJson.openclaw).schemaVersions ? asRecord(asRecord(packageJson.openclaw).schemaVersions).state : 0), agentSchema: Number(asRecord(asRecord(packageJson.openclaw).schemaVersions).agent ?? 0) }; }
function readDependencyVersion(dependencies: JsonRecord, packageName: string) { const version = readString(dependencies[packageName]); return version?.replace(/^[~^<>= ]+/, "") || null; }
async function gitOutput(args: string[]) { const { execFile } = await import("node:child_process"); return await new Promise<string>((resolve) => execFile("git", args, { cwd: process.cwd(), encoding: "utf8" }, (_error, stdout) => resolve(stdout.trim()))); }
function safeError(error: unknown) { return error instanceof Error ? error.message : String(error); }

if (process.argv[1]?.endsWith("openclaw-2026-9-4-final-certification.ts")) {
  void main();
}
