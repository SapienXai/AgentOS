import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatGatewayFallbackDiagnosticKind,
  resolveGatewayFallbackRecovery,
  resolveTransportDiagnosticsSummary
} from "@/components/mission-control/settings-control-center.utils";
import type { MissionControlSnapshot } from "@/lib/openclaw/types";

type TransportDiagnostics = NonNullable<MissionControlSnapshot["diagnostics"]["transport"]>;

function createTransportDiagnostics(input: Partial<TransportDiagnostics>): TransportDiagnostics {
  return {
    mode: "native-ws",
    gatewayMode: "native-ws",
    statusLabel: "Native Gateway: OK",
    recovery: null,
    connectionState: "connected",
    protocolVersion: 4,
    protocolRange: { min: 3, max: 4 },
    fallbackCounts: {},
    fallbackTotal: 0,
    recentFallbackDiagnostics: [],
    lastNativeError: null,
    lastNativeFailureAt: null,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    ...input
  };
}

test("transport diagnostics summary formats native WS connected state", () => {
  const summary = resolveTransportDiagnosticsSummary(
    createTransportDiagnostics({
      mode: "native-ws",
      gatewayMode: "native-ws",
      statusLabel: "Native Gateway: OK",
      connectionState: "connected",
      protocolVersion: 4,
      fallbackCounts: {},
      lastNativeError: null,
      lastConnectedAt: "2026-05-16T10:00:00.000Z",
      lastDisconnectedAt: null
    }),
    "live"
  );

  assert.equal(summary.modeLabel, "Native WS");
  assert.equal(summary.gatewayModeLabel, "native-ws");
  assert.equal(summary.statusLabel, "Native Gateway: OK");
  assert.equal(summary.connectionLabel, "Connected");
  assert.equal(summary.protocolLabel, "v4");
  assert.equal(summary.protocolRangeLabel, "v3-v4 supported");
  assert.equal(summary.streamLabel, "Live");
  assert.equal(summary.fallbackTotal, 0);
  assert.equal(summary.fallbackOperationCount, 0);
  assert.equal(summary.fallbackSummaryLabel, "CLI fallback used: 0 operations");
  assert.equal(summary.statusTone, "success");
  assert.notEqual(summary.lastConnectedLabel, "Not yet");
  assert.equal(summary.lastDisconnectedLabel, "Not yet");
});

test("transport diagnostics summary formats CLI forced state", () => {
  const summary = resolveTransportDiagnosticsSummary(
    createTransportDiagnostics({
      mode: "cli",
      gatewayMode: "cli-forced",
      statusLabel: "CLI fallback forced",
      recovery: "Unset CLI mode.",
      connectionState: "cli-forced",
      protocolVersion: null,
      fallbackCounts: { status: 2 },
      fallbackTotal: 2,
      lastNativeError: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null
    }),
    "live"
  );

  assert.equal(summary.modeLabel, "CLI forced");
  assert.equal(summary.gatewayModeLabel, "cli-forced");
  assert.equal(summary.statusLabel, "CLI fallback forced");
  assert.equal(summary.connectionLabel, "CLI forced");
  assert.equal(summary.protocolLabel, "Unknown");
  assert.equal(summary.fallbackTotal, 2);
  assert.equal(summary.fallbackOperationCount, 1);
  assert.equal(summary.recovery, "Unset CLI mode.");
  assert.equal(summary.statusTone, "warning");
});

test("transport diagnostics summary handles missing transport data", () => {
  const summary = resolveTransportDiagnosticsSummary(undefined, "connecting");

  assert.equal(summary.modeLabel, "Unknown");
  assert.equal(summary.connectionLabel, "Unknown");
  assert.equal(summary.protocolLabel, "Unknown");
  assert.equal(summary.streamLabel, "Connecting");
  assert.equal(summary.eventBridgeLabel, "Gateway events: Unknown");
  assert.equal(summary.eventBridgeLastEventLabel, "Not yet");
  assert.equal(summary.eventBridgeLastError, null);
  assert.equal(summary.eventBridgeRecovery, null);
  assert.equal(summary.eventBridgeTone, "neutral");
  assert.equal(summary.fallbackTotal, 0);
  assert.equal(summary.lastConnectedLabel, "Not yet");
  assert.equal(summary.lastDisconnectedLabel, "Not yet");
  assert.equal(summary.statusTone, "neutral");
});

