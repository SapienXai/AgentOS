import { NextResponse } from "next/server";

import { discoverSurfaceRoutes } from "@/lib/agentos/control-plane";
import { createTimingCollector, formatTimingSummary, measureTiming } from "@/lib/openclaw/timing";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const timings = createTimingCollector("workspace-surface-discovery");

  try {
    await context.params;
    const permission = await requireAgentOsProductPermission(request, "runtime.use");
    if ("response" in permission) return permission.response;

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider")?.trim() ?? "";
    const accountId = searchParams.get("accountId")?.trim() || null;
    const supported = provider === "telegram" || provider === "discord";
    const routes = supported
      ? await measureTiming(timings, "surface.discovery", () => discoverSurfaceRoutes({ provider, accountId }, timings))
      : [];

    const summary = timings.summary();
    console.info(formatTimingSummary(summary));

    return NextResponse.json(redactSecrets({
      provider,
      accountId,
      routes,
      supported,
      timings: summary
    }));
  } catch (error) {
    const summary = timings.summary();
    console.info(formatTimingSummary(summary));

    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to discover integration routes."),
        timings: summary
      },
      { status: 400 }
    );
  }
}
