import "server-only";

import { runOpenClawJson } from "@/lib/openclaw/cli";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  readNativeRouteBindings,
  readOpenClawDefaultAgentId,
  resolveChannelRouteBinding
} from "@/lib/openclaw/application/channel-route-binding-service";
import {
  buildChannelRouteIdentity,
  normalizeChannelRouteKind,
  type ChannelRouteAccessPolicy,
  type ChannelRouteKind,
  type ChannelRouteMetadata,
  type ChannelRouteIdentity
} from "@/lib/openclaw/domains/channel-center";
import type { ChannelRouteBindingMatch } from "@/lib/openclaw/application/channel-route-binding-service";
import type { MissionControlSurfaceProvider, WorkspaceChannelGroupAssignment } from "@/lib/openclaw/types";
import { measureTiming, type TimingCollector } from "@/lib/openclaw/timing";
import { redactErrorMessage } from "@/lib/security/redaction";

export type ChannelDirectorySource = "openclaw-gateway" | "openclaw-cli" | "openclaw-config" | "agentos-compatibility";
export type ChannelDirectoryStatus = "ok" | "empty" | "unsupported" | "failed";

export type ChannelDirectoryEntry = {
  routeId: string;
  kind: ChannelRouteKind;
  accountId: string;
  parentRouteId: string | null;
  title: string | null;
  handle: string | null;
  avatarUrl: string | null;
  memberCount: number | null;
  rank: number | null;
  metadata: ChannelRouteMetadata;
  agentId: string | null;
  bindingSource: "openclaw" | "agentos-compatibility" | null;
  bindingMatch: ChannelRouteBindingMatch | null;
  bindingConflict: boolean;
  bindingEditingAmbiguous: boolean;
  inheritedFrom: ChannelRouteIdentity | null;
  shadowedBindingCount: number;
  accessPolicy: ChannelRouteAccessPolicy | null;
};

export type ChannelDirectoryResult = {
  provider: MissionControlSurfaceProvider;
  accountId: string | null;
  entries: ChannelDirectoryEntry[];
  source: ChannelDirectorySource;
  status: ChannelDirectoryStatus;
  fallbackReason: string | null;
  error: string | null;
};

export type ChannelDirectoryListInput = {
  provider: MissionControlSurfaceProvider;
  accountId?: string | null;
  query?: string | null;
  limit?: number | null;
  resolveBindings?: boolean;
  compatibilityAssignments?: WorkspaceChannelGroupAssignment[];
};

export type ChannelDirectoryMembersInput = ChannelDirectoryListInput & {
  groupId: string;
};

type ChannelDirectoryTransport = {
  source: Exclude<ChannelDirectorySource, "openclaw-config" | "agentos-compatibility">;
  listPeers(input: ChannelDirectoryListInput): Promise<unknown>;
  listGroups(input: ChannelDirectoryListInput): Promise<unknown>;
  listGroupMembers(input: ChannelDirectoryMembersInput): Promise<unknown>;
};

const cliDirectoryTransport: ChannelDirectoryTransport = {
  source: "openclaw-cli",
  listPeers: (input) => runOpenClawJson(buildDirectoryArgs("peers", "list", input), { timeoutMs: 15_000 }),
  listGroups: (input) => runOpenClawJson(buildDirectoryArgs("groups", "list", input), { timeoutMs: 15_000 }),
  listGroupMembers: (input) => runOpenClawJson(buildDirectoryArgs("groups", "members", input), { timeoutMs: 15_000 })
};

let directoryTransport: ChannelDirectoryTransport = cliDirectoryTransport;

/** Test-only transport seam. Production callers should not select transports. */
export function setChannelDirectoryTransportForTesting(transport: ChannelDirectoryTransport | null) {
  directoryTransport = transport ?? cliDirectoryTransport;
}

