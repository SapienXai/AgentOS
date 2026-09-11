import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createWorkspaceKnowledgeSource } from "@/lib/agentos/domains/workspace-knowledge";
import {
  ingestKnowledgeSources,
  KnowledgeIngestionCancelledError,
  KnowledgeIngestionBusyError,
  normalizeKnowledgeRepositoryRemoteUrl,
  promoteKnowledgeCorpus,
  readKnowledgeIngestionState,
  readKnowledgeSnapshot,
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

test("a live writer keeps readers on the previous stable generation", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots("agentos-knowledge-reader-race-");
  try {
    const first = await ingestKnowledgeSources({ sources: [promptSource("brief", "stable generation")], corpusRoot, stateRoot });
    let releaseWriter!: () => void;
    let writerEntered!: () => void;
    const writerEnteredPromise = new Promise<void>((resolve) => { writerEntered = resolve; });
    const writerRelease = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const writer = ingestKnowledgeSources({
      sources: [promptSource("brief", "next generation")],
      corpusRoot,
      stateRoot,
      transactionHooks: {
        beforeCorpusActivation: async () => {
          writerEntered();
          await writerRelease;
        }
      }
    });
    await writerEnteredPromise;
    assert.equal((await readKnowledgeIngestionState(stateRoot, corpusRoot))?.generationId, first.state.generationId);
    releaseWriter();
    const completed = await writer;
    assert.notEqual(completed.state.generationId, first.state.generationId);
    assert.equal((await readKnowledgeIngestionState(stateRoot, corpusRoot))?.generationId, completed.state.generationId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a second writer fails busy and can retry after the first writer releases", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots("agentos-knowledge-writer-race-");
  try {
    await ingestKnowledgeSources({ sources: [promptSource("brief", "stable generation")], corpusRoot, stateRoot });
    let releaseWriter!: () => void;
    let writerEntered!: () => void;
    const writerEnteredPromise = new Promise<void>((resolve) => { writerEntered = resolve; });
    const writerRelease = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const writer = ingestKnowledgeSources({
      sources: [promptSource("brief", "serialized generation")],
      corpusRoot,
      stateRoot,
      transactionHooks: {
        afterStage: async () => {
          writerEntered();
          await writerRelease;
        }
      }
    });
    await writerEnteredPromise;
    await assert.rejects(
      () => ingestKnowledgeSources({ sources: [promptSource("brief", "contender")], corpusRoot, stateRoot }),
      KnowledgeIngestionBusyError
    );
    releaseWriter();
    await writer;
    const retry = await ingestKnowledgeSources({ sources: [promptSource("brief", "contender")], corpusRoot, stateRoot });
    assert.equal(retry.run.status, "ready");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("writer ownership stays exclusive across 100 deterministic acquisition contenders", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots("agentos-knowledge-lock-contention-");
  try {
    await ingestKnowledgeSources({ sources: [promptSource("brief", "stable generation")], corpusRoot, stateRoot });
    let releaseWriter!: () => void;
    let writerEntered!: () => void;
    const writerEnteredPromise = new Promise<void>((resolve) => { writerEntered = resolve; });
    const writerRelease = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const writer = ingestKnowledgeSources({
      sources: [promptSource("brief", "serialized generation")],
      corpusRoot,
      stateRoot,
      transactionHooks: {
        afterStage: async () => {
          writerEntered();
          await writerRelease;
        }
      }
    });
    await writerEnteredPromise;
    const attempts = await Promise.allSettled(Array.from({ length: 100 }, (_, index) => ingestKnowledgeSources({
      sources: [promptSource(`contender-${index}`, `contender ${index}`)],
      corpusRoot,
      stateRoot
    })));
    assert.equal(attempts.length, 100);
    assert.ok(attempts.every((attempt) => attempt.status === "rejected" && attempt.reason instanceof KnowledgeIngestionBusyError));
    releaseWriter();
    await writer;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("readers observe stable knowledge during 128 concurrent writer observations", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots("agentos-knowledge-reader-stress-");
  try {
    const first = await ingestKnowledgeSources({ sources: [promptSource("brief", "stable generation")], corpusRoot, stateRoot });
    let releaseWriter!: () => void;
    let writerEntered!: () => void;
    const writerEnteredPromise = new Promise<void>((resolve) => { writerEntered = resolve; });
    const writerRelease = new Promise<void>((resolve) => { releaseWriter = resolve; });
    const writer = ingestKnowledgeSources({
      sources: [promptSource("brief", "next generation")],
      corpusRoot,
      stateRoot,
      transactionHooks: {
        afterStage: async () => {
          writerEntered();
          await writerRelease;
        }
      }
    });
    await writerEnteredPromise;
    const publishedLock = JSON.parse(await readFile(path.join(stateRoot, "writer-lock.json"), "utf8")) as Record<string, unknown>;
    assert.equal(publishedLock.schemaVersion, 1);
    assert.equal(typeof publishedLock.lockId, "string");
    const observations = await Promise.all(Array.from({ length: 128 }, () => readKnowledgeSnapshot(corpusRoot, stateRoot)));
    assert.ok(observations.every((snapshot) => snapshot?.state.generationId === first.state.generationId));
    releaseWriter();
    await writer;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a late stale owner cannot remove a replacement writer lock", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots("agentos-knowledge-late-release-");
  try {
    let releaseFirst!: () => void;
    let firstEntered!: () => void;
    const firstEnteredPromise = new Promise<void>((resolve) => { firstEntered = resolve; });
    const firstRelease = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const first = ingestKnowledgeSources({
      sources: [promptSource("first", "first writer")],
      corpusRoot,
      stateRoot,
      transactionHooks: {
        afterStage: async () => {
          firstEntered();
          await firstRelease;
        }
      }
    });
    await firstEnteredPromise;
    await writeFile(path.join(stateRoot, "writer-lock.json"), JSON.stringify({
      schemaVersion: 1,
      lockId: "stale-first-owner",
      pid: 99_999_999,
      hostname: "stale-test-host",
      startedAt: "2020-01-01T00:00:00.000Z",
      heartbeatAt: "2020-01-01T00:00:00.000Z",
      operation: "ingestion",
      ownerStartIdentity: null
    }));

    let releaseSecond!: () => void;
    let secondEntered!: () => void;
    const secondEnteredPromise = new Promise<void>((resolve) => { secondEntered = resolve; });
    const secondRelease = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const second = ingestKnowledgeSources({
      sources: [promptSource("second", "replacement writer")],
      corpusRoot,
      stateRoot,
      transactionHooks: {
        afterStage: async () => {
          secondEntered();
          await secondRelease;
        }
      }
    });
    await secondEnteredPromise;
    releaseFirst();
    await assert.rejects(first);
    const replacementLock = JSON.parse(await readFile(path.join(stateRoot, "writer-lock.json"), "utf8")) as Record<string, unknown>;
    assert.notEqual(replacementLock.lockId, "stale-first-owner");
    releaseSecond();
    const completed = await second;
    assert.equal(completed.run.status, "ready");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stale writer ownership is reclaimed before transaction recovery", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots("agentos-knowledge-stale-lock-");
  try {
    const first = await ingestKnowledgeSources({ sources: [promptSource("brief", "stable generation")], corpusRoot, stateRoot });
    const stagingRoot = path.join(corpusRoot, ".agentos-staging", "stale-transaction");
    await mkdir(path.join(stagingRoot, "sources"), { recursive: true });
    await writeFile(path.join(stateRoot, "writer-lock.json"), JSON.stringify({
      schemaVersion: 1,
      lockId: "stale-lock",
      pid: 99_999_999,
      hostname: "stale-test-host",
      startedAt: "2020-01-01T00:00:00.000Z",
      heartbeatAt: "2020-01-01T00:00:00.000Z",
      operation: "ingestion",
      ownerStartIdentity: null
    }));
    await writeFile(path.join(stateRoot, "transaction.json"), JSON.stringify({
      schemaVersion: 2,
      transactionId: "stale-transaction",
      generationId: "knowledge-generation-dead0000",
      previousPointer: { schemaVersion: 2, generationId: first.state.generationId },
      phase: "prepared",
      stagingRelativePath: ".agentos-staging/stale-transaction",
      lockId: "stale-lock",
      ownerPid: 99_999_999,
      ownerHostname: "stale-test-host",
      ownerStartIdentity: null
    }));
    assert.equal((await readKnowledgeIngestionState(stateRoot, corpusRoot))?.generationId, first.state.generationId);
    assert.equal(await readFile(path.join(stateRoot, "transaction.json")).catch(() => null), null);
    const retry = await ingestKnowledgeSources({ sources: [promptSource("brief", "after stale recovery")], corpusRoot, stateRoot });
    assert.equal(retry.run.status, "ready");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("malformed writer control state fails closed", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots("agentos-knowledge-malformed-lock-");
  try {
    await ingestKnowledgeSources({ sources: [promptSource("brief", "stable generation")], corpusRoot, stateRoot });
    await writeFile(path.join(stateRoot, "writer-lock.json"), "not-json\n");
    await assert.rejects(() => readKnowledgeIngestionState(stateRoot, corpusRoot), /writer lock|malformed/i);
    assert.equal(await readFile(path.join(stateRoot, "writer-lock.json"), "utf8"), "not-json\n");
    await rm(path.join(stateRoot, "writer-lock.json"), { force: true });
    await writeFile(path.join(stateRoot, "current.json"), "not-json\n");
    await assert.rejects(() => readKnowledgeIngestionState(stateRoot, corpusRoot), /generation pointer|malformed/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an initializing writer control guard is busy, not malformed", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots("agentos-knowledge-initializing-lock-");
  try {
    const first = await ingestKnowledgeSources({ sources: [promptSource("brief", "stable generation")], corpusRoot, stateRoot });
    await mkdir(path.join(stateRoot, "writer-lock-control"));
    await assert.rejects(
      () => ingestKnowledgeSources({ sources: [promptSource("brief", "contender")], corpusRoot, stateRoot }),
      KnowledgeIngestionBusyError
    );
    await rm(path.join(stateRoot, "writer-lock-control"), { recursive: true, force: true });
    assert.equal((await readKnowledgeIngestionState(stateRoot, corpusRoot))?.generationId, first.state.generationId);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cancellation releases the writer lease for an immediate retry", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots("agentos-knowledge-cancel-lock-");
  try {
    const first = await ingestKnowledgeSources({ sources: [promptSource("brief", "stable generation")], corpusRoot, stateRoot });
    const controller = new AbortController();
    const cancelled = await ingestKnowledgeSources({
      sources: [promptSource("brief", "cancelled generation")],
      corpusRoot,
      stateRoot,
      signal: controller.signal,
      transactionHooks: { afterStage: () => controller.abort() }
    });
    assert.equal(cancelled.run.status, "cancelled");
    assert.equal((await readKnowledgeIngestionState(stateRoot, corpusRoot))?.generationId, first.state.generationId);
    const retry = await ingestKnowledgeSources({ sources: [promptSource("brief", "retry generation")], corpusRoot, stateRoot });
    assert.equal(retry.run.status, "ready");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("post-pointer failure finalizes the promoted generation without exposing a split state", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots("agentos-knowledge-post-pointer-");
  try {
    const first = await ingestKnowledgeSources({ sources: [promptSource("brief", "before pointer")], corpusRoot, stateRoot });
    const replacement = await assert.rejects(() => ingestKnowledgeSources({
      sources: [promptSource("brief", "after pointer")],
      corpusRoot,
      stateRoot,
      transactionHooks: { afterMetadataActivation: () => { throw new Error("injected post-pointer failure"); } }
    }), /injected post-pointer failure/);
    assert.equal(replacement, undefined);
    assert.match((await readKnowledgeIngestionState(stateRoot, corpusRoot))?.sourceReports[0]?.sourceId ?? "", /brief/);
    assert.match(await readFile(path.join(corpusRoot, first.documents[0]!.outputPath), "utf8"), /after pointer/);
    assert.equal(await readFile(path.join(stateRoot, "transaction.json")).catch(() => null), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("promotion uses the target writer lease and serializes promotion contenders", async () => {
  const source = await makeRoots("agentos-knowledge-promotion-lock-source-");
  const target = await makeRoots("agentos-knowledge-promotion-lock-target-");
  try {
    const sourceIngestion = await ingestKnowledgeSources({ sources: [promptSource("source", "promoted content")], corpusRoot: source.corpusRoot, stateRoot: source.stateRoot });
    await ingestKnowledgeSources({ sources: [promptSource("target", "target content")], corpusRoot: target.corpusRoot, stateRoot: target.stateRoot });
    let releasePromotion!: () => void;
    let promotionEntered!: () => void;
    const promotionEnteredPromise = new Promise<void>((resolve) => { promotionEntered = resolve; });
    const promotionRelease = new Promise<void>((resolve) => { releasePromotion = resolve; });
    const promotion = promoteKnowledgeCorpus({
      fromCorpusRoot: source.corpusRoot,
      fromStateRoot: source.stateRoot,
      toCorpusRoot: target.corpusRoot,
      toStateRoot: target.stateRoot,
      transactionHooks: { afterStage: async () => { promotionEntered(); await promotionRelease; } }
    });
    await promotionEnteredPromise;
    await assert.rejects(() => promoteKnowledgeCorpus({
      fromCorpusRoot: source.corpusRoot,
      fromStateRoot: source.stateRoot,
      toCorpusRoot: target.corpusRoot,
      toStateRoot: target.stateRoot
    }), KnowledgeIngestionBusyError);
    releasePromotion();
    await promotion;
    const retry = promoteKnowledgeCorpus({
      fromCorpusRoot: source.corpusRoot,
      fromStateRoot: source.stateRoot,
      toCorpusRoot: target.corpusRoot,
      toStateRoot: target.stateRoot
    });
    await retry;
    assert.match(await readFile(path.join(target.corpusRoot, sourceIngestion.documents[0]!.outputPath), "utf8"), /promoted content/);
  } finally {
    await rm(source.root, { recursive: true, force: true });
    await rm(target.root, { recursive: true, force: true });
  }
});

test("Git clone strips verification-disabling and proxy inheritance while retaining CA trust anchors", async () => {
  const names = ["GIT_SSL_NO_VERIFY", "GIT_SSL_VERSION", "GIT_SSL_CIPHER_LIST", "GIT_HTTP_PROXY", "HTTPS_PROXY", "GIT_SSL_CAINFO", "GIT_SSL_CAPATH", "SSL_CERT_FILE", "SSL_CERT_DIR", "CURL_CA_BUNDLE"];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  const values: Record<string, string> = {
    GIT_SSL_NO_VERIFY: "true",
    GIT_SSL_VERSION: "SSLv3",
    GIT_SSL_CIPHER_LIST: "RC4-MD5",
    GIT_HTTP_PROXY: "http://proxy.invalid",
    HTTPS_PROXY: "http://proxy.invalid",
    GIT_SSL_CAINFO: "/enterprise/ca.pem",
    GIT_SSL_CAPATH: "/enterprise/ca",
    SSL_CERT_FILE: "/enterprise/cert.pem",
    SSL_CERT_DIR: "/enterprise/certs",
    CURL_CA_BUNDLE: "/enterprise/bundle.pem"
  };
  try {
    for (const [name, value] of Object.entries(values)) process.env[name] = value;
    const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
    await runSafeGitClone("https://example.com/repo.git", "/tmp/agentos-tls-test-target", undefined, 1_000, ["93.184.216.34"], async (_file, args, options) => {
      calls.push({ args, env: options.env });
      return { stdout: args[0] === "--version" ? "git version 2.50.1" : "", stderr: "" };
    });
    const clone = calls[1]!;
    assert.equal(clone.env.GIT_SSL_NO_VERIFY, undefined);
    assert.equal(clone.env.GIT_SSL_VERSION, undefined);
    assert.equal(clone.env.GIT_SSL_CIPHER_LIST, undefined);
    assert.equal(clone.env.GIT_HTTP_PROXY, undefined);
    assert.equal(clone.env.HTTPS_PROXY, undefined);
    assert.equal(clone.env.GIT_SSL_CAINFO, values.GIT_SSL_CAINFO);
    assert.equal(clone.env.GIT_SSL_CAPATH, values.GIT_SSL_CAPATH);
    assert.equal(clone.env.SSL_CERT_FILE, values.SSL_CERT_FILE);
    assert.equal(clone.env.SSL_CERT_DIR, values.SSL_CERT_DIR);
    assert.equal(clone.env.CURL_CA_BUNDLE, values.CURL_CA_BUNDLE);
    assert.ok(clone.args.includes("http.sslVerify=true"));
    assert.ok(clone.args.includes("http.sslVersion="));
    assert.ok(clone.args.includes("http.sslCipherList="));
    assert.ok(clone.args.includes("http.proxy="));
    assert.ok(clone.args.includes("https.proxy="));
  } finally {
    for (const name of names) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
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
