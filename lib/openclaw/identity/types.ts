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
  requiredScopes: string[];
  grantedScopes: string[];
  reason: string;
};

export type AgentOsOpenClawRequestContext = {
  actorId: string;
  operation: string;
  openClaw: OpenClawOperatorIdentity;
};
