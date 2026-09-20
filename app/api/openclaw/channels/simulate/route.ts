import { NextResponse } from "next/server";
import { z } from "zod";

import { simulateChannelRoute } from "@/lib/openclaw/application/channel-route-simulator-service";
import { buildChannelRouteIdentity } from "@/lib/openclaw/domains/channel-center";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const routeSchema = z.object({
  provider: z.string().trim().min(1).max(80),
  accountId: z.string().trim().min(1).max(128),
  kind: z.enum(["dm", "group", "channel", "thread", "topic", "role", "peer"]),
  routeId: z.string().trim().min(1).max(256),
  parentRouteId: z.string().trim().max(256).nullable(),
  metadata: z.record(z.unknown()).optional()
}).strict();

const inputSchema = z.object({
  route: routeSchema,
  senderId: z.string().trim().max(128).nullable(),
  mentioned: z.boolean().nullable(),
  message: z.string().max(2_000).nullable().optional(),
  expectedAgentId: z.string().trim().max(128).nullable().optional()
}).strict();

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;

  try {
    const input = inputSchema.parse(await request.json());
    const result = await simulateChannelRoute({
      route: buildChannelRouteIdentity(input.route),
      senderId: input.senderId?.trim() || null,
      mentioned: input.mentioned,
      message: input.message ?? null,
      expectedAgentId: input.expectedAgentId?.trim() || null
    });

    return NextResponse.json(redactSecrets(result), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "The route simulation request is invalid."
      : redactErrorMessage(error, "The route simulation could not be completed.");
    return NextResponse.json({ error: message }, {
      status: error instanceof z.ZodError ? 400 : 503,
      headers: { "Cache-Control": "no-store" }
    });
  }
}
