import "server-only";

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { getOpenClawCapabilityMatrix } from "@/lib/openclaw/application/capability-matrix-service";
import type {
  OpenClawGatewayEventFrame,
  OpenClawGatewayEventConnectionState,
  OpenClawGatewayEventSubscription
} from "@/lib/openclaw/client/gateway-client";
import { normalizeOpenClawGatewayEventToRuntime } from "@/lib/openclaw/application/runtime-state-service";
import type { OpenClawEventBridgeStreamStatus, RuntimeRecord } from "@/lib/openclaw/types";
import { redactErrorMessage } from "@/lib/security/redaction";

type GatewayEventFrame = OpenClawGatewayEventFrame;

export { normalizeOpenClawGatewayEventToRuntime } from "@/lib/openclaw/application/runtime-state-service";

const eventBridgeRoot = path.join(/*turbopackIgnore: true*/ process.cwd(), ".mission-control", "gateway-events");
const maxBridgeRecords = 500;
let subscription: OpenClawGatewayEventSubscription | null = null;
let starting: Promise<void> | null = null;
let lastError: string | null = null;
let lastEventAt: string | null = null;
let reconnectAttempt = 0;
let reconnecting = false;
let officialLifecycleManaged = false;
let officialLifecycleState: OpenClawGatewayEventConnectionState = "stopped";
let bridgeGeneration = 0;
let lastSequenceGapAt: string | null = null;
let expectedSequence: number | null = null;
let receivedSequence: number | null = null;
let reconciliationState: "idle" | "in-flight" | "failed" = "idle";
let lastReconciledAt: string | null = null;
let sequenceGapCount = 0;
let reconciliationPromise: Promise<void> | null = null;
let reconciliationDirty = false;
let reconciliationFollowUp = false;
let invalidateMissionControlSnapshot: (() => void) | null = null;
const bridgeEventSubscribers = new Set<(frame: GatewayEventFrame) => void>();

export function registerMissionControlSnapshotInvalidator(invalidator: () => void) {
  invalidateMissionControlSnapshot = invalidator;
}

export function getOpenClawEventBridgeStatus() {
  return {
    connected: isBridgeConnected(),
    reconnecting,
    reconnectAttempt,
    lastEventAt,
    lastError,
    lastSequenceGapAt,
    expectedSequence,
    receivedSequence,
    reconciliationState,
    lastReconciledAt,
    sequenceGapCount
  };
}

export function getOpenClawEventBridgeStreamStatus(): OpenClawEventBridgeStreamStatus {
  const connected = isBridgeConnected();
  const sanitizedLastError = lastError
    ? redactErrorMessage(lastError, "OpenClaw Gateway event stream failed.")
    : null;

  if (connected) {
    return {
      mode: "live",
      connected: true,
      reconnecting: false,
      reconnectAttempt,
      lastEventAt,
      lastError: sanitizedLastError,
      lastSequenceGapAt,
      expectedSeq: expectedSequence,
      receivedSeq: receivedSequence,
      reconciliationState,
      lastReconciledAt,
      gapCount: sequenceGapCount,
      message: null,
      recovery: null
    };
  }

  if (reconnecting) {
    return {
      mode: "reconnecting",
      connected: false,
      reconnecting: true,
      reconnectAttempt,
      lastEventAt,
      lastError: sanitizedLastError,
      lastSequenceGapAt,
      expectedSeq: expectedSequence,
      receivedSeq: receivedSequence,
      reconciliationState,
      lastReconciledAt,
      gapCount: sequenceGapCount,
      message: "OpenClaw event streaming is reconnecting. AgentOS is refreshing task snapshots by polling until the stream returns.",
      recovery: sanitizedLastError ?? "Wait for the Gateway event stream to reconnect, or inspect Gateway diagnostics if it stays degraded."
    };
  }

  return {
    mode: "polling",
    connected: false,
    reconnecting: false,
    reconnectAttempt,
    lastEventAt,
    lastError: sanitizedLastError,
    lastSequenceGapAt,
    expectedSeq: expectedSequence,
    receivedSeq: receivedSequence,
    reconciliationState,
    lastReconciledAt,
    gapCount: sequenceGapCount,
    message: "OpenClaw event streaming is unavailable. AgentOS is refreshing task snapshots by polling.",
    recovery: sanitizedLastError ?? "Inspect Gateway event capabilities and compatibility diagnostics if live updates stay unavailable."
  };
}

export function startOpenClawEventBridge() {
  if (subscription || starting) {
    return;
  }

  const generation = bridgeGeneration;
  starting = startEventBridge(generation).finally(() => {
    if (bridgeGeneration === generation) {
      starting = null;
    }
  });
  void starting;
}

