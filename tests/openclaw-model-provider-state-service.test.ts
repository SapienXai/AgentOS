import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { setOpenClawAdapterForTesting, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  addOpenClawModelsToConfig,
  persistOpenClawProviderToken
} from "@/lib/openclaw/application/model-provider-state-service";

const legacyProviderFileFallbackEnv = "AGENTOS_OPENCLAW_LEGACY_PROVIDER_FILE_FALLBACK";

afterEach(() => {
  delete process.env[legacyProviderFileFallbackEnv];
  setOpenClawAdapterForTesting(null);
});

test("provider token persistence does not silently write OpenClaw auth files by default", async () => {
  await assert.rejects(
    () => persistOpenClawProviderToken("openai", "sk-test"),
    /Legacy OpenClaw provider file writes are disabled by default/
  );
});

test("adding provider models does not silently fall back to OpenClaw file writes after Gateway failure", async () => {
  const calls: string[] = [];

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      return null;
    },
    async setConfig(path: string) {
      calls.push(`set:${path}`);
      throw new Error("Gateway config update failed");
    }
  } as unknown as OpenClawAdapter);

  await assert.rejects(
    () => addOpenClawModelsToConfig("openai", ["openai/gpt-4.1"]),
    /Legacy file fallback is disabled/
  );
  assert.deepEqual(calls, [
    "get:agents.defaults.models",
    "get:agents.defaults.model.primary",
    "set:agents.defaults.models"
  ]);
});

test("adding provider models retries transient Gateway restart during config update", async () => {
  const calls: string[] = [];
  let modelSetCalls = 0;

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      if (path === "agents.defaults.models") {
        return {};
      }

      return null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      if (path === "agents.defaults.models") {
        modelSetCalls += 1;
      }

      if (path === "agents.defaults.models" && modelSetCalls === 1) {
        throw new Error("OpenClaw Gateway connection closed (1012: service restart).");
      }

      return { stdout: JSON.stringify({ ok: true, value }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  await addOpenClawModelsToConfig("openai-codex", ["openai-codex/gpt-5.5"]);

  assert.deepEqual(calls, [
    "get:agents.defaults.models",
    "get:agents.defaults.model.primary",
    "set:agents.defaults.models",
    "get:agents.defaults.models",
    "get:agents.defaults.model.primary",
    "set:agents.defaults.models",
    "set:agents.defaults.model.primary",
    "set:agents.defaults.agentRuntime.id",
    "set:plugins.entries.codex.enabled"
  ]);
});
