import { NextResponse } from "next/server";
import { z } from "zod";

import { simulateWorkspacePlan } from "@/lib/agentos/planner";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const simulateSchema = z.object({
  plan: z.any().optional()
});

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      planId: string;
    }>;
  }
) {
  const permission = await requireAgentOsProductPermission(request, "missions.use");
  if ("response" in permission) return permission.response;

  try {
    const { planId } = await context.params;
    const input = simulateSchema.parse(await request.json());
    const result = await simulateWorkspacePlan(planId, input.plan);
    return NextResponse.json(redactSecrets(result));
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to simulate planner team.")
      },
      { status: 400 }
    );
  }
}
