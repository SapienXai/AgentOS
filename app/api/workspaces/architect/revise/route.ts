import { NextResponse } from "next/server";
import { z } from "zod";

import {
  reviseWorkspaceBlueprint,
  validateWorkspaceBlueprint
} from "@/lib/agentos/application/workspace-architect";
import { normalizeWorkspaceKnowledgeSources } from "@/lib/agentos/domains/workspace-knowledge";
import { normalizeWorkspaceMaterialization } from "@/lib/agentos/domains/workspace-materialization";
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
  knowledge: z.object({
    generationId: z.string().trim().max(200).nullable().optional(),
    sources: z.array(z.unknown()).max(24).default([]),
    documents: z.array(z.object({
      sourceId: z.string().trim().min(1).max(100),
      title: z.string().trim().max(160).optional(),
      summary: z.string().trim().max(600).optional(),
      content: z.string().max(1_200).optional(),
      contentLength: z.number().int().nonnegative().max(2_000_000).optional()
    }).strict()).max(12).default([])
  }).strict().optional()
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
    const knowledge = parsed.knowledge
      ? {
          generationId: parsed.knowledge.generationId,
          sources: normalizeWorkspaceKnowledgeSources(parsed.knowledge.sources),
          documents: parsed.knowledge.documents
        }
      : undefined;
    const instruction = parsed.instruction?.trim();
    const result = await reviseWorkspaceBlueprint(
      blueprint,
      {
        ...(instruction ? { brief: `${blueprint.brief}\n\nOperator revision: ${instruction}` } : {}),
        ...(parsed.operatorEdits
          ? { operatorEdits: parsed.operatorEdits as WorkspaceBlueprintRevisionInput["operatorEdits"] }
          : {}),
        ...(parsed.operatorConstraints ? { operatorConstraints: parsed.operatorConstraints } : {}),
        ...(knowledge ? { knowledge } : {}),
        materialization: normalizeWorkspaceMaterialization(blueprint.materialization)
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