export async function listChannelPeers(
  input: ChannelDirectoryListInput,
  options: { timings?: TimingCollector } = {}
): Promise<ChannelDirectoryResult> {
  const result = await listDirectoryEntries("peers", input, options);
  if (result.status === "unsupported") {
    const configured = await readConfiguredRoutesFromConfig(input, "peers", options.timings);
    if (configured.status === "ok" || configured.status === "empty") {
      const resolved = { ...configured, fallbackReason: result.error ?? "OpenClaw directory peers are unsupported for this installed provider." };
      return input.resolveBindings ? enrichRouteBindings(resolved, input) : resolved;
    }
  }
  return input.resolveBindings ? enrichRouteBindings(result, input) : result;
}

export async function listChannelGroups(
  input: ChannelDirectoryListInput,
  options: { timings?: TimingCollector } = {}
): Promise<ChannelDirectoryResult> {
  const result = await listDirectoryEntries("groups", input, options);

  if (result.status === "unsupported") {
    const configured = await readConfiguredRoutesFromConfig(input, "groups", options.timings);
    if (configured.status === "ok" || configured.status === "empty") {
      const resolved = { ...configured, fallbackReason: result.error ?? "OpenClaw directory groups are unsupported for this installed provider." };
      return input.resolveBindings ? enrichRouteBindings(resolved, input) : resolved;
    }
  }

  return input.resolveBindings ? enrichRouteBindings(result, input) : result;
}

/**
 * Reads the provider's configured route map without relying on the optional
 * directory command. This is intentionally a projection helper for surfaces
 * that need to distinguish configured routes from observed runtime routes.
 */
export async function listConfiguredChannelGroups(
  input: ChannelDirectoryListInput,
  options: { timings?: TimingCollector } = {}
): Promise<ChannelDirectoryResult> {
  const configured = await readConfiguredRoutesFromConfig(input, "groups", options.timings);
  return input.resolveBindings ? enrichRouteBindings(configured, input) : configured;
}

export async function listChannelGroupMembers(
  input: ChannelDirectoryMembersInput,
  options: { timings?: TimingCollector } = {}
): Promise<ChannelDirectoryResult> {
  const accountId = normalizeAccountId(input.accountId);
  const result = await listDirectoryEntries("members", input, options);
  return {
    ...result,
    accountId
  };
}

export async function listTelegramTopics(
  input: { accountId: string; groupId: string; query?: string | null; limit?: number | null; resolveBindings?: boolean },
  options: { timings?: TimingCollector } = {}
): Promise<ChannelDirectoryResult> {
  const accountId = normalizeAccountId(input.accountId);
  if (!accountId) {
    return createResult("telegram", null, [], "openclaw-config", "failed", null, "A Telegram account is required to list topics.");
  }

  try {
    const config = await measureTiming(options.timings, "telegram-directory.read-topic-config", () =>
      getOpenClawAdapter().getConfig<Record<string, unknown>>("channels.telegram", { timeoutMs: 10_000 })
    );
    const groups = resolveTelegramAccountGroups(config, accountId);
    const group = groups[input.groupId];
    const topics = isRecord(group) && isRecord(group.topics) ? group.topics : {};
    const entries = Object.entries(topics)
      .map(([topicId, rawTopic]) => normalizeTopicEntry(topicId, rawTopic, accountId, input.groupId))
      .filter((entry): entry is ChannelDirectoryEntry => Boolean(entry))
      .filter((entry) => matchesQuery(entry, input.query))
      .slice(0, normalizeLimit(input.limit));

    const result = createResult(
      "telegram",
      accountId,
      entries,
      "openclaw-config",
      entries.length > 0 ? "ok" : "empty",
      null,
      null
    );
    return input.resolveBindings
      ? enrichRouteBindings(result, { ...input, provider: "telegram", accountId, resolveBindings: true })
      : result;
  } catch (error) {
    return createResult(
      "telegram",
      accountId,
      [],
      "openclaw-config",
      "failed",
      null,
      redactErrorMessage(error, "OpenClaw Telegram topic configuration is unavailable.")
    );
  }
}

