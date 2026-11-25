import { createHash } from "node:crypto";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SaxesParser } from "saxes";
import { fromBuffer, type Entry } from "yauzl";

import {
  KNOWLEDGE_IMPORT_FORMATS, KNOWLEDGE_IMPORT_INPUT_BYTES, KNOWLEDGE_IMPORT_TEXT_BYTES,
  type KnowledgeImportFormat
} from "@/lib/agentos/domains/knowledge-import-formats";
import { redactSecretText } from "@/lib/security/redaction";

const maxPackageEntries = 2500;
const maxExpandedBytes = 8 * 1024 * 1024;
const maxRows = 1000;
const maxSheets = 12;
let activePdfImports = 0;

const mimeTypes: Record<KnowledgeImportFormat, string[]> = {
  md: ["text/markdown", "text/plain"], txt: ["text/plain"], csv: ["text/csv", "text/plain", "application/vnd.ms-excel"],
  json: ["application/json", "text/plain"], pdf: ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
};

function documentName(value: string) {
  return redactSecretText(value.normalize("NFC").replace(/[\\/\x00-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, " ").trim()).slice(0, 120);
}

function decodeText(bytes: Uint8Array) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.includes("\0")) throw new Error("Binary content");
    return text.replace(/\r\n?/g, "\n");
  } catch {
    throw new Error("Choose a UTF-8 text file in the selected format.");
  }
}

function checkText(text: string) {
  if (!text.trim()) throw new Error("The document contains no readable text.");
  if (Buffer.byteLength(text) > KNOWLEDGE_IMPORT_TEXT_BYTES) throw new Error("The extracted text exceeds 512 KiB. Split the document and try again.");
  return text;
}

export function prepareKnowledgeEntry(
  title: string, content: string, kind: KnowledgeImportFormat | "note" | "reference"
) {
  const label = documentName(title);
  if (!label) throw new Error("Enter a name for this source.");
  const slug = label.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "document";
  const body = checkText(content);
  const digest = createHash("sha256").update(label).update("\0").update(body).digest("hex").slice(0, 20);
  const extension = kind === "json" ? "json" : "md";
  return { path: `docs/library/${kind}/${slug}-${digest}.${extension}`, title: label, kind, content: body };
}

export function prepareKnowledgeReference(title: string, address: string) {
  let url: URL;
  try { url = new URL(address); } catch { throw new Error("Enter a valid website address."); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new Error("Enter an HTTP or HTTPS link without credentials.");
  }
  if (redactSecretText(url.href) !== url.href) throw new Error("Remove credentials from the link before saving.");
  return prepareKnowledgeEntry(title, `# ${documentName(title)}\n\n<${url.href}>\n`, "reference");
}

