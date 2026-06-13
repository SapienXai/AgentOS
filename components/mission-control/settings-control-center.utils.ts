import type { MissionControlSnapshot } from "@/lib/agentos/contracts";

export type SnapshotStreamState = "connecting" | "live" | "retrying";
export type TransportStatusTone = "success" | "warning" | "danger" | "neutral";
export type OpenClawCapabilityRowStatus =
  | "gateway-native"
  | "cli-fallback"
  | "degraded"
  | "disabled"
  | "unknown"
  | "missing";

export type OpenClawCapabilityMatrixRow = {
  id: string;
  label: string;
  status: OpenClawCapabilityRowStatus;
  statusLabel: string;
  tone: TransportStatusTone;
  baseline: "required" | "optional" | "experimental" | "unknown";
  preferredMethod: string | null;
  supportedMethod: string | null;
  aliasMethods: string[];
  methods: string[];
  events: string[];
  methodCoverageLabel: string;
  fallbackAllowed: boolean;
  fallbackCount: number;
  fallbackIssue: string | null;
  fallbackKind: string | null;
  fallbackRecovery: string | null;
  reason: string;
  recovery: string | null;
  compatibility: "preferred" | "alias" | "missing" | "unknown";
  missingMethods: string[];
  missingRequiredMethods: string[];
  missingOptionalMethods: string[];
  missingExperimentalMethods: string[];
};

export type OpenClawCapabilityMatrixSummary = {
  openClawVersionLabel: string;
  recommendedVersionLabel: string;
  agentOsCompatibilityLabel: string;
  gatewayProtocolLabel: string;
  totalOperationCount: number;
  nativeOperationCount: number;
  cliFallbackOperationCount: number;
  missingRequiredOperationCount: number;
  unknownOrDegradedOperationCount: number;
  disabledOperationCount: number;
  fallbackTotal: number;
  lastNativeFailure: string | null;
};

export type TransportDiagnosticsSummary = {
  modeLabel: string;
  gatewayModeLabel: string;
  statusLabel: string;
  connectionLabel: string;
  protocolLabel: string;
  protocolRangeLabel: string;
  streamLabel: string;
  eventBridgeLabel: string;
  eventBridgeLastEventLabel: string;
  eventBridgeLastError: string | null;
  eventBridgeRecovery: string | null;
  eventBridgeTone: TransportStatusTone;
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
type EventBridgeDiagnostics = MissionControlSnapshot["diagnostics"]["eventBridge"];
type EventBridgeMode = NonNullable<EventBridgeDiagnostics>["mode"];
type GatewayDiagnostics = MissionControlSnapshot["diagnostics"];
type CapabilityMatrix = GatewayDiagnostics["capabilityMatrix"];
type CapabilityOperation = NonNullable<NonNullable<CapabilityMatrix>["operations"]>[string];
type GatewayMethodContractAudit = NonNullable<NonNullable<CapabilityMatrix>["compatibility"]>["methodContract"];
type GatewayFallbackDiagnostic =
  | NonNullable<GatewayDiagnostics["gatewayFallbackDiagnostics"]>[number]
  | NonNullable<NonNullable<CapabilityMatrix>["fallbackDiagnostics"]>[number]
  | NonNullable<TransportDiagnostics["recentFallbackDiagnostics"]>[number];

export function resolveTransportDiagnosticsSummary(
  transport: TransportDiagnostics | undefined,
  streamState: SnapshotStreamState,
  eventBridge?: EventBridgeDiagnostics
): TransportDiagnosticsSummary {
  const fallbackTotal = sumFallbackCounts(transport?.fallbackCounts);
  const activeFallbackTotal = hasFallbackAfterLastConnected(
    transport?.recentFallbackDiagnostics ?? [],
    transport?.lastConnectedAt ?? null
  )
    ? fallbackTotal
    : 0;
  const connectionLabel = formatTransportConnectionState(transport?.connectionState);
  const streamLabel = formatSnapshotStreamState(streamState);
  const eventBridgeSummary = resolveEventBridgeDiagnosticsSummary(eventBridge);

  return {
    modeLabel: formatTransportMode(transport?.mode),
    gatewayModeLabel: formatGatewayMode(transport?.gatewayMode),
    statusLabel: formatGatewayStatusLabel(transport),
    connectionLabel,
    protocolLabel: formatProtocolVersion(transport?.protocolVersion),
    protocolRangeLabel: formatProtocolRange(transport?.protocolRange),
    streamLabel,
    eventBridgeLabel: eventBridgeSummary.label,
    eventBridgeLastEventLabel: eventBridgeSummary.lastEventLabel,
    eventBridgeLastError: eventBridgeSummary.lastError,
    eventBridgeRecovery: eventBridgeSummary.recovery,
    eventBridgeTone: eventBridgeSummary.tone,
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
      fallbackTotal: activeFallbackTotal
    })
  };
}

