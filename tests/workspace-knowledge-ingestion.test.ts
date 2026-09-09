import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createWorkspaceKnowledgeSource,
  normalizeWorkspaceKnowledgeSources,
  normalizeWorkspaceKnowledgeSourcesTolerant
} from "@/lib/agentos/domains/workspace-knowledge";
import {
  ingestKnowledgeSources,
  isBlockedIpAddress,
  normalizeHttpUrl,
  promoteKnowledgeCorpus,
  readKnowledgeIngestionState,
  type KnowledgeWebsiteFetcher
} from "@/lib/agentos/domains/workspace-knowledge-ingestion";
import {
  getWorkspaceKnowledgeIngestionState,
  ingestWorkspaceKnowledge
} from "@/lib/agentos/application/workspace-knowledge-service";
import { normalizeWorkspacePlan } from "@/lib/openclaw/planner-core";
import { normalizeWorkspaceProjectManifestRecord } from "@/lib/openclaw/domains/workspace-manifest";

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

function folderSource(id: string, folderPath: string) {
  return createWorkspaceKnowledgeSource({
    id,
    kind: "folder",
    label: id,
    summary: folderPath,
    locator: { kind: "folder", path: folderPath },
    createdAt: "2026-09-09T00:00:00.000Z"
  });
}

function websiteSource(id: string, url = "https://example.com/") {
  return createWorkspaceKnowledgeSource({
    id,
    kind: "website",
    label: id,
    summary: url,
    locator: { kind: "website", url },
    createdAt: "2026-09-09T00:00:00.000Z"
  });
}

function connectorSource(id: string) {
  return createWorkspaceKnowledgeSource({
    id,
    kind: "connector",
    label: id,
    summary: "Deferred connector declaration",
    locator: { kind: "connector", provider: "example", resourceId: "resource-1" },
    createdAt: "2026-09-09T00:00:00.000Z"
  });
}

async function makeRoots(prefix = "agentos-knowledge-test-") {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const corpusRoot = path.join(root, "knowledge");
  const stateRoot = path.join(root, ".openclaw", "knowledge");
  await mkdir(corpusRoot, { recursive: true });
  return { root, corpusRoot, stateRoot };
}

async function removeRoot(root: string) {
  await rm(root, { recursive: true, force: true });
}

test("historical knowledge sources normalize per entry while mutation stays strict", () => {
  const validPrompt = {
    id: "brief",
    kind: "prompt",
    label: "Brief",
    locator: { kind: "prompt", text: "A valid brief" }
  };
  const validWebsite = {
    id: "site",
    kind: "website",
    label: "Site",
    locator: { kind: "website", url: "https://example.com" }
  };
  const tolerant = normalizeWorkspaceKnowledgeSourcesTolerant([
    validPrompt,
    { id: "broken", kind: "unknown", locator: { kind: "unknown" } },
    validWebsite
  ], { strict: false });
  assert.deepEqual(tolerant.sources.map((source) => source.id), ["brief", "site"]);
  assert.equal(tolerant.issues.length, 1);
  assert.equal(tolerant.issues[0]?.index, 1);
  assert.throws(() => normalizeWorkspaceKnowledgeSources([validPrompt, { kind: "unknown" }]));

  const manifest = normalizeWorkspaceProjectManifestRecord({
    version: 1,
    contextSources: [
      { id: "legacy-prompt", kind: "prompt", label: "Legacy prompt", summary: "Keep this" },
      { id: "legacy-broken", kind: "future-kind", label: "Broken" },
      { id: "legacy-folder", kind: "folder", label: "Folder", summary: "/tmp/docs" }
    ]
  });
  assert.deepEqual(manifest.knowledgeSources.map((source) => source.id), ["legacy-prompt", "legacy-folder"]);
  assert.equal(manifest.knowledgeSourceWarnings?.length, 1);
});

