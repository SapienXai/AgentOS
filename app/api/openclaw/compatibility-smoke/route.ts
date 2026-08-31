import { NextResponse } from "next/server";

import {
  getLatestOpenClawCompatibilitySmokeReport,
  runOpenClawCompatibilitySmokeTest
} from "@/lib/openclaw/application/compatibility-smoke-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;
  try {
    const report = await getLatestOpenClawCompatibilitySmokeReport();

    return NextResponse.json({
      report: redactSecrets(report)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to read the OpenClaw compatibility smoke test report.")
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "gateway.manage");
  if ("response" in permission) return permission.response;
  try {
    const report = await runOpenClawCompatibilitySmokeTest();

    return NextResponse.json({
      report: redactSecrets(report)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to run the OpenClaw compatibility smoke test.")
      },
      { status: 500 }
    );
  }
}
