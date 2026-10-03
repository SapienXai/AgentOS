import { randomUUID } from "node:crypto";

import {
  resolveAgentOsApplicationUpdateOwner,
  resolveAgentOsDeploymentCapabilities,
  resolveAgentOsDesktopBundle
} from "@/lib/agentos/deployment-capabilities";
import { resolveAgentOsVersion } from "@/lib/agentos/version";
import { readAgentOsStoragePreparation } from "@/lib/agentos/runtime-storage";
import {
  compareStableVersions,
  discoverLatestAgentOsVersion,
  normalizeStableVersion,
  UPDATE_CACHE_TTL_MS,
  UPDATE_CHECK_TIMEOUT_MS,
  updateCacheIdentity
} from "@/packages/agentos/bin/update.js";
import type {
  AgentOsNativeUpdateCheck,
  AgentOsProductUpdateAvailability,
  AgentOsProductUpdateReceipt,
  AgentOsProductUpdateSnapshot
} from "@/lib/agentos/domains/product-update";
import type { AgentOsUpdateDiscovery } from "@/packages/agentos/bin/update.js";
import type { ProductUpdateDiscoveryCache } from "@/lib/agentos/application/product-update-store";
import {
  AgentOsProductUpdateStoreError,
  prepareAgentOsUpdateReceipt,
  readCurrentAgentOsUpdateReceipt,
  readNativeAgentOsUpdateCheck,
  readProductUpdateDiscoveryCache,
  writeAgentOsUpdateReceipt,
  writeProductUpdateDiscoveryCache
} from "@/lib/agentos/application/product-update-store";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import type { AgentOsActorContext } from "@/lib/security/agentos-actor";

const RELEASE_REPO = "SapienXai/AgentOS";
const DESKTOP_INSTALL_BUNDLES = new Set(["macos", "windows-nsis", "linux-appimage"]);
const discoveryTails = new Map<string, Promise<Awaited<ReturnType<typeof discoverLatestAgentOsVersion>>>>();

