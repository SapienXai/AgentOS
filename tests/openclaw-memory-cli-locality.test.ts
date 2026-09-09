import assert from "node:assert/strict";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
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
import type { OpenClawCliRuntimeEnvironment } from "@/lib/openclaw/cli";
import type {
  OpenClawGatewayClient,
  OpenClawRuntimeIdentity
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

test("a local Gateway with external supervisor ownership is not trusted, while Railway supervisor ownership is", async () => {
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

    const railway = await createRuntimeIdentity(root, "railway");
    const railwayDecision = await resolveMemoryCliFallbackLocality({
      gatewayRuntime: {
        ...railway,
        ownership: "external-supervisor",
        deploymentMode: "railway",
        managementStrategy: "external-supervisor",
        supervisorEndpoint: "/tmp/agentos-memory-locality-supervisor.sock"
      },
      cliRuntime: {
        ...railway,
        ownership: "external-supervisor",
        deploymentMode: "railway",
        managementStrategy: "external-supervisor",
        supervisorEndpoint: "/tmp/agentos-memory-locality-supervisor.sock"
      }
    });
    assert.equal(railwayDecision.status, "proven-same-runtime");
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

test("same-runtime proof pins the CLI to exact canonical state and config paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agentos-memory-locality-"));
  try {
    const identity = {
      ...(await createRuntimeIdentity(root, "runtime")),
      profile: "staging"
    } satisfies OpenClawRuntimeIdentity;
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
        cliRuntime: identity
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
