import { NextResponse } from "next/server";
import { z } from "zod";

import { generateWorkspaceBlueprint } from "@/lib/agentos/application/workspace-architect";
import { normalizeWorkspaceKnowledgeSources } from "@/lib/agentos/domains/workspace-knowledge";
import { normalizeWorkspaceMaterialization } from "@/lib/agentos/domains/workspace-materialization";
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
  mode: z.enum(["automatic", "review"]).default("automatic"),
  operatorConstraints: z.array(z.string().trim().min(1).max(300)).max(12).default([]),
  materialization: materializationSchema.default({ mode: "empty" }),
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
  }).strict().default({ sources: [], documents: [] })
}).strict();

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in permission) return permission.response;

  try {
    const parsed = architectRequestSchema.parse(await request.json());
    const materialization = normalizeWorkspaceMaterialization(parsed.materialization);
    const sources = normalizeWorkspaceKnowledgeSources(parsed.knowledge.sources);
    const result = await generateWorkspaceBlueprint({
      brief: parsed.brief,
      mode: parsed.mode,
      materialization,
      operatorConstraints: parsed.operatorConstraints,
      knowledge: {
        generationId: parsed.knowledge.generationId,
        sources,
        documents: parsed.knowledge.documents
      }
    });

    return NextResponse.json(redactSecrets(result));
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to design the workspace.") },
      { status: 400 }
    );
  }
}
