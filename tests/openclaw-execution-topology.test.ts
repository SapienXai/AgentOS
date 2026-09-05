import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  dispatchSession,
  moveSession,
  reclaimSession,
  readExecutionTopology
} from "@/lib/openclaw/application/execution-topology-service";
import { NativeGatewayError, NativeGatewayRequestError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  isEnvironmentEligible,
  normalizeExecutionEnvironment,
  normalizeSessionPlacement,
  placementTargetToDispatchInput,
  placementTargetToMoveInput
} from "@/lib/openclaw/domains/execution-topology";
import {
  comparePinnedMethodScopes,
  parsePinnedCoreDescriptorScopes,
  PHASE_8_STATIC_NATIVE_METHODS
} from "@/lib/openclaw/certification/upstream-scope";
import { OPENCLAW_STATIC_METHOD_SCOPES } from "@/lib/openclaw/identity/contract";
import type { OpenClawEnvironmentSummary } from "@/lib/openclaw/client/types";
import { createNativeGatewayTestClient } from "@/tests/helpers/fake-openclaw-gateway";

function environment(overrides: Partial<OpenClawEnvironmentSummary> = {}): OpenClawEnvironmentSummary {
  return {
    id: "node:mac-1",
    type: "node",
    label: "M5 Mac",
    status: "available",
    platform: "macOS",
    sessionHost: true,
    trust: "persistent",
    capabilities: ["shell"],
    invocableCommands: [],
    ...overrides
  };
}

function sessionPlacement(state: string, generation: number, environmentId?: string) {
  return {
    session: {
      placement: {
        state,
        generation,
        ...(environmentId ? { environmentId } : {}),
        activeOwnerEpoch: 1
      }
    }
  };
}

function sessionProfilePlacement(state: string, generation: number, profileId: string) {
  return {
    session: {
      placement: {
        state,
        generation,
        profileId,
        environmentId: `worker:${profileId}`,
        activeOwnerEpoch: 1
      }
    }
  };
}

test("execution topology preserves native IDs and conservative eligibility", () => {
  const gateway = normalizeExecutionEnvironment(environment({ id: "gateway", type: "local", label: "Gateway" }));
  const connectedNonHost = normalizeExecutionEnvironment(environment({ sessionHost: false }));
  const startingWorker = normalizeExecutionEnvironment(environment({
    id: "worker-1",
    type: "worker",
    status: "starting",
    worker: {
      providerId: "profile-1",
      state: "provisioning",
      ageMs: 1,
      attachedSessionIds: [],
      tunnelStatus: "connecting"
    }
  }));

  assert.equal(gateway.id, "gateway");
  assert.equal(gateway.status, "available");
  assert.equal(isEnvironmentEligible(gateway), true);
  assert.equal(isEnvironmentEligible(connectedNonHost), false);
  assert.equal(isEnvironmentEligible(startingWorker), false);
  assert.equal(isEnvironmentEligible(normalizeExecutionEnvironment(environment())), true);
});

test("9.1 execution topology static scopes match the pinned descriptor contract", () => {
  const descriptors = `
    ["node.list", "nodes", "operator.read", "<=2026.7"],
    ["node.describe", "nodes", "operator.read", "<=2026.7"],
    ["environments.list", "environments", "operator.read", "2026.7"],
    ["environments.status", "environments", "operator.read", "2026.7"],
    ["environments.create", "environments", "operator.admin", "2026.7"],
    ["environments.destroy", "environments", "operator.admin", "2026.7"],
    ["sessions.reclaim", "sessions", "operator.write", "2026.7"],
  `;
  const upstream = parsePinnedCoreDescriptorScopes(descriptors, PHASE_8_STATIC_NATIVE_METHODS);
  assert.equal(comparePinnedMethodScopes(OPENCLAW_STATIC_METHOD_SCOPES, upstream, PHASE_8_STATIC_NATIVE_METHODS), true);
  assert.equal(OPENCLAW_STATIC_METHOD_SCOPES["sessions.dispatch"], undefined);
  assert.equal(OPENCLAW_STATIC_METHOD_SCOPES["sessions.move"], undefined);
  assert.equal(OPENCLAW_STATIC_METHOD_SCOPES["node.invoke"], undefined);
});

test("session placement uses exact native evidence and does not invent a placement", () => {
  const active = normalizeSessionPlacement(sessionPlacement("active", 4, "node:mac-1"));
  const unknown = normalizeSessionPlacement({ session: { status: "running" } });

  assert.deepEqual(active, {
    source: "openclaw",
    state: "active",
    generation: 4,
    environmentId: "node:mac-1",
    profileId: null,
    deviceId: null,
    ownerEpoch: 1,
    updatedAtMs: null
  });
  assert.equal(unknown.state, "unknown");
  assert.equal(unknown.environmentId, null);
});

