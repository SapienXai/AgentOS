import "server-only";

import {
  readOpenClawEventBridgeRuntimes
} from "@/lib/openclaw/application/event-bridge-service";
import {
  mapOpenClawRuntimeSnapshotToRuntimes,
  mapOpenClawTaskListToRuntimes
} from "@/lib/openclaw/application/runtime-state-service";
import type {
  AgentConfigPayload,
  AgentPayload,
  OpenClawRuntimeSnapshotPayload,
  OpenClawTaskListPayload
} from "@/lib/openclaw/client/gateway-client";
import {
  annotateAgentChatRuntimes,
  annotateAgentChatSessions,
  readAgentChatSessionIndex
} from "@/lib/openclaw/domains/agent-chat-sessions";
import {
  buildObservedMissionDispatchRuntime,
  isMissionDispatchTerminalStatus,
  persistMissionDispatchObservation,
  readMissionDispatchRecords,
  reconcileMissionDispatchRuntimeState,
  writeMissionDispatchRecord
} from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import {
  finalizeBrowserTaskBinding,
  getBrowserTaskBinding
} from "@/lib/agentos/application/browser-task-binding-service";
import type { MissionDispatchRecordLike } from "@/lib/openclaw/domains/mission-dispatch-model";
import {
  annotateMissionDispatchMetadata as annotateMissionDispatchMetadataFromRuntime,
  annotateMissionDispatchSessions,
  buildMissionDispatchRuntimes as buildMissionDispatchRuntimesFromRuntime,
  isSyntheticDispatchRuntime
} from "@/lib/openclaw/domains/mission-dispatch-runtime";
import { mergeRuntimeHistory as mergeRuntimeHistoryRecords } from "@/lib/openclaw/domains/runtime-history";
import { mapSessionCatalogEntryToRuntime } from "@/lib/openclaw/domains/runtime-normalizer";
import {
  mapSessionToRuntimes as mapSessionToRuntimesFromTranscript
} from "@/lib/openclaw/domains/runtime-transcript";
import type { SessionsPayload } from "@/lib/openclaw/domains/session-catalog";
import type { RuntimeRecord } from "@/lib/openclaw/types";

export type MissionControlRuntimeHistoryStore = {
  cache: Map<string, RuntimeRecord>;
};

export function createMissionControlRuntimeHistoryStore(): MissionControlRuntimeHistoryStore {
  return {
    cache: new Map()
  };
}

export function clearMissionControlRuntimeHistoryStore(store: MissionControlRuntimeHistoryStore) {
  store.cache = new Map();
}

export async function readMissionControlDispatchRecords() {
  return readMissionDispatchRecords();
}

export async function hydrateMissionControlSessions(
  sessions: SessionsPayload["sessions"],
  dispatchRecords: Awaited<ReturnType<typeof readMissionDispatchRecords>>
) {
  const agentChatSessionIndex = await readAgentChatSessionIndex();

  return annotateMissionDispatchSessions(
    annotateAgentChatSessions(sessions, agentChatSessionIndex),
    dispatchRecords
  );
}

