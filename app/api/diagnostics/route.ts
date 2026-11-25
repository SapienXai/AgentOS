import { NextResponse } from "next/server";

import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.inspect");
  if ("response" in permission) return permission.response;
  const snapshot = await getMissionControlSnapshot();
  return NextResponse.json(redactSecrets({
    generatedAt: snapshot.generatedAt,
    mode: snapshot.mode,
    diagnostics: snapshot.diagnostics,
    presence: snapshot.presence
  }), { headers: { "Cache-Control": "private, no-store" } });
}
