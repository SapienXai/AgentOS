import { NextResponse } from "next/server";
import { z } from "zod";

import {
  CHANNEL_CONNECT_PROVIDERS,
  approveChannelPairing,
  getChannelConnectOverview,
  installChannelPlugin,
  logoutConnectedChannel,
  startChannelWebLogin,
  waitForChannelWebLogin
} from "@/lib/openclaw/application/channel-connect-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const providerSchema = z.enum(CHANNEL_CONNECT_PROVIDERS);
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("install-plugin"), provider: providerSchema }),
  z.object({
    action: z.literal("web-login-start"),
    provider: providerSchema,
    accountId: z.string().max(128).optional(),
    force: z.boolean().optional()
  }),
  z.object({
    action: z.literal("web-login-wait"),
    provider: providerSchema,
    accountId: z.string().max(128).optional(),
    currentQrDataUrl: z.string().max(1_000_000).optional()
  }),
  z.object({
    action: z.literal("logout"),
    provider: providerSchema,
    accountId: z.string().max(128).optional()
  }),
  z.object({
    action: z.literal("approve-pairing"),
    provider: providerSchema,
    accountId: z.string().max(128).optional(),
    code: z.string().min(4).max(32)
  })
]);

export async function GET() {
  try {
    return NextResponse.json(redactSecrets(await getChannelConnectOverview()), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to inspect OpenClaw channels.") },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}

export async function POST(request: Request) {
  try {
    const input = actionSchema.parse(await request.json());
    const accountId = "accountId" in input ? input.accountId : undefined;
    const authorization = await requireAgentOsOpenClawPreflight(request, {
      operation: `channel.${input.action}`,
      method: input.action === "install-plugin"
        ? "plugins.install"
        : input.action === "web-login-start"
          ? "web.login.start"
          : input.action === "web-login-wait"
            ? "web.login.wait"
            : input.action === "logout"
              ? "channels.logout"
              : "channels.pairing.approve",
      params: input.action === "approve-pairing"
        ? { provider: input.provider, accountId: input.accountId, code: input.code }
        : { provider: input.provider, accountId },
      targetKind: "openclaw-channel",
      targetId: accountId ?? input.provider,
      securityClass: "privileged-mutation",
      executionPath: "gateway-or-verified-cli",
      productPermission: "gateway.manage"
    });
    if ("response" in authorization) return authorization.response;

    const result = input.action === "install-plugin"
      ? await installChannelPlugin(input.provider, authorization.commandOptions)
      : input.action === "web-login-start"
        ? await startChannelWebLogin(input, authorization.commandOptions)
      : input.action === "web-login-wait"
          ? await waitForChannelWebLogin(input, authorization.commandOptions)
          : input.action === "approve-pairing"
            ? await approveChannelPairing(input, authorization.commandOptions)
            : await logoutConnectedChannel(input, authorization.commandOptions);

    return NextResponse.json(redactSecrets({ result }), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof z.ZodError
      ? "The channel connection request is invalid."
      : redactErrorMessage(error, "OpenClaw could not complete the channel action.");
    return NextResponse.json({ error: message }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
