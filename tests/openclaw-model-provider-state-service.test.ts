import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { setOpenClawAdapterForTesting, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  GET as modelsProviderGet,
  POST as modelsProviderPost
} from "@/app/api/models/providers/route";
import {
  addOpenClawExplicitProviderModelsToConfig,
  addOpenClawModelsToConfig,
  ensureOpenClawModelRuntimeConfig,
  persistOpenClawProviderToken,
  readOpenClawCodexPluginReady,
  removeOpenClawConfiguredModelFromConfig,
  setOpenClawDefaultModel
} from "@/lib/openclaw/application/model-provider-state-service";

const legacyProviderFileFallbackEnv = "AGENTOS_OPENCLAW_LEGACY_PROVIDER_FILE_FALLBACK";
const originalFetch = globalThis.fetch;

function fetchRouteGet() {
  return modelsProviderGet();
}

afterEach(() => {
  delete process.env[legacyProviderFileFallbackEnv];
  setOpenClawAdapterForTesting(null);
  globalThis.fetch = originalFetch;
});

test("provider token persistence does not silently write OpenClaw auth files by default", async () => {
  await assert.rejects(
    () => persistOpenClawProviderToken("openai", "sk-test"),
    /Legacy OpenClaw provider file writes are disabled by default/
  );
});

test("model removal unsets the exact configured model key before rewriting defaults", async () => {
  const calls: string[] = [];
  const defaults: {
    model: { primary: string };
    models: Record<string, Record<string, unknown>>;
  } = {
    model: {
      primary: "openai/gpt-5.5"
    },
    models: {
      "openai/gpt-5.5": {},
      "anthropic/claude-sonnet-4-6": {
        alias: "sonnet"
      },
      "openai/o4-mini": {}
    }
  };

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      if (path === "agents.defaults") {
        return structuredClone(defaults) as never;
      }

      if (path === "agents.defaults.models") {
        return structuredClone(defaults.models) as never;
      }

      return null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      if (path === "agents.defaults") {
        Object.assign(defaults, value);
      }
      return { stdout: "", stderr: "", code: 0 };
    },
    async unsetConfig(path: string) {
      calls.push(`unset:${path}`);
      if (path === 'agents.defaults.models["anthropic/claude-sonnet-4-6"]') {
        delete defaults.models["anthropic/claude-sonnet-4-6"];
      }
      return { stdout: "", stderr: "", code: 0 };
    }
  } as unknown as OpenClawAdapter);

  await removeOpenClawConfiguredModelFromConfig("anthropic/claude-sonnet-4-6", {
    provider: "anthropic"
  });

  assert.deepEqual(calls, [
    'unset:agents.defaults.models["anthropic/claude-sonnet-4-6"]',
    "set:agents.defaults"
  ]);
  assert.equal("anthropic/claude-sonnet-4-6" in defaults.models, false);
  assert.equal("openai/o4-mini" in defaults.models, true);
});

test("custom provider connect writes an explicit OpenClaw provider and namespaces discovered models", async () => {
  const calls: Array<{ path: string; value: unknown }> = [];
  const configs = new Map<string, unknown>([
    [
      "agents.defaults.models",
      {
        "openai/gpt-5.4": {}
      }
    ]
  ]);
  let fetchUrl = "";
  let authHeader = "";

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      return configs.has(path) ? configs.get(path) as never : null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push({ path, value });
      configs.set(path, value);
      return { stdout: "", stderr: "", code: 0 };
    },
    async getModelStatus() {
      return {
        allowed: [],
        auth: {
          providers: [],
          oauth: {
            providers: []
          }
        }
      };
    }
  } as unknown as OpenClawAdapter);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchUrl = String(input);
    authHeader = String(init?.headers instanceof Headers
      ? init.headers.get("Authorization")
      : (init?.headers as Record<string, string> | undefined)?.Authorization ?? "");

    return new Response(
      JSON.stringify({
        data: [
          { id: "gpt-oss-120b" },
          { id: "gpt-5.4" }
        ]
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    );
  }) as typeof fetch;

  const response = await modelsProviderPost(
    new Request("http://agentos.test/api/models/providers", {
      method: "POST",
      body: JSON.stringify({
        action: "connect",
        provider: "entrim",
        providerName: "Entrim",
        endpoint: "https://api.entrim.ai/v1",
        apiKey: "sk-entrim-test"
      })
    })
  );
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.provider, "entrim");
  assert.equal(payload.connection.connected, true);
  assert.match(payload.connection.detail, /Endpoint: https:\/\/api\.entrim\.ai\/v1/);
  assert.equal(fetchUrl, "https://api.entrim.ai/v1/models");
  assert.equal(authHeader, "Bearer sk-entrim-test");
  assert.doesNotMatch(serialized, /sk-entrim-test/);
  assert.deepEqual(
    payload.models.map((model: { id: string; alreadyAdded?: boolean }) => ({
      id: model.id,
      alreadyAdded: model.alreadyAdded
    })),
    [
      {
        id: "entrim/gpt-oss-120b",
        alreadyAdded: false
      },
      {
        id: "entrim/gpt-5.4",
        alreadyAdded: false
      }
    ]
  );
  assert.deepEqual(calls, [
    {
      path: "models.providers.entrim",
      value: {
        baseUrl: "https://api.entrim.ai/v1",
        apiKey: "sk-entrim-test",
        api: "openai-completions",
        models: [
          {
            id: "gpt-oss-120b",
            name: "gpt-oss-120b"
          },
          {
            id: "gpt-5.4",
            name: "gpt-5.4"
          }
        ]
      }
    }
  ]);
});

