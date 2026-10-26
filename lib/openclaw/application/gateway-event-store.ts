import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RuntimeRecord } from "@/lib/openclaw/types";

const pendingWrites = new Map<string, Promise<void>>();

export async function writeGatewayRuntimeRecord(root: string, runtime: RuntimeRecord) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const filePath = path.join(root, `${safeFileName(runtime.id)}.json`);
  const previousWrite = pendingWrites.get(filePath);
  const currentWrite = (previousWrite ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const current = await readGatewayRuntimeRecord(filePath);
      if (
        current &&
        typeof current.updatedAt === "number" &&
        typeof runtime.updatedAt === "number" &&
        current.updatedAt > runtime.updatedAt
      ) {
        return;
      }

      const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(tempPath, `${JSON.stringify(runtime, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
        await rename(tempPath, filePath);
      } finally {
        await unlink(tempPath).catch(() => undefined);
      }
    });

  pendingWrites.set(filePath, currentWrite);
  try {
    await currentWrite;
  } finally {
    if (pendingWrites.get(filePath) === currentWrite) {
      pendingWrites.delete(filePath);
    }
  }
}

export async function readGatewayRuntimeRecords(root: string, maxRecords = 500): Promise<RuntimeRecord[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => readGatewayRuntimeRecord(path.join(root, entry.name)))
    );

    return records
      .filter((record): record is RuntimeRecord => Boolean(record))
      .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0))
      .slice(0, maxRecords);
  } catch {
    return [];
  }
}

async function readGatewayRuntimeRecord(filePath: string): Promise<RuntimeRecord | null> {
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
