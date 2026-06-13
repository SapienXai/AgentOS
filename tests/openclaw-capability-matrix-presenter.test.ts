import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildOpenClawCapabilityRows,
  summarizeOpenClawCapabilityRows
} from "@/components/mission-control/settings-control-center.utils";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";

type GatewayDiagnostics = MissionControlSnapshot["diagnostics"];

function createDiagnostics(input: Partial<GatewayDiagnostics> = {}): GatewayDiagnostics {
  return {
    version: "2026.6.1",
    latestVersion: "2026.6.1",
    updateCompatibility: undefined,
    compatibilityReport: null,
    capabilityMatrix: {
      detectedAt: "2026-06-14T10:00:00.000Z",
      openClawVersion: "2026.6.1",
      gatewayProtocolVersion: "4",
      authMode: "native",
      supportedMethods: ["sessions.list"],
      configSchema: "supported",
      configPatch: "supported",
      chatEvents: "supported",
      channels: "supported",
      skills: "supported",
      approvals: "supported",
      updates: "supported",
      nativeMissionDispatch: "supported",
      nativeAgentLifecycle: "supported",
      eventBridge: "supported",
      unsupportedGatewayMethods: [],
      diagnostics: [],
      operations: {
        "sessions.list": {
          label: "List sessions",
          mode: "gateway-native",
          methods: ["sessions.list"],
          events: [],
          fallbackAllowed: true,
          baseline: "required",
          reason: "Gateway advertises sessions.list.",
          preferredMethod: "sessions.list",
          supportedMethod: "sessions.list",
          aliasMethods: [],
          compatibility: "preferred"
        }
      },
      compatibility: {
        protocol: {
          status: "compatible",
          version: "4",
          reason: "Protocol is compatible."
        },
        methodContract: {
          status: "verified",
          checkedAt: "2026-06-14T10:00:00.000Z",
          source: "rpc.discover",
          refreshIntervalMs: 60000,
          expectedMethodCount: 1,
          advertisedMethodCount: 1,
          missingMethodCount: 0,
          missingMethods: [],
          missingOperations: [],
          requiredMethodCount: 1,
          missingRequiredMethods: [],
          optionalMethodCount: 0,
          missingOptionalMethods: [],
          experimentalMethodCount: 0,
          missingExperimentalMethods: [],
          reason: "All expected methods are available."
        },
        nativeOperationCount: 1,
        degradedOperationCount: 0,
        unknownOperationCount: 0,
        aliasOperations: [],
        degradedOperations: []
      }
    },
    transport: {
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
      lastDisconnectedAt: null
    },
    gatewayFallbackDiagnostics: [],
    ...input
  } as GatewayDiagnostics;
}

test("capability matrix presenter marks certified native Gateway operations as native", () => {
  const diagnostics = createDiagnostics();
  const rows = buildOpenClawCapabilityRows(diagnostics);
  const summary = summarizeOpenClawCapabilityRows(diagnostics, rows);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "gateway-native");
  assert.equal(rows[0].methodCoverageLabel, "Native sessions.list");
  assert.equal(summary.openClawVersionLabel, "v2026.6.1");
  assert.equal(summary.nativeOperationCount, 1);
  assert.equal(summary.cliFallbackOperationCount, 0);
});

