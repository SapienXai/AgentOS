import "server-only";

import { NextResponse } from "next/server";

import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import {
  buildOpenClawNativeAuthorizationProof,
  OpenClawAuthorizationService
} from "@/lib/openclaw/identity/authorization";
import type { OpenClawCommandOptions } from "@/lib/openclaw/client/types";
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
  securityClass: "read" | "mutation" | "privileged-mutation" | "internal-recovery";
  executionPath?: "gateway-native" | "gateway-or-verified-cli";
};

export type AgentOsOpenClawPreflightResult =
  | {
      actor: AgentOsActorContext;
      authorization: OpenClawAuthorizationResult;
      context: AgentOsOpenClawRequestContext;
      commandOptions: OpenClawCommandOptions;
    }
  | {
      response: NextResponse;
    };

/**
 * Establishes the AgentOS actor before a sensitive Gateway-backed mutation.
 * OpenClaw remains the final authority. Unknown and unsupported identity
 * states fail closed for mutations because a CLI transport cannot prove the
 * Gateway authorization that a browser/API mutation requires.
 */
export async function requireAgentOsOpenClawPreflight(
  request: Request,
  input: AgentOsOpenClawPreflightInput
): Promise<AgentOsOpenClawPreflightResult> {
  const actorResult: AgentOsActorResult = await requireAgentOsActorContext(request);
  if ("response" in actorResult) return actorResult;

  if (input.securityClass === "internal-recovery" && actorResult.actor.kind !== "internal-service") {
    return {
      response: NextResponse.json(
        {
          error: "This operation is available only to an internal AgentOS service.",
          code: "agentos-internal-service-required"
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

  if (authorization.state === "unsupported" || (
    input.securityClass !== "read" &&
    authorization.state === "unknown"
  )) {
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
          error: "OpenClaw authorization could not be proven for this operation.",
          code: "openclaw-identity-unavailable",
          method: input.method,
          state: authorization.state,
          requiredScopes: authorization.requiredScopes,
          grantedScopes: [],
          reason: authorization.reason,
          retryable: true
        },
        {
          status: 503,
          headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"
          }
        }
      )
    };
  }

  const commandOptions: OpenClawCommandOptions = {};
  if (input.securityClass !== "read") {
    const proof = buildOpenClawNativeAuthorizationProof(
      authorization,
      input.executionPath === "gateway-or-verified-cli"
    );
    if (!proof) {
      return {
        response: NextResponse.json(
          {
            error: "OpenClaw authorization could not be proven for this operation.",
            code: "openclaw-identity-unavailable",
            method: input.method,
            state: "unknown",
            requiredScopes: authorization.requiredScopes,
            grantedScopes: [],
            reason: "A native Gateway handshake proof is required before a privileged mutation can execute.",
            retryable: true
          },
          {
            status: 503,
            headers: {
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff"
            }
          }
        )
      };
    }
    commandOptions.authorizationProof = proof;
  }

  return {
    actor: actorResult.actor,
    authorization,
    context: await authorizationService.buildRequestContext(actorResult.actor, input.operation, authorization.identity),
    commandOptions
  };
}
