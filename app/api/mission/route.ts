import { NextResponse } from "next/server";
import { z } from "zod";

import { submitMission } from "@/lib/agentos/control-plane";
import { getMissionControlSnapshot } from "@/lib/openclaw/application/mission-control-service";
import { readMissionDispatchRecords } from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import { extractMissionCommandPayloads } from "@/lib/openclaw/domains/mission-dispatch-model";
import { resolveAccountTargetMissionBinding } from "@/lib/agentos/application/account-target-mission-context-service";
import {
  browserAccountResponseHeaders,
  requireBrowserAccountActor
} from "@/lib/security/browser-account-route";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const browserAuthorization = await requireBrowserAccountActor(request);
  if ("response" in browserAuthorization) return browserAuthorization.response;

  const requestId = new URL(request.url).searchParams.get("requestId")?.trim();
  if (!requestId || requestId.length > 160 || !/^[A-Za-z0-9:_-]+$/.test(requestId)) {
    return NextResponse.json(
      { error: "A valid requestId is required." },
      { status: 400, headers: browserAccountResponseHeaders() }
    );
  }

  const productAuthorization = await requireAgentOsProductPermission(request, "missions.use");
  if ("response" in productAuthorization) {
    for (const [name, value] of Object.entries(browserAccountResponseHeaders())) {
      productAuthorization.response.headers.set(name, value);
    }
    return productAuthorization.response;
  }

  try {
    const [records, snapshot] = await Promise.all([
      readMissionDispatchRecords(),
      getMissionControlSnapshot({ includeHidden: false })
    ]);
    const record = records.find((candidate) => candidate.clientRequestId === requestId);
    const visible = Boolean(record && (
      snapshot.agents.some((agent) => agent.id === record.agentId) ||
      (record.workspaceId && snapshot.workspaces.some((workspace) => workspace.id === record.workspaceId))
    ));
    if (!record || !visible) {
      return NextResponse.json({ error: "Task was not found." }, {
        status: 404,
        headers: browserAccountResponseHeaders()
      });
    }

    return NextResponse.json(redactSecrets({
      dispatchId: record.id,
      runId: record.result?.runId ?? null,
      agentId: record.agentId,
      status: record.status,
      summary: record.error ?? record.result?.summary ?? "Task admission is being reconciled with OpenClaw.",
      payloads: extractMissionCommandPayloads(record.result),
      meta: {
        clientRequestId: record.clientRequestId,
        sessionKey: record.sessionKey ?? record.result?.sessionKey ?? null,
        executionMode: record.executionMode,
        cancellation: record.cancellation ?? null,
        reconciled: true
      }
    }), { headers: browserAccountResponseHeaders() });
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to reconcile the task request.") },
      { status: 503, headers: browserAccountResponseHeaders() }
    );
  }
}

const missionSchema = z.object({
  mission: z.string().min(1),
  requestId: z.string().min(1).max(160).regex(/^[A-Za-z0-9:_-]+$/).optional(),
  agentId: z.string().optional(),
  workspaceId: z.string().optional(),
  executionMode: z.enum(["standard", "isolated-worktree"]).optional(),
  accountTargetId: z.string().optional(),
  browserAccountId: z.string().uuid().optional(),
  thinking: z.enum(["off", "minimal", "low", "medium", "high"]).optional()
});

export async function POST(request: Request) {
  const authorization = await requireBrowserAccountActor(request);
  if ("response" in authorization) return authorization.response;

  let input: z.infer<typeof missionSchema>;
  try {
    input = missionSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to submit mission.") },
      { status: 400, headers: browserAccountResponseHeaders() }
    );
  }

  const openClawAuthorization = await requireAgentOsOpenClawPreflight(request, {
    operation: "mission.dispatch",
    method: "sessions.create",
    params: input.executionMode === "isolated-worktree"
      ? { agentId: input.agentId ?? "resolved-by-agentos", worktree: true, cwd: "resolved-by-agentos" }
      : { agentId: input.agentId ?? "resolved-by-agentos" },
    targetKind: "agent-session",
    targetId: input.agentId ?? null,
    securityClass: "privileged-mutation",
    executionPath: "gateway-native",
    productPermission: "missions.use"
  });
  if ("response" in openClawAuthorization) {
    for (const [name, value] of Object.entries(browserAccountResponseHeaders())) {
      openClawAuthorization.response.headers.set(name, value);
    }
    return openClawAuthorization.response;
  }

  const chatAuthorization = input.executionMode === "isolated-worktree"
    ? openClawAuthorization
    : await requireAgentOsOpenClawPreflight(request, {
    operation: "mission.dispatch",
    method: "chat.send",
    params: { agentId: input.agentId ?? "resolved-by-agentos" },
    targetKind: "agent-session",
    targetId: input.agentId ?? null,
    securityClass: "privileged-mutation",
    executionPath: "gateway-native",
    productPermission: "missions.use"
    });
  if ("response" in chatAuthorization) {
    for (const [name, value] of Object.entries(browserAccountResponseHeaders())) {
      chatAuthorization.response.headers.set(name, value);
    }
    return chatAuthorization.response;
  }

  try {
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
      executionMode: input.executionMode,
      browserAccount: browserAccount ?? undefined
    }, chatAuthorization.commandOptions);

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
