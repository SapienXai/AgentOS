import { NextResponse } from "next/server";
import { z } from "zod";

import { controlRunningTaskSession } from "@/lib/agentos/control-plane";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

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

  try {
    const result = await controlRunningTaskSession(taskId, parseResult.data);
    return NextResponse.json(redactSecrets({
      result
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
