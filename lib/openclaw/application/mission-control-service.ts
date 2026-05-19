import "server-only";

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createErrorSnapshot } from "@/lib/openclaw/fallback";
import { detectOpenClaw, getRecentOpenClawCommandDiagnostics, getResolvedOpenClawBin, resolveOpenClawVersion } from "@/lib/openclaw/cli";
import { probeLocalGatewayStatus } from "@/lib/openclaw/client/local-gateway-probe";
import {
  settleGatewayStatusPayloadFromOpenClaw,
  settleModelStatusPayloadFromOpenClaw,
  settleStatusPayloadFromOpenClaw
} from "@/lib/openclaw/adapter/gateway-payloads";
import { GatewayStatusCache } from "@/lib/openclaw/client/gateway-status-cache";
import { settleAgentConfigFromStateFile } from "@/lib/openclaw/state/agent-config-payload";
import { settleChannelRegistryFromLocalFile } from "@/lib/openclaw/state/channel-registry-payload";
import {
  channelRegistryPath,
  openClawStateRootPath
} from "@/lib/openclaw/state/paths";
import { inspectOpenClawRuntimeState } from "@/lib/openclaw/state/runtime-state";
import { RuntimeDiagnosticsStateCache } from "@/lib/openclaw/state/runtime-diagnostics-cache";
import type {
  SnapshotLoadProfile,
  SnapshotPair
} from "@/lib/openclaw/state/snapshot-cache";
import { MissionControlCacheService } from "@/lib/openclaw/application/mission-control-cache-service";
import { buildRuntimeDiagnosticsFromState } from "@/lib/openclaw/adapter/runtime-diagnostics-adapter";
import {
  getCachedOpenClawCapabilityMatrix,
  getOpenClawCapabilityMatrix,
  warmOpenClawCapabilityMatrix
} from "@/lib/openclaw/application/capability-matrix-service";
import {
  readOpenClawEventBridgeRuntimes,
  startOpenClawEventBridge
} from "@/lib/openclaw/application/event-bridge-service";
import {
  mapOpenClawRuntimeSnapshotToRuntimes,
  settleRuntimeSnapshotPayloadFromOpenClaw
} from "@/lib/openclaw/application/runtime-state-service";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  buildModelRecords,
  buildModelsPayloadFromFallbackSources,
  buildModelStatusFromAgentConfig
} from "@/lib/openclaw/adapter/model-adapter";
import {
  buildAgentPayloadsFromConfig,
  buildAgentPayloadsFromGatewayList
} from "@/lib/openclaw/adapter/agent-adapter";
import { buildSnapshotAgentEntry } from "@/lib/openclaw/adapter/agent-snapshot-adapter";
import { readAgentBootstrapProfile } from "@/lib/openclaw/adapter/agent-profile-adapter";
import { buildPresenceRecords } from "@/lib/openclaw/adapter/presence-adapter";
import {
  buildDiagnosticIssues,
  buildGatewayDiagnostics,
  buildSecurityWarnings,
  buildVersionDiagnostics
} from "@/lib/openclaw/adapter/diagnostics-adapter";
import { buildVisibleSnapshotCollections } from "@/lib/openclaw/adapter/visibility-adapter";
import { buildWorkspaceProjectEntry } from "@/lib/openclaw/adapter/workspace-snapshot-adapter";
import {
  CachedPayloadController,
  createDeferredPayloadResult,
  isDeferredPayloadResult,
  resolveCachedPayload,
  SLOW_PAYLOAD_CACHE_TTL_MS,
  type CachedPayload
} from "@/lib/openclaw/client/payload-cache";
import {
  getRecentOpenClawGatewayFallbackDiagnostics,
  type AgentConfigPayload,
  type AgentPayload,
  type GatewayStatusPayload,
  type ModelsPayload,
  type ModelsStatusPayload,
  type OpenClawRuntimeSnapshotPayload,
  type PresencePayload,
  type StatusPayload
} from "@/lib/openclaw/client/gateway-client";
import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import {
  buildOpenClawBinarySelectionSnapshot,
  readOpenClawBinarySelection
} from "@/lib/openclaw/binary-selection";
import { DEFAULT_WORKSPACE_RULES } from "@/lib/openclaw/workspace-presets";
import { buildTaskRecords } from "@/lib/openclaw/domains/task-records";
import {
  annotateMissionDispatchMetadata as annotateMissionDispatchMetadataFromRuntime,
  annotateMissionDispatchSessions,
  buildMissionDispatchRuntimes as buildMissionDispatchRuntimesFromRuntime,
  isSyntheticDispatchRuntime
} from "@/lib/openclaw/domains/mission-dispatch-runtime";
import {
  buildObservedMissionDispatchRuntime,
  persistMissionDispatchObservation,
  readMissionDispatchRecords,
  reconcileMissionDispatchRuntimeState
} from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import {
  mapSessionToRuntimes as mapSessionToRuntimesFromTranscript
} from "@/lib/openclaw/domains/runtime-transcript";
import {
  annotateAgentChatSessions,
  readAgentChatSessionIndex
} from "@/lib/openclaw/domains/agent-chat-sessions";
import {
  settleSessionsPayloadFromSessionCatalogs,
  type SessionsPayload
} from "@/lib/openclaw/domains/session-catalog";
import { mapSessionCatalogEntryToRuntime } from "@/lib/openclaw/domains/runtime-normalizer";
import {
  mergeRuntimeHistory as mergeRuntimeHistoryRecords,
  sortRuntimesByUpdatedAtDesc
} from "@/lib/openclaw/domains/runtime-history";
import {
  filterAgentPolicySkills,
  readAgentIdentityOverrides
} from "@/lib/openclaw/domains/agent-config";
import {
  normalizeChannelRegistry,
  reconcileWorkspaceProjectManifestAgents,
  readWorkspaceProjectManifest
} from "@/lib/openclaw/domains/workspace-manifest";
import type { WorkspaceProjectManifest } from "@/lib/openclaw/domains/workspace-manifest";
import {
  applyChannelAccountDisplayNames,
  buildLegacyRegistrySurfaceAccounts,
  mergeMissionControlSurfaceAccounts,
  readChannelAccounts
} from "@/lib/openclaw/domains/channels";
import { normalizeOptionalValue, resolveModelReadiness } from "@/lib/openclaw/domains/control-plane-normalization";
import {
  buildWorkspaceBootstrapProfileCache,
  readWorkspaceInspectorMetadata,
  type WorkspaceBootstrapProfileCache
} from "@/lib/openclaw/adapter/workspace-inspector-adapter";
import {
  getLatestRuntimeSmokeTest,
  normalizeConfiguredWorkspaceRootValue,
  readMissionControlSettings
} from "@/lib/openclaw/domains/control-plane-settings";
import { createWorkspaceIdResolver } from "@/lib/openclaw/domains/workspace-id";
import type { MissionControlSettings } from "@/lib/openclaw/domains/control-plane-settings";
import type {
  ChannelAccountRecord,
  MissionControlSnapshot,
  OpenClawAgent,
  RelationshipRecord,
  RuntimeRecord,
  WorkspaceProject
} from "@/lib/openclaw/types";

