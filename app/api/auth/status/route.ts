import { NextResponse } from "next/server";

import { getInstanceProtectionStatus, readInstanceSessionCookie } from "@/lib/security/instance-protection";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json(await getInstanceProtectionStatus(readInstanceSessionCookie(request.headers)), {
    headers: { "Cache-Control": "no-store" }
  });
}
