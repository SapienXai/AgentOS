import "server-only";

import {
  getOpenClawGatewayOperationLabel,
  type OpenClawGatewayCompatibilityOperationId
} from "@/lib/openclaw/client/gateway-compatibility";
import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import { isCliGatewayClientForcedByEnv } from "@/lib/openclaw/client/native-ws-gateway-client";
import type {
  OpenClawCommandOptions,
  OpenClawGatewayClient
} from "@/lib/openclaw/client/types";
import { getOpenClawCompatibilityReport } from "@/lib/openclaw/compat";
import type {
  OpenClawCompatibilityContractCheck,
  OpenClawCompatibilityReport
} from "@/lib/openclaw/compat/types";

export type OpenClawGatewayProductSurfaceStatus =
  | "native"
  | "scope-required"
  | "degraded"
  | "unsupported"
  | "upstream-needed"
  | "recovery-cli"
  | "unknown";

export type OpenClawGatewayProductSurfaceProbeStatus = "passed" | "failed" | "skipped";

export type OpenClawGatewayProductSurfaceProbe = {
  method: string;
  status: OpenClawGatewayProductSurfaceProbeStatus;
  summary: string;
  keys: string[];
  itemCount: number | null;
  error: string | null;
};

export type OpenClawGatewayProductSurface = {
  id: string;
  label: string;
  category: string;
  operations: OpenClawGatewayCompatibilityOperationId[];
  methods: string[];
  events: string[];
  scopes: string[];
  currentAgentOsPath: string;
  uiDestination: string;
  testTarget: string;
  status: OpenClawGatewayProductSurfaceStatus;
  statusLabel: string;
  reason: string;
  recovery: string;
  nativeMethodCount: number;
  degradedOperationCount: number;
  unsupportedOperationCount: number;
  cliFallbackOperationCount: number;
  probes: OpenClawGatewayProductSurfaceProbe[];
};

export type OpenClawGatewayProductSurfaceSnapshot = {
  generatedAt: string;
  isRealRuntime: boolean;
  isSimulatedRuntime: boolean;
  capabilitySource: OpenClawCompatibilityReport["gateway"]["capabilitySource"];
  nativeCoverageLabel: string;
  nativeCoveragePercent: number;
  cliForced: boolean;
  fallbackActiveCount: number;
  surfaces: OpenClawGatewayProductSurface[];
};

type NativeCallableGatewayClient = OpenClawGatewayClient & {
  callNative?: <TPayload>(
    method: string,
    params?: Record<string, unknown>,
    options?: OpenClawCommandOptions,
    policy?: {
      safety: "read" | "mutation";
      timeoutMs?: number;
      allowCliFallback?: boolean;
    }
  ) => Promise<TPayload>;
};

type SurfaceDefinition = {
  id: string;
  label: string;
  category: string;
  operations: OpenClawGatewayCompatibilityOperationId[];
  currentAgentOsPath: string;
  uiDestination: string;
  testTarget: string;
  probes?: Array<{
    method: string;
    params?: Record<string, unknown>;
  }>;
};

