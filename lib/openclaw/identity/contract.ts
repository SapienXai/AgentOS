import type { OpenClawCapability } from "@/lib/openclaw/identity/types";

export const OPENCLAW_IDENTITY_CONTRACT_SCHEMA_VERSION = 1;
export const OPENCLAW_IDENTITY_CONTRACT_VERSION = "2026.8.1";
export const OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT = "ea806575e6450e4d1efdfc72c19f04be982a1b9b";
export const OPENCLAW_IDENTITY_CONTRACT_BUILD = "2026.8.1-ea806575e645-2026-08-31T00-16-08.235Z";

export const OPENCLAW_OPERATOR_ROLES = ["operator", "node"] as const;

export const OPENCLAW_OPERATOR_SCOPES = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.questions",
  "operator.pairing",
  "operator.talk",
  "operator.talk.secrets"
] as const;

export type OpenClawIdentityInventoryEntry = {
  classification: string;
  methodOrField: string;
  payloadShape: string;
  responseShape: string;
  requiredStaticScopes: string[];
  dynamicAuthorization: boolean;
  targetDependent: boolean;
  connectionLocal: boolean;
  deviceIdentityInvolved: boolean;
  currentAgentOsUse: "used" | "not-used" | "future";
  sourceNote: string;
};

export const OPENCLAW_8_1_IDENTITY_INVENTORY = [
  {
    classification: "connection-identity",
    methodOrField: "connect.client.id/mode/instanceId",
    payloadShape: "ConnectParams.client",
    responseShape: "HelloOk.server.connId and snapshot.presence",
    requiredStaticScopes: [],
    dynamicAuthorization: false,
    targetDependent: false,
    connectionLocal: true,
    deviceIdentityInvolved: false,
    currentAgentOsUse: "used",
    sourceNote: "AgentOS sends gateway-client/backend and an instance id when configured."
  },
  {
    classification: "connection-identity",
    methodOrField: "connect.role/scopes",
    payloadShape: "optional role string and scope string array",
    responseShape: "hello-ok.auth.role/scopes when exposed by the authenticated device token",
    requiredStaticScopes: [],
    dynamicAuthorization: false,
    targetDependent: false,
    connectionLocal: true,
    deviceIdentityInvolved: true,
    currentAgentOsUse: "used",
    sourceNote: "Requested values are not proof of granted values."
  },
  {
    classification: "device-identity",
    methodOrField: "connect.device",
    payloadShape: "id, publicKey, signature, signedAt, nonce",
    responseShape: "paired device token and role/scopes in hello-ok.auth when issued",
    requiredStaticScopes: [],
    dynamicAuthorization: false,
    targetDependent: false,
    connectionLocal: false,
    deviceIdentityInvolved: true,
    currentAgentOsUse: "used",
    sourceNote: "Pairing and device-token rotation are Gateway authorities."
  },
  {
    classification: "user-directory",
    methodOrField: "users.list",
    payloadShape: "closed empty params object",
    responseShape: "profiles array of UserProfile records with id, displayName, emails, role",
    requiredStaticScopes: ["operator.read"],
    dynamicAuthorization: false,
    targetDependent: false,
    connectionLocal: false,
    deviceIdentityInvolved: false,
    currentAgentOsUse: "not-used",
    sourceNote: "8.1 exposes durable Gateway user profiles; AgentOS does not yet delegate its users."
  },
  {
    classification: "user-directory",
    methodOrField: "users.self",
    payloadShape: "closed empty params object",
    responseShape: "the authenticated UserProfile record",
    requiredStaticScopes: ["operator.write"],
    dynamicAuthorization: true,
    targetDependent: true,
    connectionLocal: false,
    deviceIdentityInvolved: false,
    currentAgentOsUse: "not-used",
    sourceNote: "The response is tied to the authenticated Gateway profile, not an AgentOS display username."
  },
  {
    classification: "profile-mutation",
    methodOrField: "users.setDisplayName / users.setAvatar",
    payloadShape: "profile-scoped display or avatar payload",
    responseShape: "updated UserProfile",
    requiredStaticScopes: ["operator.write"],
    dynamicAuthorization: true,
    targetDependent: true,
    connectionLocal: false,
    deviceIdentityInvolved: false,
    currentAgentOsUse: "not-used",
    sourceNote: "OpenClaw profile presentation mutation is separate from role assignment."
  },
  {
    classification: "profile-mutation",
    methodOrField: "users.linkEmail",
    payloadShape: "profile-scoped email-link payload",
    responseShape: "updated UserProfile",
    requiredStaticScopes: ["operator.admin"],
    dynamicAuthorization: true,
    targetDependent: true,
    connectionLocal: false,
    deviceIdentityInvolved: false,
    currentAgentOsUse: "not-used",
    sourceNote: "Email linkage is a Gateway profile operation and is not used as AgentOS actor identity."
  },
  {
    classification: "role",
    methodOrField: "users.setRole",
    payloadShape: "profileId and nullable role",
    responseShape: "updated UserProfile",
    requiredStaticScopes: ["operator.admin"],
    dynamicAuthorization: false,
    targetDependent: true,
    connectionLocal: false,
    deviceIdentityInvolved: false,
    currentAgentOsUse: "future",
    sourceNote: "Role definitions and assignment are Gateway-owned."
  },
  {
    classification: "approval-authority",
    methodOrField: "exec.approval.*",
    payloadShape: "approval-specific request/resolve payload",
    responseShape: "approval record or resolution result",
    requiredStaticScopes: ["operator.approvals"],
    dynamicAuthorization: true,
    targetDependent: true,
    connectionLocal: true,
    deviceIdentityInvolved: false,
    currentAgentOsUse: "used",
    sourceNote: "Approval target/state remains Gateway runtime authority."
  },
  {
    classification: "question-authority",
    methodOrField: "question.request/get/list/waitAnswer/resolve",
    payloadShape: "question-specific payload",
    responseShape: "question record or resolution result",
    requiredStaticScopes: ["operator.questions"],
    dynamicAuthorization: true,
    targetDependent: true,
    connectionLocal: true,
    deviceIdentityInvolved: false,
    currentAgentOsUse: "used",
    sourceNote: "Question target and lifecycle are not reduced to a local scope check."
  },
  {
    classification: "talk-authority",
    methodOrField: "talk.client.* / talk.session.* / talk.mode",
    payloadShape: "Talk method-specific payload",
    responseShape: "Talk session/client result or event",
    requiredStaticScopes: ["operator.talk"],
    dynamicAuthorization: true,
    targetDependent: true,
    connectionLocal: true,
    deviceIdentityInvolved: false,
    currentAgentOsUse: "used",
    sourceNote: "talk.config with includeSecrets additionally requires operator.talk.secrets and read."
  },
  {
    classification: "session-authority",
    methodOrField: "sessions.create/patch/delete/dispatch",
    payloadShape: "session key/agent/target-specific payload",
    responseShape: "session record or dispatch result",
    requiredStaticScopes: ["operator.write"],
    dynamicAuthorization: true,
    targetDependent: true,
    connectionLocal: false,
    deviceIdentityInvolved: false,
    currentAgentOsUse: "used",
    sourceNote: "8.1 also persists createdActor, owner, participants, visibility, and sharingRole where applicable."
  },
  {
    classification: "agent-authority",
    methodOrField: "agents.list/create/update/delete",
    payloadShape: "agent id and agent configuration payload",
    responseShape: "agent list or mutation result",
    requiredStaticScopes: ["operator.admin"],
    dynamicAuthorization: true,
    targetDependent: true,
    connectionLocal: false,
    deviceIdentityInvolved: false,
    currentAgentOsUse: "used",
    sourceNote: "Agent access is filtered by Gateway role policy when a profile is authenticated."
  },
  {
    classification: "node-authority",
    methodOrField: "node.invoke",
    payloadShape: "node id, command, params",
    responseShape: "node invocation result/event",
    requiredStaticScopes: ["operator.write"],
    dynamicAuthorization: true,
    targetDependent: true,
    connectionLocal: true,
    deviceIdentityInvolved: true,
    currentAgentOsUse: "used",
    sourceNote: "Command allowlists, node availability, and target ownership are runtime checks."
  },
  {
    classification: "config-authority",
    methodOrField: "config.patch/set/apply",
    payloadShape: "config patch plus base hash",
    responseShape: "config mutation/reload result",
    requiredStaticScopes: ["operator.admin"],
    dynamicAuthorization: true,
    targetDependent: true,
    connectionLocal: false,
    deviceIdentityInvolved: false,
    currentAgentOsUse: "used",
    sourceNote: "Static admin scope does not replace schema, hash, path, and reload validation."
  },
  {
    classification: "admin-authority",
    methodOrField: "gateway role/scope enforcement",
    payloadShape: "connection auth plus method request",
    responseShape: "allowed response or Gateway error",
    requiredStaticScopes: ["operator.admin"],
    dynamicAuthorization: true,
    targetDependent: true,
    connectionLocal: true,
    deviceIdentityInvolved: true,
    currentAgentOsUse: "used",
    sourceNote: "OpenClaw remains the final enforcement point."
  }
] satisfies readonly OpenClawIdentityInventoryEntry[];

