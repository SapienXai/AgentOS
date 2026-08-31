import { NextResponse } from "next/server";
import { z } from "zod";

import { prepareOpenClawMobilePairing } from "@/lib/openclaw/application/mobile-pairing-service";
import { redactErrorMessage } from "@/lib/security/redaction";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const mobilePairingSchema = z.object({
  network: z.enum(["current", "lan"])
});

const sensitiveResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "X-Content-Type-Options": "nosniff"
};
const mobilePairingGatewayMethod = "device.pair.setup" + "Code";

export async function POST(request: Request) {
  try {
    const input = mobilePairingSchema.parse(await request.json());
    const authorization = await requireAgentOsOpenClawPreflight(request, {
      operation: "device.pair.setup-code",
      method: mobilePairingGatewayMethod,
      targetKind: "gateway-device",
      securityClass: "privileged-mutation",
      executionPath: "gateway-or-verified-cli",
      productPermission: "gateway.manage"
    });
    if ("response" in authorization) return authorization.response;

    const pairing = await prepareOpenClawMobilePairing(input, authorization.commandOptions);

    return NextResponse.json({ pairing }, { headers: sensitiveResponseHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to prepare OpenClaw mobile pairing.") },
      { status: 400, headers: sensitiveResponseHeaders }
    );
  }
}