export async function reconcileMissionControlRuntimes(input: {
  sessions: SessionsPayload["sessions"];
  agentConfig: AgentConfigPayload;
  agentsList: AgentPayload;
  runtimeSnapshot?: OpenClawRuntimeSnapshotPayload;
  taskList?: OpenClawTaskListPayload;
  systemProfile: boolean;
  dispatchRecords: Awaited<ReturnType<typeof readMissionDispatchRecords>>;
  resolveWorkspaceId: (workspacePath: string) => string;
  historyStore: MissionControlRuntimeHistoryStore;
}) {
  const liveSessionRuntimes = (
    await Promise.all(
      input.sessions.map((session) =>
        mapSessionToRuntimesFromTranscript(session, input.agentConfig, input.agentsList, (entry, config, agentList) =>
          mapSessionCatalogEntryToRuntime(entry, config, agentList, { resolveWorkspaceId: input.resolveWorkspaceId })
        )
      )
    )
  ).flat();
  const gatewaySnapshotRuntimes = mapOpenClawRuntimeSnapshotToRuntimes(
    input.runtimeSnapshot,
    {
      agentConfig: input.agentConfig,
      agentsList: input.agentsList,
      resolveWorkspaceId: input.resolveWorkspaceId
    }
  );
  const taskLedgerRuntimes = mapOpenClawTaskListToRuntimes(input.taskList, {
    agentConfig: input.agentConfig,
    agentsList: input.agentsList,
    resolveWorkspaceId: input.resolveWorkspaceId
  });
  const eventBridgeRuntimes = input.systemProfile ? [] : await readOpenClawEventBridgeRuntimes();
  const agentChatSessionIndex = await readAgentChatSessionIndex();
  const runtimeCandidates = annotateAgentChatRuntimes(
    [
      ...eventBridgeRuntimes,
      ...taskLedgerRuntimes,
      ...gatewaySnapshotRuntimes,
      ...liveSessionRuntimes
    ],
    agentChatSessionIndex
  );
  const annotatedRuntimeCandidates = annotateMissionDispatchMetadataFromRuntime(
    runtimeCandidates,
    input.dispatchRecords
  );
  const dispatchRuntimes = await buildMissionDispatchRuntimesFromRuntime(
    annotatedRuntimeCandidates,
    input.dispatchRecords,
    {
      buildObservedRuntime: buildObservedMissionDispatchRuntime,
      persistObservation: persistMissionDispatchObservation,
      reconcileRuntimeState: reconcileMissionDispatchRuntimeStateAndBrowserBinding
    }
  );

  return mergeMissionControlRuntimeHistory(
    [
      ...annotatedRuntimeCandidates,
      ...dispatchRuntimes
    ],
    input.historyStore
  );
}

async function reconcileMissionDispatchRuntimeStateAndBrowserBinding(
  record: MissionDispatchRecordLike,
  runtime: RuntimeRecord
) {
  const reconciled = await reconcileMissionDispatchRuntimeState(record, runtime);
  const effective = reconciled ?? record;
  if (effective.browserBinding?.status !== "active") {
    return reconciled;
  }

  const binding = await getBrowserTaskBinding(effective.id).catch(() => null);
  const bindingExpired = !binding || Date.parse(binding.expiresAt) <= Date.now();
  if (!isMissionDispatchTerminalStatus(effective.status) && !bindingExpired) {
    if (effective.browserBinding.expiresAt === binding.expiresAt) return reconciled;
    const nextRecord: MissionDispatchRecordLike = {
      ...effective,
      updatedAt: new Date().toISOString(),
      browserBinding: {
        ...effective.browserBinding,
        expiresAt: binding.expiresAt
      }
    };
    await writeMissionDispatchRecord(nextRecord);
    return nextRecord;
  }

  const cleanup = await finalizeBrowserTaskBinding(effective.id).catch(() => ({
    finalized: true,
    cleanupFailed: true
  }));
  const now = new Date().toISOString();
  const nextRecord: MissionDispatchRecordLike = {
    ...effective,
    updatedAt: now,
    browserBinding: {
      ...effective.browserBinding,
      status:
        !isMissionDispatchTerminalStatus(effective.status) || cleanup.cleanupFailed
          ? "recovery_required"
          : "released",
      releasedAt: now
    }
  };
  await writeMissionDispatchRecord(nextRecord);
  return nextRecord;
}

export function mergeMissionControlRuntimeHistory(
  currentRuntimes: RuntimeRecord[],
  historyStore: MissionControlRuntimeHistoryStore
) {
  const result = mergeRuntimeHistoryRecords(currentRuntimes, historyStore.cache, {
    excludeFromCache: isSyntheticDispatchRuntime
  });
  historyStore.cache = result.cache;
  return result.runtimes;
}
