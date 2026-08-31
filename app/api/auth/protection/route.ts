import { NextResponse } from "next/server";
import { z } from "zod";

import {
  buildExpiredInstanceSessionCookie,
  buildInstanceSessionCookie,
  disableInstanceProtection,
  enableInstanceProtection,
  getInstanceProtectionStatus,
  isSecureRequest,
  readInstanceSessionCookie,
  updateInstanceCredentials
} from "@/lib/security/instance-protection";
import {
  instanceProtectionErrorResponse,
  requireSameOriginMutation
} from "@/lib/security/instance-protection-route";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("enable"),
    username: z.string().trim().min(1, "Username is required.").max(128),
    password: z.string().min(8, "Password must be at least 8 characters.").max(1024)
  }),
  z.object({
    action: z.literal("update"),
    username: z.string().trim().min(1, "Username is required.").max(128),
    currentPassword: z.string().max(1024),
    newPassword: z.string().max(1024).optional()
  }),
  z.object({
    action: z.literal("disable"),
    currentPassword: z.string().max(1024)
  })
]);

export async function POST(request: Request) {
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;

  try {
    const input = mutationSchema.parse(await request.json());
    const currentStatus = await getInstanceProtectionStatus(readInstanceSessionCookie(request.headers));
    if (input.action !== "enable" && (!currentStatus.protectionEnabled || !currentStatus.authenticated)) {
      return NextResponse.json(
        { error: "Unlock AgentOS to manage instance protection.", code: "instance-auth-required" },
        { status: 401, headers: { "X-AgentOS-Auth-Required": "instance" } }
      );
    }

    if (input.action !== "enable") {
      const permission = await requireAgentOsProductPermission(request, "security.manage");
      if ("response" in permission) return permission.response;
    }

    if (input.action === "enable") {
      const result = await enableInstanceProtection(input);
      return NextResponse.json(result.status, {
        headers: { "Cache-Control": "no-store", "Set-Cookie": buildInstanceSessionCookie(result.session, isSecureRequest(request)) }
      });
    }
    if (input.action === "update") {
      const result = await updateInstanceCredentials(input);
      return NextResponse.json(result.status, {
        headers: { "Cache-Control": "no-store", "Set-Cookie": buildInstanceSessionCookie(result.session, isSecureRequest(request)) }
      });
    }

    await disableInstanceProtection(input.currentPassword);
    return NextResponse.json(
      { protectionEnabled: false, authenticated: true, username: null, credentialConfigured: false },
      { headers: { "Cache-Control": "no-store", "Set-Cookie": buildExpiredInstanceSessionCookie(isSecureRequest(request)) } }
    );
  } catch (error) {
    return instanceProtectionErrorResponse(error);
  }
}