test("historical planner plans preserve valid sources around malformed entries", () => {
  const plan = normalizeWorkspacePlan({
    id: "historical-plan",
    intake: {
      sources: [
        { id: "old-site", kind: "website", label: "Old site", url: "https://example.com" },
        { id: "bad-source", kind: "unsupported", label: "Bad source" },
        { id: "old-brief", kind: "prompt", label: "Old brief", summary: "Valid old context" }
      ]
    }
  });
  assert.deepEqual(plan.knowledge.sources.map((source) => source.id), ["old-site", "old-brief"]);
  assert.equal(plan.knowledge.warnings?.length, 1);
});

test("Architect prompts teach canonical materialization and independent knowledge declarations", async () => {
  const planner = await readFile(path.join(process.cwd(), "lib/openclaw/planner.ts"), "utf8");
  assert.doesNotMatch(planner, /When changing source mode|clear stale repo and folder fields/i);
  assert.match(planner, /knowledge\.sources independently/);
  assert.match(planner, /workspace\.materialization object/);
});

test("prompt ingestion is deterministic, local, and secret-safe", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots();
  try {
    const source = promptSource("brief", "Build a small research workspace.\nAPI_KEY=super-secret-value\nTOKENS=100\nToken budget and secret management are documented.");
    const first = await ingestKnowledgeSources({ sources: [source], corpusRoot, stateRoot });
    const second = await ingestKnowledgeSources({ sources: [source], corpusRoot, stateRoot });
    assert.equal(first.run.status, "partial");
    assert.equal(second.sourceReports[0]?.unchangedItems, 1);
    assert.deepEqual(first.documents.map(({ id, outputPath, contentHash }) => ({ id, outputPath, contentHash })), second.documents.map(({ id, outputPath, contentHash }) => ({ id, outputPath, contentHash })));
    const output = await readFile(path.join(corpusRoot, first.documents[0]!.outputPath), "utf8");
    assert.match(output, /TOKENS=100/);
    assert.match(output, /Token budget and secret management are documented/);
    assert.doesNotMatch(output, /super-secret-value/);
    assert.match(output, /\[REDACTED\]/);
    assert.doesNotMatch(await readFile(path.join(stateRoot, "documents.json"), "utf8"), /super-secret-value/);
  } finally {
    await removeRoot(root);
  }
});

function fixtureWebsiteFetcher(): KnowledgeWebsiteFetcher {
  const pages = new Map([
    ["https://example.com/", `<!doctype html><html><head><title>Example Docs</title><link rel="canonical" href="https://example.com/"></head><body><nav>Ignore navigation</nav><main><h1>Example Docs</h1><p>Home content.</p><a href="/docs">Docs</a><a href="https://outside.example/secret">External</a><script>ignore this script</script></main></body></html>`],
    ["https://example.com/docs", `<!doctype html><html><head><title>Setup</title></head><body><article><h1>Setup</h1><p>Install the example.</p></article></body></html>`]
  ]);
  return {
    resolve: async () => ["93.184.216.34"],
    fetch: async (url) => {
      if (url.endsWith("/robots.txt") || url.endsWith("/sitemap.xml")) {
        return { status: 404, headers: {}, body: "" };
      }
      const body = pages.get(url);
      return body
        ? { status: 200, headers: { "content-type": "text/html" }, body }
        : { status: 404, headers: { "content-type": "text/html" }, body: "Not found" };
    }
  };
}

test("website ingestion is bounded, same-host, robots-aware, and does not execute JavaScript", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots();
  try {
    const result = await ingestKnowledgeSources({
      sources: [websiteSource("docs")],
      corpusRoot,
      stateRoot,
      websiteFetcher: fixtureWebsiteFetcher(),
      limits: { maxPagesPerSource: 5, maxDepth: 1 }
    });
    assert.equal(result.run.status, "ready");
    assert.equal(result.documents.length, 2);
    const contents = await Promise.all(result.documents.map((document) => readFile(path.join(corpusRoot, document.outputPath), "utf8")));
    assert.ok(contents.some((content) => content.includes("Home content.")));
    assert.ok(contents.some((content) => content.includes("Setup")));
    assert.ok(contents.every((content) => !content.includes("Ignore navigation") && !content.includes("ignore this script")));
    assert.ok(contents.every((content) => !content.includes("outside.example")));
  } finally {
    await removeRoot(root);
  }
});

