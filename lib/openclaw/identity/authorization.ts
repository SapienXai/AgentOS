import "server-only";

import type { AgentOsActorContext } from "@/lib/security/agentos-actor";
import type { OpenClawGatewayClient, OpenClawCommandOptions } from "@/lib/openclaw/client/types";
import {
  OPENCLAW_CAPABILITY_SCOPES,
  OPENCLAW_DYNAMIC_METHODS,
  OPENCLAW_OPERATOR_SCOPES,
  OPENCLAW_STATIC_METHOD_SCOPES
} from "@/lib/openclaw/identity/contract";
import type {
  AgentOsOpenClawRequestContext,
  OpenClawAuthorizationResult,
  OpenClawCapability,
  OpenClawOperatorIdentity
} from "@/lib/openclaw/identity/types";

const EMPTY_IDENTITY: OpenClawOperatorIdentity = {
  requestedRole: null,
  role: null,
  requestedScopes: [],
  grantedScopes: [],
  grantedScopesKnown: false,
  deviceId: null,
  connectionId: null,
  authenticated: false,
  source: "unavailable"
};

const SESSION_PATCH_WRITE_FIELDS = new Set([
  "label",
  "icon",
  "color",
  "category",
  "boardFace",
  "pinned",
  "archived",
  "unread",
  "model",
  "permissionMode",
  "key",
  "agentId",
  "expectedSessionId",
  "expectedLifecycleRevision",
  "expectedMarkedUnreadAt"
]);

const ADMIN_ONLY_NODE_COMMANDS = new Set([
  "browser.proxy",
  "browser.proxy.upload.v1",
  "fs.listDir",
  "terminal.upload"
]);

/**
 * AgentOS-side preflight for the capabilities OpenClaw exposes. This service
 * never replaces Gateway enforcement; it only prevents known-denied calls
 * and reports runtime-dependent calls honestly.
 */
export class OpenClawAuthorizationService {
  constructor(private readonly client: OpenClawGatewayClient) {}

  async getIdentity(options: OpenClawCommandOptions = {}) {
    if (!this.client.getOperatorIdentity) return { ...EMPTY_IDENTITY };

    try {
      return await this.client.getOperatorIdentity(options);
    } catch {
      return { ...EMPTY_IDENTITY };
    }
  }

  async authorizeCapability(
    capability: OpenClawCapability,
    options: OpenClawCommandOptions = {}
  ): Promise<OpenClawAuthorizationResult> {
    const identity = await this.getIdentity(options);
    const requiredScopes = [...OPENCLAW_CAPABILITY_SCOPES[capability]];
    const staticResult = authorizeGrantedScopes(identity, requiredScopes);
    return {
      ...staticResult,
      capability,
      method: null,
      requiredScopes,
      reason: staticResult.reason || `Capability ${capability} is not available.`
    };
  }

  async authorizeMethod(
    method: string,
    params: Record<string, unknown> = {},
    options: OpenClawCommandOptions = {}
  ): Promise<OpenClawAuthorizationResult> {
    const identity = await this.getIdentity(options);
    const requiredScopes = resolveRequiredScopes(method, params);
    const staticResult = authorizeGrantedScopes(identity, requiredScopes);
    const runtimeRequired = isRuntimeDependentMethod(method, params);

    return {
      ...staticResult,
      capability: null,
      method,
      requiredScopes,
      state: staticResult.state === "allowed" && runtimeRequired ? "runtime-required" : staticResult.state,
      reason: staticResult.state === "denied"
        ? staticResult.reason
        : runtimeRequired
          ? `OpenClaw granted the static scope requirement for ${method}; target and runtime authorization remain Gateway-enforced.`
          : staticResult.reason
    };
  }

  async buildRequestContext(
    actor: AgentOsActorContext,
    operation: string,
    options: OpenClawCommandOptions = {}
  ): Promise<AgentOsOpenClawRequestContext> {
    return {
      actorId: actor.actorId,
      operation,
      openClaw: await this.getIdentity(options)
    };
  }
}

export function createOpenClawAuthorizationService(client: OpenClawGatewayClient) {
  return new OpenClawAuthorizationService(client);
}

function authorizeGrantedScopes(
  identity: OpenClawOperatorIdentity,
  requiredScopes: string[]
): Pick<OpenClawAuthorizationResult, "state" | "grantedScopes" | "reason"> {
  if (!identity.authenticated || identity.source !== "native-handshake") {
    return {
      state: "unknown",
      grantedScopes: [...identity.grantedScopes],
      reason: "OpenClaw has not exposed an authenticated native handshake identity."
    };
  }

  if (!identity.grantedScopesKnown) {
    return {
      state: "unknown",
      grantedScopes: [],
      reason: "OpenClaw authenticated the connection but did not expose granted scopes; requested scopes are not used as proof."
    };
  }

  const missingScope = requiredScopes.find((scope) => !scopeAllows(identity.grantedScopes, scope));
  if (missingScope) {
    return {
      state: "denied",
      grantedScopes: [...identity.grantedScopes],
      reason: `OpenClaw denied this capability because granted scope ${missingScope} is absent.`
    };
  }

  return {
    state: "allowed",
    grantedScopes: [...identity.grantedScopes],
    reason: "OpenClaw granted the required static scope."
  };
}