const SNAPSHOT_CACHE_TTL_MS = 30_000;
const RUNTIME_DIAGNOSTICS_CACHE_TTL_MS = 5 * 60_000;
const GATEWAY_STATUS_STALE_GRACE_MS = 60_000;

let agentPayloadCache: CachedPayload<AgentPayload> | null = null;
let agentConfigPayloadCache: CachedPayload<AgentConfigPayload> | null = null;
let modelsPayloadCache: CachedPayload<ModelsPayload> | null = null;
let modelsStatusPayloadCache: CachedPayload<ModelsStatusPayload> | null = null;
let sessionsPayloadCache: CachedPayload<SessionsPayload> | null = null;
let runtimeSnapshotPayloadCache: CachedPayload<OpenClawRuntimeSnapshotPayload> | null = null;
let presencePayloadCache: CachedPayload<PresencePayload> | null = null;
let runtimeHistoryCache = new Map<string, RuntimeRecord>();
const statusPayloadCache = new CachedPayloadController<StatusPayload>();
const gatewayStatusCache = new GatewayStatusCache(GATEWAY_STATUS_STALE_GRACE_MS);
const gatewayRemoteUrlConfigKey = "gateway.remote.url";
const missionControlCacheService = new MissionControlCacheService<MissionControlSnapshot>({
  ttlMs: SNAPSHOT_CACHE_TTL_MS,
  load: (profile, generation) => loadMissionControlSnapshots({ profile, generation })
});
const runtimeDiagnosticsStateCache = new RuntimeDiagnosticsStateCache({
  ttlMs: RUNTIME_DIAGNOSTICS_CACHE_TTL_MS,
  getGeneration: () => missionControlCacheService.getGeneration(),
  loadState: (agentIds, agentDirs) =>
    inspectOpenClawRuntimeState(openClawStateRootPath, agentIds, {
      agentDirs
    })
});

function clearRuntimeHistoryCache() {
  runtimeHistoryCache = new Map();
}

export function clearMissionControlRuntimeHistoryCache() {
  clearRuntimeHistoryCache();
}

export function clearMissionControlCaches() {
  missionControlCacheService.clear({ incrementGeneration: true });
  runtimeDiagnosticsStateCache.clear();
  gatewayStatusCache.clear();
  statusPayloadCache.clear();
  agentPayloadCache = null;
  agentConfigPayloadCache = null;
  modelsPayloadCache = null;
  modelsStatusPayloadCache = null;
  sessionsPayloadCache = null;
  runtimeSnapshotPayloadCache = null;
  presencePayloadCache = null;
  clearRuntimeHistoryCache();
}

export function invalidateMissionControlSnapshotCache() {
  missionControlCacheService.clear();
}

export async function getMissionControlSnapshot(
  options: { force?: boolean; includeHidden?: boolean; loadProfile?: SnapshotLoadProfile } = {}
) {
  return missionControlCacheService.getSnapshot(options);
}

