import { NextResponse } from "next/server";
import { z } from "zod";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { getMissionControlSnapshot, invalidateMissionControlSnapshotCache } from "@/lib/openclaw/application/mission-control-service";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), taskId: z.string().min(1).max(128), mode: z.enum(["worktree", "local", "cloud", "session"]).optional(), cloudProfileId: z.string().min(1).max(128).optional() }),
  z.object({ action: z.literal("dismiss"), taskId: z.string().min(1).max(128), reason: z.string().max(1024).optional() })
]);

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "tasks.use");
  if ("response" in permission) return permission.response;
  try {
    const snapshot = await getMissionControlSnapshot();
    return NextResponse.json(redactSecrets({
      availability: snapshot.nativeWork?.availability ?? null,
      suggestions: snapshot.nativeWork?.suggestions ?? [],
      issues: snapshot.nativeWork?.issues ?? []
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Suggested work is unavailable.") }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "tasks.use");
  if ("response" in permission) return permission.response;

  let input: z.infer<typeof mutationSchema>;
  try {
    input = mutationSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Unable to review suggested work.") }, { status: 400 });
  }

  const method = input.action === "accept" ? "taskSuggestions.accept" : "taskSuggestions.dismiss";
  const preflight = await requireAgentOsOpenClawPreflight(request, {
    operation: `task-suggestions.${input.action}`,
    method,
    params: input.action === "accept"
      ? { taskId: input.taskId, mode: input.mode, cloudProfileId: input.cloudProfileId }
      : { taskId: input.taskId, reason: input.reason },
    targetKind: "task-suggestion",
    targetId: input.taskId,
    securityClass: "privileged-mutation",
    executionPath: "gateway-native",
    productPermission: "tasks.use"
  });
  if ("response" in preflight) return preflight.response;

  try {
    const adapter = getOpenClawAdapter();
    const result = input.action === "accept"
      ? await adapter.acceptTaskSuggestion?.({ taskId: input.taskId, mode: input.mode, cloudProfileId: input.cloudProfileId }, preflight.commandOptions)
      : await adapter.dismissTaskSuggestion?.({ taskId: input.taskId, reason: input.reason }, preflight.commandOptions);
    if (!result) throw new Error(`${method} is not available in the current OpenClaw adapter.`);
    invalidateMissionControlSnapshotCache();
    await recordAgentOsAuditEvent({ actor: preflight.actor, operation: `task-suggestions.${input.action}`, targetKind: "task-suggestion", targetId: input.taskId, result: "succeeded" }).catch(() => {});
    return NextResponse.json(redactSecrets({ action: input.action, result }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await recordAgentOsAuditEvent({ actor: preflight.actor, operation: `task-suggestions.${input.action}`, targetKind: "task-suggestion", targetId: input.taskId, result: "failed" }).catch(() => {});
    return NextResponse.json({ error: redactErrorMessage(error, "OpenClaw rejected the suggested work action.") }, { status: 400 });
  }
}
