import { NextResponse } from "next/server";

import { getWorkerMemoryProjection } from "@/lib/openclaw/application/native-memory-service";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await context.params;
  const preflight = await requireAgentOsOpenClawPreflight(request, {
    operation: "memory.status",
    method: "doctor.memory.status",
    params: { agentId },
    targetKind: "agent-memory",
    targetId: agentId,
    securityClass: "read",
    executionPath: "gateway-native",
    productPermission: "runtime.use"
  });
  if ("response" in preflight) return preflight.response;

  try {
    const projection = await getWorkerMemoryProjection(agentId, {
      commandOptions: preflight.commandOptions
    });
    return NextResponse.json(redactSecrets(projection), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to read native memory status.") },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
