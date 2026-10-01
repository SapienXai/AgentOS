import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

type ReleaseEvidence = {
  version: string;
  intake: JsonRecord;
  contractDiff: JsonRecord;
  intakeSha256: string;
  contractDiffSha256: string;
};

const REQUIRED_RELEASES = ["2026.9.5", "2026.9.6", "2026.9.7"];
const INTAKE_DIRECTORY = process.env.OPENCLAW_CUMULATIVE_INTAKE_DIR?.trim();
const SOURCE_CERTIFICATION = process.env.OPENCLAW_CUMULATIVE_SOURCE_CERTIFICATION?.trim() ||
  "docs/evidence/openclaw-2026.9.4-pre-merge-final-certification.json";
const TARGET_PACKAGE = process.env.OPENCLAW_CUMULATIVE_TARGET_PACKAGE?.trim();
const OUTPUT_PATH = path.resolve(process.env.OPENCLAW_CUMULATIVE_OUTPUT?.trim() ||
  "docs/evidence/openclaw-2026.9.4-to-2026.9.7-contract-diff.json");

export function buildCumulativeOpenClawContractEvidence(input: {
  sourceCertification: JsonRecord;
  releases: ReleaseEvidence[];
  targetPackage: {
    version: string;
    sourceCommit: string;
    buildId: string;
    stateSchema: number;
    agentSchema: number;
  };
  generatedAt?: string;
}) {
  const sourceProvenance = asRecord(input.sourceCertification.provenance);
  const sourceExpected = asRecord(sourceProvenance.expectedOpenClaw);
  const sourcePackage = asRecord(sourceProvenance.openClaw);
  const sourceVersion = "2026.9.4";
  const sourceCertified = input.sourceCertification.success === true &&
    sourceExpected.version === sourceVersion &&
    isCommit(sourceExpected.sourceCommit) &&
    sourcePackage.version === sourceVersion &&
    sourcePackage.sourceCommit === sourceExpected.sourceCommit;
  const chainMatches = input.releases.length === REQUIRED_RELEASES.length && input.releases.every((release, index) => {
    const expectedTarget = REQUIRED_RELEASES[index];
    const expectedSource = index === 0 ? sourceVersion : REQUIRED_RELEASES[index - 1];
    const identity = asRecord(asRecord(release.intake).identity);
    const upstream = asRecord(asRecord(release.intake).upstream);
    const clientPackage = asRecord(identity.gatewayClientPackage);
    const protocolPackage = asRecord(identity.gatewayProtocolPackage);
    const diff = asRecord(release.contractDiff);
    return release.version === expectedTarget &&
      identity.version === expectedTarget &&
      identity.tag === `v${expectedTarget}` &&
      identity.status === "verified" &&
      isCommit(identity.sourceCommit) &&
      upstream.version === expectedTarget &&
      upstream.sourceCommit === identity.sourceCommit &&
      identity.packageVersion === expectedTarget &&
      isIntegrity(identity.packageIntegrity) &&
      clientPackage.packageName === "@openclaw/gateway-client" &&
      clientPackage.version === expectedTarget &&
      isIntegrity(clientPackage.integrity) &&
      protocolPackage.packageName === "@openclaw/gateway-protocol" &&
      protocolPackage.version === expectedTarget &&
      isIntegrity(protocolPackage.integrity) &&
      readStringArray(identity.mismatches).length === 0 &&
      readStringArray(identity.missingEvidence).length === 0 &&
      diff.fromVersion === expectedSource &&
      diff.targetVersion === expectedTarget;
  });
  const transitions = input.releases.map((release) => buildTransition(release));
  const watcherEvidenceComplete = transitions.length === REQUIRED_RELEASES.length && transitions.every((transition) =>
    ["pass", "warning"].includes(transition.watcherStatus) &&
    transition.evidenceGapCount === 0 &&
    transition.blockerCount === 0 &&
    transition.unknownCount === 0 &&
    transition.hasAllContractDomains &&
    transition.unsupportedFields.length === 0
  );
  const targetRelease = input.releases.at(-1);
  const targetIdentity = asRecord(asRecord(targetRelease?.intake).identity);
  const targetUpstream = asRecord(asRecord(targetRelease?.intake).upstream);
  const targetMatches = input.targetPackage.version === "2026.9.7" &&
    targetIdentity.version === input.targetPackage.version &&
    targetIdentity.sourceCommit === input.targetPackage.sourceCommit &&
    targetUpstream.sourceCommit === input.targetPackage.sourceCommit &&
    targetIdentity.tag === `v${input.targetPackage.version}` &&
    targetIdentity.packageVersion === input.targetPackage.version &&
    isIntegrity(targetIdentity.packageIntegrity) &&
    asRecord(targetIdentity.gatewayClientPackage).version === input.targetPackage.version &&
    isIntegrity(asRecord(targetIdentity.gatewayClientPackage).integrity) &&
    asRecord(targetIdentity.gatewayProtocolPackage).version === input.targetPackage.version &&
    isIntegrity(asRecord(targetIdentity.gatewayProtocolPackage).integrity) &&
    input.targetPackage.stateSchema === 19 &&
    input.targetPackage.agentSchema === 24;
  const sixthReleaseScopeChange = transitions[1]?.scopesChanged.includes(
    "sessions.github.publish: operator.write -> operator.sessions.write"
  ) === true;
  const removedTaskMethods = [
    "tasks.cancel",
    "tasks.dismiss",
    "tasks.get",
    "tasks.history",
    "tasks.list",
    "tasks.retry"
  ];
  const seventhReleaseTaskRemoval = removedTaskMethods.every((method) => transitions[2]?.methodsRemoved.includes(method));
  const checks = {
    sourceReleaseWasCertified: sourceCertified,
    exactTargetPackageMatchesAuthenticatedIntake: targetMatches,
    cumulativeReleaseChainIsComplete: chainMatches,
    watcherEvidenceHasNoBlockersUnknownsOrGaps: watcherEvidenceComplete,
    sessionGithubScopeChangeIsPreserved: sixthReleaseScopeChange,
    removedOptionalTaskMethodsArePreserved: seventhReleaseTaskRemoval
  };
  const failures = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  const source = {
    version: sourceVersion,
    tag: sourceExpected.tag ?? null,
    tagObject: sourceExpected.signedTagObject ?? null,
    sourceCommit: sourceExpected.sourceCommit ?? null,
    buildId: sourceExpected.buildId ?? null,
    protocol: sourceExpected.gatewayProtocol ?? null,
    stateSchema: sourceExpected.stateSchema ?? null,
    agentSchema: sourceExpected.agentSchema ?? null,
    packageHash: sourcePackage.packageHash ?? null,
    certificationArtifact: "docs/evidence/openclaw-2026.9.4-pre-merge-final-certification.json"
  };
  const target = {
    version: input.targetPackage.version,
    tag: targetIdentity.tag ?? null,
    tagObject: null,
    sourceCommit: input.targetPackage.sourceCommit,
    buildId: input.targetPackage.buildId,
    protocol: 4,
    stateSchema: input.targetPackage.stateSchema,
    agentSchema: input.targetPackage.agentSchema,
    packageIntegrity: targetIdentity.packageIntegrity ?? null,
    gatewayClientPackage: targetIdentity.gatewayClientPackage ?? null,
    gatewayProtocolPackage: targetIdentity.gatewayProtocolPackage ?? null
  };

  return {
    schemaVersion: 1,
    artifactType: "openclaw-cumulative-contract-diff",
    status: failures.length === 0 ? "PASS" : "FAIL",
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    provenance: {
      repository: "SapienXai/AgentOS",
      comparison: `${sourceVersion} -> ${input.targetPackage.version}`,
      source,
      target,
      releaseWatchSource: "Authenticated OpenClaw Release Watch workflow artifact and existing intake issue",
      releaseWatchTransitions: transitions
    },
    checks,
    summary: {
      transitionCount: transitions.length,
      blockerCount: transitions.reduce((sum, entry) => sum + entry.blockerCount, 0),
      unknownCount: transitions.reduce((sum, entry) => sum + entry.unknownCount, 0),
      warningCount: transitions.reduce((sum, entry) => sum + entry.warningCount, 0),
      evidenceGapCount: transitions.reduce((sum, entry) => sum + entry.evidenceGapCount, 0),
      methodsAdded: transitions.flatMap((entry) => entry.methodsAdded),
      methodsRemoved: transitions.flatMap((entry) => entry.methodsRemoved),
      scopesChanged: transitions.flatMap((entry) => entry.scopesChanged),
      protocolChanged: transitions.some((entry) => entry.protocolChanged),
      updateContractChanged: transitions.some((entry) => entry.updateContractChanged),
      sessionContractChanged: transitions.some((entry) => entry.sessionContractChanged)
    },
    failures,
    success: failures.length === 0
  };
}

