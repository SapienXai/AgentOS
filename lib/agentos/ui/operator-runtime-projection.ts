import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import {
  classifyGatewayFallbackImpact,
  isGatewayFallbackDiagnosticCurrent,
  type GatewayFallbackDiagnosticLike
} from "@/lib/openclaw/diagnostics/gateway-fallback-policy";

/**
 * The Mission Control snapshot cache is refreshed on a 30 second TTL. Keep the
 * operator-facing freshness boundary aligned with that contract instead of
 * inventing a page-specific clock.
 */
export const OPERATOR_SNAPSHOT_FRESHNESS_MAX_AGE_MS = 30_000;

export type OperatorRuntimeState = "ready" | "degraded" | "connecting" | "blocked" | "offline" | "unknown";
export type OperatorRuntimeAuthority = "native-gateway" | "cli-fallback" | "snapshot" | "unavailable";
export type OperatorTransportState = "live" | "connecting" | "retrying" | "offline" | "unknown";
export type OperatorFreshnessState = "live" | "reconnecting" | "snapshot" | "stale" | "unknown";
export type OperatorCompatibilityState = "compatible" | "degraded" | "incompatible" | "unknown";

export type OperatorRuntimeProjection = {
  state: OperatorRuntimeState;
  stateLabel: string;
  tone: "success" | "warning" | "danger" | "muted";
  transport: {
    state: OperatorTransportState;
    label: string;
  };
  authority: {
    mode: OperatorRuntimeAuthority;
    label: string;
  };
  gateway: {
    installed: boolean;
    loaded: boolean;
    rpcReady: boolean;
    health: MissionControlSnapshot["diagnostics"]["health"];
    healthLabel: string;
  };
  fallback: {
    active: boolean;
    operationCount: number;
    degradedOperationCount: number;
    blockingOperationCount: number;
    informationalOperationCount: number;
    lastReason: string | null;
  };
  coverage: {
    nativeOperationCount: number;
    nativeCoveragePercent: number | null;
  };
  compatibility: {
    state: OperatorCompatibilityState;
    label: string;
  };
  freshness: {
    generatedAt: string;
    ageMs: number | null;
    state: OperatorFreshnessState;
    label: string;
    stale: boolean;
  };
  scope: {
    kind: "workspace" | "global";
    workspaceId: string | null;
    label: string;
    detail: string;
  };
  attention: {
    actionableCount: number;
    informationalCount: number;
  };
  explanation: string;
  primaryRecovery: {
    id: "reconnect" | "runtime-inbox" | "gateway-diagnostics" | "gateway-permissions" | "setup" | "compatibility";
    label: string;
    href: string;
  } | null;
};

export type OperatorRuntimeProjectionOptions = {
  connectionState?: "connecting" | "live" | "retrying";
  now?: number;
  scope?: {
    workspaceId: string | null;
    workspaceName?: string | null;
    workspaceCount?: number;
  };
};

