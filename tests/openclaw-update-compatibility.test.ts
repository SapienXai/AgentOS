import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST,
  resolveOpenClawUpdateCompatibilitySnapshot,
  resolveOpenClawUpdateDecision,
  shouldShowDefaultOpenClawUpdate,
  type OpenClawCompatibilityManifest
} from "@/lib/openclaw/update-compatibility";
import { OPENCLAW_RECOMMENDED_VERSION } from "@/lib/openclaw/versions";

const manifest: OpenClawCompatibilityManifest = {
  schemaVersion: 1,
  source: "override",
  recommendedVersion: "2026.6.1",
  minRequiredAgentOsVersion: "0.7.2",
  versions: [
    {
      version: "2026.6.1",
      status: "certified",
      reason: "Certified stable baseline."
    },
    {
      version: "2026.7.0",
      status: "candidate",
      reason: "Preview validation in progress."
    },
    {
      version: "2026.7.1",
      status: "blocked",
      reason: "Known Gateway regression."
    },
    {
      version: "2026.8.0",
      status: "certified",
      minRequiredAgentOsVersion: "0.8.0",
      reason: "Requires newer AgentOS protocol support."
    }
  ]
};

test("certified OpenClaw version is allowed in the normal update path", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.6.1",
    mode: "recommended"
  });

  assert.equal(decision.status, "certified");
  assert.equal(decision.allowed, true);
  assert.equal(decision.defaultVisible, true);
  assert.equal(shouldShowDefaultOpenClawUpdate({ currentVersion: "2026.4.2", decision }), true);
});

test("candidate OpenClaw version requires explicit opt-in", () => {
  const defaultDecision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.7.0",
    mode: "recommended"
  });
  const previewDecision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.7.0",
    mode: "candidate"
  });

  assert.equal(defaultDecision.status, "candidate");
  assert.equal(defaultDecision.allowed, false);
  assert.equal(defaultDecision.requiresExplicitOptIn, true);
  assert.equal(previewDecision.allowed, true);
});

test("unknown OpenClaw version is hidden from the default update path", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.9.0",
    mode: "recommended"
  });

  assert.equal(decision.status, "unknown");
  assert.equal(decision.allowed, false);
  assert.equal(decision.defaultVisible, false);
});

test("blocked OpenClaw version is rejected with the manifest reason", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.7.1",
    mode: "advanced"
  });

  assert.equal(decision.status, "blocked");
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /Known Gateway regression/);
});

test("minimum AgentOS version blocks OpenClaw update", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.8.0",
    mode: "recommended"
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.requiresAgentOsUpdate, true);
  assert.equal(decision.minRequiredAgentOsVersion, "0.8.0");
});

test("offline mode uses local fallback manifest", () => {
  const snapshot = resolveOpenClawUpdateCompatibilitySnapshot({
    agentOsVersion: "0.7.2",
    currentVersion: "2026.4.2"
  });

  assert.equal(snapshot.manifestSource, "local-fallback");
  assert.equal(snapshot.recommendedVersion, OPENCLAW_RECOMMENDED_VERSION);
  assert.equal(snapshot.recommendedDecision.status, "certified");
  assert.equal(LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST.versions[0]?.version, OPENCLAW_RECOMMENDED_VERSION);
});

test("failed post-update smoke triggers rollback in the update route", () => {
  const routeSource = readFileSync(path.join(process.cwd(), "app/api/update/route.ts"), "utf8");

  assert.match(routeSource, /if \(smokeTest\.status === "failed"\)/);
  assert.match(routeSource, /runRollbackOpenClaw\(openClawBin, rollbackSnapshot, send\)/);
  assert.match(routeSource, /Rolled back to the previous working OpenClaw version/);
});
