import type {
  OpenClawCertificationScorecardReport,
  OpenClawUpdateDecision
} from "@/lib/openclaw/types";

export type OpenClawCompatibilityLabStatus = "passed" | "warning" | "failed" | "unknown";

export type OpenClawCompatibilityLabAreaId =
  | "manifest-policy"
  | "gateway-protocol"
  | "native-rpc"
  | "payload-shapes"
  | "models-providers"
  | "sessions-tasks-agents"
  | "config-patching"
  | "channels-accounts-scopes"
  | "runtime-smoke"
  | "rollback-recovery";

export type OpenClawCompatibilityLabCommandOutput = {
  command?: string;
  stdout?: string;
  stderr?: string;
};

export type OpenClawCompatibilityLabAreaResult = {
  id: OpenClawCompatibilityLabAreaId;
  name: string;
  status: OpenClawCompatibilityLabStatus;
  evidence: string[];
  expectedBehaviorOrShape: unknown;
  actualBehaviorOrShape: unknown;
  affectedAgentOsFiles: string[];
  suggestedFixScope: string;
  recommendedNextAction: string;
  blocksCertification: boolean;
  redactedCommandOutput?: OpenClawCompatibilityLabCommandOutput;
};

export type OpenClawCompatibilityLabReport = {
  schemaVersion: 1;
  id: string;
  generatedAt: string;
  targetOpenClawVersion: string;
  currentCertifiedBaseline: string;
  installedOpenClawVersion: string | null;
  manifestDecision: OpenClawUpdateDecision;
  probeTimestamp: string;
  status: OpenClawCompatibilityLabStatus;
  certificationBlocked: boolean;
  acceptedWarnings: string[];
  summary: {
    passed: number;
    warnings: number;
    failed: number;
    unknown: number;
    recommendedNextAction: string;
  };
  areas: OpenClawCompatibilityLabAreaResult[];
};

export type OpenClawCodexFixBundleFailure = {
  areaId: OpenClawCompatibilityLabAreaId;
  failingCommandOrTest: string;
  redactedStdout: string | null;
  redactedStderr: string | null;
  expectedVsActualPayloadDiff: unknown;
  affectedFiles: string[];
  suggestedMinimalPatchScope: string;
  regressionTestsToAddOrUpdate: string[];
};

export type OpenClawCodexFixBundle = {
  schemaVersion: 1;
  reportId: string;
  targetOpenClawVersion: string;
  currentCertifiedBaseline: string;
  createdAt: string;
  instruction: "Preserve current AgentOS UX and only restore OpenClaw compatibility. Do not replace OpenClaw behavior with mocks.";
  failures: OpenClawCodexFixBundleFailure[];
};

export type OpenClawCompatibilityCertificationPromotion = {
  schemaVersion: 1;
  id: string;
  reportId: string;
  promotedAt: string;
  targetOpenClawVersion: string;
  previousCertifiedBaseline: string;
  promotedRecommendedVersion: string;
  scorecardGeneratedAt: string;
  scorecardStatus: OpenClawCertificationScorecardReport["status"];
  score: number;
  evidence: {
    roundTripStatus: OpenClawCertificationScorecardReport["roundTripEvidence"]["status"];
    hardBlockers: string[];
    warnings: string[];
    artifactAvailable: boolean;
  };
  operatorAction: "certify-target";
};

export type OpenClawCompatibilityLabAreaDefinition = {
  id: OpenClawCompatibilityLabAreaId;
  name: string;
  affectedAgentOsFiles: string[];
  suggestedFixScope: string;
  recommendedNextAction: string;
  failingCommandOrTest: string;
  regressionTestsToAddOrUpdate: string[];
};
