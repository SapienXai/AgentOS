const { parentPort, workerData } = require("node:worker_threads");
(async () => {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const load = pdfjs.getDocument({ data: workerData.bytes, isEvalSupported: false,
    enableXfa: false, useSystemFonts: false, disableFontFace: true, stopAtErrors: true });
  const pdf = await load.promise;
  if (pdf.numPages > 100) { parentPort.postMessage({ error: "The PDF exceeds 100 pages." }); return; }
  const pages = [];
  let used = 0;
  for (let number = 1; number <= pdf.numPages; number++) {
    const page = await pdf.getPage(number);
    const reader = page.streamTextContent().getReader();
    const lines = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const item of value.items) {
        if (typeof item.str !== "string") continue;
        const text = item.str + (item.hasEOL ? "\n" : " ");
        used += Buffer.byteLength(text);
        if (used > workerData.limit) { parentPort.postMessage({ error: "The extracted PDF text exceeds 512 KiB." }); return; }
        lines.push(text);
      }
    }
    pages.push(lines.join(""));
    page.cleanup();
  }
  const text = pages.join("\n\n");
  parentPort.postMessage(text.trim() ? { text } : { error: "No selectable text was found. Scanned PDFs require OCR before import." });
})().catch(() => parentPort.postMessage({ error: "The PDF could not be read. Check that it is valid and unlocked." }));
