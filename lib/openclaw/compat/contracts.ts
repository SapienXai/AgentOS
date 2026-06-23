import {
  OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS,
  type OpenClawGatewayCompatibilityOperationDefinition
} from "@/lib/openclaw/client/gateway-compatibility";
import type {
  OpenClawCompatibilityCapabilityId,
  OpenClawCompatibilityContractCheck,
  OpenClawCompatibilityContractInput,
  OpenClawCompatibilityContractStatus,
  OpenClawCompatibilityResponseShapeStatus
} from "@/lib/openclaw/compat/types";

type ContractProbe = {
  params: Record<string, unknown>;
  validate: (payload: unknown) => boolean;
};

const operationSurfaceMap: Partial<Record<string, OpenClawCompatibilityCapabilityId>> = {
  health: "gatewayHealth",
  diagnosticsStability: "gatewayHealth",
  gatewayIdentity: "gatewayHealth",
  presence: "presence",
  logsTail: "gatewayHealth",
  models: "models",
  modelAuthOrder: "authProfiles",
  modelScan: "models",
  usageStatus: "usage",
  usageCost: "usage",
  sessionUsage: "usage",
  memoryDoctor: "memory",
  messaging: "channels",
  secrets: "secrets",
  wizard: "secrets",
  sessionLifecycle: "sessions",
  sessionMutation: "sessions",
  sessionMessages: "sessions",
  sessionHistory: "transcripts",
  chatMessage: "transcripts",
  missionDispatch: "chat",
  missionStream: "chat",
  chatControl: "chat",
  agentWait: "sessions",
  taskEvents: "tasks",
  taskAssign: "tasks",
  taskCancel: "tasks",
  artifacts: "artifacts",
  artifactDownload: "artifacts",
  runtimeSnapshot: "sessions",
  commands: "commands",
  tools: "tools",
  plugins: "plugins",
  execApprovals: "approvals",
  pluginApprovals: "approvals",
  devicePairList: "devices",
  deviceApproval: "devices",
  deviceToken: "devices",
  nodePairing: "nodes",
  nodePresence: "nodes",
  nodeInvoke: "nodes",
  nodeQueue: "nodes",
  cronRead: "cron",
  cronWrite: "cron",
  cronRunHistory: "cron",
  channels: "channels",
  channelList: "channels",
  channelLogs: "channels",
  channelLogin: "channels",
  channelProvisioning: "channels",
  channelRemoval: "channels",
  gmailProvisioning: "channels",
  automationProvisioning: "cron",
  browserProfiles: "accountsBrowserProfiles",
  voiceWake: "channels",
  talkCatalog: "talk",
  talkConfig: "talk",
  talkSession: "talk",
  talkClient: "talk",
  tts: "tts",
  environments: "environments",
  skills: "skills",
  updates: "updates",
  configSchemaLookup: "config",
  configPatch: "config",
  agentCreate: "agents",
  agentUpdate: "agents",
  agentIdentity: "agents",
  agentFiles: "agentFiles",
  agentDelete: "agents"
};

const operationRequiredScopes: Partial<Record<string, string[]>> = {
  configSchemaLookup: ["operator.admin"],
  configPatch: ["operator.admin"],
  secrets: ["operator.admin"],
  wizard: ["operator.admin"],
  updates: ["operator.admin"],
  execApprovals: ["operator.approvals"],
  pluginApprovals: ["operator.approvals"],
  deviceApproval: ["operator.pairing"],
  deviceToken: ["operator.pairing"],
  nodePairing: ["operator.pairing"]
};

