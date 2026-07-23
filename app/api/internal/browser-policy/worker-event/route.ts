import { NextResponse } from "next/server";
import { z } from "zod";

import { markBrowserWorkerSessionsInterrupted } from "@/lib/agentos/application/browser-account-service";
import { expireBrowserTaskBindingsForRecovery } from "@/lib/agentos/application/browser-task-binding-service";
import {
  browserPolicyResponseHeaders,
  requireBrowserPolicyChannel
} from "@/lib/security/browser-policy-channel";
import { redactErrorMessage } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const eventSchema = z.object({
  event: z.literal("worker-restarting")
}).strict();

export async function POST(request: Request) {
  const authorizationFailure = requireBrowserPolicyChannel(request);
  if (authorizationFailure) return authorizationFailure;

  try {
    eventSchema.parse(await request.json());
    const [accounts, bindings] = await Promise.all([
      markBrowserWorkerSessionsInterrupted(),
      expireBrowserTaskBindingsForRecovery()
    ]);
    return NextResponse.json(
      {
        ok: true,
        affectedAccounts: accounts.affectedAccounts,
        affectedBindings: bindings.affectedBindings
      },
      { headers: browserPolicyResponseHeaders() }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Browser worker recovery event failed."),
        code: "browser-worker-event-failed"
      },
      { status: 400, headers: browserPolicyResponseHeaders() }
    );
  }
}
