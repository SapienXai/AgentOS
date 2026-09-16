import { NextResponse } from "next/server";

import {
  buildExpiredInstanceSessionCookie,
  isSecureRequest,
  lockInstance,
  readInstanceSessionCookie
} from "@/lib/security/instance-protection";
import { instanceProtectionErrorResponse, requireSameOriginMutation } from "@/lib/security/instance-protection-route";

export async function POST(request: Request) {
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;

  try {
    await lockInstance(readInstanceSessionCookie(request.headers));
    return NextResponse.json(
      { ok: true, locked: true },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": buildExpiredInstanceSessionCookie(isSecureRequest(request))
        }
      }
    );
  } catch (error) {
    return instanceProtectionErrorResponse(error);
  }
}
