export type OpenClawCompatibilityStatus = "compatible" | "degraded" | "incompatible" | "unknown";

export type OpenClawCompatibilityTargetKind = "real" | "simulated";

export type OpenClawCompatibilityTargetName =
  | "simulated-stable"
  | "simulated-beta-shape"
  | "real-local"
  | "real-stable";

export type OpenClawCompatibilityRuntimeStartedBy = "ci" | "script" | "external" | "unknown";

export type OpenClawVersionSource = "detected" | "recommended" | "assumed" | "unknown";

export type OpenClawCompatibilityCapabilityId =
  | "gatewayHealth"
  | "presence"
  | "sessions"
  | "chat"
  | "agents"
  | "agentFiles"
  | "models"
  | "authProfiles"
  | "usage"
  | "memory"
  | "accountsBrowserProfiles"
  | "channels"
  | "talk"
  | "tts"
  | "tasks"
  | "artifacts"
  | "tools"
  | "approvals"
  | "devices"
  | "nodes"
  | "cron"
  | "environments"
  | "skills"
  | "plugins"
  | "updates"
  | "commands"
  | "secrets"
  | "config"
  | "transcripts"
  | "cliFallback";

export type OpenClawCompatibilitySupportStatus = "supported" | "unsupported" | "unknown" | "not-available";

export type OpenClawCompatibilityCapabilitySource =
  | "gateway-advertised"
  | "gateway-discovery"
  | "version-default"
  | "runtime-diagnostic"
  | "cli-probe"
  | "not-available";

export type OpenClawGatewayProtocolCompatibilityStatus = "compatible" | "unsupported" | "unknown";

export type OpenClawGatewayHealthStatus = "healthy" | "degraded" | "unreachable" | "unknown";

export type OpenClawCompatibilityContractStatus = "ok" | "degraded" | "unsupported" | "failed";

export type OpenClawCompatibilityResponseShapeStatus = "valid" | "invalid" | "not-checked";

export type OpenClawCompatibilityMethodSource =
  | "gateway-advertised"
  | "gateway-discovery"
  | "version-default"
  | "unavailable";

export interface OpenClawCompatibilityTarget {
  name: OpenClawCompatibilityTargetName;
  kind: OpenClawCompatibilityTargetKind;
  label: string;
  aliasUsed?: string | null;
  version?: string | null;
  gatewayUrl?: string | null;
  runtimeStartedBy: OpenClawCompatibilityRuntimeStartedBy;
  isRealRuntime: boolean;
  isSimulatedRuntime: boolean;
}

export interface OpenClawCompatibilityCapability {
  id: OpenClawCompatibilityCapabilityId;
  label: string;
  status: OpenClawCompatibilitySupportStatus;
  source: OpenClawCompatibilityCapabilitySource;
  methods: string[];
  events: string[];
  supportedMethods: string[];
  supportedEvents: string[];
  reason: string;
}

export interface OpenClawCompatibilityContractCheck {
  operation: string;
  label: string;
  surface: OpenClawCompatibilityCapabilityId;
  required: boolean;
  baseline: "required" | "optional" | "experimental";
  methods: string[];
  events: string[];
  supportedMethod: string | null;
  supportedEvent: string | null;
  requiredScopes: string[];
  missingScopes: string[];
  nativeGatewaySupported: boolean;
  cliFallbackAvailable: boolean;
  responseShapeStatus: OpenClawCompatibilityResponseShapeStatus;
  responseShapeValid: boolean | null;
  status: OpenClawCompatibilityContractStatus;
  reason: string;
  suggestedRecovery: string;
}

export interface OpenClawCompatibilityReleaseSummary {
  nativeGatewayCoveragePercent: number;
  nativeGatewayCoverageLabel: string;
  cliFallbackOperationCount: number;
  activeCliFallbackCount: number;
  degradedSurfaces: string[];
  unsupportedSurfaces: string[];
  failedSurfaces: string[];
  supportedOpenClawVersion: string;
  testedOpenClawVersions: string[];
  unsupportedOperationCount: number;
  degradedOperationCount: number;
  failedOperationCount: number;
  targetName: OpenClawCompatibilityTargetName;
  targetKind: OpenClawCompatibilityTargetKind;
  isRealRuntime: boolean;
  isSimulatedRuntime: boolean;
}

