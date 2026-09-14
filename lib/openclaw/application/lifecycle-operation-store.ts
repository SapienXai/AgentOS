import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";

import { missionControlRootPath } from "@/lib/openclaw/state/paths";

export const LIFECYCLE_OPERATION_SCHEMA_VERSION = 1 as const;
export const LIFECYCLE_OPERATION_ROOT = path.join(missionControlRootPath, "lifecycle-operations");

export type LifecycleOperationKind = "agent.create" | "agent.delete" | "workspace.delete";
export type LifecycleOperationState = "requested" | "running" | "ready" | "partial" | "failed" | "unknown";
export type LifecycleOperationStage =
  | "requested"
  | "reading-native-state"
  | "validating"
  | "creating-native-agent"
  | "native-mutation"
  | "syncing-profile-config"
  | "binding-channels"
  | "deleting-agents"
  | "disconnecting-bindings"
  | "reconciling-native-state"
  | "native-removal-confirmed"
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
  createdAt: string;
  updatedAt: string;
  nativeAccepted: boolean;
  nativeConfirmed: boolean;
  sidecarSynchronized: boolean;
  warnings: string[];
  error: { code: string; message: string } | null;
  result: unknown;
  metadata: {
    workspaceId?: string | null;
    workspacePath?: string | null;
    agentIds?: string[];
    channelIds?: string[];
  };
  items: Record<string, LifecycleOperationItemState>;
};

export type LifecycleOperationPatch = Partial<Pick<
  StoredLifecycleOperation,
  "state" | "stage" | "nativeAccepted" | "nativeConfirmed" | "sidecarSynchronized" | "warnings" | "error" | "result" | "metadata" | "items"
>>;

const inProcessLifecycleOperationLocks = new Map<string, Promise<void>>();

function storageKey(kind: LifecycleOperationKind, targetId: string) {
  return `${kind}:${targetId.trim()}`;
}

/**
 * Serializes same-target lifecycle work within the AgentOS process. The
 * durable operation record remains the recovery source after a process crash;
 * this lock prevents concurrent HTTP retries from issuing duplicate native
 * mutations while the original request is still active.
 */
export async function withLifecycleOperationLock<T>(input: {
  kind: LifecycleOperationKind;
  targetId: string;
  rootPath?: string;
  run: () => Promise<T>;
}) {
  const targetId = input.targetId.trim();
  if (!targetId) {
    throw new Error("Lifecycle operation target is required.");
  }

  const key = `${path.resolve(input.rootPath ?? LIFECYCLE_OPERATION_ROOT)}:${storageKey(input.kind, targetId)}`;
  const previous = inProcessLifecycleOperationLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  inProcessLifecycleOperationLocks.set(key, current);

  await previous;
  try {
    return await input.run();
  } finally {
    release();
    if (inProcessLifecycleOperationLocks.get(key) === current) {
      inProcessLifecycleOperationLocks.delete(key);
    }
  }
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
    state: "requested",
    stage: "requested",
    createdAt: now,
    updatedAt: now,
    nativeAccepted: false,
    nativeConfirmed: false,
    sidecarSynchronized: false,
    warnings: [],
    error: null,
    result: null,
    metadata: input.metadata ?? {},
    items: {}
  };

  try {
    const handle = await open(filePath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(operation, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
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
  const next: StoredLifecycleOperation = {
    ...operation,
    ...patch,
    metadata: patch.metadata ? { ...operation.metadata, ...patch.metadata } : operation.metadata,
    warnings: patch.warnings ? [...new Set(patch.warnings.filter(Boolean))] : operation.warnings,
    items: patch.items ? { ...operation.items, ...patch.items } : operation.items,
    updatedAt: new Date().toISOString()
  };
  await writeLifecycleOperation(next, rootPath);
  return next;
}

export async function readLifecycleOperation(
  kind: LifecycleOperationKind,
  targetId: string,
  rootPath = LIFECYCLE_OPERATION_ROOT
) {
  return readLifecycleOperationFile(filePathForKey(storageKey(kind, targetId), rootPath));
}

async function writeLifecycleOperation(operation: StoredLifecycleOperation, rootPath: string) {
  const resolvedRoot = path.resolve(rootPath);
  await mkdir(resolvedRoot, { recursive: true, mode: 0o700 });
  const filePath = filePathForKey(operation.idempotencyKey, resolvedRoot);
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "w", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(operation, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, filePath);
}

async function readLifecycleOperationFile(filePath: string) {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<StoredLifecycleOperation>;
  if (parsed.schemaVersion !== LIFECYCLE_OPERATION_SCHEMA_VERSION || typeof parsed.operationId !== "string" || typeof parsed.kind !== "string" || typeof parsed.targetId !== "string") {
    throw new Error("Lifecycle operation data is invalid.");
  }
  return parsed as StoredLifecycleOperation;
}

function isFileNotFound(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isFileExists(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
