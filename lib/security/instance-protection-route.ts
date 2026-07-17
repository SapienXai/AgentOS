import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { InstanceProtectionError } from "@/lib/security/instance-protection";
import { evaluateLocalOperatorRequest } from "@/lib/security/local-operator";

export function requireSameOriginMutation(request: Request) {
  const decision = evaluateLocalOperatorRequest({
    method: request.method,
    url: request.url,
    headers: request.headers,
    allowSafeMethods: false
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
