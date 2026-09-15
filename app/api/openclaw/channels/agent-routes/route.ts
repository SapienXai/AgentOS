import { NextResponse } from "next/server";
import { z } from "zod";

import { getAgentChannelRouteSummary } from "@/lib/openclaw/application/agent-channel-route-service";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  agentId: z.string().trim().min(1).max(128)
});

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;

  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
    const result = await getAgentChannelRouteSummary({ agentId: query.agentId });
    return NextResponse.json(redactSecrets(result), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "The agent channel route request is invalid."
      : redactErrorMessage(error, "OpenClaw agent channel routes are unavailable.");
    return NextResponse.json(
      { error: message },
      { status: error instanceof z.ZodError ? 400 : 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
