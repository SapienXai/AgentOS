import { NextResponse } from "next/server";
import { z } from "zod";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  formatTelegramGroupError,
  registerAndConnectTelegramGroup,
  TelegramGroupBindingConflictError,
  TelegramGroupIdError,
  TelegramGroupVerificationError
} from "@/lib/openclaw/application/telegram-group-service";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  accountId: z.string().trim().min(1).max(128),
  groupId: z.string().trim().min(1).max(128),
  agentId: z.string().trim().min(1).max(128)
});

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "gateway.manage");
  if ("response" in permission) return permission.response;

  try {
    const input = requestSchema.parse(await request.json());
    const authorization = await requireAgentOsOpenClawPreflight(request, {
      operation: "channel.telegram-group.add-and-connect",
      method: "config.patch",
      params: {
        provider: "telegram",
        accountId: input.accountId,
        groupId: input.groupId,
        agentId: input.agentId
      },
      targetKind: "openclaw-telegram-group",
      targetId: `telegram:${input.accountId}:${input.groupId}`,
      securityClass: "privileged-mutation",
      executionPath: "gateway-or-verified-cli",
      productPermission: "gateway.manage"
    });
    if ("response" in authorization) return authorization.response;

    const result = await registerAndConnectTelegramGroup({
      ...input,
      adapter: getOpenClawAdapter()
    });

    await recordAgentOsAuditEvent({
      actor: authorization.actor,
      operation: "channel.telegram-group.add-and-connect",
      targetKind: "openclaw-telegram-group",
      targetId: `telegram:${result.registration.accountId}:${result.registration.groupId}`,
      result: "succeeded"
    }).catch(() => {});

    return NextResponse.json(redactSecrets({
      group: {
        accountId: result.registration.accountId,
        groupId: result.registration.groupId,
        configPath: result.registration.configPath,
        changed: result.registration.changed,
        mutation: result.registration.mutation,
        verification: result.registration.verification
      },
      binding: {
        agentId: result.binding.agentId,
        changed: result.binding.changed,
        configPath: result.binding.configPath,
        applyMode: result.binding.applyMode,
        reloadKind: result.binding.reloadKind,
        restartRequired: result.binding.restartRequired,
        hotReloaded: result.binding.hotReloaded,
        appliedVia: result.binding.appliedVia,
        pending: result.binding.pending,
        verification: result.bindingVerification
      }
    }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "The Telegram group connection request is invalid."
      : formatTelegramGroupError(error);
    const status = error instanceof z.ZodError || error instanceof TelegramGroupIdError
      ? 400
      : error instanceof TelegramGroupBindingConflictError
        ? 409
        : error instanceof TelegramGroupVerificationError
          ? 503
          : 503;

    return NextResponse.json({
      error: message,
      ...(error instanceof TelegramGroupBindingConflictError
        ? {
            code: "telegram-group-binding-conflict",
            existingAgentId: error.existingAgentId,
            effectiveMatch: error.resolution.effectiveMatch
          }
        : {})
    }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
