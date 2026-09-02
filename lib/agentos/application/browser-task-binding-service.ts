import "server-only";

import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
  activateBrowserAccountTaskSession,
  acquireBrowserAccountLease,
  completeBrowserAccountTaskSession,
  getBrowserAccount,
  recordBrowserAuthenticationVerification,
  releaseBrowserAccountLease,
  renewBrowserAccountLease
} from "@/lib/agentos/application/browser-account-service";
import { getBrowserProvider } from "@/lib/agentos/browser-accounts/provider-registry";
import type { BrowserTaskBindingRecord } from "@/lib/agentos/browser-accounts/types";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { missionControlRootPath } from "@/lib/openclaw/state/paths";

type BrowserTaskBindingRegistry = {
  version: 1;
  bindings: BrowserTaskBindingRecord[];
};

const bindingTtlMs = 10 * 60_000;
const lockWaitMs = 5_000;
const lockStaleMs = 15_000;
let registryRootOverride: string | null = null;

export type BrowserTaskBindingRequest = {
  accountId: string;
  actorUserId: string;
};

export class BrowserTaskBindingError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409,
    readonly code: string
  ) {
    super(message);
  }
}

export async function prepareBrowserTaskBinding(input: {
  request: BrowserTaskBindingRequest;
  workspaceId: string;
  agentId: string;
  dispatchId: string;
  openClawSessionId: string;
}) {
  await recoverExpiredBrowserTaskBindings().catch(() => null);
  const actor = { userId: input.request.actorUserId };
  const account = await getBrowserAccount({
    actor,
    accountId: input.request.accountId,
    workspaceId: input.workspaceId
  });

  if (
    account.connectionStatus !== "connected" ||
    account.verificationSource !== "provider_verified" ||
    !account.lastVerifiedAt
  ) {
    throw new Error("Provider verification is required before assigning this account to an agent task.");
  }

  const lease = await acquireBrowserAccountLease({
    actor,
    accountId: account.id,
    workspaceId: account.workspaceId,
    agentId: input.agentId,
    taskId: input.dispatchId,
    ttlMs: bindingTtlMs
  });
  const provider = getBrowserProvider(account.provider);
  let providerSessionId: string | null = null;
  let profileConfigured = false;

  try {
    const session = await provider.startSession({
      browserProfileId: account.browserProfileId,
      initialUrl: `https://${account.primaryDomain}`
    });
    providerSessionId = session.sessionId;
    const authentication = await provider.verifyAuthentication({
      sessionId: session.sessionId,
      allowedDomains: account.allowedDomains
    });
    await recordBrowserAuthenticationVerification({
      actor,
      accountId: account.id,
      workspaceId: account.workspaceId,
      status: authentication.status,
      verifiedAt: authentication.verifiedAt
    });
    if (
      authentication.status === "expired" ||
      authentication.status === "unverified" ||
      authentication.status === "needs_user_action" ||
      authentication.status === "unknown"
    ) {
      throw new Error(
        "The browser login could not be revalidated. Open Live View and sign in again."
      );
    }
    const cdpUrl = requirePrivateLoopbackCdpUrl(session.runtimeConnection?.cdpUrl);
    const profileName = account.browserProfileId;

    await getOpenClawAdapter().setConfig(
      buildQuotedConfigKeyPath("browser.profiles", profileName),
      {
        cdpUrl,
        attachOnly: true,
        color: "#7C3AED"
      },
      { strictJson: true, timeoutMs: 15_000 }
    );
    profileConfigured = true;

    const now = new Date();
    const binding: BrowserTaskBindingRecord = {
      dispatchId: input.dispatchId,
      accountId: account.id,
      workspaceId: account.workspaceId,
      ownerUserId: actor.userId,
      agentId: input.agentId,
      openClawSessionId: input.openClawSessionId,
      openClawSessionKey: buildOpenClawExplicitSessionKey(input.agentId, input.openClawSessionId),
      openClawProfileName: profileName,
      providerSessionId: session.sessionId,
      allowedDomains: account.allowedDomains,
      approvalPolicy: account.approvalPolicy,
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken,
      createdAt: now.toISOString(),
      heartbeatAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + bindingTtlMs).toISOString()
    };

    await mutateBindingRegistry((registry) => {
      registry.bindings = registry.bindings
        .filter((entry) => entry.dispatchId !== binding.dispatchId)
        .filter((entry) => Date.parse(entry.expiresAt) > now.getTime());
      registry.bindings.push(binding);
    });
    await activateBrowserAccountTaskSession({
      actor,
      accountId: account.id,
      workspaceId: account.workspaceId,
      agentId: input.agentId,
      taskId: input.dispatchId,
      leaseId: lease.leaseId,
      fencingToken: lease.fencingToken
    });

    return {
      dispatchId: binding.dispatchId,
      accountId: binding.accountId,
      profileName: binding.openClawProfileName,
      sessionKey: binding.openClawSessionKey,
      expiresAt: binding.expiresAt
    };
  } catch (error) {
    await removeBrowserTaskBinding(input.dispatchId).catch(() => null);
    let configurationCleanupFailed = false;
    if (profileConfigured) {
      try {
        await getOpenClawAdapter().unsetConfig(
          buildQuotedConfigKeyPath("browser.profiles", account.browserProfileId),
          { timeoutMs: 15_000 }
        );
      } catch {
        configurationCleanupFailed = true;
      }
    }
    if (providerSessionId) {
      await completeBrowserAccountTaskSession({
        actor,
        accountId: account.id,
        workspaceId: account.workspaceId,
        agentId: input.agentId,
        taskId: input.dispatchId,
        providerSessionId,
        leaseId: lease.leaseId,
        fencingToken: lease.fencingToken,
        configurationCleanupFailed
      }).catch(() => null);
    } else {
      await releaseBrowserAccountLease({
        actor,
        accountId: account.id,
        workspaceId: account.workspaceId,
        leaseId: lease.leaseId,
        fencingToken: lease.fencingToken
      }).catch(() => null);
    }
    throw error;
  }
}

