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

test("informational update availability fallback preserves native READY truth", () => {
  const snapshot = makeSnapshot();
  const fallback = {
    at: new Date(NOW).toISOString(),
    operation: "update.status",
    issue: "OpenClaw Gateway update.status did not include update availability details.",
    kind: "malformed-response",
    recovery: "Update OpenClaw or report the incompatible Gateway response shape."
  };
  snapshot.diagnostics.transport = {
    ...snapshot.diagnostics.transport!,
    gatewayMode: "fallback-active",
    fallbackCounts: { "update.status": 1 },
    fallbackTotal: 1,
    recentFallbackDiagnostics: [fallback]
  };
  snapshot.diagnostics.gatewayFallbackDiagnostics = [{
    ...fallback,
    operationLabel: "Update Status"
  }];

  const projection = presentOperatorRuntime(snapshot, { connectionState: "live", now: NOW });

  assert.equal(projection.state, "ready");
  assert.equal(projection.authority.mode, "native-gateway");
  assert.equal(projection.fallback.active, true);
  assert.equal(projection.fallback.informationalOperationCount, 1);
  assert.equal(projection.fallback.degradedOperationCount, 0);
});

test("core operation CLI fallback stays degraded with explicit fallback authority", () => {
  const snapshot = makeSnapshot({ health: "degraded", gatewayMode: "fallback-active" });
  const fallback = {
    at: new Date(NOW).toISOString(),
    operation: "chat.send",
    issue: "unknown method: chat.send",
    kind: "unsupported",
    recovery: "Update OpenClaw to enable native chat dispatch."
  };
  snapshot.diagnostics.transport!.recentFallbackDiagnostics = [fallback];
  snapshot.diagnostics.gatewayFallbackDiagnostics = [{
    ...fallback,
    operationLabel: "Chat Send"
  }];

  const projection = presentOperatorRuntime(snapshot, { connectionState: "live", now: NOW });

  assert.equal(projection.state, "degraded");
  assert.equal(projection.authority.mode, "cli-fallback");
  assert.equal(projection.fallback.degradedOperationCount, 1);
});

test("a disabled required native capability prevents READY", () => {
  const snapshot = makeSnapshot();
  snapshot.diagnostics.capabilityMatrix = {
    ...snapshot.diagnostics.capabilityMatrix!,
    operations: {
      chat: {
        label: "Mission dispatch",
        mode: "disabled",
        methods: ["chat.send"],
        events: [],
        fallbackAllowed: false,
        baseline: "required",
        reason: "OpenClaw does not expose the required native dispatch method."
      }
    }
  } as NonNullable<MissionControlSnapshot["diagnostics"]["capabilityMatrix"]>;

  const projection = presentOperatorRuntime(snapshot, { connectionState: "live", now: NOW });

  assert.equal(projection.state, "degraded");
  assert.equal(projection.compatibility.state, "degraded");
  assert.equal(projection.authority.mode, "native-gateway");
});

test("a compatible report cannot hide a lost required native capability", () => {
  const snapshot = makeSnapshot();
  snapshot.diagnostics.compatibilityReport = {
    status: "compatible",
    summary: { nativeGatewayCoveragePercent: 100 },
    contracts: [],
    fallback: { diagnostics: [] }
  } as unknown as NonNullable<MissionControlSnapshot["diagnostics"]["compatibilityReport"]>;
  snapshot.diagnostics.capabilityMatrix = {
    ...snapshot.diagnostics.capabilityMatrix!,
    operations: {
      chat: {
        label: "Mission dispatch",
        mode: "disabled",
        methods: ["chat.send"],
        events: [],
        fallbackAllowed: false,
        baseline: "required",
        reason: "OpenClaw does not expose the required native dispatch method."
      }
    }
  } as NonNullable<MissionControlSnapshot["diagnostics"]["capabilityMatrix"]>;

  const projection = presentOperatorRuntime(snapshot, { connectionState: "live", now: NOW });

  assert.equal(projection.state, "degraded");
  assert.equal(projection.compatibility.state, "degraded");
});

test("auth fallback blocks runtime readiness and points to Gateway permissions", () => {
  const snapshot = makeSnapshot({ health: "degraded", gatewayMode: "fallback-active" });
  const fallback = {
    at: new Date(NOW).toISOString(),
    operation: "update.status",
    issue: "Gateway rejected the operator token.",
    kind: "auth",
    recovery: "Repair local Gateway access."
  };
  snapshot.diagnostics.transport!.recentFallbackDiagnostics = [fallback];
  snapshot.diagnostics.gatewayFallbackDiagnostics = [{
    ...fallback,
    operationLabel: "Update Status"
  }];

  const projection = presentOperatorRuntime(snapshot, { connectionState: "live", now: NOW });

  assert.equal(projection.state, "blocked");
  assert.equal(projection.attention.actionableCount, 1);
  assert.equal(projection.primaryRecovery?.id, "gateway-permissions");
});

test("connecting and retrying remain transport states even when a snapshot exists", () => {
  const snapshot = makeSnapshot();

  assert.equal(presentOperatorRuntime(snapshot, { connectionState: "connecting", now: NOW }).state, "connecting");
  assert.equal(presentOperatorRuntime(snapshot, { connectionState: "retrying", now: NOW }).transport.state, "retrying");
  assert.match(presentOperatorRuntime(snapshot, { connectionState: "retrying", now: NOW }).freshness.label, /^Reconnecting/);
});

test("Gateway unreachable remains offline even when its issue is actionable", () => {
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

  assert.equal(projection.state, "offline");
  assert.equal(projection.attention.actionableCount, 1);
});

test("a closed Gateway transport is offline", () => {
  const snapshot = makeSnapshot({ rpcOk: false, health: "degraded", gatewayMode: "degraded" });
  snapshot.diagnostics.transport!.connectionState = "closed";

  const projection = presentOperatorRuntime(snapshot, { connectionState: "live", now: NOW });

  assert.equal(projection.state, "offline");
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
  assert.equal(projection.state, "blocked");
  assert.equal(projection.attention.actionableCount, 1);
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
