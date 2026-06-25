import { NextResponse } from "next/server";

import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
