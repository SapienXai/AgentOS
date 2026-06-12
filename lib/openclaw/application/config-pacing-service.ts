import "server-only";

import { existsSync, readFileSync, rmSync } from "node:fs";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CommandResult } from "@/lib/openclaw/cli";
import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import type { OpenClawCommandOptions } from "@/lib/openclaw/client/gateway-client";
import {
  isGatewayConfigRateLimitError,
  readGatewayConfigRateLimitRetryAfterMs
} from "@/lib/openclaw/client/native-ws-gateway-config";
import {
  getEffectiveConfigUpdatePacing,
  readMissionControlSettings,
  type ConfigUpdatePacingSettings
} from "@/lib/openclaw/domains/control-plane-settings";
import type { ConfigUpdatePacingSnapshot } from "@/lib/openclaw/config-pacing-types";

type ConfigMutationOperation = "set" | "unset";
type ConfigMutationOptions = OpenClawCommandOptions & { strictJson?: boolean };

type QueuedConfigMutation = {
  key: string;
  path: string;
  operation: ConfigMutationOperation;
  value: unknown;
  options: ConfigMutationOptions;
  execute: () => Promise<CommandResult>;
  queuedAt: number;
};

type PersistedQueuedConfigMutation = {
  key: string;
  path: string;
  operation: ConfigMutationOperation;
  value: unknown;
  options?: ConfigMutationOptions;
  queuedAt: number;
};

type PersistedConfigPacingQueue = {
  version: 1;
  gatewayCooldownUntilMs: number;
  localNextAllowedAtMs: number;
  lastIssue: string | null;
  lastUpdatedAtMs: number | null;
  queuedMutations: PersistedQueuedConfigMutation[];
};

const configPacingQueuePath = path.join(process.cwd(), ".mission-control", "config-pacing-queue.json");

const queuedMutations = new Map<string, QueuedConfigMutation>();
let gatewayCooldownUntilMs = 0;
let localNextAllowedAtMs = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let lastIssue: string | null = null;
let lastUpdatedAtMs: number | null = null;
let pacingSettingsForTesting: ConfigUpdatePacingSettings | null = null;
let persistentQueueLoaded = false;

export async function runGatewayConfigMutationWithPacing(input: {
  path: string;
  operation: ConfigMutationOperation;
  value: unknown;
  options?: ConfigMutationOptions;
  execute: () => Promise<CommandResult>;
}) {
  ensurePersistentQueueLoaded();
  const now = Date.now();
  const pacing = await readEffectivePacing();
  const waitUntilMs = resolveWaitUntilMs(now);

  if (waitUntilMs > now) {
    await queueLatestMutation(input, now);
    scheduleQueuedConfigFlush(waitUntilMs - now);
    return buildQueuedConfigMutationResult(input, waitUntilMs, "pending");
  }

  try {
    const result = await input.execute();
    markLocalPacingAfterMutation(pacing);
    return result;
  } catch (error) {
    if (!isGatewayConfigRateLimitError(error)) {
      throw error;
    }

    const retryAfterMs = readGatewayConfigRateLimitRetryAfterMs(error) ?? 60_000;
    const cooldownUntilMs = Date.now() + retryAfterMs;
    gatewayCooldownUntilMs = Math.max(gatewayCooldownUntilMs, cooldownUntilMs);
    lastIssue = readErrorMessage(error);
    lastUpdatedAtMs = Date.now();
    await queueLatestMutation(input, lastUpdatedAtMs);
    scheduleQueuedConfigFlush(resolveWaitDelayMs());

    return buildQueuedConfigMutationResult(input, gatewayCooldownUntilMs, "rate-limited");
  }
}

export async function getConfigUpdatePacingSnapshot(): Promise<ConfigUpdatePacingSnapshot> {
  ensurePersistentQueueLoaded();
  return buildConfigUpdatePacingSnapshot(await readEffectivePacing());
}

export function getConfigUpdatePacingSnapshotForSettings(
  settings: Awaited<ReturnType<typeof readMissionControlSettings>>
): ConfigUpdatePacingSnapshot {
  ensurePersistentQueueLoaded();
  return buildConfigUpdatePacingSnapshot(getEffectiveConfigUpdatePacing(settings));
}

export function resetConfigUpdatePacingForTesting(options: { clearPersistentQueue?: boolean } = {}) {
  queuedMutations.clear();
  gatewayCooldownUntilMs = 0;
  localNextAllowedAtMs = 0;
  flushing = false;
  lastIssue = null;
  lastUpdatedAtMs = null;
  pacingSettingsForTesting = null;
  persistentQueueLoaded = false;

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  if (options.clearPersistentQueue) {
    rmSync(configPacingQueuePath, { force: true });
  }
}

export function setConfigUpdatePacingForTesting(settings: ConfigUpdatePacingSettings | null) {
  pacingSettingsForTesting = settings;
}

