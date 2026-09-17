import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { setConfigPathValue } from "@/lib/openclaw/client/native-ws-gateway-utils";
import {
  registerAndConnectTelegramGroup,
  registerTelegramGroup,
  TelegramGroupBindingConflictError,
  TelegramGroupIdError
} from "@/lib/openclaw/application/telegram-group-service";
import {
  setOpenClawAdapterForTesting,
  type OpenClawAdapter
} from "@/lib/openclaw/adapter/openclaw-adapter";

afterEach(() => setOpenClawAdapterForTesting(null));

function createConfigAdapter(initial: Record<string, unknown>, options: { persistWrites?: boolean } = {}) {
  const config = structuredClone(initial);
  const writes: Array<{ path: string; value: unknown; options: Record<string, unknown> }> = [];
  const adapter = {
    getConfigSnapshot: async () => ({ hash: "hash-telegram", config }),
    getConfig: async (path: string) => path === "channels.telegram" ? (config.channels as Record<string, unknown>).telegram : null,
    setConfig: async (path: string, value: unknown, nextOptions: Record<string, unknown>) => {
      writes.push({ path, value, options: nextOptions });
      if (options.persistWrites !== false) setConfigPathValue(config, path, value);
      return {
        stdout: JSON.stringify({
          configMutation: {
            path,
            reloadKind: "hot",
            hotReloaded: true,
            appliedVia: "config.patch",
            baseHash: "hash-telegram",
            changedPaths: [path]
          }
        }),
        stderr: ""
      };
    }
  } as unknown as OpenClawAdapter;

  return { adapter, config, writes };
}

test("registers a root Telegram group without replacing wildcard, policy, or unknown fields", async () => {
  const { adapter, config, writes } = createConfigAdapter({
    bindings: [],
    channels: {
      telegram: {
        botToken: "redacted",
        groupPolicy: "allowlist",
        allowFrom: ["operator-1"],
        groups: {
          "*": { enabled: true, requireMention: false, tools: { allow: ["message"] } },
          "-1001000000001": { requireMention: false, unknownFuture: { keep: true } }
        }
      }
    }
  });

  const result = await registerTelegramGroup({
    accountId: "default",
    groupId: "-1001234567890",
    adapter
  });

  assert.equal(result.changed, true);
  assert.equal(result.verification.verified, true);
  assert.equal(result.verification.accountScope, "root");
  assert.deepEqual(writes.map((write) => write.path), [
    'channels.telegram.groups["-1001234567890"]'
  ]);
  assert.equal(writes[0]?.options.baseHash, "hash-telegram");
  assert.deepEqual(writes[0]?.value, { requireMention: true });
  const groups = (config.channels as Record<string, unknown>).telegram as Record<string, unknown>;
  assert.deepEqual(groups.groupPolicy, "allowlist");
  assert.deepEqual(groups.allowFrom, ["operator-1"]);
  assert.deepEqual(groups.groups, {
    "*": { enabled: true, requireMention: false, tools: { allow: ["message"] } },
    "-1001000000001": { requireMention: false, unknownFuture: { keep: true } },
    "-1001234567890": { requireMention: true }
  });
});

test("writes a named account's group into root when the account inherits root groups", async () => {
  const { adapter, writes } = createConfigAdapter({
    channels: {
      telegram: {
        groups: { "-100-root": { requireMention: true } },
        accounts: { support: { botToken: "redacted", unknownFuture: "keep" } }
      }
    }
  });

  const result = await registerTelegramGroup({ accountId: "support", groupId: "-1001000000002", adapter });

  assert.equal(result.verification.accountScope, "root");
  assert.equal(writes[0]?.path, 'channels.telegram.groups["-1001000000002"]');
});

test("keeps explicit account groups isolated and preserves an intentionally empty map", async () => {
  const explicit = createConfigAdapter({
    channels: {
      telegram: {
        groups: { "-100-root": { unknownFuture: true } },
        accounts: {
          support: {
            groups: { "-1001000000003": { topics: { "1": { name: "General" } }, requireMention: false } },
            groupPolicy: "allowlist"
          }
        }
      }
    }
  });
  const explicitResult = await registerTelegramGroup({ accountId: "support", groupId: "-1001000000004", adapter: explicit.adapter });
  assert.equal(explicitResult.verification.accountScope, "account");
  assert.equal(explicit.writes[0]?.path, 'channels.telegram.accounts["support"].groups["-1001000000004"]');
  const explicitConfig = (explicit.config.channels as Record<string, unknown>).telegram as Record<string, unknown>;
  const explicitAccount = (explicitConfig.accounts as Record<string, unknown>).support as Record<string, unknown>;
  assert.deepEqual(explicitAccount.groups, {
    "-1001000000003": { topics: { "1": { name: "General" } }, requireMention: false },
    "-1001000000004": { requireMention: true }
  });
  assert.deepEqual(explicitConfig.groups, { "-100-root": { unknownFuture: true } });

  const empty = createConfigAdapter({
    channels: {
      telegram: {
        groups: { "-100-root": { requireMention: false } },
        accounts: { support: { groups: {}, unknownFuture: { keep: true } } }
      }
    }
  });
  const emptyResult = await registerTelegramGroup({ accountId: "support", groupId: "-1001000000005", adapter: empty.adapter });
  assert.equal(emptyResult.verification.accountScope, "account");
  assert.equal(empty.writes[0]?.path, 'channels.telegram.accounts["support"].groups["-1001000000005"]');
});

