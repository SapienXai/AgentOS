import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { createWorkspaceKnowledgeSource } from "@/lib/agentos/domains/workspace-knowledge";
import { ingestKnowledgeSources } from "@/lib/agentos/domains/workspace-knowledge-ingestion";
import {
  ensureWorkspaceNativeKnowledge,
  getWorkspaceNativeKnowledgeStatus,
  planWorkspaceKnowledgeBinding,
  type WorkspaceNativeKnowledgeBindingInput
} from "@/lib/agentos/application/workspace-native-knowledge-service";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type {
  OpenClawMemoryIndexStatusPayload,
  OpenClawMemoryStatusPayload
} from "@/lib/openclaw/client/types";
import { searchWorkerMemory } from "@/lib/openclaw/application/native-memory-service";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function adapterFixture(initialConfig: Record<string, unknown>, search?: OpenClawAdapter["searchMemory"]) {
  const config = structuredClone(initialConfig) as Record<string, unknown>;
  const mutations: Array<{ path: string; value: unknown }> = [];
  const adapter: OpenClawAdapter = {
    async getConfigSnapshot() {
      return { config };
    },
    async setConfig(configPath: string, value: unknown) {
      mutations.push({ path: configPath, value: structuredClone(value) });
      const match = configPath.match(/^agents\.entries\["((?:\\.|[^"\\])*)"\]\.memory\.search\.extraPaths$/);
      assert.ok(match, `unexpected config path: ${configPath}`);
      const agentId = JSON.parse(`"${match[1]}"`) as string;
      const agents = config.agents as Record<string, unknown>;
      const entries = agents.entries as Record<string, unknown>;
      const entry = entries[agentId] as Record<string, unknown>;
      const memory = (entry.memory && typeof entry.memory === "object" ? entry.memory : {}) as Record<string, unknown>;
      const searchConfig = (memory.search && typeof memory.search === "object" ? memory.search : {}) as Record<string, unknown>;
      searchConfig.extraPaths = structuredClone(value);
      memory.search = searchConfig;
      entry.memory = memory;
      return {
        stdout: JSON.stringify({
          ok: true,
          configMutation: {
            appliedVia: "config.patch",
            restartRequired: true,
            changedPaths: [configPath]
          }
        }),
        stderr: "",
        metadata: {
          openClawConfig: {
            appliedVia: "config.patch",
            restartRequired: true,
            changedPaths: [configPath]
          }
        }
      };
    },
    ...(search ? { searchMemory: search } : {})
  } as unknown as OpenClawAdapter;
  return { adapter, config, mutations };
}

async function makeWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-native-knowledge-"));
  tempRoots.push(root);
  return root;
}

async function ingestPrompt(workspacePath: string, text: string) {
  return ingestKnowledgeSources({
    sources: [createWorkspaceKnowledgeSource({
      id: "brief",
      kind: "prompt",
      label: "Brief",
      summary: text,
      locator: { kind: "prompt", text },
      createdAt: "2026-09-09T00:00:00.000Z"
    })],
    corpusRoot: path.join(workspacePath, "knowledge"),
    stateRoot: path.join(workspacePath, ".openclaw", "knowledge")
  });
}

function entries(...agentIds: string[]) {
  return Object.fromEntries(agentIds.map((agentId) => [agentId, {}]));
}