export function presentOperatorRuntime(
  snapshot: MissionControlSnapshot,
  options: OperatorRuntimeProjectionOptions = {}
): OperatorRuntimeProjection {
  const now = options.now ?? Date.now();
  const diagnostics = snapshot.diagnostics;
  const transport = resolveTransport(snapshot, options.connectionState);
  const compatibility = resolveCompatibility(snapshot);
  const fallback = resolveFallback(snapshot);
  const freshness = resolveFreshness(snapshot, options.connectionState, now);
  const scope = resolveScope(snapshot, options.scope);
  const activeIssues = (diagnostics.runtimeIssues ?? []).filter(isOpenIssue);
  const actionableIssues = activeIssues.filter((issue) => issue.severity === "action_required" || issue.severity === "blocked");
  const hasGatewayPermissionIssue =
    activeIssues.some((issue) => issue.type === "scope_upgrade_pending") ||
    fallback.blockingOperationCount > 0 ||
    collectOperatorAttentionText(snapshot).some(isGatewayPermissionIssue);
  const gatewayOffline =
    diagnostics.health === "offline" ||
    diagnostics.transport?.gatewayMode === "unreachable" ||
    diagnostics.transport?.connectionState === "error" ||
    diagnostics.transport?.connectionState === "closed";
  const blockingIssue = fallback.blockingOperationCount > 0 || activeIssues.some((issue) =>
    issue.severity === "blocked" ||
    issue.type === "scope_upgrade_pending" ||
    issue.type === "model_auth_required"
  ) || hasGatewayPermissionIssue;
  const gatewayWritable = diagnostics.runtime.stateWritable && diagnostics.runtime.sessionStoreWritable;

  let state: OperatorRuntimeState;
  let explanation: string;

  if (gatewayOffline) {
    state = "offline";
    explanation = "The OpenClaw Gateway is not reachable from the current runtime snapshot.";
  } else if (blockingIssue) {
    state = "blocked";
    explanation = "OpenClaw reported an actionable runtime blocker that needs review before normal operations can continue.";
  } else if (transport.state === "connecting" || transport.state === "retrying") {
    state = "connecting";
    explanation = transport.state === "retrying"
      ? "AgentOS is reconnecting to the runtime stream. The displayed snapshot may still be usable, but it is not current live truth."
      : "AgentOS is connecting to the runtime stream. The displayed snapshot may still be a previous observation.";
  } else if (freshness.stale) {
    state = "degraded";
    explanation = "The current runtime snapshot is older than the Mission Control refresh window and should not be treated as current truth.";
  } else if (compatibility.state === "incompatible") {
    state = "blocked";
    explanation = "The current OpenClaw compatibility evidence is incompatible with the AgentOS runtime contract.";
  } else if (
    compatibility.state === "unknown" &&
    diagnostics.rpcOk &&
    diagnostics.health === "healthy" &&
    fallback.degradedOperationCount === 0
  ) {
    state = "unknown";
    explanation = "OpenClaw compatibility could not be verified from the current evidence.";
  } else if (
    diagnostics.rpcOk &&
    diagnostics.health === "healthy" &&
    fallback.degradedOperationCount === 0 &&
    fallback.blockingOperationCount === 0 &&
    diagnostics.transport?.mode !== "cli" &&
    diagnostics.transport?.gatewayMode !== "cli-forced" &&
    gatewayWritable &&
    actionableIssues.length === 0 &&
    compatibility.state === "compatible" &&
    !freshness.stale
  ) {
    state = "ready";
    explanation = "Native OpenClaw Gateway RPC is ready and the current runtime snapshot has no blocking issues.";
  } else {
    state = "degraded";
    explanation = fallback.degradedOperationCount > 0
      ? "One or more core OpenClaw operations used CLI fallback, reducing native Gateway capability."
      : actionableIssues.length > 0
        ? "OpenClaw is available, but one or more runtime issues need operator attention."
        : "OpenClaw is installed or loaded, but native runtime readiness is incomplete.";
  }

  const primaryRecovery = resolvePrimaryRecovery({
    state,
    activeIssues,
    diagnostics,
    compatibility,
    fallback,
    hasGatewayPermissionIssue
  });

  return {
    state,
    stateLabel: formatRuntimeStateLabel(state),
    tone: runtimeStateTone(state),
    transport,
    authority: resolveAuthority(snapshot, fallback),
    gateway: {
      installed: diagnostics.installed,
      loaded: diagnostics.loaded,
      rpcReady: diagnostics.rpcOk,
      health: diagnostics.health,
      healthLabel: capitalize(diagnostics.health)
    },
    fallback,
    coverage: resolveCoverage(snapshot),
    compatibility: {
      state: compatibility.state,
      label: formatCompatibilityLabel(compatibility.state)
    },
    freshness,
    scope,
    attention: {
      actionableCount: actionableIssues.length + fallback.blockingOperationCount + (
        hasGatewayPermissionIssue &&
        fallback.blockingOperationCount === 0 &&
        !activeIssues.some((issue) => issue.type === "scope_upgrade_pending")
          ? 1
          : 0
      ),
      informationalCount: Math.max(0, activeIssues.length - actionableIssues.length) + fallback.informationalOperationCount
    },
    explanation,
    primaryRecovery
  };
}

