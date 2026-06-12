import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInspectorAgentRuntimeView,
  buildInspectorRuntimeEvidenceView,
  buildInspectorTaskSessionView,
  resolvePollingFallbackNotice
} from "@/components/mission-control/inspector/inspector-utils";
import type { MissionControlSnapshot, RuntimeActivityRecord, WorkItemRecord } from "@/lib/agentos/contracts";

test("inspector task session view resolves OpenClaw task/session/run provenance", () => {
  const task = createTask({
    metadata: {
      provenance: "native-task",
      openClawTaskId: "openclaw-task-1",
      openClawSessionKey: "agent:agent-1:explicit:session-1",
      openClawRunId: "run-1"
    }
  });
  const snapshot = createSnapshot({
    tasks: [task],
    runtimes: [createRuntime()]
  });

  const view = buildInspectorTaskSessionView({ snapshot, task });

  assert.equal(view.openClawTaskId, "openclaw-task-1");
  assert.equal(view.openClawTaskIdSource, "metadata");
  assert.deepEqual(view.sessionIds, ["session-1"]);
  assert.deepEqual(view.runIds, ["run-1"]);
  assert.deepEqual(view.runtimeIds, ["runtime-1"]);
  assert.equal(view.dispatchId, "dispatch-1");
  assert.equal(view.workspaceId, "workspace-1");
  assert.equal(view.workspaceName, "Workspace One");
  assert.equal(view.agentId, "agent-1");
  assert.equal(view.agentName, "Agent One");
  assert.equal(view.provenanceLabel, "Native OpenClaw task");
  assert.equal(view.sessionConfidence, "high");
  assert.equal(view.followUpAvailability.available, true);
  assert.equal(view.followUpAvailability.warning, null);
});

test("inspector task session view warns for runtime-derived continuation context", () => {
  const task = createTask({
    dispatchId: undefined,
    metadata: {
      provenance: "runtime-derived"
    }
  });
  const snapshot = createSnapshot({ tasks: [task], runtimes: [createRuntime()] });

  const view = buildInspectorTaskSessionView({ snapshot, task });

  assert.equal(view.openClawTaskId, "task-1");
  assert.equal(view.openClawTaskIdSource, "normalized-task");
  assert.equal(view.provenanceLabel, "Runtime-derived");
  assert.equal(view.sessionConfidence, "medium");
  assert.match(view.followUpAvailability.warning ?? "", /runtime-derived/);
});

test("inspector task session view disables follow-up when no session is available", () => {
  const task = createTask({
    sessionIds: [],
    runtimeIds: [],
    metadata: {
      provenance: "native-task",
      continuationConfidence: "none"
    }
  });
  const snapshot = createSnapshot({ tasks: [task], runtimes: [] });

  const view = buildInspectorTaskSessionView({ snapshot, task });

  assert.equal(view.sessionConfidence, "none");
  assert.equal(view.followUpAvailability.available, false);
  assert.equal(view.followUpAvailability.reason, "This task does not expose an OpenClaw session to continue.");
});

test("polling fallback notice is visible for degraded Gateway event stream modes", () => {
  const polling = resolvePollingFallbackNotice({
    mode: "polling",
    connected: false,
    reconnecting: false,
    reconnectAttempt: 0,
    lastEventAt: null,
    lastError: "missionStream unavailable",
    message: "OpenClaw event streaming is unavailable. AgentOS is refreshing task snapshots by polling.",
    recovery: "Update OpenClaw Gateway."
  });

  assert.equal(polling.visible, true);
  assert.equal(polling.mode, "polling");
  assert.match(polling.message ?? "", /polling/);

  const live = resolvePollingFallbackNotice({
    mode: "live",
    connected: true,
    reconnecting: false,
    reconnectAttempt: 0,
    lastEventAt: "2026-06-13T00:00:00.000Z",
    lastError: null,
    message: null,
    recovery: null
  });

  assert.equal(live.visible, false);
});

test("inspector agent and runtime evidence views summarize normalized records", () => {
  const runtime = createRuntime({
    id: "runtime-2",
    sessionId: "session-2",
    runId: "run-2"
  });
  const snapshot = createSnapshot({
    runtimes: [createRuntime(), runtime]
  });

  const agentView = buildInspectorAgentRuntimeView({ snapshot, agentId: "agent-1" });
  const runtimeView = buildInspectorRuntimeEvidenceView({
    runtime,
    output: {
      createdFiles: [{ path: "/workspace/report.md", displayPath: "report.md" }],
      warnings: ["Transcript recovered from fallback output."]
    }
  });

  assert.deepEqual(agentView.activeRuntimeIds, ["runtime-1", "runtime-2"]);
  assert.deepEqual(agentView.activeSessionIds, ["session-1", "session-2"]);
  assert.deepEqual(agentView.activeRunIds, ["run-1", "run-2"]);
  assert.equal(agentView.recordedSessionCount, 4);
  assert.equal(runtimeView.createdFileCount, 1);
  assert.equal(runtimeView.warningCount, 1);
});

function createSnapshot(overrides: Partial<MissionControlSnapshot> = {}): MissionControlSnapshot {
  return {
    generatedAt: "2026-06-13T00:00:00.000Z",
    mode: "live",
    diagnostics: {
      eventBridge: {
        mode: "live",
        connected: true,
        reconnecting: false,
        reconnectAttempt: 0,
        lastEventAt: "2026-06-13T00:00:00.000Z",
        lastError: null,
        message: null,
        recovery: null
      }
    },
    presence: [],
    channelAccounts: [],
    workspaces: [
      {
        id: "workspace-1",
        name: "Workspace One",
        path: "/tmp/agentos-workspace",
        agentIds: ["agent-1"]
      }
    ],
    agents: [
      {
        id: "agent-1",
        name: "Agent One",
        workspaceId: "workspace-1",
        workspacePath: "/tmp/agentos-workspace",
        activeRuntimeIds: ["runtime-1"],
        sessionCount: 4
      }
    ],
    models: [],
    runtimes: [createRuntime()],
    tasks: [createTask()],
    relationships: [],
    missionPresets: [],
    channelRegistry: {},
    surfaceRuntime: {},
    surfaceDrift: {},
    ...overrides
  } as MissionControlSnapshot;
}

function createTask(overrides: Partial<WorkItemRecord> = {}): WorkItemRecord {
  const { metadata, ...restOverrides } = overrides;

  return {
    id: "task-1",
    key: "task:task-1",
    title: "Ship the release",
    mission: "Ship the release.",
    subtitle: "Task completed.",
    status: "completed",
    updatedAt: 1_780_000_000_000,
    ageMs: 0,
    workspaceId: "workspace-1",
    primaryAgentId: "agent-1",
    primaryAgentName: "Agent One",
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
    ...restOverrides,
    metadata: {
      ...metadata
    }
  };
}

function createRuntime(overrides: Partial<RuntimeActivityRecord> = {}): RuntimeActivityRecord {
  return {
    id: "runtime-1",
    source: "turn",
    key: "agent:agent-1:explicit:session-1",
    title: "Runtime",
    subtitle: "Runtime output.",
    status: "completed",
    updatedAt: 1_780_000_000_000,
    ageMs: 0,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    workspacePath: "/tmp/agentos-workspace",
    sessionId: "session-1",
    taskId: "task-1",
    runId: "run-1",
    metadata: {},
    ...overrides
  };
}
