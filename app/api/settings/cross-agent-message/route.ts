import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getCrossAgentMessageSettings,
  updateCrossAgentMessageSettings
} from "@/lib/agentos/control-plane";
import { redactErrorMessage } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const crossAgentMessageSettingsSchema = z.object({
  enabled: z.boolean(),
  targetAgentId: z.string().min(1).optional(),
  knownTargetAgentIds: z.array(z.string().min(1)).optional()
});

export async function GET() {
  try {
    return NextResponse.json({
      settings: await getCrossAgentMessageSettings()
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to inspect cross-agent message settings.")
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const input = crossAgentMessageSettingsSchema.parse(await request.json());

    return NextResponse.json({
      settings: await updateCrossAgentMessageSettings(input)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to update cross-agent message settings.")
      },
      { status: 400 }
    );
  }
}
