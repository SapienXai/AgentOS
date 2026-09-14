import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";

import {
  acquireLifecycleOperationLeases,
  isLifecycleOperationResourceLeased,
  LifecycleOperationBusyError,
  LIFECYCLE_OPERATION_STORAGE_ROOT
} from "@/lib/openclaw/application/lifecycle-operation-lease";

export const LIFECYCLE_OPERATION_SCHEMA_VERSION = 2 as const;
export const LIFECYCLE_OPERATION_ROOT = LIFECYCLE_OPERATION_STORAGE_ROOT;
export const LIFECYCLE_OPERATION_CLEANUP_INTERVAL_MS = 60_000;
export const LIFECYCLE_OPERATION_MAX_CLEANUP_ENTRIES = 64;
export const LIFECYCLE_OPERATION_CLEANUP_CURSOR_FILENAME = ".cleanup-cursor";
export const LIFECYCLE_OPERATION_RETENTION_MS = {
  ready: 7 * 24 * 60 * 60 * 1_000,
  failed: 14 * 24 * 60 * 60 * 1_000,
  partial: 30 * 24 * 60 * 60 * 1_000
} as const;

export type LifecycleOperationKind = "agent.create" | "agent.delete" | "workspace.delete" | "workspace.move";
export type LifecycleOperationState = "requested" | "running" | "ready" | "partial" | "failed" | "unknown";
export type LifecycleOperationStage =
  | "requested"
  | "reading-native-state"
  | "recovering"
  | "validating"
  | "creating-native-agent"
  | "native-mutation"
  | "syncing-profile-config"
  | "binding-channels"
  | "deleting-agents"
  | "disconnecting-bindings"
  | "reconciling-native-state"
  | "native-removal-confirmed"
  | "moving-filesystem"
  | "syncing-workspace-config"
  | "workspace-move-confirmed"
  | "sidecar-sync"
  | "filesystem-cleanup"
  | "cleanup-partial"
  | "complete";

export type LifecycleOperationItemState = "pending" | "confirmed" | "failed" | "unknown" | "skipped";

export type StoredLifecycleOperation = {
  schemaVersion: typeof LIFECYCLE_OPERATION_SCHEMA_VERSION;
  operationId: string;
  idempotencyKey: string;
  kind: LifecycleOperationKind;
  targetId: string;
  state: LifecycleOperationState;
  stage: LifecycleOperationStage;
  revision: number;
  recoveryGeneration: number;
  mutationAttemptCount: number;
  createdAt: string;
  updatedAt: string;
  lastReconciledAt: string | null;
  lastMutationAt: string | null;
  lastConfirmedNativeStateAt: string | null;
  nativeAccepted: boolean;
  nativeConfirmed: boolean;
  sidecarSynchronized: boolean;
  warnings: string[];
  error: { code: string; message: string } | null;
  result: unknown;
  metadata: {
    workspaceId?: string | null;
    workspacePath?: string | null;
    previousWorkspacePath?: string | null;
    targetWorkspacePath?: string | null;
    filesystemOwnership?: string | null;
    materialization?: string | null;
    ownershipRecordedAt?: string | null;
    recoveryProof?: "authoritative-absence" | null;
    directoryIdentity?: { device: string; inode: string } | null;
    agentIds?: string[];
    channelIds?: string[];
  };
  items: Record<string, LifecycleOperationItemState>;
  sidecars: Record<string, LifecycleOperationItemState>;
};

export type LifecycleOperationPatch = Partial<Pick<
  StoredLifecycleOperation,
  | "state"
  | "stage"
  | "recoveryGeneration"
  | "mutationAttemptCount"
  | "lastReconciledAt"
  | "lastMutationAt"
  | "lastConfirmedNativeStateAt"
  | "nativeAccepted"
  | "nativeConfirmed"
  | "sidecarSynchronized"
  | "warnings"
  | "error"
  | "result"
  | "metadata"
  | "items"
  | "sidecars"
>>;

export class LifecycleOperationConflictError extends Error {
  readonly code = "lifecycle-operation-revision-conflict";

  constructor() {
    super("Lifecycle operation state changed in another executor; reread before continuing.");
    this.name = "LifecycleOperationConflictError";
  }
}

