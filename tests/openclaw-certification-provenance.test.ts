import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";

import {
  buildOpenClawFinalCertificationReport,
  assessOpenClawCertificationArtifact,
  readPackageIdentity,
  type OpenClawExactPackageIdentity
} from "@/scripts/openclaw-current-final-certification";
import { REQUIRED_WORKFORCE_PRODUCT_CHECKS } from "@/scripts/lib/workforce-certification-requirements";
import {
  OPENCLAW_IDENTITY_CONTRACT_AGENT_SCHEMA,
  OPENCLAW_IDENTITY_CONTRACT_BUILD,
  OPENCLAW_IDENTITY_CONTRACT_GATEWAY_CLIENT_INTEGRITY,
  OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL,
  OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL_INTEGRITY,
  OPENCLAW_IDENTITY_CONTRACT_PACKAGE_INTEGRITY,
  OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT,
  OPENCLAW_IDENTITY_CONTRACT_STATE_SCHEMA,
  OPENCLAW_IDENTITY_CONTRACT_VERSION
} from "@/lib/openclaw/identity/contract";
import { OPENCLAW_SUPPORTED_BASELINE_VERSION } from "@/lib/openclaw/versions";

const TARGET_VERSION = OPENCLAW_IDENTITY_CONTRACT_VERSION;

const repositoryHead = gitCommit("HEAD");
const repositoryParent = gitCommit("HEAD^");

test("final certification keeps code, evidence, package, runtime, and production provenance distinct", () => {
  const packageIdentity: OpenClawExactPackageIdentity = {
    version: TARGET_VERSION,
    sourceCommit: OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT,
    buildId: OPENCLAW_IDENTITY_CONTRACT_BUILD,
    packageHash: "d".repeat(64),
    npmPackageIntegrity: OPENCLAW_IDENTITY_CONTRACT_PACKAGE_INTEGRITY,
    gatewayClientVersion: TARGET_VERSION,
    gatewayClientIntegrity: OPENCLAW_IDENTITY_CONTRACT_GATEWAY_CLIENT_INTEGRITY,
    gatewayProtocolVersion: TARGET_VERSION,
    gatewayProtocolIntegrity: OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL_INTEGRITY,
    stateSchema: OPENCLAW_IDENTITY_CONTRACT_STATE_SCHEMA,
    agentSchema: OPENCLAW_IDENTITY_CONTRACT_AGENT_SCHEMA
  };
  const report = buildOpenClawFinalCertificationReport({
    generatedAt: "2026-09-13T10:00:00.000Z",
    certifiedCodeHead: repositoryHead,
    evidenceCommit: repositoryParent,
    branch: "codex/auto-dev",
    packageIdentity,
    artifacts: {
      migration: {
        success: true,
        provenance: {
          source: { version: OPENCLAW_SUPPORTED_BASELINE_VERSION },
          target: { version: TARGET_VERSION }
        },
        checks: { stateSchemaMigrated: true }
      },
      runtime: {
        runtime: {
          targetVersion: TARGET_VERSION,
          installedVersion: TARGET_VERSION,
          protocolVersion: OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL,
          summary: { failed: 0, requiredFailures: 0, unknown: 0 }
        },
        outcomes: [{ status: "SKIPPED" }, { status: "EXPECTED-DENIAL" }]
      }
    },
    matrix: {
      migration: { status: "PASS", skips: 0, expectedDenials: 0 },
      runtime: { status: "PASS", skips: 1, expectedDenials: 1 }
    },
    deploymentPin: {
      status: "found",
      version: TARGET_VERSION,
      image: `ghcr.io/openclaw/openclaw:${TARGET_VERSION}`,
      digest: "d".repeat(64),
      reason: "Repository pin read."
    },
    failures: []
  });

  assert.equal(report.schemaVersion, 2);
  assert.equal(report.artifactType, `openclaw-${TARGET_VERSION}-pre-merge-final-certification`);
  assert.equal(report.phase, "pre-merge-final-certification");
  assert.equal(report.certifiedAt, "2026-09-13T10:00:00.000Z");
  assert.equal(report.agentosHead, repositoryHead);
  assert.equal(report.openclawVersion, TARGET_VERSION);
  assert.equal(report.openclawSourceSha, OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT);
  assert.deepEqual(report.upstreamEvidenceHashes, {});
  assert.equal(report.contractAudit, null);
  assert.equal(report.compatibility, null);
  assert.equal(report.runtimeAcceptance, null);
  assert.deepEqual(report.knownExceptions, []);
  assert.equal(report.provenance.certifiedCodeHead, repositoryHead);
  assert.equal(report.provenance.evidenceCommit, repositoryParent);
  assert.notEqual(report.provenance.certifiedCodeHead, report.provenance.evidenceCommit);
  assert.equal(report.provenance.exactArtifact, "disposable-exact-openclaw-package");
  assert.equal(report.versionRoles.supportedMinimum.version, "2026.9.1");
  assert.equal(report.versionRoles.recommended.version, TARGET_VERSION);
  assert.equal(report.versionRoles.nativeContract.version, TARGET_VERSION);
  assert.equal(report.versionRoles.packageVersions.gatewayClient.version, TARGET_VERSION);
  assert.equal(report.versionRoles.deploymentPin.version, TARGET_VERSION);
  assert.equal(report.versionRoles.migration.sourceVersion, OPENCLAW_SUPPORTED_BASELINE_VERSION);
  assert.equal(report.versionRoles.migration.targetVersion, TARGET_VERSION);
  assert.equal(report.versionRoles.migration.status, "verified");
  assert.equal(report.versionRoles.certifiedIdentity.status, "verified");
  assert.equal(report.versionRoles.liveRuntime.status, "verified");
  assert.equal(report.tests.status, "PASS");
  assert.equal(report.tests.passedArtifactCount, 2);
  assert.equal(report.skips, 1);
  assert.equal(report.expectedAuthorizationDenials, 1);
  assert.equal(report.production.status, "not-tested");
  assert.equal(report.production.gatewayTouched, false);
  assert.equal(report.historicalEvidence.preserved, true);
});

