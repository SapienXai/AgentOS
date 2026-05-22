import "server-only";

import {
  MAX_CONTROL_PROTOCOL_VERSION,
  MIN_CONTROL_PROTOCOL_VERSION
} from "@/lib/openclaw/client/native-ws-gateway-types";
import { redactSecretText } from "@/lib/security/redaction";

export type OpenClawGatewayClientErrorKind =
  | "auth"
  | "conflict"
  | "malformed-response"
  | "protocol-mismatch"
  | "rate-limited"
  | "scope-limited"
  | "timeout"
  | "unsupported"
  | "unreachable"
  | "unknown";

export class NativeGatewayError extends Error {
  readonly kind: OpenClawGatewayClientErrorKind;

  constructor(
    message: string,
    options: {
      cause?: unknown;
      kind?: OpenClawGatewayClientErrorKind;
    } = {}
  ) {
    super(message);
    this.name = "NativeGatewayError";
    this.kind = options.kind ?? classifyGatewayError(message);
    this.cause = options.cause;
  }
}

export class NativeGatewayRequestError extends NativeGatewayError {
  constructor(
    message: string,
    readonly method: string,
    readonly sent: boolean,
    options: {
      cause?: unknown;
      kind?: OpenClawGatewayClientErrorKind;
    } = {}
  ) {
    super(message, options);
    this.name = "NativeGatewayRequestError";
  }
}

export class OpenClawGatewayClientError extends Error {
  constructor(
    message: string,
    readonly kind: OpenClawGatewayClientErrorKind,
    options: {
      cause?: unknown;
    } = {}
  ) {
    super(message);
    this.name = "OpenClawGatewayClientError";
    this.cause = options.cause;
  }
}

export type OpenClawGatewayFallbackDiagnostic = {
  at: string;
  operation: string;
  issue: string;
  kind: OpenClawGatewayClientErrorKind;
  recovery: string;
};

export const recentGatewayFallbackDiagnostics: OpenClawGatewayFallbackDiagnostic[] = [];

export const maxGatewayFallbackDiagnostics = 20;

export function getRecentOpenClawGatewayFallbackDiagnostics() {
  return [...recentGatewayFallbackDiagnostics];
}

export function recordGatewayFallbackDiagnostic(operation: string, error: unknown) {
  const normalized = normalizeClientError(error);
  clearGatewayFallbackDiagnostic(operation);
  recentGatewayFallbackDiagnostics.unshift({
    at: new Date().toISOString(),
    operation,
    issue: sanitizeGatewayDiagnosticText(normalized.message),
    kind: normalized.kind,
    recovery: resolveGatewayRecoveryMessage(normalized)
  });

  recentGatewayFallbackDiagnostics.splice(maxGatewayFallbackDiagnostics);
}

export function clearGatewayFallbackDiagnostic(operation: string) {
  for (let index = recentGatewayFallbackDiagnostics.length - 1; index >= 0; index -= 1) {
    if (recentGatewayFallbackDiagnostics[index]?.operation === operation) {
      recentGatewayFallbackDiagnostics.splice(index, 1);
    }
  }
}

export function normalizeClientError(error: unknown) {
  if (error instanceof OpenClawGatewayClientError) {
    return new OpenClawGatewayClientError(sanitizeGatewayDiagnosticText(error.message), error.kind, {
      cause: error.cause ?? error
    });
  }

  if (error instanceof NativeGatewayError) {
    return new OpenClawGatewayClientError(sanitizeGatewayDiagnosticText(error.message), error.kind, {
      cause: error.cause ?? error
    });
  }

  const message = error instanceof Error ? error.message : String(error || "OpenClaw Gateway request failed.");
  return new OpenClawGatewayClientError(sanitizeGatewayDiagnosticText(message), classifyGatewayError(message), {
    cause: error
  });
}

export function classifyGatewayError(message: string): OpenClawGatewayClientErrorKind {
  if (/protocol|version|hello|handshake/i.test(message)) {
    return "protocol-mismatch";
  }

  if (/unknown method|method not found|unsupported method/i.test(message)) {
    return "unsupported";
  }

  if (/auth|token|password|unauthorized|forbidden/i.test(message)) {
    return "auth";
  }

  if (/scope|permission|not allowed/i.test(message)) {
    return "scope-limited";
  }

  if (/base\s*hash|basehash|conflict|stale|precondition|version mismatch|already changed/i.test(message)) {
    return "conflict";
  }

  if (/(^|[^a-z])rate limit(?:ed)?\b|retry after|too many requests/i.test(message)) {
    return "rate-limited";
  }

  if (/invalid[_\s-]?request|invalid .*params|invalid json|malformed|schema|payload/i.test(message)) {
    return "malformed-response";
  }

  if (/timed out|timeout/i.test(message)) {
    return "timeout";
  }

  if (/connect|closed|unreachable|websocket/i.test(message)) {
    return "unreachable";
  }

  return "unknown";
}

export function resolveGatewayRecoveryMessage(error: OpenClawGatewayClientError) {
  switch (error.kind) {
    case "auth":
      return "Check the OpenClaw Gateway token/password, then repair local device access in Settings if the operator scope is missing.";
    case "conflict":
      return "Refresh the Gateway config snapshot, then retry the action.";
    case "scope-limited":
      return "Approve AgentOS as an OpenClaw operator with the required read/write/admin scopes.";
    case "protocol-mismatch":
      return `Update OpenClaw or AgentOS so the Gateway protocol overlaps AgentOS' supported range ${MIN_CONTROL_PROTOCOL_VERSION}-${MAX_CONTROL_PROTOCOL_VERSION}.`;
    case "rate-limited":
      return "Wait for the OpenClaw Gateway config cooldown to expire, then retry the action.";
    case "unsupported":
      return "OpenClaw does not advertise this Gateway method; AgentOS will use the compatibility fallback when available.";
    case "timeout":
      return "Restart the OpenClaw Gateway, inspect diagnostics for slow handlers, then retry the action.";
    case "unreachable":
      return "Start or restart the OpenClaw Gateway, verify the endpoint, or keep using CLI fallback only for recovery.";
    case "malformed-response":
      return "Update OpenClaw or report the incompatible Gateway response shape.";
    default:
      return "Inspect OpenClaw diagnostics for the underlying Gateway failure.";
  }
}

export function sanitizeGatewayDiagnosticText(value: string | null | undefined) {
  const text = value?.trim();
  if (!text) {
    return "";
  }

  return redactSecretText(text)
    .replace(
      /\b(authorization|bearer|token|password|secret|api[_-]?key)\b(\s*[:=]\s*)(["']?)[^\s"',;}{]+/gi,
      (_match, key: string, separator: string, quote: string) => `${key}${separator}${quote}[redacted]`
    )
    .replace(
      /\b(AGENTOS_OPENCLAW_GATEWAY_TOKEN|OPENCLAW_GATEWAY_TOKEN|AGENTOS_OPENCLAW_GATEWAY_PASSWORD|OPENCLAW_GATEWAY_PASSWORD)=["']?[^"'\s]+/g,
      (_match, key: string) => `${key}=[redacted]`
    )
    .replace(/__OPENCLAW_REDACTED__/g, "[redacted]");
}

export function clearGatewayFallbackDiagnosticsForTesting() {
  recentGatewayFallbackDiagnostics.length = 0;
}
