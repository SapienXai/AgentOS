import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { resolveUpdateDialogTitle, resolveUpdateDialogDescription } from "@/components/mission-control/mission-control-shell.utils";

function read(relativePath: string) {
  return readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

test("canonical Updates page reads native status and runs native update.run", () => {
  const source = read("components/operations/updates/updates-page-content.tsx");

  assert.match(source, /\/api\/openclaw\/native-doctor/);
  assert.match(source, /action:\s*"update\.run"/);
  assert.match(source, /OpenClaw update\.status/);
  assert.doesNotMatch(source, /\/api\/update/);
  assert.doesNotMatch(source, /--tag/);
  assert.match(source, /Community release intelligence is advisory/);
  assert.match(source, /Community confidence never decides whether OpenClaw is up to date or whether an update runs/);
  assert.match(source, /const shouldPollNativeUpdate = awaitingNativeVerification \|\| durableUpdateRunning \|\| actionState === "running"/);
  assert.doesNotMatch(source, /const showPikoLoader = isRefreshing/);
  assert.match(source, /<div id="agentos-update"><AgentOsUpdateCard \/><\/div>/);
  assert.match(source, /!native && isRefreshing \?/);
  assert.match(source, /run\.steps\.find\(\(step\) => step\.status === "in_progress"\)/);
  assert.match(source, /setInterval\(\(\) => \{/);
  assert.match(source, /open=\{isOpen\}/);
  assert.match(source, /!native && isRefreshing \?/);
  assert.match(source, /previousRunIds\.includes\(run\.runId\)/);
  assert.match(source, /OpenClaw's native update \$\{state\}/);
  assert.doesNotMatch(source, /OpenClaw update verification pending/);
  assert.match(source, /Version after run/);
  assert.match(source, /Failed during \$\{formatUpdateStepName\(failedStep\.step\)\}/);
  assert.match(source, /Retry OpenClaw update/);
  assert.match(source, /fetch\("\/api\/openclaw\/dashboard"/);
  assert.match(source, /Open OpenClaw Control UI/);
  assert.match(source, /needsNativeReview = run\.status === "failed" \|\| run\.status === "rolled-back"/);
  assert.match(source, /showNativeReviewAction = .*&& !actionMessage/);
});

test("native update.run consumes a server-issued confirmation challenge after fresh policy checks", () => {
  const source = read("app/api/openclaw/native-doctor/route.ts");

  assert.match(source, /issueNativeUpdateConfirmation\(confirmation, permission\.actor\.actorId\)/);
  assert.match(source, /consumeNativeUpdateConfirmation\(input\.confirmation, permission\.actor\.actorId, currentConfirmation\)/);
  assert.match(source, /confirmation: confirmationSchema\.extend\(\{ challengeId: z\.string\(\)\.uuid\(\) \}\)/);
});

test("advanced update failures link operators to native OpenClaw diagnostics", () => {
  const source = read("components/mission-control/mission-control-shell.dialogs.tsx");

  assert.match(source, /updateRunState === "error"/);
  assert.match(source, /fetch\("\/api\/openclaw\/dashboard"/);
  assert.match(source, /OpenClaw owns the native updater and its failure details/);
  assert.match(source, /Open OpenClaw Control UI/);
});

test("normal native update endpoint enforces the shared server policy and target confirmation", () => {
  const route = read("app/api/openclaw/native-doctor/route.ts");
  const policyDomain = read("lib/openclaw/domains/normal-update-policy.ts");
  const policyService = read("lib/openclaw/application/normal-update-policy-service.ts");

  assert.match(route, /getNormalOpenClawUpdatePolicy/);
  assert.match(route, /guardNormalOpenClawUpdate/);
  assert.match(route, /canAgentOsActorUseProductPermission\(permission\.actor, "updates\.manage"\)/);
  assert.match(route, /unverifiedAcknowledged: input\.unverifiedAcknowledged === true/);
  assert.match(route, /refreshCheckout:\s*true/);
  assert.match(route, /action:\s*z\.literal\("update\.run"\)/);
  assert.match(route, /availableVersion:\s*z\.string\(\)\.nullable\(\)/);
  assert.match(route, /reconcileAgentOsSessionSecurityDefaults/);
  assert.match(route, /UPDATE_SECURITY_POLICY_REQUIRED/);
  assert.doesNotMatch(route, /override\s*:/);
  assert.match(policyDomain, /resolveOpenClawUpdateDecision/);
  assert.match(policyDomain, /resolveOpenClawProductUpdateState/);
  assert.match(policyService, /readOpenClawCompatibilityManifestOverride/);
});

test("Settings and Native Doctor link to Updates without duplicate normal update actions", () => {
  const settings = read("components/mission-control/mission-control-shell.settings.tsx");
  const controlCenter = read("components/mission-control/settings-control-center.tsx");
  const doctor = read("components/mission-control/native-doctor-panel.tsx");

  assert.match(settings, /href="\/updates"/);
  assert.doesNotMatch(settings, /onCheckForUpdates\(\)/);
  assert.doesNotMatch(settings, /onOpenUpdateDialog\(recommendedVersion/);
  assert.match(controlCenter, /href="\/updates"/);
  assert.match(controlCenter, /Compatibility Lab/);
  assert.match(doctor, /href="\/updates"/);
  assert.doesNotMatch(doctor, /Run native update/);
});

test("legacy update API remains available for advanced exact-version workflows", () => {
  const source = read("app/api/update/route.ts");

  assert.match(source, /buildOpenClawUpdateArgs/);
  assert.match(source, /rollbackPolicy/);
  assert.match(source, /certificationScorecard/);
});


test("advanced update interruption is reconciled without retrying the mutation", () => {
  const source = read("components/mission-control/mission-control-shell.tsx");
  const flow = source.slice(source.indexOf("const runOpenClawUpdate = async"), source.indexOf("const runOpenClawOnboarding"));
  assert.match(flow, /if \(sawDone\) return/);
  assert.match(flow, /isExpectedRuntimeShutdownError\(error\)/);
  assert.match(flow, /await refreshSnapshot\(\{ force: true, signal: AbortSignal.timeout\(10_000\) \}\)/);
  assert.match(flow, /setUpdateRunState\("unknown"\)/);
  assert.equal((flow.match(/fetch\("\/api\/update"/g) ?? []).length, 1);
  const reconciliation = flow.slice(flow.indexOf("// A dropped stream"));
  assert.doesNotMatch(reconciliation, /setUpdateRunState\("success"\)/);
});

test("advanced update dialog keeps technical output optional and verification actionable", () => {
  const source = read("components/mission-control/mission-control-shell.dialogs.tsx");
  assert.match(source, /<MissionControlDialogShell/);
  assert.match(source, /<details/);
  assert.match(source, /Technical details/);
  assert.match(source, /href="\/updates">Check update status/);
  assert.match(source, /Result not yet confirmed/);
  assert.match(source, /updateCertificationScorecard \? <CertificationScorecardPanel/);
  assert.doesNotMatch(source, /snapshot.diagnostics.version \|\| snapshot.diagnostics.latestVersion/);
});


test("update copy distinguishes interrupted verification from native failure", () => {
  assert.equal(resolveUpdateDialogTitle("unknown"), "Check update result");
  assert.match(resolveUpdateDialogDescription("unknown"), /may still have completed/);
  assert.doesNotMatch(resolveUpdateDialogDescription("unknown"), /failed|successful/);
  assert.equal(resolveUpdateDialogTitle("error"), "Update failed");
  assert.equal(resolveUpdateDialogTitle("success"), "Update complete");
  assert.match(resolveUpdateDialogDescription("running"), /disconnect during restart is expected/);
});
