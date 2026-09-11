import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { test } from "node:test";

import {
  readWorkspaceCreationContext,
  readWorkspaceCreationFileWithinLimits,
  stageWorkspaceCreationKnowledge,
  validateWorkspaceCreationUploadMetadata,
  WORKSPACE_CREATION_UPLOAD_LIMITS,
  type WorkspaceCreationUpload
} from "@/lib/agentos/application/workspace-creation-context-service";
import { generateWorkspaceBlueprint } from "@/lib/agentos/application/workspace-architect";
import {
  createWorkspaceKnowledgeSource
} from "@/lib/agentos/domains/workspace-knowledge";
import { missionControlRootPath } from "@/lib/openclaw/state/paths";

function websiteSource(id = "website") {
  return createWorkspaceKnowledgeSource({
    id,
    kind: "website",
    label: "Acme website",
    summary: "User-selected website source.",
    locator: { kind: "website", url: "https://acme.example/" },
    provenance: "operator"
  });
}

function fileSource(id = "file") {
  return createWorkspaceKnowledgeSource({
    id,
    kind: "file",
    label: "Product brief",
    summary: "User-selected project file.",
    locator: { kind: "file", path: `upload:${id}` },
    provenance: "operator"
  });
}

function folderSource(id = "folder") {
  return createWorkspaceKnowledgeSource({
    id,
    kind: "folder",
    label: "Project folder",
    summary: "User-selected project folder.",
    locator: { kind: "folder", path: `upload:${id}` },
    provenance: "operator"
  });
}

function repositorySource(id = "repository") {
  return createWorkspaceKnowledgeSource({
    id,
    kind: "repository",
    label: "Acme repository",
    summary: "User-selected GitHub repository source.",
    locator: { kind: "repository", remoteUrl: "https://github.com/acme/product.git" },
    provenance: "operator"
  });
}

function upload(sourceId: string, relativePath: string, text: string): WorkspaceCreationUpload {
  return { sourceId, relativePath, fileName: relativePath.split("/").pop() ?? relativePath, bytes: Buffer.from(text) };
}

function uploadManifest(sourceId: string, count = 1) {
  return Array.from({ length: count }, (_, index) => ({
    sourceId,
    relativePath: `file-${index}.md`,
    fileName: `file-${index}.md`
  }));
}

function websiteFetcher(counter?: { calls: number }) {
  return {
    resolve: async () => ["93.184.216.34"],
    fetch: async (url: string) => {
      if (counter) counter.calls += 1;
      if (url.endsWith("/robots.txt") || url.endsWith("/sitemap.xml")) return { status: 404, headers: {}, body: "" };
      return {
        status: 200,
        headers: { "content-type": "text/html" },
        finalUrl: url,
        body: "<html><head><title>Acme</title></head><body><h1>Acme reservation platform</h1><p>Acme provides a B2B reservation platform for restaurants.</p></body></html>"
      };
    }
  };
}

async function withContext<T>(actorId: string, task: (draftContextId: string) => Promise<T>) {
  const draftContextId = randomUUID();
  try {
    return await task(draftContextId);
  } finally {
    const actorHash = createHash("sha256").update(actorId).digest("hex").slice(0, 32);
    await rm(`${missionControlRootPath}/workspace-create/${actorHash}/${draftContextId}`, { recursive: true, force: true });
  }
}

test("website and uploaded files are ingested through the Phase 2 corpus before Architect use", async () => {
  await withContext("context-test-website-file", async (draftContextId) => {
    const file = fileSource();
    const result = await stageWorkspaceCreationKnowledge({
      actorId: "context-test-website-file",
      draftContextId,
      sources: [websiteSource(), file],
      uploads: [upload(file.id, "product.md", "The reservation workflow serves restaurant operators.")],
      websiteFetcher: websiteFetcher()
    });
    const context = await readWorkspaceCreationContext({ actorId: "context-test-website-file", draftContextId });
    const promptCapture: string[] = [];
    await generateWorkspaceBlueprint({
      brief: "Create a workspace for Acme.",
      knowledge: context.knowledge
    }, {
      modelExecutor: async (request) => {
        promptCapture.push(request.userPrompt);
        return { text: JSON.stringify({ workforce: { specialists: [] } }), runId: "context-architect", modelId: "test", runtime: "model-runtime" };
      }
    });

    assert.equal(result.runStatus, "ready");
    assert.equal(result.sourceReports.every((report) => report.status === "ready"), true);
    assert.ok(result.generationId);
    assert.equal(result.extractionSummary?.status, "ready");
    assert.ok((result.extractionSummary?.factCount ?? 0) > 0);
    assert.ok((context.knowledge.documents ?? []).some((document) => document.content?.includes("B2B reservation platform")));
    assert.ok((context.knowledge.documents ?? []).some((document) => document.content?.includes("restaurant operators")));
    assert.equal(context.extractionSummary?.extractionId, result.extractionSummary?.extractionId);
    assert.match(promptCapture[0] ?? "", /B2B reservation platform/);
  });
});