const methodProbes: Record<string, ContractProbe> = {
  health: {
    params: {},
    validate: isObjectRecord
  },
  status: {
    params: {},
    validate: isObjectRecord
  },
  "update.status": {
    params: {},
    validate: isObjectRecord
  },
  "models.list": {
    params: { view: "configured" },
    validate: (payload) => Array.isArray(readObject(payload)?.models)
  },
  "models.authStatus": {
    params: {},
    validate: isObjectRecord
  },
  "usage.status": {
    params: {},
    validate: isObjectRecord
  },
  "usage.cost": {
    params: {},
    validate: isObjectRecord
  },
  "sessions.usage": {
    params: { limit: 1 },
    validate: isObjectRecord
  },
  "sessions.usage.timeseries": {
    params: { limit: 1 },
    validate: isObjectRecord
  },
  "sessions.usage.logs": {
    params: { limit: 1 },
    validate: isObjectRecord
  },
  "doctor.memory.status": {
    params: {},
    validate: isObjectRecord
  },
  "diagnostics.stability": {
    params: {},
    validate: isObjectRecord
  },
  "gateway.identity.get": {
    params: {},
    validate: isObjectRecord
  },
  "system-presence": {
    params: {},
    validate: isObjectRecord
  },
  "sessions.list": {
    params: { limit: 1 },
    validate: (payload) => Array.isArray(readObject(payload)?.sessions)
  },
  "sessions.preview": {
    params: { limit: 1 },
    validate: isObjectRecord
  },
  "tasks.list": {
    params: { limit: 1 },
    validate: (payload) => Array.isArray(readObject(payload)?.tasks)
  },
  "tasks.get": {
    params: { taskId: "__agentos_contract_probe__" },
    validate: isObjectRecord
  },
  "commands.list": {
    params: {},
    validate: (payload) => Array.isArray(readObject(payload)?.commands) || isObjectRecord(payload)
  },
  "tools.catalog": {
    params: {},
    validate: (payload) => {
      const record = readObject(payload);
      return Array.isArray(record?.tools) || Array.isArray(record?.groups);
    }
  },
  "tools.effective": {
    params: {},
    validate: (payload) => Array.isArray(readObject(payload)?.tools)
  },
  "plugins.list": {
    params: {},
    validate: (payload) => Array.isArray(readObject(payload)?.plugins)
  },
  "plugins.uiDescriptors": {
    params: {},
    validate: isObjectRecord
  },
  "device.pair.list": {
    params: {},
    validate: isObjectRecord
  },
  "node.pair.list": {
    params: {},
    validate: isObjectRecord
  },
  "node.list": {
    params: {},
    validate: isObjectRecord
  },
  "devices.list": {
    params: {},
    validate: isObjectRecord
  },
  "cron.status": {
    params: {},
    validate: isObjectRecord
  },
  "cron.list": {
    params: { includeDisabled: true },
    validate: (payload) => Array.isArray(readObject(payload)?.jobs)
  },
  "cron.runs": {
    params: { limit: 1 },
    validate: isObjectRecord
  },
  "channels.status": {
    params: { probe: false },
    validate: isObjectRecord
  },
  "web.login.start": {
    params: {},
    validate: isObjectRecord
  },
  "voicewake.get": {
    params: {},
    validate: isObjectRecord
  },
  "talk.catalog": {
    params: {},
    validate: isObjectRecord
  },
  "talk.config": {
    params: { includeSecrets: false },
    validate: isObjectRecord
  },
  "tts.status": {
    params: {},
    validate: isObjectRecord
  },
  "tts.providers": {
    params: {},
    validate: isObjectRecord
  },
  "environments.list": {
    params: {},
    validate: isObjectRecord
  },
  "environments.status": {
    params: {},
    validate: isObjectRecord
  },
  "config.get": {
    params: {},
    validate: isObjectRecord
  },
  "config.schema": {
    params: {},
    validate: isObjectRecord
  },
  "config.schema.lookup": {
    params: { path: "gateway" },
    validate: isObjectRecord
  },
  "logs.tail": {
    params: { limit: 1, maxBytes: 2048 },
    validate: isObjectRecord
  },
  "skills.status": {
    params: {},
    validate: isObjectRecord
  },
  "browser.request": {
    params: { method: "GET", path: "/profiles", timeoutMs: 5000 },
    validate: (payload) => Array.isArray(readObject(payload)?.profiles)
  }
};

