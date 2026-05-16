import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveTransportDiagnosticsSummary } from "@/components/mission-control/settings-control-center.utils";

test("transport diagnostics summary formats native WS connected state", () => {
  const summary = resolveTransportDiagnosticsSummary(
    {
      mode: "native-ws",
      connectionState: "connected",
      protocolVersion: 4,
      fallbackCounts: {},
      lastNativeError: null,
      lastConnectedAt: "2026-05-16T10:00:00.000Z",
      lastDisconnectedAt: null
    },
    "live"
  );

  assert.equal(summary.modeLabel, "Native WS");
  assert.equal(summary.connectionLabel, "Connected");
  assert.equal(summary.protocolLabel, "v4");
  assert.equal(summary.streamLabel, "Live");
  assert.equal(summary.fallbackTotal, 0);
  assert.equal(summary.statusTone, "success");
  assert.notEqual(summary.lastConnectedLabel, "Not yet");
  assert.equal(summary.lastDisconnectedLabel, "Not yet");
});

test("transport diagnostics summary formats CLI forced state", () => {
  const summary = resolveTransportDiagnosticsSummary(
    {
      mode: "cli",
      connectionState: "cli-forced",
      protocolVersion: null,
      fallbackCounts: { status: 2 },
      lastNativeError: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null
    },
    "live"
  );

  assert.equal(summary.modeLabel, "CLI forced");
  assert.equal(summary.connectionLabel, "CLI forced");
  assert.equal(summary.protocolLabel, "Unknown");
  assert.equal(summary.fallbackTotal, 2);
  assert.equal(summary.statusTone, "warning");
});

test("transport diagnostics summary handles missing transport data", () => {
  const summary = resolveTransportDiagnosticsSummary(undefined, "connecting");

  assert.equal(summary.modeLabel, "Unknown");
  assert.equal(summary.connectionLabel, "Unknown");
  assert.equal(summary.protocolLabel, "Unknown");
  assert.equal(summary.streamLabel, "Connecting");
  assert.equal(summary.fallbackTotal, 0);
  assert.equal(summary.lastConnectedLabel, "Not yet");
  assert.equal(summary.lastDisconnectedLabel, "Not yet");
  assert.equal(summary.statusTone, "neutral");
});

test("transport diagnostics summary totals only positive finite fallback counts", () => {
  const summary = resolveTransportDiagnosticsSummary(
    {
      mode: "native-ws",
      connectionState: "connected",
      protocolVersion: 4,
      fallbackCounts: {
        status: 2,
        "models.list": 1,
        "agents.list": 0,
        "sessions.list": Number.NaN
      },
      lastNativeError: "",
      lastConnectedAt: null,
      lastDisconnectedAt: "not-a-date"
    },
    "retrying"
  );

  assert.equal(summary.fallbackTotal, 3);
  assert.equal(summary.lastNativeError, null);
  assert.equal(summary.lastDisconnectedLabel, "not-a-date");
  assert.equal(summary.statusTone, "danger");
});