test("transport diagnostics summary surfaces degraded Gateway event stream state", () => {
  const summary = resolveTransportDiagnosticsSummary(
    createTransportDiagnostics({
      mode: "native-ws",
      gatewayMode: "native-ws",
      statusLabel: "Native Gateway: OK",
      connectionState: "connected",
      protocolVersion: 4,
      lastConnectedAt: "2026-05-16T10:00:00.000Z"
    }),
    "live",
    {
      mode: "polling",
      connected: false,
      reconnecting: false,
      reconnectAttempt: 0,
      message: "Gateway event bridge is polling.",
      recovery: "Update OpenClaw to enable Gateway event streaming.",
      lastEventAt: "2026-05-16T10:02:00.000Z",
      lastError: "missionStream is unavailable"
    }
  );

  assert.equal(summary.eventBridgeLabel, "Gateway events: Polling");
  assert.notEqual(summary.eventBridgeLastEventLabel, "Not yet");
  assert.equal(summary.eventBridgeLastError, "missionStream is unavailable");
  assert.equal(summary.eventBridgeRecovery, "Update OpenClaw to enable Gateway event streaming.");
  assert.equal(summary.eventBridgeTone, "warning");
});

test("transport diagnostics summary totals only positive finite fallback counts", () => {
  const summary = resolveTransportDiagnosticsSummary(
    createTransportDiagnostics({
      mode: "native-ws",
      gatewayMode: "fallback-active",
      statusLabel: "CLI fallback used",
      connectionState: "connected",
      protocolVersion: 4,
      fallbackCounts: {
        status: 2,
        "models.list": 1,
        "agents.list": 0,
        "sessions.list": Number.NaN
      },
      fallbackTotal: 3,
      recentFallbackDiagnostics: [{
        at: "2026-05-16T10:00:00.000Z",
        operation: "models.list",
        issue: "unknown method",
        kind: "unsupported",
        recovery: "Update OpenClaw."
      }],
      lastNativeError: "",
      lastConnectedAt: null,
      lastDisconnectedAt: "not-a-date"
    }),
    "retrying"
  );

  assert.equal(summary.fallbackTotal, 3);
  assert.equal(summary.fallbackOperationCount, 2);
  assert.equal(summary.gatewayModeLabel, "fallback-active");
  assert.equal(summary.recentFallbackDiagnostics.length, 1);
  assert.equal(summary.lastNativeError, null);
  assert.equal(summary.lastDisconnectedLabel, "not-a-date");
  assert.equal(summary.statusTone, "danger");
});

test("transport diagnostics summary treats repaired pre-connect fallback as healthy", () => {
  const summary = resolveTransportDiagnosticsSummary(
    createTransportDiagnostics({
      mode: "native-ws",
      gatewayMode: "native-ws",
      statusLabel: "Native Gateway: OK",
      connectionState: "connected",
      protocolVersion: 4,
      fallbackCounts: {
        "config.set": 2
      },
      fallbackTotal: 2,
      recentFallbackDiagnostics: [{
        at: "2026-05-16T10:00:00.000Z",
        operation: "config.set",
        issue: "gateway token mismatch",
        kind: "auth",
        recovery: "Check the Gateway token."
      }],
      lastNativeError: "gateway token mismatch",
      lastConnectedAt: "2026-05-16T10:01:00.000Z",
      lastDisconnectedAt: "2026-05-16T10:00:00.000Z"
    }),
    "live"
  );

  assert.equal(summary.gatewayModeLabel, "native-ws");
  assert.equal(summary.statusLabel, "Native Gateway: OK");
  assert.equal(summary.fallbackTotal, 2);
  assert.equal(summary.recentFallbackDiagnostics.length, 1);
  assert.equal(summary.lastNativeError, "gateway token mismatch");
  assert.equal(summary.statusTone, "success");
});

test("fallback diagnostic labels and recovery messages are actionable", () => {
  assert.equal(formatGatewayFallbackDiagnosticKind("auth"), "Needs credential");
  assert.match(resolveGatewayFallbackRecovery("auth"), /token\/password/);
  assert.equal(formatGatewayFallbackDiagnosticKind("protocol-mismatch"), "Protocol mismatch");
  assert.match(resolveGatewayFallbackRecovery("protocol-mismatch"), /protocol versions/);
  assert.equal(formatGatewayFallbackDiagnosticKind("timeout"), "Timed out");
  assert.match(resolveGatewayFallbackRecovery("timeout"), /Restart the Gateway/);
  assert.equal(formatGatewayFallbackDiagnosticKind("unsupported"), "Unsupported method");
  assert.match(resolveGatewayFallbackRecovery("unsupported"), /compatibility/);
});
