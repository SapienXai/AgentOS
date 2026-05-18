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
    async call(method: string) {
      calls.push(method);
      if (method === "config.get") {
        return { hash: "hash-1", config: { agents: { defaults: {} } } };
      }

      throw new Error("Gateway config.patch failed");
    }
  } as unknown as OpenClawAdapter);

  await assert.rejects(
    () => addOpenClawModelsToConfig("openai", ["openai/gpt-4.1"]),
    /Legacy file fallback is disabled/
  );
  assert.deepEqual(calls, ["config.get", "config.patch"]);
});

test("adding provider models retries transient Gateway restart during config patch", async () => {
  const calls: string[] = [];
  let patchCalls = 0;

  setOpenClawAdapterForTesting({
    async call(method: string) {
      calls.push(method);
      if (method === "config.get") {
        return { hash: `hash-${calls.length}`, config: { agents: { defaults: {} } } };
      }

      patchCalls += 1;
      if (patchCalls === 1) {
        throw new Error("OpenClaw Gateway connection closed (1012: service restart).");
      }

      return { ok: true };
    }
  } as unknown as OpenClawAdapter);

  await addOpenClawModelsToConfig("openai-codex", ["openai-codex/gpt-5.5"]);

  assert.deepEqual(calls, ["config.get", "config.patch", "config.get", "config.patch"]);
});
