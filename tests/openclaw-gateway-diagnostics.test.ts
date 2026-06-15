import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildDiagnosticIssues,
  buildGatewayDiagnostics,
  buildVersionDiagnostics
} from "@/lib/openclaw/adapter/diagnostics-adapter";
import { OPENCLAW_RECOMMENDED_VERSION } from "@/lib/openclaw/versions";
import type { MissionControlSnapshot, ModelReadiness, OpenClawBinarySelection } from "@/lib/openclaw/types";

const runtimeDiagnostics: MissionControlSnapshot["diagnostics"]["runtime"] = {
  stateRoot: "/tmp/openclaw",
  stateWritable: true,
  sessionStoreWritable: true,
  sessionStores: [],
  smokeTest: {
    status: "not-run",
    checkedAt: null,
    agentId: null,
    runId: null,
    summary: null,
    error: null
  },
  issues: []
};

const openClawBinarySelection: OpenClawBinarySelection = {
  mode: "auto",
  path: null,
  resolvedPath: "/usr/local/bin/openclaw",
  label: "Auto",
  detail: "Auto"
};

const modelReadiness: ModelReadiness = {
  ready: true,
  defaultModel: "openai/gpt-5.5",
  resolvedDefaultModel: "openai/gpt-5.5",
  defaultModelReady: true,
  recommendedModelId: "openai/gpt-5.5",
  preferredLoginProvider: "openai-codex",
  totalModelCount: 1,
  availableModelCount: 1,
  localModelCount: 0,
  remoteModelCount: 1,
  missingModelCount: 0,
  authProviders: [],
  issues: []
};

test("gateway diagnostics carry fallback counts and recent fallback records", () => {
  const diagnostics = buildGatewayDiagnostics({
    gatewayStatus: {
      service: { loaded: true },
      gateway: { port: 18789, probeUrl: "ws://127.0.0.1:18789" },
      rpc: { ok: true }
    },
    status: { version: "9.9.9" },
    configuredWorkspaceRoot: null,
    workspaceRoot: "/tmp/workspace",
    configuredGatewayUrl: null,
    hasOpenClawSignal: true,
    securityWarnings: [],
    runtimeDiagnostics,
    openClawBinarySelection,
    modelReadiness,
    transport: {
      mode: "native-ws",
      gatewayMode: "fallback-active",
      statusLabel: "CLI fallback used",
      recovery: "Update OpenClaw.",
      connectionState: "connected",
      protocolVersion: 4,
      protocolRange: { min: 3, max: 4 },
      fallbackCounts: { "models.list": 1 },
      fallbackTotal: 1,
      recentFallbackDiagnostics: [{
        at: "2026-05-16T10:00:00.000Z",
        operation: "models.list",
        issue: "unknown method",
        kind: "unsupported",
        recovery: "Update OpenClaw."
      }],
      lastNativeError: "unknown method",
      lastNativeFailureAt: "2026-05-16T10:00:00.000Z",
      lastConnectedAt: "2026-05-16T09:59:00.000Z",
      lastDisconnectedAt: null
    },
    eventBridge: {
      mode: "polling",
      connected: false,
      reconnecting: false,
      reconnectAttempt: 0,
      lastEventAt: null,
      lastError: "OpenClaw Gateway event stream failed.",
      message: "OpenClaw event streaming is unavailable. AgentOS is refreshing task snapshots by polling.",
      recovery: "Inspect Gateway event capabilities and compatibility diagnostics if live updates stay unavailable."
    },
    issues: [],
    versionDiagnostics: {
      currentVersion: "9.9.9",
      latestVersion: undefined,
      updateAvailable: undefined,
      updateError: undefined,
      updateInfo: "Up to date"
    }
  });

  assert.equal(diagnostics.transport?.fallbackTotal, 1);
  assert.equal(diagnostics.health, "degraded");
  assert.equal(diagnostics.gatewayFallbackDiagnostics?.[0]?.operation, "models.list");
  assert.equal(diagnostics.gatewayFallbackDiagnostics?.[0]?.operationLabel, "Models List");
  assert.match(diagnostics.gatewayFallbackReasons?.[0] ?? "", /Recovery: Update OpenClaw/);
  assert.equal(diagnostics.eventBridge?.mode, "polling");
  assert.match(diagnostics.eventBridge?.recovery ?? "", /Gateway event capabilities/);
});

