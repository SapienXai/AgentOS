import { NextResponse } from "next/server";
import { z } from "zod";

import { manageInstanceRemoteAccess, readInstanceSessionCookie } from "@/lib/security/instance-protection";
import { instanceProtectionErrorResponse } from "@/lib/security/instance-protection-route";
import { evaluateLocalOperatorRequest, isLoopbackHost, readTrustedOperatorOrigins } from "@/lib/security/local-operator";
import { getLanHttpsOrigins, type RemoteAccessChange } from "@/lib/security/remote-access-policy";

export const runtime = "nodejs";

const headers = { "Cache-Control": "private, no-store" };
const changeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), origin: z.string().trim().min(1).max(512) }).strict(),
  z.object({ action: z.literal("remove"), origin: z.string().trim().min(1).max(512) }).strict(),
  z.object({ action: z.literal("lan"), enabled: z.boolean() }).strict()
]);

function isLocalOwnerSurface(request: Request) {
  return isLoopbackHost(new URL(request.url).host) && evaluateLocalOperatorRequest({
    method: request.method, url: request.url, headers: request.headers,
    allowSafeMethods: false, allowTrustedRemote: false
  }).ok && (request.method === "GET" || Boolean(request.headers.get("origin")));
}

function denyRemote() {
  return NextResponse.json({ error: "Open Settings from localhost to manage remote access." }, { status: 403, headers });
}

async function respond(request: Request, change?: RemoteAccessChange) {
  try {
    const settings = await manageInstanceRemoteAccess(readInstanceSessionCookie(request.headers), change);
    return NextResponse.json({
      ...settings,
      environmentOrigins: [...readTrustedOperatorOrigins()].sort(),
      lanOrigins: getLanHttpsOrigins()
    }, { headers });
  } catch (error) {
    const response = instanceProtectionErrorResponse(error);
    response.headers.set("Cache-Control", headers["Cache-Control"]);
    return response;
  }
}

export async function GET(request: Request) {
  if (!isLocalOwnerSurface(request)) return denyRemote();
  return respond(request);
}

export async function POST(request: Request) {
  if (!isLocalOwnerSurface(request)) return denyRemote();
  const result = changeSchema.safeParse(await request.json().catch(() => null));
  if (!result.success) {
    return NextResponse.json({ error: "Provide a valid access setting." }, { status: 400, headers });
  }
  return respond(request, result.data);
}
