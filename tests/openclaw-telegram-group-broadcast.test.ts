import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getTelegramGroupBroadcast,
  setTelegramGroupBroadcast
} from "@/lib/openclaw/application/telegram-group-broadcast-service";
import { setConfigPathValue } from "@/lib/openclaw/client/native-ws-gateway-utils";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";

function createAdapter(initial: Record<string, unknown>) {
  const config = structuredClone(initial);
  const writes: Array<{ path: string; value: unknown; options: Record<string, unknown> }> = [];
  const adapter = {
    getConfigSnapshot: async () => ({ hash: "broadcast-hash", config }),
    getConfig: async (path: string) => path === "broadcast" ? config.broadcast : null,
    setConfig: async (path: string, value: unknown, options: Record<string, unknown>) => {
      writes.push({ path, value, options });
      setConfigPathValue(config, path, value);
      return {
        stdout: JSON.stringify({
          configMutation: {
            path,
            reloadKind: "hot",
            appliedVia: "config.patch",
            baseHash: "broadcast-hash",
            changedPaths: [path]
          }
        }),
        stderr: ""
      };
    }
  } as unknown as OpenClawAdapter;
  return { adapter, config, writes };
}

test("reads a qualified Telegram broadcast group from native OpenClaw config", async () => {
  const { adapter } = createAdapter({
    broadcast: {
      strategy: "sequential",
      "telegram:-100123": {
        agents: ["main", "workspace-builder"],
        mentionGating: false,
        maxRounds: 2,
        maxTurns: 4
      }
    }
  });

  assert.deepEqual(await getTelegramGroupBroadcast({ groupId: "-100123", adapter }), {
    agentIds: ["main", "workspace-builder"],
    strategy: "sequential",
    mentionGating: false,
    maxRounds: 2,
    maxTurns: 4
  });
});

test("updates one Telegram broadcast entry without dropping other broadcast groups", async () => {
  const { adapter, config, writes } = createAdapter({
    broadcast: {
      strategy: "parallel",
      "telegram:-100123": { agents: ["main"] },
      "telegram:-100456": { agents: ["other-agent"] }
    }
  });

  const result = await setTelegramGroupBroadcast({
    groupId: "-100123",
    agentIds: ["main", "workspace-builder"],
    strategy: "sequential",
    mentionGating: true,
    maxRounds: 1,
    adapter
  });

  assert.equal(result.changed, true);
  assert.deepEqual(result.broadcast?.agentIds, ["main", "workspace-builder"]);
  assert.equal(writes[0]?.path, "broadcast");
  assert.equal(writes[0]?.options.baseHash, "broadcast-hash");
  assert.deepEqual(config.broadcast, {
    strategy: "sequential",
    "telegram:-100123": {
      agents: ["main", "workspace-builder"],
      mentionGating: true,
      maxRounds: 1
    },
    "telegram:-100456": { agents: ["other-agent"] }
  });
});

test("removes one Telegram broadcast entry while preserving the broadcast strategy", async () => {
  const { adapter, config } = createAdapter({
    broadcast: {
      strategy: "parallel",
      "telegram:-100123": { agents: ["main"] },
      "telegram:-100456": { agents: ["other-agent"] }
    }
  });

  const result = await setTelegramGroupBroadcast({ groupId: "-100123", agentIds: [], adapter });

  assert.equal(result.changed, true);
  assert.equal(result.broadcast, null);
  assert.deepEqual(config.broadcast, {
    strategy: "parallel",
    "telegram:-100456": { agents: ["other-agent"] }
  });
});
