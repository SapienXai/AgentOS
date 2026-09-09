import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createWorkspaceKnowledgeSource } from "@/lib/agentos/domains/workspace-knowledge";
import {
  ingestKnowledgeSources,
  KnowledgeIngestionCancelledError,
  normalizeKnowledgeRepositoryRemoteUrl,
  promoteKnowledgeCorpus,
  readKnowledgeIngestionState,
  runSafeGitClone
} from "@/lib/agentos/domains/workspace-knowledge-ingestion";

function promptSource(id: string, text: string) {
  return createWorkspaceKnowledgeSource({
    id,
    kind: "prompt",
    label: id,
    summary: text,
    locator: { kind: "prompt", text },
    createdAt: "2026-09-09T00:00:00.000Z"
  });
}

function remoteSource(id: string, remoteUrl: string) {
  return createWorkspaceKnowledgeSource({
    id,
    kind: "repository",
    label: id,
    summary: remoteUrl,
    locator: { kind: "repository", remoteUrl },
    createdAt: "2026-09-09T00:00:00.000Z"
  });
}

async function makeRoots(prefix = "agentos-knowledge-hardening-") {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const corpusRoot = path.join(root, "knowledge");
  const stateRoot = path.join(root, ".openclaw", "knowledge");
  await mkdir(corpusRoot, { recursive: true });
  return { root, corpusRoot, stateRoot };
}

test("remote repository policy is HTTPS-only and rejects embedded credentials and non-default ports", () => {
  assert.equal(normalizeKnowledgeRepositoryRemoteUrl("https://example.com/repo.git#docs").toString(), "https://example.com/repo.git");
  for (const value of [
    "ssh://example.com/repo.git",
    "git://example.com/repo.git",
    "git@example.com:repo.git",
    "file:///tmp/repo",
    "ext::sh -c evil",
    "https://user:password@example.com/repo.git",
    "https://example.com:8443/repo.git",
    "https://example.com/repo.git?token=secret"
  ]) {
    assert.throws(() => normalizeKnowledgeRepositoryRemoteUrl(value));
  }
});

