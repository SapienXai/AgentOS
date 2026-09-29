import "server-only";

import type {
  OpenClawGatewayClientDiagnostics,
  OpenClawGatewayRecentFallbackDiagnostic
} from "@/lib/openclaw/client/types";
import {
  classifyGatewayFallbackImpact,
  isGatewayFallbackDiagnosticCurrent
} from "@/lib/openclaw/diagnostics/gateway-fallback-policy";

export function isOpenClawGatewayTransportIssueActive(
  transport: OpenClawGatewayClientDiagnostics | null | undefined
) {
  if (!transport) {
    return true;
  }

  if (transport.gatewayMode !== "native-ws" || transport.connectionState !== "connected") {
    return true;
  }

  if (!transport.lastNativeError && !transport.recovery) {
    return false;
  }

  if (!transport.lastNativeFailureAt || !transport.lastConnectedAt) {
    return false;
  }

  if (!isDiagnosticAtOrAfter(transport.lastNativeFailureAt, transport.lastConnectedAt)) {
    return false;
  }

  if (!transport.lastNativeFailureOperation) {
    return true;
  }

  return classifyGatewayFallbackImpact({
    operation: transport.lastNativeFailureOperation,
    kind: transport.lastNativeFailureKind,
    issue: transport.lastNativeError
  }) !== "informational";
}

export function isOpenClawGatewayFallbackDiagnosticActive(
  diagnostic: Pick<OpenClawGatewayRecentFallbackDiagnostic, "at">,
  transport: OpenClawGatewayClientDiagnostics | null | undefined
) {
  if (!transport) {
    return true;
  }

  if (transport.connectionState !== "connected") {
    return true;
  }

  return isGatewayFallbackDiagnosticCurrent(diagnostic, transport.lastConnectedAt);
}

export function filterActiveOpenClawGatewayFallbackDiagnostics<TDiagnostic extends { at: string }>(
  diagnostics: TDiagnostic[],
  transport: OpenClawGatewayClientDiagnostics | null | undefined
) {
  return diagnostics.filter((diagnostic) =>
    isOpenClawGatewayFallbackDiagnosticActive(diagnostic, transport)
  );
}

function isDiagnosticAtOrAfter(value: string | null | undefined, boundary: string | null | undefined) {
  if (!boundary) {
    return true;
  }

  if (!value) {
    return false;
  }

  const valueTime = Date.parse(value);
  const boundaryTime = Date.parse(boundary);

  if (!Number.isFinite(valueTime) || !Number.isFinite(boundaryTime)) {
    return true;
  }

  return valueTime >= boundaryTime;
}