test("capability matrix presenter surfaces CLI fallback counts and recovery", () => {
  const diagnostics = createDiagnostics({
    capabilityMatrix: {
      ...createDiagnostics().capabilityMatrix!,
      operations: {
        "config.patch": {
          label: "Patch config",
          mode: "cli-fallback",
          methods: ["config.patch"],
          events: [],
          fallbackAllowed: true,
          baseline: "required",
          reason: "Gateway method is unavailable.",
          recovery: "Update OpenClaw.",
          preferredMethod: "config.patch",
          compatibility: "missing"
        }
      }
    },
    transport: {
      ...createDiagnostics().transport!,
      gatewayMode: "fallback-active",
      fallbackCounts: { "config.patch": 3 },
      fallbackTotal: 3,
      recentFallbackDiagnostics: [{
        at: "2026-06-14T10:01:00.000Z",
        operation: "config.patch",
        issue: "unknown method",
        kind: "unsupported",
        recovery: "Update OpenClaw."
      }]
    }
  });
  const rows = buildOpenClawCapabilityRows(diagnostics);
  const row = rows[0];

  assert.equal(row.status, "missing");
  assert.equal(row.fallbackCount, 3);
  assert.equal(row.fallbackIssue, "unknown method");
  assert.equal(row.fallbackRecovery, "Update OpenClaw.");
});

test("capability matrix presenter flags missing required method contract gaps", () => {
  const base = createDiagnostics();
  const diagnostics = createDiagnostics({
    capabilityMatrix: {
      ...base.capabilityMatrix!,
      operations: {
        "models.readiness": {
          label: "Read model readiness",
          mode: "unknown",
          methods: ["models.readiness"],
          events: [],
          fallbackAllowed: false,
          baseline: "required",
          reason: "Gateway contract is incomplete.",
          preferredMethod: "models.readiness",
          compatibility: "missing"
        }
      },
      compatibility: {
        ...base.capabilityMatrix!.compatibility!,
        methodContract: {
          ...base.capabilityMatrix!.compatibility!.methodContract,
          status: "drift",
          missingMethodCount: 1,
          missingMethods: ["models.readiness"],
          missingOperations: ["models.readiness: models.readiness"],
          missingRequiredMethods: ["models.readiness"],
          reason: "Required model readiness method is missing."
        }
      }
    }
  });
  const rows = buildOpenClawCapabilityRows(diagnostics);
  const summary = summarizeOpenClawCapabilityRows(diagnostics, rows);

  assert.equal(rows[0].status, "missing");
  assert.deepEqual(rows[0].missingRequiredMethods, ["models.readiness"]);
  assert.equal(summary.missingRequiredOperationCount, 1);
});

test("capability matrix presenter preserves degraded disabled and unknown states", () => {
  const base = createDiagnostics();
  const diagnostics = createDiagnostics({
    capabilityMatrix: {
      ...base.capabilityMatrix!,
      operations: {
        degraded: {
          label: "Degraded operation",
          mode: "degraded",
          methods: [],
          events: [],
          fallbackAllowed: true,
          reason: "Alias only.",
          compatibility: "alias"
        },
        disabled: {
          label: "Disabled operation",
          mode: "disabled",
          methods: [],
          events: [],
          fallbackAllowed: false,
          reason: "Disabled by OpenClaw."
        },
        unknown: {
          label: "Unknown operation",
          mode: "unknown",
          methods: [],
          events: [],
          fallbackAllowed: false,
          reason: "Not discovered yet."
        }
      }
    }
  });
  const rows = buildOpenClawCapabilityRows(diagnostics);
  const statuses = Object.fromEntries(rows.map((row) => [row.id, row.status]));
  const summary = summarizeOpenClawCapabilityRows(diagnostics, rows);

  assert.equal(statuses.degraded, "degraded");
  assert.equal(statuses.disabled, "disabled");
  assert.equal(statuses.unknown, "unknown");
  assert.equal(summary.unknownOrDegradedOperationCount, 2);
  assert.equal(summary.disabledOperationCount, 1);
});

