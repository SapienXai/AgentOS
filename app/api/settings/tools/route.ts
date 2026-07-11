import { NextResponse } from "next/server";
import { z } from "zod";

import {
  readOpenClawToolSettings,
  updateOpenClawToolSettings
} from "@/lib/openclaw/application/tool-settings-service";
import { redactErrorMessage } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const toolSettingsSchema = z.object({
  browserEnabled: z.boolean(),
  webFetchEnabled: z.boolean(),
  webSearchEnabled: z.boolean()
});

export async function GET() {
  try {
    return NextResponse.json({
      toolSettings: await readOpenClawToolSettings()
    });
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to inspect OpenClaw tool settings.") },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const input = toolSettingsSchema.parse(await request.json());
    return NextResponse.json({
      toolSettings: await updateOpenClawToolSettings(input)
    });
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to update OpenClaw tool settings.") },
      { status: 400 }
    );
  }
}
