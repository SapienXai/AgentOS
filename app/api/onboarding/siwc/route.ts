import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  applySiwcModel, cancelSiwcFlow, getSiwcAuthorizationUrl, readSiwcFlow, readSiwcModelCatalog,
  retrySavedSiwcFlow, selectSiwcAccount, startSiwcFlow
} from "@/lib/openclaw/application/siwc-onboarding-service";
import { auditResultForNativeDoctorMutation, executeNativeDoctorMutation, getNativeDoctorSnapshot, reconcileNativeDoctorMutation } from "@/lib/openclaw/application/native-doctor-service";
import { resolveGatewayRuntimeIdentity } from "@/lib/openclaw/lifecycle/runtime-discovery";
import { SIWC_THINKING_LEVELS, type SiwcFailure } from "@/lib/openclaw/siwc-onboarding";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
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
  z.object({ action: z.literal("start"), fresh: z.boolean().optional() }).strict(),
  z.object({ action: z.literal("verify-saved") }).strict(),
  z.object({ action: z.literal("cancel") }).strict(),
  z.object({ action: z.literal("select"), index: z.number().int().nonnegative() }).strict(),
  z.object({
    action: z.literal("choose-model"), model: z.string().regex(/^openai\/[\w.-]{1,120}$/),
    thinking: z.enum(SIWC_THINKING_LEVELS).optional()
  }).strict()
]);

async function getOwner(request: Request) {
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
  return { key, actor };
}

async function restartAfterSignIn(request: Request, ownerKey: string, signal: AbortSignal) {
  const commandOptions = { signal };
  const before = await getNativeDoctorSnapshot({ commandOptions, discoverAvailability: false });
  const owner = await getOwner(request);
  signal.throwIfAborted();
  if (!owner.key || owner.key !== ownerKey || !requireOwnerProductPermission(owner.actor, "lifecycle.manage") ||
      before.identity.authenticated !== true || !before.identity.connectionId || !before.identity.deviceId ||
      before.identity.connectionGeneration === null) return false;

  const mutation = await executeNativeDoctorMutation({ action: "gateway.restart.request", input: {
    reason: "AgentOS ChatGPT setup credential recovery", skipDeferral: false
  } }, { commandOptions });
  const result = await reconcileNativeDoctorMutation(mutation, { before, commandOptions });
  await recordAgentOsAuditEvent({
    actor: owner.actor,
    operation: "gateway.restart.request",
    targetKind: "gateway",
    targetId: before.identity.connectionId,
    result: auditResultForNativeDoctorMutation(result.outcome, result.verification.status)
  }).catch(() => {});
  return result.verification.status === "verified";
}

export async function GET(request: Request) {
  const owner = await getOwner(request);
  if (owner.response) return owner.response;
  const query = new URL(request.url).searchParams;
  const authorize = query.get("authorize");
  if (authorize) {
    const desktop = query.get("desktop") === "1";
    const target = getSiwcAuthorizationUrl(owner.key, authorize, !desktop);
    if (!target) return failure("timeout", 410);
    if (desktop) return NextResponse.json({ url: target }, { headers });
    return NextResponse.redirect(target, { status: 303, headers });
  }
  if (query.get("models") === "1") {
    return NextResponse.json({ catalog: await readSiwcModelCatalog(owner.key) }, { headers });
  }
  return NextResponse.json({ state: readSiwcFlow(owner.key) }, { headers });
}

export async function POST(request: Request) {
  const blocked = await requireSameOriginMutation(request);
  if (blocked) return blocked;
  const owner = await getOwner(request);
  if (owner.response) return owner.response;
  const input = actionSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return failure("unsupported", 400);
  const ownerActive = async () => {
    const currentOwner = await getOwner(request);
    return currentOwner.key === owner.key;
  };
  if (input.data.action === "choose-model") {
    const result = await applySiwcModel(owner.key, input.data.model, input.data.thinking, ownerActive);
    return NextResponse.json({ result }, { status: result.ok ? 200 : 409, headers });
  }
  if (input.data.action === "start" || input.data.action === "verify-saved") {
    const restart = (signal: AbortSignal) => restartAfterSignIn(request, owner.key, signal);
    const state = input.data.action === "start"
      ? startSiwcFlow(owner.key, ownerActive, restart, input.data.fresh)
      : retrySavedSiwcFlow(owner.key, ownerActive, restart);
    return NextResponse.json({ state }, { headers });
  }
  if (input.data.action === "cancel") {
    await cancelSiwcFlow(owner.key);
  } else if (!selectSiwcAccount(owner.key, input.data.index)) {
    return failure("verification", 409);
  }
  return NextResponse.json({ state: readSiwcFlow(owner.key) }, { headers });
}

function failure(reason: SiwcFailure, status: number) {
  return NextResponse.json({ state: { phase: "failed", reason } }, { headers, status });
}
