import { NextResponse } from "next/server";
import { z } from "zod";

import { inspectGatewayBindRecovery, repairGatewayBindAddress } from "@/lib/openclaw/application/gateway-bind-recovery-service";
import { requireAgentOsActorContext } from "@/lib/security/agentos-actor";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { requireOwnerProductPermission } from "@/lib/security/agentos-product-authorization";
import { evaluateLocalOperatorRequest } from "@/lib/security/local-operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const confirmationSchema = z.object({
  previousAddress: z.string().ip({ version: "v4" }),
  nextAddress: z.string().ip({ version: "v4" }),
  port: z.number().int().min(1).max(65_535)
}).strict();

function noAccess() {
  return NextResponse.json({ error: "Sign in as an AgentOS owner to repair the local Gateway." }, { status: 403, headers });
}

function checkLocalRequest(request: Request) {
  return evaluateLocalOperatorRequest({
    method: request.method, url: request.url, headers: request.headers,
    allowSafeMethods: false, allowTrustedRemote: false
  }).ok;
}

export async function GET(request: Request) {
  if (!checkLocalRequest(request)) return noAccess();
  const auth = await requireAgentOsActorContext(request);
  if ("response" in auth) return auth.response;
  const owner = auth.actor.authenticated && requireOwnerProductPermission(auth.actor, "gateway.manage");
  if (!owner && auth.actor.authenticationMethod !== "unprotected-local") return noAccess();

  try {
    const status = await inspectGatewayBindRecovery();
    // An unprotected development page can show the warning, but never the host addresses.
    return NextResponse.json(owner || status.state === "none" ? status : { state: "owner-required" }, { headers });
  } catch {
    return NextResponse.json({ error: "AgentOS could not inspect the local Gateway address." }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  if (!checkLocalRequest(request)) return noAccess();
  const auth = await requireAgentOsActorContext(request);
  if ("response" in auth) return auth.response;
  if (!auth.actor.authenticated ||
      !requireOwnerProductPermission(auth.actor, "gateway.manage") ||
      !requireOwnerProductPermission(auth.actor, "lifecycle.manage")) return noAccess();

  const confirmation = confirmationSchema.safeParse(await request.json().catch(() => null));
  if (!confirmation.success) {
    return NextResponse.json({ error: "Review and confirm a valid Gateway address change." }, { status: 400, headers });
  }

  const audit = async (result: "succeeded" | "partial" | "failed") => {
    await recordAgentOsAuditEvent({
      actor: auth.actor, operation: "gateway.bind.repair.cli-recovery",
      targetKind: "gateway-config", targetId: "gateway.customBindHost", result
    }).catch(() => {});
  };
  try {
    const result = await repairGatewayBindAddress(confirmation.data);
    if (result.outcome === "stale" || result.outcome === "busy") {
      return NextResponse.json(result, { status: 409, headers });
    }
    await audit(result.outcome === "recovered" ? "succeeded" : "partial");
    return NextResponse.json(result, { status: result.outcome === "recovered" ? 200 : 409, headers });
  } catch {
    await audit("failed");
    return NextResponse.json({ error: "AgentOS could not verify the repair. Check the Gateway settings before trying again." }, { status: 503, headers });
  }
}
