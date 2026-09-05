import { NextResponse } from "next/server";
import { z } from "zod";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  dispatchSession,
  moveSession,
  readSessionPlacement,
  reclaimSession,
  ExecutionTopologyUnavailableError
} from "@/lib/openclaw/application/execution-topology-service";
import {
  buildNativeMutationFailureResponse
} from "@/lib/openclaw/application/native-mutation-service";
import { placementTargetToDispatchInput } from "@/lib/openclaw/domains/execution-topology";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { canAgentOsActorUseProductPermission, requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { requireSameOriginMutation } from "@/lib/security/instance-protection-route";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const destinationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("automatic") }),
  z.object({ kind: z.literal("gateway") }),
  z.object({ kind: z.literal("device"), deviceId: z.string().trim().min(1).max(256) }),
  z.object({ kind: z.literal("profile"), profileId: z.string().trim().min(1).max(128), machineClass: z.string().trim().min(1).max(128).optional() })
]);

const placementMutationSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("dispatch"), sessionKey: z.string().min(1).max(512), agentId: z.string().min(1).max(128).optional(), target: destinationSchema }),
  z.object({ action: z.literal("move"), sessionKey: z.string().min(1).max(512), agentId: z.string().min(1).max(128).optional(), target: destinationSchema }),
  z.object({ action: z.literal("reclaim"), sessionKey: z.string().min(1).max(512), agentId: z.string().min(1).max(128).optional() })
]);

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "sessions.use");
  if ("response" in permission) return permission.response;
  const params = new URL(request.url).searchParams;
  const sessionKey = params.get("sessionKey");
  const sessionKeyResult = z.string().min(1).max(512).safeParse(sessionKey);
  if (!sessionKeyResult.success) return NextResponse.json({ error: "A valid OpenClaw session key is required." }, { status: 400 });

  const preflight = await requireAgentOsOpenClawPreflight(request, {
    operation: "sessions.get.placement",
    method: "sessions.get",
    params: { key: sessionKeyResult.data },
    targetKind: "openclaw-session",
    targetId: sessionKeyResult.data,
    securityClass: "read",
    executionPath: "gateway-native",
    productPermission: "sessions.use"
  });
  if ("response" in preflight) return preflight.response;

  try {
    const placement = await readSessionPlacement({ sessionKey: sessionKeyResult.data }, { commandOptions: preflight.commandOptions });
    return NextResponse.json(redactSecrets({ placement, canPlace: canAgentOsActorUseProductPermission(permission.actor, "sessions.place") }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "OpenClaw session placement is unavailable."), code: error instanceof ExecutionTopologyUnavailableError ? "openclaw-placement-unavailable" : "openclaw-placement-read-failed" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;
  const permission = await requireAgentOsProductPermission(request, "sessions.place");
  if ("response" in permission) return permission.response;

  let input: z.infer<typeof placementMutationSchema>;
  try {
    input = placementMutationSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Invalid session placement operation.") }, { status: 400 });
  }

  try {
    if (input.action === "dispatch") {
      if (input.target.kind === "gateway") return NextResponse.json({ error: "Gateway is selected through native session move, not dispatch." }, { status: 400 });
      const nativeInput = placementTargetToDispatchInput(input.sessionKey, input.target, input.agentId);
      const preflight = await requireAgentOsOpenClawPreflight(request, {
        operation: "sessions.dispatch",
        method: "sessions.dispatch",
        params: nativeInput,
        targetKind: "openclaw-session",
        targetId: input.sessionKey,
        securityClass: "privileged-mutation",
        executionPath: "gateway-native",
        productPermission: "sessions.place"
      });
      if ("response" in preflight) return preflight.response;
      const mutation = await dispatchSession(input, { adapter: getOpenClawAdapter(), commandOptions: preflight.commandOptions });
      return respondToPlacementMutation(mutation, permission.actor, "session.dispatch", input.sessionKey);
    }

    if (input.action === "move") {
      if (input.target.kind === "automatic") return NextResponse.json({ error: "Automatic placement is selected through native session dispatch." }, { status: 400 });
      const nativeTarget = input.target.kind === "gateway"
        ? { kind: "gateway" as const }
        : input.target.kind === "device"
          ? { kind: "device" as const, deviceId: input.target.deviceId }
          : { kind: "profile" as const, profileId: input.target.profileId, ...(input.target.machineClass ? { machineClass: input.target.machineClass } : {}) };
      const preflight = await requireAgentOsOpenClawPreflight(request, {
        operation: "sessions.move",
        method: "sessions.move",
        params: { key: input.sessionKey, ...(input.agentId ? { agentId: input.agentId } : {}), target: nativeTarget },
        targetKind: "openclaw-session",
        targetId: input.sessionKey,
        securityClass: "privileged-mutation",
        executionPath: "gateway-native",
        productPermission: "sessions.place"
      });
      if ("response" in preflight) return preflight.response;
      const mutation = await moveSession(input, { adapter: getOpenClawAdapter(), commandOptions: preflight.commandOptions });
      return respondToPlacementMutation(mutation, permission.actor, "session.move", input.sessionKey);
    }

    const preflight = await requireAgentOsOpenClawPreflight(request, {
      operation: "sessions.reclaim",
      method: "sessions.reclaim",
      params: { key: input.sessionKey, ...(input.agentId ? { agentId: input.agentId } : {}) },
      targetKind: "openclaw-session",
      targetId: input.sessionKey,
      securityClass: "privileged-mutation",
      executionPath: "gateway-native",
      productPermission: "sessions.place"
    });
    if ("response" in preflight) return preflight.response;
    const mutation = await reclaimSession(input, { adapter: getOpenClawAdapter(), commandOptions: preflight.commandOptions });
    return respondToPlacementMutation(mutation, permission.actor, "session.reclaim", input.sessionKey);
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "OpenClaw session placement operation failed.") }, { status: 503 });
  }
}

async function respondToPlacementMutation(
  mutation: Parameters<typeof buildNativeMutationFailureResponse>[0] | { outcome: "succeeded"; reconciled: boolean; retryable: false; result: unknown },
  actor: Parameters<typeof recordAgentOsAuditEvent>[0]["actor"],
  operation: string,
  targetId: string
) {
  if (mutation.outcome === "succeeded") {
    await recordAgentOsAuditEvent({ actor, operation, targetKind: "openclaw-session", targetId, result: "succeeded" }).catch(() => {});
    return NextResponse.json(redactSecrets({ ...mutation.result as Record<string, unknown>, outcome: "succeeded", reconciled: mutation.reconciled, retryable: mutation.retryable }), { headers: { "Cache-Control": "no-store" } });
  }
  await recordAgentOsAuditEvent({ actor, operation, targetKind: "openclaw-session", targetId, result: mutation.outcome }).catch(() => {});
  const failure = buildNativeMutationFailureResponse(mutation as Parameters<typeof buildNativeMutationFailureResponse>[0]);
  return NextResponse.json(failure.body, { status: failure.status, headers: { "Cache-Control": "no-store" } });
}
