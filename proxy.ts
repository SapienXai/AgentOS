import { NextResponse, type NextRequest } from "next/server";

import { evaluateAgentOsApiRequest } from "@/lib/security/api-auth";

export function proxy(request: NextRequest) {
  const decision = evaluateAgentOsApiRequest({
    method: request.method,
    url: request.url,
    headers: request.headers
  });

  if (decision.ok) {
    return NextResponse.next();
  }

  return NextResponse.json(
    {
      error: decision.message,
      code: decision.code
    },
    { status: decision.status }
  );
}

export const config = {
  matcher: ["/api/:path*"]
};
