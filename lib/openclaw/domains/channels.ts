import { readFile } from "node:fs/promises";
import path from "node:path";

import { listChannelGroups } from "@/lib/openclaw/application/channel-directory-service";
import { parseDiscordRouteId } from "@/lib/openclaw/domains/discord-route";
import { buildChannelRouteIdentity, serializeRouteToOpenClawBindingMatch } from "@/lib/openclaw/domains/channel-center";
import { readOpenClawSurfaceAccounts } from "@/lib/openclaw/surface-adapters";
import { getSurfaceKind } from "@/lib/openclaw/surface-catalog";
import type { TimingCollector } from "@/lib/openclaw/timing";
import { normalizeChannelRegistry, parseWorkspaceChannelSummary } from "@/lib/openclaw/domains/workspace-manifest";
import type {
  ChannelAccountRecord,
  ChannelRegistry,
  DiscoveredSurfaceRoute,
  MissionControlSurfaceProvider,
  WorkspaceChannelGroupAssignment,
  WorkspaceChannelSummary
} from "@/lib/openclaw/types";

export { parseDiscordRouteId };

export function resolveChannelAccountId(account: Pick<ChannelAccountRecord, "id" | "accountId">) {
  return account.accountId?.trim() || account.id;
}

const missionControlRootPath = path.join(/*turbopackIgnore: true*/ process.cwd(), ".mission-control");
const channelRegistryPath = path.join(missionControlRootPath, "channel-registry.json");

export type ManagedDiscordBinding = {
  agentId: string;
  match: Record<string, unknown> & {
    channel: "discord";
    accountId: string;
  };
} | null;

function normalizeOptionalValue(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function getChannelRegistry() {
  return readChannelRegistry();
}

export async function readChannelRegistry() {
  try {
    const raw = await readFile(channelRegistryPath, "utf8");
    const candidate = JSON.parse(raw);
    const parsed = isObjectRecord(candidate) ? candidate : {};
    const channels = Array.isArray(parsed.channels)
      ? parsed.channels
          .map((entry) => parseWorkspaceChannelSummary(entry))
          .filter((entry): entry is WorkspaceChannelSummary => Boolean(entry))
      : [];
    const registry = normalizeChannelRegistry({
      version: 1 as const,
      channels
    });
    return await reconcileTelegramRegistryAccounts(registry);
  } catch {
    return normalizeChannelRegistry({
      version: 1 as const,
      channels: []
    });
  }
}

export async function readChannelAccounts() {
  try {
    const accounts = await readOpenClawSurfaceAccounts();
    return dedupeChannelAccounts(accounts);
  } catch {
    return [] as ChannelAccountRecord[];
  }
}

export function applyChannelAccountDisplayNames(accounts: ChannelAccountRecord[], registry: ChannelRegistry) {
  const labels = new Map(
    registry.channels
      .filter((channel) => Boolean(channel.id))
      .map((channel) => [channel.id, channel.name.trim() || channel.id] as const)
  );

  return accounts.map((account) => ({
    ...account,
    name: labels.get(account.id) ?? account.name
  }));
}

export function buildLegacyRegistrySurfaceAccounts(registry: ChannelRegistry) {
  return registry.channels
    .filter((channel) => channel.type !== "internal" && channel.workspaces.length > 0)
    .map(
      (channel) =>
        ({
          id: channel.id,
          type: channel.type,
          name: channel.name.trim() || channel.id,
          enabled: true,
          kind: getSurfaceKind(channel.type),
          capabilities: [getSurfaceKind(channel.type)],
          metadata: {
            source: "channel-registry",
            legacy: true
          }
        }) satisfies ChannelAccountRecord
    );
}

export function mergeMissionControlSurfaceAccounts(accounts: ChannelAccountRecord[]) {
  const merged = new Map<string, ChannelAccountRecord>();

  for (const account of accounts) {
    const key = `${account.type}:${account.id}`;
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, account);
      continue;
    }

    merged.set(key, {
      ...existing,
      name: existing.name || account.name,
      enabled: existing.enabled !== false,
      kind: existing.kind ?? account.kind,
      capabilities: uniqueStrings([...(existing.capabilities ?? []), ...(account.capabilities ?? [])]),
      metadata: {
        ...(account.metadata ?? {}),
        ...(existing.metadata ?? {})
      }
    });
  }

  return Array.from(merged.values());
}

export async function discoverSurfaceRoutes(input: {
  provider: MissionControlSurfaceProvider;
  accountId?: string | null;
}, timings?: TimingCollector) {
  switch (input.provider) {
    case "telegram":
      return discoverTelegramGroups(input, timings);
    case "discord":
      return discoverDiscordRoutes(input.accountId, timings);
    default:
      return [] as DiscoveredSurfaceRoute[];
  }
}

