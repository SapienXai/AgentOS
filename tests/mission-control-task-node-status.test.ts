import assert from "node:assert/strict";
import test from "node:test";

import {
  hasTaskRuntimeOutputEvidence,
  readTaskResultPreview,
  resolveTaskCardEvidencePresentation,
  resolveTaskDispatchIssueDetail,
  resolveTaskReviewPresentation,
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

test("runtime-observed tasks without output evidence stay on waiting output instead of going live", () => {
  const task = createTask({
    status: "running",
    subtitle: "Runtime observed. Waiting for the first output update.",
    metadata: {
      resultPreview: "agent",
      turnCount: 0
    }
  });

  assert.equal(
    resolveTaskBadgeLabel("runtime-observed", task.status, true, false, false),
    "waiting output"
  );
});

test("dispatch stall details prefer the OpenClaw integrity error over generic review text", () => {
  const task = createTask({
    status: "stalled",
    subtitle: "AgentOS recovered partial evidence, but this result still needs operator review."
  });

  const detail = resolveTaskDispatchIssueDetail(task, {
    issues: [
      {
        id: "dispatch-stalled",
        detail: "OpenClaw Gateway wait timed out during gateway_draining."
      }
    ]
  });

  assert.equal(detail, "OpenClaw Gateway wait timed out during gateway_draining.");
});

test("dispatch stall details use dispatch metadata without treating generic subtitles as errors", () => {
  const task = createTask({
    status: "stalled",
    subtitle: "AgentOS recovered partial evidence, but this result still needs operator review.",
    metadata: {
      dispatchError: "OpenClaw Gateway wait timed out during gateway_draining."
    }
  });

  assert.equal(resolveTaskDispatchIssueDetail(task), "OpenClaw Gateway wait timed out during gateway_draining.");
  assert.equal(resolveTaskDispatchIssueDetail(createTask({
    status: "stalled",
    subtitle: "AgentOS recovered partial evidence, but this result still needs operator review."
  })), null);
});

test("Gateway wait timeouts present captured output as unverified delivery evidence", () => {
  const task = createTask({
    status: "stalled",
    metadata: {
      dispatchError: "OpenClaw Gateway wait timed out during gateway_draining."
    }
  });

  assert.deepEqual(resolveTaskReviewPresentation(task), {
    deliveryUnconfirmed: true,
    technicalDetail: "OpenClaw Gateway wait timed out during gateway_draining.",
    badgeLabel: "delivery unconfirmed",
    footerLabel: "delivery unconfirmed",
    evidenceLabel: "Last captured response — unverified",
    followUpLabel: "Ask agent to verify",
    followUpPlaceholder: "Ask the agent to verify whether delivery completed…"
  });
});

test("task card evidence favors activity for live and delivery-unconfirmed tasks", () => {
  assert.deepEqual(resolveTaskCardEvidencePresentation({
    hasActivity: true,
    hasLiveActivity: true,
    deliveryUnconfirmed: false
  }), {
    label: "Live activity",
    prioritizeActivity: true
  });

  assert.deepEqual(resolveTaskCardEvidencePresentation({
    hasActivity: true,
    hasLiveActivity: false,
    deliveryUnconfirmed: true
  }), {
    label: "Last captured activity",
    prioritizeActivity: true
  });

  assert.deepEqual(resolveTaskCardEvidencePresentation({
    hasActivity: true,
    hasLiveActivity: false,
    deliveryUnconfirmed: false
  }), {
    label: "Latest result",
    prioritizeActivity: false
  });
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
