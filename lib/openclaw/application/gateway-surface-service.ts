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

export type OpenClawGatewayProductSurfaceActionKind =
  | "open-product-page"
  | "run-native-probe"
  | "retry-native-probe"
  | "view-runtime-inbox"
  | "show-scope"
  | "show-degraded"
  | "show-upstream"
  | "open-recovery"
  | "native-read"
  | "native-mutation";

export type OpenClawGatewayProductSurfaceAction = {
  id: string;
  label: string;
  kind: OpenClawGatewayProductSurfaceActionKind;
  enabled: boolean;
  href: string | null;
  method: string | null;
  reason: string;
  recovery: string;
  dangerous?: boolean;
};

export type OpenClawGatewayProductSurfaceInboxSeverity =
  | "info"
  | "warning"
  | "action_required"
  | "blocked";

export type OpenClawGatewayProductSurfaceInboxItem = {
  id: string;
  surfaceId: string;
  title: string;
  message: string;
  severity: OpenClawGatewayProductSurfaceInboxSeverity;
  status: OpenClawGatewayProductSurfaceStatus;
  method: string | null;
  recovery: string;
  createdAt: string;
  source: "gateway-surface";
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
  productHref: string | null;
  runtimeInboxHref: string;
  agentOsRoutes: string[];
  agentOsServices: string[];
  agentOsComponents: string[];
  lastCheckedAt: string;
  status: OpenClawGatewayProductSurfaceStatus;
  statusLabel: string;
  reason: string;
  recovery: string;
  nativeMethodCount: number;
  degradedOperationCount: number;
  unsupportedOperationCount: number;
  cliFallbackOperationCount: number;
  probes: OpenClawGatewayProductSurfaceProbe[];
  actions: OpenClawGatewayProductSurfaceAction[];
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
  degradedSurfaceCount: number;
  unsupportedSurfaceCount: number;
  scopeRequiredSurfaceCount: number;
  actionableItemCount: number;
  inboxItems: OpenClawGatewayProductSurfaceInboxItem[];
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
  productHref?: string;
  recoveryHref?: string;
  agentOsRoutes: string[];
  agentOsServices: string[];
  agentOsComponents: string[];
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
    productHref: "/settings#gateway",
    recoveryHref: "/settings#diagnostics",
    agentOsRoutes: ["/settings", "/api/settings/gateway", "/api/diagnostics", "/api/update"],
    agentOsServices: [
      "lib/openclaw/application/gateway-service.ts",
      "lib/openclaw/application/settings-service.ts"
    ],
    agentOsComponents: [
      "components/mission-control/settings-control-center.tsx",
      "components/runtime/runtime-inbox.tsx"
    ],
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
    productHref: "/",
    agentOsRoutes: ["/", "/api/snapshot", "/api/openclaw/capabilities", "/api/openclaw/gateway-surfaces"],
    agentOsServices: [
      "lib/openclaw/application/mission-control-service.ts",
      "lib/openclaw/application/runtime-state-service.ts",
      "lib/openclaw/application/capability-matrix-service.ts",
      "lib/openclaw/application/gateway-surface-service.ts"
    ],
    agentOsComponents: [
      "components/mission-control/mission-control-shell.tsx",
      "components/mission-control/settings-control-center.tsx",
      "components/runtime/runtime-inbox.tsx"
    ],
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
    productHref: "/agents",
    agentOsRoutes: ["/agents", "/api/agents"],
    agentOsServices: [
      "lib/openclaw/application/agent-service.ts",
      "lib/openclaw/adapter/agent-adapter.ts"
    ],
    agentOsComponents: [
      "app/agents/page.tsx",
      "components/mission-control/create-agent-dialog.tsx",
      "components/mission-control/inspector/agent-panel.tsx"
    ],
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
    productHref: "/agents",
    agentOsRoutes: ["/api/agents/[agentId]/context", "/api/agents/[agentId]/context/file"],
    agentOsServices: [
      "lib/openclaw/application/agent-service.ts",
      "lib/openclaw/application/context-engine-service.ts"
    ],
    agentOsComponents: [
      "components/mission-control/workspace-context-files-dialog.tsx",
      "components/mission-control/inspector/agent-panel.tsx"
    ],
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
    productHref: "/agents",
    agentOsRoutes: ["/api/agents/[agentId]/chat", "/api/mission", "/api/stream"],
    agentOsServices: [
      "lib/openclaw/application/mission-service.ts",
      "lib/openclaw/application/event-bridge-service.ts",
      "lib/openclaw/domains/agent-chat-sessions.ts",
      "lib/openclaw/domains/runtime-transcript.ts"
    ],
    agentOsComponents: [
      "components/mission-control/agent-chat-drawer.tsx",
      "components/mission-control/task-follow-up.tsx",
      "components/mission-control/inspector/task-panel.tsx"
    ],
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
    productHref: "/tasks",
    agentOsRoutes: ["/tasks", "/api/tasks/[taskId]/control", "/api/tasks/[taskId]/abort", "/api/tasks/[taskId]/stream"],
    agentOsServices: [
      "lib/openclaw/application/task-control-service.ts",
      "lib/openclaw/domains/task-records.ts",
      "lib/openclaw/domains/task-follow-up.ts"
    ],
    agentOsComponents: [
      "app/tasks/page.tsx",
      "components/mission-control/task-follow-up.tsx",
      "components/mission-control/inspector/task-panel.tsx"
    ],
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
    productHref: "/models",
    agentOsRoutes: ["/models", "/api/models/catalog", "/api/models/providers", "/api/onboarding/models"],
    agentOsServices: [
      "lib/openclaw/application/model-provider-state-service.ts",
      "lib/openclaw/application/model-auth-service.ts"
    ],
    agentOsComponents: [
      "app/models/page.tsx",
      "components/mission-control/add-models/add-models-dialog.tsx",
      "components/mission-control/agent-model-picker-dialog.tsx"
    ],
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
    productHref: "/settings#capabilities",
    agentOsRoutes: ["/settings", "/api/openclaw/gateway-surfaces"],
    agentOsServices: [
      "lib/openclaw/application/gateway-surface-service.ts",
      "lib/openclaw/application/capability-matrix-service.ts"
    ],
    agentOsComponents: [
      "components/mission-control/settings-control-center.tsx"
    ],
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
    productHref: "/settings#gateway",
    recoveryHref: "/settings#advanced",
    agentOsRoutes: ["/settings", "/api/settings/gateway", "/api/settings/config-pacing"],
    agentOsServices: [
      "lib/openclaw/application/settings-service.ts",
      "lib/openclaw/application/config-pacing-service.ts",
      "lib/openclaw/gateway-config-errors.ts"
    ],
    agentOsComponents: [
      "components/mission-control/settings-control-center.tsx"
    ],
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
    productHref: "/integrations",
    recoveryHref: "/accounts",
    agentOsRoutes: ["/integrations", "/accounts", "/api/workspaces/[workspaceId]/channels", "/api/accounts/browser-profiles"],
    agentOsServices: [
      "lib/openclaw/application/channel-service.ts",
      "lib/openclaw/application/browser-profile-service.ts",
      "lib/openclaw/domains/channels.ts"
    ],
    agentOsComponents: [
      "app/integrations/page.tsx",
      "app/accounts/page.tsx",
      "components/mission-control/workspace-channels-dialog.tsx",
      "components/mission-control/accounts-surface-section.tsx"
    ],
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
    productHref: "/integrations",
    agentOsRoutes: ["/integrations", "/api/openclaw/gateway-surfaces"],
    agentOsServices: [
      "lib/openclaw/application/gateway-surface-service.ts",
      "lib/openclaw/application/channel-service.ts"
    ],
    agentOsComponents: [
      "app/integrations/page.tsx",
      "components/mission-control/settings-control-center.tsx"
    ],
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
    productHref: "/agents",
    agentOsRoutes: ["/agents", "/api/openclaw/gateway-surfaces"],
    agentOsServices: [
      "lib/openclaw/capability-editor.ts",
      "lib/openclaw/tool-catalog.ts",
      "lib/openclaw/application/gateway-surface-service.ts"
    ],
    agentOsComponents: [
      "components/mission-control/agent-capability-editor-dialog.tsx",
      "components/mission-control/agent-capability-editor-column.tsx",
      "components/mission-control/settings-control-center.tsx"
    ],
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
    productHref: "/settings#diagnostics",
    recoveryHref: "/settings#diagnostics",
    agentOsRoutes: ["/settings", "/api/runtime/issues", "/api/openclaw/gateway-surfaces"],
    agentOsServices: [
      "lib/openclaw/application/runtime-issue-service.ts",
      "lib/openclaw/runtime-issues.ts",
      "lib/openclaw/application/gateway-surface-service.ts"
    ],
    agentOsComponents: [
      "components/runtime/runtime-inbox.tsx",
      "components/mission-control/settings-control-center.tsx"
    ],
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
    productHref: "/settings#gateway",
    recoveryHref: "/settings#diagnostics",
    agentOsRoutes: ["/settings", "/api/settings/gateway", "/api/runtime/issues"],
    agentOsServices: [
      "lib/openclaw/application/gateway-service.ts",
      "lib/openclaw/application/runtime-issue-service.ts",
      "lib/openclaw/gateway-auth-actions.ts"
    ],
    agentOsComponents: [
      "components/mission-control/settings-control-center.tsx",
      "components/runtime/runtime-inbox.tsx"
    ],
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
    productHref: "/files",
    agentOsRoutes: ["/files", "/api/files/reveal", "/api/workspaces/[workspaceId]/files"],
    agentOsServices: [
      "lib/openclaw/application/workspace-file-service.ts",
      "lib/openclaw/workspace-file-types.ts"
    ],
    agentOsComponents: [
      "app/files/page.tsx",
      "components/mission-control/workspace-context-files-dialog.tsx"
    ],
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
    productHref: "/settings#capabilities",
    agentOsRoutes: ["/", "/settings", "/api/agents/[agentId]/context"],
    agentOsServices: [
      "lib/openclaw/application/context-engine-service.ts",
      "lib/openclaw/application/gateway-surface-service.ts"
    ],
    agentOsComponents: [
      "components/mission-control/context-engine-dialog.tsx",
      "components/mission-control/settings-control-center.tsx"
    ],
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
    productHref: "/settings#capabilities",
    agentOsRoutes: ["/settings", "/api/openclaw/gateway-surfaces"],
    agentOsServices: [
      "lib/openclaw/application/gateway-surface-service.ts",
      "lib/openclaw/client/native-ws-gateway-client.ts"
    ],
    agentOsComponents: [
      "components/mission-control/settings-control-center.tsx"
    ],
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
    productHref: "/agents",
    agentOsRoutes: ["/agents", "/settings", "/api/openclaw/gateway-surfaces"],
    agentOsServices: [
      "lib/openclaw/capability-editor.ts",
      "lib/openclaw/application/gateway-surface-service.ts"
    ],
    agentOsComponents: [
      "components/mission-control/agent-capability-editor-dialog.tsx",
      "components/mission-control/settings-control-center.tsx"
    ],
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

    return buildSurface(definition, contracts, probes, generatedAt);
  }));
  const inboxItems = buildSnapshotInboxItems({
    surfaces,
    generatedAt,
    isRealRuntime: report.isRealRuntime,
    isSimulatedRuntime: report.isSimulatedRuntime,
    capabilitySource: report.gateway.capabilitySource,
    cliForced: report.fallback.cliForced,
    fallbackActiveCount: report.fallback.activeFallbackCount
  });

  return {
    generatedAt,
    isRealRuntime: report.isRealRuntime,
    isSimulatedRuntime: report.isSimulatedRuntime,
    capabilitySource: report.gateway.capabilitySource,
    nativeCoverageLabel: report.summary.nativeGatewayCoverageLabel,
    nativeCoveragePercent: report.summary.nativeGatewayCoveragePercent,
    cliForced: report.fallback.cliForced,
    fallbackActiveCount: report.fallback.activeFallbackCount,
    degradedSurfaceCount: surfaces.filter((surface) => surface.status === "degraded").length,
    unsupportedSurfaceCount: surfaces.filter((surface) => surface.status === "unsupported" || surface.status === "upstream-needed").length,
    scopeRequiredSurfaceCount: surfaces.filter((surface) => surface.status === "scope-required").length,
    actionableItemCount: inboxItems.filter((item) => item.severity === "action_required" || item.severity === "blocked").length,
    inboxItems,
    surfaces
  };
}

