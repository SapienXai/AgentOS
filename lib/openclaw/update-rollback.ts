import "server-only";

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveOpenClawBin } from "@/lib/openclaw/cli";

const rollbackDir = path.join(process.cwd(), ".mission-control", "openclaw-update");
const rollbackSnapshotPath = path.join(rollbackDir, "last-working-openclaw.json");

export type OpenClawRollbackSnapshot = {
  createdAt: string;
  version: string;
  binaryPath: string;
  configPath: string;
  configJson: unknown | null;
  configReadError: string | null;
};

export async function createOpenClawRollbackSnapshot(input: {
  version: string;
  binaryPath?: string | null;
}): Promise<OpenClawRollbackSnapshot> {
  const binaryPath = input.binaryPath || (await resolveOpenClawBin());
  const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  const configResult = await readOpenClawConfigSnapshot(configPath);
  const snapshot: OpenClawRollbackSnapshot = {
    createdAt: new Date().toISOString(),
    version: input.version,
    binaryPath,
    configPath,
    configJson: configResult.configJson,
    configReadError: configResult.configReadError
  };

  await persistOpenClawRollbackSnapshot(snapshot);
  return snapshot;
}

export async function readOpenClawRollbackSnapshot() {
  try {
    const parsed = JSON.parse(await readFile(rollbackSnapshotPath, "utf8")) as Partial<OpenClawRollbackSnapshot>;

    if (!parsed.version || !parsed.binaryPath || !parsed.createdAt) {
      return null;
    }

    return {
      createdAt: parsed.createdAt,
      version: parsed.version,
      binaryPath: parsed.binaryPath,
      configPath: parsed.configPath || path.join(os.homedir(), ".openclaw", "openclaw.json"),
      configJson: parsed.configJson ?? null,
      configReadError: parsed.configReadError ?? null
    } satisfies OpenClawRollbackSnapshot;
  } catch {
    return null;
  }
}

export function getOpenClawRollbackSnapshotPath() {
  return rollbackSnapshotPath;
}

export async function restoreOpenClawRollbackConfigSnapshot(snapshot: OpenClawRollbackSnapshot) {
  if (!snapshot.configJson) {
    return {
      restored: false,
      message: snapshot.configReadError || "No OpenClaw config snapshot was available to restore."
    };
  }

  const expectedConfigPath = path.resolve(os.homedir(), ".openclaw", "openclaw.json");
  const requestedConfigPath = path.resolve(snapshot.configPath);

  if (requestedConfigPath !== expectedConfigPath) {
    return {
      restored: false,
      message: "Rollback config restore skipped because the snapshot path is not the expected OpenClaw config path."
    };
  }

  await mkdir(path.dirname(expectedConfigPath), { recursive: true });
  await writeFile(expectedConfigPath, `${JSON.stringify(snapshot.configJson, null, 2)}\n`, { mode: 0o600 });
  await chmod(expectedConfigPath, 0o600).catch(() => {});

  return {
    restored: true,
    message: "Restored the previous OpenClaw config snapshot."
  };
}

async function persistOpenClawRollbackSnapshot(snapshot: OpenClawRollbackSnapshot) {
  await mkdir(rollbackDir, { recursive: true });
  await writeFile(rollbackSnapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  await chmod(rollbackSnapshotPath, 0o600).catch(() => {});
}

async function readOpenClawConfigSnapshot(configPath: string) {
  try {
    return {
      configJson: JSON.parse(await readFile(configPath, "utf8")) as unknown,
      configReadError: null
    };
  } catch (error) {
    return {
      configJson: null,
      configReadError: error instanceof Error ? error.message : "OpenClaw config could not be read."
    };
  }
}
