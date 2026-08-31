import { NextResponse } from "next/server";
import { z } from "zod";

import { executeReset, getResetPreview } from "@/lib/agentos/reset";
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
      return NextResponse.json(redactSecrets({
        preview
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

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();
  let writeChain = Promise.resolve();

  const send = (event: ResetStreamEvent) => {
    const safeEvent = redactSecrets(event);
    writeChain = writeChain
      .then(() => writer.write(encoder.encode(`${JSON.stringify(safeEvent)}\n`)))
      .catch(() => {});

    return writeChain;
  };

  void (async () => {
    try {
      const result = await executeReset(executeParse.data.target, {
        onEvent: send
      });

      await send({
        type: "done",
        ok: true,
        target: executeParse.data.target,
        message: result.message,
        snapshot: result.snapshot,
        backgroundLogPath: result.backgroundLogPath
      });
    } catch (error) {
      await send({
        type: "done",
        ok: false,
        target: executeParse.data.target,
        message: redactErrorMessage(error, "Reset operation failed.")
      });
    } finally {
      await writeChain;
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
