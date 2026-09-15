import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  buildNativeRouteBinding,
  clearChannelRouteBinding,
  migrateLegacyChannelRouteBindings,
  resolveChannelRouteBinding,
  setChannelRouteBinding
} from "@/lib/openclaw/application/channel-route-binding-service";
import {
  setOpenClawAdapterForTesting,
  type OpenClawAdapter
} from "@/lib/openclaw/adapter/openclaw-adapter";
import { buildChannelRouteIdentity, routeBindingToLegacyAssignment } from "@/lib/openclaw/domains/channel-center";
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

test("native routing wins over compatibility state and duplicate matches are explicit conflicts", () => {
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
  assert.equal(conflict.agentId, null);
  assert.equal(conflict.match, "conflict");
  assert.deepEqual(conflict.conflict?.agentIds, ["agent-a", "agent-b"]);
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
