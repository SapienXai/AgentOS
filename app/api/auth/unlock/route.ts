import { NextResponse } from "next/server";
import { z } from "zod";

import { buildInstanceSessionCookie, isSecureRequest, unlockLockedInstance } from "@/lib/security/instance-protection";
import { instanceProtectionErrorResponse, requireSameOriginMutation } from "@/lib/security/instance-protection-route";

const unlockSchema = z.object({
  username: z.string().max(128),
  password: z.string().max(1024)
});

export async function POST(request: Request) {
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;

  try {
    const input = unlockSchema.parse(await request.json());
    const result = await unlockLockedInstance({
      ...input,
      rateKey: readRateKey(request.headers)
    });
    return NextResponse.json(result.status, {
      headers: {
        "Cache-Control": "no-store",
        "Set-Cookie": buildInstanceSessionCookie(result.session, isSecureRequest(request))
      }
    });
  } catch (error) {
    return instanceProtectionErrorResponse(error);
  }
}

function readRateKey(headers: Headers) {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim() || "local";
}