export function buildOpenClawCapabilityRows(
  diagnostics: GatewayDiagnostics
): OpenClawCapabilityMatrixRow[] {
  const capabilityMatrix = diagnostics.capabilityMatrix;
  const operations = capabilityMatrix?.operations ?? {};
  const contract = capabilityMatrix?.compatibility?.methodContract;
  const fallbackDiagnostics = [
    ...(diagnostics.gatewayFallbackDiagnostics ?? []),
    ...(capabilityMatrix?.fallbackDiagnostics ?? []),
    ...(diagnostics.compatibilityReport?.fallback.diagnostics ?? []),
    ...(diagnostics.transport?.recentFallbackDiagnostics ?? [])
  ];
  const fallbackCounts = diagnostics.transport?.fallbackCounts ?? {};
  const operationEntries = Object.entries(operations);
  const rows = operationEntries.length > 0
    ? operationEntries.map(([id, operation]) => buildCapabilityRowFromOperation({
      id,
      operation,
      contract,
      fallbackCounts,
      fallbackDiagnostics
    }))
    : buildCapabilityRowsFromCompatibilityReport(diagnostics, fallbackCounts, fallbackDiagnostics);

  return rows.sort((left, right) => {
    const baselineOrder = baselineSortOrder(left.baseline) - baselineSortOrder(right.baseline);
    if (baselineOrder !== 0) {
      return baselineOrder;
    }

    const statusOrder = statusSortOrder(left.status) - statusSortOrder(right.status);
    if (statusOrder !== 0) {
      return statusOrder;
    }

    return left.label.localeCompare(right.label);
  });
}

function buildCapabilityRowFromOperation({
  id,
  operation,
  contract,
  fallbackCounts,
  fallbackDiagnostics
}: {
  id: string;
  operation: CapabilityOperation;
  contract: GatewayMethodContractAudit | undefined;
  fallbackCounts: Record<string, number>;
  fallbackDiagnostics: GatewayFallbackDiagnostic[];
}): OpenClawCapabilityMatrixRow {
    const missing = resolveOperationMissingState(id, operation, contract);
    const fallback = resolveOperationFallbackState(id, operation, fallbackCounts, fallbackDiagnostics);
    const status = resolveCapabilityRowStatus(operation, missing);
    const baseline: OpenClawCapabilityMatrixRow["baseline"] = operation.baseline ?? "unknown";

    return {
      id,
      label: operation.label || titleizeOperationId(id),
      status,
      statusLabel: formatCapabilityRowStatus(status),
      tone: capabilityRowTone(status),
      baseline,
      preferredMethod: operation.preferredMethod ?? null,
      supportedMethod: operation.supportedMethod ?? null,
      aliasMethods: operation.aliasMethods ?? [],
      methods: operation.methods ?? [],
      events: operation.events ?? [],
      methodCoverageLabel: formatCapabilityMethodCoverage(operation, missing),
      fallbackAllowed: operation.fallbackAllowed,
      fallbackCount: fallback.count,
      fallbackIssue: fallback.issue,
      fallbackKind: fallback.kind,
      fallbackRecovery: fallback.recovery,
      reason: operation.reason || missing.reason || "No diagnostic reason reported.",
      recovery: missing.recovery ?? operation.recovery ?? fallback.recovery,
      compatibility: operation.compatibility ?? "unknown",
      missingMethods: missing.methods,
      missingRequiredMethods: missing.requiredMethods,
      missingOptionalMethods: missing.optionalMethods,
      missingExperimentalMethods: missing.experimentalMethods
    };
}

