import { NextResponse } from "next/server";
import { z } from "zod";

import { submitMission } from "@/lib/agentos/control-plane";
import { resolveAccountTargetMissionContext } from "@/lib/agentos/application/account-target-mission-context-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const missionSchema = z.object({
  mission: z.string().min(1),
  agentId: z.string().optional(),
  workspaceId: z.string().optional(),
  accountTargetId: z.string().optional(),
  thinking: z.enum(["off", "minimal", "low", "medium", "high"]).optional()
});

export async function POST(request: Request) {
  try {
    const input = missionSchema.parse(await request.json());
    const { accountTargetId, ...missionInput } = input;
    const accountTargetContext = accountTargetId
      ? await resolveAccountTargetMissionContext({
          workspaceId: input.workspaceId,
          agentId: input.agentId,
          accountTargetId
        })
      : null;
    const result = await submitMission({
      ...missionInput,
      mission: accountTargetContext
        ? `${input.mission.trim()}\n\n${accountTargetContext}`
        : input.mission
    });

    return NextResponse.json(redactSecrets(result), {
      status: result.status === "queued" || result.status === "running" ? 202 : 200
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to submit mission.")
      },
      { status: 400 }
    );
  }
}
