import { NextResponse } from "next/server";
import { z } from "zod";

import { listTelegramKnownGroups } from "@/lib/openclaw/application/telegram-known-groups-service";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  accountId: z.string().trim().min(1).max(128),
  workspaceId: z.string().trim().min(1).max(128).optional()
});

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;

  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
    const result = await listTelegramKnownGroups(query);
    return NextResponse.json(redactSecrets(result), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "The Telegram known-groups request is invalid."
      : redactErrorMessage(error, "OpenClaw Telegram group state is unavailable.");
    return NextResponse.json({ error: message }, {
      status: error instanceof z.ZodError ? 400 : 503,
      headers: { "Cache-Control": "no-store" }
    });
  }
}
