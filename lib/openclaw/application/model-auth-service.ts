import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { isOpenAiBackedModel } from "@/lib/openclaw/domains/model-provider-connection";
import {
  buildOpenAiAuthLoginCommand,
  resolveOpenAiAuthRecoveryMessage
} from "@/lib/openclaw/model-auth-errors";
import type { ModelsStatusPayload } from "@/lib/openclaw/client/gateway-client";

type OpenAiAuthOrderRepair = {
  needsRepair: boolean;
  profileIds: string[];
  reason: "not-needed" | "no-usable-profile" | "needs-order";
};

const repairCacheTtlMs = 5 * 60 * 1000;
const repairedAuthOrderCache = new Map<string, { expiresAt: number; profileKey: string }>();

export async function ensureOpenAiAuthOrderForAgent({
  agentId,
  modelId
}: {
  agentId: string;
  modelId?: string | null;
}) {
  if (!agentId.trim() || !modelId || !isOpenAiBackedModel(modelId)) {
    return {
      repaired: false,
      reason: "not-openai-model" as const
    };
  }

  let status: ModelsStatusPayload;

  try {
    status = await getOpenClawAdapter().getAgentModelStatus({ agentId }, { timeoutMs: 8_000 });
  } catch (error) {
    return {
      repaired: false,
      reason: "status-failed" as const,
      profileIds: [],
      error
    };
  }

  const repair = resolveOpenAiAuthOrderRepair(status);
  const authBlock = resolveOpenAiRuntimeAuthBlock(status);

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

  try {
    if (agentId !== "main") {
      await setOpenAiAuthOrderWithRetry("main", repair.profileIds).catch(() => undefined);
    }

    await setOpenAiAuthOrderWithRetry(agentId, repair.profileIds);
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

async function setOpenAiAuthOrderWithRetry(agentId: string, profileIds: string[]) {
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

export function resolveOpenAiAuthOrderRepair(
  modelStatus: ModelsStatusPayload
): OpenAiAuthOrderRepair {
  const oauthProvider = modelStatus.auth?.oauth?.providers?.find((entry) => entry.provider === "openai");
  const profiles = Array.isArray(oauthProvider?.profiles) ? oauthProvider.profiles : [];
  const usableProfiles = profiles.filter(isUsableAuthProfile);
  const profileIds = usableProfiles
    .map((profile) => readString(profile.profileId))
    .filter((profileId): profileId is string => Boolean(profileId?.toLowerCase().startsWith("openai:")));

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

export function resolveOpenAiRuntimeAuthBlock(modelStatus: ModelsStatusPayload) {
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
      provider === "openai" &&
      profileId?.startsWith("openai:") &&
      ["cooldown", "expired", "missing", "invalid", "error", "disabled", "revoked"].some((value) =>
        kind === value || status === value || issue?.includes(value)
      )
    );
  });

  if (!blockedProfile) {
    return null;
  }

  return resolveOpenAiAuthRecoveryMessage(
    buildOpenAiAuthLoginCommand("openclaw", { force: true })
  );
}

function isUsableAuthProfile(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const profileId = readString(value.profileId);
  if (!profileId || !profileId.toLowerCase().startsWith("openai:")) {
    return false;
  }

  const status = readString(value.status)?.toLowerCase();
  return !status || !["expired", "missing", "invalid", "error", "disabled", "revoked"].includes(status);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function wait(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
