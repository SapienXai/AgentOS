import { NextResponse } from "next/server";
import { z } from "zod";

import { getHumanControlInbox } from "@/lib/openclaw/application/human-control-inbox-service";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const filterSchema = z.object({
  type: z.enum(["approval", "question", "suggested-work", "needs-setup", "blocked", "runtime-issue"]).optional(),
  workerId: z.string().trim().min(1).max(128).optional(),
  missionId: z.string().trim().min(1).max(128).optional(),
  severity: z.enum(["critical", "high", "normal", "low"]).optional()
}).strict();

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;

  const url = new URL(request.url);
  const parsed = filterSchema.safeParse({
    type: url.searchParams.get("type") ?? undefined,
    workerId: url.searchParams.get("workerId") ?? undefined,
    missionId: url.searchParams.get("missionId") ?? undefined,
    severity: url.searchParams.get("severity") ?? undefined
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid Human Control filters." }, { status: 400 });
  }

  try {
    const inbox = await getHumanControlInbox(parsed.data);
    return NextResponse.json(redactSecrets(inbox), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Human Control is unavailable.") },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
