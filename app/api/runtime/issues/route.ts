import { NextResponse } from "next/server";
import { z } from "zod";

import {
  approveRuntimeIssue,
  dismissRuntimeIssue,
  inspectRuntimeIssueDevices
} from "@/lib/agentos/control-plane";
import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const runtimeIssueActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("reviewDevices"),
    issueId: z.string().min(1).optional().nullable()
  }),
  z.object({
    action: z.literal("approveRequest"),
    issueId: z.string().min(1).optional().nullable(),
    requestId: z.string().min(1).optional().nullable()
  }),
  z.object({
    action: z.literal("approveLatest"),
    issueId: z.string().min(1).optional().nullable()
  }),
  z.object({
    action: z.literal("dismiss"),
    issueId: z.string().min(1)
  })
]);

export async function GET() {
  try {
    const snapshot = await getMissionControlSnapshot({ force: true });

    return NextResponse.json({
      issues: redactSecrets(snapshot.diagnostics.runtimeIssues)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to load runtime issues.")
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const input = runtimeIssueActionSchema.parse(await request.json());

    if (input.action === "reviewDevices") {
      const result = await inspectRuntimeIssueDevices(input.issueId);
      return NextResponse.json(redactSecrets(result));
    }

    if (input.action === "approveRequest") {
      const result = await approveRuntimeIssue({
        issueId: input.issueId,
        requestId: input.requestId,
        latest: false
      });
      return NextResponse.json(redactSecrets(result));
    }

    if (input.action === "approveLatest") {
      const result = await approveRuntimeIssue({
        issueId: input.issueId,
        latest: true
      });
      return NextResponse.json(redactSecrets(result));
    }

    const snapshot = await dismissRuntimeIssue(input.issueId);
    return NextResponse.json({
      dismissed: true,
      snapshot: redactSecrets(snapshot)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Runtime issue action failed.")
      },
      { status: 400 }
    );
  }
}
