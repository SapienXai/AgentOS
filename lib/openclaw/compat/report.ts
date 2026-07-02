import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type {
  GatewayStatusPayload,
  StatusPayload
} from "@/lib/openclaw/client/gateway-client";
import {
  NativeWsOpenClawGatewayClient,
  OPENCLAW_GATEWAY_PROTOCOL_RANGE,
  isCliGatewayClientForcedByEnv
} from "@/lib/openclaw/client/gateway-client";
import type { NativeWsOpenClawGatewayClientOptions } from "@/lib/openclaw/client/native-ws-gateway-client";
import type { OpenClawGatewayClientDiagnostics } from "@/lib/openclaw/client/types";
import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";
import { resolveOpenClawBin, resolveOpenClawVersion } from "@/lib/openclaw/cli";
import {
  OPENCLAW_RECOMMENDED_VERSION,
  OPENCLAW_SUPPORTED_BASELINE_VERSION
} from "@/lib/openclaw/versions";
import {
  buildOpenClawCompatibilityCapabilities,
  resolveOpenClawCompatibilityMethods,
  uniqueSorted
} from "@/lib/openclaw/compat/capabilities";
import { checkOpenClawCompatibilityContracts } from "@/lib/openclaw/compat/contracts";
import { resolveOpenClawCompatibilityTarget } from "@/lib/openclaw/compat/targets";
import type {
  OpenClawCompatibilityContractCheck,
  OpenClawCompatibilityMethodSource,
  OpenClawCompatibilityReport,
  OpenClawCompatibilityReportInput,
  OpenClawCompatibilityStatus,
  OpenClawCompatibilityTarget,
  OpenClawVersionSource,
  OpenClawGatewayHealthStatus,
  OpenClawGatewayProtocolCompatibilityStatus
} from "@/lib/openclaw/compat/types";

const compatibilityReportCacheTtlMs = 60_000;
const defaultNativeTimeoutMs = 2_500;

let cachedCompatibilityReport: {
  capturedAt: number;
  includeLiveShapeChecks: boolean;
  value: OpenClawCompatibilityReport;
} | null = null;
let compatibilityReportRefreshPromise: Promise<OpenClawCompatibilityReport> | null = null;

export type OpenClawCompatibilityReportOptions = {
  force?: boolean;
  includeLiveShapeChecks?: boolean;
  target?: OpenClawCompatibilityTarget;
  status?: StatusPayload | null;
  gatewayStatus?: GatewayStatusPayload | null;
  transport?: OpenClawGatewayClientDiagnostics | null;
  installedVersion?: string | null;
  openClawVersionSource?: OpenClawVersionSource;
  cliAvailable?: boolean;
  nativeClientOptions?: NativeWsOpenClawGatewayClientOptions;
  nativeTimeoutMs?: number;
  now?: () => Date;
};

type NativeCapabilityDetection = {
  protocolVersion: string | null;
  authMode: string | null;
  authRole: string | null;
  authScopes: string[];
  advertisedMethods: string[];
  advertisedEvents: string[];
  source: OpenClawCompatibilityMethodSource;
  diagnostics: string[];
  client: NativeWsOpenClawGatewayClient | null;
};

export function clearOpenClawCompatibilityReportCacheForTesting() {
  cachedCompatibilityReport = null;
  compatibilityReportRefreshPromise = null;
}

export function getCachedOpenClawCompatibilityReport() {
  if (!cachedCompatibilityReport) {
    return null;
  }

  if (Date.now() - cachedCompatibilityReport.capturedAt >= compatibilityReportCacheTtlMs) {
    if (!cachedCompatibilityReport.value.target.isSimulatedRuntime) {
      warmOpenClawCompatibilityReport();
    }
  }

  return cachedCompatibilityReport.value;
}

export function warmOpenClawCompatibilityReport() {
  if (!compatibilityReportRefreshPromise) {
    compatibilityReportRefreshPromise = getOpenClawCompatibilityReport({ force: true })
      .finally(() => {
        compatibilityReportRefreshPromise = null;
      });
  }

  void compatibilityReportRefreshPromise.catch(() => {});
}

