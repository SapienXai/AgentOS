import {
  OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS,
  type OpenClawGatewayCompatibilityOperationDefinition
} from "@/lib/openclaw/client/gateway-compatibility";
import type { OpenClawCompatibilityLabAreaId } from "@/lib/openclaw/compatibility-lab/types";
import { OPENCLAW_SUPPORTED_BASELINE_VERSION } from "@/lib/openclaw/versions";
import type {
  AgentOsOpenClawContract,
  AgentOsOpenClawContractOperation
} from "@/lib/openclaw/contracts/types";

const areaByOperation: Record<string, OpenClawCompatibilityLabAreaId> = {
  health: "gateway-protocol",
  logsTail: "gateway-protocol",
  updates: "rollback-recovery",
  models: "models-providers",
  modelAuthOrder: "models-providers",
  modelScan: "models-providers",
  configSchemaLookup: "config-patching",
  configPatch: "config-patching",
  sessionLifecycle: "sessions-tasks-agents",
  agentCreate: "sessions-tasks-agents",
  agentUpdate: "sessions-tasks-agents",
  agentIdentity: "sessions-tasks-agents",
  agentDelete: "sessions-tasks-agents",
  missionDispatch: "sessions-tasks-agents",
  missionStream: "sessions-tasks-agents",
  chatControl: "sessions-tasks-agents",
  agentWait: "sessions-tasks-agents",
  sessionHistory: "sessions-tasks-agents",
  taskEvents: "sessions-tasks-agents",
  taskAssign: "sessions-tasks-agents",
  taskCancel: "sessions-tasks-agents",
  artifacts: "sessions-tasks-agents",
  runtimeSnapshot: "sessions-tasks-agents",
  tools: "native-rpc",
  plugins: "config-patching",
  execApprovals: "channels-accounts-scopes",
  devicePairList: "channels-accounts-scopes",
  deviceApproval: "channels-accounts-scopes",
  cronRead: "channels-accounts-scopes",
  channels: "channels-accounts-scopes",
  channelList: "channels-accounts-scopes",
  channelLogs: "channels-accounts-scopes",
  channelProvisioning: "channels-accounts-scopes",
  channelRemoval: "channels-accounts-scopes",
  gmailProvisioning: "channels-accounts-scopes",
  automationProvisioning: "channels-accounts-scopes",
  browserProfiles: "channels-accounts-scopes",
  skills: "config-patching"
};

const affectedFilesByArea: Record<OpenClawCompatibilityLabAreaId, string[]> = {
  "manifest-policy": ["lib/openclaw/update-compatibility.ts"],
  "gateway-protocol": ["lib/openclaw/client/*", "lib/openclaw/adapter/*"],
  "native-rpc": ["lib/openclaw/client/gateway-compatibility.ts", "lib/openclaw/compat/*"],
  "payload-shapes": ["lib/openclaw/client/native-ws-gateway-payloads.ts", "lib/openclaw/adapter/gateway-payloads.ts"],
  "models-providers": ["lib/openclaw/application/model-provider-state-service.ts", "lib/openclaw/model-provider-registry.ts"],
  "sessions-tasks-agents": ["lib/openclaw/application/runtime-service.ts", "lib/openclaw/application/task-control-service.ts", "lib/openclaw/application/agent-service.ts"],
  "config-patching": ["lib/openclaw/application/settings-service.ts", "lib/openclaw/update-rollback.ts"],
  "channels-accounts-scopes": ["lib/openclaw/application/channel-service.ts", "lib/openclaw/application/runtime-issue-service.ts"],
  "runtime-smoke": ["lib/openclaw/application/compatibility-smoke-service.ts"],
  "rollback-recovery": ["lib/openclaw/update-safety.ts", "lib/openclaw/update-recovery.ts", "lib/openclaw/certification-scorecard.ts"]
};

const regressionTestsByArea: Record<OpenClawCompatibilityLabAreaId, string[]> = {
  "manifest-policy": ["tests/openclaw-update-compatibility.test.ts"],
  "gateway-protocol": ["tests/openclaw-gateway-first-contract.test.ts", "tests/openclaw-native-ws-gateway-client.test.ts"],
  "native-rpc": ["tests/openclaw-compat-report.test.ts", "tests/openclaw-contract-registry.test.ts"],
  "payload-shapes": ["tests/openclaw-compat-report.test.ts", "tests/openclaw-native-ws-gateway-client.test.ts"],
  "models-providers": ["tests/openclaw-model-provider-state-service.test.ts", "tests/openclaw-compatibility-smoke.test.ts"],
  "sessions-tasks-agents": ["tests/openclaw-runtime-state-service.test.ts", "tests/openclaw-agent-service.test.ts"],
  "config-patching": ["tests/settings-transport-diagnostics.test.ts", "tests/openclaw-gateway-config-errors.test.ts"],
  "channels-accounts-scopes": ["tests/openclaw-channel-service.test.ts", "tests/runtime-issues.test.ts"],
  "runtime-smoke": ["tests/openclaw-compatibility-smoke.test.ts"],
  "rollback-recovery": ["tests/openclaw-certification-scorecard.test.ts", "tests/openclaw-update-compatibility.test.ts"]
};

export const AGENTOS_OPENCLAW_CONTRACT: AgentOsOpenClawContract = {
  schemaVersion: 1,
  agentOsContractVersion: "2026.6.1-agentos.1",
  certifiedOpenClawBaseline: OPENCLAW_SUPPORTED_BASELINE_VERSION,
  operations: OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS.map(toContractOperation)
};

function toContractOperation(
  operation: OpenClawGatewayCompatibilityOperationDefinition
): AgentOsOpenClawContractOperation {
  const areaId = areaByOperation[operation.id] ?? "native-rpc";
  const requirement = operation.baseline ?? "optional";
  const firstMethod = operation.methods[0];
  const firstEvent = operation.events?.[0];

  return {
    id: operation.id,
    areaId,
    label: operation.label,
    gatewayMethod: firstMethod,
    gatewayMethods: operation.methods,
    eventName: firstEvent,
    eventNames: operation.events ?? [],
    requirement,
    expectedPayloadShape: firstMethod ? `${firstMethod} response accepted by AgentOS normalizers` : undefined,
    requiredScopes: operation.id === "execApprovals" ? ["operator.approvals"] : [],
    cliFallbackAllowed: operation.fallbackAllowed !== false,
    cliFallbackCommand: operation.fallbackAllowed === false ? undefined : `openclaw ${operation.id}`,
    blocksCertification: requirement === "required" || operation.fallbackAllowed === false,
    affectedAgentOsFiles: affectedFilesByArea[areaId],
    regressionTests: regressionTestsByArea[areaId]
  };
}
