import { NextResponse } from "next/server";
import { z } from "zod";

import {
  BrowserTaskBindingError,
  heartbeatBrowserTaskBinding
} from "@/lib/agentos/application/browser-task-binding-service";
import {
  browserPolicyResponseHeaders,
  requireBrowserPolicyChannel
} from "@/lib/security/browser-policy-channel";
import { redactErrorMessage } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const heartbeatSchema = z.object({
  openClawSessionKey: z.string().min(1).max(512),
  agentId: z.string().min(1).max(128)
}).strict();

export async function POST(request: Request) {
  const authorizationFailure = requireBrowserPolicyChannel(request);
  if (authorizationFailure) return authorizationFailure;

  try {
    const input = heartbeatSchema.parse(await request.json());
    const binding = await heartbeatBrowserTaskBinding(input);
    return NextResponse.json(
      { ok: true, binding },
      { headers: browserPolicyResponseHeaders() }
    );
  } catch (error) {
    const status = error instanceof BrowserTaskBindingError ? error.status : 400;
    const code = error instanceof BrowserTaskBindingError
      ? error.code
      : "browser-policy-heartbeat-invalid";
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Browser policy heartbeat failed."),
        code
      },
      { status, headers: browserPolicyResponseHeaders() }
    );
  }
}
