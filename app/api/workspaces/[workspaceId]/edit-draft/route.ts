import { NextResponse } from "next/server";

import { createWorkspaceEditDraft } from "@/lib/agentos/application/workspace-edit-draft";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: {
    params: Promise<{
      workspaceId: string;
    }>;
  }
) {
  const permission = await requireAgentOsProductPermission(_request, "workspace.manage");
  if ("response" in permission) return permission.response;

  try {
    const { workspaceId } = await context.params;
    const result = await createWorkspaceEditDraft(workspaceId);
    return NextResponse.json(redactSecrets(result));
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to create workspace edit draft.")
      },
      { status: 400 }
    );
  }
}
