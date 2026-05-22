import type { MissionControlSnapshot } from "@/lib/agentos/contracts";

export type SnapshotStreamState = "connecting" | "live" | "retrying";
export type TransportStatusTone = "success" | "warning" | "danger" | "neutral";

export type TransportDiagnosticsSummary = {
  modeLabel: string;
  gatewayModeLabel: string;
  statusLabel: string;
  connectionLabel: string;
  protocolLabel: string;
  protocolRangeLabel: string;
  streamLabel: string;
  fallbackTotal: number;
  fallbackOperationCount: number;
  fallbackSummaryLabel: string;
  lastConnectedLabel: string;
  lastDisconnectedLabel: string;
  lastNativeError: string | null;
  recovery: string | null;
  recentFallbackDiagnostics: NonNullable<TransportDiagnostics["recentFallbackDiagnostics"]>;
  statusTone: TransportStatusTone;
};

type TransportDiagnostics = NonNullable<MissionControlSnapshot["diagnostics"]["transport"]>;

export function resolveTransportDiagnosticsSummary(
  transport: TransportDiagnostics | undefined,
  streamState: SnapshotStreamState
): TransportDiagnosticsSummary {
  const fallbackTotal = sumFallbackCounts(transport?.fallbackCounts);
  const connectionLabel = formatTransportConnectionState(transport?.connectionState);
  const streamLabel = formatSnapshotStreamState(streamState);

  return {
    modeLabel: formatTransportMode(transport?.mode),
    gatewayModeLabel: formatGatewayMode(transport?.gatewayMode),
    statusLabel: formatGatewayStatusLabel(transport),
    connectionLabel,
    protocolLabel: formatProtocolVersion(transport?.protocolVersion),
    protocolRangeLabel: formatProtocolRange(transport?.protocolRange),
    streamLabel,
    fallbackTotal,
    fallbackOperationCount: countFallbackOperations(transport?.fallbackCounts),
    fallbackSummaryLabel: formatFallbackSummary(transport?.fallbackTotal ?? fallbackTotal, transport?.fallbackCounts),
    lastConnectedLabel: formatTransportTimestamp(transport?.lastConnectedAt),
    lastDisconnectedLabel: formatTransportTimestamp(transport?.lastDisconnectedAt),
    lastNativeError: transport?.lastNativeError?.trim() || null,
    recovery: transport?.recovery?.trim() || null,
    recentFallbackDiagnostics: transport?.recentFallbackDiagnostics ?? [],
    statusTone: resolveTransportStatusTone({
      gatewayMode: transport?.gatewayMode,
      connectionState: transport?.connectionState,
      mode: transport?.mode,
      streamState,
      fallbackTotal
    })
  };
}

export function sumFallbackCounts(fallbackCounts: Record<string, number> | undefined) {
  return Object.values(fallbackCounts ?? {}).reduce((total, value) => {
    return Number.isFinite(value) && value > 0 ? total + value : total;
  }, 0);
}

export function countFallbackOperations(fallbackCounts: Record<string, number> | undefined) {
  return Object.values(fallbackCounts ?? {}).filter((value) => Number.isFinite(value) && value > 0).length;
}

export function formatGatewayFallbackDiagnosticKind(kind?: string | null) {
  switch (kind) {
    case "auth":
      return "Needs credential";
    case "scope-limited":
      return "Needs scope repair";
    case "protocol-mismatch":
      return "Protocol mismatch";
    case "rate-limited":
      return "Rate limited";
    case "unsupported":
      return "Unsupported method";
    case "disabled":
      return "Disabled";
    case "unreachable":
      return "Unreachable";
    case "timeout":
      return "Timed out";
    case "malformed-response":
      return "Invalid response";
    default:
      return "Gateway fallback";
  }
}

export function resolveGatewayFallbackRecovery(kind?: string | null) {
  switch (kind) {
    case "auth":
      return "Check the Gateway token/password, then restart AgentOS.";
    case "scope-limited":
      return "Repair local device access so AgentOS has operator scopes.";
    case "protocol-mismatch":
      return "Update OpenClaw or AgentOS so the Gateway protocol versions overlap.";
    case "rate-limited":
      return "Wait for the Gateway cooldown to expire, then retry the config action.";
    case "unsupported":
      return "Update OpenClaw or check AgentOS/OpenClaw compatibility for this method.";
    case "timeout":
      return "Restart the Gateway and inspect OpenClaw diagnostics for slow handlers.";
    case "unreachable":
      return "Start or repair the OpenClaw Gateway.";
    case "malformed-response":
      return "Update OpenClaw or report the incompatible Gateway response.";
    default:
      return "Inspect diagnostics and retry after Gateway repair.";
  }
}