const surfaceDefinitions: SurfaceDefinition[] = [
  {
    id: "gateway-health",
    label: "Gateway health / diagnostics / preflight",
    category: "Runtime",
    operations: ["health", "diagnosticsStability", "gatewayIdentity", "logsTail", "updates"],
    currentAgentOsPath: "Settings > Gateway, Settings > Diagnostics",
    uiDestination: "Settings > Gateway / Diagnostics",
    testTarget: "tests/openclaw-compat-report.test.ts",
    probes: [
      { method: "health" },
      { method: "diagnostics.stability" },
      { method: "gateway.identity.get" }
    ]
  },
  {
    id: "runtime-presence-capabilities",
    label: "Runtime snapshot, presence, capability matrix",
    category: "Runtime",
    operations: ["runtimeSnapshot", "presence"],
    currentAgentOsPath: "Mission Control snapshot + Settings > Capabilities",
    uiDestination: "Dashboard / Settings > Capabilities",
    testTarget: "tests/openclaw-compat-report.test.ts",
    probes: [
      { method: "system-presence" },
      { method: "sessions.list", params: { limit: 1 } },
      { method: "tasks.list", params: { limit: 1 } }
    ]
  },
  {
    id: "agents",
    label: "Agents lifecycle and identity",
    category: "Agents",
    operations: ["agentCreate", "agentUpdate", "agentDelete", "agentIdentity"],
    currentAgentOsPath: "Agents page + app/api/agents",
    uiDestination: "Agents page / Settings > Capabilities",
    testTarget: "tests/openclaw-agent-service.test.ts",
    probes: [
      { method: "agents.list" }
    ]
  },
  {
    id: "agent-files",
    label: "Agent files",
    category: "Agents",
    operations: ["agentFiles"],
    currentAgentOsPath: "Gateway client/adapter helper",
    uiDestination: "Agents inspector / Settings > Capabilities",
    testTarget: "tests/openclaw-native-ws-gateway-client.test.ts",
    probes: [
      { method: "agents.files.list" }
    ]
  },
  {
    id: "sessions-chat",
    label: "Sessions, chat, streaming, transcript",
    category: "Sessions",
    operations: ["sessionLifecycle", "sessionMutation", "sessionMessages", "sessionHistory", "chatMessage", "missionDispatch", "missionStream", "chatControl", "agentWait"],
    currentAgentOsPath: "Agent chat drawer, Tasks page, runtime event stream",
    uiDestination: "Agents chat / Tasks / Settings > Capabilities",
    testTarget: "tests/agent-chat-sessions.test.ts",
    probes: [
      { method: "sessions.list", params: { limit: 1 } },
      { method: "sessions.preview", params: { limit: 1 } }
    ]
  },
  {
    id: "tasks",
    label: "Tasks and continuation",
    category: "Tasks",
    operations: ["taskEvents", "taskCancel", "taskAssign"],
    currentAgentOsPath: "Tasks page + task follow-up composer",
    uiDestination: "Tasks page / Settings > Capabilities",
    testTarget: "tests/task-follow-up.test.ts",
    probes: [
      { method: "tasks.list", params: { limit: 1 } }
    ]
  },
  {
    id: "models-auth-runtime",
    label: "Models, auth, Codex runtime config",
    category: "Models",
    operations: ["models", "modelAuthOrder", "modelScan"],
    currentAgentOsPath: "Models page + Add Models dialog",
    uiDestination: "Models page / Settings > Models",
    testTarget: "tests/openclaw-model-provider-state-service.test.ts",
    probes: [
      { method: "models.list", params: { view: "configured" } },
      { method: "models.authStatus" }
    ]
  },
  {
    id: "usage-cost",
    label: "Usage, cost, and session usage",
    category: "Usage",
    operations: ["usageStatus", "usageCost", "sessionUsage"],
    currentAgentOsPath: "Gateway client/adapter helper",
    uiDestination: "Dashboard metrics / Settings > Capabilities",
    testTarget: "tests/openclaw-native-ws-gateway-client.test.ts",
    probes: [
      { method: "usage.status" },
      { method: "usage.cost" },
      { method: "sessions.usage", params: { limit: 1 } }
    ]
  },
  {
    id: "config-admin",
    label: "Config schema, patch, apply, admin scopes",
    category: "Config",
    operations: ["configSchemaLookup", "configPatch", "secrets", "wizard"],
    currentAgentOsPath: "Settings Gateway/Advanced",
    uiDestination: "Settings > Gateway / Advanced",
    testTarget: "tests/openclaw-gateway-config-errors.test.ts",
    probes: [
      { method: "config.schema.lookup", params: { path: "gateway" } },
      { method: "config.schema" }
    ]
  },
  {
    id: "channels-accounts",
    label: "Channels, accounts, Gmail, webhook provisioning",
    category: "Integrations",
    operations: ["channels", "channelList", "channelLogs", "channelLogin", "channelProvisioning", "channelRemoval", "gmailProvisioning", "browserProfiles", "voiceWake", "messaging"],
    currentAgentOsPath: "Integrations page, Accounts page, workspace channels dialog",
    uiDestination: "Integrations / Accounts / Settings > Capabilities",
    testTarget: "tests/openclaw-channel-service.test.ts",
    probes: [
      { method: "channels.status", params: { probe: false } },
      { method: "voicewake.get" }
    ]
  },
  {
    id: "cron-automation",
    label: "Cron automation",
    category: "Automation",
    operations: ["cronRead", "cronWrite", "cronRunHistory", "automationProvisioning"],
    currentAgentOsPath: "Gateway client/adapter helper",
    uiDestination: "Integrations automation summary / Settings > Capabilities",
    testTarget: "tests/openclaw-native-ws-gateway-client.test.ts",
    probes: [
      { method: "cron.status" },
      { method: "cron.list", params: { includeDisabled: true } },
      { method: "cron.runs", params: { limit: 1 } }
    ]
  },
  {
    id: "tools-commands",
    label: "Tools catalog, effective tools, invoke, commands",
    category: "Tools",
    operations: ["tools", "commands"],
    currentAgentOsPath: "Agent capability editor + Gateway helper",
    uiDestination: "Agents capability editor / Settings > Capabilities",
    testTarget: "tests/openclaw-capability-editor.test.ts",
    probes: [
      { method: "commands.list" },
      { method: "tools.catalog" },
      { method: "tools.effective" }
    ]
  },
  {
    id: "approvals",
    label: "Exec approvals and plugin approvals",
    category: "Approvals",
    operations: ["execApprovals", "pluginApprovals"],
    currentAgentOsPath: "Runtime inbox + Gateway helper",
    uiDestination: "Runtime inbox / Settings > Capabilities",
    testTarget: "tests/runtime-issues.test.ts",
    probes: [
      { method: "exec.approval.list" },
      { method: "plugin.approval.list" }
    ]
  },
  {
    id: "device-node",
    label: "Device and node pairing, presence, invoke",
    category: "Devices",
    operations: ["devicePairList", "deviceApproval", "deviceToken", "nodePairing", "nodePresence", "nodeInvoke", "nodeQueue"],
    currentAgentOsPath: "Gateway auth repair + Gateway helper",
    uiDestination: "Settings > Gateway / Capabilities",
    testTarget: "tests/openclaw-gateway-auth-settings.test.ts",
    probes: [
      { method: "device.pair.list" },
      { method: "node.pair.list" },
      { method: "node.list" }
    ]
  },
  {
    id: "artifacts-files-env",
    label: "Artifacts, environments, and files",
    category: "Files",
    operations: ["artifacts", "artifactDownload", "environments"],
    currentAgentOsPath: "Files page + Gateway helper",
    uiDestination: "Files page / Settings > Capabilities",
    testTarget: "tests/openclaw-workspace-files.test.ts",
    probes: [
      { method: "environments.list" },
      { method: "environments.status" }
    ]
  },
  {
    id: "memory-context",
    label: "Memory doctor and context engine",
    category: "Memory",
    operations: ["memoryDoctor"],
    currentAgentOsPath: "Context engine dialog + Gateway helper",
    uiDestination: "Mission Control context engine / Settings > Capabilities",
    testTarget: "tests/context-engine-service.test.ts",
    probes: [
      { method: "doctor.memory.status" }
    ]
  },
  {
    id: "talk-tts",
    label: "Talk, voice, and TTS",
    category: "Voice",
    operations: ["talkCatalog", "talkConfig", "talkSession", "talkClient", "tts"],
    currentAgentOsPath: "Gateway client/adapter helper",
    uiDestination: "Settings > Capabilities",
    testTarget: "tests/openclaw-native-ws-gateway-client.test.ts",
    probes: [
      { method: "talk.catalog" },
      { method: "talk.config", params: { includeSecrets: false } },
      { method: "tts.status" },
      { method: "tts.providers" }
    ]
  },
  {
    id: "skills-plugins",
    label: "Skills and plugins",
    category: "Extensions",
    operations: ["skills", "plugins"],
    currentAgentOsPath: "Agent capability editor + Settings diagnostics",
    uiDestination: "Agents capability editor / Settings > Capabilities",
    testTarget: "tests/openclaw-agent-skill-metadata.test.ts",
    probes: [
      { method: "skills.status" },
      { method: "plugins.list" },
      { method: "plugins.uiDescriptors" }
    ]
  }
];

