import { NextResponse } from "next/server";
import { z } from "zod";

import { getConfigUpdatePacingSnapshot } from "@/lib/openclaw/application/config-pacing-service";
import { updateConfigUpdatePacingSettings } from "@/lib/openclaw/domains/control-plane-settings";
import { redactErrorMessage } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const configPacingSettingsSchema = z.object({
  mode: z.enum(["respect-gateway", "fast-local-testing", "custom"]),
  minimumIntervalMs: z.number().int().positive().max(10 * 60_000).optional().nullable()
});

export async function GET() {
  try {
    return NextResponse.json({
      configUpdatePacing: await getConfigUpdatePacingSnapshot()
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to inspect config update pacing.")
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "gateway.manage");
  if ("response" in permission) return permission.response;
  try {
    const input = configPacingSettingsSchema.parse(await request.json());
    await updateConfigUpdatePacingSettings(input);

    return NextResponse.json({
      configUpdatePacing: await getConfigUpdatePacingSnapshot()
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to update config update pacing.")
      },
      { status: 400 }
    );
  }
}
