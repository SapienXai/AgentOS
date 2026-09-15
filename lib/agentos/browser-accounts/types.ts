export type BrowserAccountProviderId =
  | "native-openclaw"
  | "self-hosted-openclaw"
  | "local-chrome"
  | "browserless"
  | "browserbase";

export type BrowserAccountRuntimeLocation =
  | "cloud"
  | "local"
  | "browser-node"
  | "external";

export type BrowserAccountCapability =
  | "read"
  | "interact"
  | "publish"
  | "transact"
  | "account_admin";

export type BrowserServiceId =
  | "github"
  | "x"
  | "producthunt"
  | "amazon"
  | "custom";

export const browserAccountCapabilities = [
  "read",
  "interact",
  "publish",
  "transact",
  "account_admin"
] as const satisfies readonly BrowserAccountCapability[];

export type BrowserAccountConnectionType =
  | "browser_profile"
  | "existing_session"
  | "official_integration";

export type BrowserAccountConnectionStatus =
  | "needs_verification"
  | "connected"
  | "expired"
  | "recovery_required"
  | "unsupported"
  | "revoked";

export type BrowserAccountSessionState =
  | "idle"
  | "starting"
  | "active"
  | "stopping"
  | "recovery_required";

export type BrowserAccountRiskLevel = "standard" | "elevated" | "high";
export type BrowserAccountApprovalPolicy = "block_sensitive" | "require_approval";

export type BrowserAuthenticationVerificationStrategy =
  | "dom_marker"
  | "known_authenticated_endpoint"
  | "url_state"
  | "provider_state"
  | "manual_confirmation";

export type BrowserAccountAccessGrant = {
  agentId: string;
  capabilities: BrowserAccountCapability[];
  approvalPolicy: BrowserAccountApprovalPolicy;
  updatedAt: string;
};

export type BrowserAccountLease = {
  leaseId: string;
  holderTaskId: string;
  holderAgentId: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  fencingToken: number;
};

export type BrowserLiveViewRecord = {
  id: string;
  accountId: string;
  workspaceId: string;
  ownerUserId: string;
  providerSessionId: string;
  tokenHash: string | null;
  credentialHash: string | null;
  issuedAt: string;
  exchangeExpiresAt: string;
  exchangedAt: string | null;
  sessionExpiresAt: string;
  revokedAt: string | null;
  leaseId: string;
  fencingToken: number;
};

export type BrowserAccountRecord = {
  id: string;
  provider: BrowserAccountProviderId;
  connectionType: BrowserAccountConnectionType;
  serviceId: BrowserServiceId;
  identityLabel: string;
  runtimeLocation: BrowserAccountRuntimeLocation;
  externalProfileId: string | null;
  browserProfileId: string;
  workspaceId: string;
  ownerUserId: string;
  allowedAgentIds: string[];
  capabilities: BrowserAccountCapability[];
  accessGrants: BrowserAccountAccessGrant[];
  allowedDomains: string[];
  connectionStatus: BrowserAccountConnectionStatus;
  verificationSource: "provider_verified" | "user_confirmed" | "unknown";
  lastVerifiedAt: string | null;
  lastUsedAt: string | null;
  sessionState: BrowserAccountSessionState;
  concurrencyLease: BrowserAccountLease | null;
  secretReference: string | null;
  riskLevel: BrowserAccountRiskLevel;
  approvalPolicy: BrowserAccountApprovalPolicy;
  serviceName: string;
  primaryDomain: string;
  source: "openclaw.browser.request" | "agentos.browser-gateway" | "self-hosted-worker";
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
};

export type BrowserAccountAuditEventType =
  | "account_created"
  | "login_started"
  | "login_verified"
  | "login_failed"
  | "agent_granted"
  | "agent_revoked"
  | "capability_updated"
  | "task_bound"
  | "profile_created"
  | "live_view_issued"
  | "live_view_opened"
  | "live_view_expired"
  | "live_view_revoked"
  | "login_user_confirmed"
  | "authentication_verified"
  | "authentication_failed"
  | "authentication_expired"
  | "lease_acquired"
  | "lease_renewed"
  | "lease_released"
  | "lease_expired"
  | "browser_session_started"
  | "browser_session_stopped"
  | "browser_session_crashed"
  | "access_policy_updated"
  | "agent_bound"
  | "agent_unbound"
  | "sensitive_action_requested"
  | "sensitive_action_approved"
  | "sensitive_action_blocked"
  | "account_revoked"
  | "profile_cleanup_failed";

export type BrowserTaskBindingRecord = {
  dispatchId: string;
  accountId: string;
  workspaceId: string;
  ownerUserId: string;
  agentId: string;
  provider: BrowserAccountProviderId;
  openClawSessionId: string | null;
  openClawSessionKey: string;
  openClawProfileName: string;
  providerSessionId: string;
  serviceId: BrowserServiceId;
  identityLabel: string;
  capabilities: BrowserAccountCapability[];
  allowedDomains: string[];
  approvalPolicy: BrowserAccountApprovalPolicy;
  leaseId: string;
  fencingToken: number;
  createdAt: string;
  heartbeatAt: string;
  expiresAt: string;
  recoveryRequiredAt?: string;
};

export type BrowserAccountAuditEvent = {
  id: string;
  type: BrowserAccountAuditEventType;
  accountId: string;
  workspaceId: string;
  actorUserId: string;
  agentId: string | null;
  taskId: string | null;
  at: string;
  detail: string;
};

export type BrowserProviderCapabilities = {
  provider: BrowserAccountProviderId;
  source: "native-openclaw" | "self-hosted-worker" | "optional-adapter" | "unsupported";
  profileCreation: "supported" | "unsupported" | "unknown";
  persistentProfiles: "supported" | "unsupported" | "unknown";
  liveView: "supported" | "unsupported" | "unknown";
  humanTakeover: "supported" | "unsupported" | "unknown";
  typedTaskDispatch: "supported" | "unsupported" | "unknown";
  cdpExposure: "private" | "not-applicable" | "unknown";
  runtimeLocation?: BrowserAccountRuntimeLocation;
  reason: string | null;
};

export type BrowserAuthenticationStatus =
  | "verified"
  | "unverified"
  | "expired"
  | "needs_user_action"
  | "unknown";
