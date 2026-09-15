import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  listChannelGroupMembers,
  listChannelGroups,
  listChannelPeers,
  listTelegramTopics,
  setChannelDirectoryTransportForTesting,
  type ChannelDirectoryTransport
} from "@/lib/openclaw/application/channel-directory-service";
import {
  setOpenClawAdapterForTesting,
  type OpenClawAdapter
} from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  buildChannelRouteIdentity,
  channelRouteKey,
  legacyAssignmentToRouteBinding,
  routeBindingToLegacyAssignment
} from "@/lib/openclaw/domains/channel-center";

afterEach(() => {
  setChannelDirectoryTransportForTesting(null);
  setOpenClawAdapterForTesting(null);
});

test("channel route identity keeps account and route scope separate", () => {
  const first = buildChannelRouteIdentity({
    provider: "telegram",
    accountId: "main",
    kind: "group",
    routeId: "-1001"
  });
  const second = buildChannelRouteIdentity({
    provider: "telegram",
    accountId: "support",
    kind: "group",
    routeId: "-1001"
  });

  assert.notEqual(channelRouteKey(first), channelRouteKey(second));
  assert.equal(first.routeId, second.routeId);
  assert.equal(first.accountId, "main");
});

test("legacy workspace assignment maps to a generic account-scoped binding", () => {
  const binding = legacyAssignmentToRouteBinding(
    { chatId: "-10042", agentId: "manager", title: "Management", enabled: true },
    { provider: "telegram", accountId: "main", workspaceId: "workspace-1" }
  );

  assert.deepEqual(binding.route, {
    provider: "telegram",
    accountId: "main",
    kind: "group",
    routeId: "-10042",
    parentRouteId: null
  });
  assert.deepEqual(routeBindingToLegacyAssignment(binding, "Management"), {
    chatId: "-10042",
    agentId: "manager",
    title: "Management",
    enabled: true
  });
});

test("directory groups preserve account scope and normalize structured entries", async () => {
  const seen: string[] = [];
  const transport: ChannelDirectoryTransport = {
    source: "openclaw-cli",
    listPeers: async () => [],
    listGroups: async (input) => {
      seen.push(`${input.provider}:${input.accountId}`);
      return [{ id: "-1001", name: "Operations", memberCount: 5, requireMention: false }];
    },
    listGroupMembers: async () => []
  };
  setChannelDirectoryTransportForTesting(transport);

  const result = await listChannelGroups({ provider: "telegram", accountId: "main" });

  assert.equal(result.status, "ok");
  assert.equal(result.source, "openclaw-cli");
  assert.equal(result.accountId, "main");
  assert.equal(result.entries[0]?.routeId, "-1001");
  assert.equal(result.entries[0]?.accessPolicy?.requireMention, false);
  assert.deepEqual(seen, ["telegram:main"]);
});

test("directory peers and members normalize empty and parent-scoped results", async () => {
  const transport: ChannelDirectoryTransport = {
    source: "openclaw-gateway",
    listPeers: async () => [],
    listGroups: async () => [],
    listGroupMembers: async () => [{ id: "user-1", name: "A member" }]
  };
  setChannelDirectoryTransportForTesting(transport);

  const peers = await listChannelPeers({ provider: "slack", accountId: "workspace" });
  const members = await listChannelGroupMembers({ provider: "telegram", accountId: "main", groupId: "-1001" });

  assert.equal(peers.status, "empty");
  assert.equal(members.status, "ok");
  assert.equal(members.entries[0]?.parentRouteId, "-1001");
  assert.equal(members.entries[0]?.accountId, "main");
});

test("unsupported directory is explicit for providers without compatibility data", async () => {
  setChannelDirectoryTransportForTesting({
    source: "openclaw-cli",
    listPeers: async () => ({ ok: false, error: { type: "unsupported", message: "Directory unsupported" } }),
    listGroups: async () => ({ ok: false, error: { type: "unsupported", message: "Directory unsupported" } }),
    listGroupMembers: async () => ({ ok: false, error: { type: "unsupported", message: "Directory unsupported" } })
  });

  const result = await listChannelGroups({ provider: "discord", accountId: "default" });

  assert.equal(result.status, "unsupported");
  assert.equal(result.entries.length, 0);
  assert.match(result.error ?? "", /unsupported/i);
});

test("malformed directory payload is not presented as a successful empty list", async () => {
  setChannelDirectoryTransportForTesting({
    source: "openclaw-cli",
    listPeers: async () => ({ unexpected: true }),
    listGroups: async () => ({ unexpected: true }),
    listGroupMembers: async () => ({ unexpected: true })
  });

  const result = await listChannelPeers({ provider: "slack", accountId: "default" });

  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /unrecognized/i);
});

test("directory entries without route identities are not presented as empty success", async () => {
  setChannelDirectoryTransportForTesting({
    source: "openclaw-cli",
    listPeers: async () => [{ name: "Missing id" }],
    listGroups: async () => [],
    listGroupMembers: async () => []
  });

  const result = await listChannelPeers({ provider: "slack", accountId: "default" });

  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /route identities/i);
});

test("Telegram config topics stay child routes and expose native policy/binding fields", async () => {
  setOpenClawAdapterForTesting({
    getConfig: async () => ({
      accounts: {
        main: {
          groups: {
            "-1001": {
              topics: {
                "42": { name: "Reservations", agentId: "reservations", requireMention: true }
              }
            }
          }
        }
      }
    })
  } as unknown as OpenClawAdapter);

  const result = await listTelegramTopics({ accountId: "main", groupId: "-1001" });

  assert.equal(result.source, "openclaw-config");
  assert.equal(result.entries[0]?.kind, "topic");
  assert.equal(result.entries[0]?.parentRouteId, "-1001");
  assert.equal(result.entries[0]?.agentId, "reservations");
  assert.equal(result.entries[0]?.accessPolicy?.requireMention, true);
});

test("Telegram unsupported directory falls back only to account-scoped OpenClaw config", async () => {
  setChannelDirectoryTransportForTesting({
    source: "openclaw-cli",
    listPeers: async () => [],
    listGroups: async () => ({ ok: false, error: { type: "unsupported", message: "Directory unsupported" } }),
    listGroupMembers: async () => []
  });
  setOpenClawAdapterForTesting({
    getConfig: async () => ({
      groups: { "-100-root": { name: "Root" } },
      accounts: {
        main: { groups: { "-100-main": { name: "Main only" } } },
        support: { groups: {} }
      }
    })
  } as unknown as OpenClawAdapter);

  const main = await listChannelGroups({ provider: "telegram", accountId: "main" });
  const support = await listChannelGroups({ provider: "telegram", accountId: "support" });

  assert.equal(main.source, "openclaw-config");
  assert.deepEqual(main.entries.map((entry) => entry.routeId), ["-100-main"]);
  assert.equal(support.status, "empty");
  assert.deepEqual(support.entries, []);
});
