import type { MissionControlSnapshot } from "@/lib/agentos/contracts";

export type SnapshotStreamState = "connecting" | "live" | "retrying";
export type TransportStatusTone = "success" | "warning" | "danger" | "neutral";

export type TransportDiagnosticsSummary = {
  modeLabel: string;
  connectionLabel: string;
  protocolLabel: string;
  streamLabel: string;
  fallbackTotal: number;
  lastConnectedLabel: string;
  lastDisconnectedLabel: string;
  lastNativeError: string | null;
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
    connectionLabel,
    protocolLabel: formatProtocolVersion(transport?.protocolVersion),
    streamLabel,
    fallbackTotal,
    lastConnectedLabel: formatTransportTimestamp(transport?.lastConnectedAt),
    lastDisconnectedLabel: formatTransportTimestamp(transport?.lastDisconnectedAt),
    lastNativeError: transport?.lastNativeError?.trim() || null,
    statusTone: resolveTransportStatusTone({
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

function formatTransportMode(mode: TransportDiagnostics["mode"] | undefined) {
  if (mode === "native-ws") {
    return "Native WS";
  }

  if (mode === "cli") {
    return "CLI forced";
  }

  return "Unknown";
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
  connectionState: TransportDiagnostics["connectionState"] | undefined;
  mode: TransportDiagnostics["mode"] | undefined;
  streamState: SnapshotStreamState;
  fallbackTotal: number;
}): TransportStatusTone {
  if (input.streamState === "retrying" || input.connectionState === "error") {
    return "danger";
  }

  if (
    input.mode === "cli" ||
    input.connectionState === "cli-forced" ||
    input.connectionState === "closed" ||
    input.connectionState === "connecting" ||
    input.fallbackTotal > 0
  ) {
    return "warning";
  }

  if (input.connectionState === "connected" && input.streamState === "live") {
    return "success";
  }

  return "neutral";
}
