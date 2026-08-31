import { NextResponse } from "next/server";
import { z } from "zod";

import {
  resetSessionModelOverride,
  resetSessionModelOverrides
} from "@/lib/openclaw/application/session-model-service";
import { redactSecretText, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sessionTargetSchema = z.object({
  sessionKey: z.string().min(1),
  agentId: z.string().min(1).optional()
});

const inputSchema = z.discriminatedUnion("action", [
  sessionTargetSchema.extend({ action: z.literal("inherit") }),
  z.object({
    action: z.literal("inherit-many"),
    sessions: z.array(sessionTargetSchema).min(1).max(50)
  })
]);

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "sessions.use");
  if ("response" in permission) return permission.response;
  try {
    const input = inputSchema.parse(await request.json());
    if (input.action === "inherit") {
      const snapshot = await resetSessionModelOverride(input);
      return NextResponse.json(redactSecrets({ ok: true, resetCount: 1, failures: [], snapshot }));
    }

    const result = await resetSessionModelOverrides(input);
    return NextResponse.json(redactSecrets({
      ok: result.failures.length === 0,
      ...result
    }));
  } catch (error) {
    const message = error instanceof Error ? redactSecretText(error.message) : "Unable to reset the session model override.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
