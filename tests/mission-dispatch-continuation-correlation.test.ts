import assert from "node:assert/strict";
import test from "node:test";

import {
  annotateMissionDispatchMetadata,
  matchMissionDispatchToRuntime
} from "@/lib/openclaw/domains/mission-dispatch-runtime";
import { buildTaskRecords } from "@/lib/openclaw/domains/task-records";
import type { MissionDispatchRecordLike } from "@/lib/openclaw/domains/mission-dispatch-model";
import type { RuntimeRecord } from "@/lib/openclaw/types";

test("a later accepted continuation becomes the task's current execution and result", () => {
  const submittedAt = Date.parse("2026-10-03T10:00:00.000Z");
  const acceptedAt = "2026-10-03T10:01:00.000Z";
  const sessionKey = "agent:agent-1:explicit:dispatch-1";
  const dispatch: MissionDispatchRecordLike = {
    id: "dispatch-1",
    clientRequestId: "request-1",
    status: "stalled",
    agentId: "agent-1",
    sessionId: null,
    sessionKey,
    admissionState: "rejected",
    initialAdmissionError: "The original OpenClaw session start was rejected.",
    cancellation: null,
    operatorHistory: [{
      id: "instruction-1",
      idempotencyKey: "continue-1",
      kind: "continue",
      message: "Open Product Hunt and check the profile login.",
      requestedAt: "2026-10-03T10:00:59.000Z",
      acceptedAt,
      sessionKey,
      sessionId: null,
      runId: "continuation-run-1"
    }],
    mission: "Sign in to Product Hunt and verify the profile.",
    routedMission: "Sign in to Product Hunt and verify the profile.",
    thinking: "medium",
    requestedModelId: null,
    workspaceId: "workspace-1",
    workspacePath: "/tmp/workspace-1",
    submittedAt: new Date(submittedAt).toISOString(),
    updatedAt: "2026-10-03T10:01:00.000Z",
    outputDir: null,
    outputDirRelative: null,
    notesDirRelative: null,
    runner: {
      pid: null,
      childPid: null,
      startedAt: null,
      finishedAt: null,
      lastHeartbeatAt: null,
      logPath: null
    },
    observation: { runtimeId: null, observedAt: null },
    result: null,
    error: "The original OpenClaw session start was rejected."
  };
  const originalRun = {
    id: "runtime:original",
    source: "turn",
    key: sessionKey,
    title: "Product Hunt task",
    subtitle: "Original run output",
    status: "completed",
    updatedAt: submittedAt + 30_000,
    ageMs: 0,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    sessionId: "canonical-session-1",
    runId: "dispatch-1",
    metadata: {
      dispatchId: "dispatch-1",
      mission: dispatch.mission,
      sessionKey
    }
  } as unknown as RuntimeRecord;
  const continuationRun = {
    id: "runtime:continuation",
    source: "turn",
    key: sessionKey,
    title: "Product Hunt task",
    subtitle: "The account needs a sign-in in Secure Browser before I can verify the profile.",
    status: "completed",
    updatedAt: Date.parse("2026-10-03T10:01:20.000Z"),
    ageMs: 0,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    sessionId: "canonical-session-1",
    runId: "continuation-run-1",
    metadata: {
      mission: dispatch.mission,
      sessionKey,
      turnId: "turn-2"
    }
  } as unknown as RuntimeRecord;

  assert.equal(matchMissionDispatchToRuntime(dispatch, [originalRun, continuationRun])?.id, continuationRun.id);

  const runtimes = annotateMissionDispatchMetadata([originalRun, continuationRun], [dispatch]);
  const annotatedContinuation = runtimes.find((runtime) => runtime.id === continuationRun.id);
  assert.equal(annotatedContinuation?.metadata.currentExecution, true);
  assert.equal(annotatedContinuation?.status, "completed");
  assert.equal(annotatedContinuation?.metadata.dispatchStatus, "completed");

  const [task] = buildTaskRecords(runtimes, [{ id: "agent-1", name: "Agent One" }] as Parameters<typeof buildTaskRecords>[1]);
  assert.equal(task?.status, "completed");
  assert.equal(task?.subtitle, continuationRun.subtitle);
  assert.equal(task?.metadata.admissionState, "rejected");
  assert.equal(task?.metadata.initialAdmissionError, dispatch.initialAdmissionError);
  assert.equal(task?.metadata.openClawSessionId, "canonical-session-1");
  assert.equal((task?.metadata.executionIdentity as Record<string, unknown>)?.sessionId, "canonical-session-1");
  assert.equal(task?.metadata.operatorHistory instanceof Array, true);
});

test("a requested session key does not become a fabricated session id in the task projection", () => {
  const sessionKey = "agent:agent-1:explicit:dispatch-2";
  const runtime = {
    id: "runtime:dispatch:dispatch-2",
    source: "turn",
    key: "dispatch:dispatch-2",
    title: "Task",
    subtitle: "Waiting for session admission.",
    status: "stalled",
    updatedAt: Date.now(),
    ageMs: 0,
    agentId: "agent-1",
    metadata: {
      dispatchId: "dispatch-2",
      mission: "Run a task.",
      sessionKey,
      admissionState: "rejected",
      dispatchStatus: "stalled"
    }
  } as unknown as RuntimeRecord;

  const [task] = buildTaskRecords([runtime], [{ id: "agent-1", name: "Agent One" }] as Parameters<typeof buildTaskRecords>[1]);
  assert.equal(task?.metadata.openClawSessionKey, sessionKey);
  assert.equal(task?.metadata.openClawSessionId, null);
});
