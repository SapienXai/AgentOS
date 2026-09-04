import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  clearOpenClawCapabilityMatrixCacheForTesting,
  getOpenClawCapabilityMatrix,
  setOpenClawCapabilityMatrixNativeCallerForTesting
} from "@/lib/openclaw/application/capability-matrix-service";
import {
  getOpenClawEventBridgeStatus,
  getOpenClawEventBridgeStreamStatus,
  resetOpenClawEventBridgeForTesting,
  subscribeOpenClawEventBridgeEvents
} from "@/lib/openclaw/application/event-bridge-service";
import { setOpenClawAdapterForTesting } from "@/lib/openclaw/adapter/openclaw-adapter";
import { createOfficialBackedOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client";
import { setOpenClawGatewayClientForTesting } from "@/lib/openclaw/client/gateway-client-factory";
import { OfficialGatewayHarness } from "@/tests/helpers/official-gateway-harness";

let activeClient: ReturnType<typeof createOfficialBackedOpenClawGatewayClient> | null = null;
let activeHarness: OfficialGatewayHarness | null = null;

afterEach(async () => {
  resetOpenClawEventBridgeForTesting();
  clearOpenClawCapabilityMatrixCacheForTesting();
  setOpenClawGatewayClientForTesting(null);
  setOpenClawAdapterForTesting(null);
  activeClient?.close?.("official event bridge test cleanup");
  activeClient = null;
  await activeHarness?.close();
  activeHarness = null;
});

test("official-backed event bridge replays subscriptions and continues delivering events", { concurrency: false }, async () => {
  activeHarness = await createHarness();
  activeClient = createOfficialBackedOpenClawGatewayClient({ url: activeHarness.url, token: "event-bridge-token" });
  setOpenClawGatewayClientForTesting(activeClient);
  await getOpenClawCapabilityMatrix({ force: true });

  const received: string[] = [];
  const unsubscribe = subscribeOpenClawEventBridgeEvents((frame) => received.push(frame.event));
  try {
    await waitFor(() => countRequests("sessions.subscribe") === 1);
    await waitFor(() => getOpenClawEventBridgeStatus().connected);

    activeHarness.emitEvent("task", { task: { id: "task-a", status: "running", agentId: "agent-a" } }, 1);
    await waitFor(() => received.length === 1);

    activeHarness.closeSockets(1012, "restart");
    await waitFor(() => countRequests("sessions.subscribe") === 2, 5_000);
    await waitFor(() => getOpenClawEventBridgeStreamStatus().lastReconciledAt !== null, 5_000);
    assert.equal(getOpenClawEventBridgeStatus().reconnecting, false);
    assert.equal(countRequests("tasks.subscribe"), 0);

    activeHarness.emitEvent("task", { task: { id: "task-b", status: "completed", agentId: "agent-b" } }, 1);
    await waitFor(() => received.length === 2);

    // The official client owns reconnect; an external bridge timer must not
    // create a third subscription after the official replay completed.
    await delay(100);
    assert.equal(countRequests("sessions.subscribe"), 2);
  } finally {
    unsubscribe();
  }
});

test("official-backed event bridge coalesces sequence gaps into bounded reconciliation", { concurrency: false }, async () => {
  activeHarness = await createHarness();
  activeClient = createOfficialBackedOpenClawGatewayClient({ url: activeHarness.url, token: "gap-token" });
  setOpenClawGatewayClientForTesting(activeClient);
  await getOpenClawCapabilityMatrix({ force: true });

  const unsubscribe = subscribeOpenClawEventBridgeEvents(() => {});
  try {
    await waitFor(() => countRequests("sessions.subscribe") === 1);
    const baselineSessions = countRequests("sessions.list");
    const baselineTasks = countRequests("tasks.list");

    activeHarness.emitEvent("task", { task: { id: "task-gap", status: "running" } }, 1);
    activeHarness.emitEvent("task", { task: { id: "task-gap", status: "completed" } }, 3);
    await waitFor(() => getOpenClawEventBridgeStatus().sequenceGapCount === 1);
    await waitFor(() => getOpenClawEventBridgeStreamStatus().lastReconciledAt !== null, 5_000);

    const sessionReconciliations = countRequests("sessions.list") - baselineSessions;
    const taskReconciliations = countRequests("tasks.list") - baselineTasks;
    assert.ok(sessionReconciliations >= 1);
    assert.ok(taskReconciliations >= 1);
    assert.ok(sessionReconciliations <= 2);
    assert.ok(taskReconciliations <= 2);
    assert.equal(getOpenClawEventBridgeStreamStatus().reconciliationState, "idle");
    assert.equal(getOpenClawEventBridgeStreamStatus().expectedSeq, 2);
    assert.equal(getOpenClawEventBridgeStreamStatus().receivedSeq, 3);
  } finally {
    unsubscribe();
  }
});

test("official-backed event bridge leaves reconnect storms to the official client", { concurrency: false }, async () => {
  activeHarness = await createHarness();
  activeClient = createOfficialBackedOpenClawGatewayClient({ url: activeHarness.url, token: "storm-token" });
  setOpenClawGatewayClientForTesting(activeClient);
  await getOpenClawCapabilityMatrix({ force: true });

  const unsubscribe = subscribeOpenClawEventBridgeEvents(() => {});
  try {
    await waitFor(() => countRequests("sessions.subscribe") === 1);
    await waitFor(() => getOpenClawEventBridgeStatus().connected);
    const initialConnections = activeHarness.connectionCount;

    await activeHarness.close();
    await waitFor(() => getOpenClawEventBridgeStatus().reconnecting, 2_000);
    await delay(1_200);

    assert.equal(getOpenClawEventBridgeStatus().reconnectAttempt, 1);
    assert.equal(getOpenClawEventBridgeStatus().connected, false);
    assert.equal(activeHarness.connectionCount, initialConnections);
  } finally {
    unsubscribe();
  }
});

async function createHarness() {
  setOpenClawCapabilityMatrixNativeCallerForTesting(async () => ({
    protocolVersion: 4,
    methods: ["sessions.subscribe", "sessions.list", "tasks.list"],
    events: ["task", "session.message"]
  }));

  const harness = await OfficialGatewayHarness.create({
    routes: {
      status: ({ respond }) => respond({ version: "2026.8.2" }),
      "sessions.subscribe": ({ respond }) => respond({ ok: true }),
      "sessions.list": ({ respond }) => respond({ sessions: [] }),
      "tasks.list": ({ respond }) => respond({ tasks: [] })
    }
  });
  return harness;
}

function countRequests(method: string) {
  return activeHarness?.requests.filter((request) => request.method === method).length ?? 0;
}

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for official event bridge state: ${JSON.stringify(getOpenClawEventBridgeStatus())}`);
    }
    await delay(10);
  }
}
