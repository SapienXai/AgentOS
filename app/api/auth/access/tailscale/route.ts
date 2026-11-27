import { NextResponse } from "next/server";
import { z } from "zod";
import { manageInstanceTailscaleAccess, readInstanceSessionCookie } from "@/lib/security/instance-protection";
import { instanceProtectionErrorResponse, isLocalAccessRequest } from "@/lib/security/instance-protection-route";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const mutation = z.object({ action: z.enum(["enable", "disable"]) }).strict();

async function respond(request: Request) {
  if (!isLocalAccessRequest(request)) {
    return NextResponse.json({ error: "Manage Tailscale from AgentOS on the host." }, { status: 403, headers });
  }
  try {
    const action = request.method === "POST" ? mutation.parse(await request.json().catch(() => null)).action : undefined;
    return NextResponse.json(await manageInstanceTailscaleAccess(readInstanceSessionCookie(request.headers), action), { headers });
  } catch (error) {
    const result = instanceProtectionErrorResponse(error);
    result.headers.set("Cache-Control", headers["Cache-Control"]);
    return result;
  }
}

export const GET = respond;
export const POST = respond;
