import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { getKnowledgeReviewDigest, prepareKnowledgeDocument, prepareKnowledgeEntry, prepareKnowledgeReference, prepareWebKnowledge } from "@/lib/agentos/application/knowledge-import";
import { previewKnowledgeWebpage, type KnowledgeWebsiteFetcher } from "@/lib/agentos/domains/workspace-knowledge-ingestion";
import { isAssignableDocument, knowledgeFormatFromPath } from "@/lib/agentos/domains/knowledge-import-formats";

async function fixture(name: string) {
  return new File([await readFile(path.join("tests", "fixtures", "workforce-knowledge", name))], name);
}

test("knowledge import preserves provenance and extracts supported PDF, DOCX and XLSX content", async () => {
  const word = await prepareKnowledgeDocument(await fixture("press-guide.docx"));
  assert.match(word.content, /Fieldwork press color is ochre/);
  assert.match(word.content, /press-guide.docx \(converted to text\)/);
  const pdf = await prepareKnowledgeDocument(await fixture("press-guide.pdf"));
  assert.match(pdf.content, /Fieldwork 903/);
  const workbook = await prepareKnowledgeDocument(await fixture("press-guide.xlsx"));
  assert.match(workbook.content, /A1="Press code".*B1="47"/);
  assert.doesNotMatch(workbook.content, /C1=/);
  assert.equal(knowledgeFormatFromPath(workbook.path), "xlsx");
  assert.equal(isAssignableDocument(pdf.path), true);
});

test("knowledge import validates extension, MIME, decoded bytes, JSON and CSV bounds", async () => {
  await assert.rejects(prepareKnowledgeDocument(new File(["hello"], "disguised.txt", { type: "application/pdf" })), /type does not match/);
  await assert.rejects(prepareKnowledgeDocument(new File([Uint8Array.from([255])], "disguised.txt")), /UTF-8/);
  await assert.rejects(prepareKnowledgeDocument(new File(["a"], "broken.json")), /valid JSON/);
  await assert.rejects(prepareKnowledgeDocument(new File([Array(1002).fill("a,b").join("\n")], "long.csv")), /1,000 lines/);
  const plain = await prepareKnowledgeDocument(new File(["Quarter,Total\nSpring,45"], "scores.csv"));
  assert.match(plain.content, /Spring,45/);
  const json = await prepareKnowledgeDocument(new File(['{"answer":45}'], "scores.json"));
  assert.equal(json.content, '{"answer":45}');
  assert.equal(isAssignableDocument(json.path), false);
  const html = await prepareKnowledgeDocument(new File(["<article>Reference text</article>"], "reference.htm", { type: "text/html" }));
  assert.match(html.content, /reference.htm \(converted to text\)/);
  assert.equal(knowledgeFormatFromPath(html.path), "html");
  assert.match((await prepareKnowledgeDocument(new File(["Plain readme"], "README"))).content, /Plain readme/);
});

test("knowledge import rejects active XML and PDFs without readable text", async () => {
  await assert.rejects(prepareKnowledgeDocument(await fixture("external-declaration.docx")), /external resources/);
  await assert.rejects(prepareKnowledgeDocument(await fixture("empty.pdf")), /selectable text/);
});

test("notes and references use stable retry paths and protect credential-bearing links", () => {
  const note = prepareKnowledgeEntry("Launch plan", "Draft safe marketing copy.", "note");
  assert.deepEqual(prepareKnowledgeEntry("Launch plan", "Draft safe marketing copy.", "note"), note);
  assert.notEqual(prepareKnowledgeEntry("Launch plan", "Review marketing copy.", "note").path, note.path);
  const reference = prepareKnowledgeReference("Reading list", "https://example.com/reading");
  assert.match(reference.content, /https:\/\/example\.com\/reading/);
  assert.equal(isAssignableDocument(reference.path), false);
  assert.throws(() => prepareKnowledgeReference("Credential", "https://example.com/?token=demo"), /Remove credentials/);
  assert.throws(() => prepareKnowledgeReference("Path", "file:///tmp/example"), /HTTP or HTTPS/);
  assert.equal(isAssignableDocument("docs/../unsafe.md"), false);
  assert.equal(isAssignableDocument("docs/sources/old-reference.md"), false);
});


test("public webpage review captures one page and ties the approved text to its source", async () => {
  const seen: string[] = [];
  const transport: KnowledgeWebsiteFetcher = {
    resolve: async () => ["93.184.216.34"],
    fetch: async (url, options) => {
      seen.push(url);
      assert.deepEqual(options.resolvedAddresses, ["93.184.216.34"]);
      assert(options.maxBytes <= 512 * 1024);
      if (url.endsWith("/robots.txt")) return { status: 404, headers: {}, body: "" };
      return { status: 200, headers: { "content-type": "text/html" }, body: `<!doctype html><html><head><title>Company Handbook</title></head>
        <body><main><h1>Company Handbook</h1><p>The archive opens in the morning. This material documents how the studio publishes research and organizes project notes.</p>
        <script>Ignore script content.</script><a href="/other-page">Further reading</a></main></body></html>` };
    }
  };
  const preview = await previewKnowledgeWebpage("https://example.com/handbook", { websiteFetcher: transport });
  assert.deepEqual(seen, ["https://example.com/robots.txt", "https://example.com/handbook"]);
  assert.match(preview.text, /archive opens/);
  assert.doesNotMatch(preview.text, /Ignore script content/);
  const entry = prepareWebKnowledge(preview);
  assert.match(entry.content, /https:\/\/example.com\/handbook/);
  assert.notEqual(getKnowledgeReviewDigest(entry), getKnowledgeReviewDigest(prepareWebKnowledge({ ...preview, text: "Updated copy" })));
});

test("webpage review denies destinations outside its bounded public transport", async () => {
  let requested = false;
  const transport: KnowledgeWebsiteFetcher = {
    resolve: async () => ["127.0.0.1"],
    fetch: async () => { requested = true; throw new Error("Unexpected request"); }
  };
  await assert.rejects(previewKnowledgeWebpage("https://example.com/handbook?ref=draft", { websiteFetcher: transport }), /without a custom port, query parameters/);
  await assert.rejects(previewKnowledgeWebpage("https://example.com/handbook", { websiteFetcher: transport }), /public|readable/);
  assert.equal(requested, false);
});