test("final certification does not claim an exact package or live runtime when identity evidence is absent", () => {
  const report = buildOpenClawFinalCertificationReport({
    generatedAt: "2026-09-13T10:00:00.000Z",
    certifiedCodeHead: repositoryHead,
    evidenceCommit: null,
    branch: "codex/auto-dev",
    packageIdentity: null,
    artifacts: {},
    matrix: {},
    deploymentPin: {
      status: "not-found",
      version: null,
      image: null,
      digest: null,
      reason: "No deployment pin."
    },
    failures: ["package missing"]
  });

  assert.equal(report.provenance.openClaw, null);
  assert.equal(report.provenance.exactArtifact, "unavailable");
  assert.equal(report.versionRoles.certifiedIdentity.status, "not-tested");
  assert.equal(report.versionRoles.liveRuntime.status, "not-tested");
  assert.equal(report.production.status, "not-tested");
  assert.equal(report.success, false);
});

test("final certification rejects an unresolved exact OpenClaw source identity", () => {
  const report = buildOpenClawFinalCertificationReport({
    generatedAt: "2026-09-13T10:00:00.000Z",
    certifiedCodeHead: repositoryHead,
    evidenceCommit: repositoryParent,
    branch: "codex/auto-dev",
    packageIdentity: {
      version: TARGET_VERSION,
      sourceCommit: "f".repeat(40),
      buildId: OPENCLAW_IDENTITY_CONTRACT_BUILD,
      packageHash: "d".repeat(64),
      npmPackageIntegrity: OPENCLAW_IDENTITY_CONTRACT_PACKAGE_INTEGRITY,
      gatewayClientVersion: TARGET_VERSION,
      gatewayClientIntegrity: OPENCLAW_IDENTITY_CONTRACT_GATEWAY_CLIENT_INTEGRITY,
      gatewayProtocolVersion: TARGET_VERSION,
      gatewayProtocolIntegrity: OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL_INTEGRITY,
      stateSchema: OPENCLAW_IDENTITY_CONTRACT_STATE_SCHEMA,
      agentSchema: OPENCLAW_IDENTITY_CONTRACT_AGENT_SCHEMA
    },
    artifacts: { runtime: {} },
    matrix: { runtime: { status: "PASS" } },
    deploymentPin: { status: "not-found", version: null, image: null, digest: null, reason: "No deployment pin." },
    failures: []
  });

  assert.equal(report.versionRoles.certifiedIdentity.status, "mismatch");
  assert.equal(report.provenance.exactArtifact, "unavailable");
  assert.equal(report.success, false);
  assert.match(report.failures.join("\n"), /source identity/i);
});

