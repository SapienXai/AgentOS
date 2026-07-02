import "server-only";

import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { getOpenClawCapabilityMatrix } from "@/lib/openclaw/application/capability-matrix-service";
import type {
  OpenClawGatewayEventFrame,
  OpenClawGatewayEventSubscription
} from "@/lib/openclaw/client/gateway-client";
import { normalizeOpenClawGatewayEventToRuntime } from "@/lib/openclaw/application/runtime-state-service";
import type { OpenClawEventBridgeStreamStatus, RuntimeRecord } from "@/lib/openclaw/types";
import { redactErrorMessage } from "@/lib/security/redaction";

type GatewayEventFrame = OpenClawGatewayEventFrame;

export { normalizeOpenClawGatewayEventToRuntime } from "@/lib/openclaw/application/runtime-state-service";

const eventBridgeRoot = path.join(/*turbopackIgnore: true*/ process.cwd(), ".mission-control", "gateway-events");
const maxBridgeRecords = 500;
const defaultReconnectBaseMs = 1_000;
const defaultReconnectMaxMs = 30_000;
let subscription: OpenClawGatewayEventSubscription | null = null;
let starting: Promise<void> | null = null;
let lastError: string | null = null;
let lastEventAt: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let reconnecting = false;
let suppressNextReconnect = false;
let reconnectBaseMs = defaultReconnectBaseMs;
let reconnectMaxMs = defaultReconnectMaxMs;
let bridgeGeneration = 0;
const bridgeEventSubscribers = new Set<(frame: GatewayEventFrame) => void>();

export function getOpenClawEventBridgeStatus() {
  return {
    connected: Boolean(subscription),
    reconnecting,
    reconnectAttempt,
    lastEventAt,
    lastError
  };
}

export function getOpenClawEventBridgeStreamStatus(): OpenClawEventBridgeStreamStatus {
  const connected = Boolean(subscription);
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
          notifyBridgeEventSubscribers(frame);
          void persistGatewayEvent(frame).catch((error) => {
            lastError = redactErrorMessage(error, "OpenClaw Gateway event persistence failed.");
          });
        },
        onError: (error) => {
          lastError = redactErrorMessage(error, "OpenClaw Gateway event stream failed.");
        },
        onClose: () => {
          subscription = null;
          scheduleEventBridgeReconnect(generation);
        }
      },
      { timeoutMs: 5_000 }
    );
    if (bridgeGeneration !== generation) {
      nextSubscription.close();
      return;
    }

    subscription = nextSubscription;
    lastError = null;
    reconnectAttempt = 0;
    reconnecting = false;
  } catch (error) {
    if (bridgeGeneration !== generation) {
      return;
    }

    subscription = null;
    lastError = redactErrorMessage(error, "OpenClaw Gateway event stream failed.");
    scheduleEventBridgeReconnect(generation);
  }
}

function scheduleEventBridgeReconnect(generation = bridgeGeneration) {
  if (bridgeGeneration !== generation) {
    return;
  }

  if (suppressNextReconnect) {
    suppressNextReconnect = false;
    reconnecting = false;
    return;
  }

  if (subscription || starting || reconnectTimer) {
    return;
  }

  reconnectAttempt += 1;
  reconnecting = true;
  const delayMs = Math.min(reconnectMaxMs, reconnectBaseMs * 2 ** Math.max(0, reconnectAttempt - 1));

  reconnectTimer = setTimeout(() => {
    if (bridgeGeneration !== generation) {
      reconnectTimer = null;
      return;
    }

    reconnectTimer = null;
    startOpenClawEventBridge();
  }, delayMs);
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
  suppressNextReconnect = true;
  subscription?.close();
  subscription = null;
  starting = null;
  lastError = null;
  lastEventAt = null;
  reconnecting = false;
  reconnectAttempt = 0;
  suppressNextReconnect = false;
  bridgeEventSubscribers.clear();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  reconnectBaseMs = defaultReconnectBaseMs;
  reconnectMaxMs = defaultReconnectMaxMs;
}

export function setOpenClawEventBridgeReconnectPolicyForTesting(input: {
  baseMs?: number;
  maxMs?: number;
}) {
  reconnectBaseMs = typeof input.baseMs === "number" && Number.isFinite(input.baseMs) && input.baseMs >= 0
    ? input.baseMs
    : defaultReconnectBaseMs;
  reconnectMaxMs = typeof input.maxMs === "number" && Number.isFinite(input.maxMs) && input.maxMs >= reconnectBaseMs
    ? input.maxMs
    : defaultReconnectMaxMs;
}
