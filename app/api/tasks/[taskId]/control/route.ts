import { NextResponse } from "next/server";
import { z } from "zod";

import { controlRunningTaskSession } from "@/lib/agentos/control-plane";
import { writeTaskReview } from "@/lib/agentos/application/task-review-service";
import { appendMissionDispatchOperatorInstruction } from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import { getMissionControlSnapshot } from "@/lib/openclaw/application/mission-control-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const controlRequestSchema = z.object({
  action: z.enum(["steer", "inject", "continue"]),
  message: z.string().trim().min(1).max(12000),
  dispatchId: z.string().trim().min(1).optional().nullable(),
  idempotencyKey: z.string().trim().min(1).max(240).optional().nullable()
});

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId: rawTaskId } = await context.params;
  const taskId = decodeURIComponent(rawTaskId);

  let payload: unknown = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const parseResult = controlRequestSchema.safeParse(payload);

  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: redactErrorMessage(parseResult.error, "Invalid task control request.")
      },
      { status: 400 }
    );
  }

  const authorization = await requireAgentOsOpenClawPreflight(request, {
    operation: `task.${parseResult.data.action}`,
    method: parseResult.data.action === "steer"
      ? "chat.send"
      : parseResult.data.action === "inject"
        ? "chat.inject"
        : "chat.send",
    params: { taskId },
    targetKind: "task-session",
    targetId: taskId,
    securityClass: "privileged-mutation",
    executionPath: "gateway-native",
    productPermission: "tasks.use"
  });
  if ("response" in authorization) return authorization.response;

  const visibleSnapshot = await getMissionControlSnapshot();
  const visibleTask = visibleSnapshot.tasks.find((task) => task.id === taskId);
  if (!visibleTask) {
    return NextResponse.json({ error: "Task was not found." }, { status: 404 });
  }
  if (parseResult.data.dispatchId && parseResult.data.dispatchId !== visibleTask.dispatchId) {
    return NextResponse.json({ error: "The task identity does not match the requested dispatch." }, { status: 409 });
  }

  try {
    const result = await controlRunningTaskSession(taskId, parseResult.data, {}, authorization.commandOptions);
    let review = null;
    let historyPersistenceWarning: string | null = null;
    if (visibleTask.dispatchId) {
      try {
        const runId = typeof result.result.runId === "string" ? result.result.runId : null;
        await appendMissionDispatchOperatorInstruction({
          dispatchId: visibleTask.dispatchId,
          idempotencyKey: parseResult.data.idempotencyKey,
          kind: parseResult.data.action,
          message: parseResult.data.message,
          sessionKey: result.target.sessionKey,
          sessionId: result.target.sessionId,
          runId
        });
      } catch {
        historyPersistenceWarning = "OpenClaw accepted the instruction, but AgentOS could not save its task history receipt.";
      }
    }
    if (parseResult.data.action === "continue") {
      const nativeTaskId = typeof visibleTask.metadata.openClawTaskId === "string"
        ? visibleTask.metadata.openClawTaskId.trim()
        : "";
      const taskKey = (visibleTask.dispatchId ?? nativeTaskId) || visibleTask.key || visibleTask.id;
      try {
        review = await writeTaskReview({
          actorId: authorization.actor.actorId,
          taskId: visibleTask.id,
          taskKey,
          status: "continued",
          action: "Continued the task in its existing OpenClaw session"
        });
      } catch {
        historyPersistenceWarning = "OpenClaw accepted the continuation, but AgentOS could not save its operator review receipt.";
      }
    }
    return NextResponse.json(redactSecrets({
      result,
      review,
      historyPersistenceWarning
    }));
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to control the running task.")
      },
      { status: 400 }
    );
  }
}
