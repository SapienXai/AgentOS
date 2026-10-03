import { NextResponse } from "next/server";
import { z } from "zod";

import { getMissionControlSnapshot } from "@/lib/openclaw/application/mission-control-service";
import { readTaskReviews, writeTaskReview } from "@/lib/agentos/application/task-review-service";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const taskReviewSchema = z.object({
  taskId: z.string().trim().min(1).max(240),
  dispatchId: z.string().trim().min(1).max(240).optional().nullable(),
  status: z.enum(["accepted", "retried", "dismissed"]),
  action: z.string().trim().min(1).max(512)
});

export async function GET(request: Request) {
  const authorization = await requireAgentOsProductPermission(request, "tasks.use");
  if ("response" in authorization) return authorization.response;

  try {
    const snapshot = await getMissionControlSnapshot({ includeHidden: false });
    const tasks = snapshot.tasks;
    const keys = tasks.map(resolveTaskReviewKey);
    const reviews = await readTaskReviews(authorization.actor.actorId, keys);
    return NextResponse.json({ reviews }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to load task review history." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const authorization = await requireAgentOsProductPermission(request, "tasks.use");
  if ("response" in authorization) return authorization.response;

  const parsed = taskReviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid task review decision." }, { status: 400 });
  }

  try {
    const snapshot = await getMissionControlSnapshot({ includeHidden: false });
    const task = snapshot.tasks.find((candidate) => candidate.id === parsed.data.taskId);
    if (!task) return NextResponse.json({ error: "Task was not found." }, { status: 404 });
    if (parsed.data.dispatchId && parsed.data.dispatchId !== task.dispatchId) {
      return NextResponse.json({ error: "The task identity does not match the requested dispatch." }, { status: 409 });
    }

    const review = await writeTaskReview({
      actorId: authorization.actor.actorId,
      taskId: task.id,
      taskKey: resolveTaskReviewKey(task),
      status: parsed.data.status,
      action: parsed.data.action
    });
    return NextResponse.json({ review }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Unable to save the task review decision." }, { status: 503 });
  }
}

function resolveTaskReviewKey(task: {
  id: string;
  key: string;
  dispatchId?: string | null;
  metadata: Record<string, unknown>;
}) {
  const dispatchId = task.dispatchId?.trim();
  if (dispatchId) return dispatchId;
  const nativeTaskId = typeof task.metadata.openClawTaskId === "string"
    ? task.metadata.openClawTaskId.trim()
    : "";
  return nativeTaskId || task.key.trim() || task.id;
}
