import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModelRemoveImpact,
  buildModelProviderDisconnectImpact,
  disconnectModelProvider,
  removeModelSafely
} from "@/lib/openclaw/application/model-provider-disconnect-service";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";

function createSnapshot(input: {
  activeGoogleAgent?: boolean;
  includeReplacement?: boolean;
} = {}) {
  const includeReplacement = input.includeReplacement !== false;

  return {
    diagnostics: {
      modelReadiness: {
        defaultModel: "google/gemini-3.5-flash",
        resolvedDefaultModel: "google/gemini-3.5-flash",
        recommendedModelId: includeReplacement ? "openai/gpt-5.4-mini" : null
      }
    },
    agents: [
      {
        id: "agent-google",
        name: "Gemini Agent",
        modelId: "google/gemini-3.5-flash",
        activeRuntimeIds: input.activeGoogleAgent ? ["run-1"] : []
      },
      {
        id: "agent-openai",
        name: "OpenAI Agent",
        modelId: "openai/gpt-5.4-mini",
        activeRuntimeIds: []
      }
    ],
    models: [
      {
        id: "google/gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        provider: "google",
        input: "text+image",
        contextWindow: 1_048_576,
        local: false,
        available: true,
        missing: false,
        tags: ["configured", "default"],
        usageCount: 4
      },
      ...(includeReplacement
        ? [{
            id: "openai/gpt-5.4-mini",
            name: "GPT-5.4 Mini",
            provider: "openai",
            input: "text+image",
            contextWindow: 400_000,
            local: false,
            available: true,
            missing: false,
            tags: ["configured"],
            usageCount: 2
          }]
        : [])
    ]
  } as unknown as MissionControlSnapshot;
}

test("disconnect impact selects a ready replacement for the default and affected agents", () => {
  const impact = buildModelProviderDisconnectImpact(
    createSnapshot(),
    "google",
    new Set(["google/gemini-3.5-flash", "openai/gpt-5.4-mini"])
  );

  assert.deepEqual(impact.providerModelIds, ["google/gemini-3.5-flash"]);
  assert.deepEqual(impact.affectedAgents.map((agent) => agent.id), ["agent-google"]);
  assert.equal(impact.defaultModelAffected, true);
  assert.equal(impact.replacementModelId, "openai/gpt-5.4-mini");
  assert.equal(impact.blockedReason, null);
  assert.equal(impact.credentialCleanup, "retained-unsupported");
});

test("disconnect impact blocks active agents and missing replacements", () => {
  const activeImpact = buildModelProviderDisconnectImpact(
    createSnapshot({ activeGoogleAgent: true }),
    "google",
    new Set(["google/gemini-3.5-flash"])
  );
  const noReplacementImpact = buildModelProviderDisconnectImpact(
    createSnapshot({ includeReplacement: false }),
    "google",
    new Set(["google/gemini-3.5-flash"])
  );

  assert.match(activeImpact.blockedReason ?? "", /affected agent is running/);
  assert.match(noReplacementImpact.blockedReason ?? "", /no ready replacement model/);
});

test("disconnect reassigns defaults and agents before removing provider configuration", async () => {
  const calls: string[] = [];
  const snapshot = createSnapshot();
  const result = await disconnectModelProvider("google", {
    getSnapshot: async () => snapshot,
    readConfiguredModelIds: async () => new Set(["google/gemini-3.5-flash", "openai/gpt-5.4-mini"]),
    setDefaultModel: async (modelId) => {
      calls.push(`default:${modelId}`);
      return { modelId, provider: "openai", via: "gateway" };
    },
    updateAgentModel: async (agentId, modelId) => {
      calls.push(`agent:${agentId}:${modelId}`);
    },
    removeModel: async (modelId) => {
      calls.push(`remove:${modelId}`);
      return { modelId, provider: "google", via: "gateway" };
    },
    removeProviderConfiguration: async () => {
      calls.push("remove-provider");
      return {
        providerConfigRemoved: true,
        authMetadataRemoved: 1,
        credentialCleanup: "retained-unsupported"
      };
    },
    markDisconnected: async () => {
      calls.push("mark-disconnected");
    },
    clearCaches: () => {
      calls.push("clear-caches");
    }
  });

  assert.deepEqual(calls, [
    "default:openai/gpt-5.4-mini",
    "agent:agent-google:openai/gpt-5.4-mini",
    "remove:google/gemini-3.5-flash",
    "remove-provider",
    "mark-disconnected",
    "clear-caches"
  ]);
  assert.equal(result.impact.replacementModelId, "openai/gpt-5.4-mini");
});

test("model removal impact blocks active affected agents and missing replacements", () => {
  const activeImpact = buildModelRemoveImpact(
    createSnapshot({ activeGoogleAgent: true }),
    "google",
    "google/gemini-3.5-flash",
    new Set(["google/gemini-3.5-flash"])
  );
  const noReplacementImpact = buildModelRemoveImpact(
    createSnapshot({ includeReplacement: false }),
    "google",
    "google/gemini-3.5-flash",
    new Set(["google/gemini-3.5-flash"])
  );

  assert.match(activeImpact.blockedReason ?? "", /affected agent is running/);
  assert.match(noReplacementImpact.blockedReason ?? "", /no ready replacement model/);
});

test("model removal reassigns affected agents before removing config", async () => {
  const calls: string[] = [];
  const snapshot = createSnapshot();
  const result = await removeModelSafely("google", "google/gemini-3.5-flash", {
    getSnapshot: async () => snapshot,
    readConfiguredModelIds: async () => new Set(["google/gemini-3.5-flash", "openai/gpt-5.4-mini"]),
    setDefaultModel: async (modelId) => {
      calls.push(`default:${modelId}`);
      return { modelId, provider: "openai", via: "gateway" };
    },
    updateAgentModel: async (agentId, modelId) => {
      calls.push(`agent:${agentId}:${modelId}`);
    },
    removeModel: async (modelId) => {
      calls.push(`remove:${modelId}`);
      return { modelId, provider: "google", via: "gateway" };
    },
    removeProviderConfiguration: async () => {
      throw new Error("provider cleanup must not run for model removal");
    },
    markDisconnected: async () => {
      throw new Error("disconnect tombstone must not be written for model removal");
    },
    clearCaches: () => {
      calls.push("clear-caches");
    }
  });

  assert.deepEqual(calls, [
    "default:openai/gpt-5.4-mini",
    "agent:agent-google:openai/gpt-5.4-mini",
    "remove:google/gemini-3.5-flash",
    "clear-caches"
  ]);
  assert.equal(result.impact.replacementModelId, "openai/gpt-5.4-mini");
});