export const OPENCLAW_CAPABILITY_SCOPES: Record<OpenClawCapability, readonly string[]> = {
  canRead: ["operator.read"],
  canWrite: ["operator.write"],
  canAdmin: ["operator.admin"],
  canApprove: ["operator.approvals"],
  canAskQuestions: ["operator.questions"],
  canPair: ["operator.pairing"],
  canUseTalk: ["operator.talk"],
  canUseTalkSecrets: ["operator.talk.secrets"]
};

export const OPENCLAW_DYNAMIC_METHODS = [
  "sessions.create",
  "sessions.patch",
  "sessions.delete",
  "sessions.dispatch",
  "agent",
  "node.invoke",
  "config.patch",
  "config.apply",
  "config.set",
  "question.resolve",
  "talk.config",
  "talk.mode"
] as const;

export const OPENCLAW_STATIC_METHOD_SCOPES: Record<string, readonly string[]> = {
  "status": ["operator.read"],
  "health": ["operator.read"],
  "agents.list": ["operator.read"],
  "agents.create": ["operator.admin"],
  "agents.update": ["operator.admin"],
  "agents.delete": ["operator.admin"],
  "exec.approval.resolve": ["operator.approvals"],
  "question.resolve": ["operator.questions"],
  "talk.catalog": ["operator.read"],
  "talk.mode": ["operator.talk"],
  "users.list": ["operator.read"],
  "users.self": ["operator.write"],
  "users.setRole": ["operator.admin"],
  "device.pair.list": ["operator.pairing"],
  "device.pair.approve": ["operator.pairing"],
  "config.patch": ["operator.admin"]
};
