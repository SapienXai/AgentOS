import assert from "node:assert/strict";
import { test } from "node:test";

import { AGENTOS_OPENCLAW_CONTRACT } from "@/lib/openclaw/contracts/agentos-openclaw-contract";
import { probeAgentOsOpenClawContract } from "@/lib/openclaw/contracts/contract-probe-service";
import { checkOpenClawCompatibilityContracts } from "@/lib/openclaw/compat/contracts";
import {
  buildOpenClawCompatibilityReport
} from "@/lib/openclaw/compat/report";
import type {
  OpenClawCompatibilityContractCheck,
  OpenClawCompatibilityReport
} from "@/lib/openclaw/compat/types";
import type { GatewayDiagnostics } from "@/lib/openclaw/types";

test("certified-version expectations remain visible without becoming native success", async () => {
  const checks = await checkOpenClawCompatibilityContracts({
    effectiveMethods: ["models.list"],
    advertisedMethods: [],
    effectiveEvents: [],
    advertisedEvents: [],
    authScopes: ["operator.read"],
    capabilitySource: "version-default",
    cliFallbackAvailable: true,
    cliForced: false,
    includeLiveShapeChecks: false
  });
  const models = checks.find((check) => check.operation === "models");

  assert.equal(models?.expectedMethod, "models.list");
  assert.equal(models?.supportedMethod, null);
  assert.equal(models?.nativeGatewaySupported, false);
  assert.equal(models?.status, "degraded");
  assert.equal(models?.epistemicStatus, "certified-version-expectation");
  assert.equal(models?.fallbackStatus, "available");
  assert.equal(models?.fallbackUsed, false);

  const report = buildReport(
    checks.filter((check) => check.operation === "models"),
    "version-default"
  );
  assert.equal(report.status, "degraded");
  assert.equal(report.summary.nativeGatewayCoveragePercent, 0);
});

test("advertised support and observed native success are distinct evidence states", async () => {
  const advertisedOnly = await checkOpenClawCompatibilityContracts({
    effectiveMethods: ["models.list"],
    advertisedMethods: ["models.list"],
    effectiveEvents: [],
    advertisedEvents: [],
    authScopes: ["operator.read"],
    capabilitySource: "gateway-advertised",
    cliFallbackAvailable: true,
    cliForced: false,
    includeLiveShapeChecks: false
  });
  const advertised = advertisedOnly.find((check) => check.operation === "models");
  assert.equal(advertised?.nativeGatewaySupported, true);
  assert.equal(advertised?.status, "ok");
  assert.equal(advertised?.epistemicStatus, "advertised-method");

  const observed = await checkOpenClawCompatibilityContracts({
    effectiveMethods: ["models.list"],
    advertisedMethods: ["models.list"],
    effectiveEvents: [],
    advertisedEvents: [],
    authScopes: ["operator.read"],
    capabilitySource: "gateway-advertised",
    cliFallbackAvailable: true,
    cliForced: false,
    includeLiveShapeChecks: true,
    callNative: async () => ({ models: [] })
  });
  const observedModels = observed.find((check) => check.operation === "models");
  assert.equal(observedModels?.nativeGatewaySupported, true);
  assert.equal(observedModels?.epistemicStatus, "observed-native-success");
  assert.equal(observedModels?.responseShapeStatus, "valid");
});

