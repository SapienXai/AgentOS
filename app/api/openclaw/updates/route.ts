import { NextResponse } from "next/server";

import { getOpenClawStabilitySnapshot } from "@/lib/openclaw/stability";
import { redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const stability = await getOpenClawStabilitySnapshot();

  return NextResponse.json(redactSecrets({ stability }), {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
