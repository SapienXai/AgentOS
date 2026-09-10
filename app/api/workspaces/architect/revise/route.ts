import { NextResponse } from "next/server";
import { z } from "zod";

import {
  reviseWorkspaceBlueprint,
  validateWorkspaceBlueprint
} from "@/lib/agentos/application/workspace-architect";
import { normalizeWorkspaceMaterialization } from "@/lib/agentos/domains/workspace-materialization";
import { readWorkspaceCreationContext } from "@/lib/agentos/application/workspace-creation-context-service";
import type {
  WorkspaceBlueprint,
  WorkspaceBlueprintRevisionInput
} from "@/lib/agentos/domains/workspace-blueprint";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const revisionRequestSchema = z.object({
  blueprint: z.unknown(),
  draftContextId: z.string().uuid().optional(),
  instruction: z.string().trim().max(2_000).optional(),
  operatorEdits: z.object({
    identity: z.object({
      name: z.string().trim().min(1).max(100).optional()
    }).strict().optional(),
    workforce: z.object({
      primaryAgent: z.object({
        name: z.string().trim().min(1).max(100).optional()
      }).strict().optional()
    }).strict().optional()
  }).strict().optional(),
  operatorConstraints: z.array(z.string().trim().min(1).max(300)).max(12).optional(),
}).strict();

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in permission) return permission.response;

  try {
    const parsed = revisionRequestSchema.parse(await request.json());
    const validation = validateWorkspaceBlueprint(parsed.blueprint);
    if (!validation.valid) {
      throw new Error("The workspace draft is no longer valid. Refresh the draft and try again.");
    }

    const blueprint = parsed.blueprint as WorkspaceBlueprint;
    const stagedContext = parsed.draftContextId
      ? await readWorkspaceCreationContext({ actorId: permission.actor.actorId, draftContextId: parsed.draftContextId })
      : undefined;
    const instruction = parsed.instruction?.trim();
    const result = await reviseWorkspaceBlueprint(
      blueprint,
      {
        ...(instruction ? { revisionInstruction: instruction } : {}),
        ...(parsed.operatorEdits
          ? { operatorEdits: parsed.operatorEdits as WorkspaceBlueprintRevisionInput["operatorEdits"] }
          : {}),
        ...(parsed.operatorConstraints ? { operatorConstraints: parsed.operatorConstraints } : {}),
        ...(stagedContext ? { knowledge: stagedContext.knowledge } : {}),
        materialization: normalizeWorkspaceMaterialization(blueprint.materialization)
      }, {
        signal: request.signal,
        ...(stagedContext ? { currentKnowledgeGenerationId: stagedContext.generationId } : {})
      }
    );

    return NextResponse.json(redactSecrets(result));
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to revise the workspace draft.") },
      { status: 400 }
    );
  }
}
