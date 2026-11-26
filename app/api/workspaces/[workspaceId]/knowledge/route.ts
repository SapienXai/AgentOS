import { NextResponse } from "next/server";
import { z } from "zod";

import { getKnowledgeReviewDigest, prepareKnowledgeDocument, prepareKnowledgeEntry, prepareKnowledgeReference, prepareWebKnowledge } from "@/lib/agentos/application/knowledge-import";
import { previewKnowledgeWebpage } from "@/lib/agentos/domains/workspace-knowledge-ingestion";
import { KNOWLEDGE_IMPORT_INPUT_BYTES } from "@/lib/agentos/domains/knowledge-import-formats";
import { readWorkspaceManagedFile, writeWorkspaceManagedFile } from "@/lib/openclaw/application/workspace-file-service";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";

const maxRequestBytes = KNOWLEDGE_IMPORT_INPUT_BYTES + 64 * 1024;
const publicUrl = z.string().trim().min(1).max(4096);
let activeWebPreviews = 0;
const textInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("note"), title: z.string().trim().min(1).max(120), content: z.string().min(1).max(512 * 1024) }).strict(),
  z.object({ kind: z.literal("reference"), title: z.string().trim().min(1).max(120), url: publicUrl }).strict(),
  z.object({ kind: z.literal("web-preview"), url: publicUrl }).strict(),
  z.object({ kind: z.literal("web"), url: publicUrl, digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
]);

async function boundedRequest(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Choose a source to add.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxRequestBytes) {
        void reader.cancel().catch(() => undefined);
        throw new Error("The upload exceeds the request size limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Response(Buffer.concat(chunks), {
    headers: { "Content-Type": request.headers.get("Content-Type") ?? "" }
  });
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const authorized = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in authorized) return authorized.response;

  try {
    const { workspaceId } = await context.params;
    const body = await boundedRequest(request);
    const contentType = body.headers.get("Content-Type") ?? "";
    let entry;
    if (contentType.startsWith("multipart/form-data;")) {
      const form = await body.formData();
      const file = form.get("document");
      if (!(file instanceof File) || form.getAll("document").length !== 1) throw new Error("Choose one document.");
      entry = await prepareKnowledgeDocument(file, request.signal);
    } else if (contentType.startsWith("application/json")) {
      const input = textInput.parse(await body.json());
      if (input.kind === "web-preview" || input.kind === "web") {
        // Resolve the local managed workspace before doing any outbound work.
        await readWorkspaceManagedFile({ workspaceId, path: "docs/brief.md" });
        if (activeWebPreviews >= 2) return NextResponse.json({ error: "Another webpage is being prepared. Try again shortly." }, { status: 429 });
        activeWebPreviews++;
        try {
          const page = await previewKnowledgeWebpage(input.url, { signal: request.signal });
          entry = prepareWebKnowledge(page);
          const digest = getKnowledgeReviewDigest(entry);
          if (input.kind === "web-preview") {
            return NextResponse.json(redactSecrets({ preview: { title: entry.title, url: page.url, text: page.text, digest } }), {
              headers: { "Cache-Control": "private, no-store" }
            });
          }
          if (input.digest !== digest) {
            return NextResponse.json({ error: "The page changed since preview. Review the updated text before saving." }, { status: 409 });
          }
        } finally {
          activeWebPreviews--;
        }
      } else {
        entry = input.kind === "note" ? prepareKnowledgeEntry(input.title, input.content, "note") : prepareKnowledgeReference(input.title, input.url);
      }
    } else {
      throw new Error("The source request is in an unsupported format.");
    }
    // Managed-file read resolves an allowed new path without writing it. An
    // identical retry returns the current document, preserving any later edits.
    const current = await readWorkspaceManagedFile({ workspaceId, path: entry.path });
    const result = current.file.exists ? current : await writeWorkspaceManagedFile({ workspaceId, path: entry.path, content: entry.content });
    return NextResponse.json(redactSecrets({ file: result.file, title: entry.title, kind: entry.kind, disposition: current.file.exists ? "already-saved" : "added" }), {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) {
    const message = redactErrorMessage(error, "Could not add this source.");
    return NextResponse.json({ error: message }, { status: message.includes("exceeds") ? 413 : 400 });
  }
}
