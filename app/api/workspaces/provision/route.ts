import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getWorkspaceProvisioningRun,
  provisionWorkspaceFromBlueprint,
  WorkspaceProvisioningError
} from "@/lib/agentos/application/workspace-provisioning-service";
import {
  attachWorkspaceProvisioningRun,
  getWorkspaceCreationProvisioningIntent
} from "@/lib/agentos/application/workspace-creation-run-service";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
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
  creationRunId: z.string().uuid().nullable().optional(),
  environmentPreparation: z.object({
    requested: z.literal(true),
    profileId: z.string().trim().min(1).max(200)
  }).strict().nullable().optional(),
  retryEnvironmentPreparation: z.boolean().optional()
}).strict();

export async function POST(request: Request) {
  const authorization = await requireAgentOsOpenClawPreflight(request, {
    operation: "workspace.provision",
    method: "agents.create",
    targetKind: "workspace",
    securityClass: "privileged-mutation",
    executionPath: "gateway-or-verified-cli",
    productPermission: "workspace.manage"
  });
  if ("response" in authorization) return authorization.response;

  try {
    const parsed = provisionRequestSchema.parse(await request.json());
    const certified = parsed.creationRunId
      ? await getWorkspaceCreationProvisioningIntent({ actorId: authorization.actor.actorId, runId: parsed.creationRunId, acceptDraft: parsed.acceptDraft })
      : null;
    if (parsed.creationRunId && !certified) return NextResponse.json({ error: "Workspace creation run was not found." }, { status: 404 });
    if (certified && (!certified.readiness.provisionable || !certified.idempotencyKey || !certified.run.result || typeof certified.run.result !== "object" || !("blueprint" in certified.run.result))) {
      return NextResponse.json({ error: certified.readiness.message, code: certified.readiness.reasonCode }, { status: 409 });
    }
    const canonicalResult = certified?.run.result && typeof certified.run.result === "object" && "blueprint" in certified.run.result
      ? certified.run.result as { blueprint: unknown; freshness?: { currentGenerationId?: string | null } }
      : null;
    const run = await provisionWorkspaceFromBlueprint({
      actorId: authorization.actor.actorId,
      blueprint: canonicalResult?.blueprint ?? parsed.blueprint,
      draftContextId: certified?.run.draftContextId ?? parsed.draftContextId ?? null,
      expectedKnowledgeGenerationId: canonicalResult?.freshness?.currentGenerationId ?? parsed.expectedKnowledgeGenerationId ?? null,
      idempotencyKey: certified?.idempotencyKey ?? parsed.idempotencyKey,
      acceptDraft: parsed.acceptDraft || Boolean(certified && ["quick", "fast", "medium"].includes(certified.run.input.profile ?? "")),
      compositionPlan: undefined,
      compositionPlanId: certified?.readiness.planId ?? parsed.compositionPlanId ?? null,
      compositionPlanFingerprint: certified?.readiness.planFingerprint ?? parsed.compositionPlanFingerprint ?? null,
      creationRunId: parsed.creationRunId ?? null,
      environmentPreparation: parsed.environmentPreparation ?? null,
      retryEnvironmentPreparation: parsed.retryEnvironmentPreparation === true
    }, {
      gatewayOptions: authorization.commandOptions
    });
    if (parsed.creationRunId) {
      await attachWorkspaceProvisioningRun({
        actorId: authorization.actor.actorId,
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
  // This endpoint may resume an active provisioning run, so it is a recovery
  // trigger rather than a passive status read and needs mutation proof.
  const authorization = await requireAgentOsOpenClawPreflight(request, {
    operation: "workspace.provision.recover",
    method: "agents.create",
    targetKind: "workspace",
    securityClass: "privileged-mutation",
    executionPath: "gateway-or-verified-cli",
    productPermission: "workspace.manage"
  });
  if ("response" in authorization) return authorization.response;

  const runId = new URL(request.url).searchParams.get("runId")?.trim() || "";
  if (!runId) return NextResponse.json({ error: "A provisioning run id is required." }, { status: 400 });

  try {
    const run = await getWorkspaceProvisioningRun(
      { actorId: authorization.actor.actorId, runId },
      { gatewayOptions: authorization.commandOptions }
    );
    if (!run) return NextResponse.json({ error: "Provisioning run was not found." }, { status: 404 });
    return NextResponse.json(redactSecrets(run));
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to read workspace provisioning status.") },
      { status: 400 }
    );
  }
}