test("capability matrix presenter falls back to real compatibility contracts when matrix is unavailable", () => {
  const diagnostics = createDiagnostics({
    capabilityMatrix: undefined,
    compatibilityReport: {
      generatedAt: "2026-06-14T10:00:00.000Z",
      target: {
        name: "real-local",
        kind: "real",
        label: "Real local OpenClaw",
        runtimeStartedBy: "external",
        isRealRuntime: true,
        isSimulatedRuntime: false
      },
      targetName: "real-local",
      targetKind: "real",
      targetAliasUsed: null,
      gatewayUrl: "ws://127.0.0.1:18789",
      openClawVersionSource: "detected",
      runtimeStartedBy: "external",
      isRealRuntime: true,
      isSimulatedRuntime: false,
      status: "degraded",
      statusReason: "Gateway has partial native method coverage.",
      recovery: "Update OpenClaw.",
      openClaw: {
        installedVersion: "2026.6.1",
        versionSource: "detected",
        recommendedVersion: "2026.6.1",
        supportedBaselineVersion: "2026.6.1",
        testedVersions: ["2026.6.1"]
      },
      gateway: {
        health: "degraded",
        healthReason: "Gateway is reachable.",
        protocolVersion: "4",
        protocolStatus: "compatible",
        protocolRange: { min: 3, max: 4 },
        authMode: "native",
        authRole: "operator",
        authScopes: ["read"],
        capabilitySource: "gateway-discovery",
        advertisedMethodCount: 1,
        effectiveMethodCount: 1,
        advertisedEventCount: 0
      },
      fallback: {
        cliAvailable: true,
        cliForced: false,
        operationCount: 1,
        activeFallbackCount: 1,
        diagnostics: [{
          at: "2026-06-14T10:01:00.000Z",
          operation: "config.patch",
          issue: "unknown method",
          kind: "unsupported",
          recovery: "Update OpenClaw."
        }]
      },
      capabilities: [],
      contracts: [{
        operation: "config.patch",
        label: "Patch config",
        surface: "config",
        required: true,
        baseline: "required",
        methods: ["config.patch"],
        events: [],
        supportedMethod: null,
        supportedEvent: null,
        requiredScopes: [],
        missingScopes: [],
        nativeGatewaySupported: false,
        cliFallbackAvailable: true,
        responseShapeStatus: "not-checked",
        responseShapeValid: null,
        status: "unsupported",
        reason: "Patch config is not native in the advertised Gateway method set.",
        suggestedRecovery: "Update OpenClaw."
      }],
      summary: {
        nativeGatewayCoveragePercent: 0,
        nativeGatewayCoverageLabel: "0/1 operations",
        cliFallbackOperationCount: 1,
        activeCliFallbackCount: 1,
        degradedSurfaces: ["config"],
        unsupportedSurfaces: ["config"],
        failedSurfaces: [],
        supportedOpenClawVersion: "2026.6.1",
        testedOpenClawVersions: ["2026.6.1"],
        unsupportedOperationCount: 1,
        degradedOperationCount: 0,
        failedOperationCount: 0,
        targetName: "real-local",
        targetKind: "real",
        isRealRuntime: true,
        isSimulatedRuntime: false
      },
      diagnostics: []
    }
  });
  const rows = buildOpenClawCapabilityRows(diagnostics);
  const summary = summarizeOpenClawCapabilityRows(diagnostics, rows);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "config.patch");
  assert.equal(rows[0].status, "missing");
  assert.equal(rows[0].fallbackIssue, "unknown method");
  assert.equal(summary.agentOsCompatibilityLabel, "Degraded");
  assert.equal(summary.totalOperationCount, 1);
});

test("capability matrix presenter does not invent mock rows offline", () => {
  const diagnostics = createDiagnostics({
    version: undefined,
    latestVersion: undefined,
    capabilityMatrix: undefined,
    compatibilityReport: null,
    transport: undefined,
    gatewayFallbackDiagnostics: []
  });
  const rows = buildOpenClawCapabilityRows(diagnostics);
  const summary = summarizeOpenClawCapabilityRows(diagnostics, rows);

  assert.deepEqual(rows, []);
  assert.equal(summary.openClawVersionLabel, "Unknown");
  assert.equal(summary.agentOsCompatibilityLabel, "Unknown");
  assert.equal(summary.totalOperationCount, 0);
});
