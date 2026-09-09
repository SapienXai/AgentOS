import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmod, mkdir, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
  GatewayBackedOpenClawAdapter
} from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  CliOpenClawGatewayClient,
  OpenClawMemoryCliFallbackUnavailableError
} from "@/lib/openclaw/client/cli-gateway-client";
import {
  classifyGatewayUrl,
  resolveMemoryCliFallbackLocality
} from "@/lib/openclaw/client/memory-cli-locality";
import { resolveAuthoritativeRuntimeOwnershipProof } from "@/lib/openclaw/lifecycle/runtime-provenance";
import type { OpenClawCliRuntimeEnvironment } from "@/lib/openclaw/cli";
import type {
  OpenClawGatewayClient,
  OpenClawRuntimeIdentity,
  OpenClawRuntimeOwnershipProof
} from "@/lib/openclaw/client/types";

test("remote Gateway blocks memory status and rebuild without invoking the CLI", async () => {
  const calls: string[] = [];
  const remote = runtimeIdentity({
    gatewayUrl: "wss://gateway.example.com",
    stateDir: "/tmp/agentos-remote-state",
    configPath: "/tmp/agentos-remote-config.json"
  });
  const fallback = createFallback({ gatewayRuntime: remote, cliRuntime: null, calls });
  const adapter = new GatewayBackedOpenClawAdapter(
    () => ({ getRuntimeIdentity: () => remote } as OpenClawGatewayClient),
    fallback
  );

  const status = await adapter.getMemoryIndexStatus({ agentId: "agent-a" });
  assert.equal(status.availability, "unavailable");
  assert.equal(status.locality, "unavailable-remote");
  assert.equal(status.dirty, null);
  await assert.rejects(
    () => adapter.rebuildMemoryIndex!({ agentId: "agent-a" }),
    (error: unknown) => error instanceof OpenClawMemoryCliFallbackUnavailableError && error.locality.status === "remote"
  );
  assert.deepEqual(calls, []);
});

test("a loopback Gateway with unknown runtime identity remains unavailable", async () => {
  const calls: string[] = [];
  const fallback = createFallback({ gatewayRuntime: null, cliRuntime: null, calls });
  const adapter = new GatewayBackedOpenClawAdapter(
    () => ({ getRuntimeIdentity: () => null } as OpenClawGatewayClient),
    fallback
  );

  const status = await adapter.getMemoryIndexStatus({ agentId: "agent-a" });
  assert.equal(status.availability, "unavailable");
  assert.equal(status.locality, "unavailable-unproven");
  await assert.rejects(() => adapter.rebuildMemoryIndex!({ agentId: "agent-a" }));
  assert.deepEqual(calls, []);
});