test("a failed website page produces a partial source without discarding successful pages", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots("agentos-knowledge-web-partial-");
  try {
    const result = await ingestKnowledgeSources({
      sources: [websiteSource("partial-site")],
      corpusRoot,
      stateRoot,
      websiteFetcher: {
        resolve: async () => ["93.184.216.34"],
        fetch: async (url) => {
          if (url.endsWith("/robots.txt") || url.endsWith("/sitemap.xml")) return { status: 404, headers: {}, body: "" };
          if (url === "https://example.com/") return { status: 200, headers: { "content-type": "text/html" }, body: "<main><h1>Good page</h1><a href='/missing'>Missing</a></main>" };
          return { status: 503, headers: { "content-type": "text/html" }, body: "unavailable" };
        }
      }
    });
    assert.equal(result.run.status, "partial");
    assert.equal(result.documents.length, 1);
    assert.ok(result.sourceReports[0]!.warnings.some((warning) => warning.includes("HTTP 503")));
  } finally {
    await removeRoot(root);
  }
});

test("website SSRF protection rejects private DNS answers and unsafe redirects", async () => {
  assert.equal(isBlockedIpAddress("127.0.0.1"), true);
  assert.equal(isBlockedIpAddress("10.0.0.1"), true);
  assert.equal(isBlockedIpAddress("::1"), true);
  assert.equal(isBlockedIpAddress("::ffff:127.0.0.1"), true);
  assert.equal(isBlockedIpAddress("93.184.216.34"), false);
  assert.equal(normalizeHttpUrl("https://example.com/docs#section").toString(), "https://example.com/docs");

  const privateCalls: string[] = [];
  const privateResult = await (async () => {
    const { root, corpusRoot, stateRoot } = await makeRoots("agentos-knowledge-ssrf-");
    try {
      return await ingestKnowledgeSources({
        sources: [websiteSource("private")],
        corpusRoot,
        stateRoot,
        websiteFetcher: {
          resolve: async () => ["127.0.0.1"],
          fetch: async (url) => {
            privateCalls.push(url);
            return { status: 200, headers: { "content-type": "text/html" }, body: "should not be fetched" };
          }
        }
      });
    } finally {
      await removeRoot(root);
    }
  })();
  assert.equal(privateResult.run.status, "error");
  assert.equal(privateCalls.length, 0);

  const { root, corpusRoot, stateRoot } = await makeRoots("agentos-knowledge-redirect-");
  try {
    const result = await ingestKnowledgeSources({
      sources: [websiteSource("redirect")],
      corpusRoot,
      stateRoot,
      websiteFetcher: {
        resolve: async () => ["93.184.216.34"],
        fetch: async (url) => url.endsWith("/robots.txt") || url.endsWith("/sitemap.xml")
          ? { status: 404, headers: {}, body: "" }
          : { status: 302, headers: { location: "http://127.0.0.1/private" }, body: "" }
      }
    });
    assert.equal(result.run.status, "error");
    assert.match(result.sourceReports[0]?.error ?? "", /host scope|page/i);
  } finally {
    await removeRoot(root);
  }
});

test("folder and repository ingestion use bounded text allowlists and ignore execution noise", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots();
  const project = path.join(root, "project");
  const outside = path.join(root, "outside.md");
  try {
    await mkdir(path.join(project, "docs"), { recursive: true });
    await mkdir(path.join(project, "node_modules"), { recursive: true });
    await writeFile(path.join(project, "README.md"), "# Project\n\nRead me.");
    await writeFile(path.join(project, "docs", "guide.md"), "# Guide\n\nUse the guide.");
    await writeFile(path.join(project, "package.json"), JSON.stringify({ scripts: { ingest: "touch SHOULD_NOT_EXIST" } }));
    await writeFile(path.join(project, "node_modules", "ignored.md"), "ignored");
    await writeFile(path.join(project, ".env"), "API_KEY=never-import");
    await writeFile(outside, "outside");
    await symlink(outside, path.join(project, "docs", "escape.md"));

    const folderResult = await ingestKnowledgeSources({ sources: [folderSource("folder", project)], corpusRoot, stateRoot });
    assert.ok(folderResult.documents.some((document) => document.outputPath.endsWith("README.md")));
    assert.ok(folderResult.documents.some((document) => document.outputPath.endsWith("docs/guide.md")));
    assert.ok(folderResult.documents.every((document) => !document.outputPath.includes("node_modules")));
    assert.ok(folderResult.documents.every((document) => !document.outputPath.includes("escape")));

    const repositoryResult = await ingestKnowledgeSources({
      sources: [createWorkspaceKnowledgeSource({
        id: "repo",
        kind: "repository",
        label: "Repo",
        summary: project,
        locator: { kind: "repository", localPath: project },
        createdAt: "2026-09-09T00:00:00.000Z"
      })],
      corpusRoot: path.join(root, "repo-knowledge"),
      stateRoot: path.join(root, "repo-state")
    });
    assert.ok(repositoryResult.documents.some((document) => document.outputPath.endsWith("repository-overview.md")));
    assert.ok(repositoryResult.documents.some((document) => document.outputPath.endsWith("README.md")));
    assert.ok(repositoryResult.documents.every((document) => !document.outputPath.includes("node_modules")));
  } finally {
    await removeRoot(root);
  }
});