test("adding custom provider models writes explicit provider metadata and AgentOS defaults", async () => {
  const calls: string[] = [];
  const configs = new Map<string, unknown>([
    [
      "models.providers.entrim",
      {
        name: "Legacy Entrim",
        label: "Legacy Entrim",
        models: [
          {
            id: "gpt-oss-120b",
            name: "GPT OSS 120B"
          }
        ],
        apiKey: "[redacted]",
        baseUrl: "https://api.entrim.ai/v1"
      }
    ],
    [
      "agents.defaults",
      {}
    ]
  ]);

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      return configs.has(path) ? configs.get(path) as never : null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      configs.set(path, value);
      return { stdout: "", stderr: "", code: 0 };
    },
  } as unknown as OpenClawAdapter);

  await addOpenClawExplicitProviderModelsToConfig(
    "entrim",
    ["entrim/gpt-oss-120b"],
    [
      {
        id: "gpt-oss-120b",
        name: "GPT OSS 120B",
        input: "text",
        contextWindow: null,
        maxTokens: null
      }
    ]
  );

  assert.deepEqual(calls, [
    "get:models.providers.entrim",
    "set:models.providers.entrim.models",
    "get:agents.defaults",
    "set:agents.defaults"
  ]);
  assert.deepEqual(configs.get("models.providers.entrim.models"), [
    {
      id: "gpt-oss-120b",
      name: "GPT OSS 120B",
      input: ["text"]
    }
  ]);
  assert.deepEqual(configs.get("models.providers.entrim"), {
    name: "Legacy Entrim",
    label: "Legacy Entrim",
    models: [
      {
        id: "gpt-oss-120b",
        name: "GPT OSS 120B"
      }
    ],
    apiKey: "[redacted]",
    baseUrl: "https://api.entrim.ai/v1"
  });
  assert.deepEqual(configs.get("agents.defaults"), {
    models: {
      "entrim/gpt-oss-120b": {}
    }
  });
});

test("custom provider list returns explicit providers without exposing secrets", async () => {
  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      if (path === "models.providers") {
        return {
          openai: {
            apiKey: "[redacted]",
            models: [{ id: "gpt-5.4" }]
          },
          entrim: {
            apiKey: "[redacted]",
            baseUrl: "https://api.entrim.ai/v1",
            models: [
              {
                id: "gpt-oss-120b",
                name: "GPT OSS 120B"
              }
            ]
          }
        };
      }

      return null;
    }
  } as unknown as OpenClawAdapter);

  const response = await fetchRouteGet();
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 200);
  assert.deepEqual(payload.providers, [
    {
      id: "entrim",
      baseUrl: "https://api.entrim.ai/v1",
      modelCount: 1
    }
  ]);
  assert.doesNotMatch(serialized, /apiKey|redacted/);
});

