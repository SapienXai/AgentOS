import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { setOpenClawAdapterForTesting, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { NativeGatewayError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import { resolveOpenClawCompatibilityMethods } from "@/lib/openclaw/compat/capabilities";
import { checkOpenClawCompatibilityContracts } from "@/lib/openclaw/compat/contracts";
import {
  normalizeOpenClawTaskHistoryInput,
  type OpenClawTaskHistoryInput
} from "@/lib/openclaw/client/types";
import { buildTaskDetailFromTaskRecord } from "@/lib/openclaw/domains/task-detail";
import { loadTaskHistoryForTask } from "@/lib/openclaw/domains/task-history";
import type { MissionControlSnapshot, RuntimeRecord, TaskRecord } from "@/lib/openclaw/types";

afterEach(() => {
  setOpenClawAdapterForTesting(null);
});

test("task history request normalization preserves cursor and bounds limit to the native contract", () => {
  assert.deepEqual(
    normalizeOpenClawTaskHistoryInput({ taskId: " task-1 ", cursor: " cursor-2 ", limit: 999 }),
    { taskId: "task-1", cursor: "cursor-2", limit: 200 }
  );
  assert.deepEqual(
    normalizeOpenClawTaskHistoryInput({ taskId: "task-1", cursor: null, limit: 0 }),
    { taskId: "task-1", limit: 1 }
  );
});

test("task history capability is version-gated to the certified native contract", () => {
  const legacy = resolveOpenClawCompatibilityMethods({
    advertisedMethods: [],
    advertisedEvents: [],
    installedVersion: "2026.9.1",
    source: "gateway-discovery"
  });
  const certified = resolveOpenClawCompatibilityMethods({
    advertisedMethods: ["tasks.list"],
    advertisedEvents: [],
    installedVersion: "2026.9.4",
    source: "gateway-discovery"
  });

  assert.equal(legacy.effectiveMethods.includes("tasks.history"), false);
  assert.equal(certified.knownByContractMethods.includes("tasks.history"), true);
  assert.equal(certified.effectiveMethods.includes("tasks.history"), true);
});

test("task history contract avoids a synthetic live probe and preserves operator.read scope", async () => {
  let probe: { method: string; params: Record<string, unknown> } | null = null;
  const taskHistoryCheck = (await checkOpenClawCompatibilityContracts({
    effectiveMethods: ["tasks.history"],
    effectiveEvents: [],
    authScopes: ["operator.read"],
    capabilitySource: "gateway-discovery",
    cliFallbackAvailable: true,
    cliForced: false,
    includeLiveShapeChecks: true,
    callNative: async (method, params) => {
      probe = { method, params };
      return { messages: [] };
    }
  })).find((entry) => entry.operation === "taskHistory");

  assert.equal(probe, null);
  assert.equal(taskHistoryCheck?.status, "ok");
  assert.equal(taskHistoryCheck?.responseShapeStatus, "not-checked");
  assert.equal(taskHistoryCheck?.responseShapeValid, null);
  assert.deepEqual(taskHistoryCheck?.requiredScopes, ["operator.read"]);
});

test("native task history has precedence and returns the native cursor", async () => {
  const calls: Array<{ method: string; input: unknown }> = [];
  setOpenClawAdapterForTesting({
    async getTaskHistory(input: OpenClawTaskHistoryInput) {
      calls.push({ method: "tasks.history", input });
      return {
        messages: [
          { role: "user", content: "Inspect native task history." },
          { role: "assistant", content: "Authoritative native output." }
        ],
        nextCursor: "next-page"
      };
    },
    async getSessionHistory(input: unknown) {
      calls.push({ method: "session-history", input });
      return { messages: [{ role: "assistant", content: "Legacy output." }] };
    }
  } as unknown as OpenClawAdapter);

  const task = createNativeTask();
  const result = await loadTaskHistoryForTask({
    task,
    runs: [createNativeRuntime()],
    snapshot: { mode: "live" },
    cursor: "page-1",
    limit: 50
  });

  assert.equal(result?.record.source, "native");
  assert.equal(result?.record.status, "available");
  assert.equal(result?.record.taskId, "native-task-1");
  assert.equal(result?.record.nextCursor, "next-page");
  assert.deepEqual(calls, [{
    method: "tasks.history",
    input: { taskId: "native-task-1", cursor: "page-1", limit: 50 }
  }]);

  const detail = await buildTaskDetailFromTaskRecord(task, createSnapshot(), null, { taskHistoryLimit: 50 });
  assert.equal(detail.taskHistory?.source, "native");
  assert.equal(detail.outputs[0]?.finalText, "Authoritative native output.");
});

test("unsupported native task history recovers through bounded, labeled session history", async () => {
  const calls: Array<{ method: string; input: unknown }> = [];
  setOpenClawAdapterForTesting({
    async getTaskHistory(input: OpenClawTaskHistoryInput) {
      calls.push({ method: "tasks.history", input });
      throw new NativeGatewayError("tasks.history is not supported", { kind: "unsupported" });
    },
    async getSessionHistory(input: unknown) {
      calls.push({ method: "session-history", input });
      return { messages: [{ role: "assistant", content: "Recovered output." }] };
    }
  } as unknown as OpenClawAdapter);

  const result = await loadTaskHistoryForTask({
    task: createNativeTask(),
    runs: [createNativeRuntime()],
    snapshot: { mode: "live" },
    cursor: "legacy-page",
    limit: 999
  });

  assert.equal(result?.record.source, "legacy-session-history");
  assert.equal(result?.record.status, "recovered");
  assert.equal(result?.record.label, "Legacy session history fallback (bounded)");
  assert.equal(result?.record.limit, 200);
  assert.match(result?.record.reason ?? "", /does not expose tasks\.history/i);
  assert.deepEqual(calls, [
    { method: "tasks.history", input: { taskId: "native-task-1", cursor: "legacy-page", limit: 200 } },
    {
      method: "session-history",
      input: {
        sessionKey: "agent:agent-1:explicit:session-1",
        cursor: "legacy-page",
        limit: 200
      }
    }
  ]);
});

test("native denial, missing task, and empty history stay observable without fallback", async () => {
  for (const [error, expectedStatus] of [
    [new NativeGatewayError("operator scope denied", { kind: "scope-limited" }), "denied"],
    [new NativeGatewayError("task was not found", { kind: "unknown" }), "missing"]
  ] as const) {
    let sessionHistoryCalls = 0;
    setOpenClawAdapterForTesting({
      async getTaskHistory() {
        throw error;
      },
      async getSessionHistory() {
        sessionHistoryCalls += 1;
        return { messages: [] };
      }
    } as unknown as OpenClawAdapter);

    const result = await loadTaskHistoryForTask({
      task: createNativeTask(),
      runs: [createNativeRuntime()],
      snapshot: { mode: "live" }
    });

    assert.equal(result?.record.status, expectedStatus);
    assert.equal(result?.record.source, "native");
    assert.equal(sessionHistoryCalls, 0);
  }

  setOpenClawAdapterForTesting({
    async getTaskHistory() {
      return { messages: [], nextCursor: "still-empty" };
    }
  } as unknown as OpenClawAdapter);
  const empty = await loadTaskHistoryForTask({
    task: createNativeTask(),
    runs: [createNativeRuntime()],
    snapshot: { mode: "live" }
  });
  assert.equal(empty?.record.status, "empty");
  assert.equal(empty?.record.nextCursor, "still-empty");
});

test("native task history exposes unavailable and failed recovery states honestly", async () => {
  setOpenClawAdapterForTesting({
    async getTaskHistory() {
      throw new NativeGatewayError("Gateway timed out", { kind: "timeout" });
    }
  } as unknown as OpenClawAdapter);

  const unavailable = await loadTaskHistoryForTask({
    task: createNativeTask(),
    runs: [createNativeRuntime()],
    snapshot: { mode: "live" }
  });
  assert.equal(unavailable?.record.status, "unavailable");
  assert.match(unavailable?.record.recovery ?? "", /restart|diagnostics/i);

  setOpenClawAdapterForTesting({
    async getTaskHistory() {
      throw new NativeGatewayError("tasks.history returned malformed payload", { kind: "malformed-response" });
    }
  } as unknown as OpenClawAdapter);
  const failed = await loadTaskHistoryForTask({
    task: createNativeTask(),
    runs: [createNativeRuntime()],
    snapshot: { mode: "live" }
  });
  assert.equal(failed?.record.status, "failed");
  assert.match(failed?.record.reason ?? "", /malformed payload/i);
});

function createNativeTask(): TaskRecord {
  return {
    id: "task:native-task-1",
    key: "task:native-task-1",
    title: "Native task",
    mission: "Inspect native task history.",
    subtitle: "Running",
    status: "running",
    updatedAt: 1_780_000_000_000,
    ageMs: 0,
    primaryAgentId: "agent-1",
    primaryRuntimeId: "runtime-native-task",
    runtimeIds: ["runtime-native-task"],
    agentIds: ["agent-1"],
    sessionIds: ["session-1"],
    runIds: ["run-1"],
    runtimeCount: 1,
    updateCount: 1,
    liveRunCount: 1,
    artifactCount: 0,
    warningCount: 0,
    metadata: {
      openClawTaskId: "native-task-1",
      openClawSessionKey: "agent:agent-1:explicit:session-1",
      sourceOfTruth: "openclaw-tasks.list",
      provenance: "native-task"
    }
  };
}

function createNativeRuntime(): RuntimeRecord {
  return {
    id: "runtime-native-task",
    source: "turn",
    key: "task:native-task-1",
    title: "Native task",
    subtitle: "Running",
    status: "running",
    updatedAt: 1_780_000_000_000,
    ageMs: 0,
    agentId: "agent-1",
    taskId: "native-task-1",
    runId: "run-1",
    metadata: {
      gatewayObjectKind: "task",
      openClawTaskId: "native-task-1",
      openClawSessionKey: "agent:agent-1:explicit:session-1"
    }
  };
}

function createSnapshot(): MissionControlSnapshot {
  const task = createNativeTask();
  const runtime = createNativeRuntime();
  return {
    generatedAt: "2026-09-12T00:00:00.000Z",
    mode: "live",
    diagnostics: {},
    presence: [],
    channelAccounts: [],
    workspaces: [],
    agents: [{ id: "agent-1", name: "Agent One", workspacePath: "/tmp/workspace" }],
    models: [],
    runtimes: [runtime],
    tasks: [task],
    agentInbox: [],
    relationships: [],
    missionPresets: [],
    channelRegistry: {},
    surfaceRuntime: {},
    surfaceDrift: {}
  } as unknown as MissionControlSnapshot;
}