test("required and optional capability failures retain their distinct statuses", async () => {
  const denied = await checkOpenClawCompatibilityContracts({
    effectiveMethods: ["exec.approval.list"],
    advertisedMethods: ["exec.approval.list"],
    effectiveEvents: [],
    advertisedEvents: [],
    authScopes: ["operator.read"],
    capabilitySource: "gateway-advertised",
    cliFallbackAvailable: true,
    cliForced: false,
    includeLiveShapeChecks: false
  });
  const approvals = denied.find((check) => check.operation === "execApprovals");
  assert.equal(approvals?.epistemicStatus, "auth-denied");
  assert.equal(approvals?.status, "degraded");
  assert.equal(approvals?.nativeGatewaySupported, false);

  const unsupported = await checkOpenClawCompatibilityContracts({
    effectiveMethods: [],
    advertisedMethods: [],
    effectiveEvents: [],
    advertisedEvents: [],
    authScopes: [],
    capabilitySource: "gateway-advertised",
    cliFallbackAvailable: true,
    cliForced: false,
    includeLiveShapeChecks: false
  });
  const taskAssignment = unsupported.find((check) => check.operation === "taskAssign");
  assert.equal(taskAssignment?.epistemicStatus, "unsupported");
  assert.equal(taskAssignment?.status, "unsupported");
  assert.equal(taskAssignment?.fallbackStatus, "not-allowed");

  const optionalAbsence = await checkOpenClawCompatibilityContracts({
    effectiveMethods: ["tasks.list", "tasks.history"],
    advertisedMethods: ["tasks.list"],
    effectiveEvents: [],
    advertisedEvents: [],
    authScopes: ["operator.read"],
    capabilitySource: "gateway-discovery",
    cliFallbackAvailable: true,
    cliForced: false,
    includeLiveShapeChecks: false
  });
  const taskHistory = optionalAbsence.find((check) => check.operation === "taskHistory");
  assert.equal(taskHistory?.epistemicStatus, "optional-absence");
  assert.equal(taskHistory?.status, "degraded");
  assert.equal(taskHistory?.nativeGatewaySupported, false);
  assert.equal(taskHistory?.fallbackStatus, "not-allowed");
});

test("unreachable and protocol-mismatched Gateway evidence cannot pass a required check", async () => {
  const unreachable = await checkOpenClawCompatibilityContracts({
    effectiveMethods: ["models.list"],
    advertisedMethods: ["models.list"],
    effectiveEvents: [],
    advertisedEvents: [],
    authScopes: ["operator.read"],
    capabilitySource: "gateway-advertised",
    cliFallbackAvailable: true,
    cliForced: false,
    includeLiveShapeChecks: false,
    gatewayHealth: "unreachable"
  });
  const unreachableModels = unreachable.find((check) => check.operation === "models");
  assert.equal(unreachableModels?.epistemicStatus, "unreachable");
  assert.equal(unreachableModels?.nativeGatewaySupported, false);
  assert.equal(unreachableModels?.status, "degraded");
  assert.equal(unreachableModels?.suggestedRecovery, "Restore the OpenClaw Gateway connection and retry.");

  const protocolMismatch = await checkOpenClawCompatibilityContracts({
    effectiveMethods: ["models.list"],
    advertisedMethods: ["models.list"],
    effectiveEvents: [],
    advertisedEvents: [],
    authScopes: ["operator.read"],
    capabilitySource: "gateway-advertised",
    cliFallbackAvailable: true,
    cliForced: false,
    includeLiveShapeChecks: false,
    protocolStatus: "unsupported"
  });
  const mismatchedModels = protocolMismatch.find((check) => check.operation === "models");
  assert.equal(mismatchedModels?.epistemicStatus, "protocol-mismatch");
  assert.equal(mismatchedModels?.nativeGatewaySupported, false);
  assert.equal(mismatchedModels?.status, "degraded");

  const report = buildReport(protocolMismatch, "gateway-advertised", "unsupported");
  assert.equal(report.status, "incompatible");
});