function ensurePersistentQueueLoaded() {
  if (persistentQueueLoaded) {
    return;
  }

  persistentQueueLoaded = true;

  if (!existsSync(configPacingQueuePath)) {
    return;
  }

  try {
    const parsed = JSON.parse(readFileSync(configPacingQueuePath, "utf8"));
    const persisted = normalizePersistedConfigPacingQueue(parsed);

    gatewayCooldownUntilMs = persisted.gatewayCooldownUntilMs;
    localNextAllowedAtMs = persisted.localNextAllowedAtMs;
    lastIssue = persisted.lastIssue;
    lastUpdatedAtMs = persisted.lastUpdatedAtMs;
    queuedMutations.clear();

    for (const mutation of persisted.queuedMutations) {
      queuedMutations.set(mutation.key, createQueuedMutationFromPersisted(mutation));
    }

    if (queuedMutations.size > 0) {
      scheduleQueuedConfigFlush(resolveWaitDelayMs());
    }
  } catch {
    queuedMutations.clear();
    gatewayCooldownUntilMs = 0;
    localNextAllowedAtMs = 0;
    lastIssue = "AgentOS could not read the durable config pacing queue. Pending config updates were not restored.";
    lastUpdatedAtMs = Date.now();
  }
}

function createQueuedMutationFromPersisted(input: PersistedQueuedConfigMutation): QueuedConfigMutation {
  const options = input.options ?? {};

  return {
    key: input.key,
    path: input.path,
    operation: input.operation,
    value: input.value,
    options,
    queuedAt: input.queuedAt,
    execute: () => {
      const client = getOpenClawGatewayClient();

      if (input.operation === "unset") {
        return client.unsetConfig(input.path, options);
      }

      return client.setConfig(input.path, input.value, options);
    }
  };
}

async function queueLatestMutation(input: {
  path: string;
  operation: ConfigMutationOperation;
  value: unknown;
  options?: ConfigMutationOptions;
  execute: () => Promise<CommandResult>;
}, queuedAt: number) {
  const key = input.path;
  queuedMutations.set(key, {
    key,
    path: input.path,
    operation: input.operation,
    value: input.value,
    options: input.options ?? {},
    execute: input.execute,
    queuedAt
  });
  lastUpdatedAtMs = queuedAt;
  await persistConfigPacingQueue();
}

async function flushQueuedConfigMutations() {
  ensurePersistentQueueLoaded();

  if (flushing) {
    return;
  }

  const now = Date.now();
  const waitUntilMs = resolveWaitUntilMs(now);
  if (waitUntilMs > now) {
    scheduleQueuedConfigFlush(waitUntilMs - now);
    return;
  }

  const next = queuedMutations.values().next().value as QueuedConfigMutation | undefined;
  if (!next) {
    return;
  }

  flushing = true;

  try {
    const pacing = await readEffectivePacing();
    await next.execute();
    queuedMutations.delete(next.key);
    markLocalPacingAfterMutation(pacing);
    lastIssue = null;
    lastUpdatedAtMs = Date.now();
    await persistConfigPacingQueue();
  } catch (error) {
    if (isGatewayConfigRateLimitError(error)) {
      const retryAfterMs = readGatewayConfigRateLimitRetryAfterMs(error) ?? 60_000;
      gatewayCooldownUntilMs = Math.max(gatewayCooldownUntilMs, Date.now() + retryAfterMs);
      lastIssue = readErrorMessage(error);
      await queueLatestMutation(next, Date.now());
    } else {
      queuedMutations.delete(next.key);
      lastIssue = readErrorMessage(error);
      lastUpdatedAtMs = Date.now();
      await persistConfigPacingQueue();
    }
  } finally {
    flushing = false;
  }

  if (queuedMutations.size > 0) {
    scheduleQueuedConfigFlush(resolveWaitDelayMs());
  }
}

function scheduleQueuedConfigFlush(delayMs: number) {
  if (retryTimer) {
    return;
  }

  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushQueuedConfigMutations();
  }, Math.max(0, delayMs));
  retryTimer.unref?.();
}

function resolveWaitUntilMs(now = Date.now()) {
  const waitUntilMs = Math.max(gatewayCooldownUntilMs, localNextAllowedAtMs);
  return waitUntilMs > now ? waitUntilMs : 0;
}

function resolveWaitDelayMs() {
  const now = Date.now();
  const waitUntilMs = resolveWaitUntilMs(now);
  return waitUntilMs > now ? waitUntilMs - now : 0;
}

function markLocalPacingAfterMutation(pacing: ConfigUpdatePacingSettings) {
  const intervalMs = pacing.minimumIntervalMs ?? 0;

  if (intervalMs <= 0) {
    return;
  }

  localNextAllowedAtMs = Math.max(localNextAllowedAtMs, Date.now() + intervalMs);
}

function buildQueuedConfigMutationResult(
  input: { path: string; operation: ConfigMutationOperation },
  retryAtMs: number,
  reason: "pending" | "rate-limited"
): CommandResult {
  const message = reason === "rate-limited"
    ? "OpenClaw Gateway is rate limiting config updates. AgentOS queued the latest config update and will retry after the Gateway cooldown. CLI fallback is disabled for this operation."
    : "AgentOS queued the latest config update and will retry when config update pacing allows it.";

  return {
    stdout: JSON.stringify({
      ok: true,
      pending: true,
      path: input.path,
      operation: input.operation,
      retryAt: new Date(retryAtMs).toISOString(),
      message
    }),
    stderr: "",
    metadata: {
      pending: true,
      path: input.path,
      operation: input.operation,
      retryAt: new Date(retryAtMs).toISOString(),
      reason
    }
  };
}

