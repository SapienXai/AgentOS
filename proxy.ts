import { NextResponse, type NextRequest } from "next/server";

import { evaluateAgentOsApiRequest } from "@/lib/security/api-auth";
import { getInstanceProtectionStatus, readInstanceSessionCookie } from "@/lib/security/instance-protection";

const publicInstanceApiPaths = new Set(["/api/auth/status", "/api/auth/login", "/api/auth/logout"]);

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/api/")) {
    const decision = evaluateAgentOsApiRequest({
      method: request.method,
      url: request.url,
      headers: request.headers
    });

    if (!decision.ok) {
      return NextResponse.json(
        {
          error: decision.message,
          code: decision.code
        },
        { status: decision.status }
      );
    }
  }

  if (publicInstanceApiPaths.has(pathname) || pathname === "/login") {
    return NextResponse.next();
  }

  let status;
  try {
    status = await getInstanceProtectionStatus(readInstanceSessionCookie(request.headers));
  } catch {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: "Instance Protection is unavailable. Run agentos auth reset on the host to recover.", code: "instance-auth-unavailable" },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }
    return new NextResponse("AgentOS Instance Protection is unavailable. Run agentos auth reset on the host to recover.", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" }
    });
  }

  if (!status.protectionEnabled || status.authenticated) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: "Unlock AgentOS to continue.", code: "instance-auth-required" },
      { status: 401, headers: { "Cache-Control": "no-store", "X-AgentOS-Auth-Required": "instance" } }
    );
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  const returnTo = `${pathname}${request.nextUrl.search}`;
  if (returnTo !== "/") loginUrl.searchParams.set("returnTo", returnTo);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|mp4|webm|woff|woff2)$).*)"]
};
