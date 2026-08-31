import "server-only";

import { NextResponse } from "next/server";

import { readOperatorProfile } from "@/lib/agentos/application/operator-profile-service";
import { hasValidAgentOsApiToken } from "@/lib/security/api-auth";
import {
  readInstanceProtectionState,
  readInstanceSessionCookie,
  verifyInstanceSession,
  type InstanceProtectionState
} from "@/lib/security/instance-protection";
import { evaluateLocalOperatorRequest } from "@/lib/security/local-operator";

export type AgentOsActorKind = "instance-operator" | "service" | "internal-service";

export type AgentOsAuthenticationMethod =
  | "instance-session"
  | "api-token"
  | "internal-service"
  | "unprotected-local";

export type AgentOsRole = "owner" | null;

export type AgentOsActorContext = {
  actorId: string;
  kind: AgentOsActorKind;
  username: string | null;
  displayName: string | null;
  authenticationMethod: AgentOsAuthenticationMethod;
  authenticated: boolean;
  agentOsRole: AgentOsRole;
};

export type AgentOsActorResult =
  | { actor: AgentOsActorContext }
  | { response: NextResponse };

const API_SERVICE_ACTOR_ID = "service:agentos-api-token";
const INTERNAL_SERVICE_ACTOR_ID = "service:agentos-internal";
const UNPROTECTED_LOCAL_ACTOR_ID = "unprotected-local";

/**
 * Resolve the server-derived AgentOS caller. No actor, role, or profile field
 * is read from request input. Instance Protection remains the authority for
 * browser sessions; an API token is an explicit service actor.
 */
export async function resolveAgentOsActorContext(
  request: Request,
  env: NodeJS.ProcessEnv = process.env
): Promise<AgentOsActorContext | null> {
  const state = await readInstanceProtectionState(env);

  if (state) {
    if (!verifyInstanceSession(readInstanceSessionCookie(request.headers), state)) {
      return null;
    }

    const profile = await readOperatorProfile(env).catch(() => null);
    return createInstanceOperatorActor(state, profile?.fullName || null);
  }

  if (hasValidAgentOsApiToken(request.headers, env)) {
    return {
      actorId: API_SERVICE_ACTOR_ID,
      kind: "service",
      username: null,
      displayName: null,
      authenticationMethod: "api-token",
      authenticated: true,
      agentOsRole: "owner"
    };
  }

  if (isUnprotectedLocalDevelopmentRequest(request, env)) {
    return {
      actorId: UNPROTECTED_LOCAL_ACTOR_ID,
      kind: "instance-operator",
      username: null,
      displayName: null,
      authenticationMethod: "unprotected-local",
      authenticated: false,
      agentOsRole: null
    };
  }

  return null;
}

export async function requireAgentOsActorContext(
  request: Request,
  env: NodeJS.ProcessEnv = process.env
): Promise<AgentOsActorResult> {
  const actor = await resolveAgentOsActorContext(request, env);
  if (actor) return { actor };

  return {
    response: NextResponse.json(
      {
        error: "AgentOS authentication is required.",
        code: "agentos-auth-required"
      },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        }
      }
    )
  };
}

export function createInternalServiceActorContext(): AgentOsActorContext {
  return {
    actorId: INTERNAL_SERVICE_ACTOR_ID,
    kind: "internal-service",
    username: null,
    displayName: null,
    authenticationMethod: "internal-service",
    authenticated: true,
    agentOsRole: null
  };
}

function createInstanceOperatorActor(state: InstanceProtectionState, displayName: string | null): AgentOsActorContext {
  return {
    actorId: state.actorId,
    kind: "instance-operator",
    username: state.username,
    displayName,
    authenticationMethod: "instance-session",
    authenticated: true,
    agentOsRole: "owner"
  };
}

function isUnprotectedLocalDevelopmentRequest(
  request: Request,
  env: NodeJS.ProcessEnv
) {
  if (env.NODE_ENV !== "development") return false;

  return evaluateLocalOperatorRequest({
    method: request.method,
    url: request.url,
    headers: request.headers,
    allowSafeMethods: false,
    allowTrustedRemote: false,
    env
  }).ok;
}