async function listDirectoryEntries(
  kind: "peers" | "groups" | "members",
  input: ChannelDirectoryListInput | ChannelDirectoryMembersInput,
  options: { timings?: TimingCollector }
): Promise<ChannelDirectoryResult> {
  const accountId = normalizeAccountId(input.accountId);
  const provider = input.provider.trim();

  if (!provider) {
    return createResult(provider, accountId, [], directoryTransport.source, "failed", null, "A channel provider is required.");
  }

  if (directoryTransport === cliDirectoryTransport) {
    const availability = await readCliDirectoryProviderAvailability(provider);
    if (!availability.available) {
      return createResult(
        provider,
        accountId,
        [],
        directoryTransport.source,
        "unsupported",
        null,
        availability.reason
      );
    }
  }

  try {
    const payload = await measureTiming(options.timings, `channel-directory.${kind}`, () => {
      if (kind === "peers") {
        return directoryTransport.listPeers(input);
      }
      if (kind === "groups") {
        return directoryTransport.listGroups(input);
      }
      return directoryTransport.listGroupMembers(input as ChannelDirectoryMembersInput);
    });

    const envelope = readErrorEnvelope(payload);
    if (envelope) {
      const unsupported = isUnsupportedDirectoryError(envelope.message, envelope.type);
      return createResult(provider, accountId, [], directoryTransport.source, unsupported ? "unsupported" : "failed", null, envelope.message);
    }

    const extracted = extractList(payload);
    if (extracted.malformed) {
      return createResult(
        provider,
        accountId,
        [],
        directoryTransport.source,
        "failed",
        null,
        "OpenClaw returned an unrecognized directory result."
      );
    }

    const entries = extracted.items
      .map((entry, index) => normalizeDirectoryEntry(entry, {
        provider,
        accountId,
        kind: kind === "peers" ? "peer" : kind === "groups" ? "group" : "peer",
        parentRouteId: kind === "members" ? (input as ChannelDirectoryMembersInput).groupId : null,
        rank: index
      }))
      .filter((entry): entry is ChannelDirectoryEntry => Boolean(entry))
      .filter((entry) => matchesQuery(entry, input.query))
      .slice(0, normalizeLimit(input.limit));

    if (extracted.items.length > 0 && entries.length === 0) {
      return createResult(
        provider,
        accountId,
        [],
        directoryTransport.source,
        "failed",
        null,
        "OpenClaw returned directory entries without usable route identities."
      );
    }

    return createResult(provider, accountId, entries, directoryTransport.source, entries.length > 0 ? "ok" : "empty", null, null);
  } catch (error) {
    const message = redactErrorMessage(error, "OpenClaw channel directory is unavailable.");
    return createResult(
      provider,
      accountId,
      [],
      directoryTransport.source,
      isUnsupportedDirectoryError(message, null) ? "unsupported" : "failed",
      null,
      message
    );
  }
}

async function readCliDirectoryProviderAvailability(provider: string) {
  try {
    const payload = await getOpenClawAdapter().listPlugins({ timeoutMs: 10_000 });
    const plugin = payload.plugins.find(
      (candidate) => candidate.id === provider || candidate.channelIds?.includes(provider)
    );

    if (!plugin) {
      return {
        available: false,
        reason: `OpenClaw provider ${provider} is not installed; directory lookup was skipped to avoid an implicit plugin install.`
      } as const;
    }

    const active = plugin.enabled === true || plugin.status === "loaded" || plugin.status === "enabled";
    if (!active) {
      return {
        available: false,
        reason: `OpenClaw provider ${provider} is installed but not enabled; directory lookup was skipped to avoid an implicit plugin activation.`
      } as const;
    }

    return { available: true, reason: null } as const;
  } catch (error) {
    return {
      available: false,
      reason: redactErrorMessage(error, `OpenClaw plugin inventory is unavailable; ${provider} directory lookup was skipped.`)
    } as const;
  }
}