test("OpenRouter connect returns terminal paste-token handoff when native token persistence is unavailable", async () => {
  setOpenClawAdapterForTesting({
    async getConfig() {
      return {};
    },
    async getModelStatus() {
      return {
        allowed: [],
        auth: {
          providers: [],
          oauth: {
            providers: []
          }
        }
      };
    }
  } as unknown as OpenClawAdapter);

  const response = await modelsProviderPost(
    new Request("http://agentos.test/api/models/providers", {
      method: "POST",
      body: JSON.stringify({
        action: "connect",
        provider: "openrouter",
        apiKey: "sk-or-test-secret"
      })
    })
  );
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.match(payload.manualCommand, /models auth paste-token --provider openrouter/);
  assert.doesNotMatch(serialized, /sk-or-test-secret/);
});

test("Codex plugin readiness requires the plugin registry entry", async () => {
  setOpenClawAdapterForTesting({
    async listPlugins() {
      return {
        plugins: [
          {
            id: "codex",
            name: "@openclaw/codex",
            status: "enabled"
          }
        ]
      };
    }
  } as unknown as OpenClawAdapter);

  assert.equal(await readOpenClawCodexPluginReady(), true);
});

test("Codex plugin readiness rejects missing or failed registry entries", async () => {
  setOpenClawAdapterForTesting({
    async listPlugins() {
      return {
        plugins: [
          {
            id: "other",
            name: "Other"
          },
          {
            id: "@openclaw/codex",
            name: "@openclaw/codex",
            status: "error"
          }
        ]
      };
    }
  } as unknown as OpenClawAdapter);

  assert.equal(await readOpenClawCodexPluginReady(), false);
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
  const values = new Map<string, unknown>();
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
      values.set(path, value);
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
  assert.deepEqual(values.get("agents.defaults"), {
    models: {
      "openai/gpt-5.5": {
        agentRuntime: {
          id: "codex"
        }
      }
    },
    model: {
      primary: "openai/gpt-5.5"
    }
  });
});

test("setting the default model retries and starts Gateway after transient connect failures", async () => {
  const calls: string[] = [];
  let defaultsReads = 0;

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      if (path === "agents.defaults") {
        defaultsReads += 1;

        if (defaultsReads === 1) {
          throw new Error("Failed to connect to OpenClaw Gateway.");
        }

        return { models: {} };
      }

      return null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      return { stdout: JSON.stringify({ ok: true, value }), stderr: "" };
    },
    async controlGateway(action: "start") {
      calls.push(`gateway:${action}`);
      return { ok: true, action };
    }
  } as unknown as OpenClawAdapter);

  const result = await setOpenClawDefaultModel("openai/gpt-5.4-mini", {
    provider: "openai-codex"
  });

  assert.equal(result.modelId, "openai/gpt-5.4-mini");
  assert.equal(result.via, "gateway");
  assert.deepEqual(calls, [
    "get:agents.defaults",
    "gateway:start",
    "get:agents.defaults",
    "set:agents.defaults",
    "set:plugins.entries.codex.enabled"
  ]);
});

test("setting the default model retries while Gateway is still starting", async () => {
  const calls: string[] = [];
  const values = new Map<string, unknown>();
  let defaultsWrites = 0;

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
      values.set(path, value);
      if (path === "agents.defaults") {
        defaultsWrites += 1;
      }

      if (path === "agents.defaults" && defaultsWrites === 1) {
        throw new Error("UNAVAILABLE: gateway starting; retry shortly");
      }

      return { stdout: JSON.stringify({ ok: true, value }), stderr: "" };
    },
    async controlGateway(action: "start") {
      calls.push(`gateway:${action}`);
      return { ok: true, action };
    }
  } as unknown as OpenClawAdapter);

  const result = await setOpenClawDefaultModel("openai/gpt-5.4-mini", {
    provider: "openai"
  });

  assert.equal(result.modelId, "openai/gpt-5.4-mini");
  assert.equal(result.via, "gateway");
  assert.deepEqual(calls, [
    "get:agents.defaults",
    "set:agents.defaults",
    "gateway:start",
    "get:agents.defaults",
    "set:agents.defaults"
  ]);
  assert.deepEqual(values.get("agents.defaults"), {
    models: {
      "openai/gpt-5.4-mini": {
        agentRuntime: {
          id: "openclaw"
        }
      }
    },
    model: {
      primary: "openai/gpt-5.4-mini"
    }
  });
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

