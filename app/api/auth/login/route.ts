import { NextResponse } from "next/server";
import { z } from "zod";

import {
  buildInstanceSessionCookie,
  isSecureRequest,
  loginToInstance
} from "@/lib/security/instance-protection";
import {
  instanceProtectionErrorResponse,
  requireSameOriginMutation
} from "@/lib/security/instance-protection-route";

const loginSchema = z.object({
  username: z.string().max(128),
  password: z.string().max(1024)
});

export async function POST(request: Request) {
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;

  try {
    const input = loginSchema.parse(await request.json());
    const rateKey = readRateKey(request.headers);
    const result = await loginToInstance({ ...input, rateKey });
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
