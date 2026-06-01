import assert from "node:assert/strict";
import test from "node:test";

import {
  hasTaskRuntimeOutputEvidence,
  readTaskResultPreview,
  resolveTaskBadgeLabel
} from "@/components/mission-control/task-node-status";
import type { TaskFeedEvent, WorkItemRecord } from "@/lib/agentos/contracts";

test("stalled tasks with runtime evidence need review instead of waiting output", () => {
  const task = createTask({
    status: "stalled",
    subtitle: "Working silently while AgentOS waits for the first OpenClaw runtime.",
    runtimeCount: 6,
    metadata: {
      resultPreview: "agent",
      turnCount: 4
    }
  });
  const feed: TaskFeedEvent[] = [
    createFeedEvent({
      kind: "tool",
      title: "Tool · bash",
      detail: "Called bash"
    })
  ];

  assert.equal(hasTaskRuntimeOutputEvidence(task, feed), true);
  assert.equal(
    resolveTaskBadgeLabel("stalled", task.status, false, false, hasTaskRuntimeOutputEvidence(task, feed)),
    "needs review"
  );
  assert.equal(readTaskResultPreview(task), "Waiting for the first OpenClaw update.");
});

test("stalled tasks without output evidence still wait for output", () => {
  const task = createTask({
    status: "stalled",
    subtitle: "Working silently while AgentOS waits for the first OpenClaw runtime.",
    metadata: {
      resultPreview: "agent",
      turnCount: 0
    }
  });
  const feed: TaskFeedEvent[] = [
    createFeedEvent({
      kind: "status",
      title: "Runtime observed",
      detail: "The task is now live. Runtime updates will continue below."
    })
  ];

  assert.equal(hasTaskRuntimeOutputEvidence(task, feed), false);
  assert.equal(
    resolveTaskBadgeLabel("stalled", task.status, false, false, hasTaskRuntimeOutputEvidence(task, feed)),
    "waiting output"
  );
});

function createTask(overrides: Partial<WorkItemRecord> = {}): WorkItemRecord {
  return {
    id: "task:test",
    key: "task:test",
    title: "Test task",
    mission: "Test mission",
    subtitle: "Waiting for the first OpenClaw update.",
    status: "running",
    updatedAt: 0,
    ageMs: 0,
    primaryAgentName: "Test Agent",
    runtimeIds: [],
    agentIds: ["agent:test"],
    sessionIds: [],
    runIds: [],
    runtimeCount: 0,
    updateCount: 0,
    liveRunCount: 0,
    artifactCount: 0,
    warningCount: 0,
    ...overrides,
    metadata: {
      ...(overrides.metadata ?? {})
    }
  };
}

function createFeedEvent(overrides: Partial<TaskFeedEvent> = {}): TaskFeedEvent {
  return {
    id: `event:${overrides.kind ?? "status"}`,
    kind: "status",
    timestamp: "2026-06-01T00:00:00.000Z",
    title: "Status",
    detail: "Status update",
    ...overrides
  };
}
