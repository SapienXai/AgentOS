import { NextResponse } from "next/server";
import { z } from "zod";

import {
  stageWorkspaceCreationKnowledge,
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
    let draftContextId: string | null | undefined;
    let sources: unknown[];
    let uploads: WorkspaceCreationUpload[] = [];

    if (request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
      const formData = await request.formData();
      draftContextId = z.string().uuid().nullable().optional().parse(formData.get("draftContextId") || undefined);
      sources = z.array(z.unknown()).max(24).parse(JSON.parse(String(formData.get("sources") ?? "[]")));
      const manifest = z.array(uploadManifestSchema).max(120).parse(JSON.parse(String(formData.get("uploadManifest") ?? "[]")));
      const files = formData.getAll("files");
      if (files.length !== manifest.length) throw new Error("Uploaded project context metadata does not match the files supplied.");
      uploads = await Promise.all(files.map(async (value, index) => {
        if (!(value instanceof File)) throw new Error("Uploaded project context contains an invalid file.");
        return {
          ...manifest[index],
          fileName: manifest[index].fileName || value.name,
          bytes: Buffer.from(await value.arrayBuffer())
        };
      }));
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
