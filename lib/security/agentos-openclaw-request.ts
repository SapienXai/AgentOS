import "server-only";

import { NextResponse } from "next/server";

import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import { OpenClawAuthorizationService } from "@/lib/openclaw/identity/authorization";
import type {
  AgentOsOpenClawRequestContext,
  OpenClawAuthorizationResult
} from "@/lib/openclaw/identity/types";
import {
  requireAgentOsActorContext,
  type AgentOsActorContext,
  type AgentOsActorResult
} from "@/lib/security/agentos-actor";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";

export type AgentOsOpenClawPreflightInput = {
  operation: string;
  method: string;
  params?: Record<string, unknown>;
  targetKind: string;
  targetId?: string | null;
};

export type AgentOsOpenClawPreflightResult =
  | {
      actor: AgentOsActorContext;
      authorization: OpenClawAuthorizationResult;
      context: AgentOsOpenClawRequestContext;
    }
  | {
      response: NextResponse;
    };

/**
 * Establishes the AgentOS actor before a sensitive Gateway-backed mutation.
 * OpenClaw remains the final authority: runtime-required and unknown states
 * are allowed to proceed so the actual Gateway call can decide the request.
 */
export async function requireAgentOsOpenClawPreflight(
  request: Request,
  input: AgentOsOpenClawPreflightInput
): Promise<AgentOsOpenClawPreflightResult> {
  const actorResult: AgentOsActorResult = await requireAgentOsActorContext(request);
  if ("response" in actorResult) return actorResult;

  const authorizationService = new OpenClawAuthorizationService(getOpenClawGatewayClient());
  const authorization = await authorizationService.authorizeMethod(
    input.method,
    input.params
  );

  if (authorization.state === "denied") {
    await recordAgentOsAuditEvent({
      actor: actorResult.actor,
      operation: input.operation,
      targetKind: input.targetKind,
      targetId: input.targetId,
      result: "denied"
    }).catch(() => {});

    return {
      response: NextResponse.json(
        {
          error: "OpenClaw denied this operation for the active Gateway identity.",
          code: "openclaw-capability-denied",
          method: input.method,
          requiredScopes: authorization.requiredScopes,
          grantedScopes: authorization.grantedScopes,
          reason: authorization.reason
        },
        {
          status: 403,
          headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"
          }
        }
      )
    };
  }

  return {
    actor: actorResult.actor,
    authorization,
    context: await authorizationService.buildRequestContext(actorResult.actor, input.operation)
  };
}
