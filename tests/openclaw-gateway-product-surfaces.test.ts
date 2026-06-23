import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { getOpenClawGatewayProductSurfaceSnapshot } from "@/lib/openclaw/application/gateway-surface-service";
import {
  OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS,
  type OpenClawGatewayCompatibilityOperationDefinition
} from "@/lib/openclaw/client/gateway-compatibility";
import { setOpenClawGatewayClientForTesting } from "@/lib/openclaw/client/gateway-client-factory";
import type { OpenClawGatewayClient } from "@/lib/openclaw/client/types";
import type {
  OpenClawCompatibilityContractCheck,
  OpenClawCompatibilityReport
} from "@/lib/openclaw/compat/types";

describe("OpenClaw Gateway product surfaces", () => {
  afterEach(() => {
    setOpenClawGatewayClientForTesting(null);
    delete process.env.AGENTOS_OPENCLAW_GATEWAY_CLIENT;
    delete process.env.OPENCLAW_GATEWAY_CLIENT;
  });

  it("probes OpenClaw 2026.6.8 product surfaces through native Gateway without CLI fallback", async () => {
    const nativeCalls: string[] = [];
    const cliCalls: string[] = [];
    setOpenClawGatewayClientForTesting(buildFakeClient({
      callNative: async (method) => {
        nativeCalls.push(method);
        return fakePayloadForMethod(method);
      },
      call: async (method) => {
        cliCalls.push(method);
        throw new Error(`Unexpected CLI fallback for ${method}`);
      }
    }));

    const snapshot = await getOpenClawGatewayProductSurfaceSnapshot({
      compatibilityReport: buildReport({
        contracts: OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS.map(buildOkContract)
      }),
      includeProbes: true,
      now: () => new Date("2026-06-23T12:00:00.000Z")
    });

    assert.equal(snapshot.isRealRuntime, true);
    assert.equal(snapshot.capabilitySource, "gateway-advertised");
    assert.equal(cliCalls.length, 0);
    assert.ok(nativeCalls.includes("usage.status"));
    assert.ok(nativeCalls.includes("doctor.memory.status"));
    assert.ok(nativeCalls.includes("talk.catalog"));
    assert.ok(nativeCalls.includes("tts.status"));
    assert.ok(nativeCalls.includes("node.list"));

    const usage = snapshot.surfaces.find((surface) => surface.id === "usage-cost");
    assert.equal(usage?.status, "native");
    assert.ok((usage?.probes ?? []).every((probe) => probe.status === "passed"));
  });

  it("keeps version-default compatibility degraded instead of presenting stale data as real certification", async () => {
    setOpenClawGatewayClientForTesting(buildFakeClient({
      callNative: async (method) => fakePayloadForMethod(method)
    }));

    const snapshot = await getOpenClawGatewayProductSurfaceSnapshot({
      compatibilityReport: buildReport({
        isRealRuntime: false,
        isSimulatedRuntime: true,
        capabilitySource: "version-default",
        contracts: OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS.map((operation) => ({
          ...buildOkContract(operation),
          nativeGatewaySupported: false,
          status: "degraded",
          reason: `${operation.label} matches the version-default expectation but live Gateway metadata was not advertised.`,
          suggestedRecovery: "Refresh compatibility against a live OpenClaw Gateway runtime."
        }))
      }),
      includeProbes: false
    });

    assert.equal(snapshot.isRealRuntime, false);
    assert.equal(snapshot.isSimulatedRuntime, true);
    assert.equal(snapshot.capabilitySource, "version-default");
    assert.notEqual(snapshot.surfaces.find((surface) => surface.id === "sessions-chat")?.status, "native");
  });

  it("reports native probe failures as degraded and does not silently call CLI fallback", async () => {
    const cliCalls: string[] = [];
    setOpenClawGatewayClientForTesting(buildFakeClient({
      callNative: async (method) => {
        if (method === "usage.status") {
          throw new Error("usage.status unavailable at /Users/kazimakgul/.openclaw token=secret-value");
        }

        return fakePayloadForMethod(method);
      },
      call: async (method) => {
        cliCalls.push(method);
        throw new Error(`Unexpected CLI fallback for ${method}`);
      }
    }));

    const snapshot = await getOpenClawGatewayProductSurfaceSnapshot({
      compatibilityReport: buildReport({
        contracts: OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS.map(buildOkContract)
      }),
      includeProbes: true
    });
    const usage = snapshot.surfaces.find((surface) => surface.id === "usage-cost");

    assert.equal(cliCalls.length, 0);
    assert.equal(usage?.status, "degraded");
    const failedProbe = usage?.probes.find((probe) => probe.method === "usage.status");
    assert.equal(failedProbe?.status, "failed");
    assert.match(failedProbe?.error ?? "", /\/Users\/\[redacted\]/);
    assert.doesNotMatch(failedProbe?.error ?? "", /secret-value|kazimakgul/);
  });
});

function buildFakeClient(input: {
  callNative?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  call?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
}) {
  return {
    callNative: input.callNative,
    call: input.call ?? (async () => ({})),
    close: () => {}
  } as unknown as OpenClawGatewayClient;
}

