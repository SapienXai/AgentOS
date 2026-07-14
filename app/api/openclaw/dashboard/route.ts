import { NextResponse } from "next/server";

import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { openOpenClawDashboard } from "@/lib/openclaw/application/gateway-service";
import { redactErrorMessage } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const snapshot = await getMissionControlSnapshot({ force: true });

    if (!snapshot.diagnostics.loaded) {
      return NextResponse.json(
        {
          error: "Start the OpenClaw Gateway before opening its Control UI."
        },
        { status: 409 }
      );
    }

    await openOpenClawDashboard();

    return NextResponse.json({
      message: "OpenClaw Control UI opened."
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to open the OpenClaw Control UI.")
      },
      { status: 500 }
    );
  }
}