async function readConfiguredRoutesFromConfig(
  input: ChannelDirectoryListInput,
  collection: "peers" | "groups",
  timings?: TimingCollector
): Promise<ChannelDirectoryResult> {
  const accountId = normalizeAccountId(input.accountId);
  if (!accountId) {
    return createResult(input.provider, null, [], "openclaw-config", "failed", null, "A channel account is required to list routes.");
  }

  try {
    const config = await measureTiming(timings, "channel-directory.read-config", () =>
      getOpenClawAdapter().getConfig<Record<string, unknown>>(`channels.${input.provider}`, { timeoutMs: 10_000 })
    );
    if (!isRecord(config)) {
      return createResult(input.provider, accountId, [], "openclaw-config", "unsupported", null, null);
    }

    const entries = configuredRouteValues(config, input.provider, accountId, collection)
      .map((candidate, index) => normalizeDirectoryEntry(candidate.value, {
        provider: input.provider,
        accountId,
        kind: candidate.kind,
        routeId: candidate.routeId,
        parentRouteId: candidate.parentRouteId,
        metadata: candidate.metadata,
        rank: index
      }))
      .filter((entry): entry is ChannelDirectoryEntry => Boolean(entry))
      .filter((entry) => matchesQuery(entry, input.query))
      .slice(0, normalizeLimit(input.limit));

    return createResult(input.provider, accountId, entries, "openclaw-config", entries.length > 0 ? "ok" : "empty", null, null);
  } catch (error) {
    return createResult(
      input.provider,
      accountId,
      [],
      "openclaw-config",
      "failed",
      null,
      redactErrorMessage(error, "OpenClaw channel route configuration is unavailable.")
    );
  }
}

function buildDirectoryArgs(
  resource: "peers" | "groups",
  action: "list" | "members",
  input: ChannelDirectoryListInput | ChannelDirectoryMembersInput
) {
  const args = ["directory", resource, action, "--channel", input.provider.trim()];
  const accountId = normalizeAccountId(input.accountId);
  if (accountId) {
    args.push("--account", accountId);
  }
  if (action === "members") {
    const groupId = (input as ChannelDirectoryMembersInput).groupId.trim();
    if (!groupId) {
      throw new Error("A group ID is required to list members.");
    }
    args.push("--group-id", groupId);
  }
  const query = typeof input.query === "string" ? input.query.trim() : "";
  if (query) {
    args.push("--query", query);
  }
  const limit = normalizeLimit(input.limit);
  if (limit !== DEFAULT_LIMIT) {
    args.push("--limit", String(limit));
  }
  args.push("--json");
  return args;
}

const DEFAULT_LIMIT = 200;

function normalizeLimit(value: number | null | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? Math.min(value, 500) : DEFAULT_LIMIT;
}

function normalizeAccountId(value: string | null | undefined) {
  const accountId = typeof value === "string" ? value.trim() : "";
  return accountId || null;
}

function extractList(payload: unknown): { items: unknown[]; malformed: boolean } {
  if (Array.isArray(payload)) {
    return { items: payload, malformed: false };
  }
  if (!isRecord(payload)) {
    return { items: [], malformed: true };
  }
  for (const key of ["items", "entries", "peers", "groups", "members"]) {
    if (Array.isArray(payload[key])) {
      return { items: payload[key], malformed: false };
    }
  }
  return { items: [], malformed: true };
}

type ConfiguredRouteCandidate = {
  value: unknown;
  routeId: string;
  kind: ChannelRouteKind;
  parentRouteId: string | null;
  metadata?: ChannelRouteMetadata;
};