test("transient payload reuse stays visible without degrading Gateway health", () => {
  const diagnostics = buildGatewayDiagnostics({
    gatewayStatus: {
      service: { loaded: true },
      gateway: { port: 18789, probeUrl: "ws://127.0.0.1:18789" },
      rpc: { ok: true }
    },
    status: { version: "9.9.9" },
    configuredWorkspaceRoot: null,
    workspaceRoot: "/tmp/workspace",
    configuredGatewayUrl: null,
    hasOpenClawSignal: true,
    securityWarnings: [],
    runtimeDiagnostics,
    openClawBinarySelection,
    modelReadiness,
    eventBridge: {
      mode: "live",
      connected: true,
      reconnecting: false,
      reconnectAttempt: 0,
      lastEventAt: "2026-05-16T10:00:00.000Z",
      lastError: null,
      message: null,
      recovery: null
    },
    issues: buildDiagnosticIssues({
      payloadResults: {},
      gatewayStatusRejectedWithCachedValue: false,
      payloadReuse: {
        status: { reusedCachedValue: true },
        updateStatus: { reusedCachedValue: true },
        modelStatus: { reusedCachedValue: true }
      },
      runtimeIssues: []
    }),
    versionDiagnostics: {
      currentVersion: "9.9.9",
      latestVersion: undefined,
      updateAvailable: undefined,
      updateError: undefined,
      updateInfo: "Up to date"
    }
  });

  assert.equal(diagnostics.health, "healthy");
  assert.equal(diagnostics.issues.length, 3);
  assert.match(diagnostics.issues[0] ?? "", /Reusing the last successful payload/);
});

test("update availability fallback stays visible without degrading Gateway health", () => {
  const diagnostics = buildGatewayDiagnostics({
    gatewayStatus: {
      service: { loaded: true },
      gateway: { port: 18789, probeUrl: "ws://127.0.0.1:18789" },
      rpc: { ok: true }
    },
    status: { version: "2026.6.1" },
    configuredWorkspaceRoot: null,
    workspaceRoot: "/tmp/workspace",
    configuredGatewayUrl: null,
    hasOpenClawSignal: true,
    securityWarnings: [],
    runtimeDiagnostics,
    openClawBinarySelection,
    modelReadiness,
    transport: {
      mode: "native-ws",
      gatewayMode: "fallback-active",
      statusLabel: "CLI fallback used",
      recovery: "Update OpenClaw or report the incompatible Gateway response shape.",
      connectionState: "connected",
      protocolVersion: 4,
      protocolRange: { min: 3, max: 4 },
      fallbackCounts: { "update.status": 1 },
      fallbackTotal: 1,
      recentFallbackDiagnostics: [{
        at: "2026-06-06T19:39:00.000Z",
        operation: "update.status",
        issue: "OpenClaw Gateway update.status did not include update availability details.",
        kind: "malformed-response",
        recovery: "Update OpenClaw or report the incompatible Gateway response shape."
      }],
      lastNativeError: "OpenClaw Gateway update.status did not include update availability details.",
      lastNativeFailureAt: "2026-06-06T19:39:00.000Z",
      lastConnectedAt: "2026-06-06T19:38:00.000Z",
      lastDisconnectedAt: null
    },
    eventBridge: {
      mode: "live",
      connected: true,
      reconnecting: false,
      reconnectAttempt: 0,
      lastEventAt: "2026-06-06T19:39:00.000Z",
      lastError: null,
      message: null,
      recovery: null
    },
    issues: [],
    versionDiagnostics: {
      currentVersion: "2026.6.1",
      latestVersion: undefined,
      updateAvailable: undefined,
      updateError: undefined,
      updateInfo: "Update registry status is still loading."
    }
  });

  assert.equal(diagnostics.health, "healthy");
  assert.equal(diagnostics.gatewayFallbackDiagnostics?.[0]?.operation, "update.status");
  assert.match(diagnostics.gatewayFallbackReasons?.[0] ?? "", /update availability details/);
});

