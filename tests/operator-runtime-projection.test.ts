import assert from "node:assert/strict";
import { test } from "node:test";

import { presentOperatorRuntime } from "@/lib/agentos/ui/operator-runtime-projection";
import { createLoadingSnapshot } from "@/lib/openclaw/fallback";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";

const NOW = Date.parse("2026-09-20T12:00:00.000Z");

function makeSnapshot(input: {
  generatedAt?: string;
  mode?: MissionControlSnapshot["mode"];
  health?: MissionControlSnapshot["diagnostics"]["health"];
  rpcOk?: boolean;
  installed?: boolean;
  loaded?: boolean;
  gatewayMode?: "native-ws" | "cli-forced" | "fallback-active" | "degraded" | "unreachable";
  transportMode?: "native-ws" | "cli";
  compatibility?: "compatible" | "degraded" | "incompatible" | "unknown";
  runtimeIssues?: MissionControlSnapshot["diagnostics"]["runtimeIssues"];
} = {}): MissionControlSnapshot {
  const base = createLoadingSnapshot("test snapshot");
  const compatibility = input.compatibility ?? "compatible";

  return {
    ...base,
    generatedAt: input.generatedAt ?? new Date(NOW).toISOString(),
    mode: input.mode ?? "live",
    diagnostics: {
      ...base.diagnostics,
      installed: input.installed ?? true,
      loaded: input.loaded ?? true,
      rpcOk: input.rpcOk ?? true,
      health: input.health ?? "healthy",
      runtime: {
        ...base.diagnostics.runtime,
        stateWritable: true,
        sessionStoreWritable: true,
        issues: []
      },
      transport: {
        mode: input.transportMode ?? "native-ws",
        transportImplementation: input.transportMode === "cli" ? "cli" : "official",
        gatewayMode: input.gatewayMode ?? "native-ws",
        statusLabel: "test",
        recovery: null,
        connectionState: "connected",
        protocolVersion: 4,
        protocolRange: { min: 1, max: 4 },
        fallbackCounts: {},
        fallbackTotal: 0,
        recentFallbackDiagnostics: [],
        lastNativeError: null,
        lastNativeFailureAt: null,
        lastConnectedAt: new Date(NOW).toISOString(),
        lastDisconnectedAt: null
      },
      capabilityMatrix: {
        compatibility: {
          methodContract: {
            status: "verified",
            checkedAt: new Date(NOW).toISOString(),
            source: "gateway-handshake",
            refreshIntervalMs: 30_000,
            expectedMethodCount: 1,
            advertisedMethodCount: 1,
            missingMethodCount: 0,
            missingMethods: [],
            missingOperations: [],
            reason: "test"
          },
          nativeOperationCount: 1,
          degradedOperationCount: compatibility === "degraded" ? 1 : 0,
          unknownOperationCount: compatibility === "unknown" ? 1 : 0,
          aliasOperations: [],
          degradedOperations: [],
          protocol: {
            status: compatibility === "incompatible" ? "unsupported" : compatibility === "unknown" ? "unknown" : "compatible",
            version: "4",
            reason: "test"
          }
        }
      } as unknown as NonNullable<MissionControlSnapshot["diagnostics"]["capabilityMatrix"]>,
      compatibilityReport: null,
      runtimeIssues: input.runtimeIssues ?? []
    }
  };
}

test("operator projection presents a fully ready native Gateway", () => {
  const projection = presentOperatorRuntime(makeSnapshot(), { connectionState: "live", now: NOW });

  assert.equal(projection.state, "ready");
  assert.equal(projection.authority.mode, "native-gateway");
  assert.equal(projection.transport.state, "live");
  assert.equal(projection.freshness.state, "live");
  assert.equal(projection.scope.kind, "global");
});

test("healthy stream with degraded Gateway never becomes Online or ready", () => {
  const projection = presentOperatorRuntime(makeSnapshot({ rpcOk: false, health: "degraded", gatewayMode: "degraded", compatibility: "degraded" }), {
    connectionState: "live",
    now: NOW
  });

  assert.equal(projection.state, "degraded");
  assert.equal(projection.authority.mode, "unavailable");
  assert.notEqual(projection.stateLabel, "Online");
});

