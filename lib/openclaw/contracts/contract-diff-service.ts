import type { OpenClawCompatibilityLabReport } from "@/lib/openclaw/compatibility-lab/types";
import type {
  GatewayDiagnostics,
  OpenClawCapabilityDiffReport,
  OpenClawCertificationScorecardReport
} from "@/lib/openclaw/types";
import { getAgentOsOpenClawContractForBaseline } from "@/lib/openclaw/contracts/versioned-contracts";
import { probeAgentOsOpenClawContract } from "@/lib/openclaw/contracts/contract-probe-service";
import type {
  AgentOsOpenClawContractComparisonFilter,
  AgentOsOpenClawContractProbeOperationResult,
  AgentOsOpenClawContractProbeResult
} from "@/lib/openclaw/contracts/types";

export type AgentOsOpenClawContractComparison = {
  baselineVersion: string;
  installedVersion: string | null;
  targetVersion: string | null;
  installedEvidenceLabel: "Baseline active" | "Installed evidence" | "Diff evidence missing";
  targetEvidenceLabel: "Target evidence" | "Report-only, target not executed" | "Evidence missing";
  installed: AgentOsOpenClawContractProbeResult;
  target: AgentOsOpenClawContractProbeResult | null;
  rows: AgentOsOpenClawContractComparisonRow[];
  summary: {
    passed: number;
    warnings: number;
    failed: number;
    unknown: number;
    certificationBlockers: number;
  };
};

export type AgentOsOpenClawContractComparisonRow = AgentOsOpenClawContractProbeOperationResult & {
  baselineExpected: string;
  installedActual: string;
  targetActual: string | null;
  targetStatus: AgentOsOpenClawContractProbeOperationResult["status"] | null;
  hasPayloadShapeChange: boolean;
  usesCliFallback: boolean;
};

export function buildAgentOsOpenClawContractComparison(input: {
  diagnostics: GatewayDiagnostics;
  capabilityDiff?: OpenClawCapabilityDiffReport | null;
  scorecard?: OpenClawCertificationScorecardReport | null;
  labReport?: OpenClawCompatibilityLabReport | null;
}): AgentOsOpenClawContractComparison {
  const baselineVersion =
    input.diagnostics.updateCompatibility?.recommendedVersion ??
    input.diagnostics.compatibilityReport?.openClaw.recommendedVersion ??
    undefined;
  const contract = getAgentOsOpenClawContractForBaseline(baselineVersion);
  const installedVersion =
    input.diagnostics.version ??
    input.diagnostics.capabilityMatrix?.openClawVersion ??
    input.diagnostics.compatibilityReport?.openClaw.installedVersion ??
    null;
  const normalizedBaseline = normalizeVersion(contract.certifiedOpenClawBaseline);
  const normalizedInstalled = normalizeVersion(installedVersion);
  const installedEvidenceLabel =
    normalizedInstalled && normalizedInstalled === normalizedBaseline
      ? "Baseline active"
      : input.capabilityDiff
        ? "Installed evidence"
        : "Diff evidence missing";
  const targetVersion = input.labReport?.targetOpenClawVersion ?? null;
  const targetDiff = input.scorecard?.capabilityDiff ?? (
    targetVersion && normalizeVersion(input.capabilityDiff?.targetVersion) === normalizeVersion(targetVersion)
      ? input.capabilityDiff
      : null
  );
  const hasExecutedTargetEvidence = Boolean(
    targetVersion &&
      (
        normalizeVersion(input.scorecard?.targetVersion) === normalizeVersion(targetVersion) ||
        normalizeVersion(input.capabilityDiff?.targetVersion) === normalizeVersion(targetVersion)
      )
  );
  const targetEvidenceLabel = !targetVersion
    ? "Evidence missing"
    : hasExecutedTargetEvidence
      ? "Target evidence"
      : "Report-only, target not executed";
  const installedProbe = probeAgentOsOpenClawContract({
    contract,
    diagnostics: input.diagnostics,
    capabilityDiff: input.capabilityDiff,
    targetVersion: installedVersion,
    evidenceLabel: installedEvidenceLabel
  });
  const targetProbe = targetVersion
    ? probeAgentOsOpenClawContract({
        contract,
        diagnostics: hasExecutedTargetEvidence ? input.diagnostics : null,
        capabilityDiff: targetDiff,
        labReport: input.labReport,
        targetVersion,
        evidenceLabel: targetEvidenceLabel
      })
    : null;
  const rows = installedProbe.operations.map((operation) => {
    const targetOperation = targetProbe?.operations.find((entry) => entry.operationId === operation.operationId) ?? null;

    return {
      ...operation,
      baselineExpected: formatExpected(operation),
      installedActual: formatActual(operation),
      targetActual: targetOperation ? formatActual(targetOperation) : null,
      targetStatus: targetOperation?.status ?? null,
      hasPayloadShapeChange:
        operation.actual.payloadShapeStatus === "invalid" ||
        targetOperation?.actual.payloadShapeStatus === "invalid",
      usesCliFallback: operation.actual.cliFallbackUsed || Boolean(targetOperation?.actual.cliFallbackUsed)
    };
  });
  const summary = {
    passed: rows.filter((row) => row.status === "passed").length,
    warnings: rows.filter((row) => row.status === "warning").length,
    failed: rows.filter((row) => row.status === "failed").length,
    unknown: rows.filter((row) => row.status === "unknown").length,
    certificationBlockers: rows.filter((row) => row.blocksCertification).length
  };

  return {
    baselineVersion: contract.certifiedOpenClawBaseline,
    installedVersion,
    targetVersion,
    installedEvidenceLabel,
    targetEvidenceLabel,
    installed: installedProbe,
    target: targetProbe,
    rows,
    summary
  };
}