test("native binding preserves per-agent and global memory settings, is idempotent, and removes only its canonical entry", async () => {
  const workspacePath = await makeWorkspace();
  await ingestPrompt(workspacePath, "ALPHA_ONLY_FACT");
  const existingUserPath = { path: "/srv/operator-notes", pattern: "runbooks/**/*.md" };
  const fixture = adapterFixture({
    memory: {
      search: {
        provider: "ollama",
        model: "nomic-embed-text",
        extraPaths: [{ path: "/srv/global-notes" }]
      }
    },
    agents: {
      entries: {
        "agent-a": {
          memory: {
            search: {
              provider: "openai",
              model: "text-embedding-3-small",
              query: { maxResults: 4 },
              extraPaths: [existingUserPath]
            }
          }
        }
      }
    }
  });
  const input: WorkspaceNativeKnowledgeBindingInput = {
    workspacePath,
    agentIds: ["agent-a"],
    adapter: fixture.adapter
  };

  const applied = await ensureWorkspaceNativeKnowledge(input);
  assert.equal(applied.status, "applied");
  assert.equal(applied.restartRequired, true);
  assert.equal(fixture.mutations.length, 1);
  const agentSearch = ((fixture.config.agents as Record<string, unknown>).entries as Record<string, unknown>)["agent-a"] as Record<string, unknown>;
  const searchConfig = ((agentSearch.memory as Record<string, unknown>).search as Record<string, unknown>);
  assert.deepEqual(searchConfig.provider, "openai");
  assert.deepEqual(searchConfig.model, "text-embedding-3-small");
  assert.deepEqual(searchConfig.query, { maxResults: 4 });
  assert.deepEqual(searchConfig.extraPaths, [existingUserPath, { path: "knowledge/sources" }]);
  assert.deepEqual((fixture.config.memory as Record<string, unknown>).search, {
    provider: "ollama",
    model: "nomic-embed-text",
    extraPaths: [{ path: "/srv/global-notes" }]
  });

  const unchanged = await ensureWorkspaceNativeKnowledge(input);
  assert.equal(unchanged.status, "unchanged");
  assert.equal(fixture.mutations.length, 1);

  await rm(path.join(workspacePath, "knowledge"), { recursive: true, force: true });
  await rm(path.join(workspacePath, ".openclaw", "knowledge"), { recursive: true, force: true });
  const removed = await ensureWorkspaceNativeKnowledge(input);
  assert.equal(removed.status, "applied");
  assert.deepEqual(searchConfig.extraPaths, [existingUserPath]);
  assert.deepEqual((fixture.config.memory as Record<string, unknown>).search, {
    provider: "ollama",
    model: "nomic-embed-text",
    extraPaths: [{ path: "/srv/global-notes" }]
  });
});

test("two agents in one workspace receive the same native knowledge binding without a global path", async () => {
  const workspacePath = await makeWorkspace();
  await ingestPrompt(workspacePath, "SHARED_WORKSPACE_FACT");
  const fixture = adapterFixture({
    memory: { search: { provider: "none" } },
    agents: { entries: entries("agent-a", "agent-b") }
  });

  const result = await ensureWorkspaceNativeKnowledge({
    workspacePath,
    agentIds: ["agent-a", "agent-b"],
    adapter: fixture.adapter
  });

  assert.equal(result.status, "applied");
  assert.deepEqual(result.mutations.map((mutation) => mutation.agentId), ["agent-a", "agent-b"]);
  const configuredEntries = (fixture.config.agents as Record<string, unknown>).entries as Record<string, unknown>;
  for (const agentId of ["agent-a", "agent-b"]) {
    const entry = configuredEntries[agentId] as Record<string, unknown>;
    const search = (entry.memory as Record<string, unknown>).search as Record<string, unknown>;
    assert.deepEqual(search.extraPaths, [{ path: "knowledge/sources" }]);
  }
  assert.equal(((fixture.config.memory as Record<string, unknown>).search as Record<string, unknown>).extraPaths, undefined);
});

test("a later agent receives the existing workspace binding without rewriting the first agent", async () => {
  const workspacePath = await makeWorkspace();
  await ingestPrompt(workspacePath, "SHARED_WORKSPACE_FACT");
  const fixture = adapterFixture({
    agents: {
      entries: {
        "agent-a": { memory: { search: { extraPaths: [{ path: "knowledge/sources" }] } } },
        "agent-b": {}
      }
    }
  });

  const result = await ensureWorkspaceNativeKnowledge({
    workspacePath,
    agentIds: ["agent-a", "agent-b"],
    adapter: fixture.adapter
  });

  assert.equal(result.status, "applied");
  assert.deepEqual(result.mutations.map((mutation) => mutation.agentId), ["agent-b"]);
  const configuredEntries = (fixture.config.agents as Record<string, unknown>).entries as Record<string, unknown>;
  const firstSearch = (((configuredEntries["agent-a"] as Record<string, unknown>).memory as Record<string, unknown>).search as Record<string, unknown>);
  const secondSearch = (((configuredEntries["agent-b"] as Record<string, unknown>).memory as Record<string, unknown>).search as Record<string, unknown>);
  assert.deepEqual(firstSearch.extraPaths, [{ path: "knowledge/sources" }]);
  assert.deepEqual(secondSearch.extraPaths, [{ path: "knowledge/sources" }]);
});