test("gateway diagnostics surface pending device access instead of native timeout noise", () => {
  const diagnostics = buildGatewayDiagnostics({
    gatewayStatus: {
      service: { loaded: true },
      gateway: { port: 18789, probeUrl: "ws://127.0.0.1:18789" },
      rpc: {
        ok: false,
        capability: "pairing_pending",
        error: "scope upgrade pending approval (requestId: 90f256bb-2bb4-474e-90e5-6a3b95f79f92)",
        auth: {
          capability: "pairing_pending"
        }
      }
    },
    status: { version: "9.9.9" },
    configuredWorkspaceRoot: null,
    workspaceRoot: "/tmp/workspace",
    configuredGatewayUrl: null,
    hasOpenClawSignal: true,
    securityWarnings: [],
    runtimeDiagnostics,
    openClawBinarySelection,
    modelReadiness,
    issues: [
      'agents: Timed out waiting for OpenClaw Gateway method "agents.list". Gateway-native operation failed; CLI fallback disabled for this operation.',
      "runtime state is writable"
    ],
    versionDiagnostics: {
      currentVersion: "9.9.9",
      latestVersion: undefined,
      updateAvailable: undefined,
      updateError: undefined,
      updateInfo: "Up to date"
    }
  });

  assert.match(diagnostics.issues[0] ?? "", /operator-scope approval/);
  assert.match(diagnostics.issues[0] ?? "", /90f256bb-2bb4-474e-90e5-6a3b95f79f92/);
  assert.equal(diagnostics.issues.some((issue) => /agents\.list/.test(issue)), false);
  assert.equal(diagnostics.issues.includes("runtime state is writable"), true);
});

test("version diagnostics use update.status when status lacks registry details", () => {
  const diagnostics = buildVersionDiagnostics({
    status: { version: "2026.6.0" },
    updateStatus: {
      result: {
        update: {
          registry: {
            latestVersion: OPENCLAW_RECOMMENDED_VERSION
          }
        }
      }
    }
  });

  assert.equal(diagnostics.currentVersion, "2026.6.0");
  assert.equal(diagnostics.latestVersion, OPENCLAW_RECOMMENDED_VERSION);
  assert.equal(diagnostics.updateAvailable, true);
  assert.match(diagnostics.updateInfo ?? "", /Update available/);
});

test("gateway diagnostics keep registry latest separate from certified default update", () => {
  const diagnostics = buildGatewayDiagnostics({
    gatewayStatus: {
      service: { loaded: false },
      gateway: { port: 18789, probeUrl: "ws://127.0.0.1:18789" },
      rpc: { ok: false }
    },
    status: { version: "2026.6.1" },
    configuredWorkspaceRoot: null,
    workspaceRoot: "/tmp/workspace",
    configuredGatewayUrl: null,
    hasOpenClawSignal: true,
    securityWarnings: [],
    runtimeDiagnostics,
    openClawBinarySelection,
    modelReadiness,
    issues: [],
    versionDiagnostics: {
      currentVersion: "2026.6.1",
      latestVersion: "2026.6.6",
      updateAvailable: true,
      updateError: undefined,
      updateInfo: "Update available: v2026.6.6 is ready. Current version: v2026.6.1."
    }
  });

  assert.equal(diagnostics.version, "2026.6.1");
  assert.equal(diagnostics.latestVersion, "2026.6.6");
  assert.equal(diagnostics.updateAvailable, false);
  assert.equal(diagnostics.updateCompatibility?.latestDecision?.version, "2026.6.6");
  assert.equal(diagnostics.updateCompatibility?.latestDecision?.status, "unknown");
});

test("version diagnostics expose update.status errors instead of reporting loading", () => {
  const diagnostics = buildVersionDiagnostics({
    status: { version: "2026.6.0" },
    updateStatusError: "scope upgrade pending approval"
  });

  assert.equal(diagnostics.latestVersion, undefined);
  assert.equal(diagnostics.updateAvailable, undefined);
  assert.equal(diagnostics.updateError, "scope upgrade pending approval");
  assert.match(diagnostics.updateInfo ?? "", /Update registry check failed/);
});
