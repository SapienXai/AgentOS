import assert from "node:assert/strict";
import { test } from "node:test";

import { buildGatewayDiagnostics } from "@/lib/openclaw/adapter/diagnostics-adapter";
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
  assert.equal(diagnostics.gatewayFallbackDiagnostics?.[0]?.operation, "models.list");
  assert.equal(diagnostics.gatewayFallbackDiagnostics?.[0]?.operationLabel, "Models List");
  assert.match(diagnostics.gatewayFallbackReasons?.[0] ?? "", /Recovery: Update OpenClaw/);
});
