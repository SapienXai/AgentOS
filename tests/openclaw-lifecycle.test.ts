import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  discoverGatewayRuntime,
  resolveManagementStrategy,
  resolveOwnership,
  resolveSafeRuntimePath
} from "@/lib/openclaw/lifecycle/runtime-discovery";
import { OpenClawLifecycleService } from "@/lib/openclaw/lifecycle/service";
import type { GatewayLifecycleChild } from "@/lib/openclaw/lifecycle/types";
import type { SupervisorResponse } from "@/lib/openclaw/lifecycle/supervisor-ipc";

test("canonical runtime discovery fails closed for unknown ownership and unsafe paths", async () => {
  assert.equal(resolveOwnership({ AGENTOS_DEPLOYMENT_PLATFORM: "unknown-host" }), "unknown");
  assert.equal(resolveOwnership({ OPENCLAW_SUPERVISOR_MODE: "external" }), "external-supervisor");
  assert.equal(resolveManagementStrategy({}, "agentos-managed"), "openclaw-service");
  assert.equal(resolveManagementStrategy({ OPENCLAW_GATEWAY_PROCESS_MODE: "child" }, "agentos-managed"), "child");
  assert.throws(() => resolveSafeRuntimePath("/", "runtime"), /Unsafe runtime path/);

  const descriptor = await discoverGatewayRuntime({
    env: {
      AGENTOS_DEPLOYMENT_PLATFORM: "unknown-host",
      OPENCLAW_STATE_DIR: "/tmp/agentos-lifecycle-state",
      OPENCLAW_CONFIG_PATH: "/tmp/agentos-lifecycle-state/openclaw.json"
    },
    resolveBinary: async () => "/tmp/agentos-openclaw"
  });
  assert.equal(descriptor.ownership, "unknown");
  assert.equal(descriptor.state, "unknown");
});

test("managed lifecycle serializes cross-action mutations and never double-spawns", async () => {
  const events: string[] = [];
  let spawnCount = 0;
  let readinessCalls = 0;
  const readiness = async () => ({
    ready: readinessCalls++ > 0,
    authenticated: true,
    health: readinessCalls > 1 ? "live" as const : "not-live" as const,
    protocolVersion: 3,
    version: "2026.9.1",
    sourceCommit: "ad6fe23aecb9b833d68139b0ddc9f239b894d2f1",
    checkedAt: new Date().toISOString(),
    reason: null
  });
  const createChild = () => {
    const process = new EventEmitter() as EventEmitter & { exitCode: number | null; kill: () => void; pid: number };
    process.exitCode = null;
    process.pid = 40_000 + spawnCount;
    process.kill = () => {
      process.exitCode = 0;
      process.emit("exit", 0, null);
    };
    return process;
  };
  const service = new OpenClawLifecycleService({
    env: {
      OPENCLAW_GATEWAY_PROCESS_MODE: "child",
      OPENCLAW_STATE_DIR: "/tmp/agentos-managed-state",
      OPENCLAW_CONFIG_PATH: "/tmp/agentos-managed-state/openclaw.json"
    },
    resolveBinary: async () => "/tmp/agentos-openclaw",
    readinessProbe: readiness,
    spawnGateway: async () => {
      spawnCount += 1;
      events.push("spawn");
      const process = createChild();
      return { process: process as unknown as GatewayLifecycleChild["process"], pid: process.pid, generation: spawnCount };
    },
    stopGateway: async (child) => {
      events.push("stop");
      child.process.kill();
    }
  });

  const [started, stopped] = await Promise.all([service.start(), service.stop()]);
  assert.equal(started.descriptor.state, "ready");
  assert.equal(stopped.descriptor.state, "stopped");
  assert.equal(spawnCount, 1);
  assert.deepEqual(events, ["spawn", "stop"]);

  const duplicateStart = await Promise.all([service.start(), service.start()]);
  assert.equal(duplicateStart[0].descriptor.state, "ready");
  assert.equal(duplicateStart[1].changed, false);
  assert.equal(spawnCount, 1);
});

