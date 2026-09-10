import { NextResponse } from "next/server";
import { z } from "zod";

import { generateWorkspaceBlueprint } from "@/lib/agentos/application/workspace-architect";
import { normalizeWorkspaceMaterialization } from "@/lib/agentos/domains/workspace-materialization";
import { readWorkspaceCreationContext } from "@/lib/agentos/application/workspace-creation-context-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const materializationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("empty") }).strict(),
  z.object({ mode: z.literal("clone"), repoUrl: z.string().min(1).max(2_000) }).strict(),
  z.object({ mode: z.literal("existing"), existingPath: z.string().min(1).max(2_000) }).strict()
]);

const architectRequestSchema = z.object({
  brief: z.string().trim().min(1).max(12_000),
  draftContextId: z.string().uuid().optional(),
  mode: z.enum(["automatic", "review"]).default("automatic"),
  operatorConstraints: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
  materialization: materializationSchema.default({ mode: "empty" })
}).strict();

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in permission) return permission.response;

  try {
    const parsed = architectRequestSchema.parse(await request.json());
    const materialization = normalizeWorkspaceMaterialization(parsed.materialization);
    const stagedContext = parsed.draftContextId
      ? await readWorkspaceCreationContext({ actorId: permission.actor.actorId, draftContextId: parsed.draftContextId })
      : undefined;
    const result = await generateWorkspaceBlueprint({
      brief: parsed.brief,
      mode: parsed.mode,
      materialization,
      operatorConstraints: parsed.operatorConstraints,
      ...(stagedContext ? { knowledge: stagedContext.knowledge } : {})
    }, {
      signal: request.signal,
      ...(stagedContext ? { currentKnowledgeGenerationId: stagedContext.generationId } : {})
    });

    return NextResponse.json(redactSecrets(result));
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to design the workspace.") },
      { status: 400 }
    );
  }
}