function buildCapabilityRowsFromCompatibilityReport(
  diagnostics: GatewayDiagnostics,
  fallbackCounts: Record<string, number>,
  fallbackDiagnostics: GatewayFallbackDiagnostic[]
): OpenClawCapabilityMatrixRow[] {
  return (diagnostics.compatibilityReport?.contracts ?? []).map((check) => {
    const operation: CapabilityOperation = {
      label: check.label,
      mode: resolveContractOperationMode(check),
      methods: check.methods,
      events: check.events,
      fallbackAllowed: check.cliFallbackAvailable,
      baseline: check.baseline,
      reason: check.reason,
      recovery: check.suggestedRecovery,
      preferredMethod: check.methods[0] ?? null,
      supportedMethod: check.supportedMethod,
      aliasMethods: resolveContractAliasMethods(check.methods, check.supportedMethod),
      compatibility: resolveContractCompatibility(check)
    };

    return buildCapabilityRowFromOperation({
      id: check.operation,
      operation,
      contract: createContractAuditFromCompatibilityReport(diagnostics, check.operation),
      fallbackCounts,
      fallbackDiagnostics
    });
  });
}

function resolveContractOperationMode(
  check: NonNullable<GatewayDiagnostics["compatibilityReport"]>["contracts"][number]
): CapabilityOperation["mode"] {
  if (check.status === "ok" && check.nativeGatewaySupported) {
    return "gateway-native";
  }

  if (check.status === "degraded") {
    return check.nativeGatewaySupported ? "degraded" : "cli-fallback";
  }

  if (check.status === "unsupported" && check.cliFallbackAvailable) {
    return "cli-fallback";
  }

  if (check.status === "unsupported") {
    return "disabled";
  }

  if (check.status === "failed") {
    return "degraded";
  }

  return "unknown";
}

function resolveContractCompatibility(
  check: NonNullable<GatewayDiagnostics["compatibilityReport"]>["contracts"][number]
): CapabilityOperation["compatibility"] {
  if (check.supportedMethod) {
    return check.methods.includes(check.supportedMethod) ? "preferred" : "alias";
  }

  if (check.status === "unsupported" || check.status === "failed") {
    return "missing";
  }

  return "unknown";
}

function resolveContractAliasMethods(methods: string[], supportedMethod: string | null) {
  if (!supportedMethod || methods.includes(supportedMethod)) {
    return [];
  }

  return [supportedMethod];
}

function createContractAuditFromCompatibilityReport(
  diagnostics: GatewayDiagnostics,
  operationId: string
): GatewayMethodContractAudit | undefined {
  const report = diagnostics.compatibilityReport;
  if (!report) {
    return undefined;
  }

  const missingContracts = report.contracts.filter((check) => !check.nativeGatewaySupported);
  const missingMethods = missingContracts.flatMap((check) => check.methods);
  const missingOperations = missingContracts.map((check) => `${check.operation}: ${check.methods.join(", ")}`);
  const targetContract = report.contracts.find((check) => check.operation === operationId);

  return {
    status: missingMethods.length > 0 ? "drift" : "verified",
    checkedAt: report.generatedAt,
    source: report.gateway.capabilitySource === "unavailable" ? "unavailable" : "rpc.discover",
    refreshIntervalMs: 0,
    expectedMethodCount: report.contracts.reduce((total, check) => total + check.methods.length, 0),
    advertisedMethodCount: report.gateway.effectiveMethodCount,
    missingMethodCount: missingMethods.length,
    missingMethods,
    missingOperations,
    requiredMethodCount: report.contracts.filter((check) => check.baseline === "required").length,
    missingRequiredMethods: missingContracts
      .filter((check) => check.baseline === "required")
      .flatMap((check) => check.methods),
    optionalMethodCount: report.contracts.filter((check) => check.baseline === "optional").length,
    missingOptionalMethods: missingContracts
      .filter((check) => check.baseline === "optional")
      .flatMap((check) => check.methods),
    experimentalMethodCount: report.contracts.filter((check) => check.baseline === "experimental").length,
    missingExperimentalMethods: missingContracts
      .filter((check) => check.baseline === "experimental")
      .flatMap((check) => check.methods),
    reason: targetContract?.reason ?? report.statusReason
  };
}

