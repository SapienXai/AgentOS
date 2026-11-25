import { NextResponse } from "next/server";

import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { getBoundedControlPlaneSnapshot } from "@/lib/agentos/initial-snapshot";
import { redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;
  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "true";
  const result = force
    ? { snapshot: await getMissionControlSnapshot({ force: true }), pending: false }
    : await getBoundedControlPlaneSnapshot();

  return NextResponse.json(redactSecrets(result.snapshot), {
    headers: {
      "Cache-Control": "private, no-store",
      ...(result.pending ? { "X-AgentOS-Snapshot-Pending": "true" } : {})
    }
  });
}