async function readGatewayRemoteUrlConfig(): Promise<PromiseSettledResult<unknown>> {
  try {
    const rawConfig = await readFile(path.join(openClawStateRootPath, "openclaw.json"), "utf8");
    const config = JSON.parse(rawConfig) as unknown;

    return {
      status: "fulfilled",
      value: readNestedConfigValue(config, gatewayRemoteUrlConfigKey) ?? undefined
    };
  } catch (reason) {
    const code = typeof reason === "object" && reason && "code" in reason ? reason.code : undefined;

    if (code === "ENOENT") {
      return {
        status: "fulfilled",
        value: undefined
      };
    }

    return {
      status: "rejected",
      reason
    };
  }
}

async function settleAgentPayloadFromOpenClaw(
  agentConfig: AgentConfigPayload
): Promise<PromiseSettledResult<AgentPayload>> {
  try {
    const payload = await getOpenClawAdapter().listAgents({ timeoutMs: 15_000 });

    return {
      status: "fulfilled",
      value: buildAgentPayloadsFromGatewayList(payload, agentConfig, openClawStateRootPath)
    };
  } catch (reason) {
    return {
      status: "rejected",
      reason
    };
  }
}

async function settleSessionsPayloadFromOpenClaw(
  agentConfig: AgentConfigPayload
): Promise<PromiseSettledResult<SessionsPayload>> {
  try {
    const payload = await getOpenClawAdapter().listSessions({
      limit: 500,
      includeGlobal: false,
      includeUnknown: false
    }, { timeoutMs: 15_000 });

    if (!payload || !Array.isArray(payload.sessions)) {
      throw new Error("OpenClaw Gateway sessions.list returned an invalid payload.");
    }

    return {
      status: "fulfilled",
      value: {
        sessions: payload.sessions as SessionsPayload["sessions"]
      }
    };
  } catch {
    return settleSessionsPayloadFromSessionCatalogs(agentConfig, openClawStateRootPath);
  }
}

