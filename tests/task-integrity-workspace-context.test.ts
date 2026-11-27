import assert from "node:assert/strict";
import { test } from "node:test";

import { buildTaskIntegrityRecord } from "@/lib/openclaw/domains/mission-dispatch";
import { parseRuntimeOutputFromSessionHistory } from "@/lib/openclaw/domains/runtime-transcript";
import type { MissionControlSnapshot, RuntimeRecord, TaskRecord } from "@/lib/openclaw/types";

test("task integrity warns when task and runtime workspace context diverge", async () => {
  const integrity = await buildTaskIntegrityRecord({
    task: createTask({ workspaceId: "workspace-1" }),
    runs: [createRuntime({ workspaceId: "workspace-2" })],
    outputs: [],
    createdFiles: [],
    dispatchRecord: null,
    snapshot: createSnapshot({
      workspaces: ["workspace-1", "workspace-2"],
      agents: [{ id: "agent-1", workspaceId: "workspace-1" }]
    })
  });

  assert.equal(integrity.status, "warning");
  assert.equal(integrity.issues.some((issue) => issue.id === "workspace-context-mismatch"), true);
});

test("task integrity warns when referenced workspace is missing from the snapshot", async () => {
  const integrity = await buildTaskIntegrityRecord({
    task: createTask({ workspaceId: "missing-workspace" }),
    runs: [createRuntime({ workspaceId: "missing-workspace" })],
    outputs: [],
    createdFiles: [],
    dispatchRecord: null,
    snapshot: createSnapshot({
      workspaces: ["workspace-1"],
      agents: [{ id: "agent-1", workspaceId: "missing-workspace" }]
    })
  });

  assert.equal(integrity.status, "warning");
  assert.equal(integrity.issues.some((issue) => issue.id === "missing-workspace-context"), true);
});

test("task integrity preserves the OpenClaw dispatch stall error", async () => {
  const integrity = await buildTaskIntegrityRecord({
    task: createTask({ status: "stalled" }),
    runs: [createRuntime({ status: "stalled" })],
    outputs: [],
    createdFiles: [],
    dispatchRecord: {
      id: "dispatch-1",
      agentId: "agent-1",
      mission: "Check runtime context",
      routedMission: "Check runtime context",
      submittedAt: "2026-06-01T00:00:00.000Z",
      updatedAt: "2026-06-01T00:01:00.000Z",
      status: "stalled",
      error: "OpenClaw Gateway wait timed out during gateway_draining.",
      observation: {},
      runner: {
        pid: 1234,
        childPid: null,
        startedAt: "2026-06-01T00:00:10.000Z",
        finishedAt: "2026-06-01T00:01:00.000Z",
        lastHeartbeatAt: "2026-06-01T00:00:20.000Z"
      }
    } as never,
    snapshot: createSnapshot({
      workspaces: ["workspace-1"],
      agents: [{ id: "agent-1", workspaceId: "workspace-1" }]
    })
  });

  assert.equal(integrity.status, "warning");
  assert.equal(
    integrity.issues.some((issue) => issue.id === "dispatch-stalled" && issue.detail === "OpenClaw Gateway wait timed out during gateway_draining."),
    true
  );
});

test("task integrity reads the original mission from scoped Gateway history", async () => {
  const submittedAt = "2026-06-01T00:00:00.000Z";
  const runtime = createRuntime({
    runId: "dispatch-1",
    status: "completed",
    metadata: { dispatchId: "dispatch-1", dispatchSubmittedAt: submittedAt }
  });
  const task = createTask({ status: "completed" });
  const assess = async (prompt: string, sessionId = runtime.sessionId) => buildTaskIntegrityRecord({
    task,
    runs: [runtime],
    outputs: [parseRuntimeOutputFromSessionHistory({ ...runtime, sessionId }, { messages: [
      { role: "user", content: prompt, timestamp: submittedAt },
      { role: "toolResult", toolName: "read", content: "Verified source", timestamp: submittedAt },
      { role: "assistant", content: "The source confirms the result.", stopReason: "stop", timestamp: submittedAt }
    ] })],
    createdFiles: [],
    dispatchRecord: {
      id: "dispatch-1", agentId: "agent-1", mission: task.mission!, routedMission: task.mission!,
      submittedAt, updatedAt: submittedAt, status: "completed", observation: {}
    },
    snapshot: {
      ...createSnapshot({ workspaces: ["workspace-1"], agents: [{ id: "agent-1", workspaceId: "workspace-1" }] }),
      mode: "live"
    }
  });

  const original = await assess("Check runtime context");
  assert.equal(original.issues.some((issue) => issue.id === "missing-transcript"), false);
  assert.equal(original.finalResponseText, "The source confirms the result.");
  assert.deepEqual(original.toolNames, ["read"]);

  const followUp = await assess("Summarize the result in one sentence");
  assert.equal(followUp.issues.some((issue) => issue.id === "missing-transcript"), true);
  assert.equal(followUp.finalResponseText, null);
  assert.equal((await assess("Check runtime context", "unrelated-session")).finalResponseText, null);
});

function createTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    key: "task-1",
    title: "Runtime context check",
    mission: "Check runtime context",
    subtitle: "running",
    status: "running",
    updatedAt: 1_700_000_000_000,
    ageMs: null,
    workspaceId: "workspace-1",
    primaryAgentId: "agent-1",
    primaryAgentName: "Agent 1",
    primaryRuntimeId: "runtime-1",
    runtimeIds: ["runtime-1"],
    agentIds: ["agent-1"],
    sessionIds: ["session-1"],
    runIds: ["run-1"],
    runtimeCount: 1,
    updateCount: 1,
    liveRunCount: 1,
    artifactCount: 0,
    warningCount: 0,
    metadata: {},
    ...overrides
  };
}

function createRuntime(overrides: Partial<RuntimeRecord> = {}): RuntimeRecord {
  return {
    id: "runtime-1",
    source: "turn",
    key: "task-1",
    title: "Gateway task",
    subtitle: "running",
    status: "running",
    updatedAt: 1_700_000_000_000,
    ageMs: null,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    taskId: "task-1",
    runId: "run-1",
    metadata: {},
    ...overrides
  };
}

function createSnapshot(input: {
  workspaces: string[];
  agents: Array<{ id: string; workspaceId: string }>;
}): MissionControlSnapshot {
  return {
    workspaces: input.workspaces.map((id) => ({ id })),
    agents: input.agents,
    runtimes: [],
    tasks: []
  } as unknown as MissionControlSnapshot;
}
