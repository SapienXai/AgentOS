import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { isOpenAiCodexBackedModel } from "@/lib/openclaw/domains/model-provider-connection";
import {
  buildOpenAiCodexAuthLoginCommand,
  resolveOpenAiCodexAuthRecoveryMessage
} from "@/lib/openclaw/model-auth-errors";
import type { ModelsStatusPayload } from "@/lib/openclaw/client/gateway-client";

type OpenAiCodexAuthOrderRepair = {
  needsRepair: boolean;
  profileIds: string[];
  reason: "not-needed" | "no-usable-profile" | "needs-order";
};

const repairCacheTtlMs = 5 * 60 * 1000;
const legacyProviderFileFallbackEnv = "AGENTOS_OPENCLAW_LEGACY_PROVIDER_FILE_FALLBACK";
const repairedAuthOrderCache = new Map<string, { expiresAt: number; profileKey: string }>();

export async function ensureOpenAiCodexAuthOrderForAgent({
  agentId,
  modelId,
  agentDir
}: {
  agentId: string;
  modelId?: string | null;
  agentDir?: string | null;
}) {
  if (!agentId.trim() || !modelId || !isOpenAiCodexBackedModel(modelId)) {
    return {
      repaired: false,
      reason: "not-codex-model" as const
    };
  }

  let status: ModelsStatusPayload;

  try {
    status = await getOpenClawAdapter().getAgentModelStatus({ agentId }, { timeoutMs: 8_000 });
  } catch (error) {
    const copiedProfileIds = agentDir && isLegacyProviderFileFallbackEnabled()
      ? await copyOpenAiCodexProfilesFromMainStore(agentDir).catch(() => [])
      : [];

    return {
      repaired: copiedProfileIds.length > 0,
      reason: copiedProfileIds.length > 0 ? "profile-copy-fallback" as const : "status-failed" as const,
      profileIds: copiedProfileIds,
      error
    };
  }

  const repair = resolveOpenAiCodexAuthOrderRepair(status);
  const authBlock = resolveOpenAiCodexRuntimeAuthBlock(status);

  if (authBlock) {
    throw new Error(authBlock);
  }

  if (!repair.needsRepair) {
    return {
      repaired: false,
      reason: repair.reason
    };
  }

  const profileKey = repair.profileIds.join("\n");
  const cacheKey = `${agentId}:${profileKey}`;
  const cached = repairedAuthOrderCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return {
      repaired: false,
      reason: "recently-repaired" as const
    };
  }

  const resolvedAgentDir = readString((status as Record<string, unknown>).agentDir) ?? agentDir ?? null;

  if (resolvedAgentDir && isLegacyProviderFileFallbackEnabled()) {
    await persistOpenAiCodexProfileCopies(resolvedAgentDir, repair.profileIds).catch(() => undefined);
  }

  try {
    if (agentId !== "main") {
      await setOpenAiCodexAuthOrderWithRetry("main", repair.profileIds).catch(() => undefined);
    }

    await setOpenAiCodexAuthOrderWithRetry(agentId, repair.profileIds);
    repairedAuthOrderCache.set(cacheKey, {
      expiresAt: Date.now() + repairCacheTtlMs,
      profileKey
    });

    return {
      repaired: true,
      reason: "order-set" as const,
      profileIds: repair.profileIds
    };
  } catch (error) {
    return {
      repaired: false,
      reason: "repair-failed" as const,
      error
    };
  }
}

