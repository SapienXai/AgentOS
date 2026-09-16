import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  readTelegramGroupPermissions,
  updateTelegramGroupPermissions
} from "@/lib/openclaw/application/telegram-group-permissions-service";
import { setOpenClawAdapterForTesting, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { setConfigPathValue } from "@/lib/openclaw/client/native-ws-gateway-utils";

afterEach(() => setOpenClawAdapterForTesting(null));

function createConfigAdapter(initial: Record<string, unknown>) {
  const config = structuredClone(initial);
  const writes: Array<{ path: string; value: unknown; options: Record<string, unknown> }> = [];
  const adapter = {
    getConfigSnapshot: async () => ({ hash: "hash-permissions", config }),
    getConfig: async (path: string) => path === "channels.telegram" ? (config.channels as Record<string, unknown>).telegram : null,
    getToolsCatalog: async () => ({
      agentId: "agent-a",
      profiles: [],
      groups: [{
        id: "web",
        label: "Web",
        source: "core",
        tools: [
          { id: "web_search", label: "web_search", description: "Search", source: "core", defaultProfiles: ["coding"] },
          { id: "web_fetch", label: "web_fetch", description: "Fetch", source: "core", defaultProfiles: ["coding"] }
        ]
      }]
    }),
    listSkills: async () => ({ skills: [] }),
    listAgents: async () => ({ agents: [{ id: "agent-a", name: "Agent A" }] }),
    setConfig: async (path: string, value: unknown, options: Record<string, unknown>) => {
      writes.push({ path, value, options });
      setConfigPathValue(config, path, value);
      return {
        stdout: JSON.stringify({
          configMutation: {
            path,
            reloadKind: "hot",
            hotReloaded: true,
            appliedVia: "config.patch",
            baseHash: "hash-permissions",
            changedPaths: [path]
          }
        }),
        stderr: ""
      };
    }
  } as unknown as OpenClawAdapter;
  return { adapter, config, writes };
}

test("reads and patches Telegram access and Chat only without changing sibling config", async () => {
  const { adapter, config, writes } = createConfigAdapter({
    channels: {
      telegram: {
        groupPolicy: "open",
        groups: {
          "*": {
            requireMention: false,
            tools: { allow: ["web_search", "web_fetch"] },
            unknownFuture: { preserve: true }
          },
          "-1001234567890": {
            requireMention: true,
            unknownGroupField: "keep"
          }
        }
      }
    }
  });

  const before = await readTelegramGroupPermissions({ accountId: "default", groupId: "-1001234567890", agentId: "agent-a", adapter });
  assert.equal(before.access.mode, "anyone");
  assert.equal(before.response.requireMention, true);
  assert.equal(before.capabilities.preset, "research");

  const result = await updateTelegramGroupPermissions({
    accountId: "default",
    groupId: "-1001234567890",
    agentId: "agent-a",
    adapter,
    patch: {
      access: { mode: "selected", senderIds: ["12345", "67890"] },
      requireMention: false,
      capabilities: { preset: "chat-only" }
    }
  });

  assert.deepEqual(result.changedFields.sort(), ["access", "capabilities", "requireMention"]);
  assert.equal(writes[0]?.path, 'channels.telegram.groups["-1001234567890"]');
  assert.equal(writes[0]?.options.baseHash, "hash-permissions");
  assert.deepEqual((config.channels as Record<string, unknown>).telegram, {
    groupPolicy: "open",
    groups: {
      "*": {
        requireMention: false,
        tools: { allow: ["web_search", "web_fetch"] },
        unknownFuture: { preserve: true }
      },
      "-1001234567890": {
        requireMention: false,
        unknownGroupField: "keep",
        groupPolicy: "allowlist",
        allowFrom: ["12345", "67890"],
        tools: { deny: ["*"] }
      }
    }
  });
  assert.equal(result.permissions.access.mode, "selected");
  assert.equal(result.permissions.capabilities.preset, "chat-only");
});

test("keeps named-account Telegram groups isolated and writes sender IDs, not the group ID", async () => {
  const { adapter, config, writes } = createConfigAdapter({
    channels: {
      telegram: {
        groups: { "-100-root": { unknown: true } },
        accounts: {
          support: {
            groupPolicy: "allowlist",
            groups: { "-1001234567890": { requireMention: true } }
          }
        }
      }
    }
  });

  const result = await updateTelegramGroupPermissions({
    accountId: "support",
    groupId: "-1001234567890",
    agentId: "agent-a",
    adapter,
    patch: { access: { mode: "selected", senderIds: ["24680"] } }
  });

  assert.equal(result.groupPath, 'channels.telegram.accounts["support"].groups["-1001234567890"]');
  assert.deepEqual(writes.map((write) => write.path), [result.groupPath]);
  const telegram = (config.channels as Record<string, unknown>).telegram as Record<string, unknown>;
  assert.deepEqual(telegram.groups, { "-100-root": { unknown: true } });
  assert.deepEqual((telegram.accounts as Record<string, unknown>).support, {
    groupPolicy: "allowlist",
    groups: { "-1001234567890": { requireMention: true, groupPolicy: "allowlist", allowFrom: ["24680"] } }
  });
});

test("rejects a Telegram group ID when the selected-person list contains a group ID", async () => {
  const { adapter } = createConfigAdapter({ channels: { telegram: { groups: {} } } });
  await assert.rejects(
    updateTelegramGroupPermissions({
      accountId: "default",
      groupId: "-1001234567890",
      agentId: "agent-a",
      adapter,
      patch: { access: { mode: "selected", senderIds: ["-1009876543210"] } }
    }),
    /sender IDs must be numeric user IDs/
  );
});

test("Agent defaults shadows a wildcard tools policy without deleting the wildcard", async () => {
  const { adapter, config, writes } = createConfigAdapter({
    channels: {
      telegram: {
        groups: {
          "*": { tools: { deny: ["*"] } }
        }
      }
    }
  });

  const result = await updateTelegramGroupPermissions({
    accountId: "default",
    groupId: "-1001234567890",
    agentId: "agent-a",
    adapter,
    patch: { capabilities: { preset: "agent-defaults" } }
  });

  assert.equal(writes[0]?.path, 'channels.telegram.groups["-1001234567890"]');
  assert.deepEqual((config.channels as Record<string, unknown>).telegram, {
    groups: {
      "*": { tools: { deny: ["*"] } },
      "-1001234567890": { tools: {} }
    }
  });
  assert.equal(result.permissions.capabilities.preset, "agent-defaults");
});

test("Anyone removes a stale group sender override because Telegram checks allowFrom first", async () => {
  const { adapter, config } = createConfigAdapter({
    channels: {
      telegram: {
        groups: {
          "-1001234567890": { groupPolicy: "allowlist", allowFrom: ["24680"] }
        }
      }
    }
  });

  const result = await updateTelegramGroupPermissions({
    accountId: "default",
    groupId: "-1001234567890",
    agentId: "agent-a",
    adapter,
    patch: { access: { mode: "anyone" } }
  });

  const telegram = (config.channels as Record<string, unknown>).telegram as Record<string, unknown>;
  assert.deepEqual(telegram.groups, { "-1001234567890": { groupPolicy: "open" } });
  assert.equal(result.permissions.access.mode, "anyone");
});
