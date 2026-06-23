import { NextResponse } from "next/server";

import { getOpenClawGatewayProductSurfaceSnapshot } from "@/lib/openclaw/application/gateway-surface-service";
import { redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const includeProbes = searchParams.get("probes") !== "false";

  try {
    const snapshot = await getOpenClawGatewayProductSurfaceSnapshot({
      includeProbes,
      timeoutMs: 2_500
    });

    return NextResponse.json(redactSecrets(snapshot));
  } catch (error) {
    const message = sanitizeRouteError(error);
    return NextResponse.json(
      redactSecrets({
        error: message
      }),
      { status: 500 }
    );
  }
}

function sanitizeRouteError(error: unknown) {
  const message = error instanceof Error ? error.message : "Gateway surface snapshot failed.";
  return message
    .replace(/\/Users\/[^/\s]+/g, "/Users/[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/token[=:]\s*[^,\s]+/gi, "token=[redacted]")
    .slice(0, 480);
}
