import { NextResponse } from "next/server";
import { z } from "zod";

import {
  approveRuntimeIssue,
  dismissRuntimeIssue,
  inspectRuntimeIssueDevices,
  repairRuntimeIssueLegacyState
} from "@/lib/agentos/control-plane";
import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsActorContext } from "@/lib/security/agentos-actor";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";

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
    action: z.literal("repairLegacyState"),
    issueId: z.string().min(1)
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
  const actorResult = await requireAgentOsActorContext(request);
  if ("response" in actorResult) return actorResult.response;

  try {
    const input = runtimeIssueActionSchema.parse(await request.json());

    if (input.action === "reviewDevices") {
      const authorization = await requireAgentOsOpenClawPreflight(request, {
        operation: "device.review",
        method: "device.pair.list",
        targetKind: "gateway-device",
        targetId: input.issueId,
        securityClass: "read"
      });
      if ("response" in authorization) return authorization.response;
      const result = await inspectRuntimeIssueDevices(input.issueId);
      await recordAgentOsAuditEvent({ actor: actorResult.actor, operation: "device.review", targetKind: "gateway-device", targetId: input.issueId, result: "succeeded" }).catch(() => {});
      return NextResponse.json(redactSecrets(result));
    }

    if (input.action === "approveRequest") {
      const authorization = await requireAgentOsOpenClawPreflight(request, {
        operation: "device.approve",
        method: "device.pair.approve",
        targetKind: "gateway-device",
        targetId: input.requestId ?? input.issueId,
        securityClass: "privileged-mutation",
        executionPath: "gateway-or-verified-cli"
      });
      if ("response" in authorization) return authorization.response;
      const result = await approveRuntimeIssue({
        issueId: input.issueId,
        requestId: input.requestId,
        latest: false
      }, authorization.commandOptions);
      await recordAgentOsAuditEvent({ actor: actorResult.actor, operation: "device.approve", targetKind: "gateway-device", targetId: input.requestId ?? input.issueId, result: "succeeded" }).catch(() => {});
      return NextResponse.json(redactSecrets(result));
    }

    if (input.action === "approveLatest") {
      const authorization = await requireAgentOsOpenClawPreflight(request, {
        operation: "device.approve-latest",
        method: "device.pair.approve",
        targetKind: "gateway-device",
        targetId: input.issueId,
        securityClass: "privileged-mutation",
        executionPath: "gateway-or-verified-cli"
      });
      if ("response" in authorization) return authorization.response;
      const result = await approveRuntimeIssue({
        issueId: input.issueId,
        latest: true
      }, authorization.commandOptions);
      await recordAgentOsAuditEvent({ actor: actorResult.actor, operation: "device.approve-latest", targetKind: "gateway-device", targetId: input.issueId, result: "succeeded" }).catch(() => {});
      return NextResponse.json(redactSecrets(result));
    }

    if (input.action === "repairLegacyState") {
      const result = await repairRuntimeIssueLegacyState(input.issueId);
      await recordAgentOsAuditEvent({ actor: actorResult.actor, operation: "runtime.repair-legacy-state", targetKind: "runtime-issue", targetId: input.issueId, result: "succeeded" }).catch(() => {});
      return NextResponse.json(redactSecrets(result));
    }

    const snapshot = await dismissRuntimeIssue(input.issueId);
    await recordAgentOsAuditEvent({ actor: actorResult.actor, operation: "runtime.dismiss-issue", targetKind: "runtime-issue", targetId: input.issueId, result: "succeeded" }).catch(() => {});
    return NextResponse.json({
      dismissed: true,
      snapshot: redactSecrets(snapshot)
    });
  } catch (error) {
    await recordAgentOsAuditEvent({ actor: actorResult.actor, operation: "runtime.issue-mutation", targetKind: "runtime-issue", result: "failed" }).catch(() => {});
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Runtime issue action failed.")
      },
      { status: 400 }
    );
  }
}
