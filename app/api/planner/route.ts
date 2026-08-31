import { NextResponse } from "next/server";

import { createWorkspacePlan } from "@/lib/agentos/planner";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "missions.use");
  if ("response" in permission) return permission.response;
  try {
    const result = await createWorkspacePlan();
    return NextResponse.json(redactSecrets(result));
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to create planner workspace.")
      },
      { status: 400 }
    );
  }
}
