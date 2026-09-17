import "server-only";

import { getOpenClawAdapter, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  readConfigMutationOutcome,
  type OpenClawConfigMutationOutcome
} from "@/lib/openclaw/application/config-mutation-result";

const TELEGRAM_GROUP_BROADCAST_PREFIX = "telegram:";

export type TelegramGroupBroadcastStrategy = "parallel" | "sequential";

export type TelegramGroupBroadcast = {
  agentIds: string[];
  strategy: TelegramGroupBroadcastStrategy;
  mentionGating: boolean;
  maxRounds: number;
  maxTurns: number | null;
};

export type TelegramGroupBroadcastMutation = {
  changed: boolean;
  groupId: string;
  broadcast: TelegramGroupBroadcast | null;
  mutation: OpenClawConfigMutationOutcome | null;
};

export class TelegramGroupBroadcastError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TelegramGroupBroadcastError";
  }
}

export async function getTelegramGroupBroadcast(input: {
  groupId: string;
  adapter?: OpenClawAdapter;
}): Promise<TelegramGroupBroadcast | null> {
  const groupId = normalizeTelegramGroupId(input.groupId);
  const adapter = input.adapter ?? getOpenClawAdapter();
  const { config } = await readBroadcastConfig(adapter);
  const entry = config[telegramBroadcastKey(groupId)];
  return normalizeBroadcastEntry(entry, normalizeStrategy(config.strategy));
}

export async function setTelegramGroupBroadcast(input: {
  groupId: string;
  agentIds: readonly string[];
  strategy?: TelegramGroupBroadcastStrategy;
  mentionGating?: boolean;
  maxRounds?: number;
  maxTurns?: number | null;
  adapter?: OpenClawAdapter;
}): Promise<TelegramGroupBroadcastMutation> {
  const groupId = normalizeTelegramGroupId(input.groupId);
  const agentIds = uniqueAgentIds(input.agentIds);
  if (agentIds.length > 16) {
    throw new TelegramGroupBroadcastError("A Telegram broadcast group can include at most 16 agents.");
  }
  if (input.maxRounds !== undefined && (!Number.isInteger(input.maxRounds) || input.maxRounds < 1 || input.maxRounds > 4)) {
    throw new TelegramGroupBroadcastError("Broadcast rounds must be an integer between 1 and 4.");
  }
  if (input.maxTurns !== undefined && input.maxTurns !== null && (!Number.isInteger(input.maxTurns) || input.maxTurns < 1 || input.maxTurns > 32)) {
    throw new TelegramGroupBroadcastError("Broadcast turns must be an integer between 1 and 32.");
  }

  const adapter = input.adapter ?? getOpenClawAdapter();
  const current = await readBroadcastConfig(adapter);
  const key = telegramBroadcastKey(groupId);
  const nextConfig = { ...current.config };
  let nextBroadcast: TelegramGroupBroadcast | null = null;

  if (agentIds.length === 0) {
    delete nextConfig[key];
  } else {
    const existing = normalizeBroadcastEntry(current.config[key], normalizeStrategy(current.config.strategy));
    nextBroadcast = {
      agentIds,
      strategy: input.strategy ?? existing?.strategy ?? "parallel",
      mentionGating: input.mentionGating ?? existing?.mentionGating ?? true,
      maxRounds: input.maxRounds ?? existing?.maxRounds ?? 1,
      maxTurns: input.maxTurns !== undefined ? input.maxTurns : existing?.maxTurns ?? null
    };
    nextConfig[key] = {
      ...(isRecord(current.config[key]) ? current.config[key] : {}),
      agents: nextBroadcast.agentIds,
      mentionGating: nextBroadcast.mentionGating,
      maxRounds: nextBroadcast.maxRounds,
      ...(nextBroadcast.maxTurns === null ? {} : { maxTurns: nextBroadcast.maxTurns })
    };
    nextConfig.strategy = nextBroadcast.strategy;
  }

  const nextRoot = Object.keys(nextConfig).length > 0 || current.hadBroadcastConfig
    ? nextConfig
    : {};
  const before = normalizeBroadcastEntry(current.config[key], normalizeStrategy(current.config.strategy));
  const changed = !sameBroadcast(before, nextBroadcast);
  if (!changed) {
    return { changed: false, groupId, broadcast: before, mutation: null };
  }

  const result = await adapter.setConfig("broadcast", nextRoot, {
    strictJson: true,
    ...(current.baseHash ? { baseHash: current.baseHash } : {}),
    replacePaths: ["broadcast"],
    timeoutMs: 15_000
  });
  const mutation = readConfigMutationOutcome(result, "broadcast");
  const verified = await getTelegramGroupBroadcast({ groupId, adapter });
  if (!sameBroadcast(verified, nextBroadcast)) {
    throw new TelegramGroupBroadcastError("OpenClaw accepted the broadcast update, but the live group state did not confirm it.");
  }

  return { changed: true, groupId, broadcast: verified, mutation };
}