export function subscribeOpenClawEventBridgeEvents(callback: (frame: GatewayEventFrame) => void) {
  bridgeEventSubscribers.add(callback);
  startOpenClawEventBridge();

  return () => {
    bridgeEventSubscribers.delete(callback);
  };
}

export async function readOpenClawEventBridgeRuntimes(): Promise<RuntimeRecord[]> {
  try {
    const entries = await readdir(eventBridgeRoot, { withFileTypes: true });
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => readBridgeRuntimeRecord(path.join(eventBridgeRoot, entry.name)))
    );

    return records
      .filter((record): record is RuntimeRecord => Boolean(record))
      .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
      .slice(0, maxBridgeRecords);
  } catch {
    return [];
  }
}

async function startEventBridge(generation: number) {
  const capabilityMatrix = await getOpenClawCapabilityMatrix().catch(() => null);
  if (bridgeGeneration !== generation) {
    return;
  }

  if (capabilityMatrix?.eventBridge === "unsupported") {
    lastError = "OpenClaw Gateway does not advertise compatible session/event support.";
    reconnecting = false;
    return;
  }

  try {
    const nextSubscription = await getOpenClawAdapter().subscribeRuntimeEvents(
      {
        includeSessions: true,
        includeTasks: true,
        includeArtifacts: true,
        includeApprovals: true
      },
      {
        onEvent: (frame) => {
          if (isCapabilityFactChange(frame)) {
            getOpenClawAdapter().invalidateReadCache?.();
          }
          try {
            invalidateMissionControlSnapshot?.();
          } catch (error) {
            lastError = redactErrorMessage(error, "Mission Control snapshot invalidation failed.");
          }
          notifyBridgeEventSubscribers(frame);
          void persistGatewayEvent(frame).catch((error) => {
            lastError = redactErrorMessage(error, "OpenClaw Gateway event persistence failed.");
          });
        },
        onError: (error) => {
          lastError = redactErrorMessage(error, "OpenClaw Gateway event stream failed.");
        },
        onConnectionStateChange: (state) => {
          officialLifecycleManaged = true;
          officialLifecycleState = state;
          if (state === "reconnecting") {
            if (!reconnecting) {
              reconnectAttempt += 1;
            }
            reconnecting = true;
            return;
          }
          if (state === "connected") {
            reconnecting = false;
            return;
          }
          if (state === "reconnect-paused" || state === "stopped") {
            reconnecting = false;
          }
        },
        onReconnected: () => scheduleRuntimeReconciliation(),
        onGap: (gap) => {
          lastSequenceGapAt = new Date().toISOString();
          expectedSequence = gap.expected;
          receivedSequence = gap.received;
          sequenceGapCount += 1;
          scheduleRuntimeReconciliation();
        },
        onClose: () => {
          subscription = null;
        }
      },
      { timeoutMs: 5_000 }
    );
    if (bridgeGeneration !== generation) {
      nextSubscription.close();
      return;
    }

    subscription = nextSubscription;
    officialLifecycleManaged = nextSubscription.reconnectManagedByClient === true;
    if (!officialLifecycleManaged) {
      officialLifecycleState = "stopped";
    }
    lastError = null;
    if (!officialLifecycleManaged) {
      reconnectAttempt = 0;
      reconnecting = false;
    }
  } catch (error) {
    if (bridgeGeneration !== generation) {
      return;
    }

    subscription = null;
    lastError = redactErrorMessage(error, "OpenClaw Gateway event stream failed.");
    reconnecting = false;
  }
}

function isCapabilityFactChange(frame: GatewayEventFrame) {
  return [
    "skills.changed",
    "sessions.changed",
    "session.tool",
    "session.approval",
    "exec.approval.requested",
    "exec.approval.resolved",
    "plugin.approval.requested",
    "plugin.approval.resolved"
  ].includes(frame.event);
}

function isBridgeConnected() {
  return Boolean(subscription) && (!officialLifecycleManaged || officialLifecycleState === "connected");
}

function scheduleRuntimeReconciliation() {
  reconciliationDirty = true;
  if (reconciliationPromise) {
    reconciliationFollowUp = true;
    return reconciliationPromise;
  }
  return reconcileRuntimeProjection();
}

