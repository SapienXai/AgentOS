import assert from "node:assert/strict";
import test from "node:test";

import { buildSnapshotAgentEntry } from "@/lib/openclaw/adapter/agent-snapshot-adapter";
import { resolveAgentPolicy } from "@/lib/openclaw/agent-presets";

test("snapshot agent entry prefers saved customization over raw runtime metadata", () => {
  const entry = buildSnapshotAgentEntry({
    rawAgent: {
      id: "workspace-custom-agent",
      name: "Raw Agent",
      workspace: "/workspace",
      agentDir: "/workspace/.openclaw/agents/workspace-custom-agent/agent",
      model: "openai/raw-model"
    },
    configured: {
      id: "workspace-custom-agent",
      workspace: "/workspace",
      name: "Configured Agent",
      model: "openai/configured-model",
      identity: {
        name: "Configured Agent",
        emoji: "C",
        theme: "configured",
        avatar: "https://example.test/avatar.png"
      },
      skills: [],
      tools: {
        fs: {
          workspaceOnly: true
        }
      }
    },
    identityOverrides: {
      name: "Custom Agent",
      emoji: "A",
      theme: "violet",
      avatar: null
    },
    workspaceId: "workspace",
    sessionList: [],
    heartbeat: null,
    manifestAgent: {
      id: "workspace-custom-agent",
      name: "Manifest Agent",
      role: "Custom",
      isPrimary: false,
      skillId: null,
      skillIds: [],
      toolIds: ["exec"],
      modelId: "openai/manifest-model",
      enabled: true,
      policy: resolveAgentPolicy("custom"),
      emoji: "M",
      theme: "manifest",
      channelIds: []
    },
    agentRuntimes: [],
    gatewayRpcOk: true,
    profile: {
      purpose: "Test agent",
      operatingInstructions: [],
      responseStyle: [],
      outputPreference: null,
      sourceFiles: []
    }
  });

  assert.equal(entry.agent.name, "Custom Agent");
  assert.equal(entry.agent.identityName, "Custom Agent");
  assert.equal(entry.agent.modelId, "openai/configured-model");
  assert.equal(entry.agent.identity.emoji, "A");
  assert.equal(entry.agent.identity.theme, "violet");
  assert.equal(entry.agent.policy.preset, "custom");
});

test("snapshot agent entry falls back to configured heartbeat when live heartbeat status is absent", () => {
  const entry = buildSnapshotAgentEntry({
    rawAgent: {
      id: "heartbeat-agent",
      name: "Heartbeat Agent",
      workspace: "/workspace",
      agentDir: "/workspace/.openclaw/agents/heartbeat-agent/agent",
      model: "openai/gpt-5.5"
    },
    configured: {
      id: "heartbeat-agent",
      workspace: "/workspace",
      name: "Heartbeat Agent",
      model: "openai/gpt-5.5",
      heartbeat: {
        every: "30m"
      }
    },
    identityOverrides: null,
    workspaceId: "workspace",
    sessionList: [],
    heartbeat: null,
    manifestAgent: null,
    agentRuntimes: [],
    gatewayRpcOk: true,
    profile: {
      purpose: null,
      operatingInstructions: [],
      responseStyle: [],
      outputPreference: null,
      sourceFiles: []
    }
  });

  assert.equal(entry.agent.heartbeat.enabled, true);
  assert.equal(entry.agent.heartbeat.every, "30m");
});