export type OpenClawCompatibilityFallbackDiagnostic = {
  at: string;
  operation: string;
  issue: string;
  kind: string;
  recovery: string;
};

export type OpenClawCompatibilityTransportDiagnostics = {
  fallbackTotal: number;
  recentFallbackDiagnostics: OpenClawCompatibilityFallbackDiagnostic[];
};

export interface OpenClawCompatibilityReport {
  generatedAt: string;
  target: OpenClawCompatibilityTarget;
  targetName: OpenClawCompatibilityTargetName;
  targetKind: OpenClawCompatibilityTargetKind;
  targetAliasUsed: string | null;
  gatewayUrl: string | null;
  openClawVersionSource: OpenClawVersionSource;
  runtimeStartedBy: OpenClawCompatibilityRuntimeStartedBy;
  isRealRuntime: boolean;
  isSimulatedRuntime: boolean;
  status: OpenClawCompatibilityStatus;
  statusReason: string;
  recovery: string;
  openClaw: {
    installedVersion: string | null;
    versionSource: OpenClawVersionSource;
    recommendedVersion: string;
    supportedBaselineVersion: string;
    testedVersions: string[];
  };
  gateway: {
    health: OpenClawGatewayHealthStatus;
    healthReason: string;
    protocolVersion: string | null;
    protocolStatus: OpenClawGatewayProtocolCompatibilityStatus;
    protocolRange: {
      min: number;
      max: number;
    };
    authMode: string | null;
    authRole: string | null;
    authScopes: string[];
    capabilitySource: OpenClawCompatibilityMethodSource;
    advertisedMethodCount: number;
    effectiveMethodCount: number;
    advertisedEventCount: number;
  };
  fallback: {
    cliAvailable: boolean;
    cliForced: boolean;
    operationCount: number;
    activeFallbackCount: number;
    diagnostics: OpenClawCompatibilityFallbackDiagnostic[];
  };
  capabilities: OpenClawCompatibilityCapability[];
  contracts: OpenClawCompatibilityContractCheck[];
  summary: OpenClawCompatibilityReleaseSummary;
  diagnostics: string[];
}

export interface OpenClawCompatibilityDetectionInput {
  advertisedMethods: string[];
  advertisedEvents: string[];
  installedVersion: string | null;
  source: OpenClawCompatibilityMethodSource;
  cliFallbackAvailable: boolean;
}

export interface OpenClawCompatibilityContractInput {
  effectiveMethods: string[];
  effectiveEvents: string[];
  authScopes: string[];
  capabilitySource: OpenClawCompatibilityMethodSource;
  cliFallbackAvailable: boolean;
  cliForced: boolean;
  includeLiveShapeChecks: boolean;
  callNative?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
}

export type OpenClawCompatibilityReportInput = {
  target: OpenClawCompatibilityTarget;
  generatedAt: string;
  installedVersion: string | null;
  openClawVersionSource: OpenClawVersionSource;
  recommendedVersion: string;
  supportedBaselineVersion: string;
  testedVersions: string[];
  gatewayHealth: OpenClawGatewayHealthStatus;
  gatewayHealthReason: string;
  protocolVersion: string | null;
  protocolStatus: OpenClawGatewayProtocolCompatibilityStatus;
  protocolRange: {
    min: number;
    max: number;
  };
  authMode: string | null;
  authRole: string | null;
  authScopes: string[];
  advertisedMethods: string[];
  effectiveMethods: string[];
  advertisedEvents: string[];
  effectiveEvents: string[];
  capabilitySource: OpenClawCompatibilityMethodSource;
  cliAvailable: boolean;
  cliForced: boolean;
  transport?: OpenClawCompatibilityTransportDiagnostics | null;
  capabilities: OpenClawCompatibilityCapability[];
  contracts: OpenClawCompatibilityContractCheck[];
  diagnostics: string[];
};