export function summarizeOpenClawCapabilityRows(
  diagnostics: GatewayDiagnostics,
  rows: OpenClawCapabilityMatrixRow[]
): OpenClawCapabilityMatrixSummary {
  const capabilityMatrix = diagnostics.capabilityMatrix;
  const compatibilityReport = diagnostics.compatibilityReport;
  const compatibility = capabilityMatrix?.compatibility;
  const transport = diagnostics.transport;
  const fallbackTotal = transport?.fallbackTotal ?? sumFallbackCounts(transport?.fallbackCounts);
  const missingRequiredOperationCount = rows.filter((row) => row.missingRequiredMethods.length > 0).length;
  const unknownOrDegradedOperationCount = rows.filter((row) => row.status === "unknown" || row.status === "degraded").length;

  return {
    openClawVersionLabel: formatVersionForCapabilitySummary(
      compatibilityReport?.openClaw.installedVersion ?? capabilityMatrix?.openClawVersion ?? diagnostics.version ?? null
    ),
    recommendedVersionLabel: formatVersionForCapabilitySummary(
      compatibilityReport?.openClaw.recommendedVersion ?? diagnostics.updateCompatibility?.recommendedVersion ?? diagnostics.latestVersion ?? null
    ),
    agentOsCompatibilityLabel: compatibilityReport
      ? formatCompatibilityStatus(compatibilityReport.status)
      : formatProtocolCompatibilityStatus(compatibility?.protocol.status),
    gatewayProtocolLabel: formatCapabilityGatewayProtocol(
      compatibilityReport?.gateway.protocolVersion ?? capabilityMatrix?.gatewayProtocolVersion ?? transport?.protocolVersion ?? null
    ),
    totalOperationCount: rows.length,
    nativeOperationCount: rows.filter((row) => row.status === "gateway-native").length,
    cliFallbackOperationCount: rows.filter((row) => row.status === "cli-fallback" || row.fallbackCount > 0).length,
    missingRequiredOperationCount,
    unknownOrDegradedOperationCount,
    disabledOperationCount: rows.filter((row) => row.status === "disabled").length,
    fallbackTotal,
    lastNativeFailure: transport?.lastNativeError?.trim() || null
  };
}