export function filterAgentOsOpenClawContractRows(
  rows: AgentOsOpenClawContractComparisonRow[],
  filter: AgentOsOpenClawContractComparisonFilter
) {
  switch (filter) {
    case "blockers":
      return rows.filter((row) => row.blocksCertification);
    case "required":
      return rows.filter((row) => row.requirement === "required");
    case "warnings":
      return rows.filter((row) => row.status === "warning" || row.targetStatus === "warning");
    case "payload-shape-changes":
      return rows.filter((row) => row.hasPayloadShapeChange);
    case "cli-fallback":
      return rows.filter((row) => row.usesCliFallback);
    case "all":
    default:
      return rows;
  }
}

function formatExpected(operation: AgentOsOpenClawContractProbeOperationResult) {
  const methods = operation.expected.gatewayMethods.length
    ? `Methods: ${operation.expected.gatewayMethods.join(", ")}`
    : "Methods: none";
  const events = operation.expected.eventNames.length
    ? `Events: ${operation.expected.eventNames.join(", ")}`
    : "Events: none";
  const payload = operation.expected.payloadShape
    ? `Payload: ${operation.expected.payloadShape}`
    : "Payload: not specified";

  return `${methods}; ${events}; ${payload}`;
}

function formatActual(operation: AgentOsOpenClawContractProbeOperationResult) {
  const method = operation.actual.supportedMethod ? `Method: ${operation.actual.supportedMethod}` : "Method: none";
  const event = operation.actual.supportedEvent ? `Event: ${operation.actual.supportedEvent}` : "Event: none";
  const payload = operation.actual.payloadShapeStatus ? `Payload: ${operation.actual.payloadShapeStatus}` : "Payload: not checked";
  const fallback = operation.actual.cliFallbackUsed ? "CLI fallback: used" : "CLI fallback: not used";

  return `${operation.status}; ${operation.actual.mode}; ${method}; ${event}; ${payload}; ${fallback}`;
}

function normalizeVersion(value: string | null | undefined) {
  return value?.trim().replace(/^v/i, "") || null;
}
