import type { NativeHandshakePayload } from "@/lib/openclaw/client/native-ws-gateway-types";
import {
  classifyGatewayError,
  normalizeClientError,
  type OpenClawGatewayClientErrorKind
} from "@/lib/openclaw/client/native-ws-gateway-errors";
import { supportsGatewayMethod } from "@/lib/openclaw/client/native-ws-gateway-protocol";
import type {
  OpenClawRuntimeCertificationClientContext,
  OpenClawRuntimeCertificationContext,
  OpenClawRuntimeCertificationProbe,
  OpenClawRuntimeCertificationReport,
  OpenClawRuntimeCertificationResult,
  OpenClawRuntimeCertificationStatus,
  OpenClawRuntimeResponseShapeCheck
} from "@/lib/openclaw/runtime-certification/types";

export type OpenClawRuntimeCertificationHarnessInput = {
  targetVersion: string;
  gatewayUrl: string;
  handshake: NativeHandshakePayload;
  clients?: Record<string, OpenClawRuntimeCertificationClientContext>;
  defaultClientId?: string;
  probes: OpenClawRuntimeCertificationProbe[];
  generatedAt?: Date;
};

export async function runOpenClawRuntimeCertification(
  input: OpenClawRuntimeCertificationHarnessInput
): Promise<OpenClawRuntimeCertificationReport> {
  const primaryClientId = input.defaultClientId ?? "default";
  const clients = input.clients ?? {};
  const primaryClient = clients[primaryClientId];
  if (!primaryClient) {
    throw new Error(`Runtime certification client "${primaryClientId}" is not configured.`);
  }

  const context: OpenClawRuntimeCertificationContext = {
    clients,
    results: [],
    data: {}
  };

  for (const probe of input.probes) {
    const result = await executeOpenClawRuntimeProbe({
      probe,
      context,
      defaultClientId: primaryClientId
    });
    context.results.push(result);
  }

  const advertisedMethods = readStringList(input.handshake.features?.methods);
  const advertisedEvents = readStringList(input.handshake.features?.events);
  const results = context.results;
  const summary = {
    total: results.length,
    passed: results.filter((result) => result.status === "PASS").length,
    failed: results.filter((result) => result.status === "FAIL").length,
    skipped: results.filter((result) => result.status === "SKIPPED").length,
    expectedDenials: results.filter((result) => result.status === "EXPECTED-DENIAL").length,
    unknown: results.filter((result) => result.status === "UNKNOWN").length,
    requiredFailures: results.filter(
      (result) => result.status === "FAIL" && result.failureKind !== "environmental-skip"
    ).length
  };

  return {
    schemaVersion: 1,
    generatedAt: (input.generatedAt ?? new Date()).toISOString(),
    targetVersion: input.targetVersion,
    gatewayUrl: input.gatewayUrl,
    installedVersion: input.handshake.server?.version ?? null,
    buildId: readString(input.handshake.server?.buildId),
    protocolVersion: typeof input.handshake.protocol === "number" ? input.handshake.protocol : null,
    role: readString(input.handshake.auth?.role),
    scopes: readStringList(input.handshake.auth?.scopes),
    advertisedMethods,
    advertisedEvents,
    methodCount: advertisedMethods.length,
    eventCount: advertisedEvents.length,
    connectionStatus: "connected",
    results,
    summary
  };
}

