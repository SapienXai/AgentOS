import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type { OpenClawGatewayClientError } from "@/lib/openclaw/client/gateway-client";
import {
  NativeWsOpenClawGatewayClient,
  OPENCLAW_GATEWAY_PROTOCOL_RANGE,
  getRecentOpenClawGatewayFallbackDiagnostics,
  isCliGatewayClientForcedByEnv
} from "@/lib/openclaw/client/gateway-client";
import {
  OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS,
  OPENCLAW_KNOWN_GATEWAY_FIRST_METHODS,
  getOpenClawGatewayCompatibilityOperation,
  getOpenClawGatewayMethodCandidates,
  getOpenClawGatewayOperationLabel
} from "@/lib/openclaw/client/gateway-compatibility";
import type {
  OpenClawCapabilityMatrix,
  OpenClawCapabilityOperation,
  OpenClawCapabilitySupport,
  OpenClawGatewayMethodContractAudit,
  OpenClawGatewayMethodContractAuditSource
} from "@/lib/openclaw/types";

const capabilityCacheTtlMs = 60_000;

let cachedCapabilityMatrix: {
  capturedAt: number;
  value: OpenClawCapabilityMatrix;
} | null = null;
let nativeCapabilityCallerForTesting: ((method: string) => Promise<unknown>) | null = null;

export function clearOpenClawCapabilityMatrixCacheForTesting() {
  cachedCapabilityMatrix = null;
  nativeCapabilityCallerForTesting = null;
}

export function setOpenClawCapabilityMatrixNativeCallerForTesting(
  caller: ((method: string) => Promise<unknown>) | null
) {
  nativeCapabilityCallerForTesting = caller;
  cachedCapabilityMatrix = null;
}

export async function getOpenClawCapabilityMatrix(options: { force?: boolean } = {}) {
  if (!options.force && cachedCapabilityMatrix && Date.now() - cachedCapabilityMatrix.capturedAt < capabilityCacheTtlMs) {
    return cachedCapabilityMatrix.value;
  }

  const matrix = await detectOpenClawCapabilityMatrix();
  cachedCapabilityMatrix = {
    capturedAt: Date.now(),
    value: matrix
  };

  return matrix;
}

export function getCachedOpenClawCapabilityMatrix() {
  return cachedCapabilityMatrix && Date.now() - cachedCapabilityMatrix.capturedAt < capabilityCacheTtlMs
    ? cachedCapabilityMatrix.value
    : null;
}

export function warmOpenClawCapabilityMatrix() {
  void getOpenClawCapabilityMatrix().catch(() => {});
}

