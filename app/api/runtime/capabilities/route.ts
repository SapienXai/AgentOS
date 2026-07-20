import { NextResponse } from "next/server";

import { resolveAgentOsDeploymentCapabilities } from "@/lib/agentos/deployment-capabilities";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(resolveAgentOsDeploymentCapabilities(), {
    headers: { "Cache-Control": "no-store" }
  });
}