test("oversized upload metadata is rejected before any file buffer is read", () => {
  let arrayBufferCalls = 0;
  const file = {
    name: "file-0.md",
    size: WORKSPACE_CREATION_UPLOAD_LIMITS.maxBytesPerFile + 1,
    arrayBuffer: async () => {
      arrayBufferCalls += 1;
      return new ArrayBuffer(0);
    }
  };

  assert.throws(
    () => validateWorkspaceCreationUploadMetadata([file], uploadManifest("oversized")),
    /File is too large for project analysis/
  );
  assert.equal(arrayBufferCalls, 0);
});

test("actual uploaded bytes are bounded while the file stream is consumed", async () => {
  const file = {
    stream: () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(WORKSPACE_CREATION_UPLOAD_LIMITS.maxBytesPerFile + 1));
        controller.close();
      }
    })
  } as File;
  await assert.rejects(
    readWorkspaceCreationFileWithinLimits(file, WORKSPACE_CREATION_UPLOAD_LIMITS.maxBytesPerFile),
    /exceeds the size limit/
  );
});

test("upload metadata rejects a manifest/file name mismatch before buffering", () => {
  assert.throws(
    () => validateWorkspaceCreationUploadMetadata(
      [{ name: "actual.md", size: 10 }],
      [{ sourceId: "mismatch", relativePath: "declared.md", fileName: "declared.md" }]
    ),
    /metadata does not match the files supplied/
  );
});

test("upload metadata rejects cumulative size and file count before buffering", () => {
  const validSize = WORKSPACE_CREATION_UPLOAD_LIMITS.maxBytesPerFile;
  assert.throws(
    () => validateWorkspaceCreationUploadMetadata(
      Array.from({ length: 9 }, (_, index) => ({ name: `file-${index}.md`, size: validSize })),
      uploadManifest("cumulative", 9)
    ),
    /Project context is too large for analysis/
  );
  const files = Array.from({ length: WORKSPACE_CREATION_UPLOAD_LIMITS.maxFiles + 1 }, (_, index) => ({ name: `file-${index}.md`, size: 0 }));
  assert.throws(
    () => validateWorkspaceCreationUploadMetadata(files, uploadManifest("count", files.length)),
    /Too many files selected/
  );
});

test("staged context reuses a successful generation and does not re-fetch on retry", async () => {
  await withContext("context-test-reuse", async (draftContextId) => {
    const counter = { calls: 0 };
    const first = await stageWorkspaceCreationKnowledge({
      actorId: "context-test-reuse",
      draftContextId,
      sources: [websiteSource()],
      websiteFetcher: websiteFetcher(counter)
    });
    const callsAfterFirst = counter.calls;
    const second = await stageWorkspaceCreationKnowledge({
      actorId: "context-test-reuse",
      draftContextId,
      sources: [websiteSource()],
      websiteFetcher: websiteFetcher(counter)
    });

    assert.equal(second.reused, true);
    assert.equal(second.runStatus, "reused");
    assert.equal(second.generationId, first.generationId);
    assert.equal(counter.calls, callsAfterFirst);
  });
});

test("folder uploads preserve safe relative paths and are read by Phase 2", async () => {
  await withContext("context-test-folder", async (draftContextId) => {
    const folder = folderSource();
    const result = await stageWorkspaceCreationKnowledge({
      actorId: "context-test-folder",
      draftContextId,
      sources: [folder],
      uploads: [
        upload(folder.id, "docs/product.md", "Product requirements for restaurant operators."),
        upload(folder.id, "README.md", "Acme project overview.")
      ]
    });
    const context = await readWorkspaceCreationContext({ actorId: "context-test-folder", draftContextId });

    assert.equal(result.sourceReports[0]?.status, "ready");
    assert.equal((context.knowledge.documents ?? []).length, 2);
    assert.ok((context.knowledge.documents ?? []).some((document) => document.content?.includes("Product requirements")));
  });
});

