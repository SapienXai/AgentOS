import type { NativeHandshakePayload } from "@/lib/openclaw/client/native-ws-gateway-types";

export const OPENCLAW_RUNTIME_EVIDENCE_DIMENSIONS = [
  "availability",
  "authorization",
  "positiveExecution",
  "responseShape",
  "lifecycle"
] as const;

export type OpenClawRuntimeEvidenceDimension = typeof OPENCLAW_RUNTIME_EVIDENCE_DIMENSIONS[number];

export type OpenClawRuntimeEvidenceState = "proven" | "failed" | "not-required" | "not-tested";

export type OpenClawRuntimeEvidence = Record<OpenClawRuntimeEvidenceDimension, OpenClawRuntimeEvidenceState>;

export type OpenClawRuntimeRequirementLevel = "required" | "optional" | "experimental";

export type OpenClawRuntimeCertificationStatus =
  | "PASS"
  | "FAIL"
  | "SKIPPED"
  | "EXPECTED-DENIAL"
  | "UNKNOWN";

export type OpenClawRuntimeCertificationFailureKind =
  | "none"
  | "method-unavailable"
  | "authorization-denied"
  | "invalid-parameters"
  | "response-shape-mismatch"
  | "runtime-error"
  | "environmental-skip";

export type OpenClawRuntimeResponseShape = "valid" | "invalid" | "not-checked" | "unknown";

export type OpenClawRuntimeCertificationExpectedOutcome =
  | "authorization-denied"
  | "invalid-parameters"
  | "timeout";

export type OpenClawRuntimeExpectedOutcome = OpenClawRuntimeCertificationExpectedOutcome | "positive" | "not-tested";

export type OpenClawRuntimeActualOutcome =
  | "positive"
  | "authorization-denied"
  | "invalid-parameters"
  | "timeout"
  | "skip"
  | "failure"
  | "unknown";

export type OpenClawRuntimeCertificationClient = {
  callNative<TPayload = unknown>(
    method: string,
    params?: Record<string, unknown>,
    options?: { timeoutMs?: number },
    policy?: { safety: "read" | "mutation"; timeoutMs?: number }
  ): Promise<TPayload>;
};

export type OpenClawRuntimeCertificationClientContext = {
  client: OpenClawRuntimeCertificationClient;
  handshake: NativeHandshakePayload | null;
  probeHandshake?: () => Promise<NativeHandshakePayload>;
};

export type OpenClawRuntimeCertificationContext = {
  clients: Record<string, OpenClawRuntimeCertificationClientContext>;
  results: OpenClawRuntimeCertificationResult[];
  data: Record<string, unknown>;
};

export type OpenClawRuntimeResponseShapeCheck =
  | boolean
  | {
      valid: boolean;
      evidence?: string;
    };

export type OpenClawRuntimeCertificationProbe = {
  id: string;
  operationId: string;
  operation: string;
  method: string;
  requirementLevel: OpenClawRuntimeRequirementLevel;
  requiredEvidenceDimensions: OpenClawRuntimeEvidenceDimension[];
  requirementRationale: string;
  clientId?: string;
  params?: Record<string, unknown> | ((context: OpenClawRuntimeCertificationContext) => Record<string, unknown>);
  execute?: (context: OpenClawRuntimeCertificationContext) => Promise<unknown>;
  expectedOutcome?: OpenClawRuntimeCertificationExpectedOutcome;
  skipReason?: string;
  contributesTo?: OpenClawRuntimeEvidenceDimension[];
  validateResponse?: (
    payload: unknown,
    context: OpenClawRuntimeCertificationContext
  ) => OpenClawRuntimeResponseShapeCheck;
  captureResponse?: (payload: unknown, context: OpenClawRuntimeCertificationContext) => void;
  evidence?: string[];
  timeoutMs?: number;
};

export type OpenClawRuntimeCertificationResult = {
  id: string;
  operationId: string;
  operation: string;
  method: string;
  requirementLevel: OpenClawRuntimeRequirementLevel;
  requiredEvidenceDimensions: OpenClawRuntimeEvidenceDimension[];
  requirementRationale: string;
  actualRole: string | null;
  actualScopes: string[];
  expectedOutcome: OpenClawRuntimeExpectedOutcome;
  actualOutcome: OpenClawRuntimeActualOutcome;
  status: OpenClawRuntimeCertificationStatus;
  proofKind: "positive" | "authorization-denial" | "invalid-parameters" | "timeout" | "skip" | "unknown";
  evidenceDimensions: OpenClawRuntimeEvidence;
  responseShape: OpenClawRuntimeResponseShape;
  errorCode: string | null;
  errorMessage: string | null;
  failureKind: OpenClawRuntimeCertificationFailureKind;
  retryable: boolean | null;
  evidence: string[];
};

export type OpenClawRuntimeOperationOutcome =
  | "certified"
  | "partially-certified"
  | "failed"
  | "uncertified"
  | "static-only";

export type OpenClawRuntimeOperationEvidence = {
  operationId: string;
  method: string;
  requirementLevel: OpenClawRuntimeRequirementLevel;
  requiredEvidenceDimensions: OpenClawRuntimeEvidenceDimension[];
  requirementRationale: string;
  evidenceDimensions: OpenClawRuntimeEvidence;
  outcome: OpenClawRuntimeOperationOutcome;
  proofIds: string[];
  reason: string;
};

export type OpenClawRuntimeCertificationReport = {
  schemaVersion: 2;
  generatedAt: string;
  targetVersion: string;
  gatewayUrl: string;
  installedVersion: string | null;
  buildId: string | null;
  protocolVersion: number | null;
  role: string | null;
  scopes: string[];
  advertisedMethods: string[];
  advertisedEvents: string[];
  methodCount: number;
  eventCount: number;
  connectionStatus: "connected" | "unreachable" | "unknown";
  provider?: {
    kind: "loopback-fixture" | "ollama" | "external" | "none" | "unknown";
    modelRef: string | null;
    externalCredentialRequired: boolean;
    externalCredentialUsed: boolean;
  };
  cleanup?: {
    status: "complete" | "partial" | "not-run" | "unknown";
    resources: Array<{
      kind: "session" | "agent" | "question" | "cron" | "workspace" | "gateway" | "provider";
      status: "cleaned" | "not-created" | "failed" | "unknown";
    }>;
  };
  persistence?: {
    status: "healthy" | "degraded" | "unknown";
    sqlite?: {
      status: "healthy" | "degraded" | "unknown";
      checks: string[];
    };
    doctor?: {
      status: "healthy" | "degraded" | "unknown";
      checks: string[];
    };
  };
  migrationReadiness?: OpenClawRuntimeMigrationReadiness;
  results: OpenClawRuntimeCertificationResult[];
  operations: OpenClawRuntimeOperationEvidence[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    expectedDenials: number;
    unknown: number;
    requiredFailures: number;
  };
};

export type OpenClawRuntimeMigrationReadiness = {
  readyForMigrationEngine: boolean;
  targetVersionMatched: boolean;
  installedVersionMatched: boolean;
  protocolSupported: boolean;
  handshakeValid: boolean;
  persistenceHealthy: boolean;
  requiredOperationIds: string[];
  coreOperations: Array<{
    operationId: string;
    outcome: OpenClawRuntimeOperationOutcome | "missing";
    reason: string;
  }>;
  blockers: string[];
  optionalOperations: Array<{
    operationId: string;
    outcome: OpenClawRuntimeOperationOutcome;
  }>;
  experimentalOperations: Array<{
    operationId: string;
    outcome: OpenClawRuntimeOperationOutcome;
  }>;
};
