import "server-only";

import {
  buildDiagnosticIssues,
  buildGatewayDiagnostics,
  buildSecurityWarnings,
  buildVersionDiagnostics
} from "@/lib/openclaw/adapter/diagnostics-adapter";
import { buildRuntimeDiagnosticsFromState } from "@/lib/openclaw/adapter/runtime-diagnostics-adapter";
import {
  getCachedOpenClawCapabilityMatrix,
  getOpenClawCapabilityMatrix,
  warmOpenClawCapabilityMatrix
} from "@/lib/openclaw/application/capability-matrix-service";
import {
  buildOpenClawBinarySelectionSnapshot,
  readOpenClawBinarySelection
} from "@/lib/openclaw/binary-selection";
import { getRecentOpenClawCommandDiagnostics, getResolvedOpenClawBin, resolveOpenClawVersion } from "@/lib/openclaw/cli";
import type {
  AgentConfigPayload,
  AgentPayload,
  GatewayStatusPayload,
  ModelsPayload,
  ModelsStatusPayload,
  PresencePayload,
  StatusPayload
} from "@/lib/openclaw/client/gateway-client";
import { getRecentOpenClawGatewayFallbackDiagnostics } from "@/lib/openclaw/client/gateway-client";
import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import { filterActiveOpenClawGatewayFallbackDiagnostics } from "@/lib/openclaw/client/gateway-diagnostic-activity";
import { RuntimeDiagnosticsStateCache } from "@/lib/openclaw/state/runtime-diagnostics-cache";
import {
  buildModelRecords,
  buildModelsPayloadFromFallbackSources
} from "@/lib/openclaw/adapter/model-adapter";
import { resolveModelReadiness } from "@/lib/openclaw/domains/control-plane-normalization";
import {
  getLatestOpenClawCompatibilitySmokeTest,
  getLatestRuntimeSmokeTest,
  type MissionControlSettings
} from "@/lib/openclaw/domains/control-plane-settings";
import type { SessionsPayload } from "@/lib/openclaw/domains/session-catalog";
import type {
  MissionControlSnapshot,
  OpenClawAgent
} from "@/lib/openclaw/types";
import { resolveWorkspaceRoot } from "@/lib/openclaw/application/mission-control/snapshot-utils";

type PayloadReuseState = {
  reusedCachedValue: boolean;
};

export async function buildMissionControlRuntimeDiagnostics(
  agents: Array<{ id: string; agentDir?: string | null }>,
  settings: MissionControlSettings,
  runtimeDiagnosticsStateCache: RuntimeDiagnosticsStateCache
) {
  const agentIds = agents.map((agent) => agent.id).filter(Boolean);
  const agentDirs = Object.fromEntries(
    agents
      .filter((agent) => agent.id)
      .map((agent) => [agent.id, agent.agentDir])
  );
  const runtimeState = await runtimeDiagnosticsStateCache.read(agentIds, agentDirs);
  const smokeTest = getLatestRuntimeSmokeTest(settings);
  return buildRuntimeDiagnosticsFromState(
    runtimeState,
    smokeTest
  ) satisfies MissionControlSnapshot["diagnostics"]["runtime"];
}

export async function buildLiveMissionControlDiagnostics(input: {
  profile: "interactive" | "refresh" | "system";
  settings: MissionControlSettings;
  configuredWorkspaceRoot: string | null;
  configuredGatewayUrl?: string | null;
  gatewayStatus?: GatewayStatusPayload;
  status?: StatusPayload;
  hasOpenClawSignal: boolean;
  runtimeDiagnostics: MissionControlSnapshot["diagnostics"]["runtime"];
  models: ModelsPayload["models"];
  agents: OpenClawAgent[];
  modelStatus?: ModelsStatusPayload;
  payloadResults: {
    gatewayStatus: PromiseSettledResult<GatewayStatusPayload>;
    status: PromiseSettledResult<StatusPayload>;
    agents: PromiseSettledResult<AgentPayload>;
    agentConfig: PromiseSettledResult<AgentConfigPayload>;
    models: PromiseSettledResult<ModelsPayload>;
    modelStatus: PromiseSettledResult<ModelsStatusPayload>;
    sessions: PromiseSettledResult<SessionsPayload>;
    presence: PromiseSettledResult<PresencePayload>;
  };
  gatewayStatusRejectedWithCachedValue: boolean;
  payloadReuse: {
    status: PayloadReuseState;
    agents: PayloadReuseState;
    agentConfig: PayloadReuseState;
    models: PayloadReuseState;
    modelStatus: PayloadReuseState;
    sessions: PayloadReuseState;
    presence: PayloadReuseState;
  };
}) {
  const modelReadiness = resolveModelReadiness(input.models, input.modelStatus);
  const securityWarnings = buildSecurityWarnings(input.status);
  const versionDiagnostics = buildVersionDiagnostics({
    status: input.status,
    fallbackVersion: (await resolveOpenClawVersion()) ?? undefined
  });
  const openClawBinarySelection = buildOpenClawBinarySelectionSnapshot(
    await readOpenClawBinarySelection(),
    getResolvedOpenClawBin()
  );
  const capabilityMatrix =
    input.profile === "interactive"
      ? getCachedOpenClawCapabilityMatrix() ?? undefined
      : await getOpenClawCapabilityMatrix().catch(() => undefined);
  if (input.profile === "interactive" && !capabilityMatrix) {
    warmOpenClawCapabilityMatrix();
  }
  const transport = getOpenClawGatewayClient().getDiagnostics?.();
  const gatewayFallbackIssues = filterActiveOpenClawGatewayFallbackDiagnostics(
    getRecentOpenClawGatewayFallbackDiagnostics(),
    transport
  ).map(
    (entry) => `gateway.${entry.operation}: Gateway-first request fell back to CLI (${entry.kind}): ${entry.issue} Recovery: ${entry.recovery}`
  );

  return buildGatewayDiagnostics({
    gatewayStatus: input.gatewayStatus,
    status: input.status,
    configuredWorkspaceRoot: input.configuredWorkspaceRoot,
    workspaceRoot: resolveWorkspaceRoot(input.configuredWorkspaceRoot),
    configuredGatewayUrl: input.configuredGatewayUrl,
    hasOpenClawSignal: input.hasOpenClawSignal,
    securityWarnings,
    runtimeDiagnostics: input.runtimeDiagnostics,
    openClawBinarySelection,
    modelReadiness,
    capabilityMatrix,
    compatibilitySmokeTest: getLatestOpenClawCompatibilitySmokeTest(input.settings),
    commandHistory: getRecentOpenClawCommandDiagnostics(),
    transport,
    versionDiagnostics,
    issues: buildDiagnosticIssues({
      payloadResults: input.payloadResults,
      gatewayStatusRejectedWithCachedValue: input.gatewayStatusRejectedWithCachedValue,
      payloadReuse: input.payloadReuse,
      runtimeIssues: [...input.runtimeDiagnostics.issues, ...gatewayFallbackIssues]
    })
  });
}

export function buildMissionControlModelRecords(input: {
  models: ModelsPayload["models"];
  agents: OpenClawAgent[];
  modelStatus?: ModelsStatusPayload;
}) {
  return buildModelRecords(input.models, input.agents, input.modelStatus);
}

export function buildFallbackModels(input: {
  agentConfig: AgentConfigPayload;
  modelStatus?: ModelsStatusPayload;
}) {
  return buildModelsPayloadFromFallbackSources(input.agentConfig, input.modelStatus);
}