export async function getAgentOsProductUpdateSnapshot(input: {
  canManageUpdates: boolean;
  forceRefresh?: boolean;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<AgentOsProductUpdateSnapshot> {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const currentVersion = await resolveAgentOsVersion();
  const owner = resolveAgentOsApplicationUpdateOwner(env, platform);
  const deployment = resolveAgentOsDeploymentCapabilities(env, platform);
  const desktopBundle = resolveAgentOsDesktopBundle(env, platform);
  const operation = await reconcileProductUpdateReceipt(currentVersion, env);
  const storage = owner === "desktop" ? await readAgentOsStoragePreparation(env) : null;
  const storageReady = owner !== "desktop" || Boolean(storage && (storage.status === "ready" || storage.status === "migrated"));
  const packageManager = resolvePackageManager(env);

  if (owner === "desktop") {
    return buildDesktopSnapshot({
      currentVersion,
      owner,
      desktopBundle,
      canManageUpdates: input.canManageUpdates,
      storageReady,
      operation,
      nativeCheck: await readNativeAgentOsUpdateCheck(env),
      launchId: env.AGENTOS_DESKTOP_LAUNCH_ID ?? null
    });
  }

  const sourceId = owner === "package-manager" ? "npm:@sapienx/agentos" : `github:${RELEASE_REPO}`;
  const cacheKey = updateCacheIdentity({ owner, currentVersion, sourceId });
  let cache = await readProductUpdateDiscoveryCache(env);
  const matchingCache = cache?.cacheKey === cacheKey && cache.currentVersion === currentVersion ? cache : null;
  const cacheIsFresh = matchingCache ? Date.now() - Date.parse(matchingCache.checkedAt) < UPDATE_CACHE_TTL_MS : false;
  let discovered: AgentOsUpdateDiscovery | ProductUpdateDiscoveryCache | null = matchingCache;
  let checkError: string | null = null;
  let evidence: AgentOsProductUpdateSnapshot["evidence"] = matchingCache ? (cacheIsFresh ? "fresh" : "stale") : "unknown";

  if (input.forceRefresh || !cacheIsFresh) {
    try {
      const freshDiscovery = await coalesceDiscovery(cacheKey, () => discoverLatestAgentOsVersion({
        owner: owner === "package-manager" ? "package-manager" : owner,
        currentVersion,
        packageName: "@sapienx/agentos",
        repo: RELEASE_REPO,
        platform,
        arch: process.arch,
        timeoutMs: UPDATE_CHECK_TIMEOUT_MS
      }));
      discovered = freshDiscovery;
      const expectedAsset = freshDiscovery.expectedAsset;
      cache = {
        schemaVersion: 1,
        cacheKey,
        sourceId: freshDiscovery.sourceId,
        currentVersion,
        latestVersion: freshDiscovery.latestVersion,
        releaseUrl: freshDiscovery.releaseUrl,
        cliAssetAvailable: expectedAsset?.available ?? null,
        checkedAt: freshDiscovery.checkedAt
      };
      await writeProductUpdateDiscoveryCache(cache, env).catch(() => {});
      evidence = "fresh";
    } catch {
      checkError = "The latest stable AgentOS release could not be checked.";
      evidence = matchingCache ? "stale" : "unavailable";
      discovered = matchingCache;
    }
  }

  const latestVersion = discovered?.latestVersion ?? null;
  const comparison = latestVersion ? compareStableVersions(latestVersion, currentVersion) : null;
  let availability: AgentOsProductUpdateAvailability = comparison === null
    ? (checkError ? "unavailable" : "unknown")
    : comparison > 0 ? "available" : "up-to-date";
  let action: AgentOsProductUpdateSnapshot["action"];
  let ownerReason: string;
  if (owner === "release-launcher") {
    action = "release-guidance";
    const hasAsset = matchingOrFreshCacheAsset(discovered, cache, owner);
    ownerReason = hasAsset === false
      ? `The CLI archive for ${platform} ${process.arch} is missing from the latest release. Update from the host; automatic application handoff is unavailable.`
      : "The release launcher owns this installation. Update from the host; automatic application handoff is unavailable.";
  } else if (owner === "package-manager") {
    action = "package-manager-guidance";
    ownerReason = packageManager === "pnpm"
      ? "This installation is owned by pnpm. Use pnpm to apply the update."
      : packageManager === "npm"
        ? "This installation is owned by npm. Use npm to apply the update."
        : "The package manager owns this installation. Use its own update command.";
  } else if (owner === "deployment" || deployment.platform === "railway") {
    action = "deployment-guidance";
    ownerReason = "The deployment platform owns this application image. Replace the image through its deployment workflow, then verify the running build version.";
  } else if (owner === "source") {
    action = "source-guidance";
    ownerReason = "This source checkout is updated by its source-control owner.";
  } else {
    action = "unsupported";
    ownerReason = "AgentOS could not identify an update owner for this installation.";
    availability = availability === "available" ? "available" : availability;
  }

  return {
    currentVersion,
    buildIdentity: env.AGENTOS_BUILD_ID?.trim() || null,
    latestVersion,
    sourceId: discovered?.sourceId ?? matchingCache?.sourceId ?? null,
    checkedAt: discovered?.checkedAt ?? matchingCache?.checkedAt ?? null,
    evidence,
    availability,
    checkError,
    owner,
    desktopBundle,
    packageManager,
    ownerReason,
    action,
    canManageUpdates: input.canManageUpdates,
    canInstall: false,
    releaseUrl: safeReleaseUrl(discovered?.releaseUrl ?? matchingCache?.releaseUrl ?? null),
    cliAssetAvailable: owner === "release-launcher" ? (matchingOrFreshCacheAsset(discovered, cache, owner) ?? null) : null,
    operation: publicReceipt(operation),
    storageReady
  };
}

export async function prepareAgentOsProductUpdate(input: {
  requestId: string;
  nativeCheckId: string;
  targetVersion: string;
  actor: Pick<AgentOsActorContext, "actorId" | "authenticationMethod">;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}): Promise<AgentOsProductUpdateReceipt> {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const capabilities = resolveAgentOsDeploymentCapabilities(env, platform);
  const currentVersion = await resolveAgentOsVersion();
  const targetVersion = normalizeStableVersion(input.targetVersion);
  const nativeCheck: AgentOsNativeUpdateCheck | null = await readNativeAgentOsUpdateCheck(env);
  const storage = await readAgentOsStoragePreparation(env);
  const launchId = env.AGENTOS_DESKTOP_LAUNCH_ID;

  if (capabilities.applicationUpdateOwner !== "desktop") {
    throw new AgentOsProductUpdateStoreError("In-product AgentOS installation is supported only in the Desktop application.", "unsupported");
  }
  if (!DESKTOP_INSTALL_BUNDLES.has(capabilities.desktopBundle)) {
    throw new AgentOsProductUpdateStoreError("This Desktop bundle is managed by its operating-system package owner.", "unsupported");
  }
  if (!storage || !["ready", "migrated"].includes(storage.status)) {
    throw new AgentOsProductUpdateStoreError("Persistent AgentOS data is not ready for a Desktop update.", "unavailable");
  }
  if (!targetVersion || !launchId || !nativeCheck || nativeCheck.status !== "available") {
    throw new AgentOsProductUpdateStoreError("A fresh native Desktop update check is required.", "conflict");
  }
  if (nativeCheck.launchId !== launchId || nativeCheck.checkId !== input.nativeCheckId ||
      nativeCheck.currentVersion !== currentVersion || nativeCheck.latestVersion !== targetVersion ||
      nativeCheck.updateAvailable !== true || !nativeCheck.releaseIdentity ||
      !isFreshNativeCheck(nativeCheck.checkedAt)) {
    throw new AgentOsProductUpdateStoreError("The native update check is stale or no longer matches this release.", "conflict");
  }
  if (compareStableVersions(targetVersion, currentVersion) === null || compareStableVersions(targetVersion, currentVersion)! <= 0) {
    throw new AgentOsProductUpdateStoreError("AgentOS updates must target a newer stable release.", "invalid");
  }

  const now = new Date();
  const receipt: AgentOsProductUpdateReceipt = {
    schemaVersion: 1,
    operationId: randomUUID(),
    requestId: input.requestId,
    actorId: input.actor.actorId,
    authenticationMethod: input.actor.authenticationMethod,
    owner: "desktop",
    launchId,
    currentVersion,
    targetVersion,
    nativeCheckId: nativeCheck.checkId,
    releaseIdentity: nativeCheck.releaseIdentity,
    state: "requested",
    phase: "checking",
    progress: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
    failure: null,
    newLaunchId: null,
    nativeVersion: null,
    serverVersion: null,
    verification: "pending"
  };

  const prepared = await prepareAgentOsUpdateReceipt(receipt, env);
  await recordAgentOsAuditEvent({
    actor: input.actor,
    operation: "agentos.update.prepare",
    targetKind: "agentos-application",
    targetId: receipt.operationId,
    correlationId: receipt.requestId,
    result: "started",
    env
  }).catch(() => {});
  return prepared;
}

async function reconcileProductUpdateReceipt(currentVersion: string, env: NodeJS.ProcessEnv) {
  const receipt = await readCurrentAgentOsUpdateReceipt(env);
  const launchId = env.AGENTOS_DESKTOP_LAUNCH_ID;
  if (!receipt || !launchId || receipt.launchId === launchId) return receipt;
  if (!["restart-required", "verifying", "running"].includes(receipt.state)) return receipt;

  const nativeVersion = normalizeStableVersion(env.AGENTOS_DESKTOP_VERSION);
  const serverVersion = normalizeStableVersion(currentVersion);
  if (receipt.state === "running") {
    const interrupted: AgentOsProductUpdateReceipt = {
      ...receipt,
      state: "unknown",
      phase: "verify",
      progress: null,
      updatedAt: new Date().toISOString(),
      failure: "The previous Desktop update was interrupted before a verified restart.",
      newLaunchId: launchId,
      nativeVersion,
      serverVersion,
      verification: "unknown"
    };
    await writeAgentOsUpdateReceipt(interrupted, env).catch(() => {});
    return interrupted;
  }

  const matches = nativeVersion === receipt.targetVersion && serverVersion === receipt.targetVersion;
  const reconciled: AgentOsProductUpdateReceipt = {
    ...receipt,
    state: matches ? "succeeded" : "failed",
    phase: matches ? null : "verify",
    progress: matches ? 100 : null,
    updatedAt: new Date().toISOString(),
    failure: matches ? null : "The restarted Desktop and embedded AgentOS server did not report the requested version.",
    newLaunchId: launchId,
    nativeVersion,
    serverVersion,
    verification: matches ? "verified" : "mismatch"
  };
  await writeAgentOsUpdateReceipt(reconciled, env).catch(() => {});
  await recordAgentOsAuditEvent({
    actor: { actorId: receipt.actorId, authenticationMethod: receipt.authenticationMethod as AgentOsActorContext["authenticationMethod"] },
    operation: "agentos.update.reconcile",
    targetKind: "agentos-application",
    targetId: receipt.operationId,
    correlationId: receipt.requestId,
    result: matches ? "succeeded" : "failed",
    env
  }).catch(() => {});
  return reconciled;
}

function buildDesktopSnapshot(input: {
  currentVersion: string;
  owner: "desktop";
  desktopBundle: AgentOsProductUpdateSnapshot["desktopBundle"];
  canManageUpdates: boolean;
  storageReady: boolean;
  operation: AgentOsProductUpdateReceipt | null;
  nativeCheck: AgentOsNativeUpdateCheck | null;
  launchId: string | null;
}): AgentOsProductUpdateSnapshot {
  const nativeCheck = input.nativeCheck;
  const sameLaunch = Boolean(nativeCheck && input.launchId && nativeCheck.launchId === input.launchId);
  const nativeVersionMatches = Boolean(nativeCheck && nativeCheck.currentVersion === input.currentVersion);
  const checkedAt = sameLaunch ? nativeCheck!.checkedAt : null;
  const age = checkedAt ? Date.now() - Date.parse(checkedAt) : Infinity;
  const fresh = sameLaunch && nativeVersionMatches && age >= 0 && age < UPDATE_CACHE_TTL_MS;
  const target = nativeCheck?.latestVersion ?? null;
  let availability: AgentOsProductUpdateAvailability = !nativeCheck || !sameLaunch
    ? "unknown"
    : !nativeVersionMatches || nativeCheck.status === "unavailable"
      ? "unavailable"
      : nativeCheck.updateAvailable && target && (compareStableVersions(target, input.currentVersion) ?? 0) > 0
        ? "available"
        : "up-to-date";
  const installableBundle = DESKTOP_INSTALL_BUNDLES.has(input.desktopBundle);
  const canInstall = Boolean(
    input.canManageUpdates && input.storageReady && installableBundle && fresh && availability === "available" && nativeCheck?.releaseIdentity
  );
  const ownerReason = !installableBundle
      ? input.desktopBundle === "linux-package"
        ? "This Desktop bundle is managed by the operating-system package manager. Use that package manager to update AgentOS."
        : "This Desktop bundle type is unknown, so AgentOS cannot offer an installation action."
    : !nativeVersionMatches
      ? "The native Desktop app and embedded AgentOS server report different versions. Resolve the build mismatch before updating."
    : !input.storageReady
      ? "AgentOS could not complete its persistent data migration. Resolve the storage issue before updating."
      : "The native Desktop updater owns signed downloads, installation and application restart.";
  if (nativeCheck && nativeVersionMatches && !fresh && availability !== "unknown") availability = "unknown";

  return {
    currentVersion: input.currentVersion,
    buildIdentity: process.env.AGENTOS_BUILD_ID?.trim() || null,
    latestVersion: fresh ? target : null,
    sourceId: "tauri:configured-updater-feed",
    checkedAt,
    evidence: !nativeCheck || !sameLaunch ? "unknown" : !nativeVersionMatches || nativeCheck.status === "unavailable" ? "unavailable" : fresh ? "fresh" : "stale",
    availability,
    checkError: nativeCheck?.status === "unavailable"
      ? "The native Desktop release feed could not be checked."
      : nativeCheck && !sameLaunch
        ? "Check for updates again in this Desktop launch."
        : nativeCheck && !nativeVersionMatches
          ? "The native Desktop app and embedded AgentOS server versions do not match."
        : null,
    owner: input.owner,
    desktopBundle: input.desktopBundle,
    packageManager: null,
    ownerReason,
    action: input.desktopBundle === "linux-package" ? "package-manager-guidance" : installableBundle ? "native-install" : "unsupported",
    canManageUpdates: input.canManageUpdates,
    canInstall,
    releaseUrl: fresh && target ? `https://github.com/${RELEASE_REPO}/releases/tag/agentos-v${target}` : null,
    cliAssetAvailable: null,
    operation: publicReceipt(input.operation),
    storageReady: input.storageReady
  };
}

async function coalesceDiscovery<T>(key: string, discovery: () => Promise<T>) {
  const existing = discoveryTails.get(key);
  if (existing) return existing as Promise<T>;
  const pending = discovery();
  discoveryTails.set(key, pending as Promise<Awaited<ReturnType<typeof discoverLatestAgentOsVersion>>>);
  try { return await pending; }
  finally { if (discoveryTails.get(key) === pending) discoveryTails.delete(key); }
}

function publicReceipt(receipt: AgentOsProductUpdateReceipt | null) {
  if (!receipt) return null;
  const publicReceiptValue = { ...receipt };
  Reflect.deleteProperty(publicReceiptValue, "actorId");
  Reflect.deleteProperty(publicReceiptValue, "authenticationMethod");
  Reflect.deleteProperty(publicReceiptValue, "requestId");
  Reflect.deleteProperty(publicReceiptValue, "releaseIdentity");
  Reflect.deleteProperty(publicReceiptValue, "nativeCheckId");
  return publicReceiptValue;
}

function isFreshNativeCheck(checkedAt: string) {
  const timestamp = Date.parse(checkedAt);
  return Number.isFinite(timestamp) && Date.now() - timestamp >= 0 && Date.now() - timestamp <= 5 * 60_000;
}

function resolvePackageManager(env: NodeJS.ProcessEnv) {
  if (env.AGENTOS_PACKAGE_MANAGER === "npm" || env.AGENTOS_PACKAGE_MANAGER === "pnpm") {
    return env.AGENTOS_PACKAGE_MANAGER;
  }
  const userAgent = `${env.npm_config_user_agent ?? ""} ${env.npm_execpath ?? ""}`.toLowerCase();
  if (/\bpnpm\b/.test(userAgent)) return "pnpm";
  if (/\bnpm\b/.test(userAgent)) return "npm";
  return null;
}

function safeReleaseUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.port) return null;
    return url.href;
  } catch {
    return null;
  }
}

function matchingOrFreshCacheAsset(
  discovery: Awaited<ReturnType<typeof discoverLatestAgentOsVersion>> | ProductUpdateDiscoveryCache | null,
  cache: Awaited<ReturnType<typeof readProductUpdateDiscoveryCache>>,
  owner: string
) {
  if (discovery && "expectedAsset" in discovery) return discovery.expectedAsset?.available ?? null;
  if (owner === "release-launcher") return cache?.cliAssetAvailable ?? null;
  return null;
}