function configuredRouteValues(
  config: Record<string, unknown>,
  provider: MissionControlSurfaceProvider,
  accountId: string,
  collection: "peers" | "groups"
): ConfiguredRouteCandidate[] {
  const root = resolveConfiguredAccountRoot(config, provider, accountId, collection);
  const entries: ConfiguredRouteCandidate[] = [];

  if (provider === "discord") {
    const guilds = isRecord(root.guilds) ? root.guilds : {};
    for (const [guildId, rawGuild] of Object.entries(guilds)) {
      if (collection !== "peers") {
        entries.push({
          value: rawGuild,
          routeId: guildId,
          kind: "group",
          parentRouteId: null,
          metadata: { nativeScope: "guild", guildId }
        });
        const guild = isRecord(rawGuild) ? rawGuild : {};
        const channels = isRecord(guild.channels) ? guild.channels : {};
        for (const [channelId, rawChannel] of Object.entries(channels)) {
          entries.push({
            value: rawChannel,
            routeId: channelId,
            kind: "channel",
            parentRouteId: guildId,
            metadata: { nativePeerKind: "channel", guildId }
          });
        }
        const roles = Array.isArray(guild.roles)
          ? guild.roles.map((roleId) => [String(roleId), { name: String(roleId) }] as const)
          : Object.entries(isRecord(guild.roles) ? guild.roles : {});
        for (const [roleId, rawRole] of roles) {
          entries.push({
            value: rawRole,
            routeId: roleId,
            kind: "role",
            parentRouteId: guildId,
            metadata: { nativeScope: "role", guildId }
          });
        }
      }
    }
    return entries;
  }

  if (provider === "slack") {
    const channels = isRecord(root.channels) ? root.channels : {};
    if (collection === "groups") {
      for (const [channelId, rawChannel] of Object.entries(channels)) {
        const channel = isRecord(rawChannel) ? rawChannel : {};
        const teamId = normalizeString(channel.teamId);
        entries.push({
          value: rawChannel,
          routeId: channelId,
          kind: "channel",
          parentRouteId: teamId,
          metadata: { nativePeerKind: "channel", ...(teamId ? { teamId } : {}) }
        });
      }
    }
    return entries;
  }

  if (provider === "whatsapp") {
    if (collection === "groups") {
      const groups = isRecord(root.groups) ? root.groups : {};
      for (const [groupId, rawGroup] of Object.entries(groups)) {
        entries.push({ value: rawGroup, routeId: groupId, kind: "group", parentRouteId: null });
      }
    } else {
      const direct = isRecord(root.direct) ? root.direct : {};
      for (const [peerId, rawPeer] of Object.entries(direct)) {
        entries.push({ value: rawPeer, routeId: peerId, kind: "dm", parentRouteId: null, metadata: { nativePeerKind: "direct" } });
      }
    }
    return entries;
  }

  if (provider === "telegram") {
    if (collection === "groups") {
      const groups = isRecord(root.groups) ? root.groups : {};
      for (const [groupId, rawGroup] of Object.entries(groups)) {
        entries.push({ value: rawGroup, routeId: groupId, kind: "group", parentRouteId: null, metadata: { nativePeerKind: "group" } });
      }
    } else {
      const direct = isRecord(root.dms) ? root.dms : isRecord(root.direct) ? root.direct : {};
      for (const [peerId, rawPeer] of Object.entries(direct)) {
        entries.push({ value: rawPeer, routeId: peerId, kind: "dm", parentRouteId: null, metadata: { nativePeerKind: "direct" } });
      }
    }
  }

  return entries;
}

function resolveConfiguredAccountRoot(
  config: Record<string, unknown>,
  provider: MissionControlSurfaceProvider,
  accountId: string,
  collection: "peers" | "groups"
) {
  const accounts = isRecord(config.accounts) ? config.accounts : {};
  const account = isRecord(accounts[accountId]) ? accounts[accountId] : null;
  if (!account) return config;

  const routeKeys = provider === "discord"
    ? ["guilds"]
    : provider === "slack"
      ? ["channels"]
      : provider === "whatsapp"
        ? collection === "groups" ? ["groups"] : ["direct"]
        : collection === "groups" ? ["groups"] : ["dms", "direct"];
  const hasExplicitRouteMap = routeKeys.some((key) => Object.prototype.hasOwnProperty.call(account, key));
  return hasExplicitRouteMap ? account : { ...config, ...account };
}

function normalizeDirectoryRouteKind(value: unknown, fallback: ChannelRouteKind): ChannelRouteKind {
  const raw = typeof value === "string" ? value.trim().toLowerCase().replace(/[-_ ]+/g, "") : "";
  if (raw === "guild" || raw === "server" || raw === "workspace" || raw === "team") return "group";
  if (raw === "textchannel" || raw === "voicechannel" || raw === "forum" || raw === "room") return "channel";
  if (raw === "direct" || raw === "dm" || raw === "conversation") return "dm";
  if (raw === "thread" || raw === "topic" || raw === "role" || raw === "channel" || raw === "group" || raw === "peer") {
    return normalizeChannelRouteKind(raw);
  }
  return fallback;
}

