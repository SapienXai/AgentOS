import { NextResponse } from "next/server";
import { z } from "zod";

import {
  readAgentContextEngineFile,
  writeAgentContextEngineFile
} from "@/lib/openclaw/application/context-engine-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fileWriteSchema = z.object({
  path: z.string().min(1),
  content: z.string()
});

export async function GET(request: Request, context: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await context.params;
    const url = new URL(request.url);
    const filePath = url.searchParams.get("path")?.trim();

    if (!filePath) {
      return NextResponse.json(
        {
          error: "File path is required."
        },
        { status: 400 }
      );
    }

    const file = await readAgentContextEngineFile({
      agentId,
      path: filePath
    });

    return NextResponse.json(redactSecrets(file));
  } catch (error) {
    const message = redactErrorMessage(error, "Unable to read agent context file.");
    const status = message.includes("not found") ? 404 : 400;

    return NextResponse.json(
      {
        error: message
      },
      { status }
    );
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await context.params;
    const input = fileWriteSchema.parse(await request.json());
    const file = await writeAgentContextEngineFile({
      agentId,
      path: input.path,
      content: input.content
    });

    return NextResponse.json(redactSecrets(file));
  } catch (error) {
    const message = redactErrorMessage(error, "Unable to save agent context file.");
    const status = message.includes("exceeds") ? 413 : message.includes("not found") ? 404 : 400;

    return NextResponse.json(
      {
        error: message
      },
      { status }
    );
  }
}
