import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildOpenClawFinalCertificationReport,
  type OpenClawExactPackageIdentity
} from "@/scripts/openclaw-2026-9-4-final-certification";

test("final certification keeps code, evidence, package, runtime, and production provenance distinct", () => {
  const packageIdentity: OpenClawExactPackageIdentity = {
    version: "2026.9.4",
    sourceCommit: "3a9d69db306cd7f081e06254cb89c4bcc14a7107",
    buildId: "2026.9.4-release-3a9d69db306c-2026-09-10T22-53-16.719Z",
    packageHash: "package-hash",
    gatewayClientVersion: "2026.9.4",
    gatewayProtocolVersion: "2026.9.4",
    stateSchema: 17,
    agentSchema: 19
  };
  const report = buildOpenClawFinalCertificationReport({
    generatedAt: "2026-09-13T10:00:00.000Z",
    certifiedCodeHead: "b".repeat(40),
    evidenceCommit: "c".repeat(40),
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
  assert.equal(report.provenance.certifiedCodeHead, "b".repeat(40));
  assert.equal(report.provenance.evidenceCommit, "c".repeat(40));
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
    certifiedCodeHead: "a".repeat(40),
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