function readNestedConfigValue(source: unknown, path: string) {
  let current = source;

  for (const segment of path.split(".")) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeGatewayRemoteUrlConfigValue(value: unknown) {
  if (typeof value === "string") {
    return normalizeOptionalValue(value);
  }

  if (value && typeof value === "object" && "value" in value && typeof value.value === "string") {
    return normalizeOptionalValue(value.value);
  }

  return undefined;
}

async function loadMissionControlSnapshots({
  profile = "interactive",
  generation = missionControlCacheService.getGeneration()
}: {
  profile?: SnapshotLoadProfile;
  generation?: number;
} = {}): Promise<SnapshotPair<MissionControlSnapshot>> {
  const localGatewayStatus = await probeLocalGatewayStatus();
  const openclawInstalled = Boolean(localGatewayStatus) || await detectOpenClaw();

  if (!openclawInstalled) {
    return createSnapshotPair(
      createErrorSnapshot("OpenClaw CLI is not installed on this machine.", {
        installed: false,
        loaded: false,
        rpcOk: false
      })
    );
  }

  try {
    const systemProfile = profile === "system";
    const settings = await readMissionControlSettings();
    if (!systemProfile) {
      startOpenClawEventBridge();
    }
    const configuredWorkspaceRoot = normalizeConfiguredWorkspaceRootValue(settings.workspaceRoot) ?? null;

    if (systemProfile) {
      return createSnapshotPair(
        await buildSystemReadinessSnapshot({
          generation,
          settings,
          localGatewayStatus,
          openclawInstalled,
          configuredWorkspaceRoot
        })
      );
    }

    const gatewayRemoteUrlResult = systemProfile
      ? createDeferredPayloadResult<unknown>()
      : await readGatewayRemoteUrlConfig();
    let gatewayStatusResult: PromiseSettledResult<GatewayStatusPayload>;
    let statusResult: PromiseSettledResult<StatusPayload>;
    let agentsResult: PromiseSettledResult<AgentPayload>;
    let agentConfigResult: PromiseSettledResult<AgentConfigPayload>;
    let modelsResult: PromiseSettledResult<ModelsPayload>;
    let modelStatusResult: PromiseSettledResult<ModelsStatusPayload>;
    let presenceResult: PromiseSettledResult<PresencePayload>;

    const statusCacheNeedsRefresh = statusPayloadCache.shouldRefresh();
    const gatewayStatusCacheNeedsRefresh = gatewayStatusCache.shouldRefresh();
    const modelStatusCacheNeedsRefresh =
      !modelsStatusPayloadCache || Date.now() - modelsStatusPayloadCache.capturedAt > SLOW_PAYLOAD_CACHE_TTL_MS;

    if (profile === "interactive" || systemProfile) {
      const shouldHydrateGatewayStatus = gatewayStatusCacheNeedsRefresh;
      const shouldHydrateStatus = !localGatewayStatus && statusCacheNeedsRefresh;
      const shouldHydrateModelStatus = !systemProfile && modelStatusCacheNeedsRefresh;

      const gatewayStatusPromise = shouldHydrateGatewayStatus
        ? settleGatewayStatusPayloadFromOpenClaw(15_000)
        : Promise.resolve(createDeferredPayloadResult<GatewayStatusPayload>());
      const statusPromise = shouldHydrateStatus
        ? settleStatusPayloadFromOpenClaw(15_000)
        : Promise.resolve(createDeferredPayloadResult<StatusPayload>());
      const agentConfigPromise = settleAgentConfigFromStateFile(openClawStateRootPath);
      const modelStatusPromise = shouldHydrateModelStatus
        ? settleModelStatusPayloadFromOpenClaw(15_000)
        : Promise.resolve(createDeferredPayloadResult<ModelsStatusPayload>());
      [gatewayStatusResult, statusResult, agentConfigResult, modelStatusResult] = await Promise.all([
        gatewayStatusPromise,
        statusPromise,
        agentConfigPromise,
        modelStatusPromise
      ]);
      agentsResult = createDeferredPayloadResult();
      modelsResult = createDeferredPayloadResult();
      presenceResult = createDeferredPayloadResult();
      if (statusCacheNeedsRefresh && !shouldHydrateStatus) {
        statusPayloadCache.scheduleRefresh(() => settleStatusPayloadFromOpenClaw(15_000));
      }
    } else {
      [statusResult, gatewayStatusResult, agentConfigResult, modelStatusResult] = await Promise.all([
        settleStatusPayloadFromOpenClaw(45_000),
        settleGatewayStatusPayloadFromOpenClaw(45_000),
        settleAgentConfigFromStateFile(openClawStateRootPath),
        settleModelStatusPayloadFromOpenClaw(45_000)
      ]);
      agentsResult = createDeferredPayloadResult();
      modelsResult = createDeferredPayloadResult();
      presenceResult = createDeferredPayloadResult();
    }

    let resolvedGatewayStatus = gatewayStatusCache.resolve(gatewayStatusResult);

    if (!resolvedGatewayStatus.value && localGatewayStatus) {
      resolvedGatewayStatus = {
        value: localGatewayStatus,
        reusedCachedValue: false
      };
    }

    if (!resolvedGatewayStatus.value) {
      const probedGatewayStatus = await probeLocalGatewayStatus(gatewayStatusCache.getCachedPort());

      if (probedGatewayStatus) {
        gatewayStatusCache.write(probedGatewayStatus);
        resolvedGatewayStatus = {
          value: probedGatewayStatus,
          reusedCachedValue: false
        };
      }
    }

    const gatewayStatus = resolvedGatewayStatus.value;
    const configuredGatewayUrl =
      gatewayRemoteUrlResult.status === "fulfilled"
        ? normalizeGatewayRemoteUrlConfigValue(gatewayRemoteUrlResult.value)
        : undefined;
    const resolvedStatus = statusPayloadCache.resolve(statusResult);
    const resolvedAgentConfig = resolveCachedPayload(agentConfigResult, agentConfigPayloadCache, (entry) => {
      agentConfigPayloadCache = entry;
    });
    const agentConfig = resolvedAgentConfig.value ?? [];
    if (isDeferredPayloadResult(agentsResult) && !systemProfile) {
      agentsResult = await settleAgentPayloadFromOpenClaw(agentConfig);
    }
    const sessionsResult: PromiseSettledResult<SessionsPayload> = systemProfile
      ? createDeferredPayloadResult<SessionsPayload>()
      : await settleSessionsPayloadFromOpenClaw(agentConfig);
    const runtimeSnapshotMode = getCachedOpenClawCapabilityMatrix()?.operations?.runtimeSnapshot?.mode;
    const shouldHydrateRuntimeSnapshot =
      !systemProfile &&
      runtimeSnapshotMode !== "degraded" &&
      runtimeSnapshotMode !== "disabled" &&
      runtimeSnapshotMode !== "cli-fallback";
    const runtimeSnapshotResult: PromiseSettledResult<OpenClawRuntimeSnapshotPayload> = systemProfile
      ? createDeferredPayloadResult<OpenClawRuntimeSnapshotPayload>()
      : shouldHydrateRuntimeSnapshot
        ? await settleRuntimeSnapshotPayloadFromOpenClaw(profile === "interactive" ? 8_000 : 15_000)
        : createDeferredPayloadResult<OpenClawRuntimeSnapshotPayload>();
    const resolvedAgents = resolveCachedPayload(agentsResult, agentPayloadCache, (entry) => {
      agentPayloadCache = entry;
    });
    const resolvedModels = resolveCachedPayload(modelsResult, modelsPayloadCache, (entry) => {
      modelsPayloadCache = entry;
    });
    const resolvedModelStatus = resolveCachedPayload(modelStatusResult, modelsStatusPayloadCache, (entry) => {
      modelsStatusPayloadCache = entry;
    });
    const resolvedSessions = resolveCachedPayload(sessionsResult, sessionsPayloadCache, (entry) => {
      sessionsPayloadCache = entry;
    });
    const resolvedRuntimeSnapshot = resolveCachedPayload(runtimeSnapshotResult, runtimeSnapshotPayloadCache, (entry) => {
      runtimeSnapshotPayloadCache = entry;
    });
    const resolvedPresence = resolveCachedPayload(presenceResult, presencePayloadCache, (entry) => {
      presencePayloadCache = entry;
    });
    const status = resolvedStatus.value;
    const agentsList = resolvedAgents.value ?? buildAgentPayloadsFromConfig(agentConfig, openClawStateRootPath);
    const modelStatus = resolvedModelStatus.value ?? buildModelStatusFromAgentConfig(agentConfig);
    const localModels = buildModelsPayloadFromFallbackSources(agentConfig, modelStatus);
    const models = resolvedModels.value?.models ?? localModels.models;
    const presence = resolvedPresence.value ?? [];
    const hasOpenClawSignal =
      gatewayStatusResult.status === "fulfilled" ||
      statusResult.status === "fulfilled" ||
      agentsResult.status === "fulfilled" ||
      agentConfigResult.status === "fulfilled" ||
      modelsResult.status === "fulfilled" ||
      modelStatusResult.status === "fulfilled" ||
      sessionsResult.status === "fulfilled" ||
      runtimeSnapshotResult.status === "fulfilled" ||
      presenceResult.status === "fulfilled";
    const runtimeDiagnosticsPromise = buildRuntimeDiagnostics(
      agentsList.map((agent) => ({
        id: agent.id,
        agentDir: agent.agentDir
      })),
      settings
    );
    void runtimeDiagnosticsPromise.catch(() => {});
    const dispatchRecordsPromise = readMissionDispatchRecords();
    const dispatchRecords = await dispatchRecordsPromise;
    const agentChatSessionIndex = await readAgentChatSessionIndex();
    const sessions = annotateMissionDispatchSessions(
      annotateAgentChatSessions(resolvedSessions.value?.sessions ?? [], agentChatSessionIndex),
      dispatchRecords
    );
    const channelRegistryResult = await settleChannelRegistryFromLocalFile(channelRegistryPath);
    const channelRegistry =
      channelRegistryResult.status === "fulfilled"
        ? channelRegistryResult.value
        : normalizeChannelRegistry({
            version: 1,
            channels: []
          });
    const channelAccountsRaw =
      profile === "interactive"
        ? ([] as ChannelAccountRecord[])
        : await readChannelAccounts();
    const channelAccounts = applyChannelAccountDisplayNames(
      mergeMissionControlSurfaceAccounts([
        ...channelAccountsRaw,
        ...buildLegacyRegistrySurfaceAccounts(channelRegistry)
      ]),
      channelRegistry
    );

    const workspaceByPath = new Map<string, WorkspaceProject>();
    const manifestByWorkspace = new Map<string, WorkspaceProjectManifest>();
    const workspaceBootstrapProfileByWorkspace = new Map<string, WorkspaceBootstrapProfileCache>();
    const agents: OpenClawAgent[] = [];
    const relationships: RelationshipRecord[] = [];

    const heartbeatByAgent = new Map(
      (status?.heartbeat?.agents ?? []).map((entry) => [entry.agentId, entry])
    );
    const configByAgent = new Map(agentConfig.map((entry) => [entry.id, entry]));
    const recentSessionsByAgent = new Map<string, SessionsPayload["sessions"]>();

    for (const session of sessions) {
      if (!session.agentId) {
        continue;
      }

      const list = recentSessionsByAgent.get(session.agentId) ?? [];
      list.push(session);
      recentSessionsByAgent.set(session.agentId, list);
    }

    const workspaceBoundAgents = agentsList.filter(
      (agent): agent is AgentPayload[number] & { workspace: string } => Boolean(agent.workspace)
    );
    const workspacePaths = Array.from(new Set(workspaceBoundAgents.map((agent) => agent.workspace)));
    const activeAgentIdsByWorkspacePath = new Map<string, string[]>();
    for (const agent of workspaceBoundAgents) {
      const agentIds = activeAgentIdsByWorkspacePath.get(agent.workspace) ?? [];
      agentIds.push(agent.id);
      activeAgentIdsByWorkspacePath.set(agent.workspace, agentIds);
    }
    const resolveWorkspaceId = createWorkspaceIdResolver(workspacePaths);
    const liveSessionRuntimes = (
      await Promise.all(
        sessions.map((session) =>
          mapSessionToRuntimesFromTranscript(session, agentConfig, agentsList, (entry, config, agentList) =>
            mapSessionCatalogEntryToRuntime(entry, config, agentList, { resolveWorkspaceId })
          )
        )
      )
    ).flat();
    const annotatedLiveSessionRuntimes = annotateMissionDispatchMetadataFromRuntime(
      liveSessionRuntimes,
      dispatchRecords
    );
    const gatewaySnapshotRuntimes = mapOpenClawRuntimeSnapshotToRuntimes(
      resolvedRuntimeSnapshot.value,
      {
        agentConfig,
        agentsList,
        resolveWorkspaceId
      }
    );
    const annotatedGatewaySnapshotRuntimes = annotateMissionDispatchMetadataFromRuntime(
      gatewaySnapshotRuntimes,
      dispatchRecords
    );
    const eventBridgeRuntimes = systemProfile ? [] : await readOpenClawEventBridgeRuntimes();
    const baseRuntimes = mergeRuntimeHistory([
      ...eventBridgeRuntimes,
      ...annotatedGatewaySnapshotRuntimes,
      ...annotatedLiveSessionRuntimes
    ]);
    const dispatchRuntimes = await buildMissionDispatchRuntimesFromRuntime(
      baseRuntimes,
      dispatchRecords,
      {
        buildObservedRuntime: buildObservedMissionDispatchRuntime,
        persistObservation: persistMissionDispatchObservation,
        reconcileRuntimeState: reconcileMissionDispatchRuntimeState
      }
    );
    const runtimes = mergeRuntimeHistory([
      ...dispatchRuntimes,
      ...eventBridgeRuntimes,
      ...annotatedGatewaySnapshotRuntimes,
      ...annotatedLiveSessionRuntimes
    ]);
    await Promise.all(
      workspacePaths.map(async (workspacePath) => {
        const activeAgentIds = activeAgentIdsByWorkspacePath.get(workspacePath) ?? [];
        const manifest = await reconcileWorkspaceProjectManifestAgents(workspacePath, activeAgentIds);
        manifestByWorkspace.set(workspacePath, manifest);
        workspaceBootstrapProfileByWorkspace.set(
          workspacePath,
          await buildWorkspaceBootstrapProfileCache(
            workspacePath,
            manifest.template,
            manifest.rules ?? DEFAULT_WORKSPACE_RULES
          )
        );
      })
    );

    const agentEntries = await Promise.all(
      workspaceBoundAgents.map(async (rawAgent) => {
        const configured = configByAgent.get(rawAgent.id);
        const identityOverrides = await readAgentIdentityOverrides(rawAgent.agentDir);
        const workspaceId = resolveWorkspaceId(rawAgent.workspace);
        const sessionList = recentSessionsByAgent.get(rawAgent.id) ?? [];
        const manifest =
          manifestByWorkspace.get(rawAgent.workspace) ??
          (await readWorkspaceProjectManifest(rawAgent.workspace));
        manifestByWorkspace.set(rawAgent.workspace, manifest);
        const manifestAgent = manifest.agents.find((entry) => entry.id === rawAgent.id) ?? null;
        const profile = await readAgentBootstrapProfile(rawAgent.workspace, {
          agentId: rawAgent.id,
          agentName:
            normalizeOptionalValue(identityOverrides.name) ||
            configured?.name ||
            rawAgent.name ||
            configured?.identity?.name ||
            rawAgent.identityName ||
            rawAgent.id,
          agentDir: rawAgent.agentDir,
          configuredSkills: filterAgentPolicySkills(configured?.skills ?? []),
          configuredTools: uniqueStrings([
            ...(manifestAgent?.toolIds ?? []),
            ...((configured?.tools?.fs?.workspaceOnly || manifestAgent?.policy?.fileAccess === "workspace-only")
              ? ["fs.workspaceOnly"]
              : [])
          ]),
          template: manifest.template,
          rules: manifest.rules ?? DEFAULT_WORKSPACE_RULES,
          workspaceBootstrapProfile:
            workspaceBootstrapProfileByWorkspace.get(rawAgent.workspace) ??
            (await buildWorkspaceBootstrapProfileCache(
              rawAgent.workspace,
              manifest.template,
              manifest.rules ?? DEFAULT_WORKSPACE_RULES
            ))
        });
        const agentRuntimes = runtimes
          .filter((runtime) => runtime.agentId === rawAgent.id)
          .sort(sortRuntimesByUpdatedAtDesc);
        const heartbeat = heartbeatByAgent.get(rawAgent.id);
        return buildSnapshotAgentEntry({
          rawAgent,
          configured,
          identityOverrides,
          workspaceId,
          sessionList,
          manifestAgent,
          agentRuntimes,
          gatewayRpcOk: Boolean(gatewayStatus?.rpc?.ok || hasOpenClawSignal),
          heartbeat,
          profile
        });
      })
    );

    for (const entry of agentEntries) {
      const workspace = ensureWorkspace(workspaceByPath, entry.workspacePath, resolveWorkspaceId);
      workspace.agentIds.push(entry.agent.id);
      workspace.modelIds.push(entry.primaryModel);
      workspace.activeRuntimeIds.push(...entry.activeRuntimeIds);
      workspace.totalSessions += entry.sessionCount;
      agents.push(entry.agent);
      relationships.push(...entry.relationships);
    }

    const agentsByWorkspace = new Map<string, OpenClawAgent[]>();
    for (const agent of agents) {
      const list = agentsByWorkspace.get(agent.workspaceId) ?? [];
      list.push(agent);
      agentsByWorkspace.set(agent.workspaceId, list);
    }

    const workspaces = await Promise.all(
      Array.from(workspaceByPath.values()).map(async (workspace) => {
        const workspaceAgents = agentsByWorkspace.get(workspace.id) ?? [];
        const manifest = manifestByWorkspace.get(workspace.path) ?? null;
        const metadata = await readWorkspaceInspectorMetadata(
          workspace.path,
          workspaceAgents,
          manifest ?? undefined
        );

        return buildWorkspaceProjectEntry({
          workspace,
          manifest,
          metadata,
          allAgents: agents
        });
      })
    );

    const {
      visibleWorkspaces,
      visibleAgents,
      visibleRuntimes,
      visibleRelationships
    } = buildVisibleSnapshotCollections({
      workspaces,
      agents,
      runtimes,
      relationships,
      isWorkspaceHidden: (workspace) => Boolean(manifestByWorkspace.get(workspace.path)?.hidden)
    });

    const modelReadiness = resolveModelReadiness(models, modelStatus);

    const securityWarnings = buildSecurityWarnings(status);
    const versionDiagnostics = buildVersionDiagnostics({
      status,
      fallbackVersion: (await resolveOpenClawVersion()) ?? undefined
    });
    const openClawBinarySelection = buildOpenClawBinarySelectionSnapshot(
      await readOpenClawBinarySelection(),
      getResolvedOpenClawBin()
    );
    const runtimeDiagnostics = await runtimeDiagnosticsPromise;
    const capabilityMatrix =
      profile === "interactive"
        ? getCachedOpenClawCapabilityMatrix() ?? undefined
        : await getOpenClawCapabilityMatrix().catch(() => undefined);
    if (profile === "interactive" && !capabilityMatrix) {
      warmOpenClawCapabilityMatrix();
    }
    const gatewayFallbackIssues = getRecentOpenClawGatewayFallbackDiagnostics().map(
      (entry) => `gateway.${entry.operation}: Gateway-first request fell back to CLI (${entry.kind}): ${entry.issue} Recovery: ${entry.recovery}`
    );

    const snapshotIssueResults = {
      gatewayStatus: gatewayStatusResult,
      status: statusResult,
      agents: agentsResult,
      agentConfig: agentConfigResult,
      models: modelsResult,
      modelStatus: modelStatusResult,
      sessions: sessionsResult,
      presence: presenceResult
    };
    const diagnostics = buildGatewayDiagnostics({
      gatewayStatus,
      status,
      configuredWorkspaceRoot: configuredWorkspaceRoot ?? null,
      workspaceRoot: resolveWorkspaceRoot(configuredWorkspaceRoot),
      configuredGatewayUrl,
      hasOpenClawSignal,
      securityWarnings,
      runtimeDiagnostics,
      openClawBinarySelection,
      modelReadiness,
      capabilityMatrix,
      commandHistory: getRecentOpenClawCommandDiagnostics(),
      transport: getOpenClawGatewayClient().getDiagnostics?.(),
      versionDiagnostics,
      issues: buildDiagnosticIssues({
        payloadResults: snapshotIssueResults,
        gatewayStatusRejectedWithCachedValue:
          gatewayStatusResult.status === "rejected" && resolvedGatewayStatus.reusedCachedValue,
        payloadReuse: {
          status: resolvedStatus,
          agents: resolvedAgents,
          agentConfig: resolvedAgentConfig,
          models: resolvedModels,
          modelStatus: resolvedModelStatus,
          sessions: resolvedSessions,
          presence: resolvedPresence
        },
        runtimeIssues: [...runtimeDiagnostics.issues, ...gatewayFallbackIssues]
      })
    });

    const tasks = buildTaskRecords(runtimes, agents);
    const visibleTasks = buildTaskRecords(visibleRuntimes, visibleAgents);
    const generatedAt = new Date().toISOString();
    const sharedSnapshotFields = {
      generatedAt,
      revision: generation,
      mode: "live" as const,
      diagnostics,
      channelAccounts,
      channelRegistry,
      ...(isDeferredPayloadResult(channelRegistryResult)
        ? {}
        : {}),
      presence: buildPresenceRecords(presence),
      missionPresets: [
        "Audit the selected workspace and generate a concrete first task batch.",
        "Plan a multi-agent delivery mission for the current product goal.",
        "Review active runtimes, identify blockers, and propose the next handoff."
      ]
    };

    return {
      full: {
        ...sharedSnapshotFields,
        workspaces,
        agents,
        models: buildModelRecords(models, agents, modelStatus),
        runtimes,
        tasks,
        relationships
      },
      visible: {
        ...sharedSnapshotFields,
        workspaces: visibleWorkspaces,
        agents: visibleAgents,
        models: buildModelRecords(models, visibleAgents, modelStatus),
        runtimes: visibleRuntimes,
        tasks: visibleTasks,
        relationships: visibleRelationships
      }
    };
  } catch (error) {
    return createSnapshotPair(
      createErrorSnapshot(
        error instanceof Error ? error.message : "Unknown OpenClaw error.",
        {
          installed: openclawInstalled,
          loaded: Boolean(localGatewayStatus?.service?.loaded),
          rpcOk: Boolean(localGatewayStatus?.rpc?.ok)
        }
      )
    );
  }
}

function createSnapshotPair(snapshot: MissionControlSnapshot): SnapshotPair<MissionControlSnapshot> {
  return {
    visible: snapshot,
    full: snapshot
  };
}

async function buildSystemReadinessSnapshot({
  generation,
  settings,
  localGatewayStatus,
  openclawInstalled,
  configuredWorkspaceRoot
}: {
  generation: number;
  settings: MissionControlSettings;
  localGatewayStatus: GatewayStatusPayload | null;
  openclawInstalled: boolean;
  configuredWorkspaceRoot: string | null;
}): Promise<MissionControlSnapshot> {
  const gatewayStatusResult = await settleGatewayStatusPayloadFromOpenClaw(3_000);
  const gatewayStatus = gatewayStatusCache.resolve(gatewayStatusResult).value ?? localGatewayStatus;
  const agentConfigResult = await settleAgentConfigFromStateFile(openClawStateRootPath);
  const agentConfig = agentConfigResult.status === "fulfilled" ? agentConfigResult.value : [];
  const runtimeState = await inspectOpenClawRuntimeState(
    openClawStateRootPath,
    agentConfig.map((agent) => agent.id).filter(Boolean),
    {
      agentDirs: Object.fromEntries(
        agentConfig
          .filter((agent) => agent.id)
          .map((agent) => [agent.id, agent.agentDir])
      )
    }
  );
  const runtimeDiagnostics = buildRuntimeDiagnosticsFromState(
    runtimeState,
    getLatestRuntimeSmokeTest(settings)
  );
  const modelStatus = buildModelStatusFromAgentConfig(agentConfig);
  const localModels = buildModelsPayloadFromFallbackSources(agentConfig, modelStatus);
  const modelReadiness = resolveModelReadiness(localModels.models, modelStatus);
  const rpcOk = Boolean(gatewayStatus?.rpc?.ok);
  const loaded = Boolean(gatewayStatus?.service?.loaded || rpcOk);
  const ready = openclawInstalled && rpcOk && runtimeDiagnostics.stateWritable && runtimeDiagnostics.sessionStoreWritable;
  const issues = [
    rpcOk ? null : "OpenClaw Gateway RPC is not ready.",
    ...runtimeDiagnostics.issues
  ].filter((issue): issue is string => Boolean(issue));
  const base = createErrorSnapshot(issues[0] ?? "OpenClaw system readiness snapshot.", {
    installed: openclawInstalled,
    loaded,
    rpcOk
  });

  return {
    ...base,
    generatedAt: new Date().toISOString(),
    revision: generation,
    mode: "live",
    diagnostics: {
      ...base.diagnostics,
      installed: openclawInstalled,
      loaded,
      rpcOk,
      health: ready ? "healthy" : openclawInstalled ? "degraded" : "offline",
      workspaceRoot: resolveWorkspaceRoot(configuredWorkspaceRoot),
      configuredWorkspaceRoot,
      gatewayUrl: gatewayStatus?.gateway?.probeUrl ?? base.diagnostics.gatewayUrl,
      bindMode: gatewayStatus?.gateway?.bindMode,
      port: gatewayStatus?.gateway?.port,
      serviceLabel: gatewayStatus?.service?.label,
      openClawBinarySelection: buildOpenClawBinarySelectionSnapshot(
        await readOpenClawBinarySelection(),
        getResolvedOpenClawBin()
      ),
      modelReadiness,
      capabilityMatrix: getCachedOpenClawCapabilityMatrix() ?? undefined,
      runtime: runtimeDiagnostics,
      commandHistory: getRecentOpenClawCommandDiagnostics(),
      issues
    },
    missionPresets: [
      "Audit the selected workspace and generate a concrete first task batch.",
      "Plan a multi-agent delivery mission for the current product goal.",
      "Review active runtimes, identify blockers, and propose the next handoff."
    ]
  };
}

async function buildRuntimeDiagnostics(
  agents: Array<{ id: string; agentDir?: string | null }>,
  settings: MissionControlSettings
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

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function ensureWorkspace(
  store: Map<string, WorkspaceProject>,
  workspacePath: string,
  resolveWorkspaceId: (workspacePath: string) => string
) {
  const workspaceId = resolveWorkspaceId(workspacePath);
  const existing = store.get(workspaceId);

  if (existing) {
    return existing;
  }

  const workspace: WorkspaceProject = {
    id: workspaceId,
    name: prettifyWorkspaceName(workspacePath),
    slug: slugify(path.basename(workspacePath)),
    path: workspacePath,
    kind: "workspace",
    agentIds: [],
    modelIds: [],
    activeRuntimeIds: [],
    totalSessions: 0,
    health: "standby",
    bootstrap: {
      template: null,
      sourceMode: null,
      agentTemplate: null,
      coreFiles: [],
      optionalFiles: [],
      folders: [],
      projectShell: [],
      localSkillIds: []
    },
    capabilities: {
      skills: [],
      tools: [],
      workspaceOnlyAgentCount: 0
    },
    channels: []
  };

  store.set(workspaceId, workspace);
  return workspace;
}

function mergeRuntimeHistory(currentRuntimes: RuntimeRecord[]) {
  const result = mergeRuntimeHistoryRecords(currentRuntimes, runtimeHistoryCache, {
    excludeFromCache: isSyntheticDispatchRuntime
  });
  runtimeHistoryCache = result.cache;
  return result.runtimes;
}

function resolveDefaultWorkspaceRoot() {
  return path.join(os.homedir(), "Documents", "Shared", "projects");
}

function resolveWorkspaceRoot(configuredWorkspaceRoot?: string | null) {
  return configuredWorkspaceRoot || resolveDefaultWorkspaceRoot();
}

function prettifyWorkspaceName(workspacePath: string) {
  const base = path.basename(workspacePath) || workspacePath;
  return base
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
