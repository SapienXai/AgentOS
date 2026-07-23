import { NextResponse } from "next/server";
import { z } from "zod";

import { submitMission } from "@/lib/agentos/control-plane";
import { resolveAccountTargetMissionBinding } from "@/lib/agentos/application/account-target-mission-context-service";
import {
  browserAccountResponseHeaders,
  requireBrowserAccountActor
} from "@/lib/security/browser-account-route";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const missionSchema = z.object({
  mission: z.string().min(1),
  requestId: z.string().min(1).max(160).regex(/^[A-Za-z0-9:_-]+$/).optional(),
  agentId: z.string().optional(),
  workspaceId: z.string().optional(),
  accountTargetId: z.string().optional(),
  browserAccountId: z.string().uuid().optional(),
  thinking: z.enum(["off", "minimal", "low", "medium", "high"]).optional()
});

export async function POST(request: Request) {
  const authorization = await requireBrowserAccountActor(request);
  if ("response" in authorization) return authorization.response;

  try {
    const input = missionSchema.parse(await request.json());
    const { accountTargetId, browserAccountId, ...missionInput } = input;
    const browserAccount = accountTargetId || browserAccountId
      ? await resolveAccountTargetMissionBinding({
          actor: authorization.actor,
          workspaceId: input.workspaceId,
          agentId: input.agentId,
          accountTargetId,
          browserAccountId
        })
      : null;
    const result = await submitMission({
      ...missionInput,
      mission: input.mission,
      browserAccount: browserAccount ?? undefined
    });

    return NextResponse.json(redactSecrets(result), {
      status: result.status === "queued" || result.status === "running" ? 202 : 200,
      headers: browserAccountResponseHeaders()
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to submit mission.")
      },
      { status: 400, headers: browserAccountResponseHeaders() }
    );
  }
}
