import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { setOpenClawAdapterForTesting, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  readMissionDispatchRecordById,
  reconcileMissionDispatchRuntimeState,
  writeMissionDispatchRecord
} from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import { matchMissionDispatchToRuntime } from "@/lib/openclaw/domains/mission-dispatch-runtime";
import type { MissionDispatchRecord } from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import type { RuntimeRecord } from "@/lib/openclaw/types";

const previousMissionControlRoot = process.env.AGENTOS_MISSION_CONTROL_ROOT;
const previousOpenClawStateDir = process.env.OPENCLAW_STATE_DIR;
const temporaryRoots = new Set<string>();

afterEach(async () => {
  setOpenClawAdapterForTesting(null);
  if (previousMissionControlRoot === undefined) delete process.env.AGENTOS_MISSION_CONTROL_ROOT;
  else process.env.AGENTOS_MISSION_CONTROL_ROOT = previousMissionControlRoot;
  if (previousOpenClawStateDir === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = previousOpenClawStateDir;
  await Promise.all([...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots.clear();
});

test("current accepted run reconciles through its saved session when the runtime omits sessionId", async () => {
  const root = await createTemporaryRoot();
  const record = createDispatchRecord(root);
  await writeMissionDispatchRecord(record);
  let requestedSessionKey: string | null = null;
  setOpenClawAdapterForTesting({
    getSessionHistory: async (input: { sessionKey?: string } = {}) => {
      requestedSessionKey = input.sessionKey ?? null;
      return {
        messages: [
          { role: "user", content: "Complete the task", timestamp: "2026-10-03T15:00:00.000Z" },
          { role: "assistant", content: "Task completed successfully.", timestamp: "2026-10-03T15:00:03.000Z", stopReason: "stop" }
        ]
      };
    }
  } as unknown as OpenClawAdapter);

  const reconciled = await reconcileMissionDispatchRuntimeState(record, createRuntime({
    status: "running",
    runId: "native-run-1",
    sessionId: undefined
  }));

  assert.equal(requestedSessionKey, "agent:main:explicit:dispatch-dispatch-1");
  assert.equal(reconciled?.status, "completed");
  assert.equal(reconciled?.result?.runId, "native-run-1");
  assert.equal(reconciled?.result?.result?.payloads?.[0]?.text, "Task completed successfully.");
  assert.equal((await readMissionDispatchRecordById(record.id))?.status, "completed");
});

test("a previous run cannot reconcile over a newer accepted continuation", async () => {
  const root = await createTemporaryRoot();
  const record = createDispatchRecord(root, {
    status: "running",
    operatorHistory: [
      {
        id: "continue-1",
        idempotencyKey: "continue-request-1",
        kind: "continue",
        message: "Continue with the next step.",
        requestedAt: "2026-10-03T15:01:00.000Z",
        acceptedAt: "2026-10-03T15:01:01.000Z",
        sessionKey: "agent:main:explicit:dispatch-dispatch-1",
        sessionId: "native-session-1",
        runId: "native-run-2"
      }
    ]
  });
  await writeMissionDispatchRecord(record);
  let historyReads = 0;
  setOpenClawAdapterForTesting({
    getSessionHistory: async () => {
      historyReads += 1;
      return { messages: [] };
    }
  } as unknown as OpenClawAdapter);

  const previousRun = createRuntime({
    status: "completed",
    runId: "native-run-1",
    sessionId: "native-session-1"
  });
  const currentRun = createRuntime({
    status: "running",
    runId: "native-run-2",
    sessionId: "native-session-1"
  });
  assert.equal(matchMissionDispatchToRuntime(record, [previousRun, currentRun])?.runId, "native-run-2");

  await reconcileMissionDispatchRuntimeState(record, createRuntime({
    status: "completed",
    runId: "native-run-1",
    sessionId: "native-session-1"
  }));

  assert.equal(historyReads, 0);
  assert.equal((await readMissionDispatchRecordById(record.id))?.status, "running");
  assert.equal((await readMissionDispatchRecordById(record.id))?.result?.runId, "native-run-1");
});

test("terminal admission runtime persists the native result before exposing completion", async () => {
  const root = await createTemporaryRoot();
  const record = createDispatchRecord(root);
  await writeMissionDispatchRecord(record);
  setOpenClawAdapterForTesting({
    getSessionHistory: async () => ({
      messages: [
        { role: "user", content: "Complete the task", timestamp: "2026-10-03T15:00:00.000Z" },
        { role: "assistant", content: "Task completed successfully.", timestamp: "2026-10-03T15:00:03.000Z", stopReason: "stop" }
      ]
    })
  } as unknown as OpenClawAdapter);

  const reconciled = await reconcileMissionDispatchRuntimeState(record, createRuntime({
    status: "completed",
    runId: "native-run-1",
    sessionId: undefined
  }));

  assert.equal(reconciled?.status, "completed");
  assert.equal(reconciled?.result?.result?.payloads?.[0]?.text, "Task completed successfully.");
});

test("terminal native failures keep their captured partial output", async () => {
  const root = await createTemporaryRoot();
  const record = createDispatchRecord(root);
  await writeMissionDispatchRecord(record);
  setOpenClawAdapterForTesting({
    getSessionHistory: async () => ({
      messages: [
        { role: "user", content: "Complete the task", timestamp: "2026-10-03T15:00:00.000Z" },
        { role: "assistant", content: "Partial work before the failure.", timestamp: "2026-10-03T15:00:03.000Z", stopReason: "error" }
      ]
    })
  } as unknown as OpenClawAdapter);

  const reconciled = await reconcileMissionDispatchRuntimeState(record, createRuntime({
    status: "stalled",
    runId: "native-run-1",
    sessionId: undefined
  }));

  assert.equal(reconciled?.status, "stalled");
  assert.equal(reconciled?.result?.result?.payloads?.[0]?.text, "Partial work before the failure.");
});

async function createTemporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-dispatch-current-execution-"));
  temporaryRoots.add(root);
  process.env.AGENTOS_MISSION_CONTROL_ROOT = path.join(root, "mission-control");
  process.env.OPENCLAW_STATE_DIR = path.join(root, "openclaw-state");
  await mkdir(path.join(root, "workspace"), { recursive: true });
  await mkdir(process.env.OPENCLAW_STATE_DIR, { recursive: true });
  return root;
}

function createDispatchRecord(root: string, overrides: Partial<MissionDispatchRecord> = {}): MissionDispatchRecord {
  const sessionKey = "agent:main:explicit:dispatch-dispatch-1";
  const workspacePath = path.join(root, "workspace");
  return {
    id: "dispatch-1",
    clientRequestId: "request-1",
    status: "running",
    admissionState: "accepted",
    initialAdmissionError: null,
    cancellation: null,
    operatorHistory: [],
    agentId: "main",
    sessionId: "native-session-1",
    sessionKey,
    mission: "Complete the task",
    routedMission: "Complete the task",
    thinking: "medium",
    requestedModelId: null,
    workspaceId: "workspace-1",
    workspacePath,
    executionMode: "standard",
    submittedAt: "2026-10-03T15:00:00.000Z",
    updatedAt: "2026-10-03T15:00:01.000Z",
    outputDir: null,
    outputDirRelative: null,
    notesDirRelative: null,
    runner: {
      pid: null,
      childPid: null,
      startedAt: "2026-10-03T15:00:00.000Z",
      finishedAt: null,
      lastHeartbeatAt: "2026-10-03T15:00:01.000Z",
      logPath: null
    },
    observation: { runtimeId: null, observedAt: null },
    result: {
      runId: "native-run-1",
      sessionKey,
      sessionId: "native-session-1",
      status: "accepted"
    },
    error: null,
    ...overrides
  };
}

function createRuntime(input: {
  status: RuntimeRecord["status"];
  runId: string;
  sessionId: string | undefined;
}): RuntimeRecord {
  return {
    id: `runtime:${input.runId}`,
    source: "turn",
    key: "agent:main:explicit:dispatch-dispatch-1",
    title: "Complete the task",
    subtitle: "Native task execution",
    status: input.status,
    updatedAt: Date.parse("2026-10-03T15:00:03.000Z"),
    ageMs: 0,
    agentId: "main",
    sessionId: input.sessionId,
    runId: input.runId,
    metadata: { dispatchId: "dispatch-1" }
  };
}
