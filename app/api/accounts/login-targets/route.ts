import { NextResponse } from "next/server";
import { z } from "zod";

import {
  deleteAccountLoginTarget,
  findAccountLoginTarget,
  listAccountLoginTargets,
  upsertAccountLoginTarget
} from "@/lib/agentos/application/account-login-target-service";
import { deleteAccountAccessRulesForTarget } from "@/lib/agentos/application/account-access-policy-service";
import { browserAccountResponseHeaders, requireBrowserAccountActor } from "@/lib/security/browser-account-route";
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
  const authorization = await requireBrowserAccountActor(request);
  if ("response" in authorization) return authorization.response;

  try {
    const { searchParams } = new URL(request.url);
    const workspaceId = searchParams.get("workspaceId");

    return NextResponse.json(redactSecrets(await listAccountLoginTargets({ workspaceId })), {
      headers: browserAccountResponseHeaders()
    });
  } catch (error) {
    return NextResponse.json(
      redactSecrets({
        ok: false,
        generatedAt: new Date().toISOString(),
        source: "agentos.account-login-targets",
        targets: [],
        error: redactErrorMessage(error, "Unable to read account login targets.")
      }),
      { status: 500, headers: browserAccountResponseHeaders() }
    );
  }
}

export async function POST(request: Request) {
  const authorization = await requireBrowserAccountActor(request);
  if ("response" in authorization) return authorization.response;

  try {
    const input = accountLoginTargetSchema.parse(await request.json());
    return NextResponse.json(redactSecrets(await upsertAccountLoginTarget(input)), {
      headers: browserAccountResponseHeaders()
    });
  } catch (error) {
    return NextResponse.json(
      redactSecrets({
        ok: false,
        generatedAt: new Date().toISOString(),
        source: "agentos.account-login-targets",
        targets: [],
        error: redactErrorMessage(error, "Unable to save account login target.")
      }),
      { status: 400, headers: browserAccountResponseHeaders() }
    );
  }
}

export async function DELETE(request: Request) {
  const authorization = await requireBrowserAccountActor(request);
  if ("response" in authorization) return authorization.response;

  try {
    const input = deleteLoginTargetSchema.parse(await request.json());
    const target = await findAccountLoginTarget(input);
    if (target) {
      await deleteAccountAccessRulesForTarget({
        targetId: target.id,
        workspaceId: target.workspaceId
      });
    }

    return NextResponse.json(redactSecrets(await deleteAccountLoginTarget(input)), {
      headers: browserAccountResponseHeaders()
    });
  } catch (error) {
    return NextResponse.json(
      redactSecrets({
        ok: false,
        generatedAt: new Date().toISOString(),
        source: "agentos.account-login-targets",
        targets: [],
        error: redactErrorMessage(error, "Unable to remove account login target.")
      }),
      { status: 400, headers: browserAccountResponseHeaders() }
    );
  }
}
