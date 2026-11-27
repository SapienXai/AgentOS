import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildMissionProjection,
  buildMissionSeeds
} from "@/lib/agentos/application/workforce-service";
import type { MissionControlSnapshot, RuntimeRecord, TaskDetailRecord, TaskRecord } from "@/lib/agentos/contracts";
import type { MissionDispatchRecord } from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import { mapSessionCatalogEntryToRuntime } from "@/lib/openclaw/domains/runtime-normalizer";
import { buildTaskRecords } from "@/lib/openclaw/domains/task-records";

function task(input: Partial<TaskRecord> & Pick<TaskRecord, "id" | "status">): TaskRecord {
  return {
    id: input.id,
    key: input.key ?? input.id,
    title: input.title ?? input.id,
    mission: input.mission ?? null,
    subtitle: input.subtitle ?? "fixture",
    status: input.status,
    updatedAt: input.updatedAt ?? Date.parse("2026-09-06T10:00:00.000Z"),
    workspaceId: input.workspaceId ?? "workspace-visible",
    primaryAgentId: input.primaryAgentId ?? "worker-a",
    primaryAgentName: input.primaryAgentName ?? "Research Agent",
    primaryRuntimeId: input.primaryRuntimeId,
    dispatchId: input.dispatchId,
    runtimeIds: input.runtimeIds ?? [],
    agentIds: input.agentIds ?? ["worker-a"],
    sessionIds: input.sessionIds ?? [],
    runIds: input.runIds ?? [],
    runtimeCount: input.runtimeCount ?? 1,
    updateCount: input.updateCount ?? 1,
    liveRunCount: input.liveRunCount ?? 0,
    artifactCount: input.artifactCount ?? 0,
    warningCount: input.warningCount ?? 0,
    tokenUsage: input.tokenUsage,
    metadata: input.metadata ?? {}
  } as TaskRecord;
}

function runtime(taskId: string, status: RuntimeRecord["status"]): RuntimeRecord {
  return {
    id: `runtime:${taskId}`,
    source: "turn",
    key: taskId,
    title: taskId,
    subtitle: status,
    status,
    updatedAt: Date.parse("2026-09-06T10:01:00.000Z"),
    ageMs: 0,
    agentId: "worker-b",
    taskId,
    metadata: {}
  };
}

function snapshot(tasks: TaskRecord[], runtimes: RuntimeRecord[] = []): MissionControlSnapshot {
  return {
    generatedAt: "2026-09-06T10:02:00.000Z",
    revision: 1,
    mode: "live",
    diagnostics: { health: "healthy", rpcOk: true, runtimeIssues: [] } as never,
    presence: [],
    channelAccounts: [],
    workspaces: [{ id: "workspace-visible", name: "Visible", path: "/tmp/visible", agentIds: ["worker-a", "worker-b"] } as never],
    agents: [
      { id: "worker-a", name: "Research Agent", workspaceId: "workspace-visible", workspacePath: "/tmp/visible" } as never,
      { id: "worker-b", name: "Data Agent", workspaceId: "workspace-visible", workspacePath: "/tmp/visible" } as never
    ],
    models: [],
    runtimes,
    tasks,
    agentInbox: [],
    nativeWork: { suggestions: [] } as never,
    relationships: [],
    missionPresets: [],
    channelRegistry: {} as never,
    surfaceRuntime: {} as never,
    surfaceDrift: {} as never
  };
}

function dispatch(overrides: Partial<MissionDispatchRecord> = {}): MissionDispatchRecord {
  return {
    id: "dispatch-1",
    clientRequestId: "request-1",
    status: "running",
    agentId: "worker-a",
    sessionId: null,
    mission: "Prepare the research brief",
    routedMission: "Prepare the research brief",
    thinking: "medium",
    requestedModelId: null,
    workspaceId: "workspace-visible",
    workspacePath: "/tmp/visible",
    executionMode: "standard",
    submittedAt: "2026-09-06T10:00:00.000Z",
    updatedAt: "2026-09-06T10:01:00.000Z",
    outputDir: "/tmp/visible/output",
    outputDirRelative: "output",
    notesDirRelative: null,
    runner: { pid: null, childPid: null, startedAt: "2026-09-06T10:00:00.000Z", finishedAt: null, lastHeartbeatAt: "2026-09-06T10:01:00.000Z", logPath: "/tmp/dispatch.log" },
    observation: { runtimeId: null, observedAt: null },
    result: null,
    error: null,
    browserBinding: null,
    ...overrides
  } as MissionDispatchRecord;
}

test("root and child native linkage produces waiting-worker consistently", () => {
  const root = task({ id: "root-record", status: "idle", mission: "Prepare the research brief", dispatchId: "dispatch-1", runtimeIds: ["runtime:root"], metadata: { provenance: "dispatch-derived", openClawTaskId: "native-root", createdAt: "2026-09-06T10:00:00.000Z" } });
  const child = task({ id: "child-record", status: "running", mission: null, primaryAgentId: "worker-b", primaryAgentName: "Data Agent", runtimeIds: ["runtime:native-child"], metadata: { parentTaskId: "native-root", openClawTaskId: "native-child", createdAt: "2026-09-06T10:01:00.000Z" } });
  const current = snapshot([root, child], [runtime("native-child", "running")]);
  const seed = buildMissionSeeds(current.tasks, [dispatch()], current)[0];
  assert.ok(seed);

  const projection = buildMissionProjection({ snapshot: current, seed, humanControlItems: [], detail: null });
  assert.equal(projection.state, "waiting-worker");
  assert.deepEqual(projection.workTree.map((item) => [item.relationship, item.parentId]), [["primary", null], ["delegated", "root-record"]]);
  assert.equal(projection.activeWorkers.length, 1);
  assert.equal(projection.activeWorkers[0]?.name, "Data Agent");
  assert.equal(projection.activeWorkers[0]?.startedAt, "2026-09-06T10:01:00.000Z");
});

