import { NextResponse } from "next/server";
import { z } from "zod";

import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { resolveAgentOsDeploymentCapabilities } from "@/lib/agentos/deployment-capabilities";
import { controlGateway } from "@/lib/openclaw/application/gateway-service";
import { restartManagedRailwayGateway } from "@/lib/openclaw/application/managed-gateway-service";
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
  try {
    const input = gatewayControlSchema.parse(await request.json());
    const deployment = resolveAgentOsDeploymentCapabilities();

    if (deployment.gatewayLifecycle === "supervisor-managed") {
      if (input.action !== "restart") {
        return NextResponse.json(
          { error: "Railway manages the Gateway process lifecycle. Only a managed Gateway restart is available." },
          { status: 409 }
        );
      }

      const result = await restartManagedRailwayGateway();
      const snapshot = await getMissionControlSnapshot({ force: true });
      return NextResponse.json({
        message: result.message,
        snapshot: redactSecrets(snapshot)
      });
    }

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
    const snapshot = await getMissionControlSnapshot({ force: true });

    return NextResponse.json({
      message: actionMessageMap[input.action],
      snapshot: redactSecrets(snapshot)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to control the OpenClaw gateway.")
      },
      { status: 400 }
    );
  }
}
