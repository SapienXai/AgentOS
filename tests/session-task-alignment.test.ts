import assert from "node:assert/strict";
import test from "node:test";

import {
  mapOpenClawTaskListToRuntimes,
  mapOpenClawRuntimeSnapshotToRuntimes
} from "@/lib/openclaw/application/runtime-state-service";
import { NativeWsOpenClawGatewayClient } from "@/lib/openclaw/client/native-ws-gateway-client";
import { buildTaskRecords } from "@/lib/openclaw/domains/task-records";
import { normalizeOpenClawTaskSummary } from "@/lib/openclaw/domains/execution-identity";
import { resolveTaskFollowUpContext } from "@/lib/openclaw/domains/task-follow-up";
import type { OpenClawGatewayClient, OpenClawTaskPayload } from "@/lib/openclaw/client/gateway-client";
import type { OpenClawAgent, RuntimeRecord } from "@/lib/openclaw/types";

test("exact OpenClaw task summaries retain only typed execution identity fields", () => {
  const summary = normalizeOpenClawTaskSummary({
    id: "task-8",
    status: "timed_out",
    kind: "agent",
    runtime: "subagent",
    title: "Compile report",
    agentId: "agent-1",
    sessionKey: "agent:agent-1:explicit:session-8",
    childSessionKey: "agent:agent-1:child:session-8",
    ownerKey: "operator:service",
    runId: "run-8",
    flowId: "flow-8",
    parentTaskId: "task-parent",
    sourceId: "source-8",
    updatedAt: "2026-09-01T10:00:00.000Z",
    progress: 0.5,
    terminalSummary: "Gateway timed out"
  });

  assert.deepEqual(summary, {
    id: "task-8",
    status: "timed_out",
    kind: "agent",
    runtime: "subagent",
    title: "Compile report",
    agentId: "agent-1",
    sessionKey: "agent:agent-1:explicit:session-8",
    childSessionKey: "agent:agent-1:child:session-8",
    ownerKey: "operator:service",
    runId: "run-8",
    taskId: null,
    flowId: "flow-8",
    parentTaskId: "task-parent",
    sourceId: "source-8",
    createdAt: null,
    updatedAt: "2026-09-01T10:00:00.000Z",
    endedAt: null,
    progress: 0.5,
    summary: "Gateway timed out",
    error: null
  });
});

test("tasks.list projection is canonical over stale dispatch and runtime observations", () => {
  const context = {
    agentConfig: [{ id: "agent-1", workspace: "/tmp/workspace" }],
    agentsList: [{ id: "agent-1", workspace: "/tmp/workspace" }],
    resolveWorkspaceId: () => "workspace-1"
  };
  const ledgerRuntimes = mapOpenClawTaskListToRuntimes({
    tasks: [{
      id: "task-1",
      status: "completed",
      title: "Ship report",
      agentId: "agent-1",
      sessionKey: "agent:agent-1:explicit:session-1",
      runId: "run-1",
      updatedAt: "2026-09-01T10:00:02.000Z",
      summary: "Report delivered"
    }]
  }, context);
  const dispatchRuntime = createRuntime({
    id: "runtime-dispatch",
    key: "agent:agent-1:explicit:session-1",
    sessionId: "session-1",
    runId: "run-1",
    status: "running",
    metadata: {
      dispatchId: "dispatch-1",
      dispatchStatus: "stalled",
      mission: "Ship report"
    }
  });

  const tasks = buildTaskRecords([...ledgerRuntimes, dispatchRuntime], [createAgent()]);

  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.key, "task:task-1");
  assert.equal(tasks[0]?.status, "completed");
  assert.equal(tasks[0]?.liveRunCount, 0);
  assert.equal(tasks[0]?.metadata.sourceOfTruth, "openclaw-tasks.list");
  assert.equal(tasks[0]?.metadata.identityProvenance, "authoritative");
  assert.deepEqual(tasks[0]?.runtimeIds, [ledgerRuntimes[0]?.id, "runtime-dispatch"]);
});

test("runtime snapshot task mapping also records the exact native task status", () => {
  const runtimes = mapOpenClawRuntimeSnapshotToRuntimes({
    tasks: [{ id: "task-2", status: "failed", agentId: "agent-1" }]
  }, {
    agentConfig: [],
    agentsList: [],
    resolveWorkspaceId: () => "workspace-1"
  });

  assert.equal(runtimes[0]?.status, "stalled");
  const metadata = runtimes[0]?.metadata as Record<string, unknown> | undefined;
  assert.equal(metadata?.openClawTaskStatus, "failed");
  assert.equal(metadata?.openClawStatusKnown, true);
  assert.equal((metadata?.executionIdentity as Record<string, unknown> | undefined)?.openClawTaskId, "task-2");
});

test("follow-up reuses the canonical native execution identity over stale compatibility metadata", () => {
  const context = resolveTaskFollowUpContext({
    agentIds: ["stale-agent"],
    dispatchId: "dispatch-1",
    primaryAgentId: "stale-agent",
    sessionIds: ["agent:stale-agent:explicit:stale-session"],
    metadata: {
      continuationSessionKey: "agent:stale-agent:explicit:stale-session",
      executionIdentity: {
        agentId: "agent-1",
        openClawTaskId: "task-1",
        sessionKey: "agent:agent-1:explicit:session-1",
        sessionId: "session-1",
        runId: "run-1",
        provenance: "authoritative"
      }
    }
  });

  assert.equal(context.agentId, "agent-1");
  assert.equal(context.sessionKey, "agent:agent-1:explicit:session-1");
  assert.equal(context.sessionId, "session-1");
  assert.equal(context.openClawTaskId, "task-1");
  assert.equal(context.provenance, "native-task");
  assert.equal(context.confidence, "high");
});

test("unsupported tasks.assign never reaches Gateway or CLI transport", async () => {
  let fallbackCalls = 0;
  const fallback = {
    assignTask: async (): Promise<OpenClawTaskPayload> => {
      fallbackCalls += 1;
      return {};
    }
  } as unknown as OpenClawGatewayClient;
  const client = new NativeWsOpenClawGatewayClient({ fallback });

  await assert.rejects(
    client.assignTask({ taskId: "task-1", agentId: "agent-1" }),
    (error: unknown) => error instanceof Error && /does not expose task assignment/i.test(error.message)
  );
  assert.equal(fallbackCalls, 0);
});

function createAgent(): OpenClawAgent {
  return {
    id: "agent-1",
    name: "Agent One",
    workspaceId: "workspace-1",
    workspacePath: "/tmp/workspace",
    modelId: "openai/test",
    isDefault: true,
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

function createRuntime(overrides: Partial<RuntimeRecord>): RuntimeRecord {
  return {
    id: "runtime-1",
    source: "turn",
    key: "agent:agent-1:explicit:session-1",
    title: "Report",
    subtitle: "Runtime update",
    status: "running",
    updatedAt: Date.parse("2026-09-01T10:00:01.000Z"),
    ageMs: 0,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    sessionId: "session-1",
    runId: "run-1",
    metadata: {},
    ...overrides
  };
}
