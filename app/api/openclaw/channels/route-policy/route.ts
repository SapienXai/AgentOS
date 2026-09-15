import { NextResponse } from "next/server";
import { z } from "zod";

import {
  formatTelegramRoutePolicyError,
  updateTelegramRoutePolicy
} from "@/lib/openclaw/application/channel-route-policy-service";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  provider: z.literal("telegram"),
  accountId: z.string().trim().min(1).max(128),
  groupId: z.string().trim().min(1).max(256),
  topicId: z.string().trim().min(1).max(128).nullable().optional(),
  patch: z.object({
    enabled: z.boolean().nullable().optional(),
    requireMention: z.boolean().nullable().optional(),
    groupPolicy: z.enum(["open", "allowlist", "disabled"]).nullable().optional(),
    allowFrom: z.array(z.string().trim().min(1).max(256)).max(200).nullable().optional(),
    agentId: z.string().trim().min(1).max(128).nullable().optional()
  }).refine((patch) => Object.keys(patch).length > 0, "At least one route policy field is required.")
});

export async function PATCH(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "gateway.manage");
  if ("response" in permission) return permission.response;

  try {
    const input = inputSchema.parse(await request.json());
    const authorization = await requireAgentOsOpenClawPreflight(request, {
      operation: "channel.route-policy.update",
      method: "config.patch",
      params: {
        provider: input.provider,
        accountId: input.accountId,
        groupId: input.groupId,
        topicId: input.topicId ?? null
      },
      targetKind: "openclaw-channel-route",
      targetId: `${input.provider}:${input.accountId}:${input.groupId}:${input.topicId ?? "group"}`,
      securityClass: "privileged-mutation",
      executionPath: "gateway-or-verified-cli",
      productPermission: "gateway.manage"
    });
    if ("response" in authorization) return authorization.response;

    const result = await updateTelegramRoutePolicy({
      accountId: input.accountId,
      groupId: input.groupId,
      topicId: input.topicId,
      patch: input.patch
    });

    return NextResponse.json(redactSecrets({
      provider: result.provider,
      accountId: result.accountId,
      groupId: result.groupId,
      topicId: result.topicId,
      changedFields: result.changedFields,
      restartRequired: result.restartRequired
    }));
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "The Telegram route policy request is invalid."
      : formatTelegramRoutePolicyError(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

