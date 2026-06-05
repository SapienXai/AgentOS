import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createAgent as createApplicationAgent,
  deleteAgent as deleteApplicationAgent,
  formatPostCreateAgentConfigSyncWarning,
  resolveAgentCreateModelSelection,
  updateAgent as updateApplicationAgent
} from "@/lib/openclaw/application/agent-service";
import {
  createAgent as createCompatibilityAgent,
  deleteAgent as deleteCompatibilityAgent,
  updateAgent as updateCompatibilityAgent
} from "@/lib/openclaw/service";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";

async function readErrorMessage(action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }

  throw new Error("Expected action to throw.");
}

test("agent application service preserves create validation shape", async () => {
  const input = {
    id: " ",
    workspaceId: "workspace:missing"
  };

  assert.equal(
    await readErrorMessage(() => createApplicationAgent(input)),
    await readErrorMessage(() => createCompatibilityAgent(input))
  );
});

test("agent application service preserves update validation shape", async () => {
  const input = {
    id: " "
  };

  assert.equal(
    await readErrorMessage(() => updateApplicationAgent(input)),
    await readErrorMessage(() => updateCompatibilityAgent(input))
  );
});

test("agent application service preserves delete validation shape", async () => {
  const input = {
    agentId: " "
  };

  assert.equal(
    await readErrorMessage(() => deleteApplicationAgent(input)),
    await readErrorMessage(() => deleteCompatibilityAgent(input))
  );
});

test("agent creation treats post-create Gateway config timeouts as sync warnings", () => {
  const warning = formatPostCreateAgentConfigSyncWarning(
    new Error(
      'Timed out waiting for OpenClaw Gateway method "config.patch". Gateway-native operation failed; CLI fallback disabled for this operation.'
    )
  );

  assert.match(warning ?? "", /AgentOS created the agent/);
  assert.match(warning ?? "", /config sync/);
});

test("agent creation does not downgrade validation failures to sync warnings", () => {
  assert.equal(
    formatPostCreateAgentConfigSyncWarning(new Error('Agent id "main" already exists in workspace "Workspace".')),
    null
  );
  assert.equal(
    formatPostCreateAgentConfigSyncWarning(new Error("Refusing to write a redacted OpenClaw secret.")),
    null
  );
});

test("agent creation falls back when the requested model is not ready", () => {
  const snapshot = {
    diagnostics: {
      installed: true,
      rpcOk: true,
      runtime: {
        stateWritable: true,
        sessionStoreWritable: true,
        issues: []
      },
      modelReadiness: {
        ready: true,
        defaultModelReady: true,
        defaultModel: "openai/gpt-5.5",
        resolvedDefaultModel: "openai/gpt-5.5",
        recommendedModelId: "openai/gpt-5.5",
        totalModelCount: 2,
        availableModelCount: 1,
        issues: []
      }
    },
    agents: [],
    models: [
      {
        id: "openai/gpt-5.4-mini",
        available: false,
        missing: false
      },
      {
        id: "openai/gpt-5.5",
        available: true,
        missing: false
      }
    ]
  } as unknown as MissionControlSnapshot;

  const selection = resolveAgentCreateModelSelection(snapshot, "openai/gpt-5.4-mini", "openai/gpt-5.5");

  assert.equal(selection.modelId, "openai/gpt-5.5");
  assert.equal(selection.warnings.length, 1);
  assert.match(selection.warnings[0], /Requested model openai\/gpt-5\.4-mini is not ready/);
});
