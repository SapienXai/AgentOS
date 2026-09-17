import { NextResponse } from "next/server";
import { z } from "zod";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  getTelegramGroupBroadcast,
  setTelegramGroupBroadcast,
  TelegramGroupBroadcastError
} from "@/lib/openclaw/application/telegram-group-broadcast-service";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  accountId: z.string().trim().min(1).max(128),
  groupId: z.string().trim().min(1).max(128)
});

const patchSchema = querySchema.extend({
  agentIds: z.array(z.string().trim().min(1).max(128)).max(16),
  strategy: z.enum(["parallel", "sequential"]).optional(),
  mentionGating: z.boolean().optional(),
  maxRounds: z.number().int().min(1).max(4).optional(),
  maxTurns: z.number().int().min(1).max(32).nullable().optional()
}).superRefine((value, context) => {
  if (new Set(value.agentIds).size !== value.agentIds.length) {
    context.addIssue({ code: "custom", path: ["agentIds"], message: "Broadcast agent IDs must be unique." });
  }
});

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;

  try {
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
    const broadcast = await getTelegramGroupBroadcast({ groupId: input.groupId });
    return NextResponse.json(redactSecrets({ accountId: input.accountId, groupId: input.groupId, broadcast }), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "The Telegram group broadcast request is invalid."
      : redactErrorMessage(error, "OpenClaw Telegram broadcast state is unavailable.");
    return NextResponse.json({ error: message }, {
      status: error instanceof z.ZodError ? 400 : 503,
      headers: { "Cache-Control": "no-store" }
    });
  }
}

export async function PATCH(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "gateway.manage");
  if ("response" in permission) return permission.response;

  let input: z.infer<typeof patchSchema> | null = null;
  try {
    input = patchSchema.parse(await request.json());
    const authorization = await requireAgentOsOpenClawPreflight(request, {
      operation: "channel.telegram-group.broadcast.update",
      method: "config.patch",
      params: {
        provider: "telegram",
        accountId: input.accountId,
        groupId: input.groupId,
        agentIds: input.agentIds,
        strategy: input.strategy ?? "parallel"
      },
      targetKind: "openclaw-telegram-group-broadcast",
      targetId: `telegram:${input.accountId}:${input.groupId}`,
      securityClass: "privileged-mutation",
      executionPath: "gateway-or-verified-cli",
      productPermission: "gateway.manage"
    });
    if ("response" in authorization) return authorization.response;

    const result = await setTelegramGroupBroadcast({
      groupId: input.groupId,
      agentIds: input.agentIds,
      strategy: input.strategy,
      mentionGating: input.mentionGating,
      maxRounds: input.maxRounds,
      maxTurns: input.maxTurns,
      adapter: getOpenClawAdapter()
    });

    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "channel.telegram-group.broadcast.update",
      targetKind: "openclaw-telegram-group-broadcast",
      targetId: `telegram:${input.accountId}:${result.groupId}`,
      result: "succeeded"
    }).catch(() => {});

    return NextResponse.json(redactSecrets(result), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "The Telegram group broadcast request is invalid."
      : error instanceof TelegramGroupBroadcastError
        ? error.message
        : redactErrorMessage(error, "OpenClaw could not update the Telegram broadcast group.");
    return NextResponse.json({ error: message }, {
      status: error instanceof z.ZodError ? 400 : 503,
      headers: { "Cache-Control": "no-store" }
    });
  }
}