function buildSurface(
  definition: SurfaceDefinition,
  contracts: OpenClawCompatibilityContractCheck[],
  probes: OpenClawGatewayProductSurfaceProbe[],
  generatedAt: string
): OpenClawGatewayProductSurface {
  const methods = Array.from(new Set(contracts.flatMap((contract) => contract.methods))).sort();
  const events = Array.from(new Set(contracts.flatMap((contract) => contract.events))).sort();
  const scopes = Array.from(new Set(contracts.flatMap((contract) => contract.requiredScopes))).sort();
  const status = resolveSurfaceStatus(contracts, probes);
  const degradedContracts = contracts.filter((contract) => contract.status === "degraded" || contract.status === "failed");
  const unsupportedContracts = contracts.filter((contract) => contract.status === "unsupported");
  const fallbackContracts = contracts.filter((contract) => contract.cliFallbackAvailable);
  const reason = resolveSurfaceReason(contracts, probes);
  const recovery = resolveSurfaceRecovery(contracts, status);
  const actions = buildSurfaceActions({
    definition,
    contracts,
    probes,
    status,
    reason,
    recovery
  });

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
    productHref: definition.productHref ?? null,
    runtimeInboxHref: "/settings#diagnostics",
    agentOsRoutes: definition.agentOsRoutes,
    agentOsServices: definition.agentOsServices,
    agentOsComponents: definition.agentOsComponents,
    lastCheckedAt: generatedAt,
    status,
    statusLabel: formatSurfaceStatus(status),
    reason,
    recovery,
    nativeMethodCount: contracts.filter((contract) => contract.nativeGatewaySupported).length,
    degradedOperationCount: degradedContracts.length,
    unsupportedOperationCount: unsupportedContracts.length,
    cliFallbackOperationCount: fallbackContracts.length,
    probes,
    actions
  };
}