export async function checkOpenClawCompatibilityContracts(
  input: OpenClawCompatibilityContractInput
): Promise<OpenClawCompatibilityContractCheck[]> {
  const methodSet = new Set(input.effectiveMethods);
  const eventSet = new Set(input.effectiveEvents);
  const checks: OpenClawCompatibilityContractCheck[] = [];

  for (const operation of OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS) {
    checks.push(await checkOperationContract(operation, methodSet, eventSet, input));
  }

  return checks;
}

async function checkOperationContract(
  operation: OpenClawGatewayCompatibilityOperationDefinition,
  methodSet: Set<string>,
  eventSet: Set<string>,
  input: OpenClawCompatibilityContractInput
): Promise<OpenClawCompatibilityContractCheck> {
  const supportedMethod = operation.methods.find((method) => methodSet.has(method)) ?? null;
  const supportedEvent = operation.events?.find((event) => eventSet.has(event)) ?? null;
  const advertisedNativeSupport = Boolean(supportedMethod || supportedEvent);
  const liveCapabilityMetadata = input.capabilitySource !== "version-default";
  const versionDefaultExpectation = advertisedNativeSupport && !liveCapabilityMetadata;
  const requiredScopes = operationRequiredScopes[operation.id] ?? [];
  const missingScopes = input.authScopes.length > 0 && advertisedNativeSupport
    ? requiredScopes.filter((scope) => !input.authScopes.includes(scope))
    : [];
  const nativeGatewaySupported = advertisedNativeSupport && missingScopes.length === 0 && liveCapabilityMetadata;
  const fallbackAllowed = operation.fallbackAllowed !== false;
  const cliFallbackAvailable = fallbackAllowed && input.cliFallbackAvailable;
  const baseline = operation.baseline ?? "optional";
  const required = baseline === "required";
  let responseShapeStatus: OpenClawCompatibilityResponseShapeStatus = "not-checked";
  let responseShapeValid: boolean | null = null;
  let liveFailure: string | null = null;

  if (
    nativeGatewaySupported &&
    input.includeLiveShapeChecks &&
    input.callNative &&
    supportedMethod
  ) {
    const probe = methodProbes[supportedMethod];

    if (probe) {
      try {
        const payload = await input.callNative(supportedMethod, probe.params);
        responseShapeValid = probe.validate(payload);
        responseShapeStatus = responseShapeValid ? "valid" : "invalid";
      } catch (error) {
        liveFailure = readErrorMessage(error);
        responseShapeValid = false;
        responseShapeStatus = "invalid";
      }
    }
  }

  const status = resolveContractStatus({
    nativeGatewaySupported,
    cliFallbackAvailable,
    versionDefaultExpectation,
    responseShapeStatus,
    liveFailure
  });
  const reason = resolveContractReason({
    operation,
    supportedMethod,
    supportedEvent,
    missingScopes,
    nativeGatewaySupported,
    cliFallbackAvailable,
    responseShapeStatus,
    liveFailure,
    capabilitySource: input.capabilitySource
  });

  return {
    operation: operation.id,
    label: operation.label,
    surface: operationSurfaceMap[operation.id] ?? "gatewayHealth",
    required,
    baseline,
    methods: operation.methods,
    events: operation.events ?? [],
    supportedMethod,
    supportedEvent,
    requiredScopes,
    missingScopes,
    nativeGatewaySupported,
    cliFallbackAvailable,
    responseShapeStatus,
    responseShapeValid,
    status,
    reason,
    suggestedRecovery: resolveContractRecovery(status, operation.label, required, cliFallbackAvailable, missingScopes)
  };
}