export async function getOpenClawGatewayProductSurfaceSnapshot(options: {
  includeProbes?: boolean;
  timeoutMs?: number;
  compatibilityReport?: OpenClawCompatibilityReport;
  now?: () => Date;
} = {}): Promise<OpenClawGatewayProductSurfaceSnapshot> {
  const report = options.compatibilityReport ?? await getOpenClawCompatibilityReport({
    includeLiveShapeChecks: false
  });
  const client = getOpenClawGatewayClient() as NativeCallableGatewayClient;
  const nativeProbeAvailable = Boolean(client.callNative) && !isCliGatewayClientForcedByEnv();
  const contractsByOperation = new Map(report.contracts.map((contract) => [contract.operation, contract]));
  const generatedAt = (options.now?.() ?? new Date()).toISOString();

  const surfaces = await Promise.all(surfaceDefinitions.map(async (definition) => {
    const contracts = definition.operations
      .map((operation) => contractsByOperation.get(operation))
      .filter((contract): contract is OpenClawCompatibilityContractCheck => Boolean(contract));
    const probes =
      options.includeProbes === false
        ? []
        : await runSurfaceProbes({
          definition,
          client,
          nativeProbeAvailable,
          timeoutMs: options.timeoutMs ?? 2_500
        });

    return buildSurface(definition, contracts, probes);
  }));

  return {
    generatedAt,
    isRealRuntime: report.isRealRuntime,
    isSimulatedRuntime: report.isSimulatedRuntime,
    capabilitySource: report.gateway.capabilitySource,
    nativeCoverageLabel: report.summary.nativeGatewayCoverageLabel,
    nativeCoveragePercent: report.summary.nativeGatewayCoveragePercent,
    cliForced: report.fallback.cliForced,
    fallbackActiveCount: report.fallback.activeFallbackCount,
    surfaces
  };
}

