import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveAgentOsRuntimeDir } from "@/lib/agentos/runtime-auth";
import type {
  AgentOsNativeUpdateCheck,
  AgentOsProductUpdateReceipt
} from "@/lib/agentos/domains/product-update";

const UPDATE_DIRECTORY = "updates";
const OPERATIONS_DIRECTORY = "operations";
const REQUESTS_DIRECTORY = "requests";
const PREPARE_LOCK = ".prepare-admission.lock";
const ACTIVE_POINTER = "active.json";
const NATIVE_CHECK = "native-check.json";
const DISCOVERY_CACHE = "discovery-cache.json";
const ACTIVE_STATES = new Set(["requested", "running", "restart-required", "verifying", "unknown"]);

export class AgentOsProductUpdateStoreError extends Error {
  constructor(message: string, readonly code: "conflict" | "replay" | "invalid" | "unavailable" | "unsupported") {
    super(message);
    this.name = "AgentOsProductUpdateStoreError";
  }
}

export type ProductUpdateDiscoveryCache = {
  schemaVersion: 1;
  cacheKey: string;
  sourceId: string;
  currentVersion: string;
  latestVersion: string;
  releaseUrl: string | null;
  cliAssetAvailable: boolean | null;
  checkedAt: string;
};

export function resolveAgentOsProductUpdatesDir(env: NodeJS.ProcessEnv = process.env) {
  return path.join(resolveAgentOsRuntimeDir(env), UPDATE_DIRECTORY);
}

export async function readNativeAgentOsUpdateCheck(env: NodeJS.ProcessEnv = process.env): Promise<AgentOsNativeUpdateCheck | null> {
  const candidate = await readJsonFile(path.join(resolveAgentOsProductUpdatesDir(env), NATIVE_CHECK));
  if (!isNativeCheck(candidate)) return null;
  return candidate;
}

export async function readProductUpdateDiscoveryCache(env: NodeJS.ProcessEnv = process.env): Promise<ProductUpdateDiscoveryCache | null> {
  const candidate = await readJsonFile(path.join(resolveAgentOsProductUpdatesDir(env), DISCOVERY_CACHE));
  if (!isDiscoveryCache(candidate)) return null;
  return candidate;
}

export async function writeProductUpdateDiscoveryCache(
  cache: ProductUpdateDiscoveryCache,
  env: NodeJS.ProcessEnv = process.env
) {
  await writePrivateJson(path.join(resolveAgentOsProductUpdatesDir(env), DISCOVERY_CACHE), cache);
}

export async function readCurrentAgentOsUpdateReceipt(env: NodeJS.ProcessEnv = process.env): Promise<AgentOsProductUpdateReceipt | null> {
  const root = resolveAgentOsProductUpdatesDir(env);
  const pointer = await readJsonFile(path.join(root, ACTIVE_POINTER));
  const operationId = pointer && typeof pointer === "object"
    ? (pointer as { operationId?: unknown }).operationId
    : null;
  if (!isUuid(operationId)) return null;
  const candidate = await readJsonFile(path.join(root, OPERATIONS_DIRECTORY, `${operationId}.json`));
  return isProductUpdateReceipt(candidate) ? candidate : null;
}

export async function prepareAgentOsUpdateReceipt(
  receipt: AgentOsProductUpdateReceipt,
  env: NodeJS.ProcessEnv = process.env
) {
  if (!isUuid(receipt.operationId) || !isUuid(receipt.requestId)) {
    throw new AgentOsProductUpdateStoreError("The update request is invalid.", "invalid");
  }
  const root = resolveAgentOsProductUpdatesDir(env);
  await ensurePrivateDirectory(root);
  await ensurePrivateDirectory(path.join(root, OPERATIONS_DIRECTORY));
  await ensurePrivateDirectory(path.join(root, REQUESTS_DIRECTORY));

  return withPrepareLock(root, async () => {
    const active = await readCurrentAgentOsUpdateReceipt(env);
    if (active && ACTIVE_STATES.has(active.state)) {
      throw new AgentOsProductUpdateStoreError("Another AgentOS update operation is still active or needs review.", "conflict");
    }

    const requestMarker = path.join(root, REQUESTS_DIRECTORY, `${receipt.requestId}.json`);
    let marker: Awaited<ReturnType<typeof open>> | null = null;
    try {
      marker = await open(requestMarker, "wx", 0o600);
      await marker.writeFile(`${JSON.stringify({ operationId: receipt.operationId, createdAt: receipt.createdAt })}\n`, "utf8");
      await marker.sync();
    } catch (error) {
      await marker?.close().catch(() => {});
      if (marker) await rm(requestMarker, { force: true }).catch(() => {});
      if (isAlreadyExists(error)) throw new AgentOsProductUpdateStoreError("This update request has already been used.", "replay");
      throw new AgentOsProductUpdateStoreError("The update request could not be persisted.", "unavailable");
    } finally {
      await marker?.close().catch(() => {});
    }

    const operationPath = path.join(root, OPERATIONS_DIRECTORY, `${receipt.operationId}.json`);
    try {
      await writePrivateJson(operationPath, receipt);
      await atomicWriteJson(path.join(root, ACTIVE_POINTER), { schemaVersion: 1, operationId: receipt.operationId });
    } catch {
      await rm(requestMarker, { force: true }).catch(() => {});
      await rm(operationPath, { force: true }).catch(() => {});
      throw new AgentOsProductUpdateStoreError("The AgentOS update preparation could not be persisted.", "unavailable");
    }
    return receipt;
  });
}