test("placement payload builders preserve native destination semantics", () => {
  assert.deepEqual(placementTargetToDispatchInput("agent:one:session", { kind: "automatic" }), {
    key: "agent:one:session",
    autoDevice: true
  });
  assert.deepEqual(placementTargetToDispatchInput("agent:one:session", { kind: "device", deviceId: "node-1" }, "agent-1"), {
    key: "agent:one:session",
    agentId: "agent-1",
    deviceId: "node-1"
  });
  assert.deepEqual(placementTargetToMoveInput("agent:one:session", { generation: 2, environmentId: "gateway", ownerEpoch: 3 }, { kind: "gateway" }), {
    key: "agent:one:session",
    expected: { generation: 2, environmentId: "gateway", ownerEpoch: 3 },
    target: { kind: "gateway" }
  });
});

test("native execution methods use the exact Gateway methods and never fall back to CLI", async () => {
  const { client, gateway, fallback } = createNativeGatewayTestClient({
    gatewayOptions: {
      methods: [
        "environments.list",
        "environments.status",
        "environments.create",
        "environments.destroy",
        "node.list",
        "node.describe",
        "sessions.get",
        "sessions.dispatch",
        "sessions.move",
        "sessions.reclaim"
      ]
    }
  });
  gateway.route("environments.list", (_frame, context) => context.respond({ environments: [environment()] }));
  gateway.route("environments.status", (_frame, context) => context.respond(environment()));
  gateway.route("environments.create", (_frame, context) => context.respond(environment({ id: "worker-1", type: "worker" })));
  gateway.route("environments.destroy", (_frame, context) => context.respond(environment({ id: "worker-1", type: "worker", status: "destroying" })));
  gateway.route("node.list", (_frame, context) => context.respond({ nodes: [] }));
  gateway.route("node.describe", (_frame, context) => context.respond({ nodeId: "mac-1", connected: true }));
  gateway.route("sessions.get", (_frame, context) => context.respond(sessionPlacement("local", 1, "gateway")));
  gateway.route("sessions.dispatch", (_frame, context) => context.respond({ ok: true, placement: sessionPlacement("active", 2, "node:mac-1").session.placement }));
  gateway.route("sessions.move", (_frame, context) => context.respond({ ok: true, placement: sessionPlacement("active", 2, "node:mac-1").session.placement }));
  gateway.route("sessions.reclaim", (_frame, context) => context.respond({ ok: true, placement: sessionPlacement("reclaimed", 2, "gateway").session.placement }));

  await client.listNativeExecutionEnvironments();
  await client.getNativeExecutionEnvironmentStatus({ environmentId: "node:mac-1" });
  await client.createNativeExecutionEnvironment({ profileId: "profile-1", idempotencyKey: "native-op-1" });
  await client.destroyNativeExecutionEnvironment({ environmentId: "worker-1" });
  await client.listNativeNodes();
  await client.describeNativeNode({ nodeId: "mac-1" });
  await client.getNativeSession({ key: "agent:one:session" });
  await client.dispatchNativeSession({ key: "agent:one:session", autoDevice: true });
  await client.moveNativeSession({ key: "agent:one:session", expected: { generation: 1, environmentId: "gateway", ownerEpoch: 1 }, target: { kind: "gateway" } });
  await client.reclaimNativeSession({ key: "agent:one:session" });

  assert.deepEqual(gateway.sentFrames.slice(1).map((frame) => frame.method), [
    "environments.list",
    "environments.status",
    "environments.create",
    "environments.destroy",
    "node.list",
    "node.describe",
    "sessions.get",
    "sessions.dispatch",
    "sessions.move",
    "sessions.reclaim"
  ]);
  assert.deepEqual(fallback.calls, []);
});

test("execution topology service reads one bounded native inventory", async () => {
  let reads = 0;
  const topology = await readExecutionTopology({
    adapter: {
      listNativeExecutionEnvironments: async () => {
        reads += 1;
        return { environments: [environment()], profiles: [{ id: "profile-1", providerId: "provider-1" }] };
      }
    } as unknown as OpenClawAdapter
  });

  assert.equal(reads, 1);
  assert.equal(topology.sourceStatus, "available");
  assert.equal(topology.environments[0]?.id, "node:mac-1");
  assert.equal(topology.profiles[0]?.id, "profile-1");
});

test("topology read failure is unknown rather than an authoritative empty inventory", async () => {
  const topology = await readExecutionTopology({
    adapter: {
      listNativeExecutionEnvironments: async () => {
        throw new NativeGatewayError("Gateway unavailable", { kind: "unreachable" });
      }
    } as unknown as OpenClawAdapter
  });

  assert.equal(topology.sourceStatus, "unknown");
  assert.deepEqual(topology.environments, []);
});

test("dispatch uses native method once and reconciles an actual placement transition", async () => {
  let placementReads = 0;
  let dispatchCalls = 0;
  const result = await dispatchSession(
    { sessionKey: "agent:one:session", target: { kind: "automatic" } },
    {
      adapter: {
        getNativeSession: async () => {
          placementReads += 1;
          return placementReads === 1 ? sessionPlacement("local", 1, "gateway") : sessionPlacement("active", 2, "node:mac-1");
        },
        dispatchNativeSession: async () => {
          dispatchCalls += 1;
          throw new NativeGatewayRequestError("response lost after dispatch", "sessions.dispatch", true, { kind: "timeout" });
        }
      } as unknown as OpenClawAdapter
    }
  );

  assert.equal(result.outcome, "succeeded");
  assert.equal(result.reconciled, true);
  assert.equal(dispatchCalls, 1);
  assert.equal(placementReads, 2);
});

