import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { InstanceProtectionError, isTailscaleOriginApproved, readInstanceProtectionState, readManagedRemoteOrigins } from "@/lib/security/instance-protection";
import { evaluateLocalOperatorRequest, isLoopbackHost } from "@/lib/security/local-operator";
import { classifyTailscaleRequest } from "@/lib/security/tailscale-request";

export function isLocalAccessRequest(request: Request) {
  return classifyTailscaleRequest(request) === null &&
    isLoopbackHost(new URL(request.url).host) && evaluateLocalOperatorRequest({
      method: request.method, url: request.url, headers: request.headers,
      allowSafeMethods: false, allowTrustedRemote: false
    }).ok && (request.method === "GET" || Boolean(request.headers.get("origin")));
}

export async function checkTailscaleIngress(request: Request) {
  const access = classifyTailscaleRequest(request);
  if (access === null) return { allowed: true, origin: null };
  return {
    allowed: access !== "deny" && isTailscaleOriginApproved(access.origin, await readInstanceProtectionState().catch(() => null)),
    origin: access === "deny" ? null : access.origin
  };
}

export function denyTailscaleIngress() {
  return NextResponse.json({
    error: "This private Tailscale address is unavailable. Manage access from AgentOS on the host.",
    code: "tailscale-access-denied"
  }, { status: 403, headers: { "Cache-Control": "no-store" } });
}

export async function requireSameOriginMutation(request: Request) {
  if (!(await checkTailscaleIngress(request)).allowed) return denyTailscaleIngress();
  const decision = evaluateLocalOperatorRequest({
    method: request.method,
    url: request.url,
    headers: request.headers,
    allowSafeMethods: false,
    managedOrigins: await readManagedRemoteOrigins(request).catch(() => [])
  });
  if (decision.ok) return null;
  return NextResponse.json({ error: decision.message, code: decision.code }, { status: decision.status });
}

export function instanceProtectionErrorResponse(error: unknown) {
  if (error instanceof InstanceProtectionError) {
    return NextResponse.json(
      { error: error.message, code: error.code, retryAfterSeconds: error.retryAfterSeconds },
      {
        status: error.status,
        headers: error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : undefined
      }
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: error.issues[0]?.message || "Invalid request.", code: "invalid-input" },
      { status: 400 }
    );
  }
  return NextResponse.json({ error: "Instance protection request failed.", code: "internal-error" }, { status: 500 });
}
