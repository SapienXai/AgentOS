import { NextResponse } from "next/server";
import { z } from "zod";

import {
  auditResultForNativeDoctorMutation,
  buildNativeDoctorConfirmation,
  confirmationMatches,
  executeNativeDoctorMutation,
  getNativeDoctorSnapshot,
  reconcileNativeDoctorMutation
} from "@/lib/openclaw/application/native-doctor-service";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const confirmationSchema = z.object({
  connectionId: z.string().nullable(),
  effectiveChannel: z.string().nullable()
}).strict();

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update.run"),
    confirmation: confirmationSchema,
    note: z.string().trim().max(200).optional()
  }).strict(),
  z.object({
    action: z.literal("update.hold"),
    confirmation: confirmationSchema
  }).strict(),
  z.object({
    action: z.literal("gateway.restart.request"),
    confirmation: confirmationSchema,
    reason: z.string().trim().max(200).optional()
  }).strict(),
  z.object({
    action: z.literal("gateway.suspend.prepare"),
    confirmation: confirmationSchema,
    requestId: z.string().trim().min(1).max(128),
    terminalPolicy: z.enum(["preserve", "terminate"]).optional(),
    drain: z.boolean().optional()
  }).strict(),
  z.object({
    action: z.literal("gateway.suspend.status"),
    suspensionId: z.string().trim().min(1).max(128)
  }).strict(),
  z.object({
    action: z.literal("gateway.suspend.resume"),
    confirmation: confirmationSchema,
    suspensionId: z.string().trim().min(1).max(128)
  }).strict()
]);

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;

  const probe = new URL(request.url).searchParams.get("probe") === "1";
  const snapshot = await getNativeDoctorSnapshot(probe ? { probe: true } : {});
  return NextResponse.json(redactSecrets({
    snapshot,
    confirmation: buildNativeDoctorConfirmation(snapshot)
  }), {
    headers: { "Cache-Control": "no-store" }
  });
}

export async function POST(request: Request) {
  let input: z.infer<typeof actionSchema>;
  try {
    input = actionSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid native Doctor operation." }, { status: 400 });
  }

  const permissionName = input.action.startsWith("update.") ? "updates.manage" : "lifecycle.manage";
  const permission = await requireAgentOsProductPermission(request, permissionName);
  if ("response" in permission) return permission.response;

  try {
    const adapter = getOpenClawAdapter();
    const current = await getNativeDoctorSnapshot({ adapter });
    if (input.action !== "gateway.suspend.status") {
      if (!confirmationMatches(input.confirmation, buildNativeDoctorConfirmation(current))) {
        return NextResponse.json(
          { error: "The OpenClaw Gateway identity or update channel changed. Refresh before retrying." },
          { status: 409 }
        );
      }
    }

    const mutation = await executeNativeDoctorMutation(
      input.action === "update.run"
        ? { action: input.action, input: input.note === undefined ? undefined : { note: input.note } }
        : input.action === "update.hold"
          ? { action: input.action }
          : input.action === "gateway.restart.request"
            ? { action: input.action, input: { reason: input.reason, skipDeferral: false } }
            : input.action === "gateway.suspend.prepare"
              ? {
                  action: input.action,
                  input: {
                    requestId: input.requestId,
                    ...(input.terminalPolicy ? { terminalPolicy: input.terminalPolicy } : {}),
                    ...(input.drain === undefined ? {} : { drain: input.drain })
                  }
                }
              : input.action === "gateway.suspend.status"
                ? { action: input.action, input: { suspensionId: input.suspensionId } }
                : { action: input.action, input: { suspensionId: input.suspensionId } }
    );
    const result = input.action === "gateway.restart.request" || input.action === "update.run"
      ? await reconcileNativeDoctorMutation(mutation, { before: current, adapter })
      : mutation;

    await recordAgentOsAuditEvent({
      actor: permission.actor,
      operation: `openclaw.${input.action}`,
      targetKind: "gateway",
      targetId: current.identity.connectionId ?? "current-gateway",
      result: auditResultForNativeDoctorMutation(result.outcome)
    }).catch(() => {});

    return NextResponse.json(redactSecrets({ result }), {
      status: result.outcome === "failed" ? 400 : result.outcome === "unknown" || result.verification.status === "unknown" ? 409 : 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    await recordAgentOsAuditEvent({
      actor: permission.actor,
      operation: `openclaw.${input.action}`,
      targetKind: "gateway",
      result: "failed"
    }).catch(() => {});
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to complete the native OpenClaw operation.") },
      { status: 400 }
    );
  }
}
