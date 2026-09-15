import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  setOpenClawAdapterForTesting,
  type OpenClawAdapter
} from "@/lib/openclaw/adapter/openclaw-adapter";
import { updateTelegramRoutePolicy } from "@/lib/openclaw/application/channel-route-policy-service";

afterEach(() => setOpenClawAdapterForTesting(null));

test("Telegram account policy writes stay inside the named account scope", async () => {
  const writes: Array<{ path: string; value: unknown }> = [];
  setOpenClawAdapterForTesting({
    getConfig: async () => ({
      groups: { "-100-root": { requireMention: true } },
      accounts: { support: { token: "redacted", groups: { "-100-support": { requireMention: true } } } }
    }),
    setConfig: async (path: string, value: unknown) => {
      writes.push({ path, value });
      return { stdout: "", stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  const result = await updateTelegramRoutePolicy({
    accountId: "support",
    groupId: "-100-support",
    patch: { requireMention: false, allowFrom: ["user-1"] }
  });

  assert.equal(result.restartRequired, true);
  assert.equal(writes[0]?.path, 'channels.telegram.accounts["support"].groups');
  assert.deepEqual(writes[0]?.value, {
    "-100-support": { requireMention: false, groupAllowFrom: ["user-1"] }
  });
});

test("Telegram topic policy preserves sibling topics and supports native agentId", async () => {
  const writes: Array<{ path: string; value: unknown }> = [];
  setOpenClawAdapterForTesting({
    getConfig: async () => ({
      accounts: {
        main: {
          groups: {
            "-1001": {
              name: "Operations",
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
      return { stdout: "", stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  await updateTelegramRoutePolicy({
    accountId: "main",
    groupId: "-1001",
    topicId: "2",
    patch: { agentId: "reservations", requireMention: true }
  });

  assert.equal(writes[0]?.path, 'channels.telegram.accounts["main"].groups');
  assert.deepEqual(writes[0]?.value, {
    "-1001": {
      name: "Operations",
      topics: {
        "1": { name: "General" },
        "2": { name: "Reservations", agentId: "reservations", requireMention: true }
      }
    }
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
  assert.equal(writeCount, 0);
});
