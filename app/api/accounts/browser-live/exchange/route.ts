import { NextResponse } from "next/server";
import { z } from "zod";

import {
  BrowserAccountError,
  exchangeBrowserLiveViewCapability
} from "@/lib/agentos/application/browser-account-service";
import {
  browserAccountResponseHeaders,
  requireBrowserAccountActor
} from "@/lib/security/browser-account-route";
import { isSecureRequest } from "@/lib/security/instance-protection";
import { redactErrorMessage } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const exchangeSchema = z.object({
  capability: z.string().min(64).max(256)
});

export async function POST(request: Request) {
  const authorization = await requireBrowserAccountActor(request);
  if ("response" in authorization) return authorization.response;

  try {
    const input = exchangeSchema.parse(await request.json());
    const exchange = await exchangeBrowserLiveViewCapability({
      actor: authorization.actor,
      capability: input.capability
    });
    const maxAgeSeconds = Math.max(
      1,
      Math.floor((Date.parse(exchange.sessionExpiresAt) - Date.now()) / 1_000)
    );
    const response = NextResponse.json(
      {
        ok: true,
        accountId: exchange.accountId,
        workspaceId: exchange.workspaceId,
        providerSessionId: exchange.providerSessionId,
        sessionExpiresAt: exchange.sessionExpiresAt,
        viewerPath: exchange.viewerPath
      },
      { headers: browserAccountResponseHeaders() }
    );
    response.headers.append(
      "Set-Cookie",
      `${exchange.cookieName}=${encodeURIComponent(exchange.credential)}; Path=/api/accounts/browser-live/ws/${exchange.providerSessionId}; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${isSecureRequest(request) ? "; Secure" : ""}`
    );
    return response;
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Live View capability exchange failed."),
        code: error instanceof BrowserAccountError ? error.code : "live-view-exchange-failed"
      },
      {
        status: error instanceof BrowserAccountError ? error.status : 400,
        headers: browserAccountResponseHeaders()
      }
    );
  }
}
