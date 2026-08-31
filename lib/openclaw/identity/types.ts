export type OpenClawIdentitySource = "native-handshake" | "cli-fallback" | "unavailable";

/** The identity actually observed on one AgentOS -> Gateway connection. */
export type OpenClawOperatorIdentity = {
  requestedRole: string | null;
  role: string | null;
  requestedScopes: string[];
  grantedScopes: string[];
  grantedScopesKnown: boolean;
  deviceId: string | null;
  connectionId: string | null;
  authenticated: boolean;
  source: OpenClawIdentitySource;
};

/**
 * Server-created proof that a native Gateway handshake granted the scopes
 * needed by one operation. This is never accepted from browser input and is
 * not serialized into diagnostics.
 */
export type OpenClawNativeAuthorizationProof = {
  source: "native-handshake";
  authenticated: true;
  grantedScopesKnown: true;
  grantedScopes: string[];
  requiredScopes: string[];
  connectionId: string | null;
  cliFallbackAllowed: boolean;
  issuedAt: string;
};

export function openClawScopesAllow(grantedScopes: string[], requiredScopes: string[]) {
  return requiredScopes.every((requiredScope) => {
    if (grantedScopes.includes("operator.admin")) return true;
    if (requiredScope === "operator.read") {
      return grantedScopes.includes("operator.read") || grantedScopes.includes("operator.write");
    }
    if (requiredScope === "operator.talk") {
      return grantedScopes.includes("operator.talk") || grantedScopes.includes("operator.write");
    }
    return grantedScopes.includes(requiredScope);
  });
}

export type OpenClawAuthorizationState =
  | "allowed"
  | "denied"
  | "runtime-required"
  | "unknown"
  | "unsupported";

export type OpenClawCapability =
  | "canRead"
  | "canWrite"
  | "canAdmin"
  | "canApprove"
  | "canAskQuestions"
  | "canPair"
  | "canUseTalk"
  | "canUseTalkSecrets";

export type OpenClawAuthorizationResult = {
  state: OpenClawAuthorizationState;
  capability: OpenClawCapability | null;
  method: string | null;
  identity: OpenClawOperatorIdentity;
  requiredScopes: string[];
  grantedScopes: string[];
  reason: string;
};

export type AgentOsOpenClawRequestContext = {
  actorId: string;
  operation: string;
  openClaw: OpenClawOperatorIdentity;
};