function resolveContractStatus(input: {
  nativeGatewaySupported: boolean;
  cliFallbackAvailable: boolean;
  versionDefaultExpectation: boolean;
  responseShapeStatus: OpenClawCompatibilityResponseShapeStatus;
  liveFailure: string | null;
}): OpenClawCompatibilityContractStatus {
  if (input.nativeGatewaySupported) {
    return input.responseShapeStatus === "invalid" || input.liveFailure ? "failed" : "ok";
  }

  if (input.versionDefaultExpectation) {
    return "degraded";
  }

  return input.cliFallbackAvailable ? "degraded" : "unsupported";
}

function resolveContractReason(input: {
  operation: OpenClawGatewayCompatibilityOperationDefinition;
  supportedMethod: string | null;
  supportedEvent: string | null;
  missingScopes: string[];
  nativeGatewaySupported: boolean;
  cliFallbackAvailable: boolean;
  responseShapeStatus: OpenClawCompatibilityResponseShapeStatus;
  liveFailure: string | null;
  capabilitySource: OpenClawCompatibilityContractInput["capabilitySource"];
}) {
  if (input.liveFailure) {
    return `${input.operation.label} advertised native support, but the live response check failed: ${input.liveFailure}`;
  }

  if (input.missingScopes.length > 0) {
    const evidence = input.supportedMethod ?? input.supportedEvent ?? "capability metadata";
    return `${input.operation.label} is advertised through ${evidence}, but the authenticated operator is missing ${formatScopeList(input.missingScopes)}.`;
  }

  if (input.nativeGatewaySupported) {
    const evidence = input.supportedMethod ?? input.supportedEvent ?? "capability metadata";
    if (input.responseShapeStatus === "invalid") {
      return `${input.operation.label} advertised ${evidence}, but the response shape did not match AgentOS' contract.`;
    }

    if (input.responseShapeStatus === "valid") {
      return `${input.operation.label} is native through ${evidence} and the response shape matched AgentOS' contract.`;
    }

    return `${input.operation.label} is native through ${evidence}; response shape was not checked in this report.`;
  }

  if (input.capabilitySource === "version-default" && (input.supportedMethod || input.supportedEvent)) {
    const evidence = input.supportedMethod ?? input.supportedEvent;
    return `${input.operation.label} matches the version-default expectation through ${evidence}, but live Gateway capability metadata was not advertised.`;
  }

  if (input.cliFallbackAvailable) {
    return `${input.operation.label} is not native in the ${input.capabilitySource} capability set; AgentOS can use explicit CLI fallback for recovery.`;
  }

  return `${input.operation.label} is not native in the ${input.capabilitySource} capability set and no safe CLI fallback is available.`;
}

function resolveContractRecovery(
  status: OpenClawCompatibilityContractStatus,
  label: string,
  required: boolean,
  cliFallbackAvailable: boolean,
  missingScopes: string[] = []
) {
  if (missingScopes.length > 0) {
    return `Repair local OpenClaw device access so AgentOS has ${formatScopeList(missingScopes)}, then rerun compatibility checks.`;
  }

  switch (status) {
    case "ok":
      return "No recovery action required.";
    case "degraded":
      return cliFallbackAvailable
        ? `Update OpenClaw for native ${label} support; CLI fallback remains an explicit recovery path.`
        : `Update OpenClaw for native ${label} support.`;
    case "unsupported":
      return required
        ? `Install the supported OpenClaw baseline or update OpenClaw until ${label} is available through Gateway.`
        : `Update OpenClaw if ${label} is required for this AgentOS surface.`;
    case "failed":
      return `Update OpenClaw or AgentOS so the ${label} Gateway response matches the contract, then rerun compatibility checks.`;
  }
}

function formatScopeList(scopes: string[]) {
  return scopes.length === 1 ? `scope ${scopes[0]}` : `scopes ${scopes.join(", ")}`;
}

function readObject(value: unknown) {
  return isObjectRecord(value) ? value : null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Gateway request failed.");
}
