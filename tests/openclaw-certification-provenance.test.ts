import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import os from "node:os";
import path from "node:path";

import {
  buildOpenClawFinalCertificationReport,
  readPackageIdentity,
  type OpenClawExactPackageIdentity
} from "@/scripts/openclaw-2026-9-4-final-certification";

const repositoryHead = gitCommit("HEAD");
const repositoryParent = gitCommit("HEAD^");

test("final certification keeps code, evidence, package, runtime, and production provenance distinct", () => {
  const packageIdentity: OpenClawExactPackageIdentity = {
    version: "2026.9.4",
    sourceCommit: "3a9d69db306cd7f081e06254cb89c4bcc14a7107",
    buildId: "2026.9.4-release-3a9d69db306c-2026-09-10T22-53-16.719Z",
    packageHash: "d".repeat(64),
    gatewayClientVersion: "2026.9.4",
    gatewayProtocolVersion: "2026.9.4",
    stateSchema: 17,
    agentSchema: 19
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
          source: { version: "2026.9.3" },
          target: { version: "2026.9.4" }
        },
        checks: { stateSchema16To17: true }
      },
      runtime: {
        runtime: {
          targetVersion: "2026.9.4",
          installedVersion: "2026.9.4",
          protocolVersion: 4,
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
      version: "2026.9.4",
      image: "ghcr.io/openclaw/openclaw:2026.9.4",
      digest: "d".repeat(64),
      reason: "Repository pin read."
    },
    failures: []
  });

  assert.equal(report.schemaVersion, 2);
  assert.equal(report.artifactType, "openclaw-2026.9.4-pre-merge-final-certification");
  assert.equal(report.phase, "pre-merge-final-certification");
  assert.equal(report.certifiedAt, "2026-09-13T10:00:00.000Z");
  assert.equal(report.agentosHead, repositoryHead);
  assert.equal(report.openclawVersion, "2026.9.4");
  assert.equal(report.openclawSourceSha, "3a9d69db306cd7f081e06254cb89c4bcc14a7107");
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
  assert.equal(report.versionRoles.recommended.version, "2026.9.4");
  assert.equal(report.versionRoles.nativeContract.version, "2026.9.4");
  assert.equal(report.versionRoles.packageVersions.gatewayClient.version, "2026.9.4");
  assert.equal(report.versionRoles.deploymentPin.version, "2026.9.4");
  assert.equal(report.versionRoles.migration.sourceVersion, "2026.9.3");
  assert.equal(report.versionRoles.migration.targetVersion, "2026.9.4");
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
      version: "2026.9.4",
      sourceCommit: "f".repeat(40),
      buildId: "2026.9.4-release-3a9d69db306c-2026-09-10T22-53-16.719Z",
      packageHash: "d".repeat(64),
      gatewayClientVersion: "2026.9.4",
      gatewayProtocolVersion: "2026.9.4",
      stateSchema: 17,
      agentSchema: 19
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
    assert.equal(identity.version, "2026.9.4");
    assert.equal(identity.gatewayClientVersion, "2026.9.4");
    assert.equal(identity.gatewayProtocolVersion, "2026.9.4");
    assert.equal(identity.stateSchema, 17);
    assert.equal(identity.agentSchema, 19);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
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
    version: "2026.9.4",
    openclaw: { schemaVersions: { state: 17, agent: 19 } }
  }));
  await writeFile(path.join(root, "openclaw.mjs"), "export {};\n");
  await writeFile(path.join(root, "dist", "build-info.json"), JSON.stringify({
    commit: "3a9d69db306cd7f081e06254cb89c4bcc14a7107",
    buildId: "2026.9.4-release-3a9d69db306c-2026-09-10T22-53-16.719Z"
  }));
}

async function writePackageFixture(root: string, name: string) {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name, version: "2026.9.4" }));
}

function gitCommit(ref: string) {
  return execFileSync("git", ["rev-parse", ref], { encoding: "utf8" }).trim();
}