test("final certification reads separately published Gateway package identities", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-certification-"));
  try {
    const openClawRoot = path.join(fixtureRoot, "openclaw");
    const clientRoot = path.join(fixtureRoot, "gateway-client");
    const protocolRoot = path.join(fixtureRoot, "gateway-protocol");
    await writeOpenClawFixture(openClawRoot);
    await writePackageFixture(clientRoot, "@openclaw/gateway-client");
    await writePackageFixture(protocolRoot, "@openclaw/gateway-protocol");

    const identity = await readPackageIdentity(openClawRoot, clientRoot, protocolRoot);
    assert.equal(identity.version, TARGET_VERSION);
    assert.equal(identity.gatewayClientVersion, TARGET_VERSION);
    assert.equal(identity.gatewayProtocolVersion, TARGET_VERSION);
    assert.equal(identity.stateSchema, OPENCLAW_IDENTITY_CONTRACT_STATE_SCHEMA);
    assert.equal(identity.agentSchema, OPENCLAW_IDENTITY_CONTRACT_AGENT_SCHEMA);
    assert.equal(identity.npmPackageIntegrity, null);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("final certification calculates exact npm tarball integrity from supplied archives", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-certification-integrity-"));
  try {
    const openClawRoot = path.join(fixtureRoot, "openclaw");
    const clientRoot = path.join(fixtureRoot, "gateway-client");
    const protocolRoot = path.join(fixtureRoot, "gateway-protocol");
    const [openclawArchive, clientArchive, protocolArchive] = ["openclaw.tgz", "gateway-client.tgz", "gateway-protocol.tgz"].map((file) => path.join(fixtureRoot, file)) as [string, string, string];
    await writeOpenClawFixture(openClawRoot);
    await writePackageFixture(clientRoot, "@openclaw/gateway-client");
    await writePackageFixture(protocolRoot, "@openclaw/gateway-protocol");
    const archiveBytes = ["openclaw archive", "client archive", "protocol archive"].map((value) => Buffer.from(value));
    await Promise.all([openclawArchive, clientArchive, protocolArchive].map((archive, index) => writeFile(archive, archiveBytes[index])));

    const identity = await readPackageIdentity(openClawRoot, clientRoot, protocolRoot, openclawArchive, clientArchive, protocolArchive);
    const expected = archiveBytes.map((bytes) => `sha512-${createHash("sha512").update(bytes).digest("base64")}`);
    assert.deepEqual([
      identity.npmPackageIntegrity,
      identity.gatewayClientIntegrity,
      identity.gatewayProtocolIntegrity
    ], expected);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test("final certification treats empty or non-boolean contract checks as incomplete", () => {
  const base = {
    provenance: {
      target: {
        version: TARGET_VERSION,
        sourceCommit: OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT,
        stateSchema: OPENCLAW_IDENTITY_CONTRACT_STATE_SCHEMA,
        agentSchema: OPENCLAW_IDENTITY_CONTRACT_AGENT_SCHEMA,
        protocol: OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL
      }
    }
  };
  assert.equal(assessOpenClawCertificationArtifact("contract-diff", { ...base, checks: {} }).status, "FAIL");
  assert.equal(assessOpenClawCertificationArtifact("contract-diff", { ...base, checks: { exact: "true" } }).status, "FAIL");
});

test("final certification rejects workforce identity-only evidence but accepts explicit optional task gaps", () => {
  const identityOnly = {
    provenance: { openClaw: { version: TARGET_VERSION } },
    checks: { "runtime-identity": { status: "PASS" } },
    summary: { passed: 1, skipped: 0, failed: 0 },
    certification: { status: "FULLY_CERTIFIED" }
  };
  assert.equal(assessOpenClawCertificationArtifact("workforce", identityOnly).status, "FAIL");

  const checks = Object.fromEntries(REQUIRED_WORKFORCE_PRODUCT_CHECKS.map((checkId) => [checkId, { status: "PASS" }]));
  checks.artifacts = { status: "SKIPPED" };
  const completeProductPath = {
    provenance: { openClaw: { version: TARGET_VERSION } },
    productPath: { dispatchId: "disposable-dispatch", sessionKey: "agent:main:acceptance" },
    checks,
    summary: { passed: REQUIRED_WORKFORCE_PRODUCT_CHECKS.length, skipped: 1, failed: 0 },
    certification: { status: "PRODUCT_PATH_CERTIFIED_WITH_UPSTREAM_TASK_GAPS" },
    cleanup: { disposableRootRemoved: true, gatewayStopped: true, productionGatewayTouched: false },
    failure: null
  };
  assert.equal(assessOpenClawCertificationArtifact("workforce", completeProductPath).status, "PASS");
});

test("final transport certification accepts only an explicit unsupported result for optional tasks.list", () => {
  const requests = Object.fromEntries([
    "health",
    "status",
    "models.list",
    "agents.list",
    "sessions.list",
    "channels.status",
    "config.get"
  ].map((method) => [method, { status: "passed", kind: null, message: null }]));
  const base = {
    target: { version: TARGET_VERSION, protocol: OPENCLAW_IDENTITY_CONTRACT_GATEWAY_PROTOCOL },
    requests: { ...requests, "tasks.list": { status: "skipped", kind: "unsupported", message: "Gateway method unsupported" } },
    authorizationDenial: { status: "denied" }
  };

  assert.equal(assessOpenClawCertificationArtifact("official-transport", base).status, "PASS");
  assert.equal(assessOpenClawCertificationArtifact("official-transport", {
    ...base,
    requests: { ...base.requests, "tasks.list": { status: "failed", kind: "unsupported", message: "Unexpected method failure" } }
  }).status, "FAIL");
  assert.equal(assessOpenClawCertificationArtifact("official-transport", {
    ...base,
    requests: { ...base.requests, "tasks.list": { status: "skipped", kind: "timeout", message: "Gateway timeout" } }
  }).status, "FAIL");
});

test("final certification rejects missing or mismatched separate Gateway packages", async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-certification-"));
  try {
    const openClawRoot = path.join(fixtureRoot, "openclaw");
    const clientRoot = path.join(fixtureRoot, "gateway-client");
    const protocolRoot = path.join(fixtureRoot, "gateway-protocol");
    await writeOpenClawFixture(openClawRoot);
    await writePackageFixture(clientRoot, "@openclaw/gateway-client");
    await writePackageFixture(protocolRoot, "@openclaw/wrong-package");

    await assert.rejects(
      readPackageIdentity(openClawRoot, clientRoot, protocolRoot),
      /@openclaw\/gateway-protocol package root contains @openclaw\/wrong-package/
    );
    await assert.rejects(
      readPackageIdentity(openClawRoot, clientRoot, path.join(fixtureRoot, "missing")),
      /ENOENT/
    );
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

async function writeOpenClawFixture(root: string) {
  await mkdir(path.join(root, "dist"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "openclaw",
    version: TARGET_VERSION,
    openclaw: { schemaVersions: { state: OPENCLAW_IDENTITY_CONTRACT_STATE_SCHEMA, agent: OPENCLAW_IDENTITY_CONTRACT_AGENT_SCHEMA } }
  }));
  await writeFile(path.join(root, "openclaw.mjs"), "export {};\n");
  await writeFile(path.join(root, "dist", "build-info.json"), JSON.stringify({
    commit: OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT,
    buildId: OPENCLAW_IDENTITY_CONTRACT_BUILD
  }));
}

async function writePackageFixture(root: string, name: string) {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name, version: TARGET_VERSION }));
}

function gitCommit(ref: string) {
  return execFileSync("git", ["rev-parse", ref], { encoding: "utf8" }).trim();
}