export async function executeOpenClawRuntimeProbe(input: {
  probe: OpenClawRuntimeCertificationProbe;
  context: OpenClawRuntimeCertificationContext;
  defaultClientId?: string;
}): Promise<OpenClawRuntimeCertificationResult> {
  const { probe, context } = input;
  const clientId = probe.clientId ?? input.defaultClientId ?? "default";
  const clientContext = context.clients[clientId];
  const actualRole = readString(clientContext?.handshake?.auth?.role);
  const actualScopes = readStringList(clientContext?.handshake?.auth?.scopes);
  const base = {
    id: probe.id,
    operation: probe.operation,
    method: probe.method,
    expectedScope: probe.expectedScope ?? null,
    actualRole,
    actualScopes
  };

  if (!clientContext) {
    return {
      ...base,
      status: "UNKNOWN",
      responseShape: "unknown",
      errorCode: null,
      errorMessage: "Certification client is not configured.",
      failureKind: "runtime-error",
      retryable: false,
      evidence: ["The runtime certification client was not configured."]
    };
  }

  if (probe.skipReason) {
    return {
      ...base,
      status: "SKIPPED",
      responseShape: "not-checked",
      errorCode: null,
      errorMessage: null,
      failureKind: "environmental-skip",
      retryable: null,
      evidence: [probe.skipReason, ...(probe.evidence ?? [])]
    };
  }

  if (!supportsGatewayMethod(clientContext.handshake, probe.method)) {
    return {
      ...base,
      status: "SKIPPED",
      responseShape: "not-checked",
      errorCode: null,
      errorMessage: `OpenClaw Gateway does not advertise method "${probe.method}".`,
      failureKind: "method-unavailable",
      retryable: false,
      evidence: ["The method was absent from the target Gateway handshake inventory.", ...(probe.evidence ?? [])]
    };
  }

  const params = typeof probe.params === "function" ? probe.params(context) : probe.params ?? {};
  try {
    const payload = probe.execute
      ? await probe.execute(context)
      : await clientContext.client.callNative(
          probe.method,
          params,
          { timeoutMs: probe.timeoutMs },
          { safety: resolveProbeSafety(probe.method), timeoutMs: probe.timeoutMs }
        );
    probe.captureResponse?.(payload, context);

    if (probe.expectedOutcome) {
      return {
        ...base,
        status: "FAIL",
        responseShape: "unknown",
        errorCode: null,
        errorMessage: `Expected ${probe.expectedOutcome} but the Gateway accepted the request.`,
        failureKind: probe.expectedOutcome === "authorization-denied"
          ? "authorization-denied"
          : probe.expectedOutcome === "invalid-parameters"
            ? "invalid-parameters"
            : "runtime-error",
        retryable: false,
        evidence: ["The expected negative authorization or validation proof was not observed.", ...(probe.evidence ?? [])]
      };
    }

    const shape = resolveResponseShape(probe.validateResponse?.(payload, context));
    if (!shape.valid) {
      return {
        ...base,
        status: "FAIL",
        responseShape: "invalid",
        errorCode: null,
        errorMessage: "The Gateway response did not match the certification shape check.",
        failureKind: "response-shape-mismatch",
        retryable: false,
        evidence: [shape.evidence ?? "Response shape validation failed.", ...(probe.evidence ?? [])]
      };
    }

    return {
      ...base,
      status: "PASS",
      responseShape: "valid",
      errorCode: null,
      errorMessage: null,
      failureKind: "none",
      retryable: null,
      evidence: [shape.evidence ?? "Native Gateway response received and validated.", ...(probe.evidence ?? [])]
    };
  } catch (error) {
    const normalized = normalizeRuntimeError(error);
    const expectedDenial = probe.expectedOutcome === "authorization-denied" && normalized.failureKind === "authorization-denied";
    const expectedInvalid = probe.expectedOutcome === "invalid-parameters" && normalized.failureKind === "invalid-parameters";
    const expectedTimeout = probe.expectedOutcome === "timeout" && normalized.gatewayKind === "timeout";
    const status: OpenClawRuntimeCertificationStatus = expectedDenial
      ? "EXPECTED-DENIAL"
      : expectedInvalid || expectedTimeout
        ? "PASS"
        : "FAIL";

    return {
      ...base,
      status,
      responseShape: expectedDenial || expectedInvalid || expectedTimeout ? "not-checked" : "unknown",
      errorCode: normalized.errorCode,
      errorMessage: normalized.message,
      failureKind: normalized.failureKind,
      retryable: normalized.retryable,
      evidence: [
        expectedDenial
          ? "The target Gateway rejected the request because the authenticated operator lacked the required scope."
          : expectedInvalid
            ? "The target Gateway rejected malformed or incomplete parameters as expected."
            : expectedTimeout
              ? "The target Gateway waited for an answer and timed out as expected."
            : "Native Gateway request failed.",
        ...(probe.evidence ?? [])
      ]
    };
  }
}

function resolveProbeSafety(method: string): "read" | "mutation" {
  return /^(?:sessions\.(create|patch|delete|send|abort|reset)|chat\.(send|abort)|agents\.(create|update|delete)|config\.(set|patch|apply)|cron\.(add|update|remove|run)|question\.(request|resolve)|node\.(invoke)|gateway\.restart\.request|models\.authLogout|talk\.(speak|mode)|talk\.session\.)/.test(method)
    ? "mutation"
    : "read";
}

function normalizeRuntimeError(error: unknown) {
  const normalized = normalizeClientError(error);
  const message = normalized.message;
  const kind = classifyGatewayError(message);
  const failureKind = resolveFailureKind(message, kind);
  return {
    failureKind,
    errorCode: readErrorCode(error),
    message,
    gatewayKind: kind,
    retryable: kind === "timeout" || kind === "unreachable" || kind === "rate-limited"
  } as const;
}

function resolveFailureKind(
  message: string,
  kind: OpenClawGatewayClientErrorKind
): Exclude<OpenClawRuntimeCertificationResult["failureKind"], "none" | "environmental-skip"> {
  if (/forbidden|missing scope|not authorized|unauthorized|permission denied|scope/i.test(message)) {
    return "authorization-denied";
  }
  if (/unknown method|method not found|unsupported method|does not advertise/i.test(message)) {
    return "method-unavailable";
  }
  if (/invalid[_\s-]?request|invalid .*param|missing required|expected .*required|malformed|schema/i.test(message)) {
    return "invalid-parameters";
  }
  if (kind === "malformed-response") {
    return "response-shape-mismatch";
  }
  return "runtime-error";
}

function resolveResponseShape(check: OpenClawRuntimeResponseShapeCheck | undefined) {
  if (check === undefined) {
    return { valid: true, evidence: undefined };
  }
  if (typeof check === "boolean") {
    return { valid: check, evidence: undefined };
  }
  return check;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function readErrorCode(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.trim() ? code.trim() : null;
}
