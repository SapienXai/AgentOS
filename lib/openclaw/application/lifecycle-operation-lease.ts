import "server-only";

import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { missionControlRootPath } from "@/lib/openclaw/state/paths";

const execFileAsync = promisify(execFile);

export const LIFECYCLE_OPERATION_LEASE_SCHEMA_VERSION = 1 as const;
export const LIFECYCLE_OPERATION_STORAGE_ROOT = path.join(missionControlRootPath, "lifecycle-operations");
export const LIFECYCLE_OPERATION_LEASE_ROOT = path.join(LIFECYCLE_OPERATION_STORAGE_ROOT, "leases");
export const LIFECYCLE_OPERATION_LEASE_HEARTBEAT_MS = 5_000;
export const LIFECYCLE_OPERATION_LEASE_STALE_AFTER_MS = 30_000;

const LEASE_MUTATION_WAIT_MS = 2_000;

export type LifecycleOperationLeaseRecord = {
  schemaVersion: typeof LIFECYCLE_OPERATION_LEASE_SCHEMA_VERSION;
  leaseId: string;
  resourceKey: string;
  pid: number;
  hostname: string;
  startedAt: string;
  heartbeatAt: string;
  ownerStartIdentity: string | null;
};

export type LifecycleOperationLeaseTestOverrides = {
  hostname?: string;
  pid?: number;
  now?: () => Date;
  processStartIdentity?: (pid: number) => Promise<string | null>;
  isProcessAlive?: (pid: number) => boolean;
  heartbeatMs?: number;
  staleAfterMs?: number;
};

export class LifecycleOperationBusyError extends Error {
  readonly code = "lifecycle-operation-busy";

  constructor(message = "A conflicting lifecycle operation is already active for this target.") {
    super(message);
    this.name = "LifecycleOperationBusyError";
  }
}

export class LifecycleOperationLeaseLostError extends Error {
  readonly code = "lifecycle-operation-lease-lost";

  constructor() {
    super("Lifecycle operation ownership was lost; no further mutations are safe.");
    this.name = "LifecycleOperationLeaseLostError";
  }
}

export type LifecycleOperationLeaseHandle = {
  record: LifecycleOperationLeaseRecord;
  assertOwned: () => Promise<void>;
  release: () => Promise<void>;
};

export function lifecycleOperationLeasePath(
  resourceKey: string,
  rootPath = LIFECYCLE_OPERATION_STORAGE_ROOT
) {
  const digest = createHash("sha256").update(resourceKey.trim()).digest("hex");
  return path.join(path.resolve(rootPath), "leases", `${digest}.lease.json`);
}