test("concurrent binding readers observe the canonical corpus snapshot without mutating config", async () => {
  const workspacePath = await makeWorkspace();
  await ingestPrompt(workspacePath, "CONCURRENT_READER_FACT");
  const fixture = adapterFixture({
    agents: { entries: entries("agent-a") }
  });

  const plans = await Promise.all(Array.from({ length: 8 }, () => planWorkspaceKnowledgeBinding({
    workspacePath,
    agentIds: ["agent-a"],
    adapter: fixture.adapter
  })));

  assert.ok(plans.every((plan) => plan.activeCorpus));
  assert.ok(plans.every((plan) => plan.coverage.totalDocuments === 1));
  assert.equal(new Set(plans.map((plan) => plan.generationId)).size, 1);
  assert.ok(plans.every((plan) => plan.agents[0]?.action === "add"));
  assert.equal(fixture.mutations.length, 0);
});

test("native search contract keeps workspace facts isolated and preserves untrusted provenance", async () => {
  const workspaceA = await makeWorkspace();
  const workspaceB = await makeWorkspace();
  await ingestPrompt(workspaceA, "ALPHA_ONLY_FACT");
  await ingestPrompt(workspaceB, "BETA_ONLY_FACT");

  const fixtureA = adapterFixture({ memory: { search: { provider: "none" } }, agents: { entries: entries("agent-a") } }, async (input) => ({
    agentId: input.agentId ?? "agent-a",
    provider: "none",
    searchMode: "fts-only",
    results: [{
      path: path.join(workspaceA, "knowledge/sources/brief/prompt.md"),
      startLine: 1,
      endLine: 1,
      score: 1,
      snippet: "ALPHA_ONLY_FACT",
      source: "memory",
      provenance: { originClass: "untrusted", sessionKind: "unknown", observedAt: 1 }
    }]
  }));
  const fixtureB = adapterFixture({ memory: { search: { provider: "none" } }, agents: { entries: entries("agent-b") } }, async (input) => ({
    agentId: input.agentId ?? "agent-b",
    provider: "none",
    searchMode: "fts-only",
    results: [{
      path: path.join(workspaceB, "knowledge/sources/brief/prompt.md"),
      startLine: 1,
      endLine: 1,
      score: 1,
      snippet: "BETA_ONLY_FACT",
      source: "memory",
      provenance: { originClass: "untrusted", sessionKind: "unknown", observedAt: 1 }
    }]
  }));

  await ensureWorkspaceNativeKnowledge({ workspacePath: workspaceA, agentIds: ["agent-a"], adapter: fixtureA.adapter });
  await ensureWorkspaceNativeKnowledge({ workspacePath: workspaceB, agentIds: ["agent-b"], adapter: fixtureB.adapter });
  const alpha = await searchWorkerMemory({ agentId: "agent-a", query: "fact" }, { adapter: fixtureA.adapter });
  const beta = await searchWorkerMemory({ agentId: "agent-b", query: "fact" }, { adapter: fixtureB.adapter });

  assert.deepEqual(alpha.results.map((result) => result.snippet), ["ALPHA_ONLY_FACT"]);
  assert.deepEqual(beta.results.map((result) => result.snippet), ["BETA_ONLY_FACT"]);
  assert.ok(alpha.results.every((result) => result.provenance?.originClass === "untrusted"));
  assert.ok(beta.results.every((result) => result.provenance?.originClass === "untrusted"));
  assert.doesNotMatch(alpha.results.map((result) => result.snippet).join(" "), /BETA_ONLY_FACT/);
  assert.doesNotMatch(beta.results.map((result) => result.snippet).join(" "), /ALPHA_ONLY_FACT/);
});