function resolveTransport(
  snapshot: MissionControlSnapshot,
  connectionState?: OperatorRuntimeProjectionOptions["connectionState"]
): OperatorRuntimeProjection["transport"] {
  const eventBridge = snapshot.diagnostics.eventBridge;

  if (connectionState === "retrying" || eventBridge?.reconnecting || eventBridge?.mode === "reconnecting") {
    return { state: "retrying", label: "Retrying" };
  }

  if (connectionState === "connecting") {
    return { state: "connecting", label: "Connecting" };
  }

  if (connectionState === "live" || eventBridge?.mode === "live" || eventBridge?.connected) {
    return { state: "live", label: "Live" };
  }

  if (snapshot.diagnostics.health === "offline" || snapshot.diagnostics.transport?.gatewayMode === "unreachable") {
    return { state: "offline", label: "Offline" };
  }

  return { state: "unknown", label: "Unknown" };
}

function resolveAuthority(
  snapshot: MissionControlSnapshot,
  fallback: OperatorRuntimeProjection["fallback"]
): OperatorRuntimeProjection["authority"] {
  const transport = snapshot.diagnostics.transport;

  if (
    snapshot.diagnostics.rpcOk &&
    transport?.mode !== "cli" &&
    transport?.gatewayMode !== "cli-forced" &&
    transport?.gatewayMode !== "degraded" &&
    transport?.gatewayMode !== "unreachable" &&
    fallback.degradedOperationCount === 0 &&
    fallback.blockingOperationCount === 0
  ) {
    return { mode: "native-gateway", label: "Native Gateway" };
  }

  if (
    fallback.degradedOperationCount > 0 ||
    fallback.blockingOperationCount > 0 ||
    transport?.mode === "cli" ||
    transport?.gatewayMode === "cli-forced"
  ) {
    return { mode: "cli-fallback", label: "CLI fallback" };
  }

  if (snapshot.mode === "fallback") {
    return { mode: "snapshot", label: "Snapshot" };
  }

  return { mode: "unavailable", label: "Unavailable" };
}

function resolveFallback(snapshot: MissionControlSnapshot): OperatorRuntimeProjection["fallback"] {
  const diagnostics = snapshot.diagnostics;
  const report = diagnostics.compatibilityReport;
  const matrix = diagnostics.capabilityMatrix;
  const transport = diagnostics.transport;
  const fallbackDiagnostics: GatewayFallbackDiagnosticLike[] = [
    ...(diagnostics.gatewayFallbackDiagnostics ?? []),
    ...(transport?.recentFallbackDiagnostics ?? []),
    ...(matrix?.fallbackDiagnostics ?? []),
    ...(report?.fallback.diagnostics ?? [])
  ].filter((entry) => isGatewayFallbackDiagnosticCurrent(entry, transport?.lastConnectedAt));
  const uniqueFallbackDiagnostics = Array.from(
    new Map(fallbackDiagnostics.map((entry) => [
      `${entry.at ?? ""}\u0000${entry.operation}\u0000${entry.issue ?? ""}`,
      entry
    ])).values()
  );
  const impacts = uniqueFallbackDiagnostics.map((entry) => classifyGatewayFallbackImpact(entry));
  const forcedCli = transport?.mode === "cli" || transport?.gatewayMode === "cli-forced";
  const unclassifiedActiveFallback = transport?.gatewayMode === "fallback-active" && uniqueFallbackDiagnostics.length === 0;
  const fallbackSentinelCount = forcedCli || unclassifiedActiveFallback ? 1 : 0;
  const active = forcedCli || transport?.gatewayMode === "fallback-active" || uniqueFallbackDiagnostics.length > 0;
  const fallbackReasons = [
    ...(diagnostics.gatewayFallbackReasons ?? []),
    ...(matrix?.fallbackReasons ?? [])
  ];

  return {
    active,
    operationCount: uniqueFallbackDiagnostics.length + fallbackSentinelCount,
    degradedOperationCount: impacts.filter((impact) => impact === "degrading").length + fallbackSentinelCount,
    blockingOperationCount: impacts.filter((impact) => impact === "blocking").length,
    informationalOperationCount: impacts.filter((impact) => impact === "informational").length,
    lastReason: uniqueFallbackDiagnostics[0]?.issue ?? fallbackReasons[0] ?? transport?.lastNativeError ?? null
  };
}

