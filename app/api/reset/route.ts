import { NextResponse } from "next/server";
import { z } from "zod";

import {
  consumeResetConfirmation,
  createResetConfirmation,
  releaseResetConfirmation,
  ResetConfirmationError
} from "@/lib/agentos/reset-confirmation";
import { executeReset, getResetPreview } from "@/lib/agentos/reset";
import { requestAgentOsRuntimeShutdown } from "@/lib/agentos/runtime-shutdown";
import type { ResetStreamEvent } from "@/lib/agentos/contracts";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resetTargetSchema = z.enum(["mission-control", "full-uninstall"]);

const previewRequestSchema = z.object({
  intent: z.literal("preview"),
  target: resetTargetSchema
});

const executeRequestSchema = z.object({
  intent: z.literal("execute"),
  target: resetTargetSchema,
  planId: z.string().uuid(),
  confirmed: z.literal(true)
});

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "security.manage");
  if ("response" in permission) return permission.response;
  let payload: unknown;

  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Reset request body is required.")
      },
      { status: 400 }
    );
  }

  const previewParse = previewRequestSchema.safeParse(payload);

  if (previewParse.success) {
    try {
      const preview = await getResetPreview(previewParse.data.target);
      const confirmation = await createResetConfirmation({
        preview,
        actor: permission.actor,
        request
      });
      return NextResponse.json(redactSecrets({
        preview,
        confirmation
      }));
    } catch (error) {
      return NextResponse.json(
        {
          error: redactErrorMessage(error, "Unable to prepare the reset preview.")
        },
        { status: 400 }
      );
    }
  }

  const executeParse = executeRequestSchema.safeParse(payload);

  if (!executeParse.success) {
    return NextResponse.json(
      {
        error: redactErrorMessage(executeParse.error, "Invalid reset request.")
      },
      { status: 400 }
    );
  }

  let confirmation;
  try {
    confirmation = await consumeResetConfirmation({
      planId: executeParse.data.planId,
      target: executeParse.data.target,
      actor: permission.actor,
      request
    });
  } catch (error) {
    const status = error instanceof ResetConfirmationError ? error.status : 500;
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "The reset preview could not be confirmed."),
        ...(error instanceof ResetConfirmationError ? { code: error.code } : {})
      },
      { status }
    );
  }

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();
  let writeChain = Promise.resolve();
  let resetResult: Awaited<ReturnType<typeof executeReset>> | null = null;

  const send = (event: ResetStreamEvent) => {
    const safeEvent = redactSecrets(event);
    writeChain = writeChain
      .then(() => writer.write(encoder.encode(`${JSON.stringify(safeEvent)}\n`)))
      .catch(() => {});

    return writeChain;
  };

  void (async () => {
    try {
      resetResult = await executeReset(executeParse.data.target, {
        onEvent: send,
        preview: confirmation.preview
      });

      await send({
        type: "done",
        ok: resetResult.ok,
        target: executeParse.data.target,
        status: resetResult.status,
        ...(resetResult.failureClass ? { failureClass: resetResult.failureClass } : {}),
        message: resetResult.message,
        snapshot: resetResult.snapshot,
        backgroundLogPath: resetResult.backgroundLogPath
      });
    } catch (error) {
      await send({
        type: "done",
        ok: false,
        target: executeParse.data.target,
        status: "failed",
        failureClass: "unknown",
        message: redactErrorMessage(error, "Reset operation failed.")
      });
    } finally {
      await releaseResetConfirmation(confirmation).catch(() => {});
      await writeChain;
      await writer.close().catch(() => {});
      if (resetResult?.runtimeShutdownEligible) {
        try {
          await requestAgentOsRuntimeShutdown();
        } catch {
          console.error("Full Uninstall completed its cleanup, but AgentOS runtime shutdown could not be requested.");
        }
      }
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