test("active CLI fallback is explicit and degraded", () => {
  const projection = presentOperatorRuntime(makeSnapshot({
    rpcOk: false,
    health: "degraded",
    gatewayMode: "fallback-active",
    transportMode: "cli",
    compatibility: "degraded"
  }), { connectionState: "live", now: NOW });

  assert.equal(projection.state, "degraded");
  assert.equal(projection.authority.mode, "cli-fallback");
  assert.equal(projection.fallback.active, true);
});

test("connecting and retrying remain transport states even when a snapshot exists", () => {
  const snapshot = makeSnapshot();

  assert.equal(presentOperatorRuntime(snapshot, { connectionState: "connecting", now: NOW }).state, "connecting");
  assert.equal(presentOperatorRuntime(snapshot, { connectionState: "retrying", now: NOW }).transport.state, "retrying");
  assert.match(presentOperatorRuntime(snapshot, { connectionState: "retrying", now: NOW }).freshness.label, /^Reconnecting/);
});

test("Gateway unreachable with an actionable issue is blocked", () => {
  const issue = {
    id: "gateway",
    type: "gateway_unreachable" as const,
    source: "openclaw_gateway" as const,
    severity: "blocked" as const,
    title: "Gateway unavailable",
    message: "Gateway is unavailable.",
    createdAt: new Date(NOW).toISOString(),
    updatedAt: new Date(NOW).toISOString(),
    status: "open" as const
  };
  const projection = presentOperatorRuntime(makeSnapshot({ health: "offline", rpcOk: false, gatewayMode: "unreachable", runtimeIssues: [issue] }), {
    connectionState: "live",
    now: NOW
  });

  assert.equal(projection.state, "blocked");
  assert.equal(projection.attention.actionableCount, 1);
});

test("Gateway permission signals keep the Settings recovery route", () => {
  const snapshot = makeSnapshot({
    rpcOk: false,
    health: "degraded",
    gatewayMode: "degraded",
    runtimeIssues: [],
  });
  snapshot.diagnostics.issues = ["OpenClaw device access is waiting for operator-scope approval."];

  const projection = presentOperatorRuntime(snapshot, { connectionState: "live", now: NOW });

  assert.equal(projection.primaryRecovery?.id, "gateway-permissions");
  assert.equal(projection.primaryRecovery?.href, "/settings#gateway");
});

test("unknown compatibility remains unknown instead of becoming available", () => {
  const projection = presentOperatorRuntime(makeSnapshot({ compatibility: "unknown" }), { connectionState: "live", now: NOW });

  assert.equal(projection.state, "unknown");
  assert.equal(projection.compatibility.state, "unknown");
  assert.equal(projection.primaryRecovery?.id, "compatibility");
});

test("an empty Runtime Inbox does not erase degraded capability truth", () => {
  const projection = presentOperatorRuntime(makeSnapshot({ rpcOk: false, health: "degraded", gatewayMode: "degraded", compatibility: "degraded" }), {
    connectionState: "live",
    now: NOW
  });

  assert.equal(projection.attention.actionableCount, 0);
  assert.equal(projection.state, "degraded");
});

test("stale snapshots are visibly degraded and marked stale", () => {
  const projection = presentOperatorRuntime(makeSnapshot({ generatedAt: new Date(NOW - 31_000).toISOString() }), {
    connectionState: "live",
    now: NOW
  });

  assert.equal(projection.state, "degraded");
  assert.equal(projection.freshness.state, "stale");
  assert.equal(projection.freshness.stale, true);
});

test("scope projection distinguishes selected workspaces from global state", () => {
  const snapshot = makeSnapshot();
  snapshot.workspaces = [{ id: "workspace-a", name: "House of Works" } as typeof snapshot.workspaces[number]];

  const selected = presentOperatorRuntime(snapshot, {
    connectionState: "live",
    now: NOW,
    scope: { workspaceId: "workspace-a", workspaceName: "House of Works" }
  });
  const global = presentOperatorRuntime(snapshot, {
    connectionState: "live",
    now: NOW,
    scope: { workspaceId: null }
  });

  assert.deepEqual(selected.scope, {
    kind: "workspace",
    workspaceId: "workspace-a",
    label: "House of Works",
    detail: "Workspace scope"
  });
  assert.equal(global.scope.kind, "global");
  assert.equal(global.scope.label, "All workspaces");
});
