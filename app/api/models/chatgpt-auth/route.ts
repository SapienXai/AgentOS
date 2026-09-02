import { NextResponse } from "next/server";
import { z } from "zod";

import {
  ChatGptBrowserAuthError,
  getOpenClawChatGptBrowserAuth,
  startOpenClawChatGptBrowserAuth,
  submitOpenClawChatGptBrowserAuth
} from "@/lib/openclaw/application/chatgpt-provider-auth-service";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start"),
    force: z.boolean().optional()
  }),
  z.object({
    action: z.literal("submit"),
    sessionId: z.string().uuid(),
    redirectUrl: z.string().trim().min(1).max(4096)
  })
]);

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "secrets.manage");
  if ("response" in permission) return permission.response;

  const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim();

  if (!sessionId) {
    return NextResponse.json(
      { error: "ChatGPT sign-in session is required.", code: "chatgpt-auth-session-required" },
      { status: 400, headers: noStoreHeaders }
    );
  }

  try {
    return NextResponse.json(
      redactSecrets(getOpenClawChatGptBrowserAuth(sessionId)),
      { status: 200, headers: noStoreHeaders }
    );
  } catch (error) {
    return authErrorResponse(error);
  }
}

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "secrets.manage");
  if ("response" in permission) return permission.response;

  let input: z.infer<typeof requestSchema>;

  try {
    input = requestSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "ChatGPT sign-in action is required."),
        code: "chatgpt-auth-action-invalid"
      },
      { status: 400, headers: noStoreHeaders }
    );
  }

  try {
    const result = input.action === "start"
      ? await startOpenClawChatGptBrowserAuth({ force: input.force === true })
      : submitOpenClawChatGptBrowserAuth(input);

    return NextResponse.json(redactSecrets(result), { status: 200, headers: noStoreHeaders });
  } catch (error) {
    return authErrorResponse(error);
  }
}

const noStoreHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

function authErrorResponse(error: unknown) {
  const code = error instanceof ChatGptBrowserAuthError ? error.code : "chatgpt-auth-failed";

  return NextResponse.json(
    {
      error: redactErrorMessage(error, "ChatGPT sign-in could not be started."),
      code
    },
    { status: error instanceof ChatGptBrowserAuthError && code === "chatgpt-auth-redirect-invalid" ? 400 : 409, headers: noStoreHeaders }
  );
}
