import { NextResponse } from "next/server";
import { z } from "zod";

import {
  executeWorkerMemoryAction
} from "@/lib/openclaw/application/native-memory-service";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.object({
  action: z.enum(["backfill", "reset", "resetGroundedShortTerm", "repairDreamingArtifacts", "dedupeDreamDiary"]),
  confirmed: z.boolean().optional()
}).strict();

const actionMethods = {
  backfill: "doctor.memory.backfillDreamDiary",
  reset: "doctor.memory.resetDreamDiary",
  resetGroundedShortTerm: "doctor.memory.resetGroundedShortTerm",
  repairDreamingArtifacts: "doctor.memory.repairDreamingArtifacts",
  dedupeDreamDiary: "doctor.memory.dedupeDreamDiary"
} as const;

export async function POST(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await context.params;
  let input: z.infer<typeof actionSchema>;
  try {
    input = actionSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Invalid native memory action.") }, { status: 400 });
  }

  if (["reset", "resetGroundedShortTerm", "repairDreamingArtifacts", "dedupeDreamDiary"].includes(input.action) && input.confirmed !== true) {
    return NextResponse.json({ error: "This native memory action requires explicit confirmation." }, { status: 400 });
  }

  const method = actionMethods[input.action];
  const preflight = await requireAgentOsOpenClawPreflight(request, {
    operation: `memory.${input.action}`,
    method,
    params: { agentId },
    targetKind: "agent-memory",
    targetId: agentId,
    securityClass: "privileged-mutation",
    executionPath: "gateway-native",
    productPermission: "agents.manage"
  });
  if ("response" in preflight) return preflight.response;

  const actionResult = await executeWorkerMemoryAction(agentId, input.action, {
    commandOptions: preflight.commandOptions
  });
  const auditResult = actionResult.outcome === "succeeded"
    ? "succeeded"
    : actionResult.outcome === "unknown"
      ? "unknown"
      : "failed";
  await recordAgentOsAuditEvent({
    actor: preflight.actor,
    operation: `memory.${input.action}`,
    targetKind: "agent-memory",
    targetId: agentId,
    result: auditResult
  }).catch(() => {});

  if (actionResult.outcome === "succeeded") {
    return NextResponse.json(redactSecrets(actionResult), {
      headers: { "Cache-Control": "no-store" }
    });
  }

  return NextResponse.json(redactSecrets(actionResult), {
    status: actionResult.outcome === "unknown" ? 409 : 400,
    headers: { "Cache-Control": "no-store" }
  });
}
