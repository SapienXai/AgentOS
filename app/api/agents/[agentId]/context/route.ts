import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getAgentContextEngineSnapshot,
  saveAgentContextEngineConfiguration
} from "@/lib/openclaw/application/context-engine-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const contextSaveSchema = z.object({
  files: z.array(
    z.object({
      path: z.string().min(1),
      enabled: z.boolean()
    })
  )
});

export async function GET(_request: Request, context: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await context.params;
    const snapshot = await getAgentContextEngineSnapshot(agentId);

    return NextResponse.json(redactSecrets(snapshot));
  } catch (error) {
    const message = redactErrorMessage(error, "Unable to read agent context.");
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
    const input = contextSaveSchema.parse(await request.json());
    const snapshot = await saveAgentContextEngineConfiguration({
      agentId,
      configuration: input
    });

    return NextResponse.json(redactSecrets(snapshot));
  } catch (error) {
    const message = redactErrorMessage(error, "Unable to save agent context.");
    const status = message.includes("not found") ? 404 : 400;

    return NextResponse.json(
      {
        error: message
      },
      { status }
    );
  }
}