test("partial source failure preserves surviving project context", async () => {
  await withContext("context-test-partial", async (draftContextId) => {
    const result = await stageWorkspaceCreationKnowledge({
      actorId: "context-test-partial",
      draftContextId,
      sources: [websiteSource(), repositorySource()],
      websiteFetcher: websiteFetcher(),
      networkResolver: async (hostname) => hostname === "github.com" ? ["127.0.0.1"] : ["93.184.216.34"]
    });
    const context = await readWorkspaceCreationContext({ actorId: "context-test-partial", draftContextId });

    assert.equal(result.runStatus, "partial");
    assert.equal(result.sourceReports.find((report) => report.sourceId === "website")?.status, "ready");
    assert.equal(result.sourceReports.find((report) => report.sourceId === "repository")?.status, "error");
    assert.ok((context.knowledge.documents ?? []).some((document) => document.sourceId === "website"));
    assert.equal((context.knowledge.documents ?? []).some((document) => document.sourceId === "repository"), false);
  });
});

test("unsupported document formats are reported without fabricated Architect content", async () => {
  await withContext("context-test-unsupported", async (draftContextId) => {
    const file = fileSource("pdf");
    const result = await stageWorkspaceCreationKnowledge({
      actorId: "context-test-unsupported",
      draftContextId,
      sources: [file],
      uploads: [upload(file.id, "requirements.pdf", "%PDF-1.7 not extracted")]
    });
    const context = await readWorkspaceCreationContext({ actorId: "context-test-unsupported", draftContextId });

    assert.equal(result.sourceReports[0]?.status, "unsupported");
    assert.equal((context.knowledge.documents ?? []).length, 0);
    assert.equal(context.knowledge.sources?.[0]?.status, "error");
  });
});

test("upload paths are bounded to the staged source and actor ownership is enforced", async () => {
  await withContext("context-test-safety", async (draftContextId) => {
    const file = fileSource("unsafe");
    await assert.rejects(() => stageWorkspaceCreationKnowledge({
      actorId: "context-test-safety",
      draftContextId,
      sources: [file],
      uploads: [upload(file.id, "../escape.md", "unsafe")]
    }), /relative|unsafe/i);

    const safe = await stageWorkspaceCreationKnowledge({
      actorId: "context-test-safety",
      draftContextId,
      sources: [file],
      uploads: [upload(file.id, "safe.md", "safe project context")]
    });
    assert.ok(safe.generationId);
    await assert.rejects(() => readWorkspaceCreationContext({ actorId: "another-actor", draftContextId }), /unavailable|expired/i);
  });
});

test("removing a source replaces the staged generation instead of reusing old project context", async () => {
  await withContext("context-test-removal", async (draftContextId) => {
    const file = fileSource("kept");
    await stageWorkspaceCreationKnowledge({
      actorId: "context-test-removal",
      draftContextId,
      sources: [websiteSource(), file],
      uploads: [upload(file.id, "kept.md", "kept source content")],
      websiteFetcher: websiteFetcher()
    });
    const replacement = await stageWorkspaceCreationKnowledge({
      actorId: "context-test-removal",
      draftContextId,
      sources: [file],
      uploads: [upload(file.id, "kept.md", "kept source content")]
    });
    const context = await readWorkspaceCreationContext({ actorId: "context-test-removal", draftContextId });

    assert.equal(replacement.reused, false);
    assert.deepEqual((context.knowledge.sources ?? []).map((source) => source.id), ["kept"]);
    assert.equal((context.knowledge.documents ?? []).some((document) => document.sourceId === "website"), false);
  });
});

test("pre-cancelled staging returns cancellation without claiming a ready corpus", async () => {
  await withContext("context-test-cancel", async (draftContextId) => {
    const controller = new AbortController();
    controller.abort();
    const source = websiteSource();
    const result = await stageWorkspaceCreationKnowledge({
      actorId: "context-test-cancel",
      draftContextId,
      sources: [source],
      signal: controller.signal,
      websiteFetcher: websiteFetcher()
    });
    assert.equal(result.runStatus, "cancelled");
    assert.equal(result.generationId, null);
  });
});

test("declaration-only source metadata is not promoted to Architect evidence", async () => {
  const { generateWorkspaceBlueprint } = await import("@/lib/agentos/application/workspace-architect");
  const source = fileSource("declared");
  const prompts: string[] = [];
  const result = await generateWorkspaceBlueprint({
    brief: "Create a workspace for Acme.",
    knowledge: { sources: [source], documents: [] }
  }, {
    modelExecutor: async (request) => {
      prompts.push(request.userPrompt);
      return { text: JSON.stringify({ workforce: { specialists: [] } }), runId: "declared-test", modelId: "test", runtime: "model-runtime" };
    }
  });
  assert.equal(result.blueprint.evidence.some((entry) => entry.kind === "knowledge-source"), false);
  assert.doesNotMatch(prompts[0] ?? "", /Project context\"/);
});