function buildSurface(
  definition: SurfaceDefinition,
  contracts: OpenClawCompatibilityContractCheck[],
  probes: OpenClawGatewayProductSurfaceProbe[]
): OpenClawGatewayProductSurface {
  const methods = Array.from(new Set(contracts.flatMap((contract) => contract.methods))).sort();
  const events = Array.from(new Set(contracts.flatMap((contract) => contract.events))).sort();
  const scopes = Array.from(new Set(contracts.flatMap((contract) => contract.requiredScopes))).sort();
  const status = resolveSurfaceStatus(contracts, probes);
  const degradedContracts = contracts.filter((contract) => contract.status === "degraded" || contract.status === "failed");
  const unsupportedContracts = contracts.filter((contract) => contract.status === "unsupported");
  const fallbackContracts = contracts.filter((contract) => contract.cliFallbackAvailable);

  return {
    id: definition.id,
    label: definition.label,
    category: definition.category,
    operations: definition.operations,
    methods,
    events,
    scopes,
    currentAgentOsPath: definition.currentAgentOsPath,
    uiDestination: definition.uiDestination,
    testTarget: definition.testTarget,
    status,
    statusLabel: formatSurfaceStatus(status),
    reason: resolveSurfaceReason(contracts, probes),
    recovery: resolveSurfaceRecovery(contracts, status),
    nativeMethodCount: contracts.filter((contract) => contract.nativeGatewaySupported).length,
    degradedOperationCount: degradedContracts.length,
    unsupportedOperationCount: unsupportedContracts.length,
    cliFallbackOperationCount: fallbackContracts.length,
    probes
  };
}

function resolveSurfaceStatus(
  contracts: OpenClawCompatibilityContractCheck[],
  probes: OpenClawGatewayProductSurfaceProbe[]
): OpenClawGatewayProductSurfaceStatus {
  if (contracts.some((contract) => contract.missingScopes.length > 0)) {
    return "scope-required";
  }

  const failedProbe = probes.find((probe) => probe.status === "failed");
  if (failedProbe) {
    return "degraded";
  }

  if (contracts.length === 0) {
    return "unknown";
  }

  const nonExperimental = contracts.filter((contract) => contract.baseline !== "experimental");
  const relevantContracts = nonExperimental.length > 0 ? nonExperimental : contracts;

  if (relevantContracts.every((contract) => contract.status === "ok" && contract.nativeGatewaySupported)) {
    return "native";
  }

  if (relevantContracts.some((contract) => contract.cliFallbackAvailable && !contract.nativeGatewaySupported)) {
    return "recovery-cli";
  }

  if (relevantContracts.some((contract) => contract.status === "degraded" || contract.status === "failed")) {
    return "degraded";
  }

  if (contracts.some((contract) => contract.baseline === "experimental" && contract.status === "unsupported")) {
    return "upstream-needed";
  }

  if (relevantContracts.some((contract) => contract.status === "unsupported")) {
    return "unsupported";
  }

  return "unknown";
}

function resolveSurfaceReason(
  contracts: OpenClawCompatibilityContractCheck[],
  probes: OpenClawGatewayProductSurfaceProbe[]
) {
  const failedProbe = probes.find((probe) => probe.status === "failed");
  if (failedProbe) {
    return `${failedProbe.method}: ${failedProbe.error ?? "Gateway-native probe failed."}`;
  }

  const missingScope = contracts.find((contract) => contract.missingScopes.length > 0);
  if (missingScope) {
    return missingScope.reason;
  }

  const issue = contracts.find((contract) => contract.status !== "ok");
  if (issue) {
    return issue.reason;
  }

  if (contracts.length > 0) {
    return "All mapped OpenClaw Gateway contracts are native for the current capability report.";
  }

  return "No compatibility contract was mapped for this product surface.";
}