async function detectOpenClawCapabilityMatrix(): Promise<OpenClawCapabilityMatrix> {
  const diagnostics: string[] = [];
  const status = await getOpenClawAdapter().getStatus({ timeoutMs: 5_000 }).catch((error) => {
    diagnostics.push(`status: ${readErrorMessage(error)}`);
    return null;
  });
  const version = readString(status?.runtimeVersion) ?? readString(status?.overview?.version) ?? readString(status?.version);
  let protocolVersion: string | null = null;
  let authMode: string | null = null;
  let authRole: string | null = null;
  let authScopes: string[] = [];
  let supportedMethods: string[] = [];
  let supportedEvents: string[] = [];
  let methodContractSource: OpenClawGatewayMethodContractAuditSource = "unavailable";

  if (isCliGatewayClientForcedByEnv()) {
    methodContractSource = "disabled";
    diagnostics.push("Native Gateway WS is disabled by environment configuration.");
  } else {
    if (nativeCapabilityCallerForTesting) {
      const capabilityResult = await callFirstSupported(nativeCapabilityCallerForTesting, [
        "rpc.discover",
        "rpc.methods",
        "system.capabilities",
        "capabilities"
      ], diagnostics);
      const capabilityPayload = capabilityResult?.payload ?? null;

      methodContractSource = capabilityResult?.method ?? "unavailable";
      protocolVersion = readProtocolVersion(capabilityPayload);
      authMode = readAuthMode(capabilityPayload);
      authRole = readAuthRole(capabilityPayload);
      authScopes = readAuthScopes(capabilityPayload);
      supportedMethods = readSupportedMethods(capabilityPayload);
      supportedEvents = readSupportedEvents(capabilityPayload);
    } else {
      try {
        const hello = await new NativeWsOpenClawGatewayClient({ timeoutMs: 2_500 }).probeNativeHandshake({
          timeoutMs: 2_500
        });
        methodContractSource = "gateway-handshake";
        protocolVersion = readProtocolVersion(hello);
        authMode = readAuthMode(hello);
        authRole = readAuthRole(hello);
        authScopes = readAuthScopes(hello);
        supportedMethods = readSupportedMethods(hello);
        supportedEvents = readSupportedEvents(hello);
      } catch (error) {
        diagnostics.push(`handshake: ${readErrorMessage(error)}`);
      }
    }
  }

  const methodSet = new Set(supportedMethods);
  const eventSet = new Set(supportedEvents);
  const support = (...methods: string[]): OpenClawCapabilitySupport => {
    if (methodSet.size === 0) {
      return "unknown";
    }

    return methods.some((method) => methodSet.has(method)) ? "supported" : "unsupported";
  };
  const unsupportedGatewayMethods = methodSet.size > 0
    ? OPENCLAW_KNOWN_GATEWAY_FIRST_METHODS.filter((method) => !methodSet.has(method))
    : [];
  const operation = (
    label: string,
    methods: string[],
    events: string[] = [],
    fallbackAllowed = true
  ): OpenClawCapabilityOperation => {
    if (isCliGatewayClientForcedByEnv()) {
      return {
        label,
        mode: "cli-fallback",
        methods,
        events,
        fallbackAllowed,
        reason: "Native Gateway WS is disabled by environment configuration.",
        preferredMethod: methods[0] ?? null,
        supportedMethod: null,
        aliasMethods: methods.slice(1),
        compatibility: "missing"
      };
    }

    if (methodSet.size === 0 && eventSet.size === 0) {
      return {
        label,
        mode: "unknown",
        methods,
        events,
        fallbackAllowed,
        reason: "Gateway did not advertise feature metadata; AgentOS will attempt Gateway first and fall back when needed.",
        preferredMethod: methods[0] ?? null,
        supportedMethod: null,
        aliasMethods: methods.slice(1),
        compatibility: "unknown"
      };
    }

    const supportedMethod = methods.find((method) => methodSet.has(method)) ?? null;
    const eventSupported = events.some((event) => eventSet.has(event));
    if (supportedMethod || eventSupported) {
      return {
        label,
        mode: "gateway-native",
        methods,
        events,
        fallbackAllowed,
        reason: supportedMethod && supportedMethod !== methods[0]
          ? `OpenClaw Gateway advertises compatibility alias ${supportedMethod}.`
          : "OpenClaw Gateway advertises native support.",
        preferredMethod: methods[0] ?? null,
        supportedMethod,
        aliasMethods: methods.slice(1),
        compatibility: supportedMethod && supportedMethod !== methods[0] ? "alias" : "preferred"
      };
    }

    return {
      label,
      mode: fallbackAllowed ? "degraded" : "disabled",
      methods,
      events,
      fallbackAllowed,
      reason: fallbackAllowed
        ? "OpenClaw Gateway does not advertise native support; AgentOS will use compatibility fallback."
        : "OpenClaw Gateway does not advertise native support and no safe fallback is available.",
      preferredMethod: methods[0] ?? null,
      supportedMethod: null,
      aliasMethods: methods.slice(1),
      compatibility: "missing"
    };
  };
  const operations = Object.fromEntries(
    OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS.map((definition) => [
      definition.id,
      operation(definition.label, definition.methods, definition.events ?? [], definition.fallbackAllowed ?? true)
    ])
  ) as Record<string, OpenClawCapabilityOperation>;
  const fallbackDiagnostics = getRecentOpenClawGatewayFallbackDiagnostics().map((entry) => ({
    ...entry,
    operationLabel: getOpenClawGatewayOperationLabel(entry.operation)
  }));
  const fallbackReasons = fallbackDiagnostics.map(
    (entry) => `${entry.operationLabel} (${entry.operation}): ${entry.kind}: ${entry.issue} Recovery: ${entry.recovery}`
  );
  const degradedFeatures = Object.entries(operations)
    .filter(([, value]) => value.mode === "degraded" || value.mode === "cli-fallback")
    .map(([name, value]) => `${name}: ${value.reason}`);
  const aliasOperations = Object.entries(operations)
    .filter(([, value]) => value.compatibility === "alias" && value.supportedMethod)
    .map(([name, value]) => `${name}: ${value.supportedMethod}`);
  const protocolStatus = resolveProtocolCompatibilityStatus(protocolVersion);
  const detectedAt = new Date().toISOString();
  const methodContract = buildGatewayMethodContractAudit({
    checkedAt: detectedAt,
    source: methodContractSource,
    methodSet,
    operations,
    unsupportedGatewayMethods
  });

  return {
    detectedAt,
    openClawVersion: version ?? null,
    gatewayProtocolVersion: protocolVersion,
    requestedProtocolRange: OPENCLAW_GATEWAY_PROTOCOL_RANGE,
    authMode,
    authRole,
    authScopes,
    supportedMethods,
    supportedEvents,
    configSchema: support("config.schema"),
    configSchemaLookup: support(...getOpenClawGatewayMethodCandidates("configSchemaLookup")),
    configPatch: support(...getOpenClawGatewayMethodCandidates("configPatch")),
    chatEvents: support(...getOpenClawGatewayMethodCandidates("missionDispatch"), "chat.history") === "supported" ||
      (getOpenClawGatewayCompatibilityOperation("missionStream").events ?? []).some((event) => eventSet.has(event))
      ? "supported"
      : methodSet.size === 0
        ? "unknown"
        : "unsupported",
    logsTail: support(...getOpenClawGatewayMethodCandidates("logsTail")),
    cronRead: support(...getOpenClawGatewayMethodCandidates("cronRead")),
    channels: support(...getOpenClawGatewayMethodCandidates("channels")),
    skills: support(...getOpenClawGatewayMethodCandidates("skills")),
    approvals: support(...getOpenClawGatewayMethodCandidates("execApprovals"), "plugin.approval.list", "plugin.approval.resolve"),
    updates: support(...getOpenClawGatewayMethodCandidates("updates")),
    nativeMissionDispatch: support(...getOpenClawGatewayMethodCandidates("missionDispatch")),
    nativeAgentLifecycle: support(
      ...getOpenClawGatewayMethodCandidates("agentCreate"),
      ...getOpenClawGatewayMethodCandidates("agentUpdate"),
      ...getOpenClawGatewayMethodCandidates("agentDelete")
    ),
    eventBridge: support(...getOpenClawGatewayMethodCandidates("missionStream"), ...getOpenClawGatewayMethodCandidates("taskEvents")) === "supported" ||
      [
        "chat",
        "agent",
        "session.message",
        "session.tool",
        "task",
        "task.updated",
        "task.completed",
        "artifact",
        "artifact.updated",
        "exec.approval.requested",
        "plugin.approval.requested"
      ].some((event) => eventSet.has(event))
      ? "supported"
      : methodSet.size === 0
        ? "unknown"
        : "unsupported",
    operations,
    compatibility: {
      protocol: {
        status: protocolStatus,
        version: protocolVersion,
        reason: resolveProtocolCompatibilityReason(protocolVersion, protocolStatus)
      },
      methodContract,
      nativeOperationCount: Object.values(operations).filter((value) => value.mode === "gateway-native").length,
      degradedOperationCount: Object.values(operations).filter((value) => value.mode === "degraded" || value.mode === "cli-fallback").length,
      unknownOperationCount: Object.values(operations).filter((value) => value.mode === "unknown").length,
      aliasOperations,
      degradedOperations: Object.entries(operations)
        .filter(([, value]) => value.mode === "degraded" || value.mode === "cli-fallback")
        .map(([name]) => name)
    },
    degradedFeatures,
    fallbackDiagnostics,
    fallbackReasons,
    unsupportedGatewayMethods,
    diagnostics
  };
}

