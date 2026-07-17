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
    const result = input.action === "install-plugin"
      ? await installChannelPlugin(input.provider)
      : input.action === "web-login-start"
        ? await startChannelWebLogin(input)
      : input.action === "web-login-wait"
          ? await waitForChannelWebLogin(input)
          : input.action === "approve-pairing"
            ? await approveChannelPairing(input)
            : await logoutConnectedChannel(input);

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