function resolveCoverage(snapshot: MissionControlSnapshot): OperatorRuntimeProjection["coverage"] {
  const diagnostics = snapshot.diagnostics;
  const report = diagnostics.compatibilityReport;
  const operations = Object.values(diagnostics.capabilityMatrix?.operations ?? {});
  const nativeOperationCount = report
    ? report.contracts.filter((contract) => contract.nativeGatewaySupported).length
    : diagnostics.capabilityMatrix?.compatibility?.nativeOperationCount ?? operations.filter((operation) => operation.mode === "gateway-native").length;

  return {
    nativeOperationCount,
    nativeCoveragePercent: report?.summary.nativeGatewayCoveragePercent ?? null
  };
}

function resolveCompatibility(snapshot: MissionControlSnapshot): { state: OperatorCompatibilityState } {
  const reportStatus = snapshot.diagnostics.compatibilityReport?.status;
  if (reportStatus === "incompatible") {
    return { state: reportStatus };
  }

  const requiredOperations = Object.values(snapshot.diagnostics.capabilityMatrix?.operations ?? {})
    .filter((operation) => operation.baseline === "required");
  if (requiredOperations.some((operation) =>
    operation.mode === "degraded" || operation.mode === "cli-fallback" || operation.mode === "disabled"
  )) {
    return { state: "degraded" };
  }

  if (reportStatus) {
    return { state: reportStatus };
  }

  if (requiredOperations.some((operation) => operation.mode === "unknown")) {
    return { state: "unknown" };
  }

  const protocolStatus = snapshot.diagnostics.capabilityMatrix?.compatibility?.protocol.status;
  if (protocolStatus === "compatible") {
    return { state: "compatible" };
  }

  if (protocolStatus === "unsupported") {
    return { state: "incompatible" };
  }

  return { state: "unknown" };
}

function resolveFreshness(
  snapshot: MissionControlSnapshot,
  connectionState: OperatorRuntimeProjectionOptions["connectionState"] | undefined,
  now: number
): OperatorRuntimeProjection["freshness"] {
  const generatedAtMs = Date.parse(snapshot.generatedAt);
  const ageMs = Number.isFinite(generatedAtMs) ? Math.max(0, now - generatedAtMs) : null;
  const stale = ageMs === null || ageMs > OPERATOR_SNAPSHOT_FRESHNESS_MAX_AGE_MS;
  const ageLabel = formatSnapshotAge(ageMs);

  if (stale) {
    return { generatedAt: snapshot.generatedAt, ageMs, state: "stale", label: `Snapshot · ${ageLabel}`, stale: true };
  }

  if (connectionState === "retrying" || snapshot.diagnostics.eventBridge?.reconnecting || snapshot.diagnostics.eventBridge?.mode === "reconnecting") {
    return { generatedAt: snapshot.generatedAt, ageMs, state: "reconnecting", label: `Reconnecting · ${ageLabel}`, stale: false };
  }

  if (connectionState === "connecting") {
    return { generatedAt: snapshot.generatedAt, ageMs, state: "reconnecting", label: `Connecting · ${ageLabel}`, stale: false };
  }

  if (connectionState === "live" || snapshot.mode === "live" || snapshot.diagnostics.eventBridge?.mode === "live") {
    return { generatedAt: snapshot.generatedAt, ageMs, state: "live", label: `Live · ${ageLabel}`, stale: false };
  }

  if (snapshot.mode === "fallback") {
    return { generatedAt: snapshot.generatedAt, ageMs, state: "snapshot", label: `Snapshot · ${ageLabel}`, stale: false };
  }

  return { generatedAt: snapshot.generatedAt, ageMs, state: "unknown", label: `Unknown freshness · ${ageLabel}`, stale: false };
}

