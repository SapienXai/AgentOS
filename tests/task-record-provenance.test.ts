import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskRecords } from "@/lib/openclaw/domains/task-records";
import type { OpenClawAgent, RuntimeRecord } from "@/lib/openclaw/types";

test("agent message sessions do not create task cards", () => {
  const records = buildTaskRecords(
    [
      createRuntime({
        id: "runtime-direct-chat",
        key: "agent:agent-1:explicit:chat-session",
        sessionId: "chat-session",
        runId: "chat-run-1",
        metadata: {
          origin: "agent-chat",
          chatType: "direct",
          agentChatSessionId: "chat-session"
        }
      })
    ],
    [createAgent()]
  );

  assert.equal(records.length, 0);
});

test("mission dispatch task cards expose dispatch-derived provenance", () => {
  const records = buildTaskRecords(
    [
      createRuntime({
        id: "runtime-dispatch",
        key: "agent:agent-1:explicit:session-1",
        sessionId: "session-1",
        runId: "run-1",
        metadata: {
          origin: "agentos-mission-dispatch",
          dispatchId: "dispatch-1",
          dispatchStatus: "running",
          mission: "Ship the release notes."
        }
      })
    ],
    [createAgent()]
  );

  assert.equal(records.length, 1);
  assert.equal(records[0]?.key, "dispatch:dispatch-1");
  assert.equal(records[0]?.dispatchId, "dispatch-1");
  assert.equal(records[0]?.metadata.provenance, "dispatch-derived");
  assert.equal(records[0]?.metadata.dispatchId, "dispatch-1");
  assert.equal(records[0]?.metadata.openClawTaskId, null);
  assert.equal(records[0]?.metadata.openClawSessionId, "session-1");
  assert.equal(records[0]?.metadata.openClawRunId, "run-1");
});

test("native task records are canonical over dispatch-derived duplicates", () => {
  const records = buildTaskRecords(
    [
      createRuntime({
        id: "runtime-dispatch",
        key: "agent:agent-1:explicit:session-1",
        sessionId: "agent:agent-1:explicit:session-1",
        runId: "run-1",
        updatedAt: 1_700_000_000_100,
        metadata: {
          origin: "agentos-mission-dispatch",
          dispatchId: "dispatch-1",
          dispatchStatus: "running",
          mission: "Ship the release notes."
        }
      }),
      createRuntime({
        id: "runtime-native-task",
        key: "openclaw-task-1",
        title: "Gateway task",
        subtitle: "OpenClaw task is running.",
        taskId: "openclaw-task-1",
        sessionId: "session-1",
        runId: "run-1",
        updatedAt: 1_700_000_000_200,
        metadata: {
          origin: "openclaw-runtime-snapshot",
          gatewayObjectKind: "task",
          taskId: "openclaw-task-1",
          dispatchId: "dispatch-1",
          mission: "Ship the release notes."
        }
      })
    ],
    [createAgent()]
  );

  assert.equal(records.length, 1);
  assert.equal(records[0]?.key, "task:openclaw-task-1");
  assert.equal(records[0]?.primaryRuntimeId, "runtime-native-task");
  assert.equal(records[0]?.dispatchId, "dispatch-1");
  assert.equal(records[0]?.metadata.provenance, "native-task");
  assert.equal(records[0]?.metadata.openClawTaskId, "openclaw-task-1");
  assert.equal(records[0]?.metadata.openClawRunId, "run-1");
  assert.deepEqual(records[0]?.runtimeIds, ["runtime-native-task", "runtime-dispatch"]);
});

test("runtime-only task cards expose runtime-derived provenance", () => {
  const records = buildTaskRecords(
    [
      createRuntime({
        id: "runtime-turn",
        key: "run-1",
        sessionId: "session-1",
        runId: "run-1",
        metadata: {
          mission: "Summarize current workspace status."
        }
      })
    ],
    [createAgent()]
  );

  assert.equal(records.length, 1);
  assert.equal(records[0]?.metadata.provenance, "runtime-derived");
  assert.equal(records[0]?.metadata.openClawTaskId, null);
  assert.equal(records[0]?.metadata.openClawSessionId, "session-1");
  assert.equal(records[0]?.metadata.openClawRunId, "run-1");
});

function createAgent(overrides: Partial<OpenClawAgent> = {}): OpenClawAgent {
  return {
    id: "agent-1",
    name: "Agent One",
    workspaceId: "workspace-1",
    workspacePath: "/tmp/agentos-workspace",
    ...overrides
  } as OpenClawAgent;
}

function createRuntime(overrides: Partial<RuntimeRecord> = {}): RuntimeRecord {
  return {
    id: "runtime-1",
    source: "turn",
    key: "agent:agent-1:explicit:session-1",
    title: "Release task",
    subtitle: "OpenClaw runtime update.",
    status: "running",
    updatedAt: 1_700_000_000_000,
    ageMs: null,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    workspacePath: "/tmp/agentos-workspace",
    sessionId: "session-1",
    runId: "run-1",
    metadata: {},
    ...overrides
  };
}
