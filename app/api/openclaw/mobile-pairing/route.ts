import { NextResponse } from "next/server";
import { z } from "zod";

import { prepareOpenClawMobilePairing } from "@/lib/openclaw/application/mobile-pairing-service";
import { redactErrorMessage } from "@/lib/security/redaction";

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

export async function POST(request: Request) {
  try {
    const input = mobilePairingSchema.parse(await request.json());
    const pairing = await prepareOpenClawMobilePairing(input);

    return NextResponse.json({ pairing }, { headers: sensitiveResponseHeaders });
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to prepare OpenClaw mobile pairing.") },
      { status: 400, headers: sensitiveResponseHeaders }
    );
  }
}
