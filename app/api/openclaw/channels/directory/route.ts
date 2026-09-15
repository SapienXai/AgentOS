import { NextResponse } from "next/server";
import { z } from "zod";

import {
  listChannelGroupMembers,
  listChannelGroups,
  listChannelPeers,
  listTelegramTopics
} from "@/lib/openclaw/application/channel-directory-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  provider: z.string().trim().min(1).max(80),
  accountId: z.string().trim().min(1).max(128),
  kind: z.enum(["peers", "groups", "members", "topics"]),
  groupId: z.string().trim().min(1).max(256).optional(),
  query: z.string().trim().max(256).optional(),
  limit: z.coerce.number().int().positive().max(500).optional()
});

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;

  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
    if (query.kind === "members" && !query.groupId) {
      return NextResponse.json({ error: "A group is required to list members." }, { status: 400 });
    }
    if (query.kind === "topics" && query.provider !== "telegram") {
      return NextResponse.json({ error: "Topics are currently supported only for Telegram." }, { status: 400 });
    }

    const result = query.kind === "peers"
      ? await listChannelPeers(query)
      : query.kind === "groups"
        ? await listChannelGroups(query)
        : query.kind === "members"
          ? await listChannelGroupMembers({ ...query, groupId: query.groupId! })
          : await listTelegramTopics({
              accountId: query.accountId,
              groupId: query.groupId!,
              query: query.query,
              limit: query.limit
            });

    return NextResponse.json(redactSecrets(result), {
      status: result.status === "failed" ? 503 : 200,
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "The channel directory request is invalid."
      : redactErrorMessage(error, "OpenClaw channel directory is unavailable.");
    return NextResponse.json({ error: message }, { status: error instanceof z.ZodError ? 400 : 503 });
  }
}