export async function finalizeBrowserTaskBinding(dispatchId: string) {
  const binding = await removeBrowserTaskBinding(dispatchId);
  if (!binding) return { finalized: false, cleanupFailed: false };
  const result = await cleanupBrowserTaskBinding(binding);
  if (result.cleanupFailed) {
    await retainFailedRecoveryBinding(binding);
  }
  return { finalized: true, cleanupFailed: result.cleanupFailed };
}

export async function heartbeatBrowserTaskBinding(input: {
  openClawSessionKey: string;
  agentId: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const binding = (await readBindingRegistry()).bindings.find(
    (entry) =>
      entry.openClawSessionKey === input.openClawSessionKey &&
      entry.agentId === input.agentId
  );
  if (!binding) {
    throw new BrowserTaskBindingError(
      "No secure browser binding exists for this OpenClaw task.",
      404,
      "browser-binding-not-found"
    );
  }
  if (Date.parse(binding.expiresAt) <= now.getTime()) {
    throw new BrowserTaskBindingError(
      "The secure browser binding expired and requires recovery.",
      409,
      "browser-binding-expired"
    );
  }

  await renewBrowserAccountLease({
    actor: { userId: binding.ownerUserId },
    accountId: binding.accountId,
    workspaceId: binding.workspaceId,
    leaseId: binding.leaseId,
    fencingToken: binding.fencingToken,
    ttlMs: bindingTtlMs,
    now
  });

  let updated: BrowserTaskBindingRecord | null = null;
  await mutateBindingRegistry((registry) => {
    const current = registry.bindings.find(
      (entry) =>
        entry.dispatchId === binding.dispatchId &&
        entry.openClawSessionKey === binding.openClawSessionKey &&
        entry.agentId === binding.agentId &&
        entry.leaseId === binding.leaseId &&
        entry.fencingToken === binding.fencingToken
    );
    if (!current) return;
    current.heartbeatAt = now.toISOString();
    current.expiresAt = new Date(now.getTime() + bindingTtlMs).toISOString();
    updated = current;
  });

  if (!updated) {
    throw new BrowserTaskBindingError(
      "The secure browser binding was fenced during renewal.",
      409,
      "browser-binding-fenced"
    );
  }
  return toBrowserTaskPolicyView(updated);
}

export async function getBrowserTaskBinding(dispatchId: string) {
  return (await readBindingRegistry()).bindings.find(
    (entry) => entry.dispatchId === dispatchId
  ) ?? null;
}

export async function recoverExpiredBrowserTaskBindings(input: {
  now?: Date;
  ownerUserId?: string;
  workspaceId?: string | null;
} = {}) {
  const now = input.now ?? new Date();
  const expired: BrowserTaskBindingRecord[] = [];
  await mutateBindingRegistry((registry) => {
    registry.bindings = registry.bindings.filter((entry) => {
      if (input.ownerUserId && entry.ownerUserId !== input.ownerUserId) return true;
      if (input.workspaceId && entry.workspaceId !== input.workspaceId) return true;
      if (Date.parse(entry.expiresAt) > now.getTime()) return true;
      expired.push(entry);
      return false;
    });
  });

  const recovered = await Promise.all(
    expired.map(async (binding) => {
      const result = await cleanupBrowserTaskBinding(binding);
      if (result.cleanupFailed) {
        await retainFailedRecoveryBinding(binding);
      }
      return {
        dispatchId: binding.dispatchId,
        ...result
      };
    })
  );
  return {
    recoveredCount: recovered.length,
    cleanupFailedCount: recovered.filter((entry) => entry.cleanupFailed).length,
    bindings: recovered
  };
}

export async function expireBrowserTaskBindingsForRecovery(input: { now?: Date } = {}) {
  const now = (input.now ?? new Date()).toISOString();
  let affectedBindings = 0;
  await mutateBindingRegistry((registry) => {
    for (const binding of registry.bindings) {
      if (Date.parse(binding.expiresAt) <= Date.parse(now)) continue;
      affectedBindings += 1;
      binding.expiresAt = now;
      binding.recoveryRequiredAt = binding.recoveryRequiredAt ?? now;
    }
  });
  return { affectedBindings };
}

async function cleanupBrowserTaskBinding(binding: BrowserTaskBindingRecord) {
  let configurationCleanupFailed = false;
  try {
    await getOpenClawAdapter().unsetConfig(
      buildQuotedConfigKeyPath("browser.profiles", binding.openClawProfileName),
      { timeoutMs: 15_000 }
    );
  } catch {
    configurationCleanupFailed = true;
  }

  try {
    const result = await completeBrowserAccountTaskSession({
      actor: { userId: binding.ownerUserId },
      accountId: binding.accountId,
      workspaceId: binding.workspaceId,
      agentId: binding.agentId,
      taskId: binding.dispatchId,
      providerSessionId: binding.providerSessionId,
      leaseId: binding.leaseId,
      fencingToken: binding.fencingToken,
      configurationCleanupFailed
    });
    return { cleanupFailed: result.cleanupFailed };
  } catch {
    return { cleanupFailed: true };
  }
}

async function retainFailedRecoveryBinding(binding: BrowserTaskBindingRecord) {
  const now = new Date().toISOString();
  await mutateBindingRegistry((registry) => {
    if (registry.bindings.some((entry) => entry.dispatchId === binding.dispatchId)) return;
    registry.bindings.push({
      ...binding,
      recoveryRequiredAt: binding.recoveryRequiredAt ?? now,
      expiresAt: now
    });
  });
}

export async function readBrowserTaskBindingsForTesting() {
  return (await readBindingRegistry()).bindings;
}

export function setBrowserTaskBindingRegistryRootForTesting(root: string | null) {
  registryRootOverride = root;
}

function requirePrivateLoopbackCdpUrl(value: string | undefined) {
  if (!value) throw new Error("The browser worker did not provide a private CDP transport.");
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("The browser worker CDP transport is not loopback-only.");
  }
  return url.toString().replace(/\/$/, "");
}