export async function getOpenClawCompatibilityReport(
  options: OpenClawCompatibilityReportOptions = {}
): Promise<OpenClawCompatibilityReport> {
  const includeLiveShapeChecks = options.includeLiveShapeChecks === true;

  if (
    !options.force &&
    !includeLiveShapeChecks &&
    cachedCompatibilityReport &&
    !cachedCompatibilityReport.includeLiveShapeChecks &&
    Date.now() - cachedCompatibilityReport.capturedAt < compatibilityReportCacheTtlMs
  ) {
    return cachedCompatibilityReport.value;
  }

  const report = await generateOpenClawCompatibilityReport(options);

  if (!includeLiveShapeChecks) {
    cachedCompatibilityReport = {
      capturedAt: Date.now(),
      includeLiveShapeChecks,
      value: report
    };
  }

  return report;
}

export async function generateOpenClawCompatibilityReport(
  options: OpenClawCompatibilityReportOptions = {}
): Promise<OpenClawCompatibilityReport> {
  const generatedAt = (options.now?.() ?? new Date()).toISOString();
  const diagnostics: string[] = [];
  const adapter = getOpenClawAdapter();
  const [status, gatewayStatus, fallbackVersion, cliAvailable] = await Promise.all([
    resolveStatus(adapter, options.status, diagnostics),
    resolveGatewayStatus(adapter, options.gatewayStatus, diagnostics),
    resolveVersion(options.installedVersion, diagnostics),
    resolveCliAvailability(options.cliAvailable, diagnostics)
  ]);
  const installedVersion =
    normalizeVersion(options.installedVersion) ??
    readStatusVersion(status) ??
    normalizeVersion(fallbackVersion);
  const openClawVersionSource = options.openClawVersionSource ?? resolveOpenClawVersionSource({
    explicitVersion: options.installedVersion,
    statusVersion: readStatusVersion(status),
    fallbackVersion
  });
  const target = options.target ?? resolveOpenClawCompatibilityTarget({
    target: "real-local",
    gatewayUrl: options.nativeClientOptions?.url
  });
  const nativeDetection = await detectNativeCapabilities({
    options,
    diagnostics,
    cliForced: isCliGatewayClientForcedByEnv()
  });
  const resolvedCapabilities = resolveOpenClawCompatibilityMethods({
    advertisedMethods: nativeDetection.advertisedMethods,
    advertisedEvents: nativeDetection.advertisedEvents,
    installedVersion,
    source: nativeDetection.source
  });
  const protocolVersion =
    nativeDetection.protocolVersion ??
    readGatewayProtocolVersion(gatewayStatus);
  const protocolStatus = resolveProtocolStatus(protocolVersion);
  const gatewayHealth = resolveGatewayHealth(gatewayStatus);
  const transport = options.transport ?? nativeDetection.client?.getDiagnostics?.() ?? null;
  const capabilities = buildOpenClawCompatibilityCapabilities({
    advertisedMethods: resolvedCapabilities.advertisedMethods,
    advertisedEvents: resolvedCapabilities.advertisedEvents,
    effectiveMethods: resolvedCapabilities.effectiveMethods,
    effectiveEvents: resolvedCapabilities.effectiveEvents,
    installedVersion,
    source: resolvedCapabilities.source,
    cliFallbackAvailable: cliAvailable
  });
  const contracts = await checkOpenClawCompatibilityContracts({
    effectiveMethods: resolvedCapabilities.effectiveMethods,
    effectiveEvents: resolvedCapabilities.effectiveEvents,
    authScopes: nativeDetection.authScopes,
    capabilitySource: resolvedCapabilities.source,
    cliFallbackAvailable: cliAvailable,
    cliForced: isCliGatewayClientForcedByEnv(),
    includeLiveShapeChecks: options.includeLiveShapeChecks === true,
    callNative: nativeDetection.client
      ? (method, params) => nativeDetection.client!.callNative(method, params, {
        timeoutMs: options.nativeTimeoutMs ?? defaultNativeTimeoutMs
      })
      : undefined
  });

  nativeDetection.client?.close("compatibility report finished");

  return buildOpenClawCompatibilityReport({
    target,
    generatedAt,
    installedVersion,
    openClawVersionSource,
    recommendedVersion: OPENCLAW_RECOMMENDED_VERSION,
    supportedBaselineVersion: OPENCLAW_SUPPORTED_BASELINE_VERSION,
    testedVersions: uniqueSorted([
      installedVersion ?? "",
      target.version ?? "",
      OPENCLAW_SUPPORTED_BASELINE_VERSION
    ]),
    gatewayHealth: gatewayHealth.status,
    gatewayHealthReason: gatewayHealth.reason,
    protocolVersion,
    protocolStatus,
    protocolRange: OPENCLAW_GATEWAY_PROTOCOL_RANGE,
    authMode: nativeDetection.authMode,
    authRole: nativeDetection.authRole ?? readGatewayAuthRole(gatewayStatus),
    authScopes: nativeDetection.authScopes,
    advertisedMethods: resolvedCapabilities.advertisedMethods,
    effectiveMethods: resolvedCapabilities.effectiveMethods,
    advertisedEvents: resolvedCapabilities.advertisedEvents,
    effectiveEvents: resolvedCapabilities.effectiveEvents,
    capabilitySource: resolvedCapabilities.source,
    cliAvailable,
    cliForced: isCliGatewayClientForcedByEnv(),
    transport,
    capabilities,
    contracts,
    diagnostics: [...diagnostics, ...nativeDetection.diagnostics]
  });
}

