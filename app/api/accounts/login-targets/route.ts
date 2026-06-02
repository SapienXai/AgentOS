import { NextResponse } from "next/server";
import { z } from "zod";

import {
  deleteAccountLoginTarget,
  listAccountLoginTargets,
  upsertAccountLoginTarget
} from "@/lib/agentos/application/account-login-target-service";
import { deleteAccountAccessRulesForTarget } from "@/lib/agentos/application/account-access-policy-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const accountLoginTargetSchema = z.object({
  workspaceId: z.string().min(1),
  workspaceName: z.string().min(1),
  workspacePath: z.string().nullable().optional(),
  serviceId: z.string().min(1),
  serviceName: z.string().min(1),
  primaryDomain: z.string().min(1),
  loginUrl: z.string().min(1),
  browserProfileName: z.string().min(1)
});

const deleteLoginTargetSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().nullable().optional()
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    return NextResponse.json(redactSecrets(await listAccountLoginTargets({ workspaceId })));
  } catch (error) {
    return NextResponse.json(
      redactSecrets({
        ok: false,
        generatedAt: new Date().toISOString(),
        source: "agentos.account-login-targets",
        targets: [],
        error: redactErrorMessage(error, "Unable to read account login targets.")
      }),
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const input = accountLoginTargetSchema.parse(await request.json());
    return NextResponse.json(redactSecrets(await upsertAccountLoginTarget(input)));
  } catch (error) {
    return NextResponse.json(
      redactSecrets({
        ok: false,
        generatedAt: new Date().toISOString(),
        source: "agentos.account-login-targets",
        targets: [],
        error: redactErrorMessage(error, "Unable to save account login target.")
      }),
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const input = deleteLoginTargetSchema.parse(await request.json());
    await deleteAccountAccessRulesForTarget({
      targetId: input.id,
      workspaceId: input.workspaceId
    });
    return NextResponse.json(redactSecrets(await deleteAccountLoginTarget(input)));
  } catch (error) {
    return NextResponse.json(
      redactSecrets({
        ok: false,
        generatedAt: new Date().toISOString(),
        source: "agentos.account-login-targets",
        targets: [],
        error: redactErrorMessage(error, "Unable to remove account login target.")
      }),
      { status: 400 }
    );
  }
}
