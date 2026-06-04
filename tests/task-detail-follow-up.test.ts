import assert from "node:assert/strict";
import test from "node:test";

import { buildTaskDetailFromTaskRecord } from "@/lib/openclaw/domains/task-detail";
import { buildTaskRecords } from "@/lib/openclaw/domains/task-records";
import { deriveTaskFollowUpsFromRuntimes, readTaskFollowUpsFromMetadata } from "@/lib/openclaw/domains/task-follow-up-records";
import type { MissionControlSnapshot, RuntimeOutputRecord, RuntimeRecord, TaskRecord } from "@/lib/openclaw/types";

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
    tokenUsage: {
      input: 120,
      output: 30,
      total: 150
    },
    metadata: {
      event: "sessions.changed",
      createdFiles: [{ path: "/tmp/follow-up.txt", displayPath: "follow-up.txt" }]
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
  const followUps = detail.task.metadata.followUps as Array<{
    runId: string;
    status: string;
    tokenUsage?: { total: number };
  }>;

  assert.deepEqual(
    detail.runs.map((runtime) => runtime.id),
    ["runtime-follow-complete", "runtime-follow-chat", "runtime-base"]
  );
  assert.equal(followUps.length, 1);
  assert.equal(followUps[0]?.runId, "dispatch-1:continue:2000");
  assert.equal(followUps[0]?.status, "completed");
  assert.equal(followUps[0]?.tokenUsage?.total, 150);
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
    tokenUsage: {
      input: 70,
      output: 20,
      total: 90
    },
    metadata: {
      event: "sessions.changed",
      createdFiles: [{ path: "/tmp/follow-up.txt", displayPath: "follow-up.txt" }]
    }
  });

  const records = buildTaskRecords([baseRuntime, followUpRuntime], [{
    id: "agent-1",
    name: "Agent One"
  } as never]);
  const followUps = records[0]?.metadata.followUps as Array<{
    runId: string;
    status: string;
    tokenUsage?: { total: number };
    createdFiles?: Array<{ path: string }>;
  }> | undefined;

  assert.equal(records.length, 1);
  assert.equal(followUps?.length, 1);
  assert.equal(followUps?.[0]?.runId, "dispatch-1:continue:2000");
  assert.equal(followUps?.[0]?.status, "completed");
  assert.equal(followUps?.[0]?.tokenUsage?.total, 90);
  assert.equal(followUps?.[0]?.createdFiles?.[0]?.path, "/tmp/follow-up.txt");
});

test("follow-up metadata restores the actual question instead of a numbered placeholder", () => {
  const followUps = readTaskFollowUpsFromMetadata({
    followUps: [
      {
        id: "follow-up-1",
        message: "Follow-up 1",
        prompt: [
          "Continue this task in the existing task context.",
          "",
          "Operator follow-up:",
          "Please summarize the changed files.",
          "",
          "Original mission:",
          "Prepare the release notes."
        ].join("\n"),
        createdAt: "2026-06-04T00:00:00.000Z",
        taskId: "task-1"
      }
    ]
  });

  assert.equal(followUps.length, 1);
  assert.equal(followUps[0]?.message, "Please summarize the changed files.");
  assert.equal(followUps[0]?.prompt?.includes("Operator follow-up:"), true);
});

test("follow-up derivation recovers the operator question from runtime output items", () => {
  const runtime = createRuntime({
    id: "runtime-follow-output",
    runId: "dispatch-1:continue:2000",
    sessionId: "agent:agent-1:explicit:session-raw",
    status: "completed",
    subtitle: "sessions.changed",
    updatedAt: 2000,
    metadata: {
      event: "sessions.changed"
    }
  });
  const task = createTask({
    runtimeIds: [runtime.id],
    runIds: [runtime.runId!],
    sessionIds: ["session-raw"],
    dispatchId: "dispatch-1"
  });
  const outputs: RuntimeOutputRecord[] = [
    {
      runtimeId: runtime.id,
      sessionId: "session-raw",
      taskId: task.id,
      status: "available",
      finalText: "Done.",
      finalTimestamp: "2026-06-04T00:00:02.000Z",
      stopReason: "stop",
      errorMessage: null,
      items: [
        {
          id: "user-1",
          role: "user",
          timestamp: "2026-06-04T00:00:00.000Z",
          text: [
            "Continue this task in the existing task context. Use the current OpenClaw session state and previous result; do not restart unless the operator explicitly asks for a retry.",
            "",
            "Operator follow-up:",
            "Please summarize the changed files.",
            "",
            "Original mission:",
            "Prepare the release notes."
          ].join("\n")
        },
        {
          id: "assistant-1",
          role: "assistant",
          timestamp: "2026-06-04T00:00:02.000Z",
          text: "Done.",
          stopReason: "stop"
        }
      ],
      createdFiles: [],
      warnings: [],
      warningSummary: null
    }
  ];
  const followUps = deriveTaskFollowUpsFromRuntimes(task, [runtime], outputs);

  assert.equal(followUps.length, 1);
  assert.equal(followUps[0]?.message, "Please summarize the changed files.");
  assert.match(followUps[0]?.prompt ?? "", /Operator follow-up:/);
});

test("follow-up derivation groups turn runtimes even when the run id is not namespaced like a dispatch continuation", () => {
  const runtime = createRuntime({
    id: "runtime-follow-derived",
    runId: "turn-42",
    sessionId: "agent:agent-1:explicit:session-raw",
    status: "completed",
    subtitle: "Rollout complete.",
    updatedAt: 2100,
    metadata: {
      turnPrompt: [
        "Continue this task in the existing task context. Use the current OpenClaw session state and previous result; do not restart unless the operator explicitly asks for a retry.",
        "",
        "Operator follow-up:",
        "Check whether the deployment succeeded.",
        "",
        "Original mission:",
        "Prepare the release notes."
      ].join("\n")
    }
  });

  const outputs: RuntimeOutputRecord[] = [
    {
      runtimeId: runtime.id,
      sessionId: runtime.sessionId,
      taskId: "task-1",
      status: "available",
      finalText: "Deployment succeeded.",
      finalTimestamp: "2026-06-04T00:00:02.000Z",
      stopReason: "stop",
      errorMessage: null,
      items: [
        {
          id: "user-1",
          role: "user",
          timestamp: "2026-06-04T00:00:00.000Z",
          text: runtime.metadata.turnPrompt as string
        },
        {
          id: "assistant-1",
          role: "assistant",
          timestamp: "2026-06-04T00:00:02.000Z",
          text: "Deployment succeeded.",
          stopReason: "stop"
        }
      ],
      createdFiles: [],
      warnings: [],
      warningSummary: null
    }
  ];

  const followUps = deriveTaskFollowUpsFromRuntimes(
    createTask({
      dispatchId: "dispatch-1",
      sessionIds: ["session-raw"]
    }),
    [runtime],
    outputs
  );

  assert.equal(followUps.length, 1);
  assert.equal(followUps[0]?.message, "Check whether the deployment succeeded.");
  assert.equal(followUps[0]?.status, "completed");
  assert.equal(followUps[0]?.summary, "Deployment succeeded.");
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