async function callFirstSupported(
  caller: (method: string) => Promise<unknown>,
  methods: string[],
  diagnostics: string[]
): Promise<{ method: OpenClawGatewayMethodContractAuditSource; payload: unknown } | null> {
  for (const method of methods) {
    try {
      return {
        method: method as OpenClawGatewayMethodContractAuditSource,
        payload: await caller(method)
      };
    } catch (error) {
      diagnostics.push(`${method}: ${readErrorMessage(error)}`);
    }
  }

  return null;
}

function buildGatewayMethodContractAudit(input: {
  checkedAt: string;
  source: OpenClawGatewayMethodContractAuditSource;
  methodSet: Set<string>;
  operations: Record<string, OpenClawCapabilityOperation>;
  unsupportedGatewayMethods: string[];
}): OpenClawGatewayMethodContractAudit {
  if (input.source === "disabled") {
    return {
      status: "unknown",
      checkedAt: input.checkedAt,
      source: input.source,
      refreshIntervalMs: capabilityCacheTtlMs,
      expectedMethodCount: OPENCLAW_KNOWN_GATEWAY_FIRST_METHODS.length,
      advertisedMethodCount: 0,
      missingMethodCount: 0,
      missingMethods: [],
      missingOperations: [],
      reason: "Native Gateway WS is disabled by environment configuration, so AgentOS cannot compare advertised Gateway methods."
    };
  }

  if (input.methodSet.size === 0) {
    return {
      status: "unknown",
      checkedAt: input.checkedAt,
      source: input.source,
      refreshIntervalMs: capabilityCacheTtlMs,
      expectedMethodCount: OPENCLAW_KNOWN_GATEWAY_FIRST_METHODS.length,
      advertisedMethodCount: 0,
      missingMethodCount: 0,
      missingMethods: [],
      missingOperations: [],
      reason: "OpenClaw Gateway did not advertise method metadata; AgentOS will retry on the next capability refresh."
    };
  }

  const missingOperations = Object.entries(input.operations)
    .filter(([, value]) => value.compatibility === "missing")
    .map(([name]) => name);
  const status = input.unsupportedGatewayMethods.length > 0 ? "drift" : "advertised";

  return {
    status,
    checkedAt: input.checkedAt,
    source: input.source,
    refreshIntervalMs: capabilityCacheTtlMs,
    expectedMethodCount: OPENCLAW_KNOWN_GATEWAY_FIRST_METHODS.length,
    advertisedMethodCount: input.methodSet.size,
    missingMethodCount: input.unsupportedGatewayMethods.length,
    missingMethods: input.unsupportedGatewayMethods,
    missingOperations,
    reason: status === "advertised"
      ? "OpenClaw Gateway advertised every AgentOS Gateway-first method candidate; payload contracts still depend on live RPC behavior."
      : "OpenClaw Gateway advertised method metadata, but one or more AgentOS Gateway-first candidates are missing."
  };
}

