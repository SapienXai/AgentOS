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

const assignSchema = z.object({
  action: z.literal("assignOwner"),
  sessionKey: z.string().min(1).max(512),
  agentId: z.string().min(1).max(128)
});

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "sessions.use");
  if ("response" in permission) return permission.response;
  const snapshot = await getMissionControlSnapshot();
  return NextResponse.json(redactSecrets({
    availability: snapshot.nativeWork?.availability ?? null,
    executions: snapshot.nativeWork?.executions ?? [],
    worktrees: snapshot.nativeWork?.worktrees ?? []
  }), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "sessions.use");
  if ("response" in permission) return permission.response;
  let input: z.infer<typeof assignSchema>;
  try {
    input = assignSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Unable to assign session ownership.") }, { status: 400 });
  }
  const preflight = await requireAgentOsOpenClawPreflight(request, {
    operation: "session.assign-owner",
    method: "sessions.assignOwner",
    params: { key: input.sessionKey, owner: { type: "agent", id: input.agentId } },
    targetKind: "openclaw-session",
    targetId: input.sessionKey,
    securityClass: "privileged-mutation",
    executionPath: "gateway-native",
    productPermission: "sessions.use"
  });
  if ("response" in preflight) return preflight.response;
  try {
    const result = await getOpenClawAdapter().assignSessionOwner?.({ key: input.sessionKey, owner: { type: "agent", id: input.agentId } }, preflight.commandOptions);
    if (!result) throw new Error("sessions.assignOwner is not available in the current OpenClaw adapter.");
    invalidateMissionControlSnapshotCache();
    await recordAgentOsAuditEvent({ actor: preflight.actor, operation: "session.assign-owner", targetKind: "openclaw-session", targetId: input.sessionKey, result: "succeeded" }).catch(() => {});
    return NextResponse.json(redactSecrets(result), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await recordAgentOsAuditEvent({ actor: preflight.actor, operation: "session.assign-owner", targetKind: "openclaw-session", targetId: input.sessionKey, result: "failed" }).catch(() => {});
    return NextResponse.json({ error: redactErrorMessage(error, "OpenClaw rejected the ownership handoff.") }, { status: 400 });
  }
}
