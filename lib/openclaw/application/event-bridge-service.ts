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
import type { RuntimeRecord } from "@/lib/openclaw/types";

type GatewayEventFrame = OpenClawGatewayEventFrame;

export { normalizeOpenClawGatewayEventToRuntime } from "@/lib/openclaw/application/runtime-state-service";

const eventBridgeRoot = path.join(/*turbopackIgnore: true*/ process.cwd(), ".mission-control", "gateway-events");
const maxBridgeRecords = 500;
let subscription: OpenClawGatewayEventSubscription | null = null;
let starting: Promise<void> | null = null;
let lastError: string | null = null;
let lastEventAt: string | null = null;
const bridgeEventSubscribers = new Set<(frame: GatewayEventFrame) => void>();

export function getOpenClawEventBridgeStatus() {
  return {
    connected: Boolean(subscription),
    lastEventAt,
    lastError
  };
}

export function startOpenClawEventBridge() {
  if (subscription || starting) {
    return;
  }

  starting = startEventBridge().finally(() => {
    starting = null;
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

async function startEventBridge() {
  const capabilityMatrix = await getOpenClawCapabilityMatrix().catch(() => null);
  if (capabilityMatrix?.eventBridge === "unsupported") {
    lastError = "OpenClaw Gateway does not advertise compatible session/event support.";
    return;
  }

  try {
    subscription = await getOpenClawAdapter().subscribeRuntimeEvents(
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
            lastError = error instanceof Error ? error.message : String(error);
          });
        },
        onError: (error) => {
          lastError = error instanceof Error ? error.message : String(error);
        },
        onClose: () => {
          subscription = null;
        }
      },
      { timeoutMs: 5_000 }
    );
    lastError = null;
  } catch (error) {
    subscription = null;
    lastError = error instanceof Error ? error.message : String(error);
  }
}

function notifyBridgeEventSubscribers(frame: GatewayEventFrame) {
  for (const subscriber of [...bridgeEventSubscribers]) {
    try {
      subscriber(frame);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
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
