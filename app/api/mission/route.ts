import { NextResponse } from "next/server";
import { z } from "zod";

import { submitMission } from "@/lib/agentos/control-plane";
import { resolveAccountAccessDecision } from "@/lib/agentos/application/account-access-policy-service";
import { listAccountLoginTargets } from "@/lib/agentos/application/account-login-target-service";
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

async function resolveAccountTargetMissionContext(input: {
  workspaceId?: string;
  agentId?: string;
  accountTargetId: string;
}) {
  if (!input.workspaceId) {
    throw new Error("Workspace id is required when running a task with an account target.");
  }

  if (!input.agentId) {
    throw new Error("Select an agent before running a task with an account target.");
  }

  const targetsResponse = await listAccountLoginTargets({ workspaceId: input.workspaceId });
  const target = targetsResponse.targets.find((entry) => entry.id === input.accountTargetId);

  if (!target) {
    throw new Error("The selected account target was not found in this workspace.");
  }

  const decision = await resolveAccountAccessDecision({
    workspaceId: input.workspaceId,
    targetId: target.id,
    agentId: input.agentId
  });

  if (!decision.allowed) {
    throw new Error(decision.error ?? "This agent is not allowed to use the selected account target.");
  }

  if (decision.approvalRequired) {
    throw new Error("This account target requires approval, but account approval dispatch is not exposed yet.");
  }

  return [
    "[AgentOS account target]",
    `Service: ${target.serviceName}`,
    `Domain: ${target.primaryDomain}`,
    `OpenClaw browser profile: ${target.browserProfileName}`,
    `Login URL: ${target.loginUrl}`,
    "Use this existing browser profile/session if your browser tools support profile selection. Do not ask for, print, or store passwords, tokens, cookies, or secrets.",
    "If the browser tool cannot select a profile, stop and report that OpenClaw profile selection is not exposed for this dispatch path."
  ].join("\n");
}
