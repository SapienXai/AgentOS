import { NextResponse } from "next/server";
import { z } from "zod";

import { controlRunningTaskSession } from "@/lib/agentos/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const controlRequestSchema = z.object({
  action: z.enum(["steer", "inject"]),
  message: z.string().trim().min(1).max(4000),
  dispatchId: z.string().trim().min(1).optional().nullable()
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
        error: parseResult.error.message
      },
      { status: 400 }
    );
  }

  try {
    const result = await controlRunningTaskSession(taskId, parseResult.data);
    return NextResponse.json({
      result
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to control the running task."
      },
      { status: 400 }
    );
  }
}