const inProcessLifecycleOperationLocks = new Map<string, Promise<void>>();
const cleanupLastRunByRoot = new Map<string, number>();

function storageKey(kind: LifecycleOperationKind, targetId: string) {
  return `${kind}:${targetId.trim()}`;
}

function operationResourceKey(kind: LifecycleOperationKind, targetId: string) {
  return `operation:${storageKey(kind, targetId)}`;
}

function workspaceResourceKey(workspaceId: string) {
  return `workspace:${workspaceId.trim()}`;
}

function agentResourceKey(agentId: string) {
  return `agent:${agentId.trim()}`;
}

/**
 * Serializes lifecycle work inside one process and takes the same resource
 * leases on disk for other processes. Resource keys are sorted before
 * acquisition so workspace/agent nested operations cannot deadlock.
 */
export async function withLifecycleOperationLock<T>(input: {
  kind: LifecycleOperationKind;
  targetId: string;
  resourceKeys?: string[];
  rootPath?: string;
  waitMs?: number;
  run: () => Promise<T>;
}) {
  const targetId = input.targetId.trim();
  if (!targetId) {
    throw new Error("Lifecycle operation target is required.");
  }

  const rootPath = path.resolve(input.rootPath ?? LIFECYCLE_OPERATION_ROOT);
  const lockKeys = [...new Set([
    operationResourceKey(input.kind, targetId),
    ...(input.resourceKeys ?? []).map((key) => key.trim()).filter(Boolean)
  ])].sort();
  const releaseLocalLocks = await acquireInProcessLocks(rootPath, lockKeys);
  let leases: Awaited<ReturnType<typeof acquireLifecycleOperationLeases>> = null;

  try {
    leases = await acquireLifecycleOperationLeases({
      resourceKeys: lockKeys,
      rootPath,
      waitMs: input.waitMs
    });
    if (!leases) {
      throw new LifecycleOperationBusyError();
    }
    return await input.run();
  } finally {
    await Promise.all((leases ?? []).reverse().map((lease) => lease.release().catch(() => undefined)));
    releaseLocalLocks();
  }
}

export function lifecycleWorkspaceResourceKey(workspaceId: string) {
  return workspaceResourceKey(workspaceId);
}

export function lifecycleAgentResourceKey(agentId: string) {
  return agentResourceKey(agentId);
}

function filePathForKey(key: string, rootPath = LIFECYCLE_OPERATION_ROOT) {
  const digest = createHash("sha256").update(key).digest("hex");
  return path.join(path.resolve(rootPath), `${digest}.json`);
}

export async function createOrReadLifecycleOperation(input: {
  kind: LifecycleOperationKind;
  targetId: string;
  metadata?: StoredLifecycleOperation["metadata"];
  rootPath?: string;
}) {
  const targetId = input.targetId.trim();
  if (!targetId) {
    throw new Error("Lifecycle operation target is required.");
  }

  const key = storageKey(input.kind, targetId);
  const rootPath = path.resolve(input.rootPath ?? LIFECYCLE_OPERATION_ROOT);
  const filePath = filePathForKey(key, rootPath);
  await mkdir(rootPath, { recursive: true, mode: 0o700 });
  await cleanupLifecycleOperations({ rootPath }).catch(() => undefined);

  try {
    const existing = await readLifecycleOperationFile(filePath);
    if (existing.kind === input.kind && existing.targetId === targetId) {
      return { operation: existing, created: false };
    }
  } catch (error) {
    if (!isFileNotFound(error)) throw error;
  }

  const now = new Date().toISOString();
  const operation: StoredLifecycleOperation = {
    schemaVersion: LIFECYCLE_OPERATION_SCHEMA_VERSION,
    operationId: randomUUID(),
    idempotencyKey: key,
    kind: input.kind,
    targetId,
    revision: 1,
    recoveryGeneration: 0,
    mutationAttemptCount: 0,
    createdAt: now,
    updatedAt: now,
    state: "requested",
    stage: "requested",
    lastReconciledAt: null,
    lastMutationAt: null,
    lastConfirmedNativeStateAt: null,
    nativeAccepted: false,
    nativeConfirmed: false,
    sidecarSynchronized: false,
    warnings: [],
    error: null,
    result: null,
    metadata: input.metadata ?? {},
    items: {},
    sidecars: {}
  };

  try {
    await writeNewLifecycleOperation(operation, filePath);
    return { operation, created: true };
  } catch (error) {
    if (!isFileExists(error)) throw error;
    const existing = await readLifecycleOperationFile(filePath);
    if (existing.kind !== input.kind || existing.targetId !== targetId) {
      throw new Error("Lifecycle operation storage key collision.");
    }
    return { operation: existing, created: false };
  }
}

