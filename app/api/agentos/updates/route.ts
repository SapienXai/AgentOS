import { NextResponse } from "next/server";
import { z } from "zod";

import { prepareAgentOsProductUpdate, getAgentOsProductUpdateSnapshot } from "@/lib/agentos/application/product-update-service";
import { requireSameOriginMutation } from "@/lib/security/instance-protection-route";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { canAgentOsActorUseProductPermission } from "@/lib/security/agentos-product-authorization";
import { AgentOsProductUpdateStoreError } from "@/lib/agentos/application/product-update-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const prepareSchema = z.strictObject({
  action: z.literal("prepare"),
  requestId: z.string().uuid(),
  nativeCheckId: z.string().uuid(),
  targetVersion: z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
});

export async function GET(request: Request) {
  const authorization = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in authorization) return authorization.response;
  const forceRefresh = new URL(request.url).searchParams.get("refresh") === "1";
  const snapshot = await getAgentOsProductUpdateSnapshot({
    canManageUpdates: canAgentOsActorUseProductPermission(authorization.actor, "updates.manage"),
    forceRefresh
  });
  return NextResponse.json({ snapshot }, {
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function POST(request: Request) {
  const blocked = requireSameOriginMutation(request);
  if (blocked) return blocked;
  const authorization = await requireAgentOsProductPermission(request, "updates.manage");
  if ("response" in authorization) return authorization.response;

  let input: z.infer<typeof prepareSchema>;
  try {
    input = prepareSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: "A valid Desktop update preparation request is required." }, {
      status: 400,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
    });
  }

  try {
    const receipt = await prepareAgentOsProductUpdate({
      ...input,
      actor: authorization.actor
    });
    return NextResponse.json({
      operationId: receipt.operationId,
      state: receipt.state,
      targetVersion: receipt.targetVersion,
      message: "Desktop update preparation is saved. The native updater will recheck the signed release before installation."
    }, {
      status: 202,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
    });
  } catch (error) {
    if (error instanceof AgentOsProductUpdateStoreError) {
      const status = error.code === "invalid" ? 400 : error.code === "conflict" || error.code === "replay" ? 409 : error.code === "unsupported" ? 501 : 503;
      return NextResponse.json({ error: error.message, code: error.code }, {
        status,
        headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
      });
    }
    return NextResponse.json({ error: "The AgentOS update could not be prepared." }, {
      status: 503,
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
    });
  }
}
