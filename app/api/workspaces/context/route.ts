import { NextResponse } from "next/server";
import { z } from "zod";

import {
  stageWorkspaceCreationKnowledge,
  readWorkspaceCreationFileWithinLimits,
  readWorkspaceCreationRequestBodyWithinLimit,
  validateWorkspaceCreationUploadMetadata,
  WORKSPACE_CREATION_UPLOAD_LIMITS,
  type WorkspaceCreationUpload
} from "@/lib/agentos/application/workspace-creation-context-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jsonRequestSchema = z.object({
  draftContextId: z.string().uuid().nullable().optional(),
  sources: z.array(z.unknown()).max(24).default([])
}).strict();

const uploadManifestSchema = z.object({
  sourceId: z.string().min(1).max(120),
  relativePath: z.string().min(1).max(400),
  fileName: z.string().max(200).optional()
}).strict();

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in permission) return permission.response;

  try {
    const contentLengthHeader = request.headers.get("content-length");
    if (contentLengthHeader !== null) {
      const normalizedContentLength = contentLengthHeader.trim();
      const contentLength = Number(normalizedContentLength);
      if (!/^\d+$/.test(normalizedContentLength) || !Number.isSafeInteger(contentLength) || contentLength > WORKSPACE_CREATION_UPLOAD_LIMITS.maxRequestBytes) {
        throw new Error("Project context is too large for analysis.");
      }
    }

    let draftContextId: string | null | undefined;
    let sources: unknown[];
    let uploads: WorkspaceCreationUpload[] = [];

    if (request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
      const body = await readWorkspaceCreationRequestBodyWithinLimit(request, WORKSPACE_CREATION_UPLOAD_LIMITS.maxRequestBytes);
      const formData = await new Request(request.url, { method: request.method, headers: request.headers, body }).formData();
      draftContextId = z.string().uuid().nullable().optional().parse(formData.get("draftContextId") || undefined);
      sources = z.array(z.unknown()).max(24).parse(JSON.parse(String(formData.get("sources") ?? "[]")));
      const manifest = z.array(uploadManifestSchema).max(WORKSPACE_CREATION_UPLOAD_LIMITS.maxFiles, "Too many files selected.").parse(JSON.parse(String(formData.get("uploadManifest") ?? "[]")));
      const files = formData.getAll("files");
      if (files.some((value) => !(value instanceof File))) throw new Error("Uploaded project context contains an invalid file.");
      validateWorkspaceCreationUploadMetadata(files as File[], manifest);
      let actualTotalBytes = 0;
      uploads = [];
      for (const [index, value] of files.entries()) {
        const file = value as File;
        const bytes = await readWorkspaceCreationFileWithinLimits(
          file,
          Math.min(WORKSPACE_CREATION_UPLOAD_LIMITS.maxBytesPerFile, WORKSPACE_CREATION_UPLOAD_LIMITS.maxBytesTotal - actualTotalBytes),
          request.signal
        );
        actualTotalBytes += bytes.byteLength;
        uploads.push({
          ...manifest[index],
          fileName: manifest[index].fileName || file.name,
          bytes
        });
      }
    } else {
      const parsed = jsonRequestSchema.parse(await request.json());
      draftContextId = parsed.draftContextId;
      sources = parsed.sources;
    }

    const result = await stageWorkspaceCreationKnowledge({
      actorId: permission.actor.actorId,
      draftContextId,
      sources,
      uploads,
      signal: request.signal
    });
    return NextResponse.json(redactSecrets(result));
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to stage project context.") },
      { status: 400 }
    );
  }
}