export async function prepareKnowledgeDocument(file: File, signal?: AbortSignal) {
  if (!file.size || file.size > KNOWLEDGE_IMPORT_INPUT_BYTES) throw new Error("Choose a file between 1 byte and 4 MiB.");
  const extension = file.name.split(".").at(-1)?.toLowerCase();
  const format = KNOWLEDGE_IMPORT_FORMATS.find(value => value === extension);
  if (!format || !file.name.includes(".")) throw new Error("This file format is unavailable for import.");
  if (file.type && file.type !== "application/octet-stream" && !mimeTypes[format].includes(file.type)) {
    throw new Error("The file type does not match its extension.");
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  signal?.throwIfAborted();
  let text: string;
  if (format === "pdf") {
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("Choose a valid PDF.");
    text = await readPdf(bytes, signal);
  } else if (format === "docx" || format === "xlsx") {
    if (bytes.length < 4 || bytes.readUInt16LE(0) !== 0x4b50) throw new Error("Choose a valid Office document.");
    text = await readOffice(bytes, format, signal);
  } else {
    text = decodeText(bytes);
    if (format === "json") {
      try { JSON.parse(text); } catch { throw new Error("The document is not valid JSON."); }
    }
    if (format === "csv" && text.split("\n").length > maxRows + 1) throw new Error("The CSV exceeds 1,000 lines. Split the table and try again.");
  }
  checkText(text);
  const title = file.name.slice(0, file.name.lastIndexOf("."));
  if (format === "md" || format === "json") return prepareKnowledgeEntry(title, text, format);
  // Fence imported text so it remains reference material when presented as Markdown.
  const longestFence = (text.match(/`{3,}/g) ?? []).reduce((length, run) => Math.max(length, run.length), 2);
  if (longestFence > 32) throw new Error("The document contains an unsupported text delimiter.");
  const fence = "`".repeat(longestFence + 1);
  return prepareKnowledgeEntry(title, `# ${documentName(title)}\n\nSource: ${documentName(file.name)} (converted to text).\n\n${fence}\n${text}\n${fence}\n`, format);
}

function readOfficeParts(bytes: Buffer, keep: (name: string) => boolean, signal?: AbortSignal) {
  return new Promise<Map<string, string>>((resolve, reject) => {
    fromBuffer(bytes, { lazyEntries: true, strictFileNames: true }, (error, zip) => {
      if (error || !zip) { reject(new Error("The Office package could not be opened.")); return; }
      const parts = new Map<string, string>();
      let expanded = 0;
      let done = false;
      const abort = () => fail(new Error("Import cancelled."));
      function fail(error: Error) {
        if (done) return;
        done = true;
        signal?.removeEventListener("abort", abort);
        zip?.close();
        reject(error);
      }
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      zip.on("error", () => fail(new Error("The Office package is malformed.")));
      zip.on("end", () => { done = true; signal?.removeEventListener("abort", abort); resolve(parts); });
      zip.on("entry", (entry: Entry) => {
        expanded += entry.uncompressedSize;
        if (expanded > maxExpandedBytes || /(?:vbaProject\.bin|\/activeX\/)/i.test(entry.fileName)) {
          fail(new Error("The Office package exceeds its expansion limit or contains active content."));
          return;
        }
        if (!keep(entry.fileName)) { zip.readEntry(); return; }
        if (parts.has(entry.fileName)) { fail(new Error("The Office package contains duplicate parts.")); return; }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream || done) { fail(new Error("An Office document part could not be read.")); return; }
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("error", () => fail(new Error("An Office document part is invalid.")));
          stream.on("end", () => {
            if (done) return;
            try { parts.set(entry.fileName, decodeText(Buffer.concat(chunks))); }
            catch (error) { fail(error as Error); return; }
            zip.readEntry();
          });
        });
      });
      if (zip.entryCount > maxPackageEntries) { fail(new Error("The Office package has too many parts.")); return; }
      zip.readEntry();
    });
  });
}

function parseXml(text: string, events: {
  open: (name: string, attributes: Record<string, string>) => void;
  text: (value: string) => void;
  close: (name: string) => void;
}) {
  const parser = new SaxesParser();
  parser.on("doctype", () => { throw new Error("Office documents with XML declarations for external resources are unavailable."); });
  parser.on("error", () => { throw new Error("The Office document contains invalid XML."); });
  parser.on("opentag", tag => events.open(tag.name.split(":").at(-1)!, tag.attributes));
  parser.on("text", events.text);
  parser.on("closetag", tag => events.close(tag.name.split(":").at(-1)!));
  parser.write(text).close();
}

