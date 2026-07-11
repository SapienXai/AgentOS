import { NextResponse } from "next/server";
import { z } from "zod";

import { createOperation, getOperationsSnapshot, operateOperation, updateOperationSchedule } from "@/lib/agentos/application/operations-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const trigger = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("at"), at: z.string().datetime(), timezone: z.string().optional().nullable() }),
  z.object({ kind: z.literal("cron"), expression: z.string().min(1), timezone: z.string().optional().nullable() }),
  z.object({ kind: z.literal("every"), everyMs: z.number().int().min(10_000) })
]);
const createSchema = z.object({
  action: z.literal("create"), name: z.string().min(1).max(160), description: z.string().max(2_000).optional().nullable(), agentId: z.string().min(1), workspaceId: z.string().min(1), prompt: z.string().min(1).max(20_000), model: z.string().max(200).optional().nullable(), thinking: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).optional().nullable(), trigger,
  context: z.object({ sessionTarget: z.union([z.literal("isolated"), z.literal("main"), z.string().regex(/^session:[^\s]+$/)]).optional(), lightContext: z.boolean().optional() }).optional(),
  safety: z.object({ accountTargetId: z.string().optional().nullable(), requiresApproval: z.boolean().optional(), fileLease: z.string().max(500).optional().nullable(), concurrency: z.enum(["allow", "forbid", "replace"]).optional() }).optional()
});
const actionSchema = z.object({ action: z.enum(["run", "pause", "resume", "cancel", "retry", "disable", "delete"]), jobId: z.string().min(1) });
const updateSchema = z.object({ action: z.literal("update"), jobId: z.string().min(1), trigger });

export async function GET() {
  try { return NextResponse.json(redactSecrets(await getOperationsSnapshot())); }
  catch (error) { return NextResponse.json({ error: redactErrorMessage(error, "Unable to load operations.") }, { status: 500 }); }
}
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const result = body?.action === "create"
      ? await createOperation(createSchema.parse(body) as Parameters<typeof createOperation>[0])
      : body?.action === "update"
        ? await updateOperationSchedule(updateSchema.parse(body))
        : await operateOperation(actionSchema.parse(body).action, actionSchema.parse(body).jobId);
    return NextResponse.json(redactSecrets(result), { status: 202 });
  } catch (error) { return NextResponse.json({ error: redactErrorMessage(error, "Operations action failed.") }, { status: 400 }); }
}