function reconcileRuntimeProjection() {
  if (reconciliationPromise) {
    return reconciliationPromise;
  }

  const generation = bridgeGeneration;
  reconciliationPromise = (async () => {
    if (bridgeGeneration !== generation) {
      return;
    }
    reconciliationState = "in-flight";
    // One refresh plus one coalesced follow-up is enough to capture events that
    // arrived while the snapshot was being fetched without creating a loop.
    for (let pass = 0; pass < 2; pass += 1) {
      reconciliationDirty = false;
      reconciliationFollowUp = false;
      try {
        const adapter = getOpenClawAdapter();
        const refreshes: Array<Promise<unknown>> = [
          adapter.listSessions({}, { timeoutMs: 5_000 }),
          adapter.listTasks({}, { timeoutMs: 5_000 })
        ];
        if (adapter.listTaskSuggestions) {
          refreshes.push(adapter.listTaskSuggestions({}, { timeoutMs: 5_000 }));
        }
        if (adapter.listWorktrees) {
          refreshes.push(adapter.listWorktrees({ timeoutMs: 5_000 }));
        }
        await Promise.all(refreshes);
        if (bridgeGeneration !== generation) {
          return;
        }
        lastReconciledAt = new Date().toISOString();
        lastError = null;
      } catch (error) {
        if (bridgeGeneration !== generation) {
          return;
        }
        reconciliationState = "failed";
        lastError = redactErrorMessage(error, "OpenClaw Gateway runtime reconciliation failed.");
        return;
      }
      if (!reconciliationDirty && !reconciliationFollowUp) {
        break;
      }
    }
    if (bridgeGeneration === generation) {
      reconciliationState = "idle";
    }
  })().finally(() => {
    if (bridgeGeneration === generation) {
      reconciliationPromise = null;
    }
  });
  return reconciliationPromise;
}

function notifyBridgeEventSubscribers(frame: GatewayEventFrame) {
  for (const subscriber of [...bridgeEventSubscribers]) {
    try {
      subscriber(frame);
    } catch (error) {
      lastError = redactErrorMessage(error, "OpenClaw Gateway event subscriber failed.");
    }
  }
}

async function persistGatewayEvent(frame: GatewayEventFrame) {
  const runtime = normalizeOpenClawGatewayEventToRuntime(frame);
  if (!runtime) {
    return;
  }

  lastEventAt = new Date(runtime.updatedAt ?? Date.now()).toISOString();
  await mkdir(eventBridgeRoot, { recursive: true });
  const filePath = path.join(eventBridgeRoot, `${safeFileName(runtime.id)}.json`);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function readBridgeRuntimeRecord(filePath: string): Promise<RuntimeRecord | null> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<RuntimeRecord>;
    if (!parsed || typeof parsed.id !== "string" || typeof parsed.key !== "string") {
      return null;
    }

    return {
      id: parsed.id,
      source: parsed.source === "session" || parsed.source === "cron" ? parsed.source : "turn",
      key: parsed.key,
      title: typeof parsed.title === "string" ? parsed.title : "Gateway runtime event",
      subtitle: typeof parsed.subtitle === "string" ? parsed.subtitle : "OpenClaw Gateway event",
      status: parsed.status ?? "running",
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : null,
      ageMs: typeof parsed.updatedAt === "number" ? Math.max(0, Date.now() - parsed.updatedAt) : null,
      agentId: typeof parsed.agentId === "string" ? parsed.agentId : undefined,
      workspaceId: typeof parsed.workspaceId === "string" ? parsed.workspaceId : undefined,
      modelId: typeof parsed.modelId === "string" ? parsed.modelId : undefined,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
      taskId: typeof parsed.taskId === "string" ? parsed.taskId : undefined,
      runId: typeof parsed.runId === "string" ? parsed.runId : undefined,
      toolNames: Array.isArray(parsed.toolNames) ? parsed.toolNames.filter((entry): entry is string => typeof entry === "string") : undefined,
      tokenUsage: parsed.tokenUsage,
      metadata: isRecord(parsed.metadata) ? parsed.metadata : {}
    };
  } catch {
    return null;
  }
}

function safeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function resetOpenClawEventBridgeForTesting() {
  bridgeGeneration += 1;
  subscription?.close();
  subscription = null;
  starting = null;
  lastError = null;
  lastEventAt = null;
  reconnecting = false;
  reconnectAttempt = 0;
  officialLifecycleManaged = false;
  officialLifecycleState = "stopped";
  lastSequenceGapAt = null;
  expectedSequence = null;
  receivedSequence = null;
  reconciliationState = "idle";
  lastReconciledAt = null;
  sequenceGapCount = 0;
  reconciliationPromise = null;
  reconciliationDirty = false;
  reconciliationFollowUp = false;
  bridgeEventSubscribers.clear();
}