function resolveSurfaceRecovery(
  contracts: OpenClawCompatibilityContractCheck[],
  status: OpenClawGatewayProductSurfaceStatus
) {
  const issue = contracts.find((contract) => contract.status !== "ok" || contract.missingScopes.length > 0);
  if (issue) {
    return issue.suggestedRecovery;
  }

  if (status === "native") {
    return "No recovery action required.";
  }

  if (status === "unknown") {
    return "Refresh compatibility against a live OpenClaw Gateway runtime.";
  }

  return "Update OpenClaw or repair Gateway access, then rerun compatibility checks.";
}

async function runSurfaceProbes(input: {
  definition: SurfaceDefinition;
  client: NativeCallableGatewayClient;
  nativeProbeAvailable: boolean;
  timeoutMs: number;
}): Promise<OpenClawGatewayProductSurfaceProbe[]> {
  const probes = input.definition.probes ?? [];

  if (!input.nativeProbeAvailable) {
    return probes.map((probe) => ({
      method: probe.method,
      status: "skipped",
      summary: "Native Gateway probe skipped because the active client is CLI-forced or unavailable.",
      keys: [],
      itemCount: null,
      error: null
    }));
  }

  const settled = await Promise.allSettled(probes.map(async (probe) => {
    const payload = await input.client.callNative?.<unknown>(
      probe.method,
      probe.params ?? {},
      { timeoutMs: input.timeoutMs },
      {
        safety: "read",
        timeoutMs: input.timeoutMs,
        allowCliFallback: false
      }
    );

    return summarizeProbePayload(probe.method, payload);
  }));

  return settled.map((result, index) => {
    const method = probes[index]?.method ?? "unknown";
    if (result.status === "fulfilled") {
      return result.value;
    }

    return {
      method,
      status: "failed",
      summary: "Gateway-native probe failed without CLI fallback.",
      keys: [],
      itemCount: null,
      error: sanitizeProbeError(result.reason)
    };
  });
}

function summarizeProbePayload(method: string, payload: unknown): OpenClawGatewayProductSurfaceProbe {
  const record = readRecord(payload);
  const keys = record ? Object.keys(record).sort().slice(0, 8) : [];
  const itemCount = countPayloadItems(payload);

  return {
    method,
    status: "passed",
    summary: formatProbeSummary(method, payload, keys, itemCount),
    keys,
    itemCount,
    error: null
  };
}

function formatProbeSummary(method: string, payload: unknown, keys: string[], itemCount: number | null) {
  if (itemCount !== null) {
    return `${getOpenClawGatewayOperationLabel(method)} returned ${itemCount} item${itemCount === 1 ? "" : "s"}.`;
  }

  if (keys.length > 0) {
    return `${getOpenClawGatewayOperationLabel(method)} returned fields: ${keys.join(", ")}.`;
  }

  if (payload === null || payload === undefined) {
    return `${getOpenClawGatewayOperationLabel(method)} returned no payload.`;
  }

  return `${getOpenClawGatewayOperationLabel(method)} returned ${typeof payload}.`;
}

function countPayloadItems(payload: unknown): number | null {
  if (Array.isArray(payload)) {
    return payload.length;
  }

  const record = readRecord(payload);
  if (!record) {
    return null;
  }

  for (const key of ["items", "agents", "sessions", "tasks", "models", "tools", "commands", "jobs", "runs", "plugins", "skills", "nodes", "environments", "pending", "artifacts"]) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.length;
    }
  }

  return null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sanitizeProbeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Gateway request failed.");
  return message
    .replace(/\/Users\/[^/\s]+/g, "/Users/[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/token[=:]\s*[^,\s]+/gi, "token=[redacted]")
    .slice(0, 480);
}

function formatSurfaceStatus(status: OpenClawGatewayProductSurfaceStatus) {
  switch (status) {
    case "native":
      return "Native";
    case "scope-required":
      return "Needs Scope";
    case "degraded":
      return "Degraded";
    case "unsupported":
      return "Unsupported";
    case "upstream-needed":
      return "Upstream Needed";
    case "recovery-cli":
      return "Recovery CLI";
    case "unknown":
      return "Unknown";
  }
}