async function setOpenAiCodexAuthOrderWithRetry(agentId: string, profileIds: string[]) {
  let lastError: unknown = null;

  for (const delayMs of [0, 750, 1500]) {
    if (delayMs > 0) {
      await wait(delayMs);
    }

    try {
      await getOpenClawAdapter().setModelAuthOrder(
        {
          provider: "openai",
          agentId,
          profileIds
        },
        { timeoutMs: 8_000 }
      );
      return;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

async function persistOpenAiCodexProfileCopies(agentDir: string, profileIds: string[]) {
  const sourceStore = await readAuthProfileStore(mainOpenAiCodexAuthStorePath());
  const targetStorePath = path.join(agentDir, "auth-profiles.json");
  const targetStore = await readAuthProfileStore(targetStorePath);
  let changed = false;

  targetStore.version = 1;
  targetStore.profiles = targetStore.profiles ?? {};

  for (const profileId of profileIds) {
    const sourceProfile = sourceStore.profiles?.[profileId];

    if (!isOpenAiCodexOAuthCredential(sourceProfile)) {
      continue;
    }

    const targetProfile = targetStore.profiles[profileId];
    if (JSON.stringify(targetProfile) === JSON.stringify(sourceProfile)) {
      continue;
    }

    targetStore.profiles[profileId] = sourceProfile;
    changed = true;
  }

  if (!changed) {
    return;
  }

  await mkdir(path.dirname(targetStorePath), { recursive: true });
  await writeFile(targetStorePath, `${JSON.stringify(targetStore, null, 2)}\n`, "utf8");
}

async function copyOpenAiCodexProfilesFromMainStore(agentDir: string) {
  const sourceStore = await readAuthProfileStore(mainOpenAiCodexAuthStorePath());
  const profileIds = Object.entries(sourceStore.profiles ?? {})
    .filter(([, profile]) => isOpenAiCodexOAuthCredential(profile))
    .map(([profileId]) => profileId);

  if (profileIds.length === 0) {
    return [];
  }

  await persistOpenAiCodexProfileCopies(agentDir, profileIds);
  return profileIds;
}

function mainOpenAiCodexAuthStorePath() {
  return path.join(os.homedir(), ".openclaw", "agents", "main", "agent", "auth-profiles.json");
}

async function readAuthProfileStore(filePath: string): Promise<{
  version?: number;
  profiles?: Record<string, Record<string, unknown>>;
}> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;

    if (isRecord(parsed)) {
      return {
        version: typeof parsed.version === "number" ? parsed.version : 1,
        profiles: isRecord(parsed.profiles)
          ? Object.fromEntries(
              Object.entries(parsed.profiles).filter((entry): entry is [string, Record<string, unknown>] =>
                isRecord(entry[1])
              )
            )
          : {}
      };
    }
  } catch {}

  return {
    version: 1,
    profiles: {}
  };
}

function isOpenAiCodexOAuthCredential(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value.type === "oauth" &&
    (value.provider === "openai" || value.provider === "openai-codex") &&
    isRecord(value.oauthRef)
  );
}

export function resolveOpenAiCodexAuthOrderRepair(
  modelStatus: ModelsStatusPayload
): OpenAiCodexAuthOrderRepair {
  const oauthProvider = modelStatus.auth?.oauth?.providers?.find(
    (entry) => entry.provider === "openai"
  ) ?? modelStatus.auth?.oauth?.providers?.find(
    (entry) => entry.provider === "openai-codex"
  );
  const profiles = Array.isArray(oauthProvider?.profiles) ? oauthProvider.profiles : [];
  const usableProfiles = profiles.filter(isUsableAuthProfile);
  const profileIds = usableProfiles.map((profile) => readString(profile.profileId)).filter(isNonEmptyString);

  if (profileIds.length === 0) {
    return {
      needsRepair: false,
      profileIds: [],
      reason: "no-usable-profile"
    };
  }

  const effectiveProfiles = Array.isArray(oauthProvider?.effectiveProfiles)
    ? oauthProvider.effectiveProfiles
    : [];
  const firstEffectiveProfile = effectiveProfiles.find(isRecord);
  const firstEffectiveProfileId = firstEffectiveProfile
    ? readString(firstEffectiveProfile.profileId)
    : null;
  const providerStatus = readString(oauthProvider?.status)?.toLowerCase();

  if (
    providerStatus === "ok" &&
    firstEffectiveProfileId &&
    profileIds.includes(firstEffectiveProfileId)
  ) {
    return {
      needsRepair: false,
      profileIds,
      reason: "not-needed"
    };
  }

  return {
    needsRepair: true,
    profileIds,
    reason: "needs-order"
  };
}

export function resolveOpenAiCodexRuntimeAuthBlock(modelStatus: ModelsStatusPayload) {
  const unusableProfiles = Array.isArray(modelStatus.auth?.unusableProfiles)
    ? modelStatus.auth.unusableProfiles
    : [];
  const blockedProfile = unusableProfiles.find((entry) => {
    if (!isRecord(entry)) {
      return false;
    }

    const provider = readString(entry.provider)?.toLowerCase();
    const profileId = readString(entry.profileId)?.toLowerCase();
    const kind = readString(entry.kind)?.toLowerCase();
    const status = readString(entry.status)?.toLowerCase();
    const issue = readString(entry.issue)?.toLowerCase();

    return (
      (provider === "openai" || provider === "openai-codex" || profileId?.startsWith("openai:")) &&
      ["cooldown", "expired", "missing", "invalid", "error", "disabled", "revoked"].some((value) =>
        kind === value || status === value || issue?.includes(value)
      )
    );
  });

  if (!blockedProfile) {
    return null;
  }

  return resolveOpenAiCodexAuthRecoveryMessage(
    buildOpenAiCodexAuthLoginCommand("openclaw", { force: true })
  );
}

function isLegacyProviderFileFallbackEnabled() {
  const value = process.env[legacyProviderFileFallbackEnv];
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "on";
}

function isUsableAuthProfile(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const profileId = readString(value.profileId);
  if (!profileId) {
    return false;
  }

  const status = readString(value.status)?.toLowerCase();
  return !status || !["expired", "missing", "invalid", "error", "disabled", "revoked"].includes(status);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isNonEmptyString(value: string | null): value is string {
  return Boolean(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function wait(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
