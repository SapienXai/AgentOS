import type {
  GatewayStatusPayload,
  StatusPayload
} from "@/lib/openclaw/client/gateway-client";
import { isDeferredPayloadResult } from "@/lib/openclaw/client/payload-cache";
import { getOpenClawGatewayOperationLabel } from "@/lib/openclaw/client/gateway-compatibility";
import { filterActiveOpenClawGatewayFallbackDiagnostics } from "@/lib/openclaw/client/gateway-diagnostic-activity";
import {
  collectIssues,
  compareVersionStrings,
  normalizeOptionalValue,
  normalizeUpdateError,
  resolveDiagnosticHealth,
  resolveUpdateInfo
} from "@/lib/openclaw/domains/control-plane-normalization";
import type {
  MissionControlSnapshot,
  ModelReadiness,
  OpenClawBinarySelection,
  OpenClawCapabilityMatrix,
  OpenClawCommandDiagnostic
} from "@/lib/openclaw/types";

type PayloadReuseState = {
  reusedCachedValue: boolean;
};

export function buildSecurityWarnings(status: StatusPayload | undefined) {
  return (
    status?.securityAudit?.findings
      ?.filter((entry) => entry.severity === "warn")
      .map((entry) => entry.title || entry.detail || "Security warning") ?? []
  );
}

export function buildVersionDiagnostics(input: {
  status: StatusPayload | undefined;
  fallbackVersion?: string;
}) {
  const currentVersion =
    normalizeOptionalValue(
      input.status?.runtimeVersion ||
        input.status?.overview?.version ||
        input.status?.version
    ) ??
    input.fallbackVersion ??
    undefined;
  const latestVersion = normalizeOptionalValue(input.status?.update?.registry?.latestVersion ?? undefined);
  const updateError = normalizeUpdateError(input.status?.update?.registry?.error ?? undefined);
  const updateAvailable =
    currentVersion && latestVersion ? compareVersionStrings(latestVersion, currentVersion) > 0 : undefined;
  const updateInfo = resolveUpdateInfo({
    currentVersion,
    latestVersion,
    updateError,
    legacyInfo: input.status?.overview?.update
  });

  return {
    currentVersion,
    latestVersion,
    updateAvailable,
    updateError,
    updateInfo
  };
}

export function buildGatewayDiagnostics(input: {
  gatewayStatus: GatewayStatusPayload | undefined;
  status: StatusPayload | undefined;
  configuredWorkspaceRoot: string | null;
  workspaceRoot: string;
  configuredGatewayUrl?: string | null;
  hasOpenClawSignal: boolean;
  securityWarnings: string[];
  runtimeDiagnostics: MissionControlSnapshot["diagnostics"]["runtime"];
  openClawBinarySelection: OpenClawBinarySelection;
  modelReadiness: ModelReadiness;
  capabilityMatrix?: OpenClawCapabilityMatrix;
  compatibilitySmokeTest?: MissionControlSnapshot["diagnostics"]["compatibilitySmokeTest"];
  commandHistory?: OpenClawCommandDiagnostic[];
  transport?: MissionControlSnapshot["diagnostics"]["transport"];
  issues: string[];
  versionDiagnostics: ReturnType<typeof buildVersionDiagnostics>;
}): MissionControlSnapshot["diagnostics"] {
  const gatewayFallbackDiagnostics = (input.transport?.recentFallbackDiagnostics ?? []).map((entry) => ({
    ...entry,
    operationLabel: getOpenClawGatewayOperationLabel(entry.operation)
  }));
  const activeGatewayFallbackDiagnostics = filterActiveOpenClawGatewayFallbackDiagnostics(
    gatewayFallbackDiagnostics,
    input.transport
  );
  const securityWarnings = [
    ...input.securityWarnings,
    ...buildLocalExposureWarnings(input.gatewayStatus, input.configuredGatewayUrl)
  ];
  const deviceAccessIssue = buildGatewayDeviceAccessIssue(input.gatewayStatus);
  const issues = deviceAccessIssue
    ? [
      deviceAccessIssue,
      ...input.issues.filter((issue) => !isNativeTimeoutNoiseDuringDeviceAccessRepair(issue))
    ]
    : input.issues;

  return {
    installed: true,
    loaded: Boolean(input.gatewayStatus?.service?.loaded),
    rpcOk: Boolean(input.gatewayStatus?.rpc?.ok),
    health: resolveDiagnosticHealth({
      rpcOk: input.gatewayStatus?.rpc?.ok,
      warningCount: securityWarnings.length,
      runtimeIssueCount: input.runtimeDiagnostics.issues.length,
      hasOpenClawSignal: input.hasOpenClawSignal
    }),
    version: input.versionDiagnostics.currentVersion,
    latestVersion: input.versionDiagnostics.latestVersion,
    updateAvailable: input.versionDiagnostics.updateAvailable,
    updateError: input.versionDiagnostics.updateError,
    updateRoot: normalizeOptionalValue(input.status?.update?.root ?? undefined),
    updateInstallKind: normalizeOptionalValue(input.status?.update?.installKind ?? undefined),
    updatePackageManager: normalizeOptionalValue(input.status?.update?.packageManager ?? undefined),
    workspaceRoot: input.workspaceRoot,
    configuredWorkspaceRoot: input.configuredWorkspaceRoot,
    dashboardUrl: `http://127.0.0.1:${input.gatewayStatus?.gateway?.port ?? 18789}/`,
    gatewayUrl: input.gatewayStatus?.gateway?.probeUrl || "ws://127.0.0.1:18789",
    configuredGatewayUrl: input.configuredGatewayUrl ?? null,
    bindMode: input.gatewayStatus?.gateway?.bindMode,
    port: input.gatewayStatus?.gateway?.port,
    updateChannel: input.status?.updateChannel || "stable",
    updateInfo: input.versionDiagnostics.updateInfo,
    serviceLabel: input.gatewayStatus?.service?.label,
    openClawBinarySelection: input.openClawBinarySelection,
    modelReadiness: input.modelReadiness,
    capabilityMatrix: input.capabilityMatrix,
    compatibilitySmokeTest: input.compatibilitySmokeTest ?? null,
    gatewayFallbackDiagnostics,
    gatewayFallbackReasons: activeGatewayFallbackDiagnostics.map(
      (entry) => `${entry.operationLabel} (${entry.operation}): ${entry.kind}: ${entry.issue} Recovery: ${entry.recovery}`
    ),
    runtime: input.runtimeDiagnostics,
    commandHistory: input.commandHistory,
    transport: input.transport,
    securityWarnings,
    issues
  };
}

