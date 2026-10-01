import assert from "node:assert/strict";
import { test } from "node:test";

import { buildCumulativeOpenClawContractEvidence } from "@/scripts/openclaw-cumulative-contract-audit";

const SOURCE_COMMIT = "1".repeat(40);
const RELEASE_COMMITS = ["2", "3", "4"].map((digit) => digit.repeat(40));
const VALID_INTEGRITY = `sha512-${"A".repeat(86)}==`;
const RELEASES = ["2026.9.5", "2026.9.6", "2026.9.7"];
const METHODS_REMOVED = ["tasks.cancel", "tasks.dismiss", "tasks.get", "tasks.history", "tasks.list", "tasks.retry"];

test("cumulative contract audit preserves the complete 9.4 through 9.7 evidence chain", () => {
  const evidence = buildCumulativeOpenClawContractEvidence(baseInput());
  assert.equal(evidence.success, true);
  assert.equal(evidence.status, "PASS");
  assert.equal(evidence.provenance.comparison, "2026.9.4 -> 2026.9.7");
  assert.equal(evidence.checks.sessionGithubScopeChangeIsPreserved, true);
  assert.equal(evidence.checks.removedOptionalTaskMethodsArePreserved, true);
  assert.equal(evidence.summary.warningCount, 21);
});

test("cumulative contract audit fails closed on evidence gaps, new shapes, and incomplete release transitions", () => {
  const unsupportedShape = baseInput();
  (unsupportedShape.releases[2].contractDiff as Record<string, unknown>).futureDescriptorShape = { lifetime: { kind: "observation" } };
  const unsupportedResult = buildCumulativeOpenClawContractEvidence(unsupportedShape);
  assert.equal(unsupportedResult.success, false);
  assert.equal(unsupportedResult.checks.watcherEvidenceHasNoBlockersUnknownsOrGaps, false);

  const evidenceGap = baseInput();
  (evidenceGap.releases[1].contractDiff as Record<string, unknown>).evidenceGaps = ["missing protocol source"];
  assert.equal(buildCumulativeOpenClawContractEvidence(evidenceGap).success, false);

  const missingTransition = baseInput();
  missingTransition.releases[1].contractDiff.fromVersion = "2026.9.4";
  assert.equal(buildCumulativeOpenClawContractEvidence(missingTransition).checks.cumulativeReleaseChainIsComplete, false);
});

test("cumulative contract audit does not reinterpret upstream warnings or blockers as compatibility proof", () => {
  const warned = baseInput();
  warned.releases[0].contractDiff.summary = "20 method contract change(s), 1 blocker(s), 2 warning(s), 0 unknown(s), 500 server-method file change(s), and 109 protocol file change(s).";
  const blocked = buildCumulativeOpenClawContractEvidence(warned);
  assert.equal(blocked.success, false);
  assert.equal(blocked.summary.blockerCount, 1);

  const missingScope = baseInput();
  missingScope.releases[1].contractDiff.scopesChanged = [];
  assert.equal(buildCumulativeOpenClawContractEvidence(missingScope).checks.sessionGithubScopeChangeIsPreserved, false);
});

function baseInput() {
  const releases = RELEASES.map((version, index) => {
    const sourceVersion = index === 0 ? "2026.9.4" : RELEASES[index - 1];
    const sourceCommit = index === 0 ? SOURCE_COMMIT : RELEASE_COMMITS[index - 1];
    const targetCommit = RELEASE_COMMITS[index];
    const removed = index === 2 ? METHODS_REMOVED : index === 1
      ? ["sessions.compaction.branch", "sessions.compaction.list", "sessions.compaction.restore"]
      : [];
    return {
      version,
      intakeSha256: "a".repeat(64),
      contractDiffSha256: "b".repeat(64),
      intake: {
        upstream: { version, sourceCommit: targetCommit },
        identity: {
          version,
          tag: `v${version}`,
          sourceCommit: targetCommit,
          status: "verified",
          packageVersion: version,
          packageIntegrity: VALID_INTEGRITY,
          gatewayClientPackage: { packageName: "@openclaw/gateway-client", version, integrity: VALID_INTEGRITY },
          gatewayProtocolPackage: { packageName: "@openclaw/gateway-protocol", version, integrity: VALID_INTEGRITY },
          mismatches: [],
          missingEvidence: []
        }
      },
      contractDiff: {
        status: "warning",
        fromVersion: sourceVersion,
        targetVersion: version,
        methodsAdded: [],
        methodsRemoved: removed,
        scopesChanged: index === 1 ? ["sessions.github.publish: operator.write -> operator.sessions.write"] : [],
        eventsAdded: [],
        eventsRemoved: [],
        requestSchemasChanged: [],
        responseSchemasChanged: [],
        requiredFieldsAdded: [],
        requiredFieldsRemoved: [],
        enumValuesAdded: [],
        enumValuesRemoved: [],
        configKeysAdded: [],
        configKeysRemoved: [],
        configDefaultsChanged: [],
        securitySensitiveChanges: [],
        domainsChanged: [],
        evidenceGaps: [],
        changedFiles: [],
        protocolChanged: true,
        updateContractChanged: true,
        sessionContractChanged: true,
        summary: `20 method contract change(s), 0 blocker(s), ${[2, 6, 13][index]} warning(s), 0 unknown(s), 500 server-method file change(s), and 109 protocol file change(s).`
      }
    };
  });
  return {
    sourceCertification: {
      success: true,
      provenance: {
        expectedOpenClaw: {
          version: "2026.9.4",
          tag: "v2026.9.4",
          signedTagObject: "5".repeat(40),
          sourceCommit: SOURCE_COMMIT,
          buildId: "2026.9.4-release-source-build",
          gatewayProtocol: 4,
          stateSchema: 17,
          agentSchema: 19
        },
        openClaw: {
          version: "2026.9.4",
          sourceCommit: SOURCE_COMMIT,
          packageHash: "c".repeat(64)
        }
      }
    },
    releases,
    targetPackage: {
      version: "2026.9.7",
      sourceCommit: RELEASE_COMMITS[2],
      buildId: "2026.9.7-release-target-build",
      stateSchema: 19,
      agentSchema: 24
    },
    generatedAt: "2026-10-01T00:00:00.000Z"
  };
}
