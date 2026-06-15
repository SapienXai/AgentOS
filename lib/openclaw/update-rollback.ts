import "server-only";

import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveOpenClawBin } from "@/lib/openclaw/cli";
import type { OpenClawUpdateDecision, OpenClawUpdateSafetyReport } from "@/lib/openclaw/types";

const rollbackDir = path.join(process.cwd(), ".mission-control", "openclaw-update");
const rollbackSnapshotPath = path.join(rollbackDir, "last-working-openclaw.json");

export type OpenClawRollbackSnapshot = {
  createdAt: string;
  version: string;
  binaryPath: string;
  configPath: string;
  configHash: string | null;
  configJson: unknown | null;
  configReadError: string | null;
  decision: OpenClawUpdateDecision | null;
  compatibilitySummary: Pick<
    OpenClawUpdateSafetyReport,
    "targetVersion" | "recommendedNextAction" | "canAttemptUpdate" | "summary"
  > | null;
};

export async function createOpenClawRollbackSnapshot(input: {
  version: string;
  binaryPath?: string | null;
  decision?: OpenClawUpdateDecision | null;
  compatibilityReport?: OpenClawUpdateSafetyReport | null;
}): Promise<OpenClawRollbackSnapshot> {
  const binaryPath = input.binaryPath || (await resolveOpenClawBin());
  const configPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
  const configResult = await readOpenClawConfigSnapshot(configPath);
  const snapshot: OpenClawRollbackSnapshot = {
    createdAt: new Date().toISOString(),
    version: input.version,
    binaryPath,
    configPath,
    configHash: configResult.configHash,
    configJson: configResult.configJson,
    configReadError: configResult.configReadError,
    decision: input.decision ?? null,
    compatibilitySummary: input.compatibilityReport
      ? {
          targetVersion: input.compatibilityReport.targetVersion,
          recommendedNextAction: input.compatibilityReport.recommendedNextAction,
          canAttemptUpdate: input.compatibilityReport.canAttemptUpdate,
          summary: input.compatibilityReport.summary
        }
      : null
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
      configHash: typeof parsed.configHash === "string" ? parsed.configHash : null,
      configJson: parsed.configJson ?? null,
      configReadError: parsed.configReadError ?? null,
      decision: normalizeRollbackDecision(parsed.decision),
      compatibilitySummary: normalizeRollbackCompatibilitySummary(parsed.compatibilitySummary)
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
    const raw = await readFile(configPath, "utf8");
    return {
      configJson: JSON.parse(raw) as unknown,
      configHash: createHash("sha256").update(raw).digest("hex"),
      configReadError: null
    };
  } catch (error) {
    return {
      configJson: null,
      configHash: null,
      configReadError: error instanceof Error ? error.message : "OpenClaw config could not be read."
    };
  }
}

function normalizeRollbackDecision(value: unknown): OpenClawUpdateDecision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Partial<OpenClawUpdateDecision>;
  if (!record.version || !record.status || typeof record.allowed !== "boolean") {
    return null;
  }

  return record as OpenClawUpdateDecision;
}

function normalizeRollbackCompatibilitySummary(value: unknown): OpenClawRollbackSnapshot["compatibilitySummary"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as OpenClawRollbackSnapshot["compatibilitySummary"];
  if (!record?.targetVersion || !record.summary) {
    return null;
  }

  return record;
}
