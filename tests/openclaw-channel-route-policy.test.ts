import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  setOpenClawAdapterForTesting,
  type OpenClawAdapter
} from "@/lib/openclaw/adapter/openclaw-adapter";
import { updateTelegramRoutePolicy } from "@/lib/openclaw/application/channel-route-policy-service";

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
  assert.equal(result.baseHash, null, "multiple leaf mutations are reported as an aggregate without a single hash");
  assert.deepEqual(writes.map((write) => write.path), [
    'channels.telegram.accounts["support"].groups["-100-support"]["requireMention"]',
    'channels.telegram.accounts["support"].groups["-100-support"]["groupAllowFrom"]'
  ]);
  assert.deepEqual(writes[1]?.options.replacePaths, [writes[1]?.path]);
  assert.deepEqual(writes[0]?.value, false);
  assert.deepEqual(writes[1]?.value, ["user-1"]);
});

test("Telegram topic policy mutates only selected fields and preserves sibling topics", async () => {
  const writes: Array<{ path: string; value: unknown }> = [];
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
    setConfig: async (path: string, value: unknown) => {
      writes.push({ path, value });
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
    'channels.telegram.accounts["main"].groups["-1001"]["2"]["requireMention"]',
    'channels.telegram.accounts["main"].groups["-1001"]["2"]["agentId"]'
  ]);
  assert.deepEqual(writes.map((write) => write.value), [true, "reservations"]);
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
