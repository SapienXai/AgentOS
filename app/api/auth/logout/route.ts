import { NextResponse } from "next/server";

import { buildExpiredInstanceSessionCookie, isSecureRequest } from "@/lib/security/instance-protection";
import { requireSameOriginMutation } from "@/lib/security/instance-protection-route";

export async function POST(request: Request) {
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;
  return NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store", "Set-Cookie": buildExpiredInstanceSessionCookie(isSecureRequest(request)) } }
  );
}