export async function acquireLifecycleOperationLease(input: {
  resourceKey: string;
  rootPath?: string;
  waitMs?: number;
  overrides?: LifecycleOperationLeaseTestOverrides;
}): Promise<LifecycleOperationLeaseHandle | null> {
  const resourceKey = input.resourceKey.trim();
  if (!resourceKey) {
    throw new Error("Lifecycle operation lease resource is required.");
  }

  const overrides = input.overrides ?? {};
  const leasePath = lifecycleOperationLeasePath(resourceKey, input.rootPath);
  await mkdir(path.dirname(leasePath), { recursive: true, mode: 0o700 });
  const now = (overrides.now ?? (() => new Date()))().toISOString();
  const record: LifecycleOperationLeaseRecord = {
    schemaVersion: LIFECYCLE_OPERATION_LEASE_SCHEMA_VERSION,
    leaseId: randomUUID(),
    resourceKey,
    pid: overrides.pid ?? process.pid,
    hostname: overrides.hostname ?? os.hostname(),
    startedAt: now,
    heartbeatAt: now,
    ownerStartIdentity: await (overrides.processStartIdentity ?? processStartIdentity)(overrides.pid ?? process.pid)
  };
  const deadline = Date.now() + Math.max(0, input.waitMs ?? 0);

  for (;;) {
    try {
      const handle = await open(leasePath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await syncDirectory(path.dirname(leasePath));
      return createLeaseHandle(leasePath, record, overrides);
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
      const existing = await readLease(leasePath);
      if (!existing) continue;
      if (await isLifecycleOperationLeaseLive(existing, overrides)) {
        if (Date.now() >= deadline) return null;
        await delay(Math.min(25, Math.max(1, deadline - Date.now())));
        continue;
      }

      const reclaimedPath = `${leasePath}.reclaimed-${randomUUID()}`;
      try {
        await withLeaseMutationLock(leasePath, async () => {
          const current = await readLease(leasePath);
          if (!current || await isLifecycleOperationLeaseLive(current, overrides)) return;
          await rename(leasePath, reclaimedPath);
          await rm(reclaimedPath, { force: true });
          await syncDirectory(path.dirname(leasePath));
        });
      } catch (reclaimError) {
        if (!isNodeError(reclaimError, "ENOENT")) throw reclaimError;
      }
    }
  }
}

export async function acquireLifecycleOperationLeases(input: {
  resourceKeys: string[];
  rootPath?: string;
  waitMs?: number;
  overrides?: LifecycleOperationLeaseTestOverrides;
}) {
  const resourceKeys = [...new Set(input.resourceKeys.map((key) => key.trim()).filter(Boolean))].sort();
  const handles: LifecycleOperationLeaseHandle[] = [];

  try {
    for (const resourceKey of resourceKeys) {
      const handle = await acquireLifecycleOperationLease({
        resourceKey,
        rootPath: input.rootPath,
        waitMs: input.waitMs,
        overrides: input.overrides
      });
      if (!handle) {
        await Promise.all(handles.reverse().map((entry) => entry.release().catch(() => undefined)));
        return null;
      }
      handles.push(handle);
    }
    return handles;
  } catch (error) {
    await Promise.all(handles.reverse().map((entry) => entry.release().catch(() => undefined)));
    throw error;
  }
}

export async function isLifecycleOperationResourceLeased(
  resourceKey: string,
  rootPath = LIFECYCLE_OPERATION_STORAGE_ROOT,
  overrides: LifecycleOperationLeaseTestOverrides = {}
) {
  const leasePath = lifecycleOperationLeasePath(resourceKey, rootPath);
  const raw = await readFile(leasePath, "utf8").catch((error) => {
    if (isNodeError(error, "ENOENT")) return null;
    throw error;
  });
  if (!raw) return false;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return true;
  }
  if (!isLeaseRecord(parsed)) return true;
  return isLifecycleOperationLeaseLive(parsed, overrides);
}

export async function isLifecycleOperationLeaseLive(
  record: LifecycleOperationLeaseRecord,
  overrides: LifecycleOperationLeaseTestOverrides = {}
) {
  const staleAfterMs = overrides.staleAfterMs ?? LIFECYCLE_OPERATION_LEASE_STALE_AFTER_MS;
  if (record.hostname !== (overrides.hostname ?? os.hostname())) {
    const heartbeat = Date.parse(record.heartbeatAt);
    return Number.isFinite(heartbeat) && Date.now() - heartbeat <= staleAfterMs;
  }

  const alive = (overrides.isProcessAlive ?? isProcessAlive)(record.pid);
  if (!alive) return false;
  const identity = await (overrides.processStartIdentity ?? processStartIdentity)(record.pid);
  if (record.ownerStartIdentity && identity) return record.ownerStartIdentity === identity;
  if (record.ownerStartIdentity && !identity) return true;
  return true;
}

