import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CHANNEL_CONNECT_PROVIDERS
} from "@/lib/openclaw/application/channel-connect-service";
import {
  getWorkspaceChannelSetupStatus,
  performWorkspaceChannelSetup
} from "@/lib/agentos/control-plane";
import {
  formatWorkspaceChannelSetupError,
  type WorkspaceChannelSetupAction
} from "@/lib/openclaw/application/workspace-channel-setup-service";
import { redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const setupSchema = z.object({
  action: z.enum(["install-plugin", "login-start", "login-wait", "configure", "bind", "start", "stop"]),
  provider: z.enum(CHANNEL_CONNECT_PROVIDERS),
  declarationId: z.string().trim().min(1).max(128).nullable().optional(),
  accountId: z.string().trim().min(1).max(128).nullable().optional(),
  name: z.string().trim().min(1).max(160).nullable().optional(),
  token: z.string().max(4096).nullable().optional(),
  botToken: z.string().max(4096).nullable().optional(),
  appToken: z.string().max(4096).nullable().optional(),
  primaryAgentId: z.string().trim().max(256).nullable().optional(),
  currentQrDataUrl: z.string().max(500_000).nullable().optional()
});

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;

  try {
    const { workspaceId } = await context.params;
    return NextResponse.json(redactSecrets(await getWorkspaceChannelSetupStatus(workspaceId)), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return setupErrorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const permission = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in permission) return permission.response;

  try {
    const { workspaceId } = await context.params;
    const input = setupSchema.parse(await request.json());
    const method = resolvePreflightMethod(input.action);

    if (method) {
      const preflight = await requireAgentOsOpenClawPreflight(request, {
        operation: `workspace-channel-setup.${input.action}`,
        method,
        params: {
          channel: input.provider,
          accountId: input.accountId ?? undefined,
          provider: input.provider
        },
        targetKind: "workspace-channel",
        targetId: `${workspaceId}:${input.provider}:${input.declarationId ?? input.accountId ?? "default"}`,
        securityClass: "privileged-mutation",
        executionPath: input.action === "start" || input.action === "stop" ? "gateway-native" : "gateway-or-verified-cli",
        productPermission: "gateway.manage"
      });
      if ("response" in preflight) return preflight.response;

      const result = await performWorkspaceChannelSetup(
        {
          workspaceId,
          ...input
        },
        preflight.commandOptions
      );
      return NextResponse.json(redactSecrets(result), {
        headers: { "Cache-Control": "no-store" }
      });
    }

    const result = await performWorkspaceChannelSetup({
      workspaceId,
      ...input
    });
    return NextResponse.json(redactSecrets(result), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return setupErrorResponse(error);
  }
}

function resolvePreflightMethod(action: WorkspaceChannelSetupAction) {
  switch (action) {
    case "install-plugin":
      return "plugins.install";
    case "login-start":
      return "web.login.start";
    case "login-wait":
      return "web.login.wait";
    case "configure":
      return "channels.add";
    case "start":
      return "channels.start";
    case "stop":
      return "channels.stop";
    case "bind":
      return null;
  }
}

function setupErrorResponse(error: unknown) {
  const statusCode = error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number"
    ? error.statusCode
    : 400;
  return NextResponse.json(
    { error: formatWorkspaceChannelSetupError(error) },
    { status: statusCode, headers: { "Cache-Control": "no-store" } }
  );
}
