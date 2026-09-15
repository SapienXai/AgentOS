import { NextResponse } from "next/server";

import { getChannelCenterSnapshot } from "@/lib/openclaw/application/channel-center-service";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;

  try {
    return NextResponse.json(redactSecrets(await getChannelCenterSnapshot()), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "OpenClaw channel inventory is unavailable.") },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}

