import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { writeAtomicJson } from "@/lib/agentos/application/workspace-provisioning-store";
import {
  validateWorkspaceCreationRun,
  WORKSPACE_CREATION_RUN_SCHEMA_VERSION,
  isWorkspaceCreationTerminal,
  type WorkspaceCreationRun
} from "@/lib/agentos/domains/workspace-creation-run";
import { missionControlRootPath } from "@/lib/openclaw/state/paths";

export const WORKSPACE_CREATION_RUN_ROOT = path.join(missionControlRootPath, "workspace-creation-runs");
const RUN_MUTATION_LOCK_TIMEOUT_MS = 5_000;
const RUN_MUTATION_LOCK_STALE_AFTER_MS = 10_000;

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
  input: Pick<WorkspaceCreationRun, "actorHash" | "idempotencyKeyHash" | "attempt" | "input" | "inputFingerprint" | "draftContextId" | "snapshot" | "result">
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
    const parsed: unknown = migrateLegacyCreationRun(JSON.parse(raw));
    return validateWorkspaceCreationRun(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function migrateLegacyCreationRun(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    ...value,
    snapshot: migrateLegacySnapshot(value.snapshot),
    events: Array.isArray(value.events) ? value.events.map((event) => isRecord(event) ? { ...event, snapshot: migrateLegacySnapshot(event.snapshot) } : event) : value.events
  };
}

function migrateLegacySnapshot(value: unknown): unknown {
  if (!isRecord(value) || "extraction" in value) return value;
  return {
    ...value,
    extraction: {
      status: "not-requested",
      extractionId: null,
      generationId: null,
      evidenceCount: 0,
      factCount: 0,
      resourceCount: 0,
      verifiedFactCount: 0,
      verifiedResourceCount: 0,
      conflictCount: 0,
      warningCount: 0,
      unknownCount: 0
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return mutateWorkspaceCreationRun(filePath, (current) => ({ ...current, ...updates }));
}

/** Apply a short-lived mutation against the latest durable run version. */
export async function mutateWorkspaceCreationRun(
  filePath: string,
  updater: (current: WorkspaceCreationRun) => WorkspaceCreationRun | Promise<WorkspaceCreationRun>
) {
  return withRunMutationLock(filePath, async () => {
    const current = await readWorkspaceCreationRunFile(filePath);
    if (!current) throw new Error("Workspace creation run is unavailable or malformed.");
    const next = await updater(current);
    assertImmutableRunFields(current, next);
    const protectedNext = preserveMonotonicRunState(current, next);
    if (!validateWorkspaceCreationRun(protectedNext)) throw new Error("Workspace creation run mutation produced invalid state.");
    await writeAtomicJson(filePath, protectedNext);
    return protectedNext;
  });
}

export async function deleteWorkspaceCreationRunFile(filePath: string) {
  await rm(filePath, { force: true });
}

function assertImmutableRunFields(run: WorkspaceCreationRun, updates: Partial<WorkspaceCreationRun>) {
  for (const field of ["runId", "actorHash", "idempotencyKeyHash", "createdAt", "input", "inputFingerprint", "draftContextId"] as const) {
    if (field in updates && JSON.stringify(updates[field]) !== JSON.stringify(run[field])) {
      throw new Error("Workspace creation intent is immutable after run creation.");
    }
  }
}

function preserveMonotonicRunState(current: WorkspaceCreationRun, next: WorkspaceCreationRun): WorkspaceCreationRun {
  const cancelRequested = current.snapshot.cancelRequested || Boolean(current.cancelRequestedAt) || next.snapshot.cancelRequested;
  const nextSnapshot = cancelRequested && next.snapshot.state !== "cancelled"
    ? { ...next.snapshot, cancelRequested: true, state: "cancelled" as const, stage: null }
    : current.snapshot.state !== next.snapshot.state && isWorkspaceCreationTerminal(current.snapshot.state) && !isWorkspaceCreationTerminal(next.snapshot.state)
      ? { ...next.snapshot, state: current.snapshot.state, stage: current.snapshot.stage }
      : next.snapshot;
  const remote = remoteExecutionAtLeast(current.remoteExecution, next.remoteExecution);
  const latestSequence = current.events.at(-1)?.sequence ?? 0;
  const nextSequence = next.events.at(-1)?.sequence ?? 0;
  return {
    ...next,
    snapshot: nextSnapshot,
    cancelRequestedAt: current.cancelRequestedAt ?? next.cancelRequestedAt ?? (cancelRequested ? next.updatedAt : null),
    remoteExecution: remote,
    events: nextSequence >= latestSequence ? next.events : current.events,
    oldestRetainedSequence: nextSequence >= latestSequence ? next.oldestRetainedSequence : current.oldestRetainedSequence,
    updatedAt: nextSequence >= latestSequence ? next.updatedAt : current.updatedAt
  };
}

function remoteExecutionAtLeast(current: WorkspaceCreationRun["remoteExecution"], next: WorkspaceCreationRun["remoteExecution"]) {
  const rank = { "not-started": 0, "in-flight": 1, completed: 2, ambiguous: 3 } as const;
  if (rank[current.outcome] > rank[next.outcome]) return current;
  return {
    ...next,
    idempotencyKey: current.idempotencyKey || next.idempotencyKey,
    runId: next.runId ?? current.runId,
    sessionKey: next.sessionKey ?? current.sessionKey
  };
}

async function withRunMutationLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${filePath}.mutation`;
  const deadline = Date.now() + RUN_MUTATION_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.close();
      break;
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      const age = await stat(lockPath).then((entry) => Date.now() - entry.mtimeMs).catch(() => 0);
      if (age > RUN_MUTATION_LOCK_STALE_AFTER_MS) {
        await rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new Error("Workspace creation run mutation is busy.");
      await delay(10);
    }
  }
  try {
    return await operation();
  } finally {
    await rm(lockPath, { force: true });
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isFileExistsError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}