function buildSurfaceActions(input: {
  definition: SurfaceDefinition;
  contracts: OpenClawCompatibilityContractCheck[];
  probes: OpenClawGatewayProductSurfaceProbe[];
  status: OpenClawGatewayProductSurfaceStatus;
  reason: string;
  recovery: string;
}): OpenClawGatewayProductSurfaceAction[] {
  const actions: OpenClawGatewayProductSurfaceAction[] = [];
  const failedProbe = input.probes.find((probe) => probe.status === "failed");
  const missingScopes = Array.from(new Set(input.contracts.flatMap((contract) => contract.missingScopes))).sort();

  if (input.definition.productHref) {
    actions.push({
      id: `${input.definition.id}:open-product`,
      label: "Open product surface",
      kind: "open-product-page",
      enabled: true,
      href: input.definition.productHref,
      method: null,
      reason: `Open ${input.definition.uiDestination}.`,
      recovery: input.recovery
    });
  }

  if (input.probes.length > 0) {
    actions.push({
      id: `${input.definition.id}:run-probes`,
      label: failedProbe ? "Retry native probes" : "Run native probes",
      kind: failedProbe ? "retry-native-probe" : "run-native-probe",
      enabled: true,
      href: null,
      method: null,
      reason: "Refreshes read-only Gateway-native probes with CLI fallback disabled.",
      recovery: input.recovery
    });
  }

  actions.push({
    id: `${input.definition.id}:runtime-inbox`,
    label: "View runtime inbox",
    kind: "view-runtime-inbox",
    enabled: input.status !== "native",
    href: "/settings#diagnostics",
    method: null,
    reason: input.status === "native"
      ? "No runtime inbox item is required for a native surface."
      : "Open diagnostics to review this Gateway surface state with other runtime issues.",
    recovery: input.recovery
  });

  if (missingScopes.length > 0) {
    actions.push({
      id: `${input.definition.id}:scope-required`,
      label: `Scope required: ${missingScopes.slice(0, 2).join(", ")}${missingScopes.length > 2 ? "..." : ""}`,
      kind: "show-scope",
      enabled: false,
      href: null,
      method: null,
      reason: input.reason,
      recovery: input.recovery
    });
  }

  if (input.status === "degraded") {
    actions.push({
      id: `${input.definition.id}:degraded`,
      label: "Degraded until probe passes",
      kind: "show-degraded",
      enabled: false,
      href: null,
      method: failedProbe?.method ?? null,
      reason: input.reason,
      recovery: input.recovery
    });
  }

  if (input.status === "unsupported" || input.status === "upstream-needed" || input.status === "unknown") {
    actions.push({
      id: `${input.definition.id}:upstream`,
      label: input.status === "unknown" ? "Needs live Gateway verification" : "Needs OpenClaw support",
      kind: "show-upstream",
      enabled: false,
      href: null,
      method: null,
      reason: input.reason,
      recovery: input.recovery
    });
  }

  if (input.status === "recovery-cli" || input.definition.recoveryHref) {
    actions.push({
      id: `${input.definition.id}:recovery`,
      label: input.status === "recovery-cli" ? "Open explicit recovery" : "Open recovery view",
      kind: "open-recovery",
      enabled: Boolean(input.definition.recoveryHref),
      href: input.definition.recoveryHref ?? null,
      method: null,
      reason: input.status === "recovery-cli"
        ? "This surface still requires explicit CLI recovery for one or more operations."
        : "Open the AgentOS recovery surface for this Gateway area.",
      recovery: input.recovery
    });
  }

  for (const probe of input.probes.slice(0, 3)) {
    actions.push({
      id: `${input.definition.id}:read:${probe.method}`,
      label: `Native read: ${probe.method}`,
      kind: "native-read",
      enabled: false,
      href: null,
      method: probe.method,
      reason: "This read is executed by the surface probe. Use Run native probes to refresh it.",
      recovery: input.recovery
    });
  }

  const probedMethods = new Set(input.probes.map((probe) => probe.method));
  const mutationMethods = Array.from(new Set(
    input.contracts
      .flatMap((contract) => contract.methods)
      .filter((method) => !probedMethods.has(method))
      .filter(isGatewayMutationMethod)
  )).sort();

  for (const method of mutationMethods.slice(0, 3)) {
    actions.push({
      id: `${input.definition.id}:mutation:${method}`,
      label: `Mutation gated: ${method}`,
      kind: "native-mutation",
      enabled: false,
      href: null,
      method,
      reason: "Generic mutation invoke is blocked. AgentOS must expose this through a dedicated product workflow with policy and approval handling.",
      recovery: input.recovery,
      dangerous: true
    });
  }

  return actions;
}