export function buildOpenClawCompatibilityReport(
  input: OpenClawCompatibilityReportInput
): OpenClawCompatibilityReport {
  const activeFallbackCount = input.transport?.fallbackTotal ?? 0;
  const degradedContracts = input.contracts.filter((check) => check.status === "degraded");
  const unsupportedContracts = input.contracts.filter((check) => check.status === "unsupported");
  const failedContracts = input.contracts.filter((check) => check.status === "failed");
  const nativeCount = input.contracts.filter((check) => check.nativeGatewaySupported).length;
  const totalCount = input.contracts.length;
  const nativeGatewayCoveragePercent = totalCount > 0
    ? Math.round((nativeCount / totalCount) * 100)
    : 0;
  const summary = {
    nativeGatewayCoveragePercent,
    nativeGatewayCoverageLabel: `${nativeCount}/${totalCount} operations`,
    cliFallbackOperationCount: degradedContracts.length,
    activeCliFallbackCount: activeFallbackCount,
    degradedSurfaces: summarizeContractSurfaces(degradedContracts),
    unsupportedSurfaces: summarizeContractSurfaces(unsupportedContracts),
    failedSurfaces: summarizeContractSurfaces(failedContracts),
    supportedOpenClawVersion: input.supportedBaselineVersion,
    testedOpenClawVersions: [...input.testedVersions],
    unsupportedOperationCount: unsupportedContracts.length,
    degradedOperationCount: degradedContracts.length,
    failedOperationCount: failedContracts.length,
    targetName: input.target.name,
    targetKind: input.target.kind,
    isRealRuntime: input.target.isRealRuntime,
    isSimulatedRuntime: input.target.isSimulatedRuntime
  };
  const outcome = resolveOverallStatus({
    gatewayHealth: input.gatewayHealth,
    protocolStatus: input.protocolStatus,
    contracts: input.contracts
  });

  return {
    generatedAt: input.generatedAt,
    target: input.target,
    targetName: input.target.name,
    targetKind: input.target.kind,
    targetAliasUsed: input.target.aliasUsed ?? null,
    gatewayUrl: input.target.gatewayUrl ?? null,
    openClawVersionSource: input.openClawVersionSource,
    runtimeStartedBy: input.target.runtimeStartedBy,
    isRealRuntime: input.target.isRealRuntime,
    isSimulatedRuntime: input.target.isSimulatedRuntime,
    status: outcome.status,
    statusReason: outcome.reason,
    recovery: outcome.recovery,
    openClaw: {
      installedVersion: input.installedVersion,
      versionSource: input.openClawVersionSource,
      recommendedVersion: input.recommendedVersion,
      supportedBaselineVersion: input.supportedBaselineVersion,
      testedVersions: [...input.testedVersions]
    },
    gateway: {
      health: input.gatewayHealth,
      healthReason: input.gatewayHealthReason,
      protocolVersion: input.protocolVersion,
      protocolStatus: input.protocolStatus,
      protocolRange: input.protocolRange,
      authMode: input.authMode,
      authRole: input.authRole,
      authScopes: input.authScopes,
      capabilitySource: input.capabilitySource,
      advertisedMethodCount: input.advertisedMethods.length,
      effectiveMethodCount: input.effectiveMethods.length,
      advertisedEventCount: input.advertisedEvents.length
    },
    fallback: {
      cliAvailable: input.cliAvailable,
      cliForced: input.cliForced,
      operationCount: input.contracts.filter((check) => check.cliFallbackAvailable).length,
      activeFallbackCount,
      diagnostics: input.transport?.recentFallbackDiagnostics ?? []
    },
    capabilities: input.capabilities,
    contracts: input.contracts,
    summary,
    diagnostics: input.diagnostics
  };
}