function readSupportedMethods(payload: unknown) {
  const direct = readStringArray(readProperty(payload, "methods"));
  const nested = readStringArray(readProperty(readProperty(payload, "rpc"), "methods"));
  const features = readStringArray(readProperty(readProperty(payload, "features"), "methods"));
  const supported = readStringArray(readProperty(payload, "supportedMethods"));
  const methodObjects = readMethodObjects(readProperty(payload, "methods"));

  return Array.from(new Set([...direct, ...nested, ...features, ...supported, ...methodObjects])).sort();
}

function readSupportedEvents(payload: unknown) {
  const direct = readStringArray(readProperty(payload, "events"));
  const features = readStringArray(readProperty(readProperty(payload, "features"), "events"));
  return Array.from(new Set([...direct, ...features])).sort();
}

function readMethodObjects(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => readString(readProperty(entry, "name")) ?? readString(readProperty(entry, "method")))
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

  return readString(value);
}

function readAuthMode(payload: unknown) {
  return (
    readString(readProperty(payload, "authMode")) ??
    readString(readProperty(readProperty(payload, "auth"), "mode")) ??
    readString(readProperty(readProperty(payload, "security"), "authMode")) ??
    readString(readProperty(readProperty(payload, "snapshot"), "authMode"))
  );
}

function readAuthRole(payload: unknown) {
  return (
    readString(readProperty(payload, "role")) ??
    readString(readProperty(readProperty(payload, "auth"), "role")) ??
    readString(readProperty(readProperty(payload, "security"), "role"))
  );
}

function readAuthScopes(payload: unknown) {
  return Array.from(new Set([
    ...readStringArray(readProperty(payload, "scopes")),
    ...readStringArray(readProperty(readProperty(payload, "auth"), "scopes")),
    ...readStringArray(readProperty(readProperty(payload, "security"), "scopes"))
  ])).sort();
}

function resolveProtocolCompatibilityStatus(protocolVersion: string | null) {
  if (!protocolVersion) {
    return "unknown" as const;
  }

  const numericVersion = Number(protocolVersion);
  if (!Number.isFinite(numericVersion)) {
    return "unknown" as const;
  }

  return numericVersion >= OPENCLAW_GATEWAY_PROTOCOL_RANGE.min &&
    numericVersion <= OPENCLAW_GATEWAY_PROTOCOL_RANGE.max
    ? "compatible" as const
    : "unsupported" as const;
}

function resolveProtocolCompatibilityReason(
  protocolVersion: string | null,
  status: ReturnType<typeof resolveProtocolCompatibilityStatus>
) {
  if (status === "compatible") {
    return `Gateway protocol ${protocolVersion} is within AgentOS' supported range ${OPENCLAW_GATEWAY_PROTOCOL_RANGE.min}-${OPENCLAW_GATEWAY_PROTOCOL_RANGE.max}.`;
  }

  if (status === "unsupported") {
    return `Gateway protocol ${protocolVersion} is outside AgentOS' supported range ${OPENCLAW_GATEWAY_PROTOCOL_RANGE.min}-${OPENCLAW_GATEWAY_PROTOCOL_RANGE.max}.`;
  }

  return "Gateway protocol version was not advertised.";
}

function readProperty(value: unknown, key: string) {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

function readErrorMessage(error: unknown) {
  const gatewayError = error as OpenClawGatewayClientError;
  return error instanceof Error
    ? gatewayError.kind
      ? `${gatewayError.kind}: ${error.message}`
      : error.message
    : String(error || "OpenClaw Gateway request failed.");
}