test("external lifecycle delegates every mutation to the supervisor and preserves ownership offline", async () => {
  const commands: string[] = [];
  const response = (command: "status" | "start" | "stop" | "restart", state: "ready" | "stopped"): SupervisorResponse => ({
    protocolVersion: 1,
    requestId: `test-${commands.length}`,
    ok: true,
    command,
    owner: "external-supervisor",
    state,
    pid: state === "ready" ? 9876 : null,
    generation: state === "ready" ? 2 : null,
    gatewayPort: 28789,
    gatewayUrl: "ws://127.0.0.1:28789",
    ready: state === "ready",
    authenticated: false,
    health: state === "ready" ? "live" : "not-live",
    protocolVersionGateway: null,
    message: "test supervisor"
  });
  const service = new OpenClawLifecycleService({
    env: {
      OPENCLAW_SUPERVISOR_MODE: "external",
      AGENTOS_SUPERVISOR_SOCKET_PATH: "/tmp/agentos-test-supervisor.sock",
      OPENCLAW_STATE_DIR: "/tmp/agentos-external-state",
      OPENCLAW_CONFIG_PATH: "/tmp/agentos-external-state/openclaw.json"
    },
    externalSupervisor: {
      request: async (command) => {
        commands.push(command);
        return response(command, command === "stop" ? "stopped" : "ready");
      }
    },
    readinessProbe: async () => ({
      ready: true,
      authenticated: true,
      health: "live",
      protocolVersion: 3,
      version: "2026.9.1",
      sourceCommit: null,
      checkedAt: new Date().toISOString(),
      reason: null
    })
  });

  const status = await service.getStatus();
  assert.equal(status.ownership, "external-supervisor");
  assert.equal(status.state, "ready");
  await service.restart();
  await service.stop();
  assert.deepEqual(commands, ["status", "restart", "stop"]);

  const offline = new OpenClawLifecycleService({
    env: {
      OPENCLAW_SUPERVISOR_MODE: "external",
      AGENTOS_SUPERVISOR_SOCKET_PATH: "/tmp/agentos-missing-supervisor.sock"
    }
  });
  const offlineStatus = await offline.getStatus();
  assert.equal(offlineStatus.ownership, "external-supervisor");
  assert.equal(offlineStatus.state, "degraded");
  await assert.rejects(offline.restart(), /supervisor endpoint|unavailable/i);
});

test("lifecycle recovery blocks a bounded crash loop", async () => {
  let generation = 0;
  const service = new OpenClawLifecycleService({
    env: {
      OPENCLAW_SUPERVISOR_MODE: "external",
      AGENTOS_SUPERVISOR_SOCKET_PATH: "/tmp/agentos-test-crash-loop.sock"
    },
    externalSupervisor: {
      request: async (command) => ({
        protocolVersion: 1,
        requestId: `crash-loop-${generation}`,
        ok: true,
        command,
        owner: "external-supervisor",
        state: "ready",
        pid: 50_000 + generation,
        generation: ++generation,
        gatewayUrl: "ws://127.0.0.1:18789",
        gatewayPort: 18_789,
        ready: true,
        authenticated: true,
        health: "live",
        protocolVersionGateway: 4,
        version: "2026.9.1",
        sourceCommit: "ad6fe23aecb9b833d68139b0ddc9f239b894d2f1",
        message: "Crash-loop test"
      })
    },
    readinessProbe: async () => ({
      ready: true,
      authenticated: true,
      health: "live",
      protocolVersion: 4,
      version: "2026.9.1",
      sourceCommit: "ad6fe23aecb9b833d68139b0ddc9f239b894d2f1",
      checkedAt: new Date().toISOString(),
      reason: null
    }),
    crashRecoveryLimit: 1
  });

  await service.recover();
  await assert.rejects(service.recover(), /blocked after bounded crash-loop/i);
});