function buildTransition(release: ReleaseEvidence) {
  const diff = release.contractDiff;
  const identity = asRecord(asRecord(release.intake).identity);
  const blockers = parseSummaryCount(diff.summary, /(\d+) blocker\(s\)/);
  const warnings = parseSummaryCount(diff.summary, /(\d+) warning\(s\)/);
  const unknowns = parseSummaryCount(diff.summary, /(\d+) unknown\(s\)/);
  const methodsAdded = readStringArray(diff.methodsAdded);
  const methodsRemoved = readStringArray(diff.methodsRemoved);
  const scopesChanged = readStringArray(diff.scopesChanged);
  const arrayDomainKeys = [
    "methodsAdded", "methodsRemoved", "scopesChanged", "eventsAdded", "eventsRemoved", "requestSchemasChanged", "responseSchemasChanged",
    "requiredFieldsAdded", "requiredFieldsRemoved", "enumValuesAdded", "enumValuesRemoved",
    "configKeysAdded", "configKeysRemoved", "configDefaultsChanged", "securitySensitiveChanges", "domainsChanged", "evidenceGaps", "changedFiles"
  ];
  const expectedDiffKeys = new Set([
    "status", "source", "fromVersion", "targetVersion", ...arrayDomainKeys,
    "protocolChanged", "updateContractChanged", "sessionContractChanged", "summary"
  ]);
  const unsupportedFields = Object.keys(diff).filter((key) => !expectedDiffKeys.has(key));
  const hasAllContractDomains = arrayDomainKeys.every((key) => Array.isArray(diff[key])) &&
    typeof diff.protocolChanged === "boolean" &&
    typeof diff.updateContractChanged === "boolean" &&
    typeof diff.sessionContractChanged === "boolean";
  return {
    fromVersion: diff.fromVersion ?? null,
    targetVersion: release.version,
    sourceCommit: asRecord(asRecord(release.intake).upstream).sourceCommit ?? null,
    targetCommit: identity.sourceCommit ?? null,
    watcherStatus: typeof diff.status === "string" ? diff.status : "unknown",
    summary: typeof diff.summary === "string" ? diff.summary : "",
    blockerCount: blockers,
    warningCount: warnings,
    unknownCount: unknowns,
    evidenceGapCount: readStringArray(diff.evidenceGaps).length,
    changedFileCount: Array.isArray(diff.changedFiles) ? diff.changedFiles.length : null,
    methodsAdded,
    methodsRemoved,
    scopesChanged,
    eventsAdded: readStringArray(diff.eventsAdded),
    eventsRemoved: readStringArray(diff.eventsRemoved),
    requestSchemasChanged: readStringArray(diff.requestSchemasChanged),
    responseSchemasChanged: readStringArray(diff.responseSchemasChanged),
    requiredFieldsAdded: readStringArray(diff.requiredFieldsAdded),
    requiredFieldsRemoved: readStringArray(diff.requiredFieldsRemoved),
    enumValuesAdded: readStringArray(diff.enumValuesAdded),
    enumValuesRemoved: readStringArray(diff.enumValuesRemoved),
    configKeysAdded: readStringArray(diff.configKeysAdded),
    configKeysRemoved: readStringArray(diff.configKeysRemoved),
    configDefaultsChanged: readStringArray(diff.configDefaultsChanged),
    securitySensitiveChangeCount: Array.isArray(diff.securitySensitiveChanges) ? diff.securitySensitiveChanges.length : null,
    changedDomains: readStringArray(diff.domainsChanged),
    protocolChanged: diff.protocolChanged === true,
    updateContractChanged: diff.updateContractChanged === true,
    sessionContractChanged: diff.sessionContractChanged === true,
    hasAllContractDomains,
    unsupportedFields,
    evidenceHashes: { intakeSha256: release.intakeSha256, contractDiffSha256: release.contractDiffSha256 }
  };
}