function buildGatewayDeviceAccessIssue(gatewayStatus: GatewayStatusPayload | undefined) {
  const messages = [
    gatewayStatus?.rpc?.error,
    gatewayStatus?.rpc?.capability,
    gatewayStatus?.rpc?.auth?.capability
  ].filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const summary = messages.join("\n");

  if (
    !/scope upgrade pending approval|pairing_pending|device token scope mismatch|connected_no_operator_scope|missing operator/i.test(summary)
  ) {
    return null;
  }

  const requestId = readGatewayDeviceAccessRequestId(summary);

  return requestId
    ? `OpenClaw Gateway device access is waiting for operator-scope approval (${requestId}). Run Repair access in Gateway settings or approve that request with OpenClaw devices, then retry.`
    : "OpenClaw Gateway device access is waiting for operator-scope approval. Run Repair access in Gateway settings or approve the pending OpenClaw device request, then retry.";
}

function readGatewayDeviceAccessRequestId(value: string) {
  const match = /\brequestId:\s*([a-f0-9-]{12,})\b/i.exec(value);

  return match?.[1] ?? null;
}

function isNativeTimeoutNoiseDuringDeviceAccessRepair(issue: string) {
  return /Timed out waiting for OpenClaw Gateway method|Gateway-native operation failed; CLI fallback disabled|Native Gateway: Unreachable/i.test(issue);
}

function buildLocalExposureWarnings(
  gatewayStatus: GatewayStatusPayload | undefined,
  configuredGatewayUrl: string | null | undefined
) {
  const warnings: string[] = [];
  const probeHost = readUrlHostname(gatewayStatus?.gateway?.probeUrl);
  const configuredHost = readUrlHostname(configuredGatewayUrl ?? undefined);
  const bindMode = normalizeOptionalValue(gatewayStatus?.gateway?.bindMode ?? undefined)?.toLowerCase();

  if (probeHost && !isLoopbackGatewayHost(probeHost)) {
    warnings.push("OpenClaw Gateway is reachable on a non-loopback host. AgentOS mutation APIs stay restricted to same-origin localhost requests.");
  }

  if (configuredHost && !isLoopbackGatewayHost(configuredHost)) {
    warnings.push("AgentOS is configured to use a non-loopback Gateway URL. Keep AgentOS itself bound to localhost unless an explicit operator tunnel is in place.");
  }

  if (bindMode && !/(local|loopback|localhost)/i.test(bindMode)) {
    warnings.push("OpenClaw Gateway bind mode is not local-only. Review Gateway exposure before using operator write actions.");
  }

  return Array.from(new Set(warnings));
}

function readUrlHostname(value: string | undefined) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

function isLoopbackGatewayHost(host: string) {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");

  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "0:0:0:0:0:0:0:1" ||
    /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(normalized)
  );
}

export function buildDiagnosticIssues(input: {
  payloadResults: Record<string, PromiseSettledResult<unknown>>;
  gatewayStatusRejectedWithCachedValue: boolean;
  payloadReuse: Record<string, PayloadReuseState>;
  runtimeIssues: string[];
}) {
  return [
    ...collectIssues(
      Object.fromEntries(
        Object.entries(input.payloadResults).filter(([, result]) => !isDeferredPayloadResult(result))
      )
    ),
    ...(input.gatewayStatusRejectedWithCachedValue
      ? ["gatewayStatus: Reusing the last successful gateway status after a transient OpenClaw check failure."]
      : []),
    ...Object.entries(input.payloadReuse)
      .map(([label, state]) => describeCachedPayloadReuse(label, state.reusedCachedValue))
      .filter((issue): issue is string => Boolean(issue)),
    ...input.runtimeIssues
  ];
}

function describeCachedPayloadReuse(label: string, reusedCachedValue: boolean) {
  return reusedCachedValue
    ? `${label}: Reusing the last successful payload while a slow OpenClaw command refreshes in the background.`
    : null;
}