test("hidden dispatch sidecars are not converted into user-visible missions", () => {
  const current = snapshot([]);
  const hidden = dispatch({ id: "dispatch-hidden", workspaceId: "workspace-hidden", agentId: "worker-hidden" });
  assert.equal(buildMissionSeeds([], [hidden], current).length, 0);

  const hiddenWorkspaceWithVisibleAgent = dispatch({ id: "dispatch-hidden-agent", workspaceId: "workspace-hidden", agentId: "worker-a" });
  assert.equal(buildMissionSeeds([], [hiddenWorkspaceWithVisibleAgent], current).length, 0);

  const visible = dispatch();
  assert.equal(buildMissionSeeds([], [visible], current).length, 1);
});

test("session-only delegation preserves native lineage without creating a second mission", () => {
  const parentKey = "agent:worker-a:mission-1";
  const root = task({
    id: "root-record",
    status: "idle",
    dispatchId: "dispatch-1",
    metadata: { openClawSessionKey: parentKey }
  });
  const childRuntime = mapSessionCatalogEntryToRuntime({
    key: "agent:worker-b:subagent:child-1",
    sessionId: "child-session",
    spawnedBy: parentKey,
    parentSessionKey: parentKey,
    label: "Check source data",
    lastRunId: "native-run",
    subagentRunState: "active",
    status: "running"
  }, [], [{ id: "worker-b", workspace: "/tmp/visible" }], { resolveWorkspaceId: () => "workspace-visible" });
  const [child] = buildTaskRecords([childRuntime], []);
  assert.ok(child);
  assert.equal(child.title, "Check source data");
  assert.deepEqual(child.runIds, ["native-run"]);
  const current = snapshot([root, child], [childRuntime]);
  const seeds = buildMissionSeeds(current.tasks, [dispatch()], current);
  assert.equal(seeds.length, 1);
  const projection = buildMissionProjection({ snapshot: current, seed: seeds[0]!, humanControlItems: [], detail: null });
  assert.equal(projection.state, "waiting-worker");
  assert.deepEqual(projection.workTree.map(({ relationship, parentId }) => [relationship, parentId]), [
    ["primary", null], ["delegated", root.id]
  ]);
  const hiddenParent = snapshot([{ ...root, workspaceId: "workspace-hidden" }, child], [childRuntime]);
  assert.equal(buildMissionSeeds(hiddenParent.tasks, [dispatch()], hiddenParent)[0]?.tasks.length, 1);
});

test("same evidence produces the same state for list and detail projection paths", () => {
  const root = task({ id: "root-record", status: "running", mission: "Prepare the research brief", dispatchId: "dispatch-1", metadata: { provenance: "dispatch-derived", openClawTaskId: "native-root" } });
  const current = snapshot([root], [runtime("native-root", "running")]);
  const seed = buildMissionSeeds(current.tasks, [dispatch()], current)[0];
  assert.ok(seed);
  const listState = buildMissionProjection({ snapshot: current, seed, humanControlItems: [], detail: null }).state;
  const detailState = buildMissionProjection({ snapshot: current, seed, humanControlItems: [], detail: null }).state;
  assert.equal(listState, detailState);
  assert.equal(listState, "running");
});

test("a follow-up reply does not become the completed mission's result", () => {
  const root = task({ id: "root-record", status: "completed", dispatchId: "dispatch-1" });
  const current = snapshot([root]);
  const original = "The verified workspace total is 54 orders and the reserve is 162 USD.";
  const reply = "54 orders.";
  const detail: TaskDetailRecord = {
    task: root, runs: [], createdFiles: [], warnings: [], liveFeed: [],
    outputs: [{
      runtimeId: "runtime:follow-up", status: "available", finalText: reply, finalTimestamp: null,
      stopReason: "stop", errorMessage: null, items: [], createdFiles: [], warnings: [], warningSummary: null
    }],
    integrity: {
      status: "verified", outputDir: null, outputDirRelative: null, outputDirExists: false,
      outputFileCount: 0, transcriptTurnCount: 1, matchingTranscriptTurnCount: 1,
      finalResponseText: original, finalResponseSource: "runtime", dispatchSessionId: null,
      sessionMismatch: false, toolNames: [], emails: [], issues: []
    }
  };
  const [seed] = buildMissionSeeds(current.tasks, [dispatch({ status: "completed" })], current);
  assert.ok(seed);

  const projection = buildMissionProjection({ snapshot: current, seed, humanControlItems: [], detail });
  assert.equal(projection.state, "completed");
  assert.equal(projection.result, original);
  assert.equal(projection.deliverable?.summary, original);
});
