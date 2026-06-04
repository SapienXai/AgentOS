export {
  buildOpenClawCompatibilityReport,
  clearOpenClawCompatibilityReportCacheForTesting,
  generateOpenClawCompatibilityReport,
  getCachedOpenClawCompatibilityReport,
  getOpenClawCompatibilityReport,
  isOpenClawVersionAtLeastSupportedBaseline,
  warmOpenClawCompatibilityReport,
  type OpenClawCompatibilityReportOptions
} from "@/lib/openclaw/compat/report";
export {
  formatOpenClawCompatibilityReleaseSummary,
  formatOpenClawCompatibilityReleaseSummaryMarkdown,
  formatOpenClawCompatibilityReportHuman
} from "@/lib/openclaw/compat/format";
export {
  isRealCompatibilityTarget,
  isSimulatedCompatibilityTarget,
  normalizeRuntimeStartedBy,
  redactGatewayUrl,
  resolveDefaultFailOnDegraded,
  resolveOpenClawCompatibilityExit,
  resolveOpenClawCompatibilityTarget,
  type OpenClawCompatibilityTargetAlias
} from "@/lib/openclaw/compat/targets";
export type {
  OpenClawCompatibilityCapability,
  OpenClawCompatibilityCapabilityId,
  OpenClawCompatibilityContractCheck,
  OpenClawCompatibilityContractStatus,
  OpenClawCompatibilityReport,
  OpenClawCompatibilityRuntimeStartedBy,
  OpenClawCompatibilityStatus,
  OpenClawCompatibilitySupportStatus,
  OpenClawCompatibilityTarget,
  OpenClawCompatibilityTargetKind,
  OpenClawCompatibilityTargetName,
  OpenClawVersionSource,
  OpenClawGatewayHealthStatus,
  OpenClawGatewayProtocolCompatibilityStatus
} from "@/lib/openclaw/compat/types";
