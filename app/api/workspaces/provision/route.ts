import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getWorkspaceProvisioningRun,
  provisionWorkspaceFromBlueprint,
  WorkspaceProvisioningError
} from "@/lib/agentos/application/workspace-provisioning-service";
import { attachWorkspaceProvisioningRun } from "@/lib/agentos/application/workspace-creation-run-service";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const provisionRequestSchema = z.object({
  blueprint: z.unknown(),
  draftContextId: z.string().uuid().nullable().optional(),
  expectedKnowledgeGenerationId: z.string().trim().min(1).nullable().optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
  acceptDraft: z.boolean().default(false),
  compositionPlan: z.unknown().optional(),
  compositionPlanId: z.string().trim().min(1).max(160).nullable().optional(),
  compositionPlanFingerprint: z.string().regex(/^[a-f0-9]{64}$/i).nullable().optional(),
  creationRunId: z.string().uuid().nullable().optional()
}).strict();

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in permission) return permission.response;

  try {
    const parsed = provisionRequestSchema.parse(await request.json());
    const run = await provisionWorkspaceFromBlueprint({
      actorId: permission.actor.actorId,
      blueprint: parsed.blueprint,
      draftContextId: parsed.draftContextId ?? null,
      expectedKnowledgeGenerationId: parsed.expectedKnowledgeGenerationId ?? null,
      idempotencyKey: parsed.idempotencyKey,
      acceptDraft: parsed.acceptDraft,
      compositionPlan: parsed.compositionPlan,
      compositionPlanId: parsed.compositionPlanId ?? null,
      compositionPlanFingerprint: parsed.compositionPlanFingerprint ?? null
    });
    if (parsed.creationRunId) {
      await attachWorkspaceProvisioningRun({
        actorId: permission.actor.actorId,
        runId: parsed.creationRunId,
        provisioningRunId: run.runId
      });
    }
    return NextResponse.json(redactSecrets(run), { status: 202 });
  } catch (error) {
    const status = error instanceof WorkspaceProvisioningError ? error.statusCode : 400;
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to start workspace provisioning."), code: error instanceof WorkspaceProvisioningError ? error.code : "provisioning-request-invalid" },
      { status }
    );
  }
}

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in permission) return permission.response;

  const runId = new URL(request.url).searchParams.get("runId")?.trim() || "";
  if (!runId) return NextResponse.json({ error: "A provisioning run id is required." }, { status: 400 });

  try {
    const run = await getWorkspaceProvisioningRun({ actorId: permission.actor.actorId, runId });
    if (!run) return NextResponse.json({ error: "Provisioning run was not found." }, { status: 404 });
    return NextResponse.json(redactSecrets(run));
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to read workspace provisioning status.") },
      { status: 400 }
    );
  }
}
