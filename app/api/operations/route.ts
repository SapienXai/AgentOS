import { NextResponse } from "next/server";
import { z } from "zod";

import { createOperation, getOperationsSnapshot, operateOperation, updateOperationSchedule } from "@/lib/agentos/application/operations-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";

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
    const input = body?.action === "create"
      ? createSchema.parse(body)
      : body?.action === "update"
        ? updateSchema.parse(body)
        : actionSchema.parse(body);
    const action = input.action;
    const operation = action === "create"
      ? { method: "cron.add", targetId: null }
      : action === "update"
        ? { method: "cron.update", targetId: input.jobId }
        : { method: action === "delete" ? "cron.remove" : action === "run" || action === "retry" ? "cron.run" : "cron.update", targetId: input.jobId };
    const authorization = await requireAgentOsOpenClawPreflight(request, {
      operation: `operations.${action}`,
      method: operation.method,
      params: operation.targetId ? { jobId: operation.targetId } : {},
      targetKind: "openclaw-cron",
      targetId: operation.targetId,
    securityClass: "privileged-mutation",
      executionPath: "gateway-native",
      productPermission: "tasks.use"
    });
    if ("response" in authorization) return authorization.response;

    const result = action === "create"
      ? await createOperation(input as Parameters<typeof createOperation>[0], authorization.commandOptions)
      : action === "update"
        ? await updateOperationSchedule(input, authorization.commandOptions)
        : await operateOperation(
            input.action,
            input.jobId,
            authorization.commandOptions
          );
    return NextResponse.json(redactSecrets(result), { status: 202 });
  } catch (error) { return NextResponse.json({ error: redactErrorMessage(error, "Operations action failed.") }, { status: 400 }); }
}
