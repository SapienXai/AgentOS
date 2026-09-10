import { NextResponse } from "next/server";

import { getWorkspaceCreationRun } from "@/lib/agentos/application/workspace-creation-run-service";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  const permission = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in permission) return permission.response;
  try {
    const { runId } = await context.params;
    const raw = new URL(request.url).searchParams.get("afterSequence");
    const afterSequence = raw === null ? undefined : Number(raw);
    const run = await getWorkspaceCreationRun({ actorId: permission.actor.actorId, runId, afterSequence });
    if (!run) return NextResponse.json({ error: "Workspace creation run was not found." }, { status: 404 });
    return NextResponse.json(redactSecrets(run));
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Unable to load workspace creation run.") }, { status: 400 });
  }
}
