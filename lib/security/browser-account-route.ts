import { NextResponse } from "next/server";

import {
  getInstanceProtectionStatus,
  readInstanceSessionCookie
} from "@/lib/security/instance-protection";
import { requireAgentOsProductPermission, type AgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { requireSameOriginMutation } from "@/lib/security/instance-protection-route";

const mutationWindowMs = 60_000;
const mutationLimit = 30;
const mutationAttempts = new Map<string, number[]>();

export async function requireBrowserAccountActor(
  request: Request,
  productPermission: AgentOsProductPermission = "runtime.use"
) {
  const status = await getInstanceProtectionStatus(readInstanceSessionCookie(request.headers));
  if (status.protectionEnabled && !status.authenticated) {
    return {
      response: NextResponse.json(
        { error: "Unlock AgentOS to manage browser accounts.", code: "instance-auth-required" },
        { status: 401, headers: browserAccountResponseHeaders() }
      )
    };
  }

  const productAuthorization = await requireAgentOsProductPermission(request, productPermission);
  if ("response" in productAuthorization) return productAuthorization;
  const agentOsActor = productAuthorization.actor;

  if (!isSafeMethod(request.method)) {
    const originFailure = requireSameOriginMutation(request);
    if (originFailure) {
      for (const [name, value] of Object.entries(browserAccountResponseHeaders())) {
        originFailure.headers.set(name, value);
      }
      return { response: originFailure };
    }

    const userId = agentOsActor.actorId;
    const rateKey = `${userId}:${request.method.toUpperCase()}`;
    const now = Date.now();
    const recent = (mutationAttempts.get(rateKey) ?? []).filter((at) => now - at < mutationWindowMs);
    if (recent.length >= mutationLimit) {
      return {
        response: NextResponse.json(
          { error: "Too many browser account changes. Retry shortly.", code: "rate-limited" },
          {
            status: 429,
            headers: {
              ...browserAccountResponseHeaders(),
              "Retry-After": "60"
            }
          }
        )
      };
    }
    recent.push(now);
    mutationAttempts.set(rateKey, recent);
  }

  return {
    actor: {
      userId: agentOsActor.actorId
    }
  };
}

export function browserAccountResponseHeaders() {
  return {
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
}

function isSafeMethod(method: string) {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}