test("coverage reports markdown and non-markdown final corpus documents without claiming native index counts", async () => {
  const workspacePath = await makeWorkspace();
  const sourcePath = path.join(workspacePath, "input");
  await mkdir(sourcePath, { recursive: true });
  await writeFile(path.join(sourcePath, "guide.md"), "Markdown guide");
  await writeFile(path.join(sourcePath, "data.json"), JSON.stringify({ fact: "JSON fact" }));
  await ingestKnowledgeSources({
    sources: [createWorkspaceKnowledgeSource({
      id: "folder",
      kind: "folder",
      label: "Folder",
      summary: "Folder",
      locator: { kind: "folder", path: sourcePath },
      createdAt: "2026-09-09T00:00:00.000Z"
    })],
    corpusRoot: path.join(workspacePath, "knowledge"),
    stateRoot: path.join(workspacePath, ".openclaw", "knowledge")
  });
  const fixture = adapterFixture({ memory: { search: { provider: "none" } }, agents: { entries: entries("agent-a") } });
  const status = await getWorkspaceNativeKnowledgeStatus({ workspacePath, agentIds: ["agent-a"], adapter: fixture.adapter });

  assert.equal(status.activeCorpus, true);
  assert.equal(status.coverage.totalDocuments, 2);
  assert.equal(status.coverage.markdownDocuments, 1);
  assert.equal(status.coverage.nonMarkdownDocuments, 1);
  assert.equal(status.coverage.markdownCoveragePercent, 50);
  assert.equal(status.index, null);
  assert.equal(status.indexActionRequired, "unknown");
  assert.match(status.warnings.join(" "), /OpenClaw owns native memory watching/);
});

test("ensure refreshes a dirty OpenClaw index through the explicit CLI fallback and skips clean indexes", async () => {
  const workspacePath = await makeWorkspace();
  await ingestPrompt(workspacePath, "INDEX_REFRESH_FACT");
  const fixture = adapterFixture({
    agents: {
      entries: {
        "agent-a": { memory: { search: { extraPaths: [{ path: "knowledge/sources" }] } } }
      }
    }
  });
  const dirty: OpenClawMemoryIndexStatusPayload = {
    agentId: "agent-a",
    backend: "builtin",
    files: 0,
    chunks: 0,
    dirty: true,
    lastSyncError: null,
    sourceCounts: { memory: 0 },
    indexIdentity: { status: "missing", code: "metadata_missing", owner: "openclaw", reason: "index metadata is missing" },
    appliedVia: "cli-fallback"
  };
  const clean: OpenClawMemoryIndexStatusPayload = {
    ...dirty,
    files: 1,
    chunks: 1,
    dirty: false,
    sourceCounts: { memory: 1 },
    indexIdentity: { status: "valid", code: null, owner: "openclaw", reason: null }
  };
  let statusReadCount = 0;
  let rebuildCount = 0;
  fixture.adapter.getMemoryIndexStatus = async () => {
    statusReadCount += 1;
    return statusReadCount === 1 ? dirty : clean;
  };
  fixture.adapter.rebuildMemoryIndex = async () => {
    rebuildCount += 1;
    return { agentId: "agent-a", appliedVia: "cli-fallback", command: "memory index --force" };
  };

  const refreshed = await ensureWorkspaceNativeKnowledge({
    workspacePath,
    agentIds: ["agent-a"],
    adapter: fixture.adapter
  });
  assert.equal(refreshed.indexRefresh[0]?.action, "reindexed");
  assert.equal(refreshed.indexRefresh[0]?.appliedVia, "cli-fallback");
  assert.equal(rebuildCount, 1);

  const unchanged = await ensureWorkspaceNativeKnowledge({
    workspacePath,
    agentIds: ["agent-a"],
    adapter: fixture.adapter
  });
  assert.equal(unchanged.indexRefresh[0]?.action, "not-required");
  assert.equal(rebuildCount, 1);
});