function telegramBroadcastKey(groupId: string) {
  return `${TELEGRAM_GROUP_BROADCAST_PREFIX}${groupId}`;
}

async function readBroadcastConfig(adapter: OpenClawAdapter): Promise<{
  config: Record<string, unknown>;
  baseHash: string | null;
  hadBroadcastConfig: boolean;
}> {
  if (adapter.getConfigSnapshot) {
    try {
      const snapshot = await adapter.getConfigSnapshot({ timeoutMs: 10_000 });
      const root = isRecord(snapshot.config)
        ? snapshot.config
        : isRecord(snapshot.resolved)
          ? snapshot.resolved
          : {};
      const broadcast = root.broadcast;
      return {
        config: isRecord(broadcast) ? broadcast : {},
        baseHash: normalizeHash(snapshot.hash ?? snapshot.configRevisionHash ?? snapshot.appliedConfigHash),
        hadBroadcastConfig: broadcast !== undefined
      };
    } catch {
      // Older adapters may expose config paths without a root snapshot.
    }
  }

  const value = await adapter.getConfig<unknown>("broadcast", { timeoutMs: 10_000 });
  return {
    config: isRecord(value) ? value : {},
    baseHash: null,
    hadBroadcastConfig: value !== undefined && value !== null
  };
}

function normalizeBroadcastEntry(value: unknown, fallbackStrategy: TelegramGroupBroadcastStrategy): TelegramGroupBroadcast | null {
  if (Array.isArray(value)) {
    const agentIds = uniqueAgentIds(value.filter((entry): entry is string => typeof entry === "string"));
    return agentIds.length > 0 ? defaultBroadcast(agentIds, fallbackStrategy) : null;
  }
  if (!isRecord(value)) return null;
  const agentIds = uniqueAgentIds(Array.isArray(value.agents) ? value.agents.filter((entry): entry is string => typeof entry === "string") : []);
  if (agentIds.length === 0) return null;
  const strategy = normalizeStrategy(value.strategy ?? fallbackStrategy);
  const maxRounds = integerInRange(value.maxRounds, 1, 4) ?? 1;
  const maxTurns = value.maxTurns === undefined ? null : integerInRange(value.maxTurns, 1, 32);
  return {
    agentIds,
    strategy,
    mentionGating: value.mentionGating !== false,
    maxRounds,
    maxTurns
  };
}

function defaultBroadcast(agentIds: string[], strategy: TelegramGroupBroadcastStrategy): TelegramGroupBroadcast {
  return {
    agentIds,
    strategy,
    mentionGating: true,
    maxRounds: 1,
    maxTurns: null
  };
}

function normalizeStrategy(value: unknown): TelegramGroupBroadcastStrategy {
  return value === "sequential" ? "sequential" : "parallel";
}

function sameBroadcast(left: TelegramGroupBroadcast | null, right: TelegramGroupBroadcast | null) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function uniqueAgentIds(agentIds: readonly string[]) {
  return Array.from(new Set(agentIds.map((agentId) => agentId.trim()).filter(Boolean)));
}

function normalizeTelegramGroupId(value: string) {
  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized)) {
    throw new TelegramGroupBroadcastError("Enter a valid Telegram group ID, such as -1001234567890.");
  }
  return normalized;
}

function integerInRange(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
}

function normalizeHash(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
