import { NextResponse } from "next/server";
import { z } from "zod";

import {
  clearChannelRouteBinding,
  formatChannelRouteBindingError,
  migrateLegacyChannelRouteBindings,
  setChannelRouteBinding
} from "@/lib/openclaw/application/channel-route-binding-service";
import { buildChannelRouteIdentity } from "@/lib/openclaw/domains/channel-center";
import { readChannelRegistry } from "@/lib/openclaw/domains/channels";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const routeSchema = z.object({
  provider: z.string().trim().min(1).max(80),
  accountId: z.string().trim().min(1).max(128),
  kind: z.enum(["dm", "group", "channel", "thread", "topic", "role", "peer"]),
  routeId: z.string().trim().min(1).max(256),
  parentRouteId: z.string().trim().min(1).max(256).nullable().optional(),
  agentId: z.string().trim().min(1).max(128).nullable()
});

const migrationSchema = z.object({
  workspaceId: z.string().trim().min(1).max(128).nullable().optional()
});

export async function PATCH(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "gateway.manage");
  if ("response" in permission) return permission.response;

  try {
    const input = routeSchema.parse(await request.json());
    const route = buildChannelRouteIdentity(input);
    const authorization = await requireAgentOsOpenClawPreflight(request, {
      operation: "channel.route-binding.update",
      method: "config.patch",
      params: { route: { provider: route.provider, accountId: route.accountId, kind: route.kind, routeId: route.routeId, parentRouteId: route.parentRouteId } },
      targetKind: "openclaw-channel-route",
      targetId: `${route.provider}:${route.accountId}:${route.kind}:${route.parentRouteId ?? ""}:${route.routeId}`,
      securityClass: "privileged-mutation",
      executionPath: "gateway-or-verified-cli",
      productPermission: "gateway.manage"
    });
    if ("response" in authorization) return authorization.response;

    const result = input.agentId === null
      ? await clearChannelRouteBinding({ route })
      : await setChannelRouteBinding({ route, agentId: input.agentId });

    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "channel.route-binding.update",
      targetKind: "openclaw-channel-route",
      targetId: `${route.provider}:${route.accountId}:${route.kind}:${route.parentRouteId ?? ""}:${route.routeId}`,
      result: "succeeded"
    }).catch(() => {});

    return NextResponse.json(redactSecrets(presentBindingMutation(result)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "The channel route binding request is invalid."
      : formatChannelRouteBindingError(error);
    const status = error instanceof z.ZodError ? 400 : error instanceof Error && error.name === "ChannelRouteBindingConflictError" ? 409 : 400;
    return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "gateway.manage");
  if ("response" in permission) return permission.response;

  try {
    const input = migrationSchema.parse(await request.json().catch(() => ({})));
    const authorization = await requireAgentOsOpenClawPreflight(request, {
      operation: "channel.route-binding.migrate",
      method: "config.patch",
      params: { workspaceId: input.workspaceId ?? null },
      targetKind: "openclaw-channel-routing",
      targetId: input.workspaceId ?? "all-workspaces",
      securityClass: "privileged-mutation",
      executionPath: "gateway-or-verified-cli",
      productPermission: "gateway.manage"
    });
    if ("response" in authorization) return authorization.response;

    const result = await migrateLegacyChannelRouteBindings({
      registry: await readChannelRegistry(),
      workspaceId: input.workspaceId
    });

    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "channel.route-binding.migrate",
      targetKind: "openclaw-channel-routing",
      targetId: input.workspaceId ?? "all-workspaces",
      result: result.conflicts.length > 0 ? "partial" : "succeeded"
    }).catch(() => {});

    return NextResponse.json(redactSecrets(presentMigrationResult(result)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "The channel route migration request is invalid."
      : formatChannelRouteBindingError(error);
    return NextResponse.json({ error: message }, { status: error instanceof z.ZodError ? 400 : 400, headers: { "Cache-Control": "no-store" } });
  }
}

function presentBindingMutation(result: Awaited<ReturnType<typeof setChannelRouteBinding>>) {
  return {
    route: result.route,
    agentId: result.agentId,
    changed: result.changed,
    source: result.source,
    applyMode: result.applyMode,
    reloadKind: result.reloadKind,
    restartRequired: result.restartRequired,
    hotReloaded: result.hotReloaded,
    appliedVia: result.appliedVia,
    pending: result.pending
  };
}

function presentMigrationResult(result: Awaited<ReturnType<typeof migrateLegacyChannelRouteBindings>>) {
  return {
    changed: result.changed,
    migrated: result.migrated,
    skipped: result.skipped,
    conflicts: result.conflicts,
    mutation: result.mutation
      ? {
          changed: result.mutation.changed,
          applyMode: result.mutation.applyMode,
          reloadKind: result.mutation.reloadKind,
          restartRequired: result.mutation.restartRequired,
          hotReloaded: result.mutation.hotReloaded,
          appliedVia: result.mutation.appliedVia,
          pending: result.mutation.pending
        }
      : null
  };
}
