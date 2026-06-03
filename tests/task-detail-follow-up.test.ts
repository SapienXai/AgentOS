import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskDetailFromTaskRecord } from "@/lib/openclaw/domains/task-detail";
import { buildTaskRecords } from "@/lib/openclaw/domains/task-records";
import type { MissionControlSnapshot, RuntimeRecord, TaskRecord } from "@/lib/openclaw/types";

test("task detail includes follow-up runtimes from the same session context", async () => {
  const baseRuntime = createRuntime({
    id: "runtime-1",
    runId: "run-1",
    subtitle: "Initial task result.",
    updatedAt: 1000
  });
  const followUpRuntime = createRuntime({
    id: "runtime-2",
    runId: "run-2",
    subtitle: "Follow-up result.",
    updatedAt: 2000
  });
  const task = createTask({
    runtimeIds: [baseRuntime.id],
    runIds: [baseRuntime.runId!],
    sessionIds: ["session-1"]
  });
  const snapshot = {
    runtimes: [baseRuntime, followUpRuntime],
    agents: [],
    tasks: [task],
    workspaces: []
  } as unknown as MissionControlSnapshot;

  const detail = await buildTaskDetailFromTaskRecord(task, snapshot, null);

  assert.deepEqual(detail.runs.map((runtime) => runtime.id), ["runtime-2", "runtime-1"]);
  assert.deepEqual(detail.task.runtimeIds, ["runtime-2", "runtime-1"]);
  assert.deepEqual(detail.task.runIds, ["run-2", "run-1"]);
  assert.equal(detail.task.runtimeCount, 2);
});

test("task detail links follow-up runtimes by normalized session and continue run id", async () => {
  const baseRuntime = createRuntime({
    id: "runtime-base",
    runId: "dispatch-1",
    sessionId: "agent:agent-1:explicit:session-raw",
    subtitle: "Initial task result.",
    updatedAt: 1000,
    metadata: {
      dispatchId: "dispatch-1",
      mission: "Initial task"
    }
  });
  const followUpChatRuntime = createRuntime({
    id: "runtime-follow-chat",
    runId: "dispatch-1:continue:2000",
    sessionId: "agent:agent-1:explicit:session-raw",
    status: "running",
    subtitle: "chat",
    updatedAt: 2000,
    metadata: {
      event: "chat"
    }
  });
  const followUpCompletionRuntime = createRuntime({
    id: "runtime-follow-complete",
    runId: "dispatch-1:continue:2000",
    sessionId: "session-created",
    status: "completed",
    subtitle: "sessions.changed",
    updatedAt: 2100,
    metadata: {
      event: "sessions.changed"
    }
  });
  const task = createTask({
    runtimeIds: [baseRuntime.id],
    runIds: [baseRuntime.runId!],
    sessionIds: ["session-raw"],
    dispatchId: "dispatch-1"
  });
  const snapshot = {
    runtimes: [baseRuntime, followUpChatRuntime, followUpCompletionRuntime],
    agents: [],
    tasks: [task],
    workspaces: []
  } as unknown as MissionControlSnapshot;

  const detail = await buildTaskDetailFromTaskRecord(task, snapshot, null);
  const followUps = detail.task.metadata.followUps as Array<{ runId: string; status: string }>;

  assert.deepEqual(
    detail.runs.map((runtime) => runtime.id),
    ["runtime-follow-complete", "runtime-follow-chat", "runtime-base"]
  );
  assert.equal(followUps.length, 1);
  assert.equal(followUps[0]?.runId, "dispatch-1:continue:2000");
  assert.equal(followUps[0]?.status, "completed");
});

test("task records expose derived follow-ups so card numbers survive refresh", () => {
  const baseRuntime = createRuntime({
    id: "runtime-base",
    runId: "dispatch-1",
    sessionId: "agent:agent-1:explicit:session-raw",
    subtitle: "Initial task result.",
    metadata: {
      dispatchId: "dispatch-1",
      mission: "Initial task"
    }
  });
  const followUpRuntime = createRuntime({
    id: "runtime-follow",
    runId: "dispatch-1:continue:2000",
    sessionId: "agent:agent-1:explicit:session-raw",
    status: "completed",
    subtitle: "sessions.changed",
    updatedAt: 2000,
    metadata: {
      event: "sessions.changed"
    }
  });

  const records = buildTaskRecords([baseRuntime, followUpRuntime], [{
    id: "agent-1",
    name: "Agent One"
  } as never]);
  const followUps = records[0]?.metadata.followUps as Array<{ runId: string; status: string }> | undefined;

  assert.equal(records.length, 1);
  assert.equal(followUps?.length, 1);
  assert.equal(followUps?.[0]?.runId, "dispatch-1:continue:2000");
  assert.equal(followUps?.[0]?.status, "completed");
});

function createRuntime(overrides: Partial<RuntimeRecord>): RuntimeRecord {
  return {
    id: "runtime-1",
    source: "turn",
    key: "agent:agent-1:explicit:session-1",
    title: "Release checklist",
    subtitle: "Runtime update.",
    status: "completed",
    updatedAt: 1000,
    ageMs: 0,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    taskId: "task-1",
    runId: "run-1",
    metadata: {},
    ...overrides
  };
}

function createTask(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    id: "task-1",
    key: "dispatch:dispatch-1",
    title: "Release checklist",
    mission: "Review the release checklist.",
    subtitle: "Initial task result.",
    status: "completed",
    updatedAt: 1000,
    ageMs: 0,
    workspaceId: "workspace-1",
    primaryAgentId: "agent-1",
    primaryAgentName: "Main",
    primaryRuntimeId: "runtime-1",
    dispatchId: "dispatch-1",
    runtimeIds: ["runtime-1"],
    agentIds: ["agent-1"],
    sessionIds: ["session-1"],
    runIds: ["run-1"],
    runtimeCount: 1,
    updateCount: 1,
    liveRunCount: 0,
    artifactCount: 0,
    warningCount: 0,
    metadata: {},
    ...overrides
  };
}