export function resolveEventBridgeDiagnosticsSummary(eventBridge: EventBridgeDiagnostics | undefined) {
  const mode = eventBridge?.mode;
  return {
    label: formatEventBridgeMode(mode),
    lastEventLabel: formatTransportTimestamp(eventBridge?.lastEventAt),
    lastError: eventBridge?.lastError?.trim() || null,
    recovery: eventBridge?.recovery?.trim() || null,
    tone: resolveEventBridgeTone(mode)
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

function resolveCapabilityRowStatus(
  operation: CapabilityOperation,
  missing: ReturnType<typeof resolveOperationMissingState>
): OpenClawCapabilityRowStatus {
  if (missing.isMissing || operation.compatibility === "missing") {
    return "missing";
  }

  return operation.mode;
}

function resolveOperationMissingState(
  operationId: string,
  operation: CapabilityOperation,
  contract: GatewayMethodContractAudit | undefined
) {
  const missingOperationDetails = (contract?.missingOperations ?? [])
    .map((entry) => parseMissingOperationEntry(entry))
    .filter((entry) => entry.operationId === operationId);
  const expectedMethods = new Set([
    operation.preferredMethod ?? "",
    operation.supportedMethod ?? "",
    ...(operation.methods ?? [])
  ].filter(Boolean));
  const allMissingMethods = collectMissingMethods(operation, expectedMethods, contract?.missingMethods, missingOperationDetails);
  const requiredMethods = collectMissingMethods(
    operation,
    expectedMethods,
    contract?.missingRequiredMethods,
    operation.baseline === "required" ? missingOperationDetails : []
  );
  const optionalMethods = collectMissingMethods(
    operation,
    expectedMethods,
    contract?.missingOptionalMethods,
    operation.baseline === "optional" ? missingOperationDetails : []
  );
  const experimentalMethods = collectMissingMethods(
    operation,
    expectedMethods,
    contract?.missingExperimentalMethods,
    operation.baseline === "experimental" ? missingOperationDetails : []
  );
  const isMissing =
    allMissingMethods.length > 0 ||
    missingOperationDetails.length > 0 ||
    operation.compatibility === "missing";
  const reason = isMissing
    ? contract?.reason || operation.reason || "OpenClaw Gateway does not advertise the required native method."
    : null;
  const recovery = isMissing
    ? operation.recovery || "Update OpenClaw or use the certified AgentOS/OpenClaw compatibility baseline."
    : null;

  return {
    isMissing,
    methods: allMissingMethods,
    requiredMethods,
    optionalMethods,
    experimentalMethods,
    reason,
    recovery
  };
}

function collectMissingMethods(
  operation: CapabilityOperation,
  expectedMethods: Set<string>,
  missingMethods: string[] | undefined,
  missingOperationDetails: Array<{ operationId: string; detail: string | null }>
) {
  const values = new Set<string>();

  for (const method of missingMethods ?? []) {
    if (expectedMethods.has(method)) {
      values.add(method);
    }
  }

  for (const entry of missingOperationDetails) {
    if (entry.detail) {
      values.add(entry.detail);
    }
  }

  if (values.size === 0 && operation.compatibility === "missing") {
    for (const method of operation.methods ?? []) {
      values.add(method);
    }

    if (operation.preferredMethod) {
      values.add(operation.preferredMethod);
    }
  }

  return Array.from(values);
}

function parseMissingOperationEntry(value: string) {
  const [operationId, detail] = value.split(/:\s*/, 2);
  return {
    operationId: operationId || value,
    detail: detail || null
  };
}

function resolveOperationFallbackState(
  operationId: string,
  operation: CapabilityOperation,
  fallbackCounts: Record<string, number>,
  fallbackDiagnostics: GatewayFallbackDiagnostic[]
) {
  const operationKeys = new Set([
    operationId,
    operation.preferredMethod ?? "",
    operation.supportedMethod ?? "",
    ...(operation.methods ?? [])
  ].filter(Boolean));
  const count = Object.entries(fallbackCounts).reduce((total, [key, value]) => {
    if (!operationKeys.has(key) || !Number.isFinite(value) || value <= 0) {
      return total;
    }

    return total + value;
  }, 0);
  const diagnostic = fallbackDiagnostics.find((entry) => operationKeys.has(entry.operation));

  return {
    count,
    issue: diagnostic?.issue?.trim() || null,
    kind: diagnostic?.kind?.trim() || null,
    recovery: diagnostic?.recovery?.trim() || (diagnostic?.kind ? resolveGatewayFallbackRecovery(diagnostic.kind) : null)
  };
}

function formatCapabilityMethodCoverage(
  operation: CapabilityOperation,
  missing: ReturnType<typeof resolveOperationMissingState>
) {
  if (missing.methods.length > 0) {
    return `Missing ${formatMethodList(missing.methods)}`;
  }

  if (operation.compatibility === "alias" && operation.supportedMethod) {
    return `Alias via ${operation.supportedMethod}`;
  }

  if (operation.supportedMethod) {
    return `Native ${operation.supportedMethod}`;
  }

  if (operation.preferredMethod) {
    return `Preferred ${operation.preferredMethod}`;
  }

  if (operation.methods.length > 0) {
    return formatMethodList(operation.methods);
  }

  return "No native method advertised";
}

function formatCapabilityRowStatus(status: OpenClawCapabilityRowStatus) {
  switch (status) {
    case "gateway-native":
      return "Native Gateway";
    case "cli-fallback":
      return "CLI fallback";
    case "degraded":
      return "Degraded";
    case "disabled":
      return "Disabled";
    case "missing":
      return "Missing native method";
    case "unknown":
    default:
      return "Unknown";
  }
}

function capabilityRowTone(status: OpenClawCapabilityRowStatus): TransportStatusTone {
  switch (status) {
    case "gateway-native":
      return "success";
    case "cli-fallback":
    case "degraded":
      return "warning";
    case "disabled":
    case "missing":
      return "danger";
    case "unknown":
    default:
      return "neutral";
  }
}

function baselineSortOrder(value: OpenClawCapabilityMatrixRow["baseline"]) {
  switch (value) {
    case "required":
      return 0;
    case "optional":
      return 1;
    case "experimental":
      return 2;
    case "unknown":
    default:
      return 3;
  }
}

function statusSortOrder(value: OpenClawCapabilityRowStatus) {
  switch (value) {
    case "missing":
      return 0;
    case "disabled":
      return 1;
    case "cli-fallback":
      return 2;
    case "degraded":
      return 3;
    case "unknown":
      return 4;
    case "gateway-native":
    default:
      return 5;
  }
}

function formatMethodList(values: string[]) {
  const unique = Array.from(new Set(values));
  const visible = unique.slice(0, 2);
  const suffix = unique.length > visible.length ? ` +${unique.length - visible.length}` : "";
  return `${visible.join(", ")}${suffix}`;
}

function titleizeOperationId(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Gateway operation";
}

function formatVersionForCapabilitySummary(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "Unknown";
  }

  return `v${String(value).replace(/^v/i, "")}`;
}

function formatCompatibilityStatus(value: string) {
  switch (value) {
    case "compatible":
      return "Compatible";
    case "degraded":
      return "Degraded";
    case "incompatible":
      return "Incompatible";
    case "unknown":
    default:
      return "Unknown";
  }
}

function formatProtocolCompatibilityStatus(value?: string) {
  switch (value) {
    case "compatible":
      return "Compatible";
    case "unsupported":
      return "Unsupported";
    case "unknown":
    default:
      return "Unknown";
  }
}

function formatCapabilityGatewayProtocol(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "Unknown";
  }

  return `v${String(value).replace(/^v/i, "")}`;
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

function formatEventBridgeMode(mode: EventBridgeMode | undefined) {
  switch (mode) {
    case "live":
      return "Gateway events: Live";
    case "reconnecting":
      return "Gateway events: Reconnecting";
    case "polling":
      return "Gateway events: Polling";
    default:
      return "Gateway events: Unknown";
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

function resolveEventBridgeTone(mode: EventBridgeMode | undefined): TransportStatusTone {
  if (mode === "live") {
    return "success";
  }

  if (mode === "reconnecting" || mode === "polling") {
    return "warning";
  }

  return "neutral";
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

function hasFallbackAfterLastConnected(
  diagnostics: NonNullable<TransportDiagnostics["recentFallbackDiagnostics"]>,
  lastConnectedAt: string | null
) {
  if (diagnostics.length === 0) {
    return false;
  }

  if (!lastConnectedAt) {
    return true;
  }

  const connectedMs = Date.parse(lastConnectedAt);
  if (!Number.isFinite(connectedMs)) {
    return true;
  }

  return diagnostics.some((entry) => {
    const fallbackMs = Date.parse(entry.at);
    return !Number.isFinite(fallbackMs) || fallbackMs >= connectedMs;
  });
}