async function resolveStatus(
  adapter: ReturnType<typeof getOpenClawAdapter>,
  value: StatusPayload | null | undefined,
  diagnostics: string[]
) {
  if (value !== undefined) {
    return value;
  }

  try {
    return await adapter.getStatus({ timeoutMs: 5_000 });
  } catch (error) {
    diagnostics.push(`status: ${readErrorMessage(error)}`);
    return null;
  }
}

async function resolveGatewayStatus(
  adapter: ReturnType<typeof getOpenClawAdapter>,
  value: GatewayStatusPayload | null | undefined,
  diagnostics: string[]
) {
  if (value !== undefined) {
    return value;
  }

  try {
    return await adapter.getGatewayStatus({ timeoutMs: 5_000 });
  } catch (error) {
    diagnostics.push(`gatewayStatus: ${readErrorMessage(error)}`);
    return null;
  }
}

async function resolveVersion(value: string | null | undefined, diagnostics: string[]) {
  if (value !== undefined) {
    return value;
  }

  try {
    return await resolveOpenClawVersion();
  } catch (error) {
    diagnostics.push(`version: ${readErrorMessage(error)}`);
    return null;
  }
}

async function resolveCliAvailability(value: boolean | undefined, diagnostics: string[]) {
  if (value !== undefined) {
    return value;
  }

  try {
    await resolveOpenClawBin();
    return true;
  } catch (error) {
    diagnostics.push(`cli: ${readErrorMessage(error)}`);
    return false;
  }
}

async function detectNativeCapabilities(input: {
  options: OpenClawCompatibilityReportOptions;
  diagnostics: string[];
  cliForced: boolean;
}): Promise<NativeCapabilityDetection> {
  if (input.cliForced) {
    return emptyNativeDetection("Native Gateway WS is disabled by environment configuration.");
  }

  const client = new NativeWsOpenClawGatewayClient({
    timeoutMs: input.options.nativeTimeoutMs ?? defaultNativeTimeoutMs,
    ...input.options.nativeClientOptions
  });

  try {
    const hello = await client.probeNativeHandshake({
      timeoutMs: input.options.nativeTimeoutMs ?? defaultNativeTimeoutMs
    });
    let payload: unknown = hello;
    let source: OpenClawCompatibilityMethodSource = "gateway-advertised";
    let advertisedMethods = readSupportedMethods(hello);
    let advertisedEvents = readSupportedEvents(hello);

    if (advertisedMethods.length === 0 && advertisedEvents.length === 0) {
      const discovery = await callGatewayDiscovery(client, input.options.nativeTimeoutMs ?? defaultNativeTimeoutMs);

      if (discovery) {
        payload = discovery.payload;
        source = "gateway-discovery";
        advertisedMethods = readSupportedMethods(discovery.payload);
        advertisedEvents = readSupportedEvents(discovery.payload);
      }
    }

    return {
      protocolVersion: readProtocolVersion(payload) ?? readProtocolVersion(hello),
      authMode: readAuthMode(payload) ?? readAuthMode(hello),
      authRole: readAuthRole(payload) ?? readAuthRole(hello),
      authScopes: readAuthScopes(payload).length > 0 ? readAuthScopes(payload) : readAuthScopes(hello),
      advertisedMethods,
      advertisedEvents,
      source,
      diagnostics: [],
      client
    };
  } catch (error) {
    client.close("compatibility report native detection failed");
    return emptyNativeDetection(`handshake: ${readErrorMessage(error)}`);
  }
}

