import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  cancelSiwcFlow, getSiwcAuthorizationUrl, readSiwcFlow, selectSiwcAccount, startSiwcFlow
} from "@/lib/openclaw/application/siwc-onboarding-service";
import { resolveGatewayRuntimeIdentity } from "@/lib/openclaw/lifecycle/runtime-discovery";
import type { SiwcFailure } from "@/lib/openclaw/siwc-onboarding";
import { readInstanceSessionCookie } from "@/lib/security/instance-protection";
import { requireSameOriginMutation } from "@/lib/security/instance-protection-route";
import { evaluateLocalOperatorRequest, isLoopbackHost } from "@/lib/security/local-operator";
import { requireAgentOsProductPermission, requireOwnerProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff"
};
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start") }).strict(),
  z.object({ action: z.literal("cancel") }).strict(),
  z.object({ action: z.literal("select"), index: z.number().int().nonnegative() }).strict()
]);

async function getOwner(request: Request): Promise<{ key: string } | { response: NextResponse }> {
  const permission = await requireAgentOsProductPermission(request, "secrets.manage");
  if ("response" in permission || !permission.actor.authenticated ||
      !requireOwnerProductPermission(permission.actor, "secrets.manage")) {
    return { response: failure("owner", 403) };
  }
  const actor = permission.actor;
  const runtime = resolveGatewayRuntimeIdentity();
  const localBrowser = evaluateLocalOperatorRequest({
    method: request.method, url: request.url, headers: request.headers,
    allowSafeMethods: false, allowTrustedRemote: false
  }).ok;
  if (runtime.deploymentMode !== "local" || runtime.ownership !== "agentos-managed" ||
      !isLoopbackHost(new URL(runtime.gatewayUrl).host) ||
      !localBrowser) {
    return { response: failure("local-required", 409) };
  }
  const cookie = readInstanceSessionCookie(request.headers);
  if (actor.authenticationMethod === "instance-session" && !cookie) return { response: failure("owner", 403) };
  const key = createHash("sha256").update(JSON.stringify([actor.actorId, actor.authenticationMethod, cookie ?? null])).digest("hex");
  return { key };
}

export async function GET(request: Request) {
  const owner = await getOwner(request);
  if ("response" in owner) return owner.response;
  const query = new URL(request.url).searchParams;
  const authorize = query.get("authorize");
  if (authorize) {
    const target = getSiwcAuthorizationUrl(owner.key, authorize);
    if (!target) return failure("timeout", 410);
    if (query.get("desktop") === "1") return NextResponse.json({ url: target }, { headers });
    return NextResponse.redirect(target, { status: 303, headers });
  }
  return NextResponse.json({ state: readSiwcFlow(owner.key) }, { headers });
}

export async function POST(request: Request) {
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;
  const owner = await getOwner(request);
  if ("response" in owner) return owner.response;
  const input = actionSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return failure("unsupported", 400);
  if (input.data.action === "start") {
    const state = startSiwcFlow(owner.key, async () => {
      const currentOwner = await getOwner(request);
      return "key" in currentOwner && currentOwner.key === owner.key;
    });
    return NextResponse.json({ state }, { headers });
  }
  if (input.data.action === "cancel") {
    cancelSiwcFlow(owner.key);
  } else if (!selectSiwcAccount(owner.key, input.data.index)) {
    return failure("verification", 409);
  }
  return NextResponse.json({ state: readSiwcFlow(owner.key) }, { headers });
}

function failure(reason: SiwcFailure, status: number) {
  return NextResponse.json({ state: { phase: "failed", reason } }, { headers, status });
}
