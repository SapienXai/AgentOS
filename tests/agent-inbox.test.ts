import assert from "node:assert/strict";
import test from "node:test";

import { buildAgentInboxItems } from "@/lib/openclaw/domains/agent-inbox";
import type { OpenClawAgent, RuntimeRecord, TaskRecord } from "@/lib/openclaw/types";

test("agent inbox derives handoff results from OpenClaw task metadata", () => {
  const items = buildAgentInboxItems(
    [
      createTask({
        id: "task-b",
        primaryAgentId: "agent-b",
        primaryAgentName: "Agent B",
        status: "completed",
        metadata: {
          handoffId: "handoff-1",
          sourceAgentId: "agent-a",
          resultPreview: "B finished the delegated analysis."
        }
      })
    ],
    [],
    [createAgent("agent-a", "Agent A"), createAgent("agent-b", "Agent B")]
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.agentId, "agent-b");
  assert.equal(items[0]?.sourceAgentId, "agent-a");
  assert.equal(items[0]?.sourceAgentName, "Agent A");
  assert.equal(items[0]?.summary, "B finished the delegated analysis.");
  assert.equal(items[0]?.provenance, "openclaw-task");
});

test("agent inbox does not notify for ordinary tasks without handoff evidence", () => {
  const items = buildAgentInboxItems(
    [
      createTask({
        id: "task-normal",
        primaryAgentId: "agent-b",
        status: "completed",
        metadata: {
          resultPreview: "Normal task completed."
        }
      })
    ],
    [],
    [createAgent("agent-b", "Agent B")]
  );

  assert.deepEqual(items, []);
});

test("agent inbox derives external Gateway direct results but ignores AgentOS direct chat", () => {
  const items = buildAgentInboxItems(
    [],
    [
      createRuntime({
        id: "runtime-external",
        agentId: "agent-b",
        status: "completed",
        subtitle: "Delegated result from OpenClaw.",
        metadata: {
          origin: "openclaw-gateway-event",
          notifyOperator: true,
          resultPreview: "Delegated result from OpenClaw."
        }
      }),
      createRuntime({
        id: "runtime-agentos-chat",
        agentId: "agent-b",
        status: "completed",
        subtitle: "Local direct chat reply.",
        metadata: {
          origin: "agent-chat",
          chatType: "direct"
        }
      })
    ],
    [createAgent("agent-b", "Agent B")]
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.runtimeId, "runtime-external");
  assert.equal(items[0]?.summary, "Delegated result from OpenClaw.");
  assert.equal(items[0]?.provenance, "openclaw-runtime");
});

test("agent inbox surfaces running inter-agent session updates", () => {
  const items = buildAgentInboxItems(
    [],
    [
      createRuntime({
        id: "runtime-inter-session",
        agentId: "agent-b",
        status: "running",
        title: "Message from Agent A",
        subtitle: "Inter-agent message received; waiting for reply.",
        metadata: {
          interSessionMessage: true,
          sourceAgentId: "agent-a",
          sourceTool: "sessions_send",
          resultPreview: "Please inspect the workspace and report back."
        }
      })
    ],
    [createAgent("agent-a", "Agent A"), createAgent("agent-b", "Agent B")]
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.agentId, "agent-b");
  assert.equal(items[0]?.sourceAgentId, "agent-a");
  assert.equal(items[0]?.status, "running");
  assert.equal(items[0]?.kind, "handoff-update");
  assert.equal(items[0]?.summary, "Please inspect the workspace and report back.");
});

test("agent inbox surfaces failed agent-to-agent sends from direct chat sessions", () => {
  const items = buildAgentInboxItems(
    [],
    [
      createRuntime({
        id: "runtime-send-failed",
        agentId: "agent-a",
        status: "stalled",
        title: "Agent-to-agent message",
        subtitle: "Agent-to-agent messaging denied by policy.",
        toolNames: ["sessions_send"],
        metadata: {
          origin: "agent-chat",
          agentToAgentMessage: true,
          resultPreview: "Agent-to-agent messaging denied by policy."
        }
      })
    ],
    [createAgent("agent-a", "Agent A")]
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.agentId, "agent-a");
  assert.equal(items[0]?.status, "stalled");
  assert.equal(items[0]?.summary, "Agent-to-agent messaging denied by policy.");
});

function createAgent(id: string, name: string): OpenClawAgent {
  return {
    id,
    name,
    identityName: name,
    status: "ready",
    workspaceId: "workspace-1",
    workspacePath: "/workspace",
    agentDir: `.openclaw/agents/${id}`,
    modelId: "openai/gpt-5.5",
    lastActiveAt: null,
    currentAction: "Idle",
    skills: [],
    tools: [],
    policy: {
      preset: "custom",
      missingToolBehavior: "fallback",
      installScope: "none",
      fileAccess: "workspace-only",
      networkAccess: "restricted"
    },
    activeRuntimeIds: [],
    heartbeat: {
      enabled: false,
      every: null,
      everyMs: null
    },
    identity: {},
    profile: {
      purpose: null,
      operatingInstructions: [],
      responseStyle: [],
      outputPreference: null,
      sourceFiles: []
    },
    sessionCount: 0,
    isDefault: false
  };
}

function createRuntime(overrides: Partial<RuntimeRecord>): RuntimeRecord {
  return {
    id: "runtime-1",
    key: "runtime-1",
    title: "Runtime",
    subtitle: "Runtime update",
    status: "completed",
    updatedAt: 1_700_000_000_000,
    ageMs: 0,
    source: "turn",
    agentId: "agent-b",
    workspaceId: "workspace-1",
    workspacePath: "/workspace",
    sessionId: "session-1",
    runId: "run-1",
    metadata: {},
    ...overrides
  };
}

function createTask(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: "task-1",
    key: "task:1",
    title: "Delegated task",
    mission: "Run delegated task",
    subtitle: "Task completed.",
    status: "completed",
    updatedAt: 1_700_000_000_000,
    ageMs: 0,
    workspaceId: "workspace-1",
    primaryAgentId: "agent-b",
    primaryAgentName: "Agent B",
    primaryRuntimeId: "runtime-1",
    runtimeIds: [],
    agentIds: ["agent-b"],
    sessionIds: [],
    runIds: [],
    runtimeCount: 1,
    updateCount: 1,
    liveRunCount: 0,
    artifactCount: 0,
    warningCount: 0,
    metadata: {},
    ...overrides
  };
}