async function readOffice(bytes: Buffer, format: "docx" | "xlsx", signal?: AbortSignal) {
  if (format === "docx") {
    const parts = await readOfficeParts(bytes, name => name === "word/document.xml", signal);
    const main = parts.get("word/document.xml");
    if (!main) throw new Error("The Word file has no document body.");
    let inText = false;
    const output: string[] = [];
    parseXml(main, {
      open: name => {
        if (name === "t") inText = true;
        if (name === "tab" || name === "br") output.push(name === "tab" ? "\t" : "\n");
      },
      text: value => { if (inText) output.push(value); },
      close: name => {
        if (name === "t") inText = false;
        if (name === "p") output.push("\n");
      }
    });
    return output.join("");
  }
  const sheetPattern = /^xl\/worksheets\/sheet\d+\.xml$/;
  const parts = await readOfficeParts(bytes, name => name === "xl/sharedStrings.xml" || sheetPattern.test(name), signal);
  const shared: string[] = [];
  let captured = "";
  let inText = false;
  const sharedPart = parts.get("xl/sharedStrings.xml");
  if (sharedPart) parseXml(sharedPart, {
    open: name => { if (name === "si") captured = ""; if (name === "t") inText = true; },
    text: value => { if (inText) captured += value; },
    close: name => { if (name === "t") inText = false; if (name === "si") shared.push(captured); }
  });
  const sheets = [...parts].filter(([name]) => sheetPattern.test(name)).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true }));
  if (!sheets.length || sheets.length > maxSheets) throw new Error("Choose a workbook with one to twelve standard worksheets.");
  const result: string[] = [];
  let rowCount = 0;
  let textSize = 0;
  for (const [sheet, xml] of sheets) {
    result.push(sheet.split("/").at(-1)!.replace(".xml", ""));
    let row: string[] = [];
    let address = "";
    let type = "";
    let formula = false;
    parseXml(xml, {
      open: (name, attrs) => {
        if (name === "row") row = [];
        if (name === "c") {
          address = /^[A-Z]{1,3}\d{1,7}$/.test(attrs.r ?? "") ? attrs.r : "";
          type = attrs.t ?? ""; captured = ""; formula = false;
        }
        if (name === "v" || name === "t") inText = true;
        if (name === "f") formula = true;
      },
      text: value => { if (inText) captured += value; },
      close: name => {
        if (name === "v" || name === "t") inText = false;
        if (name === "c" && captured && !formula) {
          const value = type === "s" ? shared[Number(captured)] : captured;
          if (value !== undefined) {
            textSize += Buffer.byteLength(value) + 16;
            if (textSize > KNOWLEDGE_IMPORT_TEXT_BYTES) throw new Error("The extracted workbook text exceeds 512 KiB.");
            row.push((address ? address + "=" : "") + JSON.stringify(value));
          }
        }
        if (name === "row") {
          if (++rowCount > maxRows) throw new Error("The workbook exceeds 1,000 rows. Split the table and try again.");
          if (row.length) result.push(row.join("  "));
        }
      }
    });
  }
  if (result.length === sheets.length) throw new Error("The workbook contains no supported cell values.");
  return result.join("\n");
}

async function readPdf(bytes: Buffer, signal?: AbortSignal) {
  if (activePdfImports >= 2) throw new Error("Other PDFs are being imported. Try again in a moment.");
  activePdfImports++;
  try {
    return await extractPdf(bytes, signal);
  } finally {
    activePdfImports--;
  }
}

function extractPdf(bytes: Buffer, signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    // PDF.js runs off the request thread with a hard deadline and a bounded heap.
    // It receives only uploaded bytes and has no URL or rendering entry point.
    const workerPath = path.resolve(process.cwd(), "lib/agentos/application/knowledge-pdf-worker.cjs");
    // Load the traced worker as a Node file. PDF.js resolves its own module worker relative to its package.
    const worker = new Worker(pathToFileURL(workerPath), {
      workerData: { bytes: new Uint8Array(bytes), limit: KNOWLEDGE_IMPORT_TEXT_BYTES },
      resourceLimits: { maxOldGenerationSizeMb: 128 }, stdout: true, stderr: true
    });
    worker.stdout.resume();
    worker.stderr.resume();
    let done = false;
    const finish = (error?: string, content?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      void worker.terminate().finally(() => {
        if (error) reject(new Error(error)); else resolve(content ?? "");
      });
    };
    const abort = () => finish("Import cancelled.");
    const timeout = setTimeout(() => finish("PDF extraction exceeded 10 seconds. Split the document and try again."), 10_000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    worker.once("error", () => finish("The PDF could not be processed within the import limits."));
    worker.once("exit", () => finish("The PDF could not be processed within the import limits."));
    worker.once("message", ({ error, text }: { error?: string; text?: string }) => finish(error, text));
  });
}