function formatTransportMode(mode: TransportDiagnostics["mode"] | undefined) {
  if (mode === "native-ws") {
    return "Native WS";
  }

  if (mode === "cli") {
    return "CLI forced";
  }

  return "Unknown";
}

function formatGatewayMode(mode: TransportDiagnostics["gatewayMode"] | undefined) {
  switch (mode) {
    case "native-ws":
      return "native-ws";
    case "cli-forced":
      return "cli-forced";
    case "fallback-active":
      return "fallback-active";
    case "degraded":
      return "degraded";
    case "unreachable":
      return "unreachable";
    default:
      return "unknown";
  }
}

function formatGatewayStatusLabel(transport: TransportDiagnostics | undefined) {
  if (transport?.statusLabel) {
    return transport.statusLabel;
  }

  if (!transport) {
    return "Native Gateway: Unknown";
  }

  if (transport.mode === "cli" || transport.connectionState === "cli-forced") {
    return "CLI fallback forced";
  }

  if (sumFallbackCounts(transport.fallbackCounts) > 0) {
    return "CLI fallback used";
  }

  if (transport.connectionState === "connected") {
    return "Native Gateway: OK";
  }

  if (transport.connectionState === "error") {
    return "Native Gateway: Unreachable";
  }

  return "Native Gateway: Degraded";
}

function formatTransportConnectionState(state: TransportDiagnostics["connectionState"] | undefined) {
  switch (state) {
    case "cli-forced":
      return "CLI forced";
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "idle":
      return "Idle";
    case "closed":
      return "Closed";
    case "error":
      return "Error";
    default:
      return "Unknown";
  }
}

function formatProtocolVersion(version: TransportDiagnostics["protocolVersion"] | undefined) {
  return typeof version === "number" && Number.isFinite(version) ? `v${version}` : "Unknown";
}

function formatProtocolRange(range: TransportDiagnostics["protocolRange"] | undefined) {
  if (!range || typeof range.min !== "number" || typeof range.max !== "number") {
    return "Unknown";
  }

  return `v${range.min}-v${range.max} supported`;
}

function formatFallbackSummary(
  fallbackTotal: number,
  fallbackCounts: Record<string, number> | undefined
) {
  const operationCount = countFallbackOperations(fallbackCounts);
  if (fallbackTotal <= 0 || operationCount <= 0) {
    return "CLI fallback used: 0 operations";
  }

  return `CLI fallback used: ${fallbackTotal} ${fallbackTotal === 1 ? "operation" : "operations"} across ${operationCount} ${operationCount === 1 ? "method" : "methods"}`;
}

function formatSnapshotStreamState(state: SnapshotStreamState) {
  switch (state) {
    case "live":
      return "Live";
    case "retrying":
      return "Retrying";
    case "connecting":
    default:
      return "Connecting";
  }
}

function formatTransportTimestamp(value: string | null | undefined) {
  if (!value) {
    return "Not yet";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function resolveTransportStatusTone(input: {
  gatewayMode: TransportDiagnostics["gatewayMode"] | undefined;
  connectionState: TransportDiagnostics["connectionState"] | undefined;
  mode: TransportDiagnostics["mode"] | undefined;
  streamState: SnapshotStreamState;
  fallbackTotal: number;
}): TransportStatusTone {
  if (input.streamState === "retrying" || input.connectionState === "error" || input.gatewayMode === "unreachable") {
    return "danger";
  }

  if (
    input.mode === "cli" ||
    input.connectionState === "cli-forced" ||
    input.connectionState === "closed" ||
    input.connectionState === "connecting" ||
    input.gatewayMode === "fallback-active" ||
    input.gatewayMode === "degraded" ||
    input.fallbackTotal > 0
  ) {
    return "warning";
  }

  if (input.connectionState === "connected" && input.streamState === "live") {
    return "success";
  }

  return "neutral";
}