export async function writeAgentOsUpdateReceipt(
  receipt: AgentOsProductUpdateReceipt,
  env: NodeJS.ProcessEnv = process.env
) {
  if (!isUuid(receipt.operationId)) throw new AgentOsProductUpdateStoreError("The update receipt is invalid.", "invalid");
  const filePath = path.join(resolveAgentOsProductUpdatesDir(env), OPERATIONS_DIRECTORY, `${receipt.operationId}.json`);
  await writePrivateJson(filePath, receipt);
  return receipt;
}

export async function isAgentOsUpdateOperationActive(env: NodeJS.ProcessEnv = process.env) {
  const receipt = await readCurrentAgentOsUpdateReceipt(env);
  return Boolean(receipt && ACTIVE_STATES.has(receipt.state));
}

async function withPrepareLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = path.join(root, PREPARE_LOCK);
  let lock;
  try {
    lock = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (isAlreadyExists(error) && await clearStaleLock(lockPath)) {
      try {
        lock = await open(lockPath, "wx", 0o600);
      } catch {
        // Another process acquired the lock while this process checked it.
      }
    }
    if (!lock) throw new AgentOsProductUpdateStoreError("Another update preparation is in progress.", "conflict");
  }

  try {
    await lock.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: Date.now() })}\n`, "utf8");
    await lock.sync();
    return await operation();
  } finally {
    await lock.close().catch(() => {});
    await rm(lockPath, { force: true }).catch(() => {});
  }
}

async function clearStaleLock(lockPath: string) {
  try {
    const info = await lstat(lockPath);
    if (!info.isFile() || info.isSymbolicLink()) return false;
    const payload = JSON.parse(await readFile(lockPath, "utf8")) as { pid?: unknown; createdAt?: unknown };
    if (typeof payload.pid !== "number" || !Number.isInteger(payload.pid) || typeof payload.createdAt !== "number") return false;
    let alive = true;
    try { process.kill(payload.pid, 0); }
    catch (error) { alive = !(error && typeof error === "object" && "code" in error && error.code === "ESRCH"); }
    if (alive || Date.now() - payload.createdAt < 30_000) return false;
    await rm(lockPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    await ensurePrivateDirectory(path.dirname(filePath));
    const info = await lstat(filePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) return null;
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isMissing(error)) return null;
    return null;
  }
}

async function writePrivateJson(filePath: string, value: unknown) {
  const directory = path.dirname(filePath);
  await ensurePrivateDirectory(directory);
  try {
    const existing = await lstat(filePath);
    if (!existing.isFile() || existing.isSymbolicLink()) throw new Error("unsafe file");
  } catch (error) {
    if (!isMissing(error)) throw new AgentOsProductUpdateStoreError("Update storage is not safe to use.", "unavailable");
  }
  await atomicWriteJson(filePath, value);
}

async function atomicWriteJson(filePath: string, value: unknown) {
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await chmod(tempPath, 0o600).catch(() => {});
    await rename(tempPath, filePath);
    await chmod(filePath, 0o600).catch(() => {});
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function ensurePrivateDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new AgentOsProductUpdateStoreError("Update storage is not safe to use.", "unavailable");
  await chmod(directory, 0o700).catch(() => {});
}

function isNativeCheck(value: unknown): value is AgentOsNativeUpdateCheck {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<AgentOsNativeUpdateCheck>;
  return item.schemaVersion === 1 && isUuid(item.checkId) && isUuid(item.launchId) &&
    typeof item.currentVersion === "string" && (item.latestVersion === null || typeof item.latestVersion === "string") &&
    typeof item.updateAvailable === "boolean" && (item.releaseIdentity === null || (typeof item.releaseIdentity === "string" && /^[a-f0-9]{64}$/.test(item.releaseIdentity))) &&
    typeof item.checkedAt === "string" && ["available", "up-to-date", "unavailable"].includes(item.status ?? "") &&
    (item.error === null || typeof item.error === "string");
}

function isProductUpdateReceipt(value: unknown): value is AgentOsProductUpdateReceipt {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<AgentOsProductUpdateReceipt>;
  return item.schemaVersion === 1 && isUuid(item.operationId) && isUuid(item.requestId) &&
    typeof item.actorId === "string" && typeof item.authenticationMethod === "string" && item.owner === "desktop" &&
    isUuid(item.launchId) && typeof item.currentVersion === "string" && typeof item.targetVersion === "string" &&
    isUuid(item.nativeCheckId) && /^[a-f0-9]{64}$/.test(item.releaseIdentity ?? "") &&
    ["requested", "running", "restart-required", "verifying", "succeeded", "failed", "unknown"].includes(item.state ?? "") &&
    (item.phase === null || ["checking", "download", "install", "relaunch", "verify"].includes(item.phase ?? "")) &&
    (item.progress === null || (typeof item.progress === "number" && Number.isFinite(item.progress) && item.progress >= 0 && item.progress <= 100)) &&
    typeof item.createdAt === "string" && typeof item.updatedAt === "string" && typeof item.expiresAt === "string" &&
    (item.failure === null || typeof item.failure === "string") && (item.newLaunchId === null || isUuid(item.newLaunchId)) &&
    (item.nativeVersion === null || typeof item.nativeVersion === "string") && (item.serverVersion === null || typeof item.serverVersion === "string") &&
    ["pending", "verified", "mismatch", "unknown"].includes(item.verification ?? "");
}

function isDiscoveryCache(value: unknown): value is ProductUpdateDiscoveryCache {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ProductUpdateDiscoveryCache>;
  return item.schemaVersion === 1 && typeof item.cacheKey === "string" && typeof item.sourceId === "string" &&
    typeof item.currentVersion === "string" && typeof item.latestVersion === "string" &&
    (item.releaseUrl === null || typeof item.releaseUrl === "string") &&
    (item.cliAssetAvailable === null || typeof item.cliAssetAvailable === "boolean") && typeof item.checkedAt === "string";
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isMissing(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isAlreadyExists(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}
