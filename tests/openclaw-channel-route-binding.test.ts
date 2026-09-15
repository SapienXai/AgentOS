import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  buildNativeRouteBinding,
  clearChannelRouteBinding,
  clearNativeRouteBindingsForAgent,
  migrateLegacyChannelRouteBindings,
  resolveChannelRouteBinding,
  setChannelRouteBinding
} from "@/lib/openclaw/application/channel-route-binding-service";
import {
  setOpenClawAdapterForTesting,
  type OpenClawAdapter
} from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  buildChannelRouteIdentity,
  routeBindingToLegacyAssignment,
  serializeRouteToOpenClawBindingMatch
} from "@/lib/openclaw/domains/channel-center";
import type { ChannelRegistry } from "@/lib/openclaw/types";

afterEach(() => setOpenClawAdapterForTesting(null));

const groupRoute = buildChannelRouteIdentity({
  provider: "telegram",
  accountId: "main",
  kind: "group",
  routeId: "-1001"
});

test("an unset OpenClaw bindings path accepts the first native route binding", async () => {
  const writes: unknown[] = [];
  setOpenClawAdapterForTesting({
    getConfig: async () => null,
    setConfig: async (_path: string, value: unknown) => {
      writes.push(value);
      return { stdout: JSON.stringify({ configMutation: { appliedVia: "config.patch" } }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  const result = await setChannelRouteBinding({ route: groupRoute, agentId: "first-agent" });

  assert.equal(result.changed, true);
  assert.deepEqual(writes[0], [buildNativeRouteBinding(groupRoute, "first-agent")]);
});

test("passes the native config snapshot hash into route binding mutations", async () => {
  let options: Record<string, unknown> | undefined;
  setOpenClawAdapterForTesting({
    getConfigSnapshot: async () => ({ hash: "hash-1", config: { bindings: [] } }),
    setConfig: async (_path: string, _value: unknown, nextOptions: Record<string, unknown>) => {
      options = nextOptions;
      return { stdout: JSON.stringify({ configMutation: { appliedVia: "config.patch", baseHash: "hash-1" } }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  await setChannelRouteBinding({ route: groupRoute, agentId: "hashed-agent" });

  assert.equal(options?.baseHash, "hash-1");
});

test("native bindings are account-scoped and preserve unrelated binding fields", async () => {
  const writes: Array<{ path: string; value: unknown; options: Record<string, unknown> }> = [];
  const existing = [
    { agentId: "old-agent", match: { channel: "telegram", accountId: "main", peer: { kind: "group", id: "-1001" } }, note: "keep" },
    { agentId: "other-account", match: { channel: "telegram", accountId: "support", peer: { kind: "group", id: "-1001" } } },
    { type: "acp", agentId: "acp-agent", match: { channel: "telegram", accountId: "main" }, mode: "keep" }
  ];
  setOpenClawAdapterForTesting({
    getConfig: async () => existing,
    setConfig: async (path: string, value: unknown, options: Record<string, unknown>) => {
      writes.push({ path, value, options });
      return {
        stdout: JSON.stringify({ configMutation: { path, reloadKind: "hot", hotReloaded: true, appliedVia: "config.patch", baseHash: "hash-1", changedPaths: [path] } }),
        stderr: ""
      };
    }
  } as unknown as OpenClawAdapter);

  const result = await setChannelRouteBinding({ route: groupRoute, agentId: "new-agent" });
  assert.equal(result.applyMode, "reload");
  assert.equal(result.baseHash, "hash-1");
  assert.equal(writes[0]?.path, "bindings");
  assert.deepEqual(writes[0]?.options.replacePaths, ["bindings"]);
  assert.deepEqual(writes[0]?.value, [
    { agentId: "new-agent", match: { channel: "telegram", accountId: "main", peer: { kind: "group", id: "-1001" } }, note: "keep" },
    { agentId: "other-account", match: { channel: "telegram", accountId: "support", peer: { kind: "group", id: "-1001" } } },
    { type: "acp", agentId: "acp-agent", match: { channel: "telegram", accountId: "main" }, mode: "keep" }
  ]);
});

test("native routing wins over compatibility state and duplicate matches follow OpenClaw config order", () => {
  const compatibility = {
    route: groupRoute,
    agentId: "compat-agent",
    workspaceId: "workspace-1",
    source: "agentos-compatibility" as const
  };
  const native = [
    buildNativeRouteBinding(groupRoute, "native-agent")
  ].map((binding, index) => ({ index, binding }));

  const resolved = resolveChannelRouteBinding(groupRoute, native, compatibility);
  assert.equal(resolved.agentId, "native-agent");
  assert.equal(resolved.source, "openclaw");
  assert.equal(resolved.match, "exact");

  const conflict = resolveChannelRouteBinding(groupRoute, [
    { index: 0, binding: buildNativeRouteBinding(groupRoute, "agent-a") },
    { index: 1, binding: buildNativeRouteBinding(groupRoute, "agent-b") }
  ], compatibility);
  assert.equal(conflict.agentId, "agent-a");
  assert.equal(conflict.match, "shadowed");
  assert.equal(conflict.effectiveMatch, "exact");
  assert.equal(conflict.editingAmbiguity, true);
  assert.deepEqual(conflict.shadowedBindings.map((binding) => binding.agentId), ["agent-b"]);
  assert.equal(conflict.conflict, null);
});

test("compatibility is used only when native routing has no effective match", () => {
  const compatibility = {
    route: groupRoute,
    agentId: "compat-agent",
    workspaceId: "workspace-1",
    source: "agentos-compatibility" as const
  };

  const resolved = resolveChannelRouteBinding(groupRoute, [], compatibility);
  assert.equal(resolved.agentId, "compat-agent");
  assert.equal(resolved.source, "agentos-compatibility");
  assert.equal(resolved.match, "exact");
});

test("clearing an exact native binding does not alter account or provider siblings", async () => {
  const writes: unknown[] = [];
  const existing = [
    buildNativeRouteBinding(groupRoute, "agent-a"),
    buildNativeRouteBinding(buildChannelRouteIdentity({ ...groupRoute, accountId: "support" }), "agent-b"),
    { agentId: "default-agent", match: { channel: "telegram", accountId: "main" } }
  ];
  setOpenClawAdapterForTesting({
    getConfig: async () => existing,
    setConfig: async (_path: string, value: unknown) => {
      writes.push(value);
      return { stdout: JSON.stringify({ configMutation: { reloadKind: "none", appliedVia: "config.patch" } }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  await clearChannelRouteBinding({ route: groupRoute });
  assert.deepEqual(writes[0], [
    existing[1],
    existing[2]
  ]);
});

test("deleting an agent clears every native route binding it owns and preserves other agents", async () => {
  let current: unknown[] = [
    { agentId: "deleted-agent", match: { channel: "telegram", accountId: "main", peer: { kind: "group", id: "-1001" } } },
    { agentId: "deleted-agent", match: { channel: "discord", accountId: "main", peer: { kind: "channel", id: "channel-1" } } },
    { agentId: "surviving-agent", match: { channel: "telegram", accountId: "main", peer: { kind: "group", id: "-1002" } } },
    { type: "acp", agentId: "deleted-agent", match: { channel: "telegram", accountId: "main" } }
  ];
  const writes: unknown[] = [];
  const adapter = {
    getConfig: async (path: string) => path === "bindings" ? current : null,
    setConfig: async (_path: string, value: unknown) => {
      writes.push(value);
      current = value as unknown[];
      return { stdout: JSON.stringify({ configMutation: { appliedVia: "config.patch", reloadKind: "hot" } }), stderr: "" };
    }
  } as unknown as OpenClawAdapter;

  const result = await clearNativeRouteBindingsForAgent({ agentId: "deleted-agent", adapter });

  assert.equal(result.removed, 2);
  assert.equal(result.changed, true);
  assert.deepEqual(writes[0], current);
  assert.deepEqual(current, [
    { agentId: "surviving-agent", match: { channel: "telegram", accountId: "main", peer: { kind: "group", id: "-1002" } } },
    { type: "acp", agentId: "deleted-agent", match: { channel: "telegram", accountId: "main" } }
  ]);
});

test("deleting an agent clears native Telegram topic ownership without touching other topics", async () => {
  let bindings: unknown[] = [];
  let telegramConfig: Record<string, unknown> = {
    accounts: {
      main: {
        groups: {
          "-1001": {
            topics: {
              "42": { name: "Support", agentId: "deleted-agent" },
              "43": { name: "Billing", agentId: "surviving-agent" }
            }
          }
        }
      }
    }
  };
  const writes: string[] = [];
  const adapter = {
    getConfig: async (path: string) => path === "bindings" ? bindings : telegramConfig,
    getConfigSnapshot: async () => ({
      hash: "telegram-hash-1",
      config: { channels: { telegram: telegramConfig } }
    }),
    setConfig: async (path: string, value: unknown, options: Record<string, unknown>) => {
      writes.push(path);
      if (path === "bindings") bindings = value as unknown[];
      if (path === "channels.telegram") telegramConfig = value as Record<string, unknown>;
      assert.equal(options.baseHash, "telegram-hash-1");
      return { stdout: JSON.stringify({ configMutation: { appliedVia: "config.patch", reloadKind: "hot" } }), stderr: "" };
    }
  } as unknown as OpenClawAdapter;

  const result = await clearNativeRouteBindingsForAgent({ agentId: "deleted-agent", adapter });

  assert.equal(result.topicRemoved, 1);
  assert.equal(result.removed, 1);
  assert.deepEqual(writes, ["channels.telegram"]);
  const topics = (telegramConfig.accounts as Record<string, unknown>).main as Record<string, unknown>;
  const group = (topics.groups as Record<string, unknown>)["-1001"] as Record<string, unknown>;
  assert.deepEqual(group.topics, {
    "42": { name: "Support" },
    "43": { name: "Billing", agentId: "surviving-agent" }
  });
});

test("legacy Telegram group assignments migrate idempotently without overwriting OpenClaw", async () => {
  const writes: unknown[] = [];
  const registry: ChannelRegistry = {
    version: 1,
    channels: [{
      id: "main",
      type: "telegram",
      name: "Main",
      primaryAgentId: null,
      workspaces: [{
        workspaceId: "workspace-1",
        workspacePath: "/tmp/workspace-1",
        agentIds: ["legacy-agent"],
        groupAssignments: [
          { chatId: "-1001", agentId: "legacy-agent", enabled: false },
          { chatId: "-1002", agentId: "new-agent", enabled: true }
        ]
      }]
    }]
  };
  const native = [buildNativeRouteBinding(groupRoute, "native-agent")];
  let current = native;
  const adapter = {
    getConfig: async () => current,
    setConfig: async (_path: string, value: unknown) => {
      writes.push(value);
      current = value as typeof current;
      return { stdout: JSON.stringify({ configMutation: { reloadKind: "hot", appliedVia: "config.patch" } }), stderr: "" };
    }
  } as unknown as OpenClawAdapter;

  const first = await migrateLegacyChannelRouteBindings({ registry, workspaceId: "workspace-1", adapter });
  assert.equal(first.migrated, 1);
  assert.equal(first.conflicts.length, 1);
  assert.equal(first.conflicts[0]?.reason, "native-vs-compatibility");
  assert.equal((writes[0] as unknown[]).length, 2);

  const second = await migrateLegacyChannelRouteBindings({ registry, workspaceId: "workspace-1", adapter });
  assert.equal(second.migrated, 0);
  assert.equal(second.changed, false);
  assert.equal(writes.length, 1);
});

test("migration does not shadow an account-wide native fallback binding", async () => {
  const writes: unknown[] = [];
  const registry: ChannelRegistry = {
    version: 1,
    channels: [{
      id: "main",
      type: "telegram",
      name: "Main",
      primaryAgentId: null,
      workspaces: [{
        workspaceId: "workspace-1",
        workspacePath: "/tmp/workspace-1",
        agentIds: ["legacy-agent"],
        groupAssignments: [{ chatId: "-1001", agentId: "legacy-agent", enabled: true }]
      }]
    }]
  };
  const adapter = {
    getConfig: async () => [{ agentId: "native-default", match: { channel: "telegram", accountId: "main" } }],
    setConfig: async (_path: string, value: unknown) => {
      writes.push(value);
      return { stdout: JSON.stringify({ configMutation: { reloadKind: "hot", appliedVia: "config.patch" } }), stderr: "" };
    }
  } as unknown as OpenClawAdapter;

  const result = await migrateLegacyChannelRouteBindings({ registry, workspaceId: "workspace-1", adapter });
  assert.equal(result.migrated, 0);
  assert.equal(result.changed, false);
  assert.equal(result.conflicts[0]?.reason, "native-vs-compatibility");
  assert.deepEqual(writes, []);
});

test("compatibility projection keeps access state independent from agent binding", () => {
  assert.deepEqual(routeBindingToLegacyAssignment({
    route: groupRoute,
    agentId: "agent-a",
    workspaceId: "workspace-1",
    source: "openclaw"
  }, "Operations", { enabled: false }), {
    chatId: "-1001",
    agentId: "agent-a",
    title: "Operations",
    enabled: false
  });
});

test("thread routes inherit the parent peer and never serialize peer.kind=thread", () => {
  const thread = buildChannelRouteIdentity({
    provider: "discord",
    accountId: "main",
    kind: "thread",
    routeId: "thread-1",
    parentRouteId: "channel-1",
    metadata: { guildId: "guild-1", parentPeerKind: "channel" }
  });
  assert.equal(serializeRouteToOpenClawBindingMatch(thread), null);
  assert.throws(() => buildNativeRouteBinding(thread, "thread-agent"), /cannot be represented/i);

  const resolved = resolveChannelRouteBinding(thread, [
    {
      index: 0,
      binding: {
        agentId: "channel-agent",
        match: {
          channel: "discord",
          accountId: "main",
          guildId: "guild-1",
          peer: { kind: "channel", id: "channel-1" }
        }
      }
    }
  ]);
  assert.equal(resolved.agentId, "channel-agent");
  assert.equal(resolved.effectiveMatch, "inherited");
  assert.equal(resolved.matchedBy, "binding.peer.parent");
  assert.equal(resolved.inheritedFrom?.routeId, "channel-1");
});

test("binding precedence keeps all match fields conjunctive and uses group/channel compatibility", () => {
  const route = buildChannelRouteIdentity({
    provider: "discord",
    accountId: "main",
    kind: "channel",
    routeId: "channel-1",
    parentRouteId: "guild-1",
    metadata: { guildId: "guild-1", nativePeerKind: "channel" }
  });
  const resolved = resolveChannelRouteBinding(route, [
    {
      index: 0,
      binding: { agentId: "wrong-guild", match: { channel: "discord", accountId: "main", guildId: "guild-2", peer: { kind: "group", id: "channel-1" } } }
    },
    {
      index: 1,
      binding: { agentId: "right-peer", match: { channel: "discord", accountId: "main", guildId: "guild-1", peer: { kind: "group", id: "channel-1" } } }
    },
    {
      index: 2,
      binding: { agentId: "account-fallback", match: { channel: "discord", accountId: "main" } }
    }
  ]);
  assert.equal(resolved.agentId, "right-peer");
  assert.equal(resolved.effectiveMatch, "exact");
  assert.equal(resolved.matchedBy, "binding.peer");
});

test("default account omission and channel-wide wildcard remain distinct", () => {
  const defaultRoute = buildChannelRouteIdentity({ provider: "telegram", accountId: "default", kind: "group", routeId: "-1001" });
  const namedRoute = buildChannelRouteIdentity({ provider: "telegram", accountId: "support", kind: "group", routeId: "-1001" });
  const bindings = [
    { index: 0, binding: { agentId: "default-agent", match: { channel: "telegram", peer: { kind: "group", id: "*" } } } },
    { index: 1, binding: { agentId: "all-accounts", match: { channel: "telegram", accountId: "*" } } }
  ];
  assert.equal(resolveChannelRouteBinding(defaultRoute, bindings).agentId, "default-agent");
  assert.equal(resolveChannelRouteBinding(namedRoute, bindings).agentId, "all-accounts");
});

test("uses OpenClaw's configured default agent only after all binding tiers", () => {
  const resolved = resolveChannelRouteBinding(groupRoute, [], null, "default-agent");

  assert.equal(resolved.agentId, "default-agent");
  assert.equal(resolved.source, "openclaw");
  assert.equal(resolved.match, "fallback");
  assert.equal(resolved.effectiveMatch, "fallback");
  assert.equal(resolved.matchedBy, "default");
  assert.equal(resolved.explicitAgentId, null);
});

test("provider route kinds translate to native peers, scopes, and selectors", () => {
  assert.deepEqual(serializeRouteToOpenClawBindingMatch(buildChannelRouteIdentity({
    provider: "telegram",
    accountId: "main",
    kind: "group",
    routeId: "-1001"
  })), {
    channel: "telegram",
    accountId: "main",
    peer: { kind: "group", id: "-1001" }
  });
  assert.deepEqual(serializeRouteToOpenClawBindingMatch(buildChannelRouteIdentity({
    provider: "discord",
    accountId: "main",
    kind: "group",
    routeId: "guild-1"
  })), {
    channel: "discord",
    accountId: "main",
    guildId: "guild-1"
  });
  assert.deepEqual(serializeRouteToOpenClawBindingMatch(buildChannelRouteIdentity({
    provider: "discord",
    accountId: "main",
    kind: "channel",
    routeId: "channel-1",
    parentRouteId: "guild-1"
  })), {
    channel: "discord",
    accountId: "main",
    peer: { kind: "channel", id: "channel-1" },
    guildId: "guild-1"
  });
  assert.deepEqual(serializeRouteToOpenClawBindingMatch(buildChannelRouteIdentity({
    provider: "discord",
    accountId: "main",
    kind: "role",
    routeId: "role-1",
    parentRouteId: "guild-1"
  })), {
    channel: "discord",
    accountId: "main",
    guildId: "guild-1",
    roles: ["role-1"]
  });
  assert.deepEqual(serializeRouteToOpenClawBindingMatch(buildChannelRouteIdentity({
    provider: "slack",
    accountId: "main",
    kind: "channel",
    routeId: "channel-1",
    parentRouteId: "team-1"
  })), {
    channel: "slack",
    accountId: "main",
    peer: { kind: "channel", id: "channel-1" },
    teamId: "team-1"
  });
  assert.deepEqual(serializeRouteToOpenClawBindingMatch(buildChannelRouteIdentity({
    provider: "whatsapp",
    accountId: "support",
    kind: "dm",
    routeId: "peer-1"
  })), {
    channel: "whatsapp",
    accountId: "support",
    peer: { kind: "direct", id: "peer-1" }
  });
});
