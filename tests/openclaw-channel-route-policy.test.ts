import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  setOpenClawAdapterForTesting,
  type OpenClawAdapter
} from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  updateChannelRoutePolicy,
  updateTelegramRoutePolicy
} from "@/lib/openclaw/application/channel-route-policy-service";
import { buildChannelRouteIdentity } from "@/lib/openclaw/domains/channel-center";

afterEach(() => setOpenClawAdapterForTesting(null));

test("Telegram account policy writes stay inside the named account scope", async () => {
  const writes: Array<{ path: string; value: unknown; options: Record<string, unknown> }> = [];
  setOpenClawAdapterForTesting({
    getConfig: async () => ({
      groups: { "-100-root": { requireMention: true, unknownFuture: { keep: true } } },
      accounts: { support: { token: "redacted", groups: { "-100-support": { requireMention: true, unknownFuture: { keep: true } } } } }
    }),
    setConfig: async (path: string, value: unknown, options: Record<string, unknown>) => {
      writes.push({ path, value, options });
      return {
        stdout: JSON.stringify({ configMutation: { path, reloadKind: "hot", hotReloaded: true, appliedVia: "config.patch", baseHash: "hash-support", changedPaths: [path] } }),
        stderr: ""
      };
    }
  } as unknown as OpenClawAdapter);

  const result = await updateTelegramRoutePolicy({
    accountId: "support",
    groupId: "-100-support",
    patch: { requireMention: false, allowFrom: ["user-1"] }
  });

  assert.equal(result.restartRequired, false);
  assert.equal(result.applyMode, "reload");
  assert.equal(result.baseHash, "hash-support");
  assert.deepEqual(writes.map((write) => write.path), [
    'channels.telegram.accounts["support"].groups["-100-support"]'
  ]);
  assert.deepEqual(writes[0]?.options.replacePaths, [writes[0]?.path]);
  assert.deepEqual(writes[0]?.value, {
    requireMention: false,
    unknownFuture: { keep: true },
    allowFrom: ["user-1"]
  });
});

test("Telegram topic policy mutates only selected fields and preserves sibling topics", async () => {
  const writes: Array<{ path: string; value: unknown; options: Record<string, unknown> }> = [];
  setOpenClawAdapterForTesting({
    getConfig: async () => ({
      accounts: {
        main: {
          groups: {
            "-1001": {
              name: "Operations",
              tools: { allowed: ["message"] },
              topics: {
                "1": { name: "General" },
                "2": { name: "Reservations", agentId: "old" }
              }
            }
          }
        }
      }
    }),
    setConfig: async (path: string, value: unknown, options: Record<string, unknown>) => {
      writes.push({ path, value, options });
      return { stdout: JSON.stringify({ configMutation: { path, reloadKind: "none", appliedVia: "config.patch" } }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  await updateTelegramRoutePolicy({
    accountId: "main",
    groupId: "-1001",
    topicId: "2",
    patch: { agentId: "reservations", requireMention: true }
  });

  assert.deepEqual(writes.map((write) => write.path), [
    'channels.telegram.accounts["main"].groups["-1001"]["topics"]["2"]'
  ]);
  assert.deepEqual(writes[0]?.options.replacePaths, [writes[0]?.path]);
  assert.deepEqual(writes[0]?.value, {
    name: "Reservations",
    agentId: "reservations",
    requireMention: true
  });
});

test("no-op route policy changes do not write OpenClaw config", async () => {
  let writeCount = 0;
  setOpenClawAdapterForTesting({
    getConfig: async () => ({ groups: { "-1001": { requireMention: true } } }),
    setConfig: async () => {
      writeCount += 1;
      return { stdout: "", stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  const result = await updateTelegramRoutePolicy({
    accountId: "default",
    groupId: "-1001",
    patch: { requireMention: true }
  });

  assert.equal(result.changedFields.length, 0);
  assert.equal(result.applyMode, "live");
  assert.equal(writeCount, 0);
});

test("group agent fields are rejected by the policy service", async () => {
  setOpenClawAdapterForTesting({ getConfig: async () => ({}) } as unknown as OpenClawAdapter);
  await assert.rejects(
    updateTelegramRoutePolicy({ accountId: "main", groupId: "-1001", patch: { agentId: "agent-a" } }),
    /native OpenClaw bindings/i
  );
});

test("Discord channel policy uses one account-scoped native route mutation", async () => {
  const writes: Array<{ path: string; value: unknown; options: Record<string, unknown> }> = [];
  setOpenClawAdapterForTesting({
    getConfig: async () => ({
      accounts: {
        main: {
          guilds: {
            "guild-1": {
              channels: {
                "channel-1": { name: "support", enabled: true, requireMention: true, unknownFuture: { keep: true } }
              }
            }
          }
        }
      }
    }),
    setConfig: async (path: string, value: unknown, options: Record<string, unknown>) => {
      writes.push({ path, value, options });
      return { stdout: JSON.stringify({ configMutation: { path, reloadKind: "hot", appliedVia: "config.patch" } }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  const result = await updateChannelRoutePolicy({
    route: buildChannelRouteIdentity({
      provider: "discord",
      accountId: "main",
      kind: "channel",
      routeId: "channel-1",
      parentRouteId: "guild-1"
    }),
    patch: { enabled: false, requireMention: false }
  });

  assert.deepEqual(writes.map((write) => write.path), [
    'channels.discord.accounts["main"].guilds["guild-1"]["channels"]["channel-1"]'
  ]);
  assert.deepEqual(writes[0]?.value, {
    name: "support",
    enabled: false,
    requireMention: false,
    unknownFuture: { keep: true }
  });
  assert.deepEqual(writes[0]?.options.replacePaths, [writes[0]?.path]);
  assert.deepEqual(result.changedFields, ["enabled", "requireMention"]);
});

test("Slack channel and WhatsApp group policy use their provider-native scopes", async () => {
  const writes: string[] = [];
  setOpenClawAdapterForTesting({
    getConfig: async (path: string) => path.endsWith("slack")
      ? { accounts: { main: { channels: { "C1": { teamId: "T1", requireMention: true } } } } }
      : { accounts: { main: { groups: { "G1": { requireMention: true, unknownFuture: "keep" } } } } },
    setConfig: async (path: string) => {
      writes.push(path);
      return { stdout: JSON.stringify({ configMutation: { path, reloadKind: "none", appliedVia: "config.patch" } }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  await updateChannelRoutePolicy({
    route: buildChannelRouteIdentity({ provider: "slack", accountId: "main", kind: "channel", routeId: "C1", parentRouteId: "T1" }),
    patch: { requireMention: false }
  });
  await updateChannelRoutePolicy({
    route: buildChannelRouteIdentity({ provider: "whatsapp", accountId: "main", kind: "group", routeId: "G1" }),
    patch: { requireMention: false }
  });

  assert.deepEqual(writes, [
    'channels.slack.accounts["main"].channels["C1"]',
    'channels.whatsapp.accounts["main"].groups["G1"]'
  ]);
});
