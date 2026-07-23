import { NextResponse } from "next/server";
import { z } from "zod";

import {
  listOpenClawBrowserProfiles,
  openLoginUrlInOpenClawBrowserProfile,
  startOpenClawBrowserProfile
} from "@/lib/openclaw/application/browser-profile-service";
import { resolveAgentOsDeploymentCapabilities } from "@/lib/agentos/deployment-capabilities";
import { browserAccountResponseHeaders, requireBrowserAccountActor } from "@/lib/security/browser-account-route";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const browserProfileMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("start-profile"),
    profileName: z.string().min(1)
  }),
  z.object({
    action: z.literal("open-login"),
    profileName: z.string().min(1),
    loginUrl: z.string().min(1),
    label: z.string().optional()
  })
]);

export async function GET(request: Request) {
  const authorization = await requireBrowserAccountActor(request);
  if ("response" in authorization) return authorization.response;

  try {
    return NextResponse.json(redactSecrets(await listOpenClawBrowserProfiles()), {
      headers: browserAccountResponseHeaders()
    });
  } catch (error) {
    return NextResponse.json(
      redactSecrets({
        ok: false,
        generatedAt: new Date().toISOString(),
        source: "openclaw.browser.request",
        profiles: [],
        error: redactErrorMessage(error, "Unable to read OpenClaw browser profiles.")
      }),
      { status: 503, headers: browserAccountResponseHeaders() }
    );
  }
}

export async function POST(request: Request) {
  const authorization = await requireBrowserAccountActor(request);
  if ("response" in authorization) return authorization.response;

  try {
    const input = browserProfileMutationSchema.parse(await request.json());

    if (input.action === "start-profile") {
      return NextResponse.json(redactSecrets(await startOpenClawBrowserProfile({
        profileName: input.profileName
      })), { headers: browserAccountResponseHeaders() });
    }

    if (resolveAgentOsDeploymentCapabilities().interactiveBrowserLogin === "unavailable") {
      return NextResponse.json(
        {
          ok: false,
          generatedAt: new Date().toISOString(),
          source: "openclaw.browser.request",
          error: "Interactive browser login is unavailable in Railway. The managed Chromium browser is headless and cannot collect operator login or two-factor input."
        },
        { status: 409, headers: browserAccountResponseHeaders() }
      );
    }

    return NextResponse.json(redactSecrets(await openLoginUrlInOpenClawBrowserProfile({
      profileName: input.profileName,
      loginUrl: input.loginUrl,
      label: input.label
    })), { headers: browserAccountResponseHeaders() });
  } catch (error) {
    return NextResponse.json(
      redactSecrets({
        ok: false,
        generatedAt: new Date().toISOString(),
        source: "openclaw.browser.request",
        error: redactErrorMessage(error, "Unable to update OpenClaw browser profile.")
      }),
      { status: 400, headers: browserAccountResponseHeaders() }
    );
  }
}