export async function discoverTelegramGroups(
  inputOrTimings?: { accountId?: string | null; query?: string | null; limit?: number | null } | TimingCollector,
  maybeTimings?: TimingCollector
) {
  const input = isTelegramDiscoveryInput(inputOrTimings) ? inputOrTimings : {};
  const timings = isTelegramDiscoveryInput(inputOrTimings) ? maybeTimings : inputOrTimings;
  const result = await listChannelGroups(
    {
      provider: "telegram",
      accountId: input.accountId,
      query: input.query,
      limit: input.limit
    },
    { timings }
  );

  return result.entries
    .map((entry) => ({
      routeId: entry.routeId,
      provider: "telegram" as const,
      kind: "group" as const,
      title: entry.title,
      lastSeen: null
    }))
    .sort((left, right) => (left.title ?? left.routeId).localeCompare(right.title ?? right.routeId));
}

export async function discoverDiscordRoutes(accountId?: string | null, timings?: TimingCollector) {
  const result = await listChannelGroups(
    { provider: "discord", accountId, resolveBindings: true },
    { timings }
  );
  return result.entries.map((entry) => ({
    routeId: entry.routeId,
    provider: "discord" as const,
    kind: entry.kind === "dm" ? "channel" as const : entry.kind,
    title: entry.title,
    subtitle: entry.handle,
    lastSeen: null,
    guildId: normalizeOptionalValue(entry.metadata.guildId as string | null | undefined),
    parentId: entry.parentRouteId
  })).sort((left, right) => (left.title ?? left.routeId).localeCompare(right.title ?? right.routeId));
}

function isTelegramDiscoveryInput(
  value: { accountId?: string | null; query?: string | null; limit?: number | null } | TimingCollector | undefined
): value is { accountId?: string | null; query?: string | null; limit?: number | null } {
  return isObjectRecord(value) && ("accountId" in value || "query" in value || "limit" in value);
}

export function buildManagedDiscordBinding(
  accountId: string,
  assignment: WorkspaceChannelGroupAssignment
): ManagedDiscordBinding {
  const parsed = parseDiscordRouteId(assignment.chatId);
  if (!parsed || !assignment.agentId) {
    return null;
  }

  // Compatibility projection only. Thread routes are intentionally not
  // serialized as peer.kind=thread; OpenClaw resolves them through the parent
  // channel binding.
  if (parsed.kind === "thread") return null;

  const route = buildChannelRouteIdentity({
    provider: "discord",
    accountId,
    kind: parsed.kind === "role" ? "role" : "channel",
    routeId: parsed.targetId,
    parentRouteId: parsed.guildId,
    metadata: parsed.guildId ? { guildId: parsed.guildId, nativePeerKind: "channel" } : undefined
  });
  const match = serializeRouteToOpenClawBindingMatch(route);
  if (!match) return null;

  return {
    agentId: assignment.agentId,
    match: { ...match, channel: "discord" as const, accountId }
  };
}

function dedupeChannelAccounts(accounts: ChannelAccountRecord[]) {
  const telegramByBot = new Map<string, ChannelAccountRecord>();
  const others: ChannelAccountRecord[] = [];

  for (const account of accounts) {
    if (account.type !== "telegram") {
      others.push(account);
      continue;
    }

    const botId =
      typeof account.metadata?.botId === "string" && account.metadata.botId.trim().length > 0
        ? account.metadata.botId.trim()
        : null;

    if (!botId) {
      if (!telegramByBot.has(account.id)) {
        telegramByBot.set(account.id, account);
      }
      continue;
    }

    const current = telegramByBot.get(botId);
    if (!current) {
      telegramByBot.set(botId, account);
      continue;
    }

    const candidateScore = scoreTelegramAccountChoice(account.id);
    const currentScore = scoreTelegramAccountChoice(current.id);
    if (candidateScore > currentScore) {
      telegramByBot.set(botId, account);
    }
  }

  return [...others, ...Array.from(telegramByBot.values())];
}

function scoreTelegramAccountChoice(accountId: string) {
  if (accountId !== "default") {
    return 2;
  }

  return 1;
}

async function reconcileTelegramRegistryAccounts(registry: ChannelRegistry) {
  const telegramAccounts = (await readChannelAccounts()).filter((account) => account.type === "telegram");
  if (telegramAccounts.length === 0) {
    return registry;
  }

  const accountIds = new Set(telegramAccounts.map((account) => account.id));
  const accountsByName = new Map<string, ChannelAccountRecord[]>();

  for (const account of telegramAccounts) {
    const key = account.name.trim().toLowerCase();
    if (!key) {
      continue;
    }

    const current = accountsByName.get(key) ?? [];
    current.push(account);
    accountsByName.set(key, current);
  }

  let changed = false;
  const nextChannels = registry.channels.map((channel) => {
    if (channel.type !== "telegram" || accountIds.has(channel.id)) {
      return channel;
    }

    const matches = accountsByName.get(channel.name.trim().toLowerCase()) ?? [];
    if (matches.length !== 1) {
      return channel;
    }

    changed = true;
    return {
      ...channel,
      id: matches[0].id,
      name: matches[0].name
    };
  });

  if (!changed) {
    return registry;
  }

  return normalizeChannelRegistry({
    version: 1,
    channels: nextChannels
  });
}
