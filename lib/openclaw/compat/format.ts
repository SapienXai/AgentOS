import type {
  OpenClawCompatibilityContractCheck,
  OpenClawCompatibilityReport,
  OpenClawCompatibilityStatus
} from "@/lib/openclaw/compat/types";

export function formatOpenClawCompatibilityReportHuman(report: OpenClawCompatibilityReport) {
  const lines = [
    "OpenClaw Compatibility Report",
    `Generated: ${report.generatedAt}`,
    `Target: ${report.targetName} (${report.targetKind} runtime)`,
    `Target label: ${report.target.label}`,
    ...(report.targetAliasUsed ? [`Target alias: ${report.targetAliasUsed} -> ${report.targetName}`] : []),
    `Runtime started by: ${report.runtimeStartedBy}`,
    `Gateway URL: ${report.gatewayUrl ?? "not available"}`,
    `Overall status: ${formatStatus(report.status)}`,
    `Reason: ${report.statusReason}`,
    "",
    "Versions",
    `  Installed OpenClaw: ${formatVersion(report.openClaw.installedVersion)}`,
    `  Version source: ${report.openClawVersionSource}`,
    `  Recommended OpenClaw: ${formatVersion(report.openClaw.recommendedVersion)}`,
    `  Supported baseline: ${formatVersion(report.openClaw.supportedBaselineVersion)}`,
    `  Tested versions: ${report.openClaw.testedVersions.length ? report.openClaw.testedVersions.map(formatVersion).join(", ") : "not available"}`,
    "",
    "Gateway",
    `  Health: ${report.gateway.health} (${report.gateway.healthReason})`,
    `  Protocol: ${report.gateway.protocolVersion ? `v${report.gateway.protocolVersion}` : "unknown"} / ${report.gateway.protocolStatus}`,
    `  Protocol range: v${report.gateway.protocolRange.min}-v${report.gateway.protocolRange.max}`,
    `  Auth mode: ${report.gateway.authMode ?? "unknown"}`,
    `  Auth role: ${report.gateway.authRole ?? "unknown"}`,
    `  Capability source: ${report.gateway.capabilitySource}`,
    `  Advertised RPC methods: ${report.gateway.advertisedMethodCount}`,
    `  Effective RPC methods: ${report.gateway.effectiveMethodCount}`,
    "",
    "Release Metrics",
    `  Native Gateway coverage: ${report.summary.nativeGatewayCoveragePercent}% (${report.summary.nativeGatewayCoverageLabel})`,
    `  CLI fallback operation count: ${report.summary.cliFallbackOperationCount}`,
    `  Active CLI fallback count: ${report.summary.activeCliFallbackCount}`,
    `  Degraded surfaces: ${formatList(report.summary.degradedSurfaces)}`,
    `  Unsupported surfaces: ${formatList(report.summary.unsupportedSurfaces)}`,
    `  Failed surfaces: ${formatList(report.summary.failedSurfaces)}`,
    "",
    "Capabilities",
    ...report.capabilities.map((capability) =>
      `  ${capability.label}: ${capability.status} (${capability.source})`
    ),
    "",
    "Contract Checks",
    ...report.contracts.map(formatContractLine),
    "",
    `Recovery: ${report.recovery}`
  ];

  if (report.diagnostics.length > 0) {
    lines.push("", "Diagnostics", ...report.diagnostics.map((entry) => `  ${entry}`));
  }

  return `${lines.join("\n")}\n`;
}

export function formatOpenClawCompatibilityReleaseSummary(report: OpenClawCompatibilityReport) {
  return {
    targetName: report.targetName,
    targetKind: report.targetKind,
    isRealRuntime: report.isRealRuntime,
    isSimulatedRuntime: report.isSimulatedRuntime,
    nativeGatewayCoveragePercent: report.summary.nativeGatewayCoveragePercent,
    cliFallbackCount: report.summary.cliFallbackOperationCount,
    degradedSurfaces: report.summary.degradedSurfaces,
    unsupportedSurfaces: report.summary.unsupportedSurfaces,
    supportedOpenClawVersion: report.summary.supportedOpenClawVersion,
    testedOpenClawVersions: report.summary.testedOpenClawVersions
  };
}

export function formatOpenClawCompatibilityReleaseSummaryMarkdown(report: OpenClawCompatibilityReport) {
  const lines = [
    "OpenClaw Compatibility:",
    `- Tested target: ${report.targetName}`,
    `- Target kind: ${report.targetKind === "real" ? "real runtime" : "simulated gateway"}`,
    ...(report.isSimulatedRuntime ? ["- Note: This is not a real OpenClaw runtime smoke test."] : []),
    `- OpenClaw version: ${formatVersion(report.openClaw.installedVersion)} (${report.openClawVersionSource})`,
    `- Overall status: ${report.status}`,
    `- Native Gateway coverage: ${report.summary.nativeGatewayCoveragePercent}% (${report.summary.nativeGatewayCoverageLabel})`,
    `- CLI fallback operations: ${report.summary.cliFallbackOperationCount}`,
    `- Degraded surfaces: ${formatList(report.summary.degradedSurfaces)}`,
    `- Unsupported operations: ${formatList(report.summary.unsupportedSurfaces)}`,
    `- Supported OpenClaw version: ${formatVersion(report.summary.supportedOpenClawVersion)}`,
    `- Tested OpenClaw versions: ${report.summary.testedOpenClawVersions.length ? report.summary.testedOpenClawVersions.map(formatVersion).join(", ") : "not available"}`
  ];

  return `${lines.join("\n")}\n`;
}

function formatContractLine(check: OpenClawCompatibilityContractCheck) {
  const fallback = check.cliFallbackAvailable ? "yes" : "no";
  const shape = check.responseShapeStatus === "not-checked"
    ? "not checked"
    : check.responseShapeValid
      ? "valid"
      : "invalid";
  const native = check.nativeGatewaySupported
    ? check.supportedMethod ?? check.supportedEvent ?? "yes"
    : "no";

  return `  ${check.label}: ${check.status} / native=${native} / fallback=${fallback} / shape=${shape}`;
}

function formatStatus(status: OpenClawCompatibilityStatus) {
  switch (status) {
    case "compatible":
      return "Compatible";
    case "degraded":
      return "Degraded";
    case "incompatible":
      return "Incompatible";
    case "unknown":
      return "Unknown";
  }
}

function formatVersion(value: string | null) {
  return value ? `v${value.replace(/^v/i, "")}` : "not available";
}

function formatList(values: string[]) {
  return values.length > 0 ? values.join(", ") : "none";
}
