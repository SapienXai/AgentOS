import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  authorizeBrowserLiveViewWebSocket,
  readBrowserLiveViewCookie
} from "@/lib/agentos/application/browser-account-service";
import { browserAccountResponseHeaders } from "@/lib/security/browser-account-route";
import {
  getInstanceProtectionStatus,
  readInstanceSessionCookie
} from "@/lib/security/instance-protection";
import { resolveAgentOsActorContext } from "@/lib/security/agentos-actor";
import { canAgentOsActorUseProductPermission } from "@/lib/security/agentos-product-authorization";
import { evaluateLocalOperatorRequest } from "@/lib/security/local-operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const authorizationSchema = z.object({
  providerSessionId: z.string().uuid()
});

export async function POST(request: Request) {
  if (!isInternalBrowserProxyRequest(request)) {
    return denied();
  }

  try {
    const forwardedHeaders = buildForwardedBrowserHeaders(request.headers);
    const originDecision = evaluateLocalOperatorRequest({
      method: "POST",
      url: `${forwardedHeaders.get("x-forwarded-proto") ?? "https"}://${forwardedHeaders.get("host") ?? "invalid"}/api/accounts/browser-live/ws`,
      headers: forwardedHeaders,
      allowSafeMethods: false
    });
    if (!originDecision.ok) return denied();

    const status = await getInstanceProtectionStatus(
      readInstanceSessionCookie(forwardedHeaders)
    );
    if (status.protectionEnabled && !status.authenticated) return denied();

    const actor = await resolveAgentOsActorContext(new Request(
      `${forwardedHeaders.get("x-forwarded-proto") ?? "https"}://${forwardedHeaders.get("host") ?? "invalid"}/api/accounts/browser-live/ws`,
      { method: "POST", headers: forwardedHeaders }
    ));
    if (!actor || !canAgentOsActorUseProductPermission(actor, "runtime.use")) return denied();

    const input = authorizationSchema.parse(await request.json());
    const credential = readBrowserLiveViewCookie(
      forwardedHeaders,
      input.providerSessionId
    );
    await authorizeBrowserLiveViewWebSocket({
      actor: { userId: actor.actorId },
      providerSessionId: input.providerSessionId,
      credential
    });
    return new NextResponse(null, {
      status: 204,
      headers: browserAccountResponseHeaders()
    });
  } catch {
    return denied();
  }
}

function isInternalBrowserProxyRequest(request: Request) {
  const expected = process.env.AGENTOS_BROWSER_PROXY_TOKEN?.trim();
  const provided = request.headers.get("x-agentos-browser-proxy-token")?.trim();
  if (!expected || !provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

function buildForwardedBrowserHeaders(headers: Headers) {
  const forwarded = new Headers();
  const origin = headers.get("x-agentos-browser-origin");
  const host = headers.get("x-agentos-browser-host");
  const proto = headers.get("x-agentos-browser-proto");
  const cookie = headers.get("cookie");
  if (origin) forwarded.set("origin", origin);
  if (host) {
    forwarded.set("host", host);
    forwarded.set("x-forwarded-host", host);
  }
  if (proto) forwarded.set("x-forwarded-proto", proto);
  if (cookie) forwarded.set("cookie", cookie);
  return forwarded;
}

function denied() {
  return NextResponse.json(
    { error: "Live View session access is denied.", code: "live-view-denied" },
    { status: 403, headers: browserAccountResponseHeaders() }
  );
}
