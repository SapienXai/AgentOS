import { NextResponse } from "next/server";
import { z } from "zod";

import {
  readWorkspaceCreationFileWithinLimits,
  readWorkspaceCreationRequestBodyWithinLimit,
  validateWorkspaceCreationUploadMetadata,
  WORKSPACE_CREATION_UPLOAD_LIMITS,
  type WorkspaceCreationUpload
} from "@/lib/agentos/application/workspace-creation-context-service";
import {
  listActiveWorkspaceCreationRuns,
  startWorkspaceCreationRun
} from "@/lib/agentos/application/workspace-creation-run-service";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const jsonSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(200),
  brief: z.string().trim().min(1).max(12_000),
  draftContextId: z.string().uuid().nullable().optional(),
  mode: z.enum(["automatic", "review"]).default("automatic"),
  operatorConstraints: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
  materialization: z.unknown().optional(),
  sources: z.array(z.unknown()).max(24).default([])
}).strict();

const manifestEntry = z.object({
  sourceId: z.string().min(1).max(120),
  relativePath: z.string().min(1).max(400),
  fileName: z.string().max(200).optional()
}).strict();

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in permission) return permission.response;
  try {
    const contentLength = request.headers.get("content-length");
    if (contentLength !== null) {
      const normalized = contentLength.trim();
      const parsed = Number(normalized);
      if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(parsed) || parsed > WORKSPACE_CREATION_UPLOAD_LIMITS.maxRequestBytes) {
        throw new Error("Project context is too large for analysis.");
      }
    }

    let input: z.infer<typeof jsonSchema>;
    const uploads: WorkspaceCreationUpload[] = [];
    if (request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
      const body = await readWorkspaceCreationRequestBodyWithinLimit(request, WORKSPACE_CREATION_UPLOAD_LIMITS.maxRequestBytes);
      const formData = await new Request(request.url, { method: request.method, headers: request.headers, body }).formData();
      const manifest = z.array(manifestEntry).max(WORKSPACE_CREATION_UPLOAD_LIMITS.maxFiles, "Too many files selected.").parse(JSON.parse(String(formData.get("uploadManifest") ?? "[]")));
      const files = formData.getAll("files");
      if (files.some((value) => !(value instanceof File))) throw new Error("Uploaded project context contains an invalid file.");
      validateWorkspaceCreationUploadMetadata(files as File[], manifest);
      const base = jsonSchema.parse({
        idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
        brief: String(formData.get("brief") ?? ""),
        draftContextId: formData.get("draftContextId") || undefined,
        mode: formData.get("mode") || undefined,
        operatorConstraints: JSON.parse(String(formData.get("operatorConstraints") ?? "[]")),
        materialization: JSON.parse(String(formData.get("materialization") ?? '{"mode":"empty"}')),
        sources: JSON.parse(String(formData.get("sources") ?? "[]"))
      });
      input = base;
      let total = 0;
      for (const [index, value] of files.entries()) {
        const file = value as File;
        const bytes = await readWorkspaceCreationFileWithinLimits(
          file,
          Math.min(WORKSPACE_CREATION_UPLOAD_LIMITS.maxBytesPerFile, WORKSPACE_CREATION_UPLOAD_LIMITS.maxBytesTotal - total),
          request.signal
        );
        total += bytes.byteLength;
        uploads.push({ ...manifest[index], fileName: manifest[index].fileName || file.name, bytes });
      }
    } else {
      input = jsonSchema.parse(await request.json());
    }

    const run = await startWorkspaceCreationRun({ ...input, uploads, actorId: permission.actor.actorId });
    return NextResponse.json(redactSecrets(run), { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Unable to start workspace creation.") }, { status: 400 });
  }
}

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in permission) return permission.response;
  try {
    const runs = await listActiveWorkspaceCreationRuns(permission.actor.actorId);
    return NextResponse.json(redactSecrets({ runs }));
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Unable to load workspace creation runs.") }, { status: 400 });
  }
}
