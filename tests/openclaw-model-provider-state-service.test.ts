import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { setOpenClawAdapterForTesting, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  addOpenClawModelsToConfig,
  persistOpenClawProviderToken,
  setOpenClawDefaultModel
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
    "get:agents.defaults",
    "set:agents.defaults"
  ]);
});

test("adding provider models retries transient Gateway restart during config update", async () => {
  const calls: string[] = [];
  let modelSetCalls = 0;

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      if (path === "agents.defaults") {
        return { models: {} };
      }

      return null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      if (path === "agents.defaults") {
        modelSetCalls += 1;
      }

      if (path === "agents.defaults" && modelSetCalls === 1) {
        throw new Error("OpenClaw Gateway connection closed (1012: service restart).");
      }

      return { stdout: JSON.stringify({ ok: true, value }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  await addOpenClawModelsToConfig("openai-codex", ["openai-codex/gpt-5.5"]);

  assert.deepEqual(calls, [
    "get:agents.defaults",
    "set:agents.defaults",
    "get:agents.defaults",
    "set:agents.defaults",
    "set:plugins.entries.codex.enabled"
  ]);
});

test("setting the default model writes OpenClaw Gateway config", async () => {
  const calls: string[] = [];
  const values = new Map<string, unknown>();

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      return path === "agents.defaults"
        ? { models: { "openrouter/old": {} } }
        : null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      values.set(path, value);
      return { stdout: JSON.stringify({ ok: true, value }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  const result = await setOpenClawDefaultModel("openrouter/google/gemma-4-31b-it:free", {
    provider: "openrouter"
  });

  assert.deepEqual(result, {
    modelId: "openrouter/google/gemma-4-31b-it:free",
    provider: "openrouter",
    via: "gateway"
  });
  assert.deepEqual(calls, [
    "get:agents.defaults",
    "set:agents.defaults"
  ]);
  assert.deepEqual(values.get("agents.defaults"), {
    models: {
      "openrouter/old": {},
      "openrouter/google/gemma-4-31b-it:free": {}
    },
    model: {
      primary: "openrouter/google/gemma-4-31b-it:free"
    }
  });
});

test("setting a Codex default model normalizes the model ref and enables Codex runtime", async () => {
  const calls: string[] = [];
  const values = new Map<string, unknown>();

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      return path === "agents.defaults" ? { models: {} } : null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      values.set(path, value);
      return { stdout: JSON.stringify({ ok: true, value }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  const result = await setOpenClawDefaultModel("openai-codex/gpt-5.5", {
    provider: "openai-codex"
  });

  assert.deepEqual(result, {
    modelId: "openai/gpt-5.5",
    provider: "openai-codex",
    via: "gateway"
  });
  assert.deepEqual(calls, [
    "get:agents.defaults",
    "set:agents.defaults",
    "set:plugins.entries.codex.enabled"
  ]);
  assert.deepEqual(values.get("agents.defaults"), {
    models: {
      "openai/gpt-5.5": {}
    },
    model: {
      primary: "openai/gpt-5.5"
    },
    agentRuntime: {
      id: "codex"
    }
  });
  assert.equal(values.get("plugins.entries.codex.enabled"), true);
});

test("setting the default model does not silently fall back to OpenClaw file writes after Gateway failure", async () => {
  const calls: string[] = [];

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      return {};
    },
    async setConfig(path: string) {
      calls.push(`set:${path}`);
      throw new Error("Gateway config update failed");
    }
  } as unknown as OpenClawAdapter);

  await assert.rejects(
    () => setOpenClawDefaultModel("openrouter/test", { provider: "openrouter" }),
    /Legacy file fallback is disabled/
  );
  assert.deepEqual(calls, [
    "get:agents.defaults",
    "set:agents.defaults"
  ]);
});

test("setting the default model surfaces Gateway config rate limits without fallback", async () => {
  const calls: string[] = [];

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      return { models: {} };
    },
    async setConfig(path: string) {
      calls.push(`set:${path}`);
      throw new Error("UNAVAILABLE: rate limit exceeded for config.patch; retry after 60s");
    }
  } as unknown as OpenClawAdapter);

  await assert.rejects(
    () => setOpenClawDefaultModel("openai/gpt-5.4-mini", { provider: "openai-codex" }),
    /rate limiting config updates.*Wait about 1 minute.*did not use CLI or legacy file fallback/
  );
  assert.deepEqual(calls, [
    "get:agents.defaults",
    "set:agents.defaults"
  ]);
});