function buildConfigUpdatePacingSnapshot(settings: ConfigUpdatePacingSettings): ConfigUpdatePacingSnapshot {
  const now = Date.now();
  const waitUntilMs = resolveWaitUntilMs(now);
  const pendingPaths = Array.from(queuedMutations.keys()).sort();
  const pendingSinceMs = Array.from(queuedMutations.values()).reduce<number | null>((earliest, mutation) => {
    return earliest === null ? mutation.queuedAt : Math.min(earliest, mutation.queuedAt);
  }, null);

  return {
    settings,
    queueDurability: "persistent",
    pending: pendingPaths.length > 0,
    pendingCount: pendingPaths.length,
    pendingPaths,
    pendingSince: pendingSinceMs !== null ? new Date(pendingSinceMs).toISOString() : null,
    cooldownUntil: waitUntilMs > now ? new Date(waitUntilMs).toISOString() : null,
    retryAfterMs: waitUntilMs > now ? waitUntilMs - now : null,
    lastIssue,
    lastUpdatedAt: lastUpdatedAtMs ? new Date(lastUpdatedAtMs).toISOString() : null
  };
}

async function readEffectivePacing() {
  if (pacingSettingsForTesting) {
    return pacingSettingsForTesting;
  }

  return getEffectiveConfigUpdatePacing(await readMissionControlSettings());
}

function readErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error ?? "OpenClaw Gateway config update failed.");
}

async function persistConfigPacingQueue() {
  const payload: PersistedConfigPacingQueue = {
    version: 1,
    gatewayCooldownUntilMs,
    localNextAllowedAtMs,
    lastIssue,
    lastUpdatedAtMs,
    queuedMutations: Array.from(queuedMutations.values()).map((mutation) => ({
      key: mutation.key,
      path: mutation.path,
      operation: mutation.operation,
      value: mutation.value,
      options: sanitizeMutationOptions(mutation.options),
      queuedAt: mutation.queuedAt
    }))
  };
  const directory = path.dirname(configPacingQueuePath);
  const tempPath = `${configPacingQueuePath}.${process.pid}.${Date.now()}.tmp`;

  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(tempPath, 0o600).catch(() => undefined);
  await rename(tempPath, configPacingQueuePath);
  await chmod(configPacingQueuePath, 0o600).catch(() => undefined);
}

function sanitizeMutationOptions(options: ConfigMutationOptions): ConfigMutationOptions | undefined {
  const next: ConfigMutationOptions = {};

  if (typeof options.timeoutMs === "number") {
    next.timeoutMs = options.timeoutMs;
  }

  if (typeof options.strictJson === "boolean") {
    next.strictJson = options.strictJson;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizePersistedConfigPacingQueue(value: unknown): PersistedConfigPacingQueue {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.queuedMutations)) {
    throw new Error("Invalid durable config pacing queue.");
  }

  return {
    version: 1,
    gatewayCooldownUntilMs: readNonNegativeNumber(value.gatewayCooldownUntilMs),
    localNextAllowedAtMs: readNonNegativeNumber(value.localNextAllowedAtMs),
    lastIssue: typeof value.lastIssue === "string" ? value.lastIssue : null,
    lastUpdatedAtMs: readNullableNonNegativeNumber(value.lastUpdatedAtMs),
    queuedMutations: value.queuedMutations.map(normalizePersistedQueuedConfigMutation)
  };
}

function normalizePersistedQueuedConfigMutation(value: unknown): PersistedQueuedConfigMutation {
  if (!isRecord(value)) {
    throw new Error("Invalid durable config pacing queue entry.");
  }

  const pathValue = typeof value.path === "string" ? value.path.trim() : "";
  const operation = value.operation === "unset" ? "unset" : value.operation === "set" ? "set" : null;

  if (!pathValue || !operation) {
    throw new Error("Invalid durable config pacing queue entry.");
  }

  return {
    key: typeof value.key === "string" && value.key.trim() ? value.key : pathValue,
    path: pathValue,
    operation,
    value: value.value,
    options: normalizePersistedMutationOptions(value.options),
    queuedAt: readNonNegativeNumber(value.queuedAt)
  };
}

function normalizePersistedMutationOptions(value: unknown): ConfigMutationOptions | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const options: ConfigMutationOptions = {};

  if (typeof value.timeoutMs === "number" && Number.isFinite(value.timeoutMs) && value.timeoutMs >= 0) {
    options.timeoutMs = value.timeoutMs;
  }

  if (typeof value.strictJson === "boolean") {
    options.strictJson = value.strictJson;
  }

  return Object.keys(options).length > 0 ? options : undefined;
}

function readNonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function readNullableNonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
