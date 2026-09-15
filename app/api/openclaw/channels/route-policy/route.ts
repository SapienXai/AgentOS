import { NextResponse } from "next/server";
import { z } from "zod";

import {
  formatChannelRoutePolicyError,
  updateChannelRoutePolicy
} from "@/lib/openclaw/application/channel-route-policy-service";
import { buildChannelRouteIdentity } from "@/lib/openclaw/domains/channel-center";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const inputSchema = z.object({
  provider: z.string().trim().min(1).max(80),
  accountId: z.string().trim().min(1).max(128),
  kind: z.enum(["dm", "group", "channel", "thread", "topic", "role", "peer"]).optional(),
  routeId: z.string().trim().min(1).max(256).optional(),
  parentRouteId: z.string().trim().min(1).max(256).nullable().optional(),
  // Legacy Telegram-shaped input remains accepted as a compatibility bridge.
  groupId: z.string().trim().min(1).max(256).optional(),
  topicId: z.string().trim().min(1).max(128).nullable().optional(),
  patch: z.object({
    enabled: z.boolean().nullable().optional(),
    requireMention: z.boolean().nullable().optional(),
    groupPolicy: z.enum(["open", "allowlist", "disabled"]).nullable().optional(),
    allowFrom: z.array(z.string().trim().min(1).max(256)).max(200).nullable().optional(),
    agentId: z.string().trim().min(1).max(128).nullable().optional()
  }).refine((patch) => Object.keys(patch).length > 0, "At least one route policy field is required.")
}).refine((input) => Boolean(input.routeId || input.groupId), "A route is required.");

export async function PATCH(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "gateway.manage");
  if ("response" in permission) return permission.response;

  try {
    const input = inputSchema.parse(await request.json());
    const route = buildChannelRouteIdentity({
      provider: input.provider,
      accountId: input.accountId,
      kind: input.kind ?? (input.topicId ? "topic" : "group"),
      routeId: input.routeId ?? input.topicId ?? input.groupId!,
      parentRouteId: input.parentRouteId ?? (input.topicId ? input.groupId ?? null : null)
    });
    const authorization = await requireAgentOsOpenClawPreflight(request, {
      operation: "channel.route-policy.update",
      method: "config.patch",
      params: {
        route
      },
      targetKind: "openclaw-channel-route",
      targetId: `${route.provider}:${route.accountId}:${route.kind}:${route.parentRouteId ?? ""}:${route.routeId}`,
      securityClass: "privileged-mutation",
      executionPath: "gateway-or-verified-cli",
      productPermission: "gateway.manage"
    });
    if ("response" in authorization) return authorization.response;

    const result = await updateChannelRoutePolicy({ route, patch: input.patch });

    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "channel.route-policy.update",
      targetKind: "openclaw-channel-route",
      targetId: `${route.provider}:${route.accountId}:${route.kind}:${route.parentRouteId ?? ""}:${route.routeId}`,
      result: "succeeded"
    }).catch(() => {});

    return NextResponse.json(redactSecrets({
      provider: result.provider,
      accountId: result.accountId,
      route: result.route,
      groupId: result.groupId,
      topicId: result.topicId,
      changedFields: result.changedFields,
      applyMode: result.applyMode,
      reloadKind: result.reloadKind,
      restartRequired: result.restartRequired,
      hotReloaded: result.hotReloaded,
      appliedVia: result.appliedVia,
      pending: result.pending
    }));
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "The channel route policy request is invalid."
      : formatChannelRoutePolicyError(error);
    const status = error instanceof z.ZodError ? 400 : error instanceof Error && /changed since|conflict|ambiguous/i.test(error.message) ? 409 : 503;
    return NextResponse.json({ error: message }, { status });
  }
}
