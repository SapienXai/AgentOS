import type { OpenClawCompatibilityLabAreaId } from "@/lib/openclaw/compatibility-lab/types";

export type AgentOsOpenClawContractRequirement = "required" | "optional" | "experimental";
export type AgentOsOpenClawContractOperationStatus = "passed" | "warning" | "failed" | "unknown";

export type AgentOsOpenClawContract = {
  schemaVersion: 1;
  agentOsContractVersion: string;
  certifiedOpenClawBaseline: string;
  operations: AgentOsOpenClawContractOperation[];
};

export type AgentOsOpenClawContractOperation = {
  id: string;
  areaId: OpenClawCompatibilityLabAreaId;
  label: string;
  gatewayMethod?: string;
  gatewayMethods: string[];
  eventName?: string;
  eventNames: string[];
  requirement: AgentOsOpenClawContractRequirement;
  expectedPayloadShape?: string;
  requiredScopes: string[];
  cliFallbackAllowed: boolean;
  cliFallbackCommand?: string;
  blocksCertification: boolean;
  affectedAgentOsFiles: string[];
  regressionTests: string[];
};

export type AgentOsOpenClawContractProbeOperationResult = {
  operationId: string;
  label: string;
  areaId: OpenClawCompatibilityLabAreaId;
  requirement: AgentOsOpenClawContractRequirement;
  status: AgentOsOpenClawContractOperationStatus;
  expected: {
    gatewayMethods: string[];
    eventNames: string[];
    payloadShape: string | null;
    cliFallbackAllowed: boolean;
  };
  actual: {
    supportedMethod: string | null;
    supportedEvent: string | null;
    mode: string;
    payloadShapeStatus: string | null;
    cliFallbackUsed: boolean;
    cliFallbackAvailable: boolean;
  };
  evidence: string[];
  affectedAgentOsFiles: string[];
  regressionTests: string[];
  blocksCertification: boolean;
};

export type AgentOsOpenClawContractProbeResult = {
  schemaVersion: 1;
  generatedAt: string;
  baselineOpenClawVersion: string;
  targetOpenClawVersion: string | null;
  evidenceLabel: string;
  status: AgentOsOpenClawContractOperationStatus;
  operations: AgentOsOpenClawContractProbeOperationResult[];
  summary: {
    passed: number;
    warnings: number;
    failed: number;
    unknown: number;
    certificationBlockers: number;
  };
};

export type AgentOsOpenClawContractComparisonFilter =
  | "all"
  | "blockers"
  | "required"
  | "warnings"
  | "payload-shape-changes"
  | "cli-fallback";