function readEntryMetadata(
  value: unknown,
  provider: MissionControlSurfaceProvider,
  kind: ChannelRouteKind,
  parentRouteId?: string | null
): ChannelRouteMetadata {
  if (!isRecord(value)) return {};
  const guildId = normalizeString(value.guildId ?? value.guild ?? value.serverId);
  const teamId = normalizeString(value.teamId ?? value.team ?? value.workspaceId);
  const peer = isRecord(value.peer) ? value.peer : null;
  const nativePeerKind = normalizeNativePeerKind(peer?.kind ?? value.nativePeerKind);
  const roleValues = Array.isArray(value.roleIds)
    ? value.roleIds
    : Array.isArray(value.roles)
      ? value.roles
      : [];
  const memberRoleIds = roleValues
    .map((role) => isRecord(role) ? role.id : role)
    .map(normalizeString)
    .filter((role): role is string => Boolean(role));
  return {
    ...(nativePeerKind ? { nativePeerKind } : {}),
    ...(guildId ? { guildId } : {}),
    ...(teamId ? { teamId } : {}),
    ...(kind === "thread" ? { parentPeerKind: nativePeerKind ?? (provider === "discord" || provider === "slack" ? "channel" : "group") } : {}),
    ...(kind === "role" ? { nativeScope: "role" as const } : {}),
    ...(memberRoleIds.length > 0 ? { memberRoleIds } : {}),
    ...(parentRouteId && provider === "discord" && kind === "channel" && !guildId ? { guildId: parentRouteId } : {}),
    ...(parentRouteId && provider === "slack" && kind === "channel" && !teamId ? { teamId: parentRouteId } : {})
  };
}

function mergeRouteMetadata(left: ChannelRouteMetadata | undefined, right: ChannelRouteMetadata) {
  return { ...(left ?? {}), ...right };
}

function normalizeNativePeerKind(value: unknown): "direct" | "group" | "channel" | null {
  if (value === "dm") return "direct";
  return value === "direct" || value === "group" || value === "channel" ? value : null;
}

function inferParentRouteId(
  value: unknown,
  provider: MissionControlSurfaceProvider,
  kind: ChannelRouteKind
) {
  if (!isRecord(value)) return null;
  if (kind === "thread") return normalizeString(value.parentRouteId ?? value.parentId ?? value.channelId);
  if (kind === "channel" && provider === "discord") return normalizeString(value.parentRouteId ?? value.parentId ?? value.guildId ?? value.serverId);
  if (kind === "channel" && provider === "slack") return normalizeString(value.parentRouteId ?? value.parentId ?? value.teamId ?? value.workspaceId);
  return normalizeString(value.parentRouteId ?? value.parentId);
}

function normalizeDirectoryEntry(
  value: unknown,
  input: {
    provider: MissionControlSurfaceProvider;
    accountId: string | null;
    kind: ChannelRouteKind;
    parentRouteId?: string | null;
    routeId?: string;
    metadata?: ChannelRouteMetadata;
    rank: number;
  }
): ChannelDirectoryEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  const routeId = normalizeString(input.routeId ?? value.id ?? value.routeId ?? value.peerId ?? value.chatId);
  if (!routeId || !input.accountId) {
    return null;
  }

  const kind = normalizeDirectoryRouteKind(value, input.kind);
  const metadata = mergeRouteMetadata(input.metadata, readEntryMetadata(value, input.provider, kind, input.parentRouteId));
  const parentRouteId = input.parentRouteId ?? inferParentRouteId(value, input.provider, kind);
  const identity = buildChannelRouteIdentity({
    provider: input.provider,
    accountId: input.accountId,
    kind,
    routeId,
    parentRouteId,
    metadata
  });

  return {
    routeId: identity.routeId,
    kind: identity.kind,
    accountId: identity.accountId,
    parentRouteId: identity.parentRouteId,
    title: normalizeString(value.name ?? value.title ?? value.label),
    handle: normalizeString(value.handle ?? value.username ?? value.address),
    avatarUrl: normalizeString(value.avatarUrl ?? value.avatar ?? value.imageUrl),
    memberCount: normalizeNumber(value.memberCount ?? value.membersCount ?? value.member_count),
    rank: input.rank,
    metadata: identity.metadata ?? {},
    agentId: normalizeString(value.agentId ?? value.agent),
    bindingSource: null,
    bindingMatch: null,
    bindingConflict: false,
    bindingEditingAmbiguous: false,
    inheritedFrom: null,
    shadowedBindingCount: 0,
    accessPolicy: normalizeAccessPolicy(value)
  };
}

