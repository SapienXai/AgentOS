import { NextResponse } from "next/server";
import { z } from "zod";

import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import {
  auditResultForNativeDoctorMutation,
  executeNativeDoctorMutation,
  getNativeDoctorSnapshot,
  reconcileNativeDoctorMutation
} from "@/lib/openclaw/application/native-doctor-service";
import { controlGateway } from "@/lib/openclaw/application/gateway-service";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gatewayControlSchema = z.object({
  action: z.enum(["start", "stop", "restart", "doctor"])
});

const actionMessageMap = {
  start: "Gateway started.",
  stop: "Gateway stopped.",
  restart: "Gateway restarted.",
  doctor: "Native OpenClaw diagnostics refreshed."
} satisfies Record<z.infer<typeof gatewayControlSchema>["action"], string>;

export async function POST(request: Request) {
  const authorization = await requireAgentOsProductPermission(request, "lifecycle.manage");
  if ("response" in authorization) return authorization.response;

  try {
    const input = gatewayControlSchema.parse(await request.json());
    const currentSnapshot = await getMissionControlSnapshot({ force: true });

    if (!currentSnapshot.diagnostics.installed) {
      return NextResponse.json(
        {
          error: currentSnapshot.diagnostics.issues[0] || "OpenClaw is unavailable."
        },
        { status: 400 }
      );
    }

    if (input.action === "doctor") {
      const nativeDoctor = await getNativeDoctorSnapshot();
      await recordAgentOsAuditEvent({
        actor: authorization.actor,
        operation: "gateway.native-diagnostics",
        targetKind: "gateway",
        result: "succeeded"
      }).catch(() => {});
      const snapshot = await getMissionControlSnapshot({ force: true });
      return NextResponse.json({
        message: actionMessageMap[input.action],
        nativeDoctor: redactSecrets(nativeDoctor),
        snapshot: redactSecrets(snapshot)
      });
    }

    if (input.action === "restart") {
      const nativeDoctor = await getNativeDoctorSnapshot();
      if (!nativeDoctor.identity.connectionId || nativeDoctor.runtime.status === "unavailable") {
        return NextResponse.json(
          { error: "Native Gateway restart requires a reachable, authenticated OpenClaw Gateway." },
          { status: 409 }
        );
      }
      const nativeResult = await executeNativeDoctorMutation({
        action: "gateway.restart.request",
        input: { reason: "AgentOS operator requested restart", skipDeferral: false }
      });
      const reconciledResult = await reconcileNativeDoctorMutation(nativeResult, { before: nativeDoctor });
      if (reconciledResult.outcome === "failed" || reconciledResult.outcome === "unknown" || reconciledResult.verification.status === "unknown") {
        return NextResponse.json(
          { error: reconciledResult.message, nativeResult: reconciledResult },
          { status: reconciledResult.outcome === "unknown" || reconciledResult.verification.status === "unknown" ? 409 : 400 }
        );
      }
      await recordAgentOsAuditEvent({
        actor: authorization.actor,
        operation: "gateway.restart.request",
        targetKind: "gateway",
        targetId: nativeDoctor.identity.connectionId,
        result: auditResultForNativeDoctorMutation(reconciledResult.outcome)
      }).catch(() => {});
      return NextResponse.json({
        message: reconciledResult.verification.status === "verified" ? "Native Gateway restart verified." : "Native Gateway restart requested.",
        nativeResult: reconciledResult
      });
    }

    await controlGateway(input.action);
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: `gateway.${input.action}`,
      targetKind: "gateway",
      result: "succeeded"
    }).catch(() => {});
    const snapshot = await getMissionControlSnapshot({ force: true });

    return NextResponse.json({
      message: actionMessageMap[input.action],
      snapshot: redactSecrets(snapshot)
    });
  } catch (error) {
    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "gateway.control",
      targetKind: "gateway",
      result: "failed"
    }).catch(() => {});
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to control the OpenClaw gateway.")
      },
      { status: 400 }
    );
  }
}
