import { NextResponse } from "next/server";

import { getWorkspaceIntelligenceStatus } from "@/lib/agentos/application/workspace-intelligence-status-service";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const permission = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in permission) return permission.response;
  try {
    const { workspaceId } = await context.params;
    const candidateCreationRunId = new URL(request.url).searchParams.get("creationRunId");
    const status = await getWorkspaceIntelligenceStatus({
      actorId: permission.actor.actorId,
      workspaceId,
      candidateCreationRunId
    });
    return NextResponse.json(redactSecrets(status));
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Unable to read workspace intelligence status.") }, { status: 400 });
  }
}