export async function updateLifecycleOperation(
  operation: StoredLifecycleOperation,
  patch: LifecycleOperationPatch,
  rootPath = LIFECYCLE_OPERATION_ROOT
) {
  const filePath = filePathForKey(operation.idempotencyKey, rootPath);
  return withOperationFileMutationLock(filePath, async () => {
    const current = await readLifecycleOperationFile(filePath);
    if (current.operationId !== operation.operationId || current.revision !== operation.revision) {
      throw new LifecycleOperationConflictError();
    }

    const next: StoredLifecycleOperation = {
      ...current,
      ...patch,
      revision: current.revision + 1,
      metadata: patch.metadata ? { ...current.metadata, ...patch.metadata } : current.metadata,
      warnings: patch.warnings ? [...new Set(patch.warnings.filter(Boolean))] : current.warnings,
      items: patch.items ? { ...current.items, ...patch.items } : current.items,
      sidecars: patch.sidecars ? { ...current.sidecars, ...patch.sidecars } : current.sidecars,
      updatedAt: new Date().toISOString()
    };
    await writeLifecycleOperation(next, filePath);
    return next;
  });
}

export async function readLifecycleOperation(
  kind: LifecycleOperationKind,
  targetId: string,
  rootPath = LIFECYCLE_OPERATION_ROOT
) {
  return readLifecycleOperationFile(filePathForKey(storageKey(kind, targetId), rootPath));
}

export async function cleanupLifecycleOperations(input: {
  rootPath?: string;
  now?: Date;
  force?: boolean;
  maxEntries?: number;
} = {}) {
  const rootPath = path.resolve(input.rootPath ?? LIFECYCLE_OPERATION_ROOT);
  const nowMs = (input.now ?? new Date()).getTime();
  const lastRun = cleanupLastRunByRoot.get(rootPath) ?? 0;
  if (!input.force && nowMs - lastRun < LIFECYCLE_OPERATION_CLEANUP_INTERVAL_MS) {
    return { inspected: 0, removed: 0 };
  }
  cleanupLastRunByRoot.set(rootPath, nowMs);

  await mkdir(rootPath, { recursive: true, mode: 0o700 });
  const maxEntries = Math.max(1, Math.floor(input.maxEntries ?? LIFECYCLE_OPERATION_MAX_CLEANUP_ENTRIES));
  const cursorPath = path.join(rootPath, LIFECYCLE_OPERATION_CLEANUP_CURSOR_FILENAME);

  return withOperationFileMutationLock(cursorPath, async () => {
    const entries = (await readdir(rootPath, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".tmp")))
      .sort((left, right) => left.name.localeCompare(right.name));
    const cursor = await readLifecycleCleanupCursor(cursorPath);
    const lastEntryName = cursor?.lastEntryName ?? null;
    const startIndex = lastEntryName
      ? entries.findIndex((entry) => entry.name > lastEntryName)
      : 0;
    const normalizedStartIndex = startIndex < 0 ? 0 : startIndex;
    const selectedEntries = entries.slice(normalizedStartIndex, normalizedStartIndex + maxEntries);
    if (selectedEntries.length < maxEntries && normalizedStartIndex > 0) {
      selectedEntries.push(...entries.slice(0, maxEntries - selectedEntries.length));
    }

    let inspected = 0;
    let removed = 0;
    for (const entry of selectedEntries) {
      inspected += 1;
      const entryPath = path.join(rootPath, entry.name);
      const entryStat = await stat(entryPath).catch(() => null);
      if (!entryStat) continue;

      if (entry.name.endsWith(".tmp")) {
        if (nowMs - entryStat.mtimeMs >= 60 * 60 * 1_000) {
          await rm(entryPath, { force: true }).catch(() => undefined);
          removed += 1;
        }
        continue;
      }

      let operation: StoredLifecycleOperation;
      try {
        operation = await readLifecycleOperationFile(entryPath);
      } catch {
        continue;
      }
      const retention = retentionForState(operation.state);
      const updatedAtMs = Date.parse(operation.updatedAt);
      if (retention === null || !Number.isFinite(updatedAtMs) || nowMs - updatedAtMs < retention) continue;
      if (await isLifecycleOperationResourceLeased(operationResourceKey(operation.kind, operation.targetId), rootPath)) continue;

      await rm(entryPath, { force: true }).catch(() => undefined);
      removed += 1;
    }

    if (entries.length > 0) {
      await writeAtomicJson(cursorPath, {
        schemaVersion: 1,
        lastEntryName: selectedEntries.at(-1)?.name ?? cursor?.lastEntryName ?? null
      });
    }

    return { inspected, removed };
  });
}