function resolveRequiredScopes(method: string, params: Record<string, unknown>) {
  const staticScopes = OPENCLAW_STATIC_METHOD_SCOPES[method];
  if (staticScopes) return [...staticScopes];

  if (method === "talk.config") {
    return params.includeSecrets === true
      ? ["operator.read", "operator.talk.secrets"]
      : ["operator.read"];
  }

  if (method === "sessions.create") {
    return params.incognito === true || params.permissionMode === "full" ||
      typeof params.key === "string" && isIncognitoSessionKey(params.key) ||
      typeof params.parentSessionKey === "string" && isIncognitoSessionKey(params.parentSessionKey) ||
      Object.hasOwn(params, "execNode") || Object.hasOwn(params, "toolOverrides")
      ? ["operator.admin"]
      : ["operator.write"];
  }

  if (method === "sessions.patch") {
    return params.permissionMode === "full" || Object.keys(params).some((key) => !SESSION_PATCH_WRITE_FIELDS.has(key))
      ? ["operator.admin"]
      : ["operator.write"];
  }

  if (method === "sessions.delete") {
    return params.archivedOnly === true && Object.keys(params).every((key) => [
      "key",
      "agentId",
      "deleteTranscript",
      "expectedSessionId",
      "archivedOnly"
    ].includes(key)) ? ["operator.write"] : ["operator.admin"];
  }

  if (method === "sessions.dispatch") {
    return params.deviceId !== undefined || params.autoDevice === true ? ["operator.write"] : ["operator.admin"];
  }

  if (method === "sessions.move") {
    return isRecord(params.target) && params.target.kind === "profile" ? ["operator.admin"] : ["operator.write"];
  }

  if (method === "agent" && typeof params.message === "string" && /^\/(?:new|reset)(?:\s|$)/i.test(params.message)) {
    return ["operator.admin"];
  }

  if (method === "node.invoke") return [
    ADMIN_ONLY_NODE_COMMANDS.has(params.command as string) ? "operator.admin" : "operator.write"
  ];
  if (method === "fs.listDir") return [Object.hasOwn(params, "nodeId") ? "operator.admin" : "operator.write"];
  if (method === "channels.pairing.approve") return [params.bootstrapCommandOwner === true ? "operator.admin" : "operator.pairing", "operator.pairing"];
  if (method.startsWith("question.")) return ["operator.questions"];
  if (method.startsWith("talk.client.") || method.startsWith("talk.session.")) return ["operator.talk"];
  if (method.startsWith("config.")) return ["operator.admin"];
  if (method.startsWith("agents.")) return method === "agents.list" ? ["operator.read"] : ["operator.admin"];
  if (method.startsWith("exec.approval.")) return ["operator.approvals"];
  if (method.startsWith("device.pair.") || method.startsWith("node.pair.")) return ["operator.pairing"];
  if (method.startsWith("users.")) return method === "users.list" ? ["operator.read"] : ["operator.admin"];

  return ["operator.admin"];
}

function isRuntimeDependentMethod(method: string, params: Record<string, unknown>) {
  return OPENCLAW_DYNAMIC_METHODS.includes(method as (typeof OPENCLAW_DYNAMIC_METHODS)[number]) ||
    method === "plugins.sessionAction" ||
    method === "sessions.move" ||
    (method === "talk.config" && params.includeSecrets === true);
}

function scopeAllows(grantedScopes: string[], requiredScope: string) {
  const granted = new Set(grantedScopes);
  if (granted.has("operator.admin")) return true;
  if (requiredScope === "operator.read") return granted.has("operator.read") || granted.has("operator.write");
  if (requiredScope === "operator.talk") return granted.has("operator.talk") || granted.has("operator.write");
  return granted.has(requiredScope);
}

function isIncognitoSessionKey(value: string) {
  const parts = value.trim().toLowerCase().split(":");
  return parts.length >= 3 && parts[0] === "agent" && /^(?:dashboard|subagent|internal-session-effects):incognito-[^:]+$/.test(parts.slice(2).join(":"));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isKnownOpenClawOperatorScope(value: string): value is (typeof OPENCLAW_OPERATOR_SCOPES)[number] {
  return (OPENCLAW_OPERATOR_SCOPES as readonly string[]).includes(value);
}