function buildReport(input: {
  contracts: OpenClawCompatibilityContractCheck[];
  isRealRuntime?: boolean;
  isSimulatedRuntime?: boolean;
  capabilitySource?: OpenClawCompatibilityReport["gateway"]["capabilitySource"];
}): OpenClawCompatibilityReport {
  const nativeCount = input.contracts.filter((contract) => contract.nativeGatewaySupported).length;
  const totalCount = input.contracts.length;

  return {
    generatedAt: "2026-06-23T12:00:00.000Z",
    target: {
      name: input.isSimulatedRuntime ? "simulated-stable" : "real-local",
      kind: input.isSimulatedRuntime ? "simulated" : "real",
      label: input.isSimulatedRuntime ? "Simulated stable" : "Real local",
      runtimeStartedBy: "external",
      isRealRuntime: input.isRealRuntime ?? true,
      isSimulatedRuntime: input.isSimulatedRuntime ?? false
    },
    targetName: input.isSimulatedRuntime ? "simulated-stable" : "real-local",
    targetKind: input.isSimulatedRuntime ? "simulated" : "real",
    targetAliasUsed: null,
    gatewayUrl: "ws://127.0.0.1:17861",
    openClawVersionSource: "detected",
    runtimeStartedBy: "external",
    isRealRuntime: input.isRealRuntime ?? true,
    isSimulatedRuntime: input.isSimulatedRuntime ?? false,
    status: "compatible",
    statusReason: "Test report.",
    recovery: "No recovery action required.",
    openClaw: {
      installedVersion: "2026.6.8",
      versionSource: "detected",
      recommendedVersion: "2026.6.8",
      supportedBaselineVersion: "2026.6.8",
      testedVersions: ["2026.6.8"]
    },
    gateway: {
      health: "healthy",
      healthReason: "Gateway ready.",
      protocolVersion: "4",
      protocolStatus: "compatible",
      protocolRange: { min: 4, max: 4 },
      authMode: "token",
      authRole: "operator",
      authScopes: ["operator.read", "operator.write", "operator.admin", "operator.approvals", "operator.pairing"],
      capabilitySource: input.capabilitySource ?? "gateway-advertised",
      advertisedMethodCount: 100,
      effectiveMethodCount: 100,
      advertisedEventCount: 8
    },
    fallback: {
      cliAvailable: true,
      cliForced: false,
      operationCount: 0,
      activeFallbackCount: 0,
      diagnostics: []
    },
    capabilities: [],
    contracts: input.contracts,
    summary: {
      nativeGatewayCoveragePercent: Math.round((nativeCount / Math.max(1, totalCount)) * 100),
      nativeGatewayCoverageLabel: `${nativeCount}/${totalCount} operations`,
      cliFallbackOperationCount: input.contracts.filter((contract) => contract.cliFallbackAvailable).length,
      activeCliFallbackCount: 0,
      degradedSurfaces: [],
      unsupportedSurfaces: [],
      failedSurfaces: [],
      supportedOpenClawVersion: "2026.6.8",
      testedOpenClawVersions: ["2026.6.8"],
      unsupportedOperationCount: input.contracts.filter((contract) => contract.status === "unsupported").length,
      degradedOperationCount: input.contracts.filter((contract) => contract.status === "degraded").length,
      failedOperationCount: input.contracts.filter((contract) => contract.status === "failed").length,
      targetName: input.isSimulatedRuntime ? "simulated-stable" : "real-local",
      targetKind: input.isSimulatedRuntime ? "simulated" : "real",
      isRealRuntime: input.isRealRuntime ?? true,
      isSimulatedRuntime: input.isSimulatedRuntime ?? false
    },
    diagnostics: []
  };
}

function buildOkContract(operation: OpenClawGatewayCompatibilityOperationDefinition): OpenClawCompatibilityContractCheck {
  const supportedMethod = operation.methods[0] ?? null;

  return {
    operation: operation.id,
    label: operation.label,
    surface: "gatewayHealth",
    required: operation.baseline === "required",
    baseline: operation.baseline ?? "optional",
    methods: operation.methods,
    events: operation.events ?? [],
    supportedMethod,
    supportedEvent: null,
    requiredScopes: [],
    missingScopes: [],
    nativeGatewaySupported: true,
    cliFallbackAvailable: operation.fallbackAllowed !== false,
    responseShapeStatus: "valid",
    responseShapeValid: true,
    status: "ok",
    reason: `${operation.label} is native through ${supportedMethod ?? "Gateway events"}.`,
    suggestedRecovery: "No recovery action required."
  };
}

function fakePayloadForMethod(method: string) {
  if (method.endsWith(".list") || method === "models.list") {
    return {
      [method.split(".")[0] === "models" ? "models" : "items"]: []
    };
  }

  if (method === "tasks.list") {
    return { tasks: [] };
  }

  if (method === "sessions.list" || method === "sessions.preview") {
    return { sessions: [] };
  }

  if (method === "commands.list") {
    return { commands: [] };
  }

  if (method === "tools.catalog" || method === "tools.effective") {
    return { tools: [] };
  }

  if (method === "cron.list") {
    return { jobs: [] };
  }

  if (method === "cron.runs") {
    return { runs: [] };
  }

  if (method === "plugins.list") {
    return { plugins: [] };
  }

  if (method === "skills.status") {
    return { skills: [] };
  }

  if (method === "node.list") {
    return { nodes: [] };
  }

  if (method === "environments.list") {
    return { environments: [] };
  }

  return { ok: true, method };
}
