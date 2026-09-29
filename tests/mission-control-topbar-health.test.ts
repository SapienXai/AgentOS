import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { presentOperatorRuntime } from "@/lib/agentos/ui/operator-runtime-projection";
import { createLoadingSnapshot } from "@/lib/openclaw/fallback";

test("topbar and settings use the canonical operator runtime projection", () => {
  const source = readFileSync(
    join(process.cwd(), "components/mission-control/mission-control-shell.topbar.tsx"),
    "utf8"
  );
  const settingsSource = readFileSync(
    join(process.cwd(), "components/mission-control/mission-control-shell.settings.tsx"),
    "utf8"
  );

  assert.match(source, /presentOperatorRuntime/);
  assert.match(source, /OperatorTruthBadge/);
  assert.match(settingsSource, /presentOperatorRuntime/);
  assert.match(settingsSource, /OperatorTruthBadge/);
});

test("CLI fallback remains an explicit operator authority in the shared presenter", () => {
  const sources = [
    readFileSync(join(process.cwd(), "components/mission-control/mission-control-shell.topbar.tsx"), "utf8"),
    readFileSync(join(process.cwd(), "components/mission-control/mission-control-shell.settings.tsx"), "utf8"),
    readFileSync(join(process.cwd(), "lib/agentos/ui/operator-runtime-projection.ts"), "utf8")
  ];

  assert.match(sources[0], /OperatorTruthBadge/);
  assert.match(sources[1], /OperatorTruthBadge/);
  assert.match(sources[2], /cli-fallback/);
  assert.match(sources[2], /fallback-active/);
});

test("topbar truth stays READY and Native Gateway for an informational live fallback", () => {
  const now = Date.parse("2026-09-29T12:00:00.000Z");
  const snapshot = createLoadingSnapshot("test snapshot");
  const fallback = {
    at: new Date(now).toISOString(),
    operation: "update.status",
    issue: "OpenClaw Gateway update.status did not include update availability details.",
    kind: "malformed-response",
    recovery: "Use the read-only update status fallback."
  };

  snapshot.generatedAt = new Date(now).toISOString();
  snapshot.mode = "live";
  snapshot.diagnostics.rpcOk = true;
  snapshot.diagnostics.health = "healthy";
  snapshot.diagnostics.runtime.stateWritable = true;
  snapshot.diagnostics.runtime.sessionStoreWritable = true;
  snapshot.diagnostics.transport = {
    mode: "native-ws",
    gatewayMode: "fallback-active",
    statusLabel: "CLI fallback used",
    recovery: "Inspect fallback diagnostics.",
    connectionState: "connected",
    protocolVersion: 4,
    protocolRange: { min: 3, max: 4 },
    fallbackCounts: { "update.status": 1 },
    fallbackTotal: 1,
    recentFallbackDiagnostics: [fallback],
    lastNativeError: fallback.issue,
    lastNativeFailureAt: fallback.at,
    lastConnectedAt: new Date(now - 1_000).toISOString(),
    lastDisconnectedAt: null
  };
  snapshot.diagnostics.compatibilityReport = {
    status: "compatible",
    fallback: { diagnostics: [fallback] },
    contracts: [],
    summary: { nativeGatewayCoveragePercent: 100 }
  } as unknown as NonNullable<typeof snapshot.diagnostics.compatibilityReport>;

  const topbarTruth = presentOperatorRuntime(snapshot, { connectionState: "live", now });

  assert.equal(topbarTruth.stateLabel, "Ready");
  assert.equal(topbarTruth.authority.label, "Native Gateway");
  assert.equal(topbarTruth.fallback.informationalOperationCount, 1);
});
