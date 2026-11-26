import { NextResponse } from "next/server";
import { z } from "zod";

import {
  listWorkspaceManagedFiles,
  readWorkspaceManagedFile,
  writeWorkspaceManagedFile,
  WorkspaceFileConflictError
} from "@/lib/openclaw/application/workspace-file-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fileWriteSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  revision: z.string().regex(/^[a-f0-9]{64}$/).optional()
});

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const permission = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in permission) return permission.response;

  try {
    const { workspaceId } = await context.params;
    const url = new URL(request.url);
    const filePath = url.searchParams.get("path")?.trim();

    if (filePath) {
      const file = await readWorkspaceManagedFile({
        workspaceId,
        path: filePath
      });

      return NextResponse.json(redactSecrets(file), { headers: { "Cache-Control": "private, no-store" } });
    }

    const files = await listWorkspaceManagedFiles(workspaceId);
    return NextResponse.json(redactSecrets(files), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to read workspace files.")
      },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const permission = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in permission) return permission.response;

  try {
    const { workspaceId } = await context.params;
    const input = fileWriteSchema.parse(await request.json());
    const file = await writeWorkspaceManagedFile({
      workspaceId,
      path: input.path,
      content: input.content,
      revision: input.revision
    });

    return NextResponse.json(redactSecrets(file), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = redactErrorMessage(error, "Unable to save workspace file.");
    const status = error instanceof WorkspaceFileConflictError ? 409 : message.includes("exceeds") ? 413 : 400;

    return NextResponse.json(
      {
        error: message
      },
      { status }
    );
  }
}