async function acquireInProcessLocks(rootPath: string, lockKeys: string[]) {
  const entries: Array<{ key: string; current: Promise<void>; release: () => void }> = [];

  try {
    for (const lockKey of lockKeys) {
      const key = `${rootPath}:${lockKey}`;
      const previous = inProcessLifecycleOperationLocks.get(key) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      inProcessLifecycleOperationLocks.set(key, current);
      entries.push({ key, current, release });
      await previous;
    }
  } catch (error) {
    releaseInProcessLocks(entries);
    throw error;
  }

  return () => releaseInProcessLocks(entries);
}

function releaseInProcessLocks(entries: Array<{ key: string; current: Promise<void>; release: () => void }>) {
  for (const entry of [...entries].reverse()) {
    entry.release();
    if (inProcessLifecycleOperationLocks.get(entry.key) === entry.current) {
      inProcessLifecycleOperationLocks.delete(entry.key);
    }
  }
}

async function withOperationFileMutationLock<T>(filePath: string, operation: () => Promise<T>) {
  const mutationPath = `${filePath}.mutation`;
  const deadline = Date.now() + 2_000;

  for (;;) {
    try {
      const handle = await open(mutationPath, "wx", 0o600);
      await handle.close();
      break;
    } catch (error) {
      if (!isFileExists(error)) throw error;
      const age = await stat(mutationPath).then((entry) => Date.now() - entry.mtimeMs).catch(() => 0);
      if (age > 2_000) {
        await rm(mutationPath, { force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new LifecycleOperationBusyError("Lifecycle operation record is busy.");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  try {
    return await operation();
  } finally {
    await rm(mutationPath, { force: true });
  }
}

async function writeNewLifecycleOperation(operation: StoredLifecycleOperation, filePath: string) {
  const handle = await open(filePath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(operation, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(path.dirname(filePath));
}

async function writeLifecycleOperation(operation: StoredLifecycleOperation, filePath: string) {
  await writeAtomicJson(filePath, operation);
}

async function writeAtomicJson(filePath: string, value: unknown) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "w", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, filePath);
    await syncDirectory(path.dirname(filePath));
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function readLifecycleCleanupCursor(filePath: string) {
  const raw = await readFile(filePath, "utf8").catch((error) => {
    if (isFileNotFound(error)) return null;
    throw error;
  });
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { schemaVersion?: unknown; lastEntryName?: unknown };
    if (parsed.schemaVersion !== 1 || (parsed.lastEntryName !== null && typeof parsed.lastEntryName !== "string")) {
      return null;
    }
    return { lastEntryName: parsed.lastEntryName ?? null };
  } catch {
    return null;
  }
}

async function syncDirectory(directoryPath: string) {
  try {
    const handle = await open(directoryPath, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Some filesystems do not permit syncing directories; atomic rename remains the boundary.
  }
}

async function readLifecycleOperationFile(filePath: string): Promise<StoredLifecycleOperation> {
  const raw = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  if (raw.schemaVersion === 1) {
    return migrateLifecycleOperation(raw as Partial<StoredLifecycleOperation>);
  }
  const parsed = raw as Partial<StoredLifecycleOperation>;
  if (parsed.schemaVersion !== LIFECYCLE_OPERATION_SCHEMA_VERSION || !isLifecycleOperationRecord(parsed)) {
    throw new Error("Lifecycle operation data is invalid.");
  }
  return parsed;
}

function migrateLifecycleOperation(parsed: Partial<StoredLifecycleOperation>): StoredLifecycleOperation {
  if (
    typeof parsed.operationId !== "string" ||
    typeof parsed.idempotencyKey !== "string" ||
    !isLifecycleOperationKind(parsed.kind) ||
    typeof parsed.targetId !== "string" ||
    !isLifecycleOperationState(parsed.state) ||
    !isLifecycleOperationStage(parsed.stage)
  ) {
    throw new Error("Lifecycle operation data is invalid.");
  }

  return {
    schemaVersion: LIFECYCLE_OPERATION_SCHEMA_VERSION,
    operationId: parsed.operationId,
    idempotencyKey: parsed.idempotencyKey,
    kind: parsed.kind,
    targetId: parsed.targetId,
    state: parsed.state,
    stage: parsed.stage,
    revision: 1,
    recoveryGeneration: 0,
    mutationAttemptCount: 0,
    createdAt: parsed.createdAt ?? new Date(0).toISOString(),
    updatedAt: parsed.updatedAt ?? parsed.createdAt ?? new Date(0).toISOString(),
    lastReconciledAt: null,
    lastMutationAt: null,
    lastConfirmedNativeStateAt: null,
    nativeAccepted: parsed.nativeAccepted === true,
    nativeConfirmed: parsed.nativeConfirmed === true,
    sidecarSynchronized: parsed.sidecarSynchronized === true,
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.filter((value): value is string => typeof value === "string") : [],
    error: parsed.error ?? null,
    result: parsed.result ?? null,
    metadata: parsed.metadata ?? {},
    items: parsed.items ?? {},
    sidecars: {}
  };
}

function isLifecycleOperationRecord(value: Partial<StoredLifecycleOperation>): value is StoredLifecycleOperation {
  return typeof value.operationId === "string"
    && typeof value.idempotencyKey === "string"
    && isLifecycleOperationKind(value.kind)
    && typeof value.targetId === "string"
    && typeof value.revision === "number"
    && value.revision > 0
    && typeof value.recoveryGeneration === "number"
    && value.recoveryGeneration >= 0
    && typeof value.mutationAttemptCount === "number"
    && value.mutationAttemptCount >= 0
    && isLifecycleOperationState(value.state)
    && isLifecycleOperationStage(value.stage)
    && typeof value.createdAt === "string"
    && typeof value.updatedAt === "string"
    && Array.isArray(value.warnings)
    && value.items !== null
    && typeof value.items === "object"
    && value.sidecars !== null
    && typeof value.sidecars === "object";
}

function isLifecycleOperationKind(value: unknown): value is LifecycleOperationKind {
  return value === "agent.create" || value === "agent.delete" || value === "workspace.delete" || value === "workspace.move";
}

function isLifecycleOperationState(value: unknown): value is LifecycleOperationState {
  return value === "requested" || value === "running" || value === "ready" || value === "partial" || value === "failed" || value === "unknown";
}

function isLifecycleOperationStage(value: unknown): value is LifecycleOperationStage {
  return typeof value === "string" && [
    "requested",
    "reading-native-state",
    "recovering",
    "validating",
    "creating-native-agent",
    "native-mutation",
    "syncing-profile-config",
    "binding-channels",
    "deleting-agents",
    "disconnecting-bindings",
    "reconciling-native-state",
    "native-removal-confirmed",
    "moving-filesystem",
    "syncing-workspace-config",
    "workspace-move-confirmed",
    "sidecar-sync",
    "filesystem-cleanup",
    "cleanup-partial",
    "complete"
  ].includes(value);
}

function retentionForState(state: LifecycleOperationState) {
  if (state === "ready") return LIFECYCLE_OPERATION_RETENTION_MS.ready;
  if (state === "failed") return LIFECYCLE_OPERATION_RETENTION_MS.failed;
  if (state === "partial") return LIFECYCLE_OPERATION_RETENTION_MS.partial;
  return null;
}

function isFileNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isFileExists(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