function resolveScope(
  snapshot: MissionControlSnapshot,
  scope: OperatorRuntimeProjectionOptions["scope"] | undefined
): OperatorRuntimeProjection["scope"] {
  const workspaceId = scope?.workspaceId ?? null;
  if (workspaceId) {
    const workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);
    const label = scope?.workspaceName ?? workspace?.name ?? "Selected workspace";
    return {
      kind: "workspace",
      workspaceId,
      label,
      detail: "Workspace scope"
    };
  }

  const workspaceCount = scope?.workspaceCount ?? snapshot.workspaces.length;
  return {
    kind: "global",
    workspaceId: null,
    label: "All workspaces",
    detail: workspaceCount > 0 ? "Global scope" : "Global scope · no workspaces reported"
  };
}

function resolvePrimaryRecovery(input: {
  state: OperatorRuntimeState;
  activeIssues: MissionControlSnapshot["diagnostics"]["runtimeIssues"];
  diagnostics: MissionControlSnapshot["diagnostics"];
  compatibility: { state: OperatorCompatibilityState };
  fallback: OperatorRuntimeProjection["fallback"];
  hasGatewayPermissionIssue: boolean;
}): OperatorRuntimeProjection["primaryRecovery"] {
  if (input.hasGatewayPermissionIssue) {
    return { id: "gateway-permissions", label: "Review Gateway permissions", href: "/settings#gateway" };
  }

  if (input.state === "ready") {
    return null;
  }

  if (input.state === "connecting") {
    return { id: "reconnect", label: "Retry connection", href: "/settings#diagnostics" };
  }

  if (!input.diagnostics.installed) {
    return { id: "setup", label: "Start OpenClaw", href: "/settings" };
  }

  if (input.state === "offline" || input.state === "blocked") {
    return { id: "gateway-diagnostics", label: "Review Gateway diagnostics", href: "/settings#diagnostics" };
  }

  if (input.compatibility.state === "incompatible" || input.compatibility.state === "unknown") {
    return { id: "compatibility", label: "Review compatibility", href: "/settings#diagnostics" };
  }

  if (input.fallback.active) {
    return { id: "gateway-diagnostics", label: "Review Gateway diagnostics", href: "/settings#diagnostics" };
  }

  if (input.activeIssues.length > 0) {
    return { id: "runtime-inbox", label: "Open Runtime Inbox", href: "/settings#diagnostics" };
  }

  return { id: "gateway-diagnostics", label: "Review Gateway diagnostics", href: "/settings#diagnostics" };
}

function isOpenIssue(issue: MissionControlSnapshot["diagnostics"]["runtimeIssues"][number]) {
  return issue.status === "open" || issue.status === "resolving" || issue.status === "failed";
}

function collectOperatorAttentionText(snapshot: MissionControlSnapshot) {
  const diagnostics = snapshot.diagnostics;

  return [
    ...diagnostics.securityWarnings,
    ...diagnostics.issues,
    ...diagnostics.runtime.issues,
    ...(diagnostics.capabilityMatrix?.diagnostics ?? []),
    diagnostics.eventBridge?.message ?? "",
    diagnostics.eventBridge?.recovery ?? "",
    ...(diagnostics.gatewayFallbackReasons ?? []),
    ...(diagnostics.capabilityMatrix?.fallbackReasons ?? [])
  ].filter((item): item is string => Boolean(item?.trim()));
}

function isGatewayPermissionIssue(item: string) {
  return /operator-scope approval|device access|pairing-pending|scope upgrade/i.test(item);
}

function formatRuntimeStateLabel(state: OperatorRuntimeState) {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function runtimeStateTone(state: OperatorRuntimeState): OperatorRuntimeProjection["tone"] {
  switch (state) {
    case "ready":
      return "success";
    case "degraded":
    case "connecting":
      return "warning";
    case "blocked":
    case "offline":
      return "danger";
    case "unknown":
      return "muted";
  }
}

function formatCompatibilityLabel(state: OperatorCompatibilityState) {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function formatSnapshotAge(ageMs: number | null) {
  if (ageMs === null) {
    return "age unknown";
  }

  if (ageMs < 1_000) {
    return "updated just now";
  }

  if (ageMs < 60_000) {
    return `updated ${Math.max(1, Math.round(ageMs / 1_000))}s ago`;
  }

  if (ageMs < 3_600_000) {
    return `updated ${Math.round(ageMs / 60_000)}m ago`;
  }

  return `updated ${Math.round(ageMs / 3_600_000)}h ago`;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