function buildSnapshotInboxItems(input: {
  surfaces: OpenClawGatewayProductSurface[];
  generatedAt: string;
  isRealRuntime: boolean;
  isSimulatedRuntime: boolean;
  capabilitySource: OpenClawCompatibilityReport["gateway"]["capabilitySource"];
  cliForced: boolean;
  fallbackActiveCount: number;
}): OpenClawGatewayProductSurfaceInboxItem[] {
  const items: OpenClawGatewayProductSurfaceInboxItem[] = [];

  if (!input.isRealRuntime || input.isSimulatedRuntime) {
    items.push({
      id: "gateway-surface:runtime:simulated-capabilities",
      surfaceId: "runtime-presence-capabilities",
      title: "Gateway compatibility is not live-certified",
      message: `Compatibility source is ${input.capabilitySource}; surface status must be treated as degraded until a real Gateway advertises methods and scopes.`,
      severity: "warning",
      status: "degraded",
      method: null,
      recovery: "Refresh compatibility against a live OpenClaw Gateway runtime.",
      createdAt: input.generatedAt,
      source: "gateway-surface"
    });
  }

  if (input.cliForced || input.fallbackActiveCount > 0) {
    items.push({
      id: "gateway-surface:runtime:cli-fallback-active",
      surfaceId: "gateway-health",
      title: "CLI fallback is active",
      message: input.cliForced
        ? "The Gateway client is forced to CLI mode. Product flows must not treat this as Gateway-native."
        : `${input.fallbackActiveCount} compatibility diagnostic${input.fallbackActiveCount === 1 ? "" : "s"} reported active CLI fallback.`,
      severity: "action_required",
      status: "recovery-cli",
      method: null,
      recovery: "Use CLI only for setup, recovery, or Gateway process lifecycle, then refresh Gateway-native probes.",
      createdAt: input.generatedAt,
      source: "gateway-surface"
    });
  }

  for (const surface of input.surfaces) {
    if (surface.status === "native") {
      continue;
    }

    const failedProbe = surface.probes.find((probe) => probe.status === "failed");
    items.push({
      id: `gateway-surface:${surface.id}:${surface.status}`,
      surfaceId: surface.id,
      title: `${surface.label}: ${surface.statusLabel}`,
      message: surface.reason,
      severity: gatewayInboxSeverityForStatus(surface.status),
      status: surface.status,
      method: failedProbe?.method ?? surface.methods[0] ?? null,
      recovery: surface.recovery,
      createdAt: input.generatedAt,
      source: "gateway-surface"
    });
  }

  return items;
}

function gatewayInboxSeverityForStatus(
  status: OpenClawGatewayProductSurfaceStatus
): OpenClawGatewayProductSurfaceInboxSeverity {
  switch (status) {
    case "scope-required":
    case "degraded":
    case "recovery-cli":
      return "action_required";
    case "unsupported":
    case "upstream-needed":
      return "blocked";
    case "unknown":
      return "warning";
    case "native":
      return "info";
  }
}

function isGatewayMutationMethod(method: string) {
  if (/\.(list|get|status|catalog|effective|providers|preview|describe|usage|logs|schema|identity\.get)$/i.test(method)) {
    return false;
  }

  if (/^(health|status|system-presence|last-heartbeat|diagnostics\.stability|gateway\.identity\.get)$/i.test(method)) {
    return false;
  }

  return /(create|add|update|patch|delete|remove|set|apply|send|cancel|abort|approve|reject|rotate|revoke|invoke|run|enable|disable|convert|start|next|close|join|append|submit|steer|speak|request|enqueue|ack|drain|wake|login|logout|repair|reset|dedupe|backfill|scan)/i.test(method);
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
