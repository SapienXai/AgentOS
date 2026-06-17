import type { OpenClawCompatibilityLabReport } from "@/lib/openclaw/compatibility-lab/types";
import type { GatewayDiagnostics, OpenClawCapabilityDiffReport } from "@/lib/openclaw/types";
import type {
  AgentOsOpenClawContract,
  AgentOsOpenClawContractOperation,
  AgentOsOpenClawContractOperationStatus,
  AgentOsOpenClawContractProbeOperationResult,
  AgentOsOpenClawContractProbeResult
} from "@/lib/openclaw/contracts/types";

export function probeAgentOsOpenClawContract(input: {
  contract: AgentOsOpenClawContract;
  diagnostics?: GatewayDiagnostics | null;
  targetVersion?: string | null;
  capabilityDiff?: OpenClawCapabilityDiffReport | null;
  labReport?: OpenClawCompatibilityLabReport | null;
  evidenceLabel?: string;
  generatedAt?: Date;
}): AgentOsOpenClawContractProbeResult {
  const operations = input.contract.operations.map((operation) =>
    probeOperation({
      operation,
      diagnostics: input.diagnostics ?? null,
      capabilityDiff: input.capabilityDiff ?? null,
      labReport: input.labReport ?? null
    })
  );
  const summary = {
    passed: operations.filter((operation) => operation.status === "passed").length,
    warnings: operations.filter((operation) => operation.status === "warning").length,
    failed: operations.filter((operation) => operation.status === "failed").length,
    unknown: operations.filter((operation) => operation.status === "unknown").length,
    certificationBlockers: operations.filter((operation) => operation.blocksCertification && operation.status === "failed").length
  };

  return {
    schemaVersion: 1,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    baselineOpenClawVersion: input.contract.certifiedOpenClawBaseline,
    targetOpenClawVersion:
      input.targetVersion ??
      input.diagnostics?.version ??
      input.diagnostics?.capabilityMatrix?.openClawVersion ??
      input.diagnostics?.compatibilityReport?.openClaw.installedVersion ??
      null,
    evidenceLabel: input.evidenceLabel ?? "Installed evidence",
    status: resolveProbeStatus(summary),
    operations,
    summary
  };
}

function probeOperation(input: {
  operation: AgentOsOpenClawContractOperation;
  diagnostics: GatewayDiagnostics | null;
  capabilityDiff: OpenClawCapabilityDiffReport | null;
  labReport: OpenClawCompatibilityLabReport | null;
}): AgentOsOpenClawContractProbeOperationResult {
  const capabilityOperation = input.diagnostics?.capabilityMatrix?.operations?.[input.operation.id];
  const contractCheck = input.diagnostics?.compatibilityReport?.contracts.find((check) =>
    check.operation === input.operation.id
  );
  const diffRow = input.capabilityDiff?.rows.find((row) => row.operationId === input.operation.id);
  const labArea = input.labReport?.areas.find((area) => area.id === input.operation.areaId);
  const supportedMethod =
    capabilityOperation?.supportedMethod ??
    contractCheck?.supportedMethod ??
    diffRow?.supportedMethod ??
    null;
  const supportedEvent = contractCheck?.supportedEvent ?? null;
  const mode =
    diffRow?.targetMode ??
    capabilityOperation?.mode ??
    (contractCheck
      ? contractCheck.nativeGatewaySupported
        ? "gateway-native"
        : contractCheck.cliFallbackAvailable
          ? "cli-fallback"
          : contractCheck.status
      : "unknown");
  const payloadShapeStatus = contractCheck?.responseShapeStatus ?? null;
  const cliFallbackUsed =
    mode === "cli-fallback" ||
    Boolean(diffRow && diffRow.certifiedMode !== "cli-fallback" && diffRow.targetMode === "cli-fallback");
  const hasPayloadShapeChange =
    payloadShapeStatus === "invalid" ||
    Boolean(labArea?.id === "payload-shapes" && labArea.status !== "passed");
  const status = resolveOperationStatus({
    operation: input.operation,
    mode,
    supportedMethod,
    supportedEvent,
    payloadShapeStatus,
    diffSeverity: diffRow?.severity ?? null,
    labAreaStatus: labArea?.status ?? null,
    diagnosticsAvailable: Boolean(input.diagnostics?.capabilityMatrix || input.diagnostics?.compatibilityReport)
  });
  const blocksCertification = input.operation.blocksCertification && status === "failed";

  return {
    operationId: input.operation.id,
    label: input.operation.label,
    areaId: input.operation.areaId,
    requirement: input.operation.requirement,
    status,
    expected: {
      gatewayMethods: input.operation.gatewayMethods,
      eventNames: input.operation.eventNames,
      payloadShape: input.operation.expectedPayloadShape ?? null,
      cliFallbackAllowed: input.operation.cliFallbackAllowed
    },
    actual: {
      supportedMethod,
      supportedEvent,
      mode,
      payloadShapeStatus,
      cliFallbackUsed,
      cliFallbackAvailable: Boolean(contractCheck?.cliFallbackAvailable || capabilityOperation?.fallbackAllowed)
    },
    evidence: [
      capabilityOperation?.reason,
      contractCheck?.reason,
      diffRow?.targetReason,
      labArea?.evidence[0],
      hasPayloadShapeChange ? "Payload shape evidence changed or failed." : null
    ].filter((entry): entry is string => Boolean(entry)),
    affectedAgentOsFiles: input.operation.affectedAgentOsFiles,
    regressionTests: input.operation.regressionTests,
    blocksCertification
  };
}

function resolveOperationStatus(input: {
  operation: AgentOsOpenClawContractOperation;
  mode: string;
  supportedMethod: string | null;
  supportedEvent: string | null;
  payloadShapeStatus: string | null;
  diffSeverity: string | null;
  labAreaStatus: AgentOsOpenClawContractOperationStatus | null;
  diagnosticsAvailable: boolean;
}): AgentOsOpenClawContractOperationStatus {
  if (!input.diagnosticsAvailable) {
    return "unknown";
  }

  if (input.payloadShapeStatus === "invalid" || input.diffSeverity === "regression") {
    return input.operation.requirement === "required" || input.operation.blocksCertification ? "failed" : "warning";
  }

  if (input.labAreaStatus === "failed") {
    return input.operation.blocksCertification ? "failed" : "warning";
  }

  if (input.mode === "gateway-native" || input.mode === "ok") {
    return "passed";
  }

  if (input.supportedMethod || input.supportedEvent) {
    return "passed";
  }

  if (input.mode === "cli-fallback" || input.mode === "degraded") {
    return input.operation.requirement === "required" && !input.operation.cliFallbackAllowed ? "failed" : "warning";
  }

  if (input.mode === "disabled" || input.mode === "missing" || input.mode === "unsupported") {
    return input.operation.requirement === "required" || input.operation.blocksCertification ? "failed" : "warning";
  }

  return "unknown";
}

function resolveProbeStatus(summary: AgentOsOpenClawContractProbeResult["summary"]) {
  if (summary.failed > 0) {
    return "failed";
  }

  if (summary.warnings > 0) {
    return "warning";
  }

  if (summary.unknown > 0) {
    return "unknown";
  }

  return "passed";
}
