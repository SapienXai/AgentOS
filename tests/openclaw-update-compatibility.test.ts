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
import { buildOpenClawUpdatePreflightReport } from "@/lib/openclaw/update-safety";
import type { MissionControlSnapshot } from "@/lib/openclaw/types";
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

test("preflight report blocks update when Gateway is not ready", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.6.1",
    mode: "recommended"
  });
  const report = buildOpenClawUpdatePreflightReport({
    snapshot: createUpdateSafetySnapshot({
      loaded: false,
      rpcOk: false
    }),
    targetVersion: "2026.6.1",
    decision,
    rollbackSnapshotAvailable: false,
    generatedAt: new Date("2026-06-14T10:00:00.000Z")
  });

  assert.equal(report.canAttemptUpdate, false);
  assert.equal(report.blockers.some((check) => check.id === "gateway-reachability"), true);
  assert.match(report.recommendedNextAction, /Do not update yet/);
});

test("candidate preflight remains attemptable only with explicit opt-in warning", () => {
  const decision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion: "0.7.2",
    targetVersion: "2026.7.0",
    mode: "candidate"
  });
  const report = buildOpenClawUpdatePreflightReport({
    snapshot: createUpdateSafetySnapshot({}),
    targetVersion: "2026.7.0",
    decision,
    rollbackSnapshotAvailable: true,
    generatedAt: new Date("2026-06-14T10:00:00.000Z")
  });

  assert.equal(report.canAttemptUpdate, true);
  assert.equal(report.requiresExplicitConfirmation, true);
  assert.equal(report.warnings.some((check) => check.id === "manifest-decision"), true);
});

test("update route exposes non-mutating preflight and probe actions", () => {
  const routeSource = readFileSync(path.join(process.cwd(), "app/api/update/route.ts"), "utf8");

  assert.match(routeSource, /z\.enum\(\["preflight", "probe", "update", "rollback"\]\)/);
  assert.match(routeSource, /buildOpenClawUpdatePreflightReport/);
  assert.match(routeSource, /runOpenClawShadowProbe/);
  assert.match(routeSource, /recordOpenClawUpdateRuntimeIssue/);
  assert.match(routeSource, /redactSecrets\(\{ report \}\)/);
});

test("rollback snapshot records compatibility summary and config hash", () => {
  const source = readFileSync(path.join(process.cwd(), "lib/openclaw/update-rollback.ts"), "utf8");

  assert.match(source, /configHash/);
  assert.match(source, /createHash\("sha256"\)/);
  assert.match(source, /compatibilitySummary/);
  assert.match(source, /decision: input\.decision/);
});

function createUpdateSafetySnapshot(input: {
  loaded?: boolean;
  rpcOk?: boolean;
}): MissionControlSnapshot {
  return {
    diagnostics: {
      installed: true,
      loaded: input.loaded ?? true,
      rpcOk: input.rpcOk ?? true,
      health: "healthy",
      version: "2026.4.2",
      latestVersion: "2026.6.1",
      workspaceRoot: "/tmp/agentos",
      configuredWorkspaceRoot: null,
      dashboardUrl: "http://127.0.0.1:3000",
      gatewayUrl: "ws://127.0.0.1:18789",
      configuredGatewayUrl: null,
      openClawBinarySelection: {
        mode: "auto",
        path: null,
        resolvedPath: "openclaw",
        source: "auto",
        issue: null
      },
      modelReadiness: {
        ready: true,
        issues: [],
        defaultModel: "gpt-5",
        resolvedDefaultModel: "gpt-5",
        preferredLoginProvider: null,
        availableModelCount: 1,
        totalModelCount: 1
      },
      capabilityMatrix: {
        detectedAt: "2026-06-14T10:00:00.000Z",
        openClawVersion: "2026.4.2",
        gatewayProtocolVersion: "1",
        authMode: "local-token",
        supportedMethods: [],
        configSchema: "supported",
        configPatch: "supported",
        chatEvents: "supported",
        missionDispatch: "supported",
        taskFeed: "supported",
        configRead: "supported",
        diagnosticsRead: "supported",
        nativeMissionDispatch: "supported",
        nativeAgentLifecycle: "supported",
        eventBridge: "supported",
        compatibility: {
          protocol: {
            status: "compatible",
            connectedVersion: 1,
            requestedRange: { min: 1, max: 1 },
            reason: "ok"
          },
          methodContract: {
            status: "ok",
            requiredMethodCount: 0,
            supportedRequiredMethodCount: 0,
            missingRequiredMethods: [],
            missingMethodCount: 0
          },
          nativeOperationCount: 0,
          cliFallbackOperationCount: 0,
          unsupportedOperationCount: 0,
          degradedOperations: [],
          aliasOperations: []
        },
        degradedFeatures: [],
        fallbackDiagnostics: [],
        fallbackReasons: [],
        unsupportedGatewayMethods: [],
        diagnostics: []
      },
      compatibilityReport: null,
      configUpdatePacing: {
        settings: {
          mode: "respect-gateway",
          minimumIntervalMs: null
        },
        effectiveMinimumIntervalMs: 10_000,
        staleCacheAllowed: true,
        cacheState: "fresh",
        cooldownUntil: null,
        lastRefreshAt: null,
        nextRefreshAt: null,
        reason: "ok"
      },
      runtime: {
        status: "unknown",
        sessions: [],
        tasks: [],
        artifacts: [],
        approvals: []
      },
      transport: {
        mode: "native-ws",
        gatewayMode: "healthy",
        statusLabel: "Connected",
        recovery: null,
        connectionState: "connected",
        protocolVersion: 1,
        protocolRange: { min: 1, max: 1 },
        fallbackCounts: {},
        fallbackTotal: 0,
        recentFallbackDiagnostics: [],
        lastNativeError: null,
        lastNativeFailureAt: null,
        lastConnectedAt: "2026-06-14T10:00:00.000Z",
        lastDisconnectedAt: null
      },
      runtimeIssues: [],
      securityWarnings: [],
      issues: []
    },
    mode: "live",
    generatedAt: "2026-06-14T10:00:00.000Z",
    workspaces: [],
    agents: [],
    tasks: [],
    taskGraph: { nodes: [], edges: [] },
    channels: [],
    accounts: [],
    models: []
  } as unknown as MissionControlSnapshot;
}