test("remote repository ingestion rejects private and mixed DNS answers before Git", async () => {
  for (const [label, addresses] of [
    ["loopback", ["127.0.0.1"]],
    ["private", ["10.0.0.5"]],
    ["link-local", ["169.254.169.254"]],
    ["mapped-loopback", ["::ffff:127.0.0.1"]],
    ["mixed", ["93.184.216.34", "192.168.1.12"]]
  ] as const) {
    const { root, corpusRoot, stateRoot } = await makeRoots(`agentos-knowledge-${label}-`);
    try {
      const result = await ingestKnowledgeSources({
        sources: [remoteSource(label, "https://public.example/repo.git")],
        corpusRoot,
        stateRoot,
        networkResolver: async () => [...addresses]
      });
      assert.equal(result.run.status, "error");
      assert.match(result.sourceReports[0]?.error ?? "", /public|blocked|checkout/i);
      assert.equal((await readKnowledgeIngestionState(stateRoot, corpusRoot))?.sourceReports[0]?.errorCount, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("pinned Git clone passes DNS pinning and cancellation to the child command", async () => {
  const controller = new AbortController();
  const calls: Array<{ args: string[]; signal?: AbortSignal; env: NodeJS.ProcessEnv }> = [];
  const command = async (_file: string, args: string[], options: { signal?: AbortSignal; env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number }) => {
    calls.push({ args, signal: options.signal, env: options.env });
    if (args[0] === "--version") return { stdout: "git version 2.50.1", stderr: "" };
    await new Promise<never>((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError", code: "ABORT_ERR" })), { once: true });
    });
    throw new Error("unreachable");
  };
  const promise = runSafeGitClone("https://example.com/repo.git", "/tmp/agentos-hardening-test-target", controller.signal, 1_000, ["93.184.216.34"], command);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.length, 2);
  assert.ok(calls[1]?.args.includes("http.curloptResolve=example.com:443:93.184.216.34"));
  assert.ok(calls[1]?.args.includes("http.followRedirects=false"));
  assert.ok(calls[1]?.args.includes("credential.helper="));
  assert.equal(calls[1]?.env.GIT_TERMINAL_PROMPT, "0");
  controller.abort();
  await assert.rejects(promise, KnowledgeIngestionCancelledError);
  assert.equal(calls[1]?.signal?.aborted, true);
});

test("failed corpus activation rolls back the previous complete generation", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots();
  try {
    const first = await ingestKnowledgeSources({ sources: [promptSource("brief", "old generation")], corpusRoot, stateRoot });
    const outputPath = path.join(corpusRoot, first.documents[0]!.outputPath);
    const oldContent = await readFile(outputPath, "utf8");
    const oldState = await readKnowledgeIngestionState(stateRoot, corpusRoot);
    await assert.rejects(() => ingestKnowledgeSources({
      sources: [promptSource("brief", "new generation")],
      corpusRoot,
      stateRoot,
      transactionHooks: { afterCorpusActivation: () => { throw new Error("injected corpus activation failure"); } }
    }), /injected corpus activation failure/);
    assert.equal(await readFile(outputPath, "utf8"), oldContent);
    assert.equal((await readKnowledgeIngestionState(stateRoot, corpusRoot))?.generationId, oldState?.generationId);
    assert.equal((await readKnowledgeIngestionState(stateRoot, corpusRoot))?.lastRunId, oldState?.lastRunId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corpus activation preserves operator files and refuses modified managed files", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots();
  try {
    const first = await ingestKnowledgeSources({ sources: [promptSource("owned", "generated content")], corpusRoot, stateRoot });
    const operatorPath = path.join(corpusRoot, "sources", "operator", "notes.md");
    await mkdir(path.dirname(operatorPath), { recursive: true });
    await writeFile(operatorPath, "operator-owned file\n");
    const second = await ingestKnowledgeSources({ sources: [promptSource("owned", "new generated content")], corpusRoot, stateRoot });
    assert.ok(second.documents.length > 0);
    assert.equal(await readFile(operatorPath, "utf8"), "operator-owned file\n");
    const managedPath = path.join(corpusRoot, first.documents[0]!.outputPath);
    await writeFile(managedPath, "operator modified generated file\n");
    await assert.rejects(() => ingestKnowledgeSources({ sources: [promptSource("owned", "another generated content")], corpusRoot, stateRoot }), /unrelated file/);
    assert.equal(await readFile(managedPath, "utf8"), "operator modified generated file\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy V1 metadata is readable and upgrades on the next successful write", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots();
  try {
    const first = await ingestKnowledgeSources({ sources: [promptSource("legacy", "legacy content")], corpusRoot, stateRoot });
    const legacyState = { ...first.state, schemaVersion: 1 } as Record<string, unknown>;
    delete legacyState.generationId;
    const legacyDocuments = { schemaVersion: 1, updatedAt: first.state.updatedAt, documents: first.documents };
    await rm(path.join(stateRoot, "current.json"), { force: true });
    await rm(path.join(stateRoot, "generations"), { recursive: true, force: true });
    await writeFile(path.join(stateRoot, "state.json"), `${JSON.stringify(legacyState)}\n`);
    await writeFile(path.join(stateRoot, "documents.json"), `${JSON.stringify(legacyDocuments)}\n`);
    assert.equal((await readKnowledgeIngestionState(stateRoot, corpusRoot))?.lastRunId, first.run.runId);
    const upgraded = await ingestKnowledgeSources({ sources: [promptSource("legacy", "upgraded content")], corpusRoot, stateRoot });
    assert.match(upgraded.state.generationId ?? "", /^knowledge-generation-/);
    assert.equal((await readKnowledgeIngestionState(stateRoot, corpusRoot))?.generationId, upgraded.state.generationId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("split compatibility mirrors fail closed while the activated generation remains authoritative", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots();
  try {
    const first = await ingestKnowledgeSources({ sources: [promptSource("consistent", "complete")], corpusRoot, stateRoot });
    const stateValue = JSON.parse(await readFile(path.join(stateRoot, "state.json"), "utf8")) as Record<string, unknown>;
    const documentsValue = JSON.parse(await readFile(path.join(stateRoot, "documents.json"), "utf8")) as Record<string, unknown>;
    await writeFile(path.join(stateRoot, "documents.json"), JSON.stringify({ ...documentsValue, generationId: "knowledge-generation-fake" }));
    assert.equal((await readKnowledgeIngestionState(stateRoot, corpusRoot))?.generationId, first.state.generationId);
    await rm(path.join(stateRoot, "current.json"), { force: true });
    await writeFile(path.join(stateRoot, "state.json"), JSON.stringify({ ...stateValue, generationId: "knowledge-generation-a" }));
    assert.equal(await readKnowledgeIngestionState(stateRoot, corpusRoot), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("promotion failure restores the target generation", async () => {
  const source = await makeRoots("agentos-knowledge-promotion-source-");
  const target = await makeRoots("agentos-knowledge-promotion-target-");
  try {
    await ingestKnowledgeSources({ sources: [promptSource("source", "promoted replacement")], corpusRoot: source.corpusRoot, stateRoot: source.stateRoot });
    const initial = await ingestKnowledgeSources({ sources: [promptSource("target", "target original")], corpusRoot: target.corpusRoot, stateRoot: target.stateRoot });
    const targetPath = path.join(target.corpusRoot, initial.documents[0]!.outputPath);
    await assert.rejects(() => promoteKnowledgeCorpus({
      fromCorpusRoot: source.corpusRoot,
      fromStateRoot: source.stateRoot,
      toCorpusRoot: target.corpusRoot,
      toStateRoot: target.stateRoot,
      transactionHooks: { afterCorpusActivation: () => { throw new Error("injected promotion failure"); } }
    }), /injected promotion failure/);
    assert.match(await readFile(targetPath, "utf8"), /target original/);
    assert.equal((await readKnowledgeIngestionState(target.stateRoot, target.corpusRoot))?.lastRunId, initial.run.runId);
  } finally {
    await rm(source.root, { recursive: true, force: true });
    await rm(target.root, { recursive: true, force: true });
  }
});
