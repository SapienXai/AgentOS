import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

import { prepareKnowledgeDocument, prepareKnowledgeEntry, prepareKnowledgeReference } from "@/lib/agentos/application/knowledge-import";
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
