import "server-only";

import {
  buildDiagnosticIssues,
  buildGatewayDiagnostics,
  buildSecurityWarnings,
  buildVersionDiagnostics
} from "@/lib/openclaw/adapter/diagnostics-adapter";
import { resolveAgentOsVersion } from "@/lib/agentos/version";
import { buildRuntimeDiagnosticsFromState } from "@/lib/openclaw/adapter/runtime-diagnostics-adapter";
import {
  getCachedOpenClawCapabilityMatrix,
  getOpenClawCapabilityMatrix,
  warmOpenClawCapabilityMatrix
} from "@/lib/openclaw/application/capability-matrix-service";
import {
  getCachedOpenClawCompatibilityReport,
  getOpenClawCompatibilityReport,
  warmOpenClawCompatibilityReport
} from "@/lib/openclaw/compat";
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
  OpenClawDeviceListPayload,
  PresencePayload,
  StatusPayload
} from "@/lib/openclaw/client/gateway-client";
import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import { isDeferredPayloadResult } from "@/lib/openclaw/client/payload-cache";
import { getOpenClawEventBridgeStreamStatus } from "@/lib/openclaw/application/event-bridge-service";
import { readOpenClawCompatibilityManifestOverride } from "@/lib/openclaw/compatibility-lab/store";
import { RuntimeDiagnosticsStateCache } from "@/lib/openclaw/state/runtime-diagnostics-cache";
import {
  buildModelRecords,
  buildModelsPayloadFromFallbackSources,
  mergeConfiguredModelsIntoModelsPayload
} from "@/lib/openclaw/adapter/model-adapter";
import { resolveModelReadiness } from "@/lib/openclaw/domains/control-plane-normalization";
import {
  getLatestOpenClawCompatibilitySmokeTest,
  getLatestRuntimeSmokeTest,
  type MissionControlSettings
} from "@/lib/openclaw/domains/control-plane-settings";
import { getConfigUpdatePacingSnapshotForSettings } from "@/lib/openclaw/application/config-pacing-service";
import type { SessionsPayload } from "@/lib/openclaw/domains/session-catalog";
import type { UpdateStatusPayload } from "@/lib/openclaw/adapter/gateway-payloads";
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
  updateStatus?: UpdateStatusPayload;
  hasOpenClawSignal: boolean;
  runtimeDiagnostics: MissionControlSnapshot["diagnostics"]["runtime"];
  workspaceContextIssues?: string[];
  models: ModelsPayload["models"];
  agents: OpenClawAgent[];
  modelStatus?: ModelsStatusPayload;
  deviceAccess?: OpenClawDeviceListPayload;
  payloadResults: {
    gatewayStatus: PromiseSettledResult<GatewayStatusPayload>;
    status: PromiseSettledResult<StatusPayload>;
    updateStatus: PromiseSettledResult<UpdateStatusPayload>;
    deviceAccess: PromiseSettledResult<OpenClawDeviceListPayload>;
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
    updateStatus: PayloadReuseState;
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
    updateStatus: input.updateStatus,
    updateStatusError: describePayloadError(input.payloadResults.updateStatus),
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
  const transport = getOpenClawGatewayClient()?.getDiagnostics?.();
  const compatibilityReport =
    input.profile === "interactive"
      ? getCachedOpenClawCompatibilityReport() ?? undefined
      : await getOpenClawCompatibilityReport({
        status: input.status ?? null,
        gatewayStatus: input.gatewayStatus ?? null,
        transport,
        includeLiveShapeChecks: false
      }).catch(() => undefined);
  if (input.profile === "interactive" && !compatibilityReport) {
    warmOpenClawCompatibilityReport();
  }
  const updateCompatibilityManifest = await readOpenClawCompatibilityManifestOverride();

  return buildGatewayDiagnostics({
    gatewayStatus: input.gatewayStatus,
    status: input.status,
    deviceAccess: input.deviceAccess,
    configuredWorkspaceRoot: input.configuredWorkspaceRoot,
    workspaceRoot: resolveWorkspaceRoot(input.configuredWorkspaceRoot),
    configuredGatewayUrl: input.configuredGatewayUrl,
    hasOpenClawSignal: input.hasOpenClawSignal,
    securityWarnings,
    runtimeDiagnostics: input.runtimeDiagnostics,
    openClawBinarySelection,
    modelReadiness,
    capabilityMatrix,
    compatibilityReport,
    configUpdatePacing: getConfigUpdatePacingSnapshotForSettings(input.settings),
    compatibilitySmokeTest: getLatestOpenClawCompatibilitySmokeTest(input.settings),
    updateCompatibilityManifest,
    commandHistory: getRecentOpenClawCommandDiagnostics(),
    transport,
    eventBridge: getOpenClawEventBridgeStreamStatus(),
    runtimeIssueStates: input.settings.runtimeIssues,
    versionDiagnostics,
    agentOsVersion: await resolveAgentOsVersion(),
    issues: buildDiagnosticIssues({
      payloadResults: input.payloadResults,
      gatewayStatusRejectedWithCachedValue: input.gatewayStatusRejectedWithCachedValue,
      payloadReuse: input.payloadReuse,
      runtimeIssues: [
        ...input.runtimeDiagnostics.issues,
        ...(input.workspaceContextIssues ?? [])
      ]
    })
  });
}

function describePayloadError(result: PromiseSettledResult<unknown>) {
  if (result.status !== "rejected" || isDeferredPayloadResult(result)) {
    return undefined;
  }

  return result.reason instanceof Error ? result.reason.message : String(result.reason);
}

export function buildMissionControlModelRecords(input: {
  models: ModelsPayload["models"];
  agents: OpenClawAgent[];
  modelStatus?: ModelsStatusPayload;
  configuredModelIds?: Iterable<string>;
}) {
  return buildModelRecords(
    mergeConfiguredModelsIntoModelsPayload(input.models, input.configuredModelIds ?? []),
    input.agents,
    input.modelStatus
  );
}

export function buildFallbackModels(input: {
  agentConfig: AgentConfigPayload;
  modelStatus?: ModelsStatusPayload;
  configuredModelIds?: Iterable<string>;
}) {
  return buildModelsPayloadFromFallbackSources(
    input.agentConfig,
    input.modelStatus,
    input.configuredModelIds ?? []
  );
}