async function callGatewayDiscovery(client: NativeWsOpenClawGatewayClient, timeoutMs: number) {
  const methods = ["rpc.discover", "rpc.methods", "system.capabilities", "capabilities"];

  for (const method of methods) {
    try {
      return {
        method,
        payload: await client.callNative<unknown>(method, {}, { timeoutMs })
      };
    } catch {
      // Try the next discovery shape before falling back to version defaults.
    }
  }

  return null;
}

function emptyNativeDetection(reason: string): NativeCapabilityDetection {
  return {
    protocolVersion: null,
    authMode: null,
    authRole: null,
    authScopes: [],
    advertisedMethods: [],
    advertisedEvents: [],
    source: "unavailable",
    diagnostics: [reason],
    client: null
  };
}

function resolveGatewayHealth(status: GatewayStatusPayload | null): {
  status: OpenClawGatewayHealthStatus;
  reason: string;
} {
  if (!status) {
    return {
      status: "unknown",
      reason: "Gateway status was not available."
    };
  }

  if (status.rpc?.ok === true) {
    return {
      status: "healthy",
      reason: "Gateway status reports RPC ready."
    };
  }

  if (status.service?.loaded === true) {
    return {
      status: "degraded",
      reason: status.rpc?.error || "Gateway service is loaded, but RPC is not ready."
    };
  }

  return {
    status: "unreachable",
    reason: "Gateway service is not loaded or did not report readiness."
  };
}

function resolveProtocolStatus(protocolVersion: string | null): OpenClawGatewayProtocolCompatibilityStatus {
  if (!protocolVersion) {
    return "unknown";
  }

  const numericVersion = Number(protocolVersion);
  if (!Number.isFinite(numericVersion)) {
    return "unknown";
  }

  return numericVersion >= OPENCLAW_GATEWAY_PROTOCOL_RANGE.min &&
    numericVersion <= OPENCLAW_GATEWAY_PROTOCOL_RANGE.max
    ? "compatible"
    : "unsupported";
}

function resolveOverallStatus(input: {
  gatewayHealth: OpenClawGatewayHealthStatus;
  protocolStatus: OpenClawGatewayProtocolCompatibilityStatus;
  contracts: OpenClawCompatibilityContractCheck[];
}): {
  status: OpenClawCompatibilityStatus;
  reason: string;
  recovery: string;
} {
  const requiredIssue = input.contracts.find((check) =>
    check.required && (check.status === "failed" || check.status === "unsupported")
  );

  if (input.protocolStatus === "unsupported") {
    return {
      status: "incompatible",
      reason: "Gateway protocol is outside AgentOS' supported range.",
      recovery: "Update OpenClaw or AgentOS so the Gateway protocol versions overlap."
    };
  }

  if (input.gatewayHealth === "unreachable") {
    return {
      status: "incompatible",
      reason: "OpenClaw Gateway is unreachable.",
      recovery: "Start or repair the OpenClaw Gateway, then rerun compatibility checks."
    };
  }

  if (requiredIssue) {
    return {
      status: "incompatible",
      reason: `${requiredIssue.label} is required but ${requiredIssue.status}.`,
      recovery: requiredIssue.suggestedRecovery
    };
  }

  const degradedIssue = input.contracts.find((check) =>
    check.baseline !== "experimental" && check.status !== "ok"
  );

  if (
    degradedIssue ||
    input.gatewayHealth === "degraded" ||
    input.gatewayHealth === "unknown" ||
    input.protocolStatus === "unknown"
  ) {
    return {
      status: "degraded",
      reason: degradedIssue
        ? `${degradedIssue.label} is ${degradedIssue.status}.`
        : "Gateway health or protocol compatibility is not fully verified.",
      recovery: degradedIssue?.suggestedRecovery ?? "Repair Gateway readiness or rerun compatibility checks after OpenClaw is available."
    };
  }

  return {
    status: "compatible",
    reason: "OpenClaw compatibility checks are compatible with AgentOS' supported baseline.",
    recovery: "No recovery action required."
  };
}