test("fallback availability is not reported as fallback activation", async () => {
  const available = await checkOpenClawCompatibilityContracts({
    effectiveMethods: ["models.list"],
    advertisedMethods: ["models.list"],
    effectiveEvents: [],
    advertisedEvents: [],
    authScopes: ["operator.read"],
    capabilitySource: "gateway-advertised",
    cliFallbackAvailable: true,
    cliForced: false,
    includeLiveShapeChecks: false,
    fallbackCounts: {}
  });
  const availableModels = available.find((check) => check.operation === "models");
  assert.equal(availableModels?.fallbackStatus, "available");
  assert.equal(availableModels?.fallbackUsed, false);

  const used = await checkOpenClawCompatibilityContracts({
    effectiveMethods: ["models.list"],
    advertisedMethods: ["models.list"],
    effectiveEvents: [],
    advertisedEvents: [],
    authScopes: ["operator.read"],
    capabilitySource: "gateway-advertised",
    cliFallbackAvailable: true,
    cliForced: false,
    includeLiveShapeChecks: false,
    fallbackCounts: { "models.list": 1 }
  });
  const usedModels = used.find((check) => check.operation === "models");
  assert.equal(usedModels?.fallbackStatus, "used");
  assert.equal(usedModels?.fallbackUsed, true);
  assert.equal(usedModels?.nativeGatewaySupported, true);
});

test("contract probe does not pass a version-default expectation", async () => {
  const checks = await checkOpenClawCompatibilityContracts({
    effectiveMethods: ["health", "status"],
    advertisedMethods: [],
    effectiveEvents: [],
    advertisedEvents: [],
    authScopes: ["operator.read"],
    capabilitySource: "version-default",
    cliFallbackAvailable: true,
    cliForced: false,
    includeLiveShapeChecks: false
  });
  const diagnostics = {
    compatibilityReport: { contracts: checks }
  } as unknown as GatewayDiagnostics;
  const result = probeAgentOsOpenClawContract({
    contract: AGENTOS_OPENCLAW_CONTRACT,
    diagnostics
  });
  const health = result.operations.find((operation) => operation.operationId === "health");

  assert.equal(health?.status, "warning");
  assert.equal(health?.actual.cliFallbackUsed, false);
  assert.equal(result.summary.passed, 0);
});

test("the native plugin catalog never receives CLI fallback permission", async () => {
  const checks = await checkOpenClawCompatibilityContracts({
    effectiveMethods: ["plugins.catalog.browse", "plugins.catalog.categories", "plugins.catalog.get"],
    advertisedMethods: ["plugins.catalog.browse", "plugins.catalog.categories", "plugins.catalog.get"],
    effectiveEvents: [],
    advertisedEvents: [],
    authScopes: ["operator.read"],
    capabilitySource: "gateway-advertised",
    cliFallbackAvailable: true,
    cliForced: false,
    includeLiveShapeChecks: false
  });
  const catalog = checks.find((check) => check.operation === "pluginCatalog");

  assert.equal(catalog?.nativeGatewaySupported, true);
  assert.equal(catalog?.cliFallbackAvailable, false);
  assert.equal(catalog?.fallbackStatus, "not-allowed");
  assert.equal(catalog?.fallbackUsed, false);
});

function buildReport(
  contracts: OpenClawCompatibilityContractCheck[],
  capabilitySource: OpenClawCompatibilityReport["gateway"]["capabilitySource"],
  protocolStatus: OpenClawCompatibilityReport["gateway"]["protocolStatus"] = "compatible"
) {
  return buildOpenClawCompatibilityReport({
    target: {
      name: "real-local",
      kind: "real",
      label: "Real local test runtime",
      runtimeStartedBy: "external",
      isRealRuntime: true,
      isSimulatedRuntime: false
    },
    generatedAt: "2026-09-13T00:00:00.000Z",
    installedVersion: "2026.9.4",
    openClawVersionSource: "detected",
    recommendedVersion: "2026.9.4",
    supportedBaselineVersion: "2026.9.1",
    testedVersions: ["2026.9.4"],
    gatewayHealth: "healthy",
    gatewayHealthReason: "Gateway is ready.",
    protocolVersion: protocolStatus === "unsupported" ? "99" : "4",
    protocolStatus,
    protocolRange: { min: 4, max: 4 },
    authMode: "token",
    authRole: "operator",
    authScopes: ["operator.read"],
    advertisedMethods: [],
    effectiveMethods: [],
    advertisedEvents: [],
    effectiveEvents: [],
    capabilitySource,
    cliAvailable: true,
    cliForced: false,
    capabilities: [],
    contracts,
    diagnostics: []
  });
}
