import { NextResponse } from "next/server";

import { readWorkerDreamDiary } from "@/lib/openclaw/application/native-memory-service";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ agentId: string }> }) {
  const { agentId } = await context.params;
  const preflight = await requireAgentOsOpenClawPreflight(request, {
    operation: "memory.dream-diary.read",
    method: "doctor.memory.dreamDiary",
    params: { agentId },
    targetKind: "agent-memory-dream-diary",
    targetId: agentId,
    securityClass: "read",
    executionPath: "gateway-native",
    productPermission: "runtime.use"
  });
  if ("response" in preflight) return preflight.response;

  try {
    const diary = await readWorkerDreamDiary(agentId, {
      commandOptions: preflight.commandOptions
    });
    return NextResponse.json(redactSecrets(diary), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to read the native dream diary.") },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