function normalizeTopicEntry(topicId: string, value: unknown, accountId: string, groupId: string): ChannelDirectoryEntry | null {
  const normalized = normalizeDirectoryEntry(value, {
    provider: "telegram",
    accountId,
    kind: "topic",
    routeId: topicId,
    parentRouteId: groupId,
    metadata: { nativePeerKind: "group", nativeScope: "peer" },
    rank: 0
  });
  if (!normalized) {
    return null;
  }
  return {
    ...normalized,
    title: normalized.title ?? (topicId === "*" ? "All topics" : `Topic ${topicId}`),
    agentId: normalizeString(isRecord(value) ? value.agentId : null),
    bindingSource: normalized.agentId ? "openclaw" : null,
    bindingMatch: normalized.agentId ? "exact" : null,
    bindingConflict: false,
    bindingEditingAmbiguous: false,
    inheritedFrom: null,
    shadowedBindingCount: 0,
    accessPolicy: isRecord(value) ? normalizeAccessPolicy(value) : normalized.accessPolicy
  };
}

async function enrichRouteBindings(
  result: ChannelDirectoryResult,
  input: ChannelDirectoryListInput
): Promise<ChannelDirectoryResult> {
  if (!input.accountId || result.entries.length === 0) {
    return result;
  }

  let snapshot: Awaited<ReturnType<typeof readNativeRouteBindings>> = { raw: [], entries: [], baseHash: null, available: false };
  try {
    snapshot = await readNativeRouteBindings(getOpenClawAdapter());
  } catch {
    // Keep the directory data useful even when the bindings path is unavailable;
    // the default-agent fallback can still be observed independently.
  }
  const defaultAgentId = await readOpenClawDefaultAgentId(getOpenClawAdapter());

  const compatibilityByRouteId = new Map(
    (input.compatibilityAssignments ?? [])
      .filter((assignment) => assignment.chatId.trim())
      .map((assignment) => [assignment.chatId.trim(), assignment] as const)
  );

  return {
    ...result,
    entries: result.entries.map((entry) => {
      const route = buildChannelRouteIdentity({
        provider: result.provider,
        accountId: entry.accountId,
        kind: entry.kind,
        routeId: entry.routeId,
        parentRouteId: entry.parentRouteId,
        metadata: entry.metadata
      });
      if (entry.kind === "topic" && result.provider === "telegram" && entry.agentId) {
        return {
          ...entry,
          bindingSource: "openclaw" as const,
          bindingMatch: "exact" as const,
          bindingConflict: false,
          bindingEditingAmbiguous: false,
          inheritedFrom: null,
          shadowedBindingCount: 0
        };
      }

      const legacyAssignment = snapshot.available ? undefined : compatibilityByRouteId.get(entry.routeId);
      const compatibilityBinding = legacyAssignment
        ? {
            route,
            agentId: legacyAssignment.agentId,
            workspaceId: null,
            source: "agentos-compatibility" as const
          }
        : null;
      let resolution = resolveChannelRouteBinding(route, snapshot, compatibilityBinding, defaultAgentId);

      if (entry.kind === "topic" && result.provider === "telegram" && entry.parentRouteId) {
        const parentRoute = buildChannelRouteIdentity({
          provider: "telegram",
          accountId: entry.accountId,
          kind: "group",
          routeId: entry.parentRouteId,
          metadata: { nativePeerKind: "group" }
        });
        const parentAssignment = snapshot.available ? undefined : compatibilityByRouteId.get(entry.parentRouteId);
        const parentCompatibility = parentAssignment
          ? {
              route: parentRoute,
              agentId: parentAssignment.agentId,
              workspaceId: null,
              source: "agentos-compatibility" as const
            }
          : null;
        const parentResolution = resolveChannelRouteBinding(parentRoute, snapshot, parentCompatibility, defaultAgentId);
        if (parentResolution.agentId) {
          resolution = {
            ...parentResolution,
            route,
            explicitAgentId: null,
            match: parentResolution.match === "shadowed" ? "shadowed" : "inherited",
            effectiveMatch: "inherited",
            inheritedFrom: parentRoute
          };
        }
      }

      return {
        ...entry,
        agentId: resolution.agentId ?? entry.agentId,
        bindingSource: resolution.source === "unknown" ? (entry.agentId ? "openclaw" : null) : resolution.source,
        bindingMatch: resolution.match,
        bindingConflict: Boolean(resolution.conflict),
        bindingEditingAmbiguous: resolution.editingAmbiguity,
        inheritedFrom: resolution.inheritedFrom,
        shadowedBindingCount: resolution.shadowedBindings.length
      };
    })
  };
}

