import { NextResponse } from "next/server";
import { z } from "zod";

import { getMissionControlSnapshot, runTaskHealthAudit } from "@/lib/agentos/control-plane";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const taskHealthActionSchema = z.object({
  action: z.literal("audit")
});

export async function GET() {
  try {
    const snapshot = await getMissionControlSnapshot({ force: true });

    return NextResponse.json(redactSecrets({
      taskHealth: snapshot.diagnostics.taskHealth ?? null
    }));
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to load task health.")
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const input = taskHealthActionSchema.parse(await request.json());

    if (input.action === "audit") {
      const result = await runTaskHealthAudit();
      return NextResponse.json(redactSecrets(result));
    }

    return NextResponse.json(
      {
        error: "Unsupported task health action."
      },
      { status: 400 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Task health action failed.")
      },
      { status: 400 }
    );
  }
}