function summarizeContractSurfaces(contracts: OpenClawCompatibilityContractCheck[]) {
  return uniqueSorted(contracts.map((check) => check.label));
}

function readStatusVersion(status: StatusPayload | null) {
  return normalizeVersion(status?.runtimeVersion) ??
    normalizeVersion(status?.overview?.version) ??
    normalizeVersion(status?.version);
}

function readGatewayProtocolVersion(status: GatewayStatusPayload | null) {
  const capability = status?.rpc?.capability;
  if (!capability) {
    return null;
  }

  const match = /\bprotocol\s*v?(\d+)\b/i.exec(capability) ?? /\bv(\d+)\b/i.exec(capability);
  return match?.[1] ?? null;
}

function readGatewayAuthRole(status: GatewayStatusPayload | null) {
  return normalizeString(status?.rpc?.auth?.role);
}

function readSupportedMethods(payload: unknown) {
  const direct = readStringArray(readProperty(payload, "methods"));
  const nested = readStringArray(readProperty(readProperty(payload, "rpc"), "methods"));
  const features = readStringArray(readProperty(readProperty(payload, "features"), "methods"));
  const supported = readStringArray(readProperty(payload, "supportedMethods"));
  const methodObjects = readMethodObjects(readProperty(payload, "methods"));

  return uniqueSorted([...direct, ...nested, ...features, ...supported, ...methodObjects]);
}

function readSupportedEvents(payload: unknown) {
  const direct = readStringArray(readProperty(payload, "events"));
  const features = readStringArray(readProperty(readProperty(payload, "features"), "events"));
  return uniqueSorted([...direct, ...features]);
}

function readMethodObjects(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeString(readProperty(entry, "name")) ?? normalizeString(readProperty(entry, "method")))
    .filter((entry): entry is string => Boolean(entry));
}

function readProtocolVersion(payload: unknown) {
  const value =
    readProperty(payload, "protocolVersion") ??
    readProperty(payload, "protocol") ??
    readProperty(readProperty(payload, "gateway"), "protocolVersion");

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return normalizeString(value);
}

function readAuthMode(payload: unknown) {
  return normalizeString(readProperty(payload, "authMode")) ??
    normalizeString(readProperty(readProperty(payload, "auth"), "mode")) ??
    normalizeString(readProperty(readProperty(payload, "security"), "authMode"));
}

function readAuthRole(payload: unknown) {
  return normalizeString(readProperty(payload, "role")) ??
    normalizeString(readProperty(readProperty(payload, "auth"), "role")) ??
    normalizeString(readProperty(readProperty(payload, "security"), "role"));
}

function readAuthScopes(payload: unknown) {
  return uniqueSorted([
    ...readStringArray(readProperty(payload, "scopes")),
    ...readStringArray(readProperty(readProperty(payload, "auth"), "scopes")),
    ...readStringArray(readProperty(readProperty(payload, "security"), "scopes"))
  ]);
}

function readProperty(value: unknown, key: string) {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

function normalizeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeVersion(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().replace(/^v/i, "") : null;
}

function resolveOpenClawVersionSource(input: {
  explicitVersion: string | null | undefined;
  statusVersion: string | null;
  fallbackVersion: string | null;
}): OpenClawVersionSource {
  if (
    normalizeVersion(input.explicitVersion) ||
    normalizeVersion(input.statusVersion) ||
    normalizeVersion(input.fallbackVersion)
  ) {
    return "detected";
  }

  return "unknown";
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "OpenClaw compatibility check failed.");
}

export function isOpenClawVersionAtLeastSupportedBaseline(version: string | null) {
  const normalized = normalizeVersion(version);
  return Boolean(normalized && compareVersionStrings(normalized, OPENCLAW_SUPPORTED_BASELINE_VERSION) >= 0);
}
