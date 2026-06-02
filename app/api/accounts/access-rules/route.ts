import { NextResponse } from "next/server";
import { z } from "zod";

import {
  listAccountAccessRules,
  replaceAccountAccessRulesForTarget
} from "@/lib/agentos/application/account-access-policy-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const accessRulesReplaceSchema = z.object({
  workspaceId: z.string().min(1),
  targetId: z.string().min(1),
  rules: z.array(z.object({
    agentId: z.string().min(1),
    agentName: z.string().min(1),
    permission: z.enum(["no_access", "use_browser_profile", "requires_approval"]),
    notes: z.string().nullable().optional()
  }))
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");
    const targetId = searchParams.get("targetId");

    return NextResponse.json(redactSecrets(await listAccountAccessRules({ workspaceId, targetId })));
  } catch (error) {
    return NextResponse.json(
      redactSecrets({
        ok: false,
        generatedAt: new Date().toISOString(),
        source: "agentos.account-access-policy",
        rules: [],
        error: redactErrorMessage(error, "Unable to read account access rules.")
      }),
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const input = accessRulesReplaceSchema.parse(await request.json());

    return NextResponse.json(redactSecrets(await replaceAccountAccessRulesForTarget(input)));
  } catch (error) {
    return NextResponse.json(
      redactSecrets({
        ok: false,
        generatedAt: new Date().toISOString(),
        source: "agentos.account-access-policy",
        rules: [],
        error: redactErrorMessage(error, "Unable to save account access rules.")
      }),
      { status: 400 }
    );
  }
}