function buildOpenClawExplicitSessionKey(agentId: string, sessionId: string) {
  return `agent:${agentId}:explicit:${sessionId}`;
}

function buildQuotedConfigKeyPath(parentPath: string, key: string) {
  return `${parentPath}[${JSON.stringify(key)}]`;
}

async function removeBrowserTaskBinding(dispatchId: string) {
  const result: { value: BrowserTaskBindingRecord | null } = { value: null };
  await mutateBindingRegistry((registry) => {
    result.value = registry.bindings.find((entry) => entry.dispatchId === dispatchId) ?? null;
    registry.bindings = registry.bindings.filter((entry) => entry.dispatchId !== dispatchId);
  });
  return result.value;
}

async function readBindingRegistry(): Promise<BrowserTaskBindingRegistry> {
  try {
    const parsed = JSON.parse(await readFile(resolveRegistryPath(), "utf8")) as Partial<BrowserTaskBindingRegistry>;
    return {
      version: 1,
      bindings: Array.isArray(parsed.bindings)
        ? parsed.bindings.map((entry) => ({
            ...entry,
            heartbeatAt: entry.heartbeatAt ?? entry.createdAt
          }))
        : []
    };
  } catch (error) {
    if (isFileError(error, "ENOENT")) return { version: 1, bindings: [] };
    throw new Error("Browser task binding state could not be read.");
  }
}

async function mutateBindingRegistry(mutator: (registry: BrowserTaskBindingRegistry) => void) {
  await withRegistryLock(async () => {
    const registry = await readBindingRegistry();
    mutator(registry);
    const registryPath = resolveRegistryPath();
    await mkdir(path.dirname(registryPath), { recursive: true, mode: 0o700 });
    const tempPath = `${registryPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(registry, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(tempPath, registryPath);
  });
}

async function withRegistryLock<T>(operation: () => Promise<T>) {
  const lockPath = `${resolveRegistryPath()}.lock`;
  await mkdir(path.dirname(lockPath), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + lockWaitMs;
  while (true) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(new Date().toISOString());
      await handle.close();
      break;
    } catch (error) {
      if (!isFileError(error, "EEXIST")) throw error;
      const createdAt = Date.parse(await readFile(lockPath, "utf8").catch(() => ""));
      if (!Number.isFinite(createdAt) || Date.now() - createdAt > lockStaleMs) {
        await rm(lockPath, { force: true });
        continue;
      }
      if (Date.now() >= deadline) throw new Error("Browser task binding state is busy.");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await operation();
  } finally {
    await rm(lockPath, { force: true });
  }
}

function resolveRegistryPath() {
  return path.join(registryRootOverride ?? missionControlRootPath, "browser-task-bindings.json");
}

function toBrowserTaskPolicyView(binding: BrowserTaskBindingRecord) {
  return {
    dispatchId: binding.dispatchId,
    accountId: binding.accountId,
    workspaceId: binding.workspaceId,
    ownerUserId: binding.ownerUserId,
    agentId: binding.agentId,
    openClawProfileName: binding.openClawProfileName,
    allowedDomains: binding.allowedDomains,
    approvalPolicy: binding.approvalPolicy,
    fencingToken: binding.fencingToken,
    heartbeatAt: binding.heartbeatAt,
    expiresAt: binding.expiresAt
  };
}

function isFileError(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
