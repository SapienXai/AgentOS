import assert from "node:assert/strict";
import { test } from "node:test";

import { createMissionDispatchRecord } from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import { buildTaskRecords } from "@/lib/openclaw/domains/task-records";
import type { OpenClawAgent, RuntimeRecord } from "@/lib/openclaw/types";

test("mission dispatch records snapshot the requested model at submission", () => {
  const record = createMissionDispatchRecord({
    agentId: "agent-1",
    mission: "Check inbox",
    routedMission: "Check inbox",
    thinking: "medium",
    requestedModelId: "openai/gpt-5.5",
    workspaceId: "workspace-1",
    workspacePath: "/tmp/workspace-1",
    outputDir: null,
    outputDirRelative: null,
    notesDirRelative: null
  });

  assert.equal(record.requestedModelId, "openai/gpt-5.5");
});

test("same-prompt tasks keep separate run, model, and start metadata", () => {
  const runtimes: RuntimeRecord[] = [
    buildRuntime({
      dispatchId: "dispatch-first-11111111",
      sessionId: "session-first",
      modelId: "openai/gpt-5.5",
      submittedAt: "2026-07-13T08:43:37.458Z"
    }),
    buildRuntime({
      dispatchId: "dispatch-second-22222222",
      sessionId: "session-second",
      modelId: "openai/gpt-5.4-mini",
      submittedAt: "2026-07-13T08:54:31.743Z"
    })
  ];

  const tasks = buildTaskRecords(runtimes, [buildAgent()]);

  assert.equal(tasks.length, 2);
  const first = tasks.find((task) => task.dispatchId === "dispatch-first-11111111");
  const second = tasks.find((task) => task.dispatchId === "dispatch-second-22222222");
  assert.equal(first?.metadata.modelId, "openai/gpt-5.5");
  assert.equal(first?.metadata.dispatchSubmittedAt, "2026-07-13T08:43:37.458Z");
  assert.deepEqual(first?.sessionIds, ["session-first"]);
  assert.equal(second?.metadata.modelId, "openai/gpt-5.4-mini");
  assert.equal(second?.metadata.dispatchSubmittedAt, "2026-07-13T08:54:31.743Z");
  assert.deepEqual(second?.sessionIds, ["session-second"]);
});

function buildRuntime(input: {
  dispatchId: string;
  sessionId: string;
  modelId: string;
  submittedAt: string;
}): RuntimeRecord {
  return {
    id: `runtime:${input.dispatchId}`,
    source: "turn",
    key: `dispatch:${input.dispatchId}`,
    title: "Check inbox",
    subtitle: "Tool · browser · action targetId must match request targetId",
    status: "stalled",
    updatedAt: Date.parse(input.submittedAt) + 45_000,
    ageMs: 0,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    modelId: input.modelId,
    sessionId: input.sessionId,
    runId: input.dispatchId,
    metadata: {
      dispatchId: input.dispatchId,
      dispatchStatus: "stalled",
      dispatchSubmittedAt: input.submittedAt,
      mission: "Check inbox"
    }
  };
}

function buildAgent(): OpenClawAgent {
  return {
    id: "agent-1",
    name: "Porto",
    workspaceId: "workspace-1",
    workspacePath: "/tmp/workspace-1",
    modelId: "openai/gpt-5.5",
    isDefault: false,
    status: "ready",
    sessionCount: 0,
    lastActiveAt: null,
    currentAction: "Ready",
    activeRuntimeIds: [],
    heartbeat: { enabled: false, every: null, everyMs: null },
    identity: {},
    profile: {
      purpose: null,
      operatingInstructions: [],
      responseStyle: [],
      outputPreference: null,
      sourceFiles: []
    },
    tools: [],
    skills: [],
    policy: {
      preset: "worker",
      missingToolBehavior: "ask-setup",
      installScope: "workspace",
      fileAccess: "workspace-only",
      networkAccess: "enabled"
    }
  };
}
