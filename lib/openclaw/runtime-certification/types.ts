import type { NativeHandshakePayload } from "@/lib/openclaw/client/native-ws-gateway-types";

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

export type OpenClawRuntimeResponseShape =
  | "valid"
  | "invalid"
  | "not-checked"
  | "unknown";

export type OpenClawRuntimeCertificationExpectedOutcome =
  | "authorization-denied"
  | "invalid-parameters"
  | "timeout";

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
  operation: string;
  method: string;
  expectedScope?: string | null;
  clientId?: string;
  params?: Record<string, unknown> | ((context: OpenClawRuntimeCertificationContext) => Record<string, unknown>);
  execute?: (context: OpenClawRuntimeCertificationContext) => Promise<unknown>;
  expectedOutcome?: OpenClawRuntimeCertificationExpectedOutcome;
  skipReason?: string;
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
  operation: string;
  method: string;
  expectedScope: string | null;
  actualRole: string | null;
  actualScopes: string[];
  status: OpenClawRuntimeCertificationStatus;
  responseShape: OpenClawRuntimeResponseShape;
  errorCode: string | null;
  errorMessage: string | null;
  failureKind: OpenClawRuntimeCertificationFailureKind;
  retryable: boolean | null;
  evidence: string[];
};

export type OpenClawRuntimeCertificationReport = {
  schemaVersion: 1;
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
  results: OpenClawRuntimeCertificationResult[];
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