test("profile dispatch reconciliation uses exact native profile identity", async () => {
  let placementReads = 0;
  const result = await dispatchSession(
    { sessionKey: "agent:one:session", target: { kind: "profile", profileId: "profile-1" } },
    {
      adapter: {
        getNativeSession: async () => {
          placementReads += 1;
          return placementReads === 1 ? sessionPlacement("local", 1, "gateway") : sessionProfilePlacement("active", 2, "profile-1");
        },
        listNativeExecutionEnvironments: async () => ({ environments: [], profiles: [{ id: "profile-1", providerId: "provider-1" }] }),
        dispatchNativeSession: async () => {
          throw new NativeGatewayRequestError("response lost after dispatch", "sessions.dispatch", true, { kind: "timeout" });
        }
      } as unknown as OpenClawAdapter
    }
  );

  assert.equal(result.outcome, "succeeded");
  assert.equal(result.reconciled, true);
  assert.equal(placementReads, 2);
});

test("definite dispatch rejection does not become success from a matching pre-existing state", async () => {
  let placementReads = 0;
  const result = await dispatchSession(
    { sessionKey: "agent:one:session", target: { kind: "automatic" } },
    {
      adapter: {
        getNativeSession: async () => {
          placementReads += 1;
          return sessionPlacement("active", 2, "node:mac-1");
        },
        dispatchNativeSession: async () => {
          throw new NativeGatewayError("permission denied", { kind: "scope-limited" });
        }
      } as unknown as OpenClawAdapter
    }
  );

  assert.equal(result.outcome, "failed");
  assert.equal(result.reconciled, false);
  assert.equal(placementReads, 1);
});

test("move reconciles a transition to a validated session-host node without retry", async () => {
  let placementReads = 0;
  let moveCalls = 0;
  const result = await moveSession(
    { sessionKey: "agent:one:session", target: { kind: "device", deviceId: "mac-1" } },
    {
      adapter: {
        getNativeSession: async () => {
          placementReads += 1;
          return placementReads === 1 ? sessionPlacement("active", 1, "gateway") : sessionPlacement("active", 2, "node:mac-1");
        },
        listNativeExecutionEnvironments: async () => ({ environments: [environment()] }),
        moveNativeSession: async () => {
          moveCalls += 1;
          throw new NativeGatewayRequestError("response lost after move", "sessions.move", true, { kind: "timeout" });
        }
      } as unknown as OpenClawAdapter
    }
  );

  assert.equal(result.outcome, "succeeded");
  assert.equal(result.reconciled, true);
  assert.equal(moveCalls, 1);
  assert.equal(placementReads, 2);
});

test("ambiguous reclaim with an unchanged pre-state remains unknown", async () => {
  let reclaimCalls = 0;
  const result = await reclaimSession(
    { sessionKey: "agent:one:session" },
    {
      adapter: {
        getNativeSession: async () => sessionPlacement("reclaimed", 3, "gateway"),
        reclaimNativeSession: async () => {
          reclaimCalls += 1;
          throw new NativeGatewayRequestError("response lost", "sessions.reclaim", true, { kind: "timeout" });
        }
      } as unknown as OpenClawAdapter
    }
  );

  assert.equal(result.outcome, "unknown");
  assert.equal(result.retryable, false);
  assert.equal(reclaimCalls, 1);
});

test("Phase 8 keeps topology and placement native-only and avoids forbidden infrastructure", async () => {
  const [service, route, inspector, tasks, page] = await Promise.all([
    readFile("lib/openclaw/application/execution-topology-service.ts", "utf8"),
    readFile("app/api/sessions/placement/route.ts", "utf8"),
    readFile("components/operations/tasks/native-execution-inspector.tsx", "utf8"),
    readFile("components/operations/tasks/tasks-page-content.tsx", "utf8"),
    readFile("components/operations/operations-page.tsx", "utf8")
  ]);
  assert.match(service, /listNativeExecutionEnvironments/);
  assert.match(service, /dispatchNativeSession/);
  assert.match(service, /moveNativeSession/);
  assert.match(service, /reclaimNativeSession/);
  assert.doesNotMatch(service, /setInterval|setTimeout/);
  assert.doesNotMatch(service, /least|round.?robin|load.?balanc|scheduler/i);
  assert.doesNotMatch(route, /node\.invoke|provider|ssh|cloud.?sdk/i);
  assert.doesNotMatch(inspector, /node\.invoke|WebSocket|EventSource/);
  assert.match(inspector, /attentionRefreshGeneration/);
  assert.match(inspector, /\[sessionKey, refreshNonce, attentionRefreshGeneration\]/);
  assert.match(tasks, /attentionRefreshGeneration/);
  assert.match(page, /attentionRefreshGeneration=\{context\.attentionRefreshGeneration\}/);
});