async function createLeaseHandle(
  leasePath: string,
  record: LifecycleOperationLeaseRecord,
  overrides: LifecycleOperationLeaseTestOverrides
): Promise<LifecycleOperationLeaseHandle> {
  let released = false;
  let lost = false;
  let inFlight: Promise<void> | null = null;
  const heartbeatMs = overrides.heartbeatMs ?? LIFECYCLE_OPERATION_LEASE_HEARTBEAT_MS;
  const timer = setInterval(() => {
    if (released || lost || inFlight) return;
    const refresh = refreshLease(leasePath, record, overrides);
    inFlight = refresh;
    void refresh.then(
      () => {
        if (inFlight === refresh) inFlight = null;
      },
      () => {
        lost = true;
        if (inFlight === refresh) inFlight = null;
      }
    );
  }, heartbeatMs);
  timer.unref?.();

  return {
    record,
    assertOwned: async () => {
      if (released || lost) throw new LifecycleOperationLeaseLostError();
      const current = await readLease(leasePath);
      if (!current || current.leaseId !== record.leaseId) {
        lost = true;
        throw new LifecycleOperationLeaseLostError();
      }
    },
    release: async () => {
      if (released) return;
      released = true;
      clearInterval(timer);
      if (inFlight) await inFlight.catch(() => undefined);
      await withLeaseMutationLock(leasePath, async () => {
        const current = await readLease(leasePath);
        if (!current || current.leaseId !== record.leaseId) return;
        await rm(leasePath, { force: true });
        await syncDirectory(path.dirname(leasePath));
      });
    }
  };
}

async function refreshLease(
  leasePath: string,
  record: LifecycleOperationLeaseRecord,
  overrides: LifecycleOperationLeaseTestOverrides
) {
  await withLeaseMutationLock(leasePath, async () => {
    const current = await readLease(leasePath);
    if (!current || current.leaseId !== record.leaseId) throw new LifecycleOperationLeaseLostError();
    record.heartbeatAt = (overrides.now ?? (() => new Date()))().toISOString();
    await writeAtomicJson(leasePath, record);
  });
}

async function withLeaseMutationLock<T>(leasePath: string, operation: () => Promise<T>) {
  const mutationPath = `${leasePath}.mutation`;
  const deadline = Date.now() + LEASE_MUTATION_WAIT_MS;

  for (;;) {
    try {
      const handle = await open(mutationPath, "wx", 0o600);
      await handle.close();
      break;
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
      const age = await stat(mutationPath).then((entry) => Date.now() - entry.mtimeMs).catch(() => 0);
      if (age > LEASE_MUTATION_WAIT_MS) {
        await rm(mutationPath, { force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new LifecycleOperationBusyError("Lifecycle operation lease mutation is busy.");
      await delay(10);
    }
  }

  try {
    return await operation();
  } finally {
    await rm(mutationPath, { force: true });
  }
}

async function readLease(leasePath: string): Promise<LifecycleOperationLeaseRecord | null> {
  const raw = await readFile(leasePath, "utf8").catch((error) => {
    if (isNodeError(error, "ENOENT")) return null;
    throw error;
  });
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new LifecycleOperationBusyError("Lifecycle operation lease is malformed; refusing recovery.");
  }
  if (!isLeaseRecord(parsed)) {
    throw new LifecycleOperationBusyError("Lifecycle operation lease is invalid; refusing recovery.");
  }
  return parsed;
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

async function syncDirectory(directoryPath: string) {
  try {
    const handle = await open(directoryPath, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Some filesystems do not permit syncing a directory. The atomic rename
    // remains the durability boundary in that environment.
  }
}

async function processStartIdentity(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "lstart="], {
      timeout: 3_000,
      maxBuffer: 16 * 1024
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error, "EPERM");
  }
}

function isLeaseRecord(value: unknown): value is LifecycleOperationLeaseRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === LIFECYCLE_OPERATION_LEASE_SCHEMA_VERSION
    && typeof candidate.leaseId === "string"
    && typeof candidate.resourceKey === "string"
    && typeof candidate.pid === "number"
    && candidate.pid > 0
    && typeof candidate.hostname === "string"
    && typeof candidate.startedAt === "string"
    && Number.isFinite(Date.parse(candidate.startedAt))
    && typeof candidate.heartbeatAt === "string"
    && Number.isFinite(Date.parse(candidate.heartbeatAt))
    && (candidate.ownerStartIdentity === null || typeof candidate.ownerStartIdentity === "string");
}

function isNodeError(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
