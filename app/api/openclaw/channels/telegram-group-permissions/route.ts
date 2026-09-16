import { NextResponse } from "next/server";
import { z } from "zod";

import {
  readTelegramGroupPermissions,
  updateTelegramGroupPermissions,
  type TelegramGroupPermissionPatch
} from "@/lib/openclaw/application/telegram-group-permissions-service";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  accountId: z.string().trim().min(1).max(128),
  groupId: z.string().trim().min(1).max(64),
  agentId: z.string().trim().min(1).max(128)
});

const patchSchema = z.object({
  access: z.object({
    mode: z.enum(["anyone", "selected", "nobody"]),
    senderIds: z.array(z.string().trim().min(1).max(64)).max(200).optional()
  }).optional(),
  requireMention: z.boolean().nullable().optional(),
  capabilities: z.object({
    preset: z.enum(["agent-defaults", "chat-only", "research", "selected-tools"]),
    toolIds: z.array(z.string().trim().min(1).max(256)).max(200).optional()
  }).optional(),
  memberOverrides: z.record(z.string().trim().min(1).max(256), z.object({
    allow: z.array(z.string().trim().min(1).max(256)).max(200).optional(),
    alsoAllow: z.array(z.string().trim().min(1).max(256)).max(200).optional(),
    deny: z.array(z.string().trim().min(1).max(256)).max(200).optional()
  })).nullable().optional(),
  skills: z.array(z.string().trim().min(1).max(256)).max(200).nullable().optional(),
  systemPrompt: z.string().max(20_000).nullable().optional()
}).refine((patch) => Object.keys(patch).length > 0, "At least one Telegram group permission field is required.");

const mutationInputSchema = z.object({
  accountId: z.string().trim().min(1).max(128),
  groupId: z.string().trim().min(1).max(64),
  agentId: z.string().trim().min(1).max(128),
  patch: patchSchema
});

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;

  try {
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams.entries()));
    const result = await readTelegramGroupPermissions(query);
    return NextResponse.json(redactSecrets(result), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "The Telegram group permissions request is invalid."
      : redactErrorMessage(error, "OpenClaw Telegram group permissions are unavailable.");
    return NextResponse.json({ error: message }, {
      status: error instanceof z.ZodError ? 400 : 503,
      headers: { "Cache-Control": "no-store" }
    });
  }
}

export async function PATCH(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "gateway.manage");
  if ("response" in permission) return permission.response;

  try {
    const input = mutationInputSchema.parse(await request.json());
    const targetId = `telegram:${input.accountId}:group:${input.groupId}`;
    const authorization = await requireAgentOsOpenClawPreflight(request, {
      operation: "channel.telegram-group-permissions.update",
      method: "config.patch",
      params: {
        accountId: input.accountId,
        groupId: input.groupId,
        agentId: input.agentId,
        changedFields: Object.keys(input.patch)
      },
      targetKind: "openclaw-telegram-group-permissions",
      targetId,
      securityClass: "privileged-mutation",
      executionPath: "gateway-or-verified-cli",
      productPermission: "gateway.manage"
    });
    if ("response" in authorization) return authorization.response;

    const result = await updateTelegramGroupPermissions({
      accountId: input.accountId,
      groupId: input.groupId,
      agentId: input.agentId,
      patch: input.patch as TelegramGroupPermissionPatch
    });

    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "channel.telegram-group-permissions.update",
      targetKind: "openclaw-telegram-group-permissions",
      targetId,
      result: "succeeded"
    }).catch(() => {});

    return NextResponse.json(redactSecrets({
      ok: true,
      accountId: result.accountId,
      groupId: result.groupId,
      changedFields: result.changedFields,
      configPath: result.configPath,
      groupPath: result.groupPath,
      mutation: result.mutation,
      permissions: result.permissions
    }));
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "The Telegram group permission request is invalid."
      : redactErrorMessage(error, "OpenClaw could not update Telegram group permissions.");
    const status = error instanceof z.ZodError
      ? 400
      : error instanceof Error && /changed since|conflict|ambiguous/i.test(error.message)
        ? 409
        : 503;
    return NextResponse.json({ error: message }, { status });
  }
}