test("different local state or config identities block both status and rebuild", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentos-memory-locality-"));
  try {
    const gateway = await createRuntimeIdentity(root, "gateway");
    const cli = await createRuntimeIdentity(root, "cli");
    const calls: string[] = [];
    const fallback = createFallback({ gatewayRuntime: gateway, cliRuntime: cli, calls });
    const adapter = new GatewayBackedOpenClawAdapter(
      () => ({ getRuntimeIdentity: () => gateway } as OpenClawGatewayClient),
      fallback
    );

    const status = await adapter.getMemoryIndexStatus({ agentId: "agent-a" });
    assert.equal(status.availability, "unavailable");
    assert.equal(status.locality, "unavailable-unproven");
    await assert.rejects(() => adapter.rebuildMemoryIndex!({ agentId: "agent-a" }));
    assert.deepEqual(calls, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local ownership labels and matching config do not self-attest a Railway supervisor", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentos-memory-locality-"));
  try {
    const localExternal = await createRuntimeIdentity(root, "local-external");
    const localDecision = await resolveMemoryCliFallbackLocality({
      gatewayRuntime: {
        ...localExternal,
        ownership: "external-supervisor",
        managementStrategy: "external-supervisor"
      },
      cliRuntime: {
        ...localExternal,
        ownership: "external-supervisor",
        managementStrategy: "external-supervisor"
      }
    });
    assert.equal(localDecision.status, "unproven");

    const railway = {
      ...(await createRuntimeIdentity(root, "railway")),
      ownership: "external-supervisor" as const,
      deploymentMode: "railway" as const,
      managementStrategy: "external-supervisor" as const,
      supervisorEndpoint: "/tmp/agentos-memory-locality-supervisor.sock"
    };
    const railwayDecision = await resolveMemoryCliFallbackLocality({
      gatewayRuntime: railway,
      cliRuntime: railway
    });
    assert.equal(railwayDecision.status, "unproven");

    const provenRailwayDecision = await resolveMemoryCliFallbackLocality({
      gatewayRuntime: railway,
      cliRuntime: railway,
      ownershipProof: ownershipProof(railway, "external-supervisor")
    });
    assert.equal(provenRailwayDecision.status, "proven-same-runtime");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("matching state roots do not override a different config path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentos-memory-locality-"));
  try {
    const gateway = await createRuntimeIdentity(root, "config-a");
    const differentConfigPath = path.join(root, "config-b", "openclaw.json");
    await mkdir(path.dirname(differentConfigPath), { recursive: true });
    await writeFile(differentConfigPath, "{}\n", "utf8");
    const cli = { ...gateway, configPath: differentConfigPath };

    const decision = await resolveMemoryCliFallbackLocality({
      gatewayRuntime: gateway,
      cliRuntime: cli
    });
    assert.equal(decision.status, "unproven");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("authoritative ownership still cannot bridge a Gateway-to-CLI runtime path mismatch", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentos-memory-locality-"));
  try {
    const gateway = {
      ...(await createRuntimeIdentity(root, "owned-a")),
      managementStrategy: "child" as const
    };
    const different = {
      ...(await createRuntimeIdentity(root, "owned-b")),
      managementStrategy: "child" as const
    };
    const decision = await resolveMemoryCliFallbackLocality({
      gatewayRuntime: gateway,
      cliRuntime: gateway,
      ownershipProof: ownershipProof(different, "agentos-child")
    });
    assert.equal(decision.status, "unproven");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("same-runtime proof pins the CLI to exact canonical state and config paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentos-memory-locality-"));
  try {
    const identity = {
      ...(await createRuntimeIdentity(root, "runtime")),
      profile: "staging",
      managementStrategy: "child"
    } satisfies OpenClawRuntimeIdentity;
    const proof = ownershipProof(identity, "agentos-child");
    const calls: Array<{ kind: string; args: string[]; environment: Record<string, string | null> }> = [];
    let statusPayload: unknown = [{
      agentId: "agent-a",
      status: {
        backend: "builtin",
        files: 1,
        chunks: 2,
        dirty: false,
        sourceCounts: [{ source: "memory", files: 1 }],
        custom: { indexIdentity: { status: "valid", owner: "openclaw" } }
      }
    }];
    const fallback = new CliOpenClawGatewayClient({
      resolveMemoryCliFallbackLocality: () => resolveMemoryCliFallbackLocality({
        gatewayRuntime: identity,
        cliRuntime: identity,
        ownershipProof: proof
      }),
      runMemoryJson: async <TPayload>(args: string[], environment: OpenClawCliRuntimeEnvironment) => {
        calls.push({ kind: "status", args, environment });
        return statusPayload as TPayload;
      },
      runMemory: async (args, environment) => {
        calls.push({ kind: "rebuild", args, environment });
        return { stdout: "", stderr: "" };
      }
    });
    const adapter = new GatewayBackedOpenClawAdapter(
      () => ({ getRuntimeIdentity: () => identity } as OpenClawGatewayClient),
      fallback
    );

    const status = await adapter.getMemoryIndexStatus({ agentId: "agent-a" });
    assert.equal(status.availability, "available");
    assert.equal(status.locality, "available-local-same-runtime");
    assert.deepEqual(calls[0]?.args, ["memory", "status", "--json", "--agent", "agent-a"]);
    assert.deepEqual(calls[0]?.environment, {
      stateDir: await realpath(identity.stateDir),
      configPath: await realpath(identity.configPath),
      profile: "staging"
    });

    statusPayload = [{
      agentId: "agent-a",
      status: {
        backend: "builtin",
        files: 1,
        chunks: 2,
        dirty: true,
        custom: { indexIdentity: { status: "mismatched" } }
      }
    }];
    await adapter.rebuildMemoryIndex!({ agentId: "agent-a" });
    assert.equal(calls[1]?.kind, "rebuild");
    assert.deepEqual(calls[1]?.args, ["memory", "index", "--force", "--agent", "agent-a"]);
    assert.deepEqual(calls[1]?.environment, {
      stateDir: await realpath(identity.stateDir),
      configPath: await realpath(identity.configPath),
      profile: "staging"
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("identical configured runtime fields without ownership proof remain unavailable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentos-memory-locality-"));
  try {
    const identity = await createRuntimeIdentity(root, "configured-only");
    const calls: string[] = [];
    const fallback = createFallback({ gatewayRuntime: identity, cliRuntime: identity, calls });
    const adapter = new GatewayBackedOpenClawAdapter(
      () => ({ getRuntimeIdentity: () => identity } as OpenClawGatewayClient),
      fallback
    );

    const status = await adapter.getMemoryIndexStatus({ agentId: "agent-a" });
    assert.equal(status.availability, "unavailable");
    assert.equal(status.locality, "unavailable-unproven");
    await assert.rejects(
      () => adapter.rebuildMemoryIndex!({ agentId: "agent-a" }),
      (error: unknown) => error instanceof OpenClawMemoryCliFallbackUnavailableError && error.locality.status === "unproven"
    );
    assert.deepEqual(calls, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("managed child ownership proof is live and is invalidated on replacement or exit", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentos-memory-locality-"));
  try {
    const identity = {
      ...(await createRuntimeIdentity(root, "managed-child")),
      managementStrategy: "child"
    } satisfies OpenClawRuntimeIdentity;
    const first = createLifecycleChild(41001);
    const second = createLifecycleChild(41002);
    const descriptor = {
      ...identity,
      gatewayPort: 18789,
      binaryPath: "/tmp/openclaw.mjs",
      installLocation: null,
      pid: null,
      generation: null,
      supervisorEndpoint: null,
      supervisorProtocolVersion: null,
      version: "2026.9.3",
      sourceCommit: null,
      state: "ready" as const,
      health: "live" as const,
      ready: true,
      authenticated: true,
      protocolVersion: 4,
      checkedAt: new Date().toISOString(),
      reason: null
    };
    const { registerAgentOsManagedGatewayRuntime, clearAgentOsManagedGatewayRuntime } = await import("@/lib/openclaw/lifecycle/runtime-provenance");

    registerAgentOsManagedGatewayRuntime(descriptor, first);
    const firstProof = await resolveAuthoritativeRuntimeOwnershipProof(identity);
    assert.equal(firstProof?.generation, 1);

    registerAgentOsManagedGatewayRuntime(descriptor, second);
    const replacementProof = await resolveAuthoritativeRuntimeOwnershipProof(identity);
    assert.equal(replacementProof?.pid, 41002);
    clearAgentOsManagedGatewayRuntime(descriptor, first);
    assert.equal((await resolveAuthoritativeRuntimeOwnershipProof(identity))?.pid, 41002);

    (second.process as unknown as { exitCode: number | null }).exitCode = 0;
    second.process.emit("exit", 0, null);
    assert.equal(await resolveAuthoritativeRuntimeOwnershipProof(identity), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Railway supervisor proof must report the exact live runtime identity", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentos-memory-locality-"));
  const socketPath = path.join(root, "supervisor.sock");
  const server = createServer((socket) => {
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd < 0) return;
      const request = JSON.parse(buffer.slice(0, lineEnd)) as { requestId: string };
      socket.end(`${JSON.stringify({
        protocolVersion: 1,
        requestId: request.requestId,
        ok: true,
        command: "status",
        owner: "external-supervisor",
        state: "ready",
        pid: 42001,
        generation: 7,
        gatewayUrl: identity.gatewayUrl,
        gatewayPort: 18789,
        stateDir: identity.stateDir,
        configPath: identity.configPath,
        profile: identity.profile,
        ready: true,
        authenticated: true,
        health: "live",
        protocolVersionGateway: 4
      })}\n`);
    });
  });
  const identity = {
    ...(await createRuntimeIdentity(root, "railway-supervisor")),
    ownership: "external-supervisor",
    deploymentMode: "railway",
    managementStrategy: "external-supervisor",
    supervisorEndpoint: socketPath
  } satisfies OpenClawRuntimeIdentity;

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => resolve());
    });
    await chmod(socketPath, 0o600);
    const proof = await resolveAuthoritativeRuntimeOwnershipProof(identity);
    assert.equal(proof?.source, "external-supervisor");
    assert.equal(proof?.generation, 7);
    assert.equal(proof?.configPath, identity.configPath);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await unlink(socketPath).catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("native Gateway index capabilities take precedence over the CLI fallback", async () => {
  const calls: string[] = [];
  const remote = runtimeIdentity({ gatewayUrl: "wss://gateway.example.com" });
  const fallback = createFallback({ gatewayRuntime: remote, cliRuntime: null, calls });
  const adapter = new GatewayBackedOpenClawAdapter(
    () => ({
      getRuntimeIdentity: () => remote,
      getNativeMemoryIndexStatus: async () => ({
        agentId: "agent-a",
        backend: "builtin",
        files: 1,
        chunks: 1,
        dirty: false,
        lastSyncError: null,
        sourceCounts: { memory: 1 },
        indexIdentity: { status: "valid", code: null, owner: "openclaw", reason: null },
        appliedVia: null
      }),
      rebuildNativeMemoryIndex: async () => ({
        agentId: "agent-a",
        appliedVia: "native-gateway",
        command: "memory index --force"
      })
    } as unknown as OpenClawGatewayClient),
    fallback
  );

  assert.equal((await adapter.getMemoryIndexStatus({ agentId: "agent-a" })).dirty, false);
  assert.equal((await adapter.rebuildMemoryIndex!({ agentId: "agent-a" })).agentId, "agent-a");
  assert.deepEqual(calls, []);
});

test("native memory search remains available when local index maintenance is unavailable", async () => {
  const calls: string[] = [];
  const remote = runtimeIdentity({ gatewayUrl: "wss://gateway.example.com" });
  const fallback = createFallback({ gatewayRuntime: remote, cliRuntime: null, calls });
  const adapter = new GatewayBackedOpenClawAdapter(
    () => ({
      getRuntimeIdentity: () => remote,
      searchMemory: async (input) => ({ results: [{ path: "knowledge/sources/one.md", snippet: input.query }] })
    } as OpenClawGatewayClient),
    fallback
  );

  const result = await adapter.searchMemory({ agentId: "agent-a", query: "native" });
  assert.deepEqual(result, { results: [{ path: "knowledge/sources/one.md", snippet: "native" }] });
  assert.deepEqual(calls, []);
});

test("Gateway URL classification recognizes loopback aliases without treating them as proof", () => {
  assert.equal(classifyGatewayUrl("ws://127.0.0.1:18789"), "loopback");
  assert.equal(classifyGatewayUrl("ws://localhost:18789"), "loopback");
  assert.equal(classifyGatewayUrl("ws://[::1]:18789"), "loopback");
  assert.equal(classifyGatewayUrl("ws://[::ffff:127.0.0.1]:18789"), "loopback");
  assert.equal(classifyGatewayUrl("wss://gateway.example.com"), "remote");
});

async function createRuntimeIdentity(root: string, name: string): Promise<OpenClawRuntimeIdentity> {
  const stateDir = path.join(root, name, "state");
  const configPath = path.join(root, name, "config", "openclaw.json");
  await mkdir(stateDir, { recursive: true });
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, "{}\n", "utf8");
  return runtimeIdentity({ stateDir, configPath });
}

function runtimeIdentity(overrides: Partial<OpenClawRuntimeIdentity> = {}): OpenClawRuntimeIdentity {
  return {
    gatewayUrl: "ws://127.0.0.1:18789",
    stateDir: "/tmp/agentos-memory-state",
    configPath: "/tmp/agentos-memory-state/openclaw.json",
    profile: null,
    ownership: "agentos-managed",
    deploymentMode: "local",
    managementStrategy: "openclaw-service",
    supervisorEndpoint: null,
    ...overrides
  };
}

function createFallback(input: {
  gatewayRuntime: OpenClawRuntimeIdentity | null;
  cliRuntime: OpenClawRuntimeIdentity | null;
  calls: string[];
}) {
  return new CliOpenClawGatewayClient({
    resolveMemoryCliFallbackLocality: () => resolveMemoryCliFallbackLocality(input),
    runMemoryJson: async <TPayload>() => {
      input.calls.push("status");
      return [] as TPayload;
    },
    runMemory: async () => {
      input.calls.push("rebuild");
      return { stdout: "", stderr: "" };
    }
  });
}

function ownershipProof(
  identity: OpenClawRuntimeIdentity,
  source: OpenClawRuntimeOwnershipProof["source"]
): OpenClawRuntimeOwnershipProof {
  return {
    source,
    gatewayUrl: identity.gatewayUrl,
    stateDir: identity.stateDir,
    configPath: identity.configPath,
    profile: identity.profile,
    generation: 1,
    pid: 40_001,
    supervisorEndpoint: source === "external-supervisor" ? identity.supervisorEndpoint : null
  };
}

function createLifecycleChild(pid: number) {
  const process = new EventEmitter() as EventEmitter & {
    exitCode: number | null;
    pid: number;
  };
  process.exitCode = null;
  process.pid = pid;
  return {
    process: process as unknown as import("node:child_process").ChildProcess,
    pid,
    generation: pid === 41_001 ? 1 : 2
  };
}
