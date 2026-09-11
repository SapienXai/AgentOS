import { NextResponse } from "next/server";

import { refreshWorkspaceCreationRun } from "@/lib/agentos/application/workspace-creation-run-service";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const permission = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in permission) return permission.response;
  try {
    const { runId } = await context.params;
    const run = await refreshWorkspaceCreationRun({ actorId: permission.actor.actorId, runId }, {});
    if (!run) return NextResponse.json({ error: "Workspace creation run was not found." }, { status: 404 });
    return NextResponse.json(redactSecrets(run), { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Unable to refresh project context.") }, { status: 400 });
  }
}
