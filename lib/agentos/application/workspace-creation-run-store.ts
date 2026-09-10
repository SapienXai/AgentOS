import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { writeAtomicJson } from "@/lib/agentos/application/workspace-provisioning-store";
import {
  validateWorkspaceCreationRun,
  WORKSPACE_CREATION_RUN_SCHEMA_VERSION,
  type WorkspaceCreationRun
} from "@/lib/agentos/domains/workspace-creation-run";
import { missionControlRootPath } from "@/lib/openclaw/state/paths";

export const WORKSPACE_CREATION_RUN_ROOT = path.join(missionControlRootPath, "workspace-creation-runs");

export function resolveWorkspaceCreationRunRoot(rootPath = WORKSPACE_CREATION_RUN_ROOT) {
  return path.resolve(rootPath);
}

export function workspaceCreationActorHash(actorId: string) {
  return sha256(actorId.trim()).slice(0, 32);
}

export function workspaceCreationStorageKey(actorId: string, idempotencyKey: string) {
  return `${workspaceCreationActorHash(actorId)}:${sha256(idempotencyKey.trim())}`;
}

export function workspaceCreationRunPath(rootPath: string, storageKey: string) {
  return path.join(resolveWorkspaceCreationRunRoot(rootPath), `${sha256(storageKey)}.json`);
}

export type WorkspaceCreationRunLocator = { run: WorkspaceCreationRun; filePath: string };

export async function createWorkspaceCreationRunAtomically(
  rootPath: string,
  storageKey: string,
  input: Pick<WorkspaceCreationRun, "actorHash" | "idempotencyKeyHash" | "attempt" | "input" | "draftContextId" | "snapshot" | "result">
): Promise<{ run: WorkspaceCreationRun; created: boolean; filePath: string }> {
  const root = resolveWorkspaceCreationRunRoot(rootPath);
  await mkdir(root, { recursive: true, mode: 0o700 });
  const now = new Date().toISOString();
  const run: WorkspaceCreationRun = {
    ...input,
    schemaVersion: WORKSPACE_CREATION_RUN_SCHEMA_VERSION,
    runId: randomUUID(),
    createdAt: now,
    updatedAt: now,
    events: [],
    oldestRetainedSequence: 1,
    cancelRequestedAt: null,
    remoteExecution: {
      idempotencyKey: `${sha256(storageKey)}:${input.attempt}`,
      runId: null,
      sessionKey: null,
      outcome: "not-started"
    }
  };
  const filePath = workspaceCreationRunPath(root, storageKey);
  try {
    const handle = await open(filePath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(run, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { run, created: true, filePath };
  } catch (error) {
    if (!isFileExistsError(error)) throw error;
    const existing = await readWorkspaceCreationRunFile(filePath);
    if (!existing) throw new Error("Workspace creation run is unavailable or malformed.");
    return { run: existing, created: false, filePath };
  }
}

export async function readWorkspaceCreationRun(rootPath: string, storageKey: string) {
  return readWorkspaceCreationRunFile(workspaceCreationRunPath(rootPath, storageKey));
}

export async function readWorkspaceCreationRunFile(filePath: string): Promise<WorkspaceCreationRun | null> {
  const raw = await readFile(filePath, "utf8").catch(() => null);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return validateWorkspaceCreationRun(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function findWorkspaceCreationRunById(rootPath: string, actorId: string, runId: string): Promise<WorkspaceCreationRunLocator | null> {
  const root = resolveWorkspaceCreationRunRoot(rootPath);
  const expectedActorHash = workspaceCreationActorHash(actorId);
  const files = await readdir(root).catch(() => []);
  for (const fileName of files) {
    if (!fileName.endsWith(".json")) continue;
    const filePath = path.join(root, fileName);
    const run = await readWorkspaceCreationRunFile(filePath);
    if (run?.actorHash === expectedActorHash && run.runId === runId) return { run, filePath };
  }
  return null;
}

export async function listWorkspaceCreationRuns(rootPath: string, actorId: string, activeOnly = false) {
  const root = resolveWorkspaceCreationRunRoot(rootPath);
  const expectedActorHash = workspaceCreationActorHash(actorId);
  const files = await readdir(root).catch(() => []);
  const runs: WorkspaceCreationRunLocator[] = [];
  for (const fileName of files) {
    if (!fileName.endsWith(".json")) continue;
    const filePath = path.join(root, fileName);
    const run = await readWorkspaceCreationRunFile(filePath);
    if (!run || run.actorHash !== expectedActorHash) continue;
    if (activeOnly && ["review-ready", "failed", "cancelled"].includes(run.snapshot.state)) continue;
    runs.push({ run, filePath });
  }
  return runs.sort((left, right) => right.run.updatedAt.localeCompare(left.run.updatedAt));
}

export async function updateWorkspaceCreationRun(
  filePath: string,
  run: WorkspaceCreationRun,
  updates: Partial<WorkspaceCreationRun>
) {
  assertImmutableRunFields(run, updates);
  const next = { ...run, ...updates };
  await writeAtomicJson(filePath, next);
  return next;
}

export async function deleteWorkspaceCreationRunFile(filePath: string) {
  await rm(filePath, { force: true });
}

function assertImmutableRunFields(run: WorkspaceCreationRun, updates: Partial<WorkspaceCreationRun>) {
  for (const field of ["runId", "actorHash", "idempotencyKeyHash", "createdAt", "input", "draftContextId"] as const) {
    if (field in updates && JSON.stringify(updates[field]) !== JSON.stringify(run[field])) {
      throw new Error("Workspace creation intent is immutable after run creation.");
    }
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isFileExistsError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}