test("file formats, unsupported documents, binary content, and sensitive names are explicit", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots();
  const folder = path.join(root, "formats");
  try {
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "note.txt"), "plain text");
    await writeFile(path.join(folder, "data.json"), JSON.stringify({ answer: 42 }));
    await writeFile(path.join(folder, "config.yaml"), "answer: 42\n");
    await writeFile(path.join(folder, "settings.toml"), "answer = 42\n");
    await writeFile(path.join(folder, "page.html"), "<html><title>Page</title><main><p>HTML text</p></main></html>");
    await writeFile(path.join(folder, "manual.pdf"), "%PDF fake");
    await writeFile(path.join(folder, "manual.docx"), "PK fake");
    await writeFile(path.join(folder, "binary.txt"), Buffer.from([0, 1, 2]));
    await writeFile(path.join(folder, "credentials.json"), JSON.stringify({ token: "secret" }));
    const result = await ingestKnowledgeSources({ sources: [folderSource("formats", folder)], corpusRoot, stateRoot });
    assert.equal(result.run.status, "partial");
    assert.ok(result.documents.some((document) => document.outputPath.endsWith("page.md")));
    assert.ok(result.documents.some((document) => document.outputPath.endsWith("data.json")));
    assert.ok(result.sourceReports[0]!.warnings.some((warning) => warning.includes("PDF")));
    assert.ok(result.sourceReports[0]!.warnings.some((warning) => warning.includes("DOCX")));
    assert.ok(result.sourceReports[0]!.warnings.some((warning) => warning.includes("credentials.json")));
    assert.ok(result.documents.every((document) => !document.outputPath.endsWith("binary.txt")));
  } finally {
    await removeRoot(root);
  }
});

test("successful refresh prunes stale source files, while failed sources preserve the last corpus", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots();
  const folder = path.join(root, "refresh");
  try {
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "old.md"), "old");
    const source = folderSource("refresh", folder);
    const first = await ingestKnowledgeSources({ sources: [source], corpusRoot, stateRoot });
    assert.equal(first.run.status, "ready");
    await rm(path.join(folder, "old.md"));
    await writeFile(path.join(folder, "new.md"), "new");
    const second = await ingestKnowledgeSources({ sources: [source], corpusRoot, stateRoot });
    assert.equal(second.run.status, "ready");
    assert.ok(second.documents.some((document) => document.outputPath.endsWith("new.md")));
    assert.ok(!second.documents.some((document) => document.outputPath.endsWith("old.md")));
    await readFile(path.join(corpusRoot, second.documents.find((document) => document.outputPath.endsWith("new.md"))!.outputPath));

    const website = websiteSource("refresh-site");
    const firstWebsite = await ingestKnowledgeSources({ sources: [website], corpusRoot, stateRoot, websiteFetcher: fixtureWebsiteFetcher() });
    assert.equal(firstWebsite.run.status, "ready");
    const previousWebsitePath = path.join(corpusRoot, firstWebsite.documents[0]!.outputPath);
    const failedWebsite = await ingestKnowledgeSources({
      sources: [website],
      corpusRoot,
      stateRoot,
      websiteFetcher: {
        resolve: async () => ["93.184.216.34"],
        fetch: async () => { throw new Error("fixture unavailable"); }
      }
    });
    assert.equal(failedWebsite.run.status, "partial");
    assert.ok(failedWebsite.documents.some((document) => document.outputPath === firstWebsite.documents[0]!.outputPath));
    assert.equal((await readFile(previousWebsitePath, "utf8")).length > 0, true);
  } finally {
    await removeRoot(root);
  }
});

