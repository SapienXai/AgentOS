import { NextResponse } from "next/server";
import { z } from "zod";

import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
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
  doctor: "OpenClaw doctor repair completed."
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