test("workspace status projects OpenClaw CLI index health without exposing native paths", async () => {
  const workspacePath = await makeWorkspace();
  await ingestPrompt(workspacePath, "INDEX_STATUS_FACT");
  const fixture = adapterFixture({
    agents: {
      entries: {
        "agent-a": { memory: { search: { extraPaths: [{ path: "knowledge/sources" }] } } }
      }
    }
  });
  const nativeStatus: OpenClawMemoryStatusPayload = {
    agentId: "agent-a",
    embedding: { ok: true, checked: true }
  };
  const indexStatus: OpenClawMemoryIndexStatusPayload = {
    agentId: "agent-a",
    backend: "builtin",
    files: 1,
    chunks: 2,
    dirty: false,
    lastSyncError: null,
    sourceCounts: { memory: 1 },
    indexIdentity: { status: "valid", code: null, owner: "openclaw", reason: null },
    appliedVia: "cli-fallback"
  };
  fixture.adapter.getNativeMemoryDoctorStatus = async () => nativeStatus;
  fixture.adapter.getMemoryIndexStatus = async () => indexStatus;

  const status = await getWorkspaceNativeKnowledgeStatus({
    workspacePath,
    agentIds: ["agent-a"],
    adapter: fixture.adapter
  });
  assert.equal(status.status, "configured");
  assert.deepEqual(status.index, {
    files: 1,
    chunks: 2,
    dirty: false,
    lastSyncError: null,
    sourceCounts: { memory: 1 },
    locality: null,
    localityReason: null
  });
  assert.equal(status.indexActionRequired, "not-required");
  assert.doesNotMatch(JSON.stringify(status), /dbPath|workspaceDir/);
});

test("malformed native config and missing native status remain explicit failure or unknown states", async () => {
  const workspacePath = await makeWorkspace();
  await ingestPrompt(workspacePath, "FACT");
  const fixture = adapterFixture({
    agents: {
      entries: {
        "agent-a": {
          memory: { search: { extraPaths: [42] } }
        }
      }
    }
  });

  await assert.rejects(
    () => planWorkspaceKnowledgeBinding({ workspacePath, agentIds: ["agent-a"], adapter: fixture.adapter }),
    /extraPaths is malformed/
  );

  const status = await getWorkspaceNativeKnowledgeStatus({
    workspacePath,
    agentIds: ["agent-a"],
    adapter: adapterFixture({ agents: { entries: entries("agent-a") } }).adapter
  });
  assert.equal(status.status, "unknown");
  assert.equal(status.agents[0]?.nativeStatus?.status, "unavailable");
  assert.equal(status.indexActionRequired, "unknown");
});

test("workspace status keeps a configured binding but projects unproven index locality as unknown", async () => {
  const workspacePath = await makeWorkspace();
  await ingestPrompt(workspacePath, "LOCALITY_UNKNOWN_FACT");
  const fixture = adapterFixture({
    agents: {
      entries: {
        "agent-a": { memory: { search: { extraPaths: [{ path: "knowledge/sources" }] } } }
      }
    }
  });
  fixture.adapter.getMemoryIndexStatus = async () => ({
    agentId: "agent-a",
    backend: null,
    files: null,
    chunks: null,
    dirty: null,
    lastSyncError: null,
    sourceCounts: null,
    indexIdentity: null,
    appliedVia: null,
    availability: "unavailable",
    locality: "unavailable-unproven",
    localityReason: "The connected Gateway runtime identity is unavailable."
  });

  const status = await getWorkspaceNativeKnowledgeStatus({
    workspacePath,
    agentIds: ["agent-a"],
    adapter: fixture.adapter
  });
  assert.equal(status.configured, true);
  assert.equal(status.status, "unknown");
  assert.equal(status.indexActionRequired, "unknown");
  assert.deepEqual(status.index, {
    files: null,
    chunks: null,
    dirty: null,
    lastSyncError: null,
    sourceCounts: null,
    locality: "unavailable-unproven",
    localityReason: "The connected Gateway runtime identity is unavailable."
  });
  assert.match(status.warnings.join(" "), /runtime identity is unavailable/);
});