async function main() {
  if (!INTAKE_DIRECTORY) throw new Error("Set OPENCLAW_CUMULATIVE_INTAKE_DIR to the authenticated release-watch artifact directory.");
  if (!TARGET_PACKAGE) throw new Error("Set OPENCLAW_CUMULATIVE_TARGET_PACKAGE to the exact 2026.9.7 package root.");
  const sourceCertification = JSON.parse(await readFile(path.resolve(SOURCE_CERTIFICATION), "utf8")) as JsonRecord;
  const releases: ReleaseEvidence[] = [];
  for (const version of REQUIRED_RELEASES) {
    const intakePath = path.join(INTAKE_DIRECTORY, `openclaw-${version}-intake.json`);
    const diffPath = path.join(INTAKE_DIRECTORY, `openclaw-${version}-contract-diff.json`);
    const intakeBytes = await readFile(intakePath);
    const diffBytes = await readFile(diffPath);
    releases.push({
      version,
      intake: JSON.parse(intakeBytes.toString("utf8")) as JsonRecord,
      contractDiff: JSON.parse(diffBytes.toString("utf8")) as JsonRecord,
      intakeSha256: createHash("sha256").update(intakeBytes).digest("hex"),
      contractDiffSha256: createHash("sha256").update(diffBytes).digest("hex")
    });
  }
  const packageRoot = path.resolve(TARGET_PACKAGE);
  const targetPackageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as JsonRecord;
  const targetBuild = JSON.parse(await readFile(path.join(packageRoot, "dist", "build-info.json"), "utf8")) as JsonRecord;
  const schemaVersions = asRecord(targetPackageJson.openclaw);
  const schemas = asRecord(schemaVersions.schemaVersions);
  const artifact = buildCumulativeOpenClawContractEvidence({
    sourceCertification,
    releases,
    targetPackage: {
      version: String(targetPackageJson.version ?? ""),
      sourceCommit: String(targetBuild.commit ?? ""),
      buildId: String(targetBuild.buildId ?? ""),
      stateSchema: Number(schemas.state),
      agentSchema: Number(schemas.agent)
    }
  });
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  console.log(`Cumulative OpenClaw contract audit: ${artifact.status}`);
  console.log(`Evidence: ${OUTPUT_PATH}`);
  if (!artifact.success) {
    console.error(artifact.failures.join("; "));
    process.exitCode = 1;
  }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function parseSummaryCount(summary: unknown, pattern: RegExp) {
  const match = typeof summary === "string" ? summary.match(pattern) : null;
  return match ? Number(match[1]) : Number.NaN;
}

function isCommit(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{40}$/i.test(value);
}

function isIntegrity(value: unknown): value is string {
  return typeof value === "string" && /^sha512-[A-Za-z0-9+/]{86}==$/.test(value);
}

if (process.argv[1]?.endsWith("openclaw-cumulative-contract-audit.ts")) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Cumulative OpenClaw contract audit failed.");
    process.exitCode = 1;
  });
}