test("duplicate group registration is idempotent and does not change its existing policy", async () => {
  const { adapter, writes } = createConfigAdapter({
    channels: {
      telegram: {
        groups: { "-1001000000006": { requireMention: false, topics: { "1": { name: "General" } } } }
      }
    }
  });

  const result = await registerTelegramGroup({ accountId: "default", groupId: "-1001000000006", adapter });

  assert.equal(result.changed, false);
  assert.equal(result.mutation, null);
  assert.deepEqual(writes, []);
});

test("rejects non-numeric Telegram group IDs", async () => {
  await assert.rejects(
    registerTelegramGroup({ accountId: "default", groupId: "not-a-group", adapter: {} as OpenClawAdapter }),
    (error: unknown) => error instanceof TelegramGroupIdError
  );
});

test("reports a failed canonical readback instead of claiming success", async () => {
  const { adapter, writes } = createConfigAdapter({
    channels: { telegram: { groups: {} } }
  }, { persistWrites: false });

  await assert.rejects(
    registerTelegramGroup({ accountId: "default", groupId: "-1001000000007", adapter }),
    /group was saved, but OpenClaw has not confirmed/i
  );
  assert.equal(writes.length, 1);
});

test("does not silently steal a Telegram route owned by another agent", async () => {
  const { adapter, writes } = createConfigAdapter({
    bindings: [{
      agentId: "existing-agent",
      match: { channel: "telegram", accountId: "default", peer: { kind: "group", id: "-1001000000008" } }
    }],
    channels: { telegram: { groups: {} } }
  });

  await assert.rejects(
    registerAndConnectTelegramGroup({ accountId: "default", groupId: "-1001000000008", agentId: "new-agent", adapter }),
    (error: unknown) => error instanceof TelegramGroupBindingConflictError && error.existingAgentId === "existing-agent"
  );
  assert.deepEqual(writes, []);
});

test("overrides a broad Telegram route with an exact group binding", async () => {
  const { adapter, config, writes } = createConfigAdapter({
    bindings: [{
      agentId: "main",
      match: { channel: "telegram", accountId: "*" }
    }],
    channels: {
      telegram: {
        groups: { "-1001000000008": { requireMention: true } }
      }
    }
  });

  const result = await registerAndConnectTelegramGroup({
    accountId: "default",
    groupId: "-1001000000008",
    agentId: "workspace-builder",
    adapter
  });

  assert.equal(result.bindingVerification.verified, true);
  assert.deepEqual(writes.map((write) => write.path), ["bindings"]);
  assert.deepEqual(config.bindings, [
    {
      agentId: "main",
      match: { channel: "telegram", accountId: "*" }
    },
    {
      agentId: "workspace-builder",
      match: {
        channel: "telegram",
        accountId: "default",
        peer: { kind: "group", id: "-1001000000008" }
      }
    }
  ]);
});

test("connects a newly registered group with requireMention enabled and verifies native binding", async () => {
  const { adapter, config, writes } = createConfigAdapter({
    bindings: [],
    channels: {
      telegram: {
        groupPolicy: "allowlist",
        allowFrom: ["operator-1"],
        groups: { "*": { requireMention: false }, "-1001000000009": { tools: { allow: ["message"] } } }
      }
    }
  });

  const result = await registerAndConnectTelegramGroup({
    accountId: "default",
    groupId: "-1001000000010",
    agentId: "agent-a",
    adapter
  });

  assert.equal(result.registration.verification.verified, true);
  assert.equal(result.bindingVerification.verified, true);
  assert.deepEqual(writes.map((write) => write.path), [
    'channels.telegram.groups["-1001000000010"]',
    "bindings"
  ]);
  const telegram = (config.channels as Record<string, unknown>).telegram as Record<string, unknown>;
  assert.deepEqual(telegram.groupPolicy, "allowlist");
  assert.deepEqual(telegram.allowFrom, ["operator-1"]);
  assert.deepEqual((telegram.groups as Record<string, unknown>)["-1001000000010"], { requireMention: true });
  assert.deepEqual(config.bindings, [{
    agentId: "agent-a",
    match: { channel: "telegram", accountId: "default", peer: { kind: "group", id: "-1001000000010" } }
  }]);
});
