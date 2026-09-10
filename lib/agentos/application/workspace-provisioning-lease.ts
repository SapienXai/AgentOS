import "server-only";

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { writeAtomicJson } from "@/lib/agentos/application/workspace-provisioning-store";

const execFileAsync = promisify(execFile);
export const PROVISIONING_LEASE_SCHEMA_VERSION = 1 as const;
export const PROVISIONING_LEASE_HEARTBEAT_MS = 5_000;
export const PROVISIONING_LEASE_STALE_AFTER_MS = 30_000;
const LEASE_WAIT_MS = 2_000;

export type ProvisioningLeaseRecord = {
  schemaVersion: typeof PROVISIONING_LEASE_SCHEMA_VERSION;
  leaseId: string;
  runId: string;
  pid: number;
  hostname: string;
  startedAt: string;
  heartbeatAt: string;
  ownerStartIdentity: string | null;
  attempt: number;
};

export class ProvisioningLeaseBusyError extends Error {
  constructor(message = "Workspace provisioning is already active in another executor.") {
    super(message);
    this.name = "ProvisioningLeaseBusyError";
  }
}

export class ProvisioningLeaseLostError extends Error {
  constructor() {
    super("Workspace provisioning executor ownership was lost; no further mutations are safe.");
    this.name = "ProvisioningLeaseLostError";
  }
}

export type ProvisioningLeaseHandle = {
  record: ProvisioningLeaseRecord;
  assertOwned: () => Promise<void>;
  release: () => Promise<void>;
};

export type LeaseTestOverrides = {
  hostname?: string;
  pid?: number;
  now?: () => Date;
  processStartIdentity?: (pid: number) => Promise<string | null>;
  isProcessAlive?: (pid: number) => boolean;
  heartbeatMs?: number;
  staleAfterMs?: number;
};

export async function acquireProvisioningLease(input: {
  runFilePath: string;
  runId: string;
  attempt: number;
  overrides?: LeaseTestOverrides;
}): Promise<ProvisioningLeaseHandle | null> {
  const overrides = input.overrides ?? {};
  const leasePath = resolveLeasePath(input.runFilePath);
  await mkdir(path.dirname(leasePath), { recursive: true, mode: 0o700 });
  const now = (overrides.now ?? (() => new Date()))().toISOString();
  const record: ProvisioningLeaseRecord = {
    schemaVersion: PROVISIONING_LEASE_SCHEMA_VERSION,
    leaseId: randomUUID(),
    runId: input.runId,
    pid: overrides.pid ?? process.pid,
    hostname: overrides.hostname ?? os.hostname(),
    startedAt: now,
    heartbeatAt: now,
    ownerStartIdentity: await (overrides.processStartIdentity ?? processStartIdentity)(overrides.pid ?? process.pid),
    attempt: input.attempt
  };

  for (;;) {
    try {
      const handle = await open(leasePath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      return createLeaseHandle(leasePath, record, overrides);
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
      const existing = await readLease(leasePath);
      if (!existing) continue;
      if (await isProvisioningLeaseLive(existing, overrides)) return null;

      const reclaimedPath = `${leasePath}.reclaimed-${randomUUID()}`;
      try {
        await withLeaseMutationLock(leasePath, async () => {
          const current = await readLease(leasePath);
          if (!current || await isProvisioningLeaseLive(current, overrides)) return;
          await rename(leasePath, reclaimedPath);
          await rm(reclaimedPath, { force: true });
        });
      } catch (reclaimError) {
        if (!isNodeError(reclaimError, "ENOENT")) throw reclaimError;
      }
      await delay(10);
    }
  }
}

export function resolveLeasePath(runFilePath: string) {
  return `${runFilePath}.lease.json`;
}

async function createLeaseHandle(leasePath: string, record: ProvisioningLeaseRecord, overrides: LeaseTestOverrides): Promise<ProvisioningLeaseHandle> {
  let released = false;
  let lost = false;
  let inFlight: Promise<void> | null = null;
  const heartbeatMs = overrides.heartbeatMs ?? PROVISIONING_LEASE_HEARTBEAT_MS;
  const timer = setInterval(() => {
    if (released || lost || inFlight) return;
    const refresh = refreshLease(leasePath, record, overrides);
    inFlight = refresh;
    void refresh.then(
      () => { if (inFlight === refresh) inFlight = null; },
      () => { lost = true; if (inFlight === refresh) inFlight = null; }
    );
  }, heartbeatMs);
  timer.unref?.();

  return {
    record,
    assertOwned: async () => {
      if (released || lost) throw new ProvisioningLeaseLostError();
      const current = await readLease(leasePath);
      if (!current || current.leaseId !== record.leaseId) {
        lost = true;
        throw new ProvisioningLeaseLostError();
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
      });
    }
  };
}

async function refreshLease(leasePath: string, record: ProvisioningLeaseRecord, overrides: LeaseTestOverrides) {
  await withLeaseMutationLock(leasePath, async () => {
    const current = await readLease(leasePath);
    if (!current || current.leaseId !== record.leaseId) throw new ProvisioningLeaseLostError();
    record.heartbeatAt = (overrides.now ?? (() => new Date()))().toISOString();
    await writeAtomicJson(leasePath, record);
  });
}

async function withLeaseMutationLock<T>(leasePath: string, operation: () => Promise<T>): Promise<T> {
  const mutationPath = `${leasePath}.mutation`;
  const deadline = Date.now() + LEASE_WAIT_MS;
  for (;;) {
    try {
      const handle = await open(mutationPath, "wx", 0o600);
      await handle.close();
      break;
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) throw error;
      const age = await stat(mutationPath).then((entry) => Date.now() - entry.mtimeMs).catch(() => 0);
      if (age > LEASE_WAIT_MS) {
        await rm(mutationPath, { force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new ProvisioningLeaseBusyError("Workspace provisioning lease mutation is busy.");
      await delay(10);
    }
  }
  try {
    return await operation();
  } finally {
    await rm(mutationPath, { force: true });
  }
}

async function readLease(leasePath: string): Promise<ProvisioningLeaseRecord | null> {
  const raw = await readFile(leasePath, "utf8").catch(() => null);
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new ProvisioningLeaseBusyError("Workspace provisioning lease is malformed; refusing recovery."); }
  if (!isLeaseRecord(parsed)) throw new ProvisioningLeaseBusyError("Workspace provisioning lease is malformed; refusing recovery.");
  return parsed;
}

export async function isProvisioningLeaseLive(record: ProvisioningLeaseRecord, overrides: LeaseTestOverrides = {}) {
  const staleAfterMs = overrides.staleAfterMs ?? PROVISIONING_LEASE_STALE_AFTER_MS;
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

async function processStartIdentity(pid: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("ps", ["-p", String(pid), "-o", "lstart="], { timeout: 3_000, maxBuffer: 16 * 1024 });
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

function isLeaseRecord(value: unknown): value is ProvisioningLeaseRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.schemaVersion === PROVISIONING_LEASE_SCHEMA_VERSION
    && typeof candidate.leaseId === "string"
    && typeof candidate.runId === "string"
    && typeof candidate.pid === "number"
    && candidate.pid > 0
    && typeof candidate.hostname === "string"
    && typeof candidate.startedAt === "string"
    && Number.isFinite(Date.parse(candidate.startedAt))
    && typeof candidate.heartbeatAt === "string"
    && Number.isFinite(Date.parse(candidate.heartbeatAt))
    && (candidate.ownerStartIdentity === null || typeof candidate.ownerStartIdentity === "string")
    && typeof candidate.attempt === "number";
}

function isNodeError(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
