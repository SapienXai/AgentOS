import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { setOpenClawAdapterForTesting, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { upsertAgentConfigEntry, type MutableAgentConfigEntry } from "@/lib/openclaw/domains/agent-config";

afterEach(() => {
  setOpenClawAdapterForTesting(null);
});

test("agent config upsert preserves omitted fields while updating identity and model", async () => {
  let config: MutableAgentConfigEntry[] = [
    {
      id: "agent-1",
      workspace: "/workspace",
      agentDir: "/workspace/.openclaw/agents/agent-1/agent",
      name: "Agent One",
      model: "openai/old",
      identity: {
        name: "Agent One",
        emoji: "A"
      }
    }
  ];

  setOpenClawAdapterForTesting({
    async getConfig(pathName) {
      assert.equal(pathName, "agents.list");
      return config;
    },
    async setConfig(pathName, value) {
      assert.equal(pathName, "agents.list");
      config = value as MutableAgentConfigEntry[];
      return { stdout: "", stderr: "" };
    }
  } as OpenClawAdapter);

  await upsertAgentConfigEntry("agent-1", "/workspace", {
    model: "openai/new"
  });

  assert.deepEqual(config[0], {
    id: "agent-1",
    workspace: "/workspace",
    agentDir: "/workspace/.openclaw/agents/agent-1/agent",
    name: "Agent One",
    model: "openai/new",
    identity: {
      name: "Agent One",
      emoji: "A"
    }
  });

  await upsertAgentConfigEntry("agent-1", "/workspace", {
    identity: {
      name: "Agent Prime",
      theme: "violet"
    }
  });

  assert.equal(config[0]?.name, "Agent One");
  assert.deepEqual(config[0]?.identity, {
    name: "Agent Prime",
    theme: "violet"
  });
});