test("setting an Ollama default model registers the provider model before changing the default", async () => {
  const calls: string[] = [];
  const values = new Map<string, unknown>();

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      if (path === "models.providers.ollama") {
        return {
          models: [
            {
              id: "llama3:8b",
              name: "llama3:8b"
            }
          ]
        };
      }

      if (path === "agents.defaults") {
        return { models: {} };
      }

      return null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      values.set(path, value);
      return { stdout: JSON.stringify({ ok: true, value }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  const result = await setOpenClawDefaultModel("ollama/qwen3.5:9b", {
    provider: "ollama"
  });

  assert.deepEqual(result, {
    modelId: "ollama/qwen3.5:9b",
    provider: "ollama",
    via: "gateway"
  });
  assert.deepEqual(calls, [
    "get:models.providers.ollama",
    "set:models.providers.ollama",
    "get:agents.defaults",
    "set:agents.defaults"
  ]);
  assert.deepEqual(values.get("models.providers.ollama"), {
    models: [
      {
        id: "llama3:8b",
        name: "llama3:8b"
      },
      {
        id: "qwen3.5:9b",
        name: "qwen3.5:9b"
      }
    ]
  });
  assert.deepEqual(values.get("agents.defaults"), {
    models: {
      "ollama/qwen3.5:9b": {}
    },
    model: {
      primary: "ollama/qwen3.5:9b"
    }
  });
});

test("setting an already registered Ollama default model avoids duplicate provider config writes", async () => {
  const calls: string[] = [];

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      if (path === "models.providers.ollama") {
        return {
          models: [
            {
              id: "qwen3.5:9b",
              name: "qwen3.5:9b"
            }
          ]
        };
      }

      if (path === "agents.defaults") {
        return { models: {} };
      }

      return null;
    },
    async setConfig(path: string) {
      calls.push(`set:${path}`);
      return { stdout: JSON.stringify({ ok: true }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  await setOpenClawDefaultModel("ollama/qwen3.5:9b", {
    provider: "ollama"
  });

  assert.deepEqual(calls, [
    "get:models.providers.ollama",
    "get:agents.defaults",
    "set:agents.defaults"
  ]);
});

test("setting a Codex default model normalizes the model ref and enables Codex runtime", async () => {
  const calls: string[] = [];
  const values = new Map<string, unknown>();

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      return path === "agents.defaults" ? { models: {}, agentRuntime: { id: "pi" } } : null;
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
      "openai/gpt-5.5": {
        agentRuntime: {
          id: "codex"
        }
      }
    },
    model: {
      primary: "openai/gpt-5.5"
    }
  });
  assert.equal(values.get("plugins.entries.codex.enabled"), true);
});

test("preparing a Codex agent model writes runtime config without changing the default model", async () => {
  const calls: string[] = [];
  const values = new Map<string, unknown>();

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      return path === "agents.defaults"
        ? {
            models: {
              "openrouter/old": {}
            },
            model: {
              primary: "openrouter/old"
            },
            agentRuntime: {
              id: "legacy"
            }
          }
        : null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      values.set(path, value);
      return { stdout: JSON.stringify({ ok: true, value }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  const result = await ensureOpenClawModelRuntimeConfig("openai-codex/gpt-5.5", {
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
      "openrouter/old": {},
      "openai/gpt-5.5": {
        agentRuntime: {
          id: "codex"
        }
      }
    },
    model: {
      primary: "openrouter/old"
    }
  });
});

test("preparing an already configured Codex agent model does not write Gateway config", async () => {
  const calls: string[] = [];

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      return path === "agents.defaults"
        ? {
            models: {
              "openai/gpt-5.5": {
                agentRuntime: {
                  id: "codex"
                }
              }
            },
            model: {
              primary: "openai/gpt-5.4-mini"
            },
            maxConcurrent: 4
          }
        : null;
    },
    async setConfig(path: string) {
      calls.push(`set:${path}`);
      throw new Error("setConfig should not be called for an already prepared model runtime");
    }
  } as unknown as OpenClawAdapter);

  const result = await ensureOpenClawModelRuntimeConfig("openai/gpt-5.5", {
    provider: "openai-codex"
  });

  assert.deepEqual(result, {
    modelId: "openai/gpt-5.5",
    provider: "openai-codex",
    via: "gateway"
  });
  assert.deepEqual(calls, ["get:agents.defaults"]);
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
