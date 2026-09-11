import { NextResponse } from "next/server";
import { z } from "zod";

import { reviseWorkspaceCreationRun } from "@/lib/agentos/application/workspace-creation-run-service";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const revisionRequestSchema = z.object({
  instruction: z.string().trim().max(2_000).optional(),
  operatorEdits: z.object({
    identity: z.object({ name: z.string().trim().min(1).max(100).optional() }).strict().optional(),
    workforce: z.object({
      primaryAgent: z.object({ name: z.string().trim().min(1).max(100).optional() }).strict().optional()
    }).strict().optional()
  }).strict().optional(),
  operatorConstraints: z.array(z.string().trim().min(1).max(300)).max(12).optional()
}).strict();

export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const permission = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in permission) return permission.response;
  try {
    const { runId } = await context.params;
    const parsed = revisionRequestSchema.parse(await request.json());
    const run = await reviseWorkspaceCreationRun({
      actorId: permission.actor.actorId,
      runId,
      instruction: parsed.instruction,
      operatorEdits: parsed.operatorEdits,
      operatorConstraints: parsed.operatorConstraints,
      signal: request.signal
    });
    if (!run) return NextResponse.json({ error: "Workspace creation run was not found." }, { status: 404 });
    return NextResponse.json(redactSecrets(run));
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to revise the workspace draft.") },
      { status: 400 }
    );
  }
}
