import { NextResponse } from "next/server";
import { z } from "zod";

import { submitWorkspaceDocumentRewrite } from "@/lib/agentos/planner";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const documentRewriteSchema = z.object({
  plan: z.any().optional(),
  path: z.string().min(1),
  currentContent: z.string().optional(),
  instruction: z.string().optional()
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
    const input = documentRewriteSchema.parse(await request.json());
    const result = await submitWorkspaceDocumentRewrite(planId, input);
    return NextResponse.json(redactSecrets(result));
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to rewrite planner document.")
      },
      { status: 400 }
    );
  }
}
