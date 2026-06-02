import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getMissionControlSnapshot,
  reconcileWorkspaceSurfaceBindings
} from "@/lib/agentos/control-plane";
import {
  formatGatewayConfigRateLimitMessage,
  isGatewayConfigRateLimitMessage
} from "@/lib/openclaw/gateway-config-errors";
import { createTimingCollector, formatTimingSummary, measureTiming } from "@/lib/openclaw/timing";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const reconcileSchema = z.object({
  scope: z.enum(["workspace", "all"]).optional(),
  dryRun: z.boolean().optional()
});

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const timings = createTimingCollector("workspace-surface-reconcile");

  try {
    const { workspaceId } = await context.params;
    const body = await request.json().catch(() => ({}));
    const input = await measureTiming(timings, "request.parse", async () => reconcileSchema.parse(body));
    const repair = await measureTiming(timings, "surface.reconcile", () =>
      reconcileWorkspaceSurfaceBindings(
        {
          workspaceId,
          scope: input.scope ?? "workspace",
          dryRun: input.dryRun === true
        },
        timings
      )
    );
    const snapshot = input.dryRun === true
      ? null
      : await measureTiming(timings, "snapshot.refresh", () =>
          getMissionControlSnapshot({ force: true, loadProfile: "refresh" })
        );
    const summary = timings.summary();
    console.info(formatTimingSummary(summary));

    return NextResponse.json(redactSecrets({
      repair,
      ...(snapshot ? { snapshot } : {}),
      timings: summary
    }));
  } catch (error) {
    const summary = timings.summary();
    console.info(formatTimingSummary(summary));

    return NextResponse.json(
      {
        error: formatReconcileError(error),
        timings: summary
      },
      { status: 400 }
    );
  }
}

function formatReconcileError(error: unknown) {
  const message = redactErrorMessage(error, "Unable to reconcile OpenClaw surface bindings.");
  return isGatewayConfigRateLimitMessage(message)
    ? formatGatewayConfigRateLimitMessage(message, "binding repair")
    : message;
}
