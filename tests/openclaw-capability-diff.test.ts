import assert from "node:assert/strict";
import { test } from "node:test";

import { buildOpenClawCapabilityDiffReport } from "@/lib/openclaw/capability-diff";
import type { GatewayDiagnostics } from "@/lib/openclaw/types";

function createDiagnostics(input: Partial<GatewayDiagnostics> = {}): GatewayDiagnostics {
  const diagnostics = {
    installed: true,
    loaded: true,
    rpcOk: true,
    health: "ok",
    version: "2026.6.1",
    latestVersion: "2026.6.1",
    workspaceRoot: "/tmp/workspace",
    configuredWorkspaceRoot: null,
    dashboardUrl: "http://127.0.0.1:3000",
    gatewayUrl: "ws://127.0.0.1:18789",
    configuredGatewayUrl: null,
    openClawBinarySelection: {
      mode: "auto",
      configuredPath: null,
      resolvedPath: "/Users/test/.openclaw/bin/openclaw",
      source: "auto",
      error: null
    },
    modelReadiness: {
      ready: true,
      defaultModel: "openai/gpt-5.4-mini",
      resolvedDefaultModel: "openai/gpt-5.4-mini",
      defaultModelReady: true,
      recommendedModelId: "openai/gpt-5.4-mini",
      preferredLoginProvider: "openai",
      totalModelCount: 1,
      availableModelCount: 1,
      localModelCount: 0,
      remoteModelCount: 1,
      missingModelCount: 0,
      authProviders: [],
      issues: []
    },
    configUpdatePacing: {
      settings: {
        mode: "default",
        minimumIntervalMs: 10000,
        updatedAt: null
      },
      cooldownActive: false,
      cooldownUntil: null,
      remainingMs: 0
    },
    runtime: {
      sessions: [],
      activeCount: 0,
      totalCount: 0,
      generatedAt: "2026-06-15T08:00:00.000Z",
      source: "gateway",
      issues: []
    },
    runtimeIssues: [],
    securityWarnings: [],
    issues: [],
    capabilityMatrix: {
      detectedAt: "2026-06-15T08:00:00.000Z",
      openClawVersion: "2026.6.1",
      gatewayProtocolVersion: "4",
      authMode: "native",
      supportedMethods: ["sessions.list", "config.patch"],
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
        sessions: {
          label: "Sessions",
          mode: "gateway-native",
          methods: ["sessions.list"],
          events: [],
          fallbackAllowed: true,
          baseline: "required",
          reason: "Native sessions are available.",
          preferredMethod: "sessions.list",
          supportedMethod: "sessions.list",
          compatibility: "preferred"
        },
        config: {
          label: "Config patch",
          mode: "cli-fallback",
          methods: ["config.patch"],
          events: [],
          fallbackAllowed: true,
          baseline: "required",
          reason: "Config patch falls back to CLI.",
          preferredMethod: "config.patch",
          compatibility: "missing"
        }
      },
      compatibility: {
        protocol: {
          status: "compatible",
          version: "4",
          reason: "Protocol compatible."
        },
        methodContract: {
          status: "verified",
          checkedAt: "2026-06-15T08:00:00.000Z",
          source: "rpc.discover",
          refreshIntervalMs: 60000,
          expectedMethodCount: 2,
          advertisedMethodCount: 2,
          missingMethodCount: 0,
          missingMethods: [],
          missingOperations: [],
          requiredMethodCount: 2,
          missingRequiredMethods: [],
          optionalMethodCount: 0,
          missingOptionalMethods: [],
          experimentalMethodCount: 0,
          missingExperimentalMethods: [],
          reason: "All methods available."
        },
        nativeOperationCount: 1,
        degradedOperationCount: 1,
        unknownOperationCount: 0,
        aliasOperations: [],
        degradedOperations: []
      }
    },
    ...input
  } as unknown as GatewayDiagnostics;

  return diagnostics;
}

test("capability diff reports native improvements and regressions between certified and target", () => {
  const certified = createDiagnostics();
  const target = createDiagnostics({
    version: "2026.6.6",
    capabilityMatrix: {
      ...certified.capabilityMatrix!,
      openClawVersion: "2026.6.6",
      supportedMethods: ["config.patch", "models.scan"],
      operations: {
        sessions: {
          ...certified.capabilityMatrix!.operations!.sessions,
          mode: "cli-fallback",
          reason: "sessions.list is no longer native."
        },
        config: {
          ...certified.capabilityMatrix!.operations!.config,
          mode: "gateway-native",
          supportedMethod: "config.patch",
          compatibility: "preferred",
          reason: "config.patch is now native."
        },
        models: {
          label: "Model scan",
          mode: "gateway-native",
          methods: ["models.scan"],
          events: [],
          fallbackAllowed: false,
          baseline: "optional",
          reason: "models.scan was added.",
          preferredMethod: "models.scan",
          supportedMethod: "models.scan",
          compatibility: "preferred"
        }
      }
    }
  });

  const report = buildOpenClawCapabilityDiffReport({
    certified,
    target,
    generatedAt: new Date("2026-06-15T08:10:00.000Z")
  });

  assert.equal(report.certifiedVersion, "2026.6.1");
  assert.equal(report.targetVersion, "2026.6.6");
  assert.equal(report.summary.nativeImprovements, 2);
  assert.equal(report.summary.nativeRegressions, 1);
  assert.equal(report.summary.fallbackRegressions, 1);
  assert.equal(report.summary.certificationBlockerCount, 1);
  assert.equal(report.rows[0].operationId, "sessions");
  assert.equal(report.rows[0].severity, "regression");
});

test("capability diff flags new missing required methods as certification blockers", () => {
  const certified = createDiagnostics();
  const target = createDiagnostics({
    version: "2026.6.6",
    capabilityMatrix: {
      ...certified.capabilityMatrix!,
      openClawVersion: "2026.6.6",
      operations: {
        config: {
          ...certified.capabilityMatrix!.operations!.config,
          mode: "unknown",
          compatibility: "missing"
        }
      },
      compatibility: {
        ...certified.capabilityMatrix!.compatibility!,
        methodContract: {
          ...certified.capabilityMatrix!.compatibility!.methodContract,
          status: "drift",
          missingMethodCount: 1,
          missingMethods: ["config.patch"],
          missingOperations: ["config: config.patch"],
          missingRequiredMethods: ["config.patch"],
          reason: "config.patch is missing."
        }
      }
    }
  });

  const report = buildOpenClawCapabilityDiffReport({ certified, target });
  const configRow = report.rows.find((row) => row.operationId === "config");

  assert.equal(configRow?.severity, "regression");
  assert.deepEqual(configRow?.missingRequiredMethods, ["config.patch"]);
  assert.equal(report.summary.newMissingRequiredMethods, 1);
  assert.equal(report.summary.certificationBlockerCount, 2);
});