function normalizeAccessPolicy(value: Record<string, unknown>): ChannelRouteAccessPolicy | null {
  const hasPolicy = ["enabled", "groupPolicy", "groupAllowFrom", "allowFrom", "requireMention"].some((key) => key in value);
  if (!hasPolicy) {
    return null;
  }
  const allowFrom = value.groupAllowFrom ?? value.allowFrom;
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : null,
    groupPolicy: normalizeString(value.groupPolicy),
    allowFrom: Array.isArray(allowFrom)
      ? allowFrom.filter((entry): entry is string => typeof entry === "string").slice(0, 200)
      : [],
    requireMention: typeof value.requireMention === "boolean" ? value.requireMention : null,
    source: "openclaw"
  };
}

function resolveTelegramAccountGroups(config: Record<string, unknown> | null, accountId: string) {
  if (!isRecord(config)) {
    return {} as Record<string, unknown>;
  }
  const accounts = isRecord(config.accounts) ? config.accounts : {};
  const accountConfig = isRecord(accounts[accountId]) ? accounts[accountId] : null;
  if (accountConfig && Object.prototype.hasOwnProperty.call(accountConfig, "groups")) {
    return isRecord(accountConfig.groups) ? accountConfig.groups : {};
  }
  if (Object.prototype.hasOwnProperty.call(config, "groups")) {
    return isRecord(config.groups) ? config.groups : {};
  }
  return {} as Record<string, unknown>;
}

function matchesQuery(entry: ChannelDirectoryEntry, query: string | null | undefined) {
  const normalized = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!normalized) {
    return true;
  }
  return [entry.routeId, entry.title, entry.handle]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(normalized));
}

function createResult(
  provider: MissionControlSurfaceProvider,
  accountId: string | null,
  entries: ChannelDirectoryEntry[],
  source: ChannelDirectorySource,
  status: ChannelDirectoryStatus,
  fallbackReason: string | null,
  error: string | null
): ChannelDirectoryResult {
  return { provider, accountId, entries, source, status, fallbackReason, error };
}

function readErrorEnvelope(value: unknown) {
  if (!isRecord(value) || value.ok !== false || !isRecord(value.error)) {
    return null;
  }
  return {
    type: normalizeString(value.error.type),
    message: normalizeString(value.error.message) ?? "OpenClaw directory request failed."
  };
}

function isUnsupportedDirectoryError(message: string | null, type: string | null) {
  return Boolean(type?.toLowerCase().includes("unsupported") || message && /unsupported|does not support|not available|unknown command/i.test(message));
}

function normalizeString(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() || null : null;
}

function normalizeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type { ChannelDirectoryTransport };