test("failure isolation keeps healthy sources and connector declarations explicit", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots();
  try {
    const result = await ingestKnowledgeSources({
      sources: [
        promptSource("healthy-a", "A"),
        connectorSource("deferred-connector"),
        promptSource("healthy-c", "C")
      ],
      corpusRoot,
      stateRoot
    });
    assert.equal(result.run.status, "partial");
    assert.deepEqual(result.documents.map((document) => document.sourceId), ["healthy-a", "healthy-c"]);
    assert.equal(result.sourceReports.find((report) => report.sourceId === "deferred-connector")?.support, "declaration-only");
    assert.equal(result.sourceReports.find((report) => report.sourceId === "deferred-connector")?.status, "error");
  } finally {
    await removeRoot(root);
  }
});

test("staging can be promoted into a new workspace without overwriting unrelated files", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots("agentos-knowledge-staging-");
  const targetWorkspace = path.join(root, "new-workspace");
  const targetCorpus = path.join(targetWorkspace, "knowledge");
  const targetState = path.join(targetWorkspace, ".openclaw", "knowledge");
  try {
    const result = await ingestKnowledgeSources({ sources: [promptSource("staged", "Staged context")], corpusRoot, stateRoot });
    assert.ok(result.documents.length > 0);
    await promoteKnowledgeCorpus({
      fromCorpusRoot: corpusRoot,
      fromStateRoot: stateRoot,
      toCorpusRoot: targetCorpus,
      toStateRoot: targetState
    });
    const promotedPath = path.join(targetCorpus, result.documents[0]!.outputPath);
    assert.match(await readFile(promotedPath, "utf8"), /Staged context/);
    assert.ok(await readKnowledgeIngestionState(targetState));

    await mkdir(path.dirname(promotedPath), { recursive: true });
    await writeFile(promotedPath, "operator-owned");
    await assert.rejects(() => promoteKnowledgeCorpus({
      fromCorpusRoot: corpusRoot,
      fromStateRoot: stateRoot,
      toCorpusRoot: targetCorpus,
      toStateRoot: targetState
    }), /unrelated file/);
  } finally {
    await removeRoot(root);
  }
});

test("pre-cancelled runs preserve an existing corpus and clean staging", async () => {
  const { root, corpusRoot, stateRoot } = await makeRoots("agentos-knowledge-cancel-");
  try {
    const controller = new AbortController();
    controller.abort();
    const result = await ingestKnowledgeSources({
      sources: [promptSource("cancelled", "No work" )],
      corpusRoot,
      stateRoot,
      signal: controller.signal
    });
    assert.equal(result.run.status, "cancelled");
    assert.equal(result.documents.length, 0);
    assert.equal(await readKnowledgeIngestionState(stateRoot), null);
  } finally {
    await removeRoot(root);
  }
});

test("workspace application wrappers read manifest declarations and persisted state", async () => {
  const { root } = await makeRoots("agentos-knowledge-wrapper-");
  try {
    await mkdir(path.join(root, ".openclaw"), { recursive: true });
    await writeFile(path.join(root, ".openclaw", "project.json"), JSON.stringify({
      version: 2,
      knowledgeSources: [promptSource("manifest-source", "Manifest context")]
    }));
    const result = await ingestWorkspaceKnowledge(root);
    assert.equal(result.documents.length, 1);
    const state = await getWorkspaceKnowledgeIngestionState(root);
    assert.equal(state?.lastRunId, result.run.runId);
    assert.equal(state?.sourceReports[0]?.sourceId, "manifest-source");
  } finally {
    await removeRoot(root);
  }
});
