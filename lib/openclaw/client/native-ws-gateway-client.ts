import "server-only";

import { CliOpenClawGatewayClient } from "@/lib/openclaw/client/cli-gateway-client";
import {
  getOpenClawGatewayCompatibilityOperation,
  getOpenClawGatewayMethodCandidates,
  type OpenClawGatewayCompatibilityOperationId
} from "@/lib/openclaw/client/gateway-compatibility";
import { isRailwayManagedRuntime } from "@/lib/openclaw/deployment-runtime";
import {
  buildMergePatchReplacementValue,
  canFallbackGatewayAuthConfigRepair,
  buildMergePatchForConfigPath,
  isGatewayTransportConfigPath,
  readConfigReloadKindFromSchemaLookup
} from "@/lib/openclaw/client/native-ws-gateway-config";
import { PersistentOpenClawGatewayConnection } from "@/lib/openclaw/client/native-ws-gateway-connection";
import { AgentOsGatewayRequestPolicy } from "@/lib/openclaw/client/gateway-request-policy";
import {
  clearGatewayFallbackDiagnostic,
  clearGatewayFallbackDiagnosticsForTesting,
  getRecentOpenClawGatewayFallbackDiagnostics as readRecentOpenClawGatewayFallbackDiagnostics,
  NativeGatewayError,
  NativeGatewayRequestError,
  normalizeClientError,
  OpenClawGatewayClientError,
  recordGatewayFallbackDiagnostic,
  resolveGatewayRecoveryMessage,
  sanitizeGatewayDiagnosticText
} from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  buildAgentIdentityParams,
  buildAgentSessionKey,
  buildArtifactListParams,
  buildAutomationProvisionParams,
  buildChannelAccountProvisionParams,
  buildChatHistoryParams,
  buildChatInjectParams,
  buildNativeSessionCreateParams,
  buildRuntimeSnapshotArtifactListInput,
  buildSessionHistoryParams,
  buildSessionPreviewParams,
  buildSessionReferenceParams,
  buildSessionSteerParams,
  hasArtifactListScope,
  normalizeGatewayTurnEvent,
  resolveAgentTurnWaitMs,
  shouldIgnoreNativeAgentWaitError,
  shouldIgnoreNativeSessionPreparationError
} from "@/lib/openclaw/client/native-ws-gateway-mappers";
import {
  clearCachedStatusUpdateRegistry,
  agentListPayloadSchema,
  buildSessionExportPayload,
  channelStatusPayloadSchema,
  configSnapshotPayloadSchema,
  hasNativeStatusUpdateRegistry,
  mergeStatusPayload,
  normalizeModelStatusPayload,
  normalizeModelsPayload,
  normalizePluginsPayload,
  parseGatewayPayload,
  parseObjectGatewayPayload,
  rememberStatusUpdateRegistry,
  sessionsPayloadSchema,
  skillsPayloadSchema,
  statusPayloadSchema,
  summarizeSnapshotError
} from "@/lib/openclaw/client/native-ws-gateway-payloads";
import {
  isGatewayMethodUnsupported,
  readAdvertisedGatewayMethods,
  resolveLatestPendingDeviceRequestId
} from "@/lib/openclaw/client/native-ws-gateway-protocol";
import {
  isCliGatewayClientForcedByEnv,
  resolveGatewayRequestPolicy,
  resolveNativeTimeoutMs,
  shouldUseCliFallback
} from "@/lib/openclaw/client/native-ws-gateway-policy";
import {
  CONNECT_METHOD,
  OPENCLAW_GATEWAY_PROTOCOL_RANGE,
  type NativeWsOpenClawGatewayClientOptions,
  type OpenClawGatewayTransport,
  type WebSocketFactory
} from "@/lib/openclaw/client/native-ws-gateway-types";
import {
  cloneJsonObject,
  commandResultFromGatewayPayload,
  containsRedactedOpenClawSecret,
  createRequestId,
  isObjectRecord,
  readConfigPath,
  readNonEmptyString,
  setConfigPathValue,
  unsetConfigPathValue
} from "@/lib/openclaw/client/native-ws-gateway-utils";
import { isUnsupportedLegacyProviderId } from "@/lib/openclaw/model-provider-registry";
import { normalizeOpenClawChatAdmission } from "@/lib/openclaw/domains/chat-admission";
import type { CommandResult } from "@/lib/openclaw/cli";
import type {
  GatewayStatusPayload,
  MissionCommandPayload,
  OpenClawAddAgentInput,
  OpenClawAgentIdentityInput,
  OpenClawAgentModelStatusInput,
  OpenClawAbortTurnInput,
  OpenClawArtifactDeleteInput,
  OpenClawArtifactDownloadInput,
  OpenClawArtifactDownloadPayload,
  OpenClawArtifactGetInput,
  OpenClawArtifactListInput,
  OpenClawArtifactListPayload,
  OpenClawArtifactPayload,
  OpenClawArtifactPutInput,
  OpenClawAutomationProvisionInput,
  OpenClawChannelAccountProvisionInput,
  OpenClawChannelAccountRemoveInput,
  OpenClawChannelStatusInput,
  OpenClawChannelStatusPayload,
  OpenClawChannelLifecycleInput,
  OpenClawChannelLifecycleResult,
  OpenClawChannelLogoutInput,
  OpenClawWebLoginResult,
  OpenClawWebLoginStartInput,
  OpenClawWebLoginWaitInput,
  OpenClawChannelLogsInput,
  OpenClawChannelLogsPayload,
  OpenClawAgentListPayload,
  OpenClawAgentTurnInput,
  OpenClawChatInjectInput,
  OpenClawCommandOptions,
  OpenClawConfigMutationMetadata,
  OpenClawConfigSchemaPayload,
  OpenClawConfigSchemaLookupInput,
  OpenClawConfigSchemaLookupPayload,
  OpenClawCronListInput,
  OpenClawCronListPayload,
  OpenClawCronGetInput,
  OpenClawCronRunInput,
  OpenClawCronRunPayload,
  OpenClawCronRunsInput,
  OpenClawCronRunsPayload,
  OpenClawCronStatusPayload,
  OpenClawDescribeSessionInput,
  OpenClawDeviceApproveInput,
  OpenClawDeviceApprovePayload,
  OpenClawDeviceListPayload,
  OpenClawExecApprovalListInput,
  OpenClawExecApprovalListPayload,
  OpenClawExecApprovalResolveInput,
  OpenClawExecApprovalResolvePayload,
  OpenClawGatewayClient,
  OpenClawGatewayClientDiagnostics,
  OpenClawGatewayEventCallbacks,
  OpenClawGatewayEventSubscription,
  OpenClawGatewayRequestPolicy,
  OpenClawGatewaySurfaceInput,
  OpenClawGatewaySurfacePayload,
  OpenClawGmailSetupInput,
  OpenClawHealthPayload,
  OpenClawListModelsInput,
  OpenClawListSessionsInput,
  OpenClawLogsTailInput,
  OpenClawLogsTailPayload,
  OpenClawModelAuthOrderSetInput,
  OpenClawModelScanPayload,
  ModelsStatusPayload,
  OpenClawRuntimeEventSubscriptionInput,
  OpenClawRuntimeSnapshotInput,
  OpenClawRuntimeSnapshotPayload,
  OpenClawSessionExportInput,
  OpenClawSessionHistoryInput,
  OpenClawSessionHistoryPayload,
  OpenClawSessionControlPayload,
  OpenClawSessionModelPatchInput,
  OpenClawSessionModelPatchPayload,
  OpenClawSessionPayload,
  OpenClawSessionSteerInput,
  OpenClawSessionsPayload,
  OpenClawSkillListPayload,
  OpenClawStreamCallbacks,
  OpenClawTaskAssignInput,
  OpenClawTaskCancelInput,
  OpenClawTaskGetInput,
  OpenClawTaskListInput,
  OpenClawTaskListPayload,
  OpenClawTaskPayload,
  OpenClawToolInvokeInput,
  OpenClawToolInvokePayload,
  OpenClawToolsCatalogInput,
  OpenClawToolsCatalogPayload,
  OpenClawToolsEffectiveInput,
  OpenClawToolsEffectivePayload,
  OpenClawUpdateAgentInput,
  OpenClawUpdateStatusPayload,
  OpenClawUserListPayload,
  OpenClawUserProfile,
  StatusPayload
} from "@/lib/openclaw/client/types";
import {
  isVerifiedNativeAuthorizationProof,
  resolveRequiredScopes
} from "@/lib/openclaw/identity/authorization";
import type { OpenClawOperatorIdentity } from "@/lib/openclaw/identity/types";

export {
  isCliGatewayClientForcedByEnv,
  OPENCLAW_GATEWAY_PROTOCOL_RANGE,
  OpenClawGatewayClientError
};
export type {
  NativeWsOpenClawGatewayClientOptions,
  OpenClawGatewayTransport,
  WebSocketFactory
};
export type { OpenClawGatewayFallbackDiagnostic } from "@/lib/openclaw/client/native-ws-gateway-errors";

export function getRecentOpenClawGatewayFallbackDiagnostics() {
  return readRecentOpenClawGatewayFallbackDiagnostics();
}

export function clearOpenClawGatewayFallbackDiagnosticsForTesting() {
  clearGatewayFallbackDiagnosticsForTesting();
  clearCachedStatusUpdateRegistry();
}

function shouldRecoverPartialModelAuthStatusWithCli(status: ModelsStatusPayload) {
  const allowed = status.allowed ?? [];
  const hasOpenAiRoute = allowed.some((modelId) => /^openai\//i.test(modelId));

  if (!hasOpenAiRoute) {
    return false;
  }

  const authProviders = new Set(
    (status.auth?.providers ?? [])
      .map((entry) => entry.provider?.trim())
      .filter((provider): provider is string => Boolean(provider))
  );
  const oauthProviders = new Set(
    (status.auth?.oauth?.providers ?? [])
      .map((entry) => entry.provider?.trim())
      .filter((provider): provider is string => Boolean(provider))
  );
  const hasOpenAiAuthRoute = (status.auth?.runtimeAuthRoutes ?? []).some((entry) => {
    const provider = entry.provider?.trim().toLowerCase();
    const runtime = entry.runtime?.trim().toLowerCase();
    const authProvider = entry.authProvider?.trim().toLowerCase();
    const routeProvider = provider === "openai";
    const codexRuntime = runtime === "codex";
    const openAiAuth = authProvider === "openai";

    return routeProvider && codexRuntime && openAiAuth;
  });

  if (hasOpenAiAuthRoute) {
    return false;
  }

  const hasLegacyAuthIdentity = [...authProviders, ...oauthProviders].some(isUnsupportedLegacyProviderId);

  return !hasLegacyAuthIdentity && !authProviders.has("openai") && !oauthProviders.has("openai");
}

export class NativeWsOpenClawGatewayClient implements OpenClawGatewayClient {
  private readonly fallback: OpenClawGatewayClient;
  private readonly connection: OpenClawGatewayTransport;
  private readonly requestPolicy: AgentOsGatewayRequestPolicy;
  private readonly fallbackCounts: Record<string, number> = {};
  private lastNativeFailure: {
    at: string;
    operation: string;
    issue: string;
    kind: string;
    recovery: string;
  } | null = null;

  constructor(private readonly options: NativeWsOpenClawGatewayClientOptions = {}) {
    this.requestPolicy = options.requestPolicy ?? new AgentOsGatewayRequestPolicy();
    this.fallback = options.fallback ?? new CliOpenClawGatewayClient();
    this.connection = options.transport ?? new PersistentOpenClawGatewayConnection(this.fallback, options);
  }

  close(reason = "closed") {
    this.connection.close(reason);
    this.requestPolicy.reset(this.connection.getGeneration());
  }

  async getOperatorIdentity(options: OpenClawCommandOptions = {}): Promise<OpenClawOperatorIdentity> {
    try {
      await this.probeNativeHandshake(options);
    } catch {
      return this.connection.getOperatorIdentity();
    }

    return this.connection.getOperatorIdentity();
  }

  getDiagnostics(): OpenClawGatewayClientDiagnostics {
    this.observeRequestPolicyState();
    const connection = this.connection.getDiagnostics();
    const requestPolicy = this.requestPolicy.getDiagnostics();
    const forceCli = this.options.forceCli || isCliGatewayClientForcedByEnv();
    const fallbackTotal = Object.values(this.fallbackCounts).reduce((total, value) => {
      return Number.isFinite(value) && value > 0 ? total + value : total;
    }, 0);
    const recentFallbackDiagnostics = readRecentOpenClawGatewayFallbackDiagnostics();
    const activeFallbackTotal = hasFallbackAfterLastConnected(
      recentFallbackDiagnostics,
      connection.lastConnectedAt
    )
      ? fallbackTotal
      : 0;
    const activeNativeFailure = isDiagnosticAtOrAfter(
      this.lastNativeFailure?.at ?? null,
      connection.lastConnectedAt
    )
      ? this.lastNativeFailure
      : null;
    const lastNativeError = this.lastNativeFailure?.issue || sanitizeGatewayDiagnosticText(connection.lastNativeError);
    const activeLastNativeError =
      activeNativeFailure?.issue || sanitizeGatewayDiagnosticText(connection.lastNativeError);
    const gatewayMode = resolveGatewayMode({
      forceCli,
      connectionState: connection.connectionState,
      fallbackTotal: activeFallbackTotal,
      lastNativeError: activeLastNativeError
    });

    return {
      mode: forceCli ? "cli" : "native-ws",
      transportImplementation: forceCli
        ? "cli"
        : this.connection.lifecycleOwner === "official"
          ? "official"
          : "custom",
      transportSelectionWarning: this.options.transportSelectionWarning ?? null,
      gatewayMode,
      statusLabel: resolveGatewayStatusLabel(gatewayMode),
      recovery: resolveGatewayStatusRecovery(gatewayMode, activeNativeFailure?.recovery ?? null),
      connectionState: forceCli
        ? "cli-forced"
        : connection.connectionState,
      protocolVersion: connection.protocolVersion,
      protocolRange: OPENCLAW_GATEWAY_PROTOCOL_RANGE,
      fallbackCounts: { ...this.fallbackCounts },
      fallbackTotal,
      pendingRequestCount: connection.pendingRequestCount,
      sharedInFlightRequestCount: requestPolicy.sharedInFlightRequestCount,
      cachedReadRequestCount: requestPolicy.cachedReadRequestCount,
      recentFallbackDiagnostics,
      lastNativeError: lastNativeError || null,
      lastNativeFailureAt: this.lastNativeFailure?.at ?? null,
      lastConnectedAt: connection.lastConnectedAt,
      lastDisconnectedAt: connection.lastDisconnectedAt,
      operatorIdentity: this.connection.getOperatorIdentity(),
      gatewayCapabilities: connection.gatewayCapabilities
    };
  }

  private recordNativeFailure(operation: string, error: unknown) {
    const normalized = normalizeClientError(error);
    this.lastNativeFailure = {
      at: new Date().toISOString(),
      operation,
      issue: sanitizeGatewayDiagnosticText(normalized.message),
      kind: normalized.kind,
      recovery: resolveGatewayRecoveryMessage(normalized)
    };
  }

  private clearNativeFailure(operation: string) {
    if (this.lastNativeFailure?.operation === operation) {
      this.lastNativeFailure = null;
    }
  }

  private recordGatewayFallback(operation: string, error: unknown) {
    this.recordNativeFailure(operation, error);
    this.fallbackCounts[operation] = (this.fallbackCounts[operation] ?? 0) + 1;
    recordGatewayFallbackDiagnostic(operation, error);
  }

  private cliFallbackDisabledError(operation: string, error: unknown) {
    this.recordNativeFailure(operation, error);
    const normalized = normalizeClientError(error);
    const recovery = normalized.kind === "unsupported"
      ? `Update OpenClaw to a version that advertises the native ${operation} Gateway method.`
      : resolveGatewayRecoveryMessage(normalized);
    return new OpenClawGatewayClientError(
      `${normalized.message} Gateway-native operation failed; CLI fallback disabled for this operation. Recovery: ${recovery}`,
      normalized.kind,
      { cause: error }
    );
  }

  getHealth(options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawHealthPayload>(
      "health",
      {},
      options,
      (payload) => (isObjectRecord(payload) ? payload as OpenClawHealthPayload : {}),
      () => this.fallback.getHealth(options)
    );
  }

  getStatus(options: OpenClawCommandOptions = {}) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return this.fallback.getStatus(options);
    }

    return this.callNative<unknown>("status", {}, options)
      .then((payload) => {
        const status = parseGatewayPayload<StatusPayload>("status", statusPayloadSchema, payload);

        clearGatewayFallbackDiagnostic("status");
        this.clearNativeFailure("status");

        if (hasNativeStatusUpdateRegistry(status)) {
          rememberStatusUpdateRegistry(status.update?.registry);
          return status;
        }

        return mergeStatusPayload(status, null);
      })
      .catch((error) => {
        this.options.onNativeFailure?.(error, "status");
        const policy = resolveGatewayRequestPolicy("status", options);
        if (!shouldUseCliFallback(error, "status", policy)) {
          throw this.cliFallbackDisabledError("status", error);
        }
        this.recordGatewayFallback("status", error);
        return this.fallback.getStatus(options);
      });
  }

  async listUsers(options: OpenClawCommandOptions = {}): Promise<OpenClawUserListPayload> {
    const payload = await this.callNative<unknown>("users.list", {}, options, { safety: "read" });
    const profiles = isObjectRecord(payload) && Array.isArray(payload.profiles)
      ? payload.profiles.map(normalizeOpenClawUserProfile).filter((profile): profile is OpenClawUserProfile => Boolean(profile))
      : [];
    return { profiles };
  }

  async getCurrentUser(options: OpenClawCommandOptions = {}): Promise<OpenClawUserProfile | null> {
    const payload = await this.callNative<unknown>("users.self", {}, options, { safety: "read" });
    return normalizeOpenClawUserProfile(payload);
  }

  async setUserDisplayName(profileId: string, displayName: string, options: OpenClawCommandOptions = {}) {
    return this.callUserMutation("users.setDisplayName", { profileId, displayName }, options);
  }

  async setUserAvatar(profileId: string, avatar: string | null, options: OpenClawCommandOptions = {}) {
    return this.callUserMutation("users.setAvatar", { profileId, avatar }, options);
  }

  async linkUserEmail(profileId: string, email: string, options: OpenClawCommandOptions = {}) {
    return this.callUserMutation("users.linkEmail", { profileId, email }, options);
  }

  async setUserRole(profileId: string, role: string | null, options: OpenClawCommandOptions = {}) {
    return this.callUserMutation("users.setRole", { profileId, role }, options);
  }

  async listGatewayRoleNames(options: OpenClawCommandOptions = {}) {
    const payload = await this.callNative<unknown>("config.get", {}, options, { safety: "read" });
    const record = isObjectRecord(payload) ? payload : {};
    const config = isObjectRecord(record.config) ? record.config : record;
    const gateway = isObjectRecord(config.gateway) ? config.gateway : {};
    const roles = isObjectRecord(gateway.roles) ? gateway.roles : {};
    const definitions = isObjectRecord(roles.definitions) ? roles.definitions : {};
    return Object.keys(definitions).sort();
  }

  private async callUserMutation(method: string, params: Record<string, unknown>, options: OpenClawCommandOptions) {
    const payload = await this.callNative<unknown>(method, params, options, { safety: "mutation" });
    return normalizeOpenClawUserProfile(payload);
  }

  getUpdateStatus(options: OpenClawCommandOptions = {}) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return this.fallback.getUpdateStatus(options);
    }

    return this.callNative<unknown>("update.status", {}, options)
      .then(async (payload) => {
        const nativeStatus = parseObjectGatewayPayload<OpenClawUpdateStatusPayload>("update.status", payload);

        if (hasUpdateAvailabilityDetails(nativeStatus)) {
          clearGatewayFallbackDiagnostic("update.status");
          this.clearNativeFailure("update.status");
          return nativeStatus;
        }

        this.recordGatewayFallback(
          "update.status",
          new OpenClawGatewayClientError(
            "OpenClaw Gateway update.status did not include update availability details.",
            "malformed-response"
          )
        );
        const fallbackStatus = await this.fallback.getUpdateStatus(options);
        return mergeUpdateStatusPayloads(nativeStatus, fallbackStatus);
      })
      .catch((error) => {
        this.options.onNativeFailure?.(error, "update.status");
        const policy = resolveGatewayRequestPolicy("update.status", options);
        if (!shouldUseCliFallback(error, "update.status", policy)) {
          throw this.cliFallbackDisabledError("update.status", error);
        }
        this.recordGatewayFallback("update.status", error);
        return this.fallback.getUpdateStatus(options);
      });
  }

  getGatewayStatus(options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "health",
      {},
      options,
      (payload) => {
        const health = isObjectRecord(payload) ? payload : {};
        return {
          service: {
            label: health.ok === false ? "Runtime degraded" : "Runtime ready",
            loaded: health.ok !== false
          },
          rpc: {
            ok: health.ok !== false
          }
        } satisfies GatewayStatusPayload;
      },
      () => this.fallback.getGatewayStatus(options)
    );
  }

  async getModelStatus(options: OpenClawCommandOptions = {}) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return this.fallback.getModelStatus(options);
    }

    const [authResult, modelsResult] = await Promise.allSettled([
      this.callNative<unknown>("models.authStatus", {}, options),
      this.callNative<unknown>("models.list", { view: "configured" }, options)
    ]);
    const failures = [
      { method: "models.authStatus", result: authResult },
      { method: "models.list", result: modelsResult }
    ].filter((entry): entry is {
      method: string;
      result: PromiseRejectedResult;
    } => entry.result.status === "rejected");

    for (const failure of failures) {
      this.options.onNativeFailure?.(failure.result.reason, failure.method);
      if (!shouldUseCliFallback(failure.result.reason, failure.method, resolveGatewayRequestPolicy(failure.method, options))) {
        throw this.cliFallbackDisabledError(failure.method, failure.result.reason);
      }
    }

    if (authResult.status === "rejected" && modelsResult.status === "rejected") {
      const error = authResult.reason;
      this.recordGatewayFallback("models.authStatus", error);
      return this.fallback.getModelStatus(options);
    }

    clearGatewayFallbackDiagnostic("models.authStatus");
    clearGatewayFallbackDiagnostic("models.list");
    this.clearNativeFailure("models.authStatus");
    this.clearNativeFailure("models.list");
    const status = normalizeModelStatusPayload(
      authResult.status === "fulfilled" ? authResult.value : null,
      modelsResult.status === "fulfilled" ? modelsResult.value : null
    );

    if (shouldRecoverPartialModelAuthStatusWithCli(status)) {
      this.recordGatewayFallback(
        "models.authStatus",
        new Error("Native Gateway model auth status omitted Codex runtime auth details.")
      );

      try {
        return await this.fallback.getModelStatus(options);
      } catch {
        return status;
      }
    }

    return status;
  }

  async getAgentModelStatus(input: OpenClawAgentModelStatusInput, options: OpenClawCommandOptions = {}) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return this.fallback.getAgentModelStatus(input, options);
    }

    const agentId = input.agentId;
    const [authResult, modelsResult] = await Promise.allSettled([
      this.callNative<unknown>("models.authStatus", { agentId }, options),
      this.callNative<unknown>("models.list", { view: "configured" }, options)
    ]);
    const failures = [
      { method: "models.authStatus", result: authResult },
      { method: "models.list", result: modelsResult }
    ].filter((entry): entry is {
      method: string;
      result: PromiseRejectedResult;
    } => entry.result.status === "rejected");

    for (const failure of failures) {
      this.options.onNativeFailure?.(failure.result.reason, failure.method);
      if (!shouldUseCliFallback(failure.result.reason, failure.method, resolveGatewayRequestPolicy(failure.method, options))) {
        throw this.cliFallbackDisabledError(failure.method, failure.result.reason);
      }
    }

    if (authResult.status === "rejected" && modelsResult.status === "rejected") {
      const error = authResult.reason;
      this.recordGatewayFallback("models.authStatus", error);
      return this.fallback.getAgentModelStatus(input, options);
    }

    clearGatewayFallbackDiagnostic("models.authStatus");
    clearGatewayFallbackDiagnostic("models.list");
    this.clearNativeFailure("models.authStatus");
    this.clearNativeFailure("models.list");

    const authPayload = authResult.status === "fulfilled" ? authResult.value : null;
    const status = normalizeModelStatusPayload(
      authPayload,
      modelsResult.status === "fulfilled" ? modelsResult.value : null
    );

    if (isObjectRecord(authPayload)) {
      status.agentDir = readNonEmptyString(authPayload.agentDir) ?? status.agentDir;
    }

    if (shouldRecoverPartialModelAuthStatusWithCli(status)) {
      this.recordGatewayFallback(
        "models.authStatus",
        new Error("Native Gateway agent model auth status omitted Codex runtime auth details.")
      );

      try {
        return await this.fallback.getAgentModelStatus(input, options);
      } catch {
        return status;
      }
    }

    return status;
  }

  setModelAuthOrder(input: OpenClawModelAuthOrderSetInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirstCompatible(
      "modelAuthOrder",
      {
        provider: input.provider,
        agentId: input.agentId,
        profileIds: input.profileIds
      },
      options,
      commandResultFromGatewayPayload,
      () => this.fallback.setModelAuthOrder(input, options)
    );
  }

  listAgents(options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "agents.list",
      {},
      options,
      (payload) => parseGatewayPayload<OpenClawAgentListPayload>("agents.list", agentListPayloadSchema, payload),
      () => this.fallback.listAgents(options)
    );
  }

  listSessions(input: OpenClawListSessionsInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "sessions.list",
      { ...input },
      options,
      (payload) => parseGatewayPayload<OpenClawSessionsPayload>("sessions.list", sessionsPayloadSchema, payload),
      () => this.fallback.listSessions(input, options)
    );
  }

  async patchSessionModel(input: OpenClawSessionModelPatchInput, options: OpenClawCommandOptions = {}) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      throw new OpenClawGatewayClientError(
        "Resetting a session model override requires native OpenClaw Gateway support; CLI fallback is disabled for this operation.",
        "unsupported"
      );
    }

    const key = input.key ?? input.sessionKey;
    if (!key) {
      throw new OpenClawGatewayClientError("A session key is required to update the session model.", "unknown");
    }

    try {
      const payload = await this.callNative<unknown>(
        "sessions.patch",
        {
          key,
          agentId: input.agentId,
          model: input.model
        },
        options,
        resolveGatewayRequestPolicy("sessions.patch", options)
      );
      clearGatewayFallbackDiagnostic("sessions.patch");
      this.clearNativeFailure("sessions.patch");
      return parseObjectGatewayPayload<OpenClawSessionModelPatchPayload>("sessions.patch", payload);
    } catch (error) {
      this.options.onNativeFailure?.(error, "sessions.patch");
      throw this.cliFallbackDisabledError("sessions.patch", error);
    }
  }

  describeSession(input: OpenClawDescribeSessionInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawSessionPayload>(
      "sessions.describe",
      buildSessionReferenceParams(input),
      options,
      (payload) => parseObjectGatewayPayload<OpenClawSessionPayload>("sessions.describe", payload),
      () => this.fallback.describeSession(input, options)
    );
  }

  getSessionHistory(input: OpenClawSessionHistoryInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirstSessionHistory(input, options);
  }

  exportSession(input: OpenClawSessionExportInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirstSessionExport(input, options);
  }

  listTasks(input: OpenClawTaskListInput = {}, options: OpenClawCommandOptions = {}) {
    const { sessionId, ...taskListInput } = input;
    return this.gatewayFirst<OpenClawTaskListPayload>(
      "tasks.list",
      {
        ...taskListInput,
        sessionKey: taskListInput.sessionKey ?? sessionId
      },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawTaskListPayload>("tasks.list", payload),
      () => this.fallback.listTasks(input, options)
    );
  }

  getTask(input: OpenClawTaskGetInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawTaskPayload>(
      "tasks.get",
      { ...input },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawTaskPayload>("tasks.get", payload),
      () => this.fallback.getTask(input, options)
    );
  }

  assignTask(input: OpenClawTaskAssignInput, options: OpenClawCommandOptions = {}) {
    void input;
    void options;
    // The certified OpenClaw Gateway exposes tasks.list/get/cancel, but not tasks.assign.
    // Keep the compatibility surface for callers while preventing an invented
    // RPC or CLI fallback from mutating runtime state.
    return Promise.reject<OpenClawTaskPayload>(
      new OpenClawGatewayClientError(
        "The certified OpenClaw Gateway does not expose task assignment through Gateway or CLI.",
        "unsupported"
      )
    );
  }

  cancelTask(input: OpenClawTaskCancelInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawTaskPayload>(
      "tasks.cancel",
      {
        taskId: input.taskId,
        reason: input.reason ?? undefined
      },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawTaskPayload>("tasks.cancel", payload),
      () => this.fallback.cancelTask(input, options)
    );
  }

  listArtifacts(input: OpenClawArtifactListInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawArtifactListPayload>(
      "artifacts.list",
      buildArtifactListParams(input),
      options,
      (payload) => parseObjectGatewayPayload<OpenClawArtifactListPayload>("artifacts.list", payload),
      () => this.fallback.listArtifacts(input, options)
    );
  }

  getArtifact(input: OpenClawArtifactGetInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawArtifactPayload>(
      "artifacts.get",
      { ...input },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawArtifactPayload>("artifacts.get", payload),
      () => this.fallback.getArtifact(input, options)
    );
  }

  downloadArtifact(input: OpenClawArtifactDownloadInput, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall<OpenClawArtifactDownloadPayload>(
      "artifactDownload",
      "artifacts.download",
      { ...input },
      options
    );
  }

  putArtifact(input: OpenClawArtifactPutInput, options: OpenClawCommandOptions = {}) {
    const policy = {
      ...resolveGatewayRequestPolicy("artifacts.put", options),
      allowCliFallback: false,
      allowMutationFallbackOnUnsupported: false
    };
    return this.gatewayFirst<OpenClawArtifactPayload>(
      "artifacts.put",
      { ...input },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawArtifactPayload>("artifacts.put", payload),
      () => this.fallback.putArtifact(input, options),
      policy
    );
  }

  deleteArtifact(input: OpenClawArtifactDeleteInput, options: OpenClawCommandOptions = {}) {
    const policy = {
      ...resolveGatewayRequestPolicy("artifacts.delete", options),
      allowCliFallback: false,
      allowMutationFallbackOnUnsupported: false
    };
    return this.gatewayFirst<OpenClawArtifactPayload>(
      "artifacts.delete",
      {
        artifactId: input.artifactId,
        reason: input.reason ?? undefined
      },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawArtifactPayload>("artifacts.delete", payload),
      () => this.fallback.deleteArtifact(input, options),
      policy
    );
  }

  async getRuntimeSnapshot(input: OpenClawRuntimeSnapshotInput = {}, options: OpenClawCommandOptions = {}) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return this.fallback.getRuntimeSnapshot(input, options);
    }

    const includeSessions = input.includeSessions !== false;
    const includeTasks = input.includeTasks !== false;
    const includeArtifacts = input.includeArtifacts !== false;
    const artifactListInput = buildRuntimeSnapshotArtifactListInput(input);
    const includeScopedArtifacts = includeArtifacts && hasArtifactListScope(artifactListInput);
    const results = await Promise.allSettled([
      includeSessions
        ? this.listSessions({ limit: input.limit, agentId: input.agentId }, options)
        : Promise.resolve(null),
      includeTasks
        ? this.listTasks({ limit: input.limit, agentId: input.agentId, workspace: input.workspace }, options)
        : Promise.resolve(null),
      includeScopedArtifacts
        ? this.listArtifacts(artifactListInput, options)
        : Promise.resolve(null)
    ]);
    const requestedResults = results.filter((result, index) =>
      [includeSessions, includeTasks, includeScopedArtifacts][index]
    );
    const rejected = requestedResults.filter((result): result is PromiseRejectedResult => result.status === "rejected");

    if (requestedResults.length > 0 && rejected.length === requestedResults.length) {
      throw rejected[0]?.reason ?? new Error("OpenClaw Gateway runtime snapshot failed.");
    }

    const [sessionsResult, tasksResult, artifactsResult] = results;
    const payload: OpenClawRuntimeSnapshotPayload = {
      sessions: sessionsResult.status === "fulfilled" ? sessionsResult.value?.sessions ?? [] : [],
      tasks: tasksResult.status === "fulfilled" ? tasksResult.value?.tasks ?? [] : [],
      artifacts: artifactsResult.status === "fulfilled" ? artifactsResult.value?.artifacts ?? [] : []
    };

    if (rejected.length > 0) {
      payload.metadata = {
        runtimeSnapshot: {
          partial: true,
          errors: rejected.map((result) => summarizeSnapshotError(result.reason))
        }
      };
    }

    return payload;
  }

  getToolsCatalog(input: OpenClawToolsCatalogInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall<OpenClawToolsCatalogPayload>("tools", "tools.catalog", { ...input }, options);
  }

  getEffectiveTools(input: OpenClawToolsEffectiveInput, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall<OpenClawToolsEffectivePayload>("tools", "tools.effective", { ...input }, options);
  }

  invokeTool(input: OpenClawToolInvokeInput, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall<OpenClawToolInvokePayload>("tools", "tools.invoke", { ...input }, options, "mutation");
  }

  listCommands(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("commands", "commands.list", input, options);
  }

  getUsageStatus(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("usageStatus", "usage.status", input, options);
  }

  getUsageCost(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("usageCost", "usage.cost", input, options);
  }

  getSessionUsage(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("sessionUsage", "sessions.usage", input, options);
  }

  getSessionUsageTimeseries(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("sessionUsage", "sessions.usage.timeseries", input, options);
  }

  getSessionUsageLogs(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("sessionUsage", "sessions.usage.logs", input, options);
  }

  getMemoryDoctorStatus(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("memoryDoctor", "doctor.memory.status", input, options);
  }

  getMemoryDreamDiary(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("memoryDoctor", "doctor.memory.dreamDiary", input, options);
  }

  listAgentFiles(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("agentFiles", "agents.files.list", input, options);
  }

  getAgentFile(input: OpenClawGatewaySurfaceInput, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("agentFiles", "agents.files.get", input, options);
  }

  setAgentFile(input: OpenClawGatewaySurfaceInput, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("agentFiles", "agents.files.set", input, options, "mutation");
  }

  listEnvironments(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("environments", "environments.list", input, options);
  }

  getEnvironmentStatus(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("environments", "environments.status", input, options);
  }

  getTalkCatalog(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("talkCatalog", "talk.catalog", input, options);
  }

  getTalkConfig(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("talkConfig", "talk.config", input, options);
  }

  getTtsStatus(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("tts", "tts.status", input, options);
  }

  getTtsProviders(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("tts", "tts.providers", input, options);
  }

  listNodes(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("nodePresence", "node.list", input, options);
  }

  describeNode(input: OpenClawGatewaySurfaceInput, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("nodePresence", "node.describe", input, options);
  }

  invokeNode(input: OpenClawGatewaySurfaceInput, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("nodeInvoke", "node.invoke", input, options, "mutation");
  }

  listPluginApprovals(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("pluginApprovals", "plugin.approval.list", input, options);
  }

  resolvePluginApproval(input: OpenClawGatewaySurfaceInput, options: OpenClawCommandOptions = {}) {
    return this.gatewaySurfaceCall("pluginApprovals", "plugin.approval.resolve", input, options, "mutation");
  }

  getChannelStatus(input: OpenClawChannelStatusInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "channels.status",
      { ...input },
      options,
      (payload) => parseGatewayPayload<OpenClawChannelStatusPayload>(
        "channels.status",
        channelStatusPayloadSchema,
        payload
      ),
      () => this.fallback.getChannelStatus(input, options)
    );
  }

  startChannel(input: OpenClawChannelLifecycleInput, options: OpenClawCommandOptions = {}) {
    if (this.options.forceCli || options.forceCli || isCliGatewayClientForcedByEnv()) {
      return Promise.reject(new OpenClawGatewayClientError(
        "OpenClaw channel start requires the native Gateway transport; CLI fallback is disabled.",
        "unsupported"
      ));
    }
    return this.callNative<unknown>(
      "channels.start",
      { channel: input.channel, accountId: input.accountId },
      options,
      { safety: "mutation", timeoutMs: options.timeoutMs, allowCliFallback: false }
    ).then((payload) => parseObjectGatewayPayload<OpenClawChannelLifecycleResult>("channels.start", payload));
  }

  stopChannel(input: OpenClawChannelLifecycleInput, options: OpenClawCommandOptions = {}) {
    if (this.options.forceCli || options.forceCli || isCliGatewayClientForcedByEnv()) {
      return Promise.reject(new OpenClawGatewayClientError(
        "OpenClaw channel stop requires the native Gateway transport; CLI fallback is disabled.",
        "unsupported"
      ));
    }
    return this.callNative<unknown>(
      "channels.stop",
      { channel: input.channel, accountId: input.accountId },
      options,
      { safety: "mutation", timeoutMs: options.timeoutMs, allowCliFallback: false }
    ).then((payload) => parseObjectGatewayPayload<OpenClawChannelLifecycleResult>("channels.stop", payload));
  }

  startWebLogin(input: OpenClawWebLoginStartInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "web.login.start",
      { ...input },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawWebLoginResult>("web.login.start", payload),
      () => this.fallback.startWebLogin!(input, options)
    );
  }

  waitForWebLogin(input: OpenClawWebLoginWaitInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "web.login.wait",
      { ...input },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawWebLoginResult>("web.login.wait", payload),
      () => this.fallback.waitForWebLogin!(input, options)
    );
  }

  logoutChannel(input: OpenClawChannelLogoutInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "channels.logout",
      { channel: input.channel, accountId: input.accountId },
      options,
      (payload) => parseObjectGatewayPayload<Record<string, unknown>>("channels.logout", payload),
      () => this.fallback.logoutChannel!(input, options)
    );
  }

  getChannelLogs(input: OpenClawChannelLogsInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "channels.logs",
      { channel: input.channel, lines: input.lines ?? undefined },
      options,
      (payload) => (isObjectRecord(payload) ? payload as OpenClawChannelLogsPayload : {}),
      () => this.fallback.getChannelLogs(input, options)
    );
  }

  provisionChannelAccount(input: OpenClawChannelAccountProvisionInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirstCompatible(
      "channelProvisioning",
      buildChannelAccountProvisionParams(input),
      options,
      commandResultFromGatewayPayload,
      () => this.fallback.provisionChannelAccount(input, options)
    );
  }

  removeChannelAccount(input: OpenClawChannelAccountRemoveInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirstCompatible(
      "channelRemoval",
      {
        channel: input.channel,
        account: input.account,
        accountId: input.account,
        delete: input.delete ?? undefined
      },
      options,
      commandResultFromGatewayPayload,
      () => this.fallback.removeChannelAccount(input, options)
    );
  }

  setupGmailWebhook(input: OpenClawGmailSetupInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirstCompatible(
      "gmailProvisioning",
      {
        account: input.account,
        config: input.config ?? {}
      },
      options,
      commandResultFromGatewayPayload,
      () => this.fallback.setupGmailWebhook(input, options)
    );
  }

  listSkills(options: OpenClawCommandOptions & { eligible?: boolean } = {}) {
    return this.gatewayFirst(
      "skills.status",
      {},
      options,
      (payload) => {
        const parsed = parseGatewayPayload<OpenClawSkillListPayload>("skills.status", skillsPayloadSchema, payload);
        return options.eligible
          ? { ...parsed, skills: parsed.skills.filter((skill) => skill.eligible === true) }
          : parsed;
      },
      () => this.fallback.listSkills(options)
    );
  }

  listPlugins(options: OpenClawCommandOptions = {}) {
    return this.gatewayFirstCompatible(
      "plugins",
      {},
      options,
      normalizePluginsPayload,
      () => this.fallback.listPlugins(options)
    );
  }

  async listModels(input: OpenClawListModelsInput = {}, options: OpenClawCommandOptions = {}) {
    const view = input.view ?? (input.all ? "all" : "default");
    // OpenClaw 2026.8.2 accepts the catalog view here, but rejects provider as
    // a request parameter. Provider-scoped callers are filtered below.
    const models = await this.gatewayFirst(
      "models.list",
      {
        view,
        ...(input.preparedOnly !== undefined ? { preparedOnly: input.preparedOnly } : {}),
        ...(input.refresh !== undefined ? { refresh: input.refresh } : {}),
        ...(input.includeProviderCapabilities !== undefined
          ? { includeProviderCapabilities: input.includeProviderCapabilities }
          : {})
      },
      options,
      (payload) => {
        const normalized = normalizeModelsPayload(payload);
        return input.provider
          ? { ...normalized, models: normalized.models.filter((model) => model.key.split("/", 1)[0] === input.provider) }
          : normalized;
      },
      () => this.fallback.listModels(input, options)
    );

    const requiresCompleteProviderCatalog = view === "all" && input.provider === "google";

    if (view !== "all" || !input.provider || (models.models.length > 0 && !requiresCompleteProviderCatalog)) {
      return models;
    }

    const fallbackModels = await this.fallback.listModels(input, options);

    if (requiresCompleteProviderCatalog && fallbackModels.models.length <= models.models.length) {
      return models;
    }

    this.recordGatewayFallback(
      "models.list",
      new OpenClawGatewayClientError(
        `OpenClaw Gateway models.list returned an incomplete ${input.provider} catalog while provider-scoped discovery was requested.`,
        "malformed-response"
      )
    );

    return fallbackModels;
  }

  scanModels(options: OpenClawCommandOptions & { yes?: boolean; noInput?: boolean; noProbe?: boolean } = {}) {
    return this.gatewayFirstCompatible(
      "modelScan",
      {
        yes: options.yes === true ? true : undefined,
        noInput: options.noInput === true ? true : undefined,
        noProbe: options.noProbe === true ? true : undefined
      },
      options,
      (payload) => Array.isArray(payload)
        ? payload as OpenClawModelScanPayload
        : Array.isArray((payload as { models?: unknown[] } | null)?.models)
          ? (payload as { models: OpenClawModelScanPayload }).models
          : [],
      () => this.fallback.scanModels(options)
    );
  }

  probeGateway(options: OpenClawCommandOptions = {}) {
    return this.fallback.probeGateway(options);
  }

  controlGateway(action: "start" | "stop" | "restart", options: OpenClawCommandOptions & { force?: boolean } = {}) {
    if (isRailwayManagedRuntime()) {
      return Promise.reject(
        new Error(
          `OpenClaw Gateway ${action} is unavailable from AgentOS in Railway. The container supervisor owns the Gateway process lifecycle.`
        )
      );
    }

    this.close(`gateway.${action}`);
    return this.fallback.controlGateway(action, options).finally(() => {
      this.close(`gateway.${action}.completed`);
    });
  }

  listDeviceAccess(options: OpenClawCommandOptions = {}): Promise<OpenClawDeviceListPayload> {
    return this.gatewayFirstCompatible(
      "devicePairList",
      {},
      options,
      (payload) => parseObjectGatewayPayload<OpenClawDeviceListPayload>("device.pair.list", payload),
      () => this.fallback.listDeviceAccess?.(options) ?? this.fallback.call<OpenClawDeviceListPayload>("device.pair.list", {}, options)
    );
  }

  async approveDeviceAccess(
    input: OpenClawDeviceApproveInput = {},
    options: OpenClawCommandOptions = {}
  ): Promise<OpenClawDeviceApprovePayload> {
    if (input.latest !== false && !input.requestId) {
      return this.gatewayFirstCompatible(
        "devicePairList",
        {},
        options,
        (payload) => parseObjectGatewayPayload<Record<string, unknown>>("device.pair.list", payload),
        () => this.fallback.call<Record<string, unknown>>("device.pair.list", {}, options)
      ).then((payload) => {
        const requestId = resolveLatestPendingDeviceRequestId(payload);

        if (!requestId) {
          throw new OpenClawGatewayClientError("No pending OpenClaw device access request found.", "unknown");
        }

        return this.approveDeviceAccess({
          ...input,
          latest: false,
          requestId
        }, options);
      });
    }

    const params = input.scopes
      ? {
          requestId: input.requestId ?? undefined,
          scopes: input.scopes
        }
      : {
          requestId: input.requestId ?? undefined
        };

    try {
      return await this.gatewayFirstCompatible(
        "deviceApproval",
        params,
        options,
        (payload) => parseObjectGatewayPayload<OpenClawDeviceApprovePayload>("device.pair.approve", payload),
        () => this.fallback.approveDeviceAccess(input, options)
      );
    } catch (error) {
      if (!input.scopes || !input.requestId || !isLegacyDeviceApprovalScopesParamError(error)) {
        throw error;
      }
    }

    return this.gatewayFirstCompatible(
      "deviceApproval",
      { requestId: input.requestId },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawDeviceApprovePayload>("device.pair.approve", payload),
      () => this.fallback.approveDeviceAccess(input, options)
    );
  }

  async call<TPayload>(
    method: string,
    params: Record<string, unknown> = {},
    options: OpenClawCommandOptions = {}
  ) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      if (resolveGatewayRequestPolicy(method, options).safety === "mutation") {
        this.assertVerifiedCliMutationFallback(method, params, options);
      }
      return this.fallback.call<TPayload>(method, params, options);
    }

    try {
      const payload = await this.callNative<TPayload>(method, params, options);
      clearGatewayFallbackDiagnostic(method);
      this.clearNativeFailure(method);
      return payload;
    } catch (error) {
      this.options.onNativeFailure?.(error, method);
      const policy = resolveGatewayRequestPolicy(method, options);
      if (!shouldUseCliFallback(error, method, policy)) {
        throw this.cliFallbackDisabledError(method, error);
      }
      if (policy.safety === "mutation") {
        this.assertVerifiedCliMutationFallback(method, params, options);
      }
      this.recordGatewayFallback(method, error);
      return this.fallback.call<TPayload>(method, params, options);
    }
  }

  getConfig<TPayload>(path: string, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<TPayload | null>(
      "config.get",
      {},
      options,
      (payload) => {
        const snapshot = parseGatewayPayload<Record<string, unknown>>(
          "config.get",
          configSnapshotPayloadSchema,
          payload
        );
        const config = isObjectRecord(snapshot.config) ? snapshot.config : {};
        const resolved = isObjectRecord(snapshot.resolved) ? snapshot.resolved : {};
        const value = readConfigPath(config, path) ?? readConfigPath(resolved, path);
        return value === undefined ? null : value as TPayload;
      },
      () => this.fallback.getConfig<TPayload>(path, options)
    );
  }

  getConfigSchema(options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawConfigSchemaPayload | null>(
      "config.schema",
      {},
      options,
      (payload) => (isObjectRecord(payload) ? payload as OpenClawConfigSchemaPayload : null),
      () => this.fallback.getConfigSchema?.(options) ?? Promise.resolve(null)
    );
  }

  lookupConfigSchema(input: OpenClawConfigSchemaLookupInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawConfigSchemaLookupPayload | null>(
      "config.schema.lookup",
      { path: input.path },
      options,
      (payload) => (isObjectRecord(payload) ? payload as OpenClawConfigSchemaLookupPayload : null),
      () => this.fallback.lookupConfigSchema?.(input, options) ?? Promise.resolve(null)
    );
  }

  async hasConfig(path: string, options: OpenClawCommandOptions = {}) {
    const value = await this.getConfig(path, options);
    return value !== null && value !== undefined;
  }

  setConfig(path: string, value: unknown, options: OpenClawCommandOptions & { strictJson?: boolean } = {}) {
    return this.gatewayConfigMutationFirst(
      "config.set",
      path,
      value,
      options,
      (config) => setConfigPathValue(config, path, value),
      () => this.fallback.setConfig(path, value, options)
    );
  }

  unsetConfig(path: string, options: OpenClawCommandOptions = {}) {
    return this.gatewayConfigMutationFirst(
      "config.unset",
      path,
      undefined,
      options,
      (config) => unsetConfigPathValue(config, path),
      () => this.fallback.unsetConfig(path, options)
    );
  }

  addAgent(input: OpenClawAddAgentInput, options: OpenClawCommandOptions = {}) {
    // The native contract uses `name` as the creation identity. AgentOS syncs
    // its product-owned display name and agentDir after this lifecycle call.
    const params: Record<string, unknown> = {
      name: input.id,
      workspace: input.workspace
    };

    if (input.model) {
      params.model = input.model;
    }
    if (input.emoji) {
      params.emoji = input.emoji;
    }
    if (input.avatar) {
      params.avatar = input.avatar;
    }

    return this.gatewayFirst(
      "agents.create",
      params,
      options,
      commandResultFromGatewayPayload,
      () => this.fallback.addAgent(input, options)
    );
  }

  updateAgent(input: OpenClawUpdateAgentInput, options: OpenClawCommandOptions = {}) {
    const params: Record<string, unknown> = {
      agentId: input.id
    };

    if (input.name !== undefined && input.name !== null && input.name.trim()) {
      params.name = input.name.trim();
    }
    if (input.workspace !== undefined && input.workspace !== null && input.workspace.trim()) {
      params.workspace = input.workspace.trim();
    }
    if (input.model !== undefined) {
      params.model = input.model?.trim() || null;
    }
    if (input.emoji !== undefined) {
      params.emoji = input.emoji?.trim() || "";
    }
    if (input.avatar !== undefined) {
      params.avatar = input.avatar?.trim() || "";
    }

    return this.gatewayFirst(
      "agents.update",
      params,
      options,
      commandResultFromGatewayPayload,
      () => this.fallback.updateAgent?.(input, options) ??
        Promise.reject(new Error(
          "OpenClaw agent update is unavailable: agents.update is not supported and no real CLI fallback is available."
        ))
    );
  }

  setAgentIdentity(input: OpenClawAgentIdentityInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirstCompatible(
      "agentIdentity",
      buildAgentIdentityParams(input),
      options,
      commandResultFromGatewayPayload,
      () => this.fallback.setAgentIdentity(input, options)
    );
  }

  deleteAgent(agentId: string, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "agents.delete",
      { agentId },
      options,
      commandResultFromGatewayPayload,
      () => this.fallback.deleteAgent(agentId, options)
    );
  }

  provisionAutomation(input: OpenClawAutomationProvisionInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirstCompatible(
      "automationProvisioning",
      buildAutomationProvisionParams(input),
      options,
      commandResultFromGatewayPayload,
      () => this.fallback.provisionAutomation(input, options)
    );
  }

  async runAgentTurn(input: OpenClawAgentTurnInput, options: OpenClawCommandOptions = {}) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      this.assertVerifiedCliMutationFallback("chat.send", {
        sessionKey: input.sessionKey?.trim() || buildAgentSessionKey(input.agentId, input.sessionId)
      }, options);
      return this.fallback.runAgentTurn(input, options);
    }

    try {
      const payload = await this.runAgentTurnNative(input, options);
      clearGatewayFallbackDiagnostic("chat.send");
      clearGatewayFallbackDiagnostic("sessions.send");
      this.clearNativeFailure("chat.send");
      this.clearNativeFailure("sessions.send");
      if (!shouldWaitForNativeAgentTurn(input, payload)) {
        return payload;
      }

      return await this.waitForAgentTurnNative(input, payload, options) ?? payload;
    } catch (error) {
      this.options.onNativeFailure?.(error, "chat.send");
      const method = error instanceof NativeGatewayRequestError ? error.method : "chat.send";
      const policy = resolveGatewayRequestPolicy(method, options);
      if (!shouldUseCliFallback(error, method, policy)) {
        throw this.cliFallbackDisabledError(method, error);
      }
      this.assertVerifiedCliMutationFallback(method, {
        sessionKey: input.sessionKey?.trim() || buildAgentSessionKey(input.agentId, input.sessionId)
      }, options);
      this.recordGatewayFallback("chat.send", error);
      return this.fallback.runAgentTurn(input, options);
    }
  }

  abortAgentTurn(input: OpenClawAbortTurnInput, options: OpenClawCommandOptions = {}) {
    const sessionKey = input.sessionKey?.trim() || undefined;

    return this.gatewayFirst(
      "sessions.abort",
      {
        key: sessionKey,
        agentId: input.agentId ?? undefined,
        runId: input.runId ?? undefined,
        clearQueued: input.clearQueued ?? undefined
      },
      options,
      (payload) => payload as MissionCommandPayload,
      () => {
        if (!sessionKey) {
          return this.fallback.abortAgentTurn?.(input, options) ??
            Promise.reject(new OpenClawGatewayClientError(
              "OpenClaw chat.abort fallback requires the exact session key returned by the Gateway.",
              "unsupported"
            ));
        }

        return this.gatewayFirst(
          "chat.abort",
          {
            sessionKey,
            agentId: input.agentId ?? undefined,
            runId: input.runId ?? undefined
          },
          options,
          (payload) => payload as MissionCommandPayload,
          () => this.fallback.abortAgentTurn?.(input, options) ??
            this.fallback.call<MissionCommandPayload>("sessions.abort", { key: sessionKey, runId: input.runId ?? undefined }, options)
        );
      }
    );
  }

  async steerSession(input: OpenClawSessionSteerInput, options: OpenClawCommandOptions = {}) {
    if (this.options.forceCli || options.forceCli || isCliGatewayClientForcedByEnv()) {
      throw new OpenClawGatewayClientError("Native OpenClaw Gateway is required for chat.send steering.", "unsupported");
    }

    try {
      const payload = await this.callNative<unknown>(
        "chat.send",
        buildSessionSteerParams(input),
        options,
        {
          safety: "mutation",
          timeoutMs: options.timeoutMs,
          allowCliFallback: false,
          allowMutationFallbackOnUnsupported: false
        }
      );
      this.clearNativeFailure("chat.send");
      return parseObjectGatewayPayload<OpenClawSessionControlPayload>("chat.send", payload);
    } catch (error) {
      this.options.onNativeFailure?.(error, "chat.send");
      throw this.cliFallbackDisabledError("chat.send", error);
    }
  }

  async injectChat(input: OpenClawChatInjectInput, options: OpenClawCommandOptions = {}) {
    if (this.options.forceCli || options.forceCli || isCliGatewayClientForcedByEnv()) {
      throw new OpenClawGatewayClientError("Native OpenClaw Gateway is required for chat.inject.", "unsupported");
    }

    try {
      const payload = await this.callNative<unknown>(
        "chat.inject",
        buildChatInjectParams(input),
        options,
        {
          safety: "mutation",
          timeoutMs: options.timeoutMs,
          allowCliFallback: false,
          allowMutationFallbackOnUnsupported: false
        }
      );
      this.clearNativeFailure("chat.inject");
      return parseObjectGatewayPayload<OpenClawSessionControlPayload>("chat.inject", payload);
    } catch (error) {
      this.options.onNativeFailure?.(error, "chat.inject");
      throw this.cliFallbackDisabledError("chat.inject", error);
    }
  }

  async streamAgentTurn(
    input: OpenClawAgentTurnInput,
    callbacks: OpenClawStreamCallbacks = {},
    options: OpenClawCommandOptions = {}
  ) {
    if (options.forceCli || this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      this.assertVerifiedCliMutationFallback("chat.send", {
        sessionKey: input.sessionKey?.trim() || buildAgentSessionKey(input.agentId, input.sessionId)
      }, options);
      return this.fallback.streamAgentTurn(input, callbacks, options);
    }

    const sessionKey = input.sessionKey?.trim() || buildAgentSessionKey(input.agentId, input.sessionId);
    let subscription: OpenClawGatewayEventSubscription | null = null;
    let dispatchedRunId: string | null = null;
    let lastAssistantText = "";
    let resolveFinal: (payload: MissionCommandPayload | null) => void = () => {};
    const finalPayload = new Promise<MissionCommandPayload | null>((resolve) => {
      resolveFinal = resolve;
    });

    try {
      subscription = await this.subscribeNativeEvents(
        {
          subscribeSessions: true,
          sessionKeys: [sessionKey]
        },
        {
          onEvent: (frame) => {
            const eventPayload = normalizeGatewayTurnEvent(frame, sessionKey, dispatchedRunId);
            if (!eventPayload) {
              return;
            }

            if (eventPayload.text && eventPayload.text !== lastAssistantText) {
              lastAssistantText = eventPayload.text;
              void callbacks.onStdout?.(`${JSON.stringify({ type: "assistant", text: eventPayload.text })}\n`);
            }

            if (eventPayload.done) {
              resolveFinal?.(eventPayload.payload);
            }
          },
          onError: (error) => {
            void callbacks.onStderr?.(error instanceof Error ? `${error.message}\n` : `${String(error)}\n`);
          }
        },
        options
      );

      const dispatchPayload = await this.runAgentTurnNative(input, options);
      dispatchedRunId = dispatchPayload.runId ?? null;
      clearGatewayFallbackDiagnostic("streamAgentTurn");
      this.clearNativeFailure("streamAgentTurn");

      const waitMs = resolveAgentTurnWaitMs(input, options);
      const settledPayload = await Promise.race([
        finalPayload,
        new Promise<null>((resolve) => globalThis.setTimeout(() => resolve(null), waitMs))
      ]);

      if (settledPayload) {
        return settledPayload;
      }

      return await this.waitForAgentTurnNative(input, dispatchPayload, options) ?? dispatchPayload;
    } catch (error) {
      this.options.onNativeFailure?.(error, "streamAgentTurn");
      const method = error instanceof NativeGatewayRequestError ? error.method : "streamAgentTurn";
      if (!shouldUseCliFallback(error, method, { safety: "mutation" })) {
        throw this.cliFallbackDisabledError(method, error);
      }
      this.assertVerifiedCliMutationFallback(method, {
        sessionKey: input.sessionKey?.trim() || buildAgentSessionKey(input.agentId, input.sessionId)
      }, options);
      this.recordGatewayFallback("streamAgentTurn", error);
      return this.fallback.streamAgentTurn(input, callbacks, options);
    } finally {
      subscription?.close();
      resolveFinal(null);
    }
  }

  private async runAgentTurnNative(input: OpenClawAgentTurnInput, options: OpenClawCommandOptions = {}) {
    const sessionKey = input.sessionKey?.trim() || buildAgentSessionKey(input.agentId, input.sessionId);
    const timeoutMs = typeof input.timeoutSeconds === "number" && Number.isFinite(input.timeoutSeconds)
      ? Math.max(0, Math.floor(input.timeoutSeconds * 1000))
      : undefined;
    const idempotencyKey = input.idempotencyKey?.trim() || input.dispatchId || createRequestId();
    const createdSession = await this.prepareNativeSession(input, sessionKey, options);
    const chatParams = {
      sessionKey,
      sessionId: input.sessionId,
      message: input.message,
      thinking: input.thinking,
      timeoutMs,
      idempotencyKey
    };

    try {
      const payload = await this.callNative<MissionCommandPayload>("chat.send", chatParams, options);
      return withChatAdmission({
        ...payload,
        sessionKey: payload.sessionKey ?? createdSession?.sessionKey,
        sessionId: payload.sessionId ?? createdSession?.sessionId ?? undefined
      }, sessionKey, idempotencyKey);
    } catch (error) {
      if (!isGatewayMethodUnsupported(error)) {
        if (isGatewayAgentNotFoundError(error, input.agentId)) {
          const registryState = await this.checkGatewayAgentRegistry(input.agentId, options);

          if (registryState === "present") {
            try {
              const retrySession = await this.prepareNativeSession(input, sessionKey, options);
              const payload = await this.callNative<MissionCommandPayload>("chat.send", chatParams, options);
              return withChatAdmission({
                ...payload,
                sessionKey: payload.sessionKey ?? retrySession?.sessionKey ?? createdSession?.sessionKey,
                sessionId: payload.sessionId ?? retrySession?.sessionId ?? createdSession?.sessionId ?? undefined
              }, sessionKey, idempotencyKey);
            } catch (retryError) {
              if (isGatewayAgentNotFoundError(retryError, input.agentId)) {
                throw buildGatewayAgentRegistryError(input.agentId, retryError);
              }

              throw retryError;
            }
          }

          if (registryState === "missing") {
            throw buildGatewayAgentRegistryError(input.agentId, error);
          }
        }

        throw error;
      }
    }

    return this.callNative<MissionCommandPayload>(
      "sessions.send",
      {
        agentId: input.agentId,
        key: sessionKey,
        message: input.message,
        thinking: input.thinking,
        timeoutMs,
        idempotencyKey
      },
      options
    ).then((payload) => withChatAdmission({
      ...payload,
      sessionKey: payload.sessionKey ?? createdSession?.sessionKey,
      sessionId: payload.sessionId ?? createdSession?.sessionId ?? undefined
    }, sessionKey, idempotencyKey));
  }

  private async checkGatewayAgentRegistry(
    agentId: string,
    options: OpenClawCommandOptions
  ): Promise<"present" | "missing" | "unknown"> {
    try {
      const payload = parseGatewayPayload<OpenClawAgentListPayload>(
        "agents.list",
        agentListPayloadSchema,
        await this.callNative<unknown>("agents.list", {}, { ...options, timeoutMs: 5000 }, { safety: "read", timeoutMs: 5000 })
      );
      clearGatewayFallbackDiagnostic("agents.list");
      this.clearNativeFailure("agents.list");
      return gatewayAgentListIncludes(payload, agentId) ? "present" : "missing";
    } catch {
      return "unknown";
    }
  }

  private async prepareNativeSession(input: OpenClawAgentTurnInput, sessionKey: string, options: OpenClawCommandOptions) {
    if (!input.sessionId && !input.dispatchId) {
      return null;
    }

    try {
      const hello = await this.probeNativeHandshake(options);
      const advertisedMethods = readAdvertisedGatewayMethods(hello);
      if (advertisedMethods.length > 0 && !advertisedMethods.includes("sessions.create")) {
        return null;
      }
    } catch {
      // The chat request remains the authoritative native attempt.
    }

    try {
      const payload = await this.callNative<Record<string, unknown>>(
        "sessions.create",
        buildNativeSessionCreateParams(input, sessionKey),
        options,
        { safety: "mutation" }
      );
      clearGatewayFallbackDiagnostic("sessions.create");
      return {
        sessionKey: readNonEmptyString(payload.key) ?? readNonEmptyString(payload.sessionKey) ?? sessionKey,
        sessionId: readNonEmptyString(payload.sessionId)
      };
    } catch (error) {
      if (!shouldIgnoreNativeSessionPreparationError(error)) {
        throw error;
      }
      return null;
    }

  }

  private async waitForAgentTurnNative(
    input: OpenClawAgentTurnInput,
    dispatchPayload: MissionCommandPayload,
    options: OpenClawCommandOptions
  ) {
    if (!dispatchPayload.runId) {
      return null;
    }

    const waitMs = resolveAgentTurnWaitMs(input, options);
    const requestTimeoutMs = resolveNativeAgentWaitRequestTimeoutMs(waitMs);

    try {
      const hello = await this.probeNativeHandshake(options);
      const advertisedMethods = readAdvertisedGatewayMethods(hello);
      if (advertisedMethods.length > 0 && !advertisedMethods.includes("agent.wait")) {
        return null;
      }
    } catch {
      // The already-dispatched native turn remains the source of truth.
    }

    try {
      const payload = await this.callNative<MissionCommandPayload>(
        "agent.wait",
        buildNativeAgentWaitParams(input, dispatchPayload.runId, waitMs),
        { ...options, timeoutMs: requestTimeoutMs },
        { safety: "read", timeoutMs: requestTimeoutMs }
      );
      clearGatewayFallbackDiagnostic("agent.wait");
      return payload;
    } catch (error) {
      if (shouldRetryNativeAgentWaitWithSessionParams(error)) {
        const payload = await this.callNative<MissionCommandPayload>(
          "agent.wait",
          buildNativeAgentWaitParams(input, dispatchPayload.runId, waitMs, { includeSession: true }),
          { ...options, timeoutMs: requestTimeoutMs },
          { safety: "read", timeoutMs: requestTimeoutMs }
        );
        clearGatewayFallbackDiagnostic("agent.wait");
        return payload;
      }

      if (!shouldIgnoreNativeAgentWaitError(error)) {
        throw error;
      }
      return null;
    }
  }

  tailLogs(input: OpenClawLogsTailInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawLogsTailPayload>(
      "logs.tail",
      { ...input },
      options,
      (payload) => (isObjectRecord(payload) ? payload as OpenClawLogsTailPayload : {}),
      () => this.fallback.tailLogs?.(input, options) ?? this.fallback.call<OpenClawLogsTailPayload>("logs.tail", { ...input }, options)
    );
  }

  listExecApprovals(input: OpenClawExecApprovalListInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawExecApprovalListPayload>(
      "exec.approval.list",
      { ...input },
      options,
      (payload) => (isObjectRecord(payload) ? payload as OpenClawExecApprovalListPayload : {}),
      () => this.fallback.listExecApprovals?.(input, options) ??
        this.fallback.call<OpenClawExecApprovalListPayload>("exec.approval.list", { ...input }, options)
    );
  }

  resolveExecApproval(input: OpenClawExecApprovalResolveInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawExecApprovalResolvePayload>(
      "exec.approval.resolve",
      {
        approvalId: input.approvalId,
        decision: input.decision,
        reason: input.reason ?? undefined
      },
      options,
      (payload) => (isObjectRecord(payload) ? payload as OpenClawExecApprovalResolvePayload : {}),
      () => this.fallback.resolveExecApproval?.(input, options) ??
        this.fallback.call<OpenClawExecApprovalResolvePayload>(
          "exec.approval.resolve",
          {
            approvalId: input.approvalId,
            decision: input.decision,
            reason: input.reason ?? undefined
          },
          options
        )
    );
  }

  getCronStatus(options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawCronStatusPayload>(
      "cron.status",
      {},
      options,
      (payload) => (isObjectRecord(payload) ? payload as OpenClawCronStatusPayload : {}),
      () => this.fallback.getCronStatus?.(options) ?? this.fallback.call<OpenClawCronStatusPayload>("cron.status", {}, options)
    );
  }

  listCronJobs(input: OpenClawCronListInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawCronListPayload>(
      "cron.list",
      { ...input },
      options,
      (payload) => (isObjectRecord(payload) ? payload as OpenClawCronListPayload : {}),
      () => this.fallback.listCronJobs?.(input, options) ?? this.fallback.call<OpenClawCronListPayload>("cron.list", { ...input }, options)
    );
  }

  getCronJob(input: OpenClawCronGetInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<Record<string, unknown>>(
      "cron.get",
      { id: input.id },
      options,
      (payload) => isObjectRecord(payload) ? payload : {},
      () => this.fallback.getCronJob?.(input, options) ?? this.fallback.call<Record<string, unknown>>("cron.get", { id: input.id }, options)
    );
  }

  runCronJob(input: OpenClawCronRunInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawCronRunPayload>(
      "cron.run",
      {
        id: input.id,
        mode: input.mode,
        expectedProcessInstanceId: input.expectedProcessInstanceId
      },
      options,
      (payload) => isObjectRecord(payload) ? payload as OpenClawCronRunPayload : {},
      () => this.fallback.runCronJob?.(input, options) ?? this.fallback.call<OpenClawCronRunPayload>("cron.run", {
        id: input.id,
        mode: input.mode,
        expectedProcessInstanceId: input.expectedProcessInstanceId
      }, options)
    );
  }

  listCronRuns(input: OpenClawCronRunsInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawCronRunsPayload>(
      "cron.runs",
      { ...input },
      options,
      (payload) => isObjectRecord(payload) ? payload as OpenClawCronRunsPayload : {},
      () => this.fallback.listCronRuns?.(input, options) ?? this.fallback.call<OpenClawCronRunsPayload>("cron.runs", { ...input }, options)
    );
  }

  async subscribeRuntimeEvents(
    input: OpenClawRuntimeEventSubscriptionInput,
    callbacks: OpenClawGatewayEventCallbacks,
    options: OpenClawCommandOptions = {}
  ) {
    if (options.forceCli || this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return this.fallback.subscribeRuntimeEvents(input, callbacks, options);
    }

    const hasExplicitIncludes = [
      input.includeSessions,
      input.includeTasks,
      input.includeArtifacts,
      input.includeApprovals
    ].some((value) => value !== undefined);

    try {
      const subscription = await this.subscribeNativeEvents(
        {
          subscribeSessions: input.includeSessions ?? !hasExplicitIncludes,
          subscribeTasks: input.includeTasks ?? (input.taskIds?.length ? true : undefined),
          subscribeArtifacts: input.includeArtifacts,
          subscribeApprovals: input.includeApprovals,
          sessionKeys: input.sessionKeys,
          taskIds: input.taskIds,
          artifactIds: input.artifactIds
        },
        callbacks,
        options
      );
      clearGatewayFallbackDiagnostic("runtime.subscribe");
      this.clearNativeFailure("runtime.subscribe");
      return subscription;
    } catch (error) {
      this.options.onNativeFailure?.(error, "runtime.subscribe");
      if (!shouldUseCliFallback(error, "runtime.subscribe", { safety: "read", timeoutMs: options.timeoutMs })) {
        throw this.cliFallbackDisabledError("runtime.subscribe", error);
      }

      this.recordGatewayFallback("runtime.subscribe", error);
      return this.fallback.subscribeRuntimeEvents(input, callbacks, options);
    }
  }

  async callNative<TPayload>(
    method: string,
    params: Record<string, unknown> = {},
    options: OpenClawCommandOptions = {},
    policy: OpenClawGatewayRequestPolicy = resolveGatewayRequestPolicy(method, options)
  ) {
    const timeoutMs = resolveNativeTimeoutMs(policy.timeoutMs ?? options.timeoutMs ?? this.options.timeoutMs, method);
    this.observeRequestPolicyState();
    const requestState = this.readRequestPolicyConnectionState();
    return this.requestPolicy.request(
      method,
      params,
      options,
      policy,
      () => this.connection.request<TPayload>(method, params, options, timeoutMs),
      requestState
    );
  }

  private observeRequestPolicyState() {
    this.requestPolicy.observeConnectionState(this.readRequestPolicyConnectionState());
  }

  private readRequestPolicyConnectionState() {
    return {
      lifecycleState: this.connection.getLifecycleState(),
      generation: this.connection.getGeneration(),
      getCurrentState: () => ({
        lifecycleState: this.connection.getLifecycleState(),
        generation: this.connection.getGeneration()
      })
    };
  }

  async probeNativeHandshake(options: OpenClawCommandOptions = {}) {
    const timeoutMs = resolveNativeTimeoutMs(options.timeoutMs ?? this.options.timeoutMs, CONNECT_METHOD);
    return this.connection.probe(options, timeoutMs);
  }

  async subscribeNativeEvents(
    params: Record<string, unknown>,
    callbacks: OpenClawGatewayEventCallbacks,
    options: OpenClawCommandOptions = {}
  ): Promise<OpenClawGatewayEventSubscription> {
    const timeoutMs = resolveNativeTimeoutMs(options.timeoutMs ?? this.options.timeoutMs, "sessions.subscribe");
    this.requestPolicy.invalidateReadCache();
    const subscription = await this.connection.subscribe(params, callbacks, options, timeoutMs);
    let closed = false;
    return {
      ...subscription,
      close: () => {
        if (closed) {
          return;
        }
        closed = true;
        this.requestPolicy.invalidateReadCache();
        subscription.close();
      }
    };
  }

  private async gatewaySurfaceCall<TPayload extends OpenClawGatewaySurfacePayload = OpenClawGatewaySurfacePayload>(
    operationId: OpenClawGatewayCompatibilityOperationId,
    method: string,
    params: Record<string, unknown> = {},
    options: OpenClawCommandOptions = {},
    safety: OpenClawGatewayRequestPolicy["safety"] = "read"
  ): Promise<TPayload> {
    const operation = getOpenClawGatewayCompatibilityOperation(operationId);
    if (this.options.forceCli || options.forceCli || isCliGatewayClientForcedByEnv()) {
      if (operation.fallbackAllowed === false) {
        throw new OpenClawGatewayClientError(
          `${operation.label} requires native OpenClaw Gateway support; CLI fallback is disabled for this operation.`,
          "unsupported"
        );
      }
      if (safety === "mutation") {
        this.assertVerifiedCliMutationFallback(method, params, options);
      }
      return this.fallback.call<TPayload>(method, params, options);
    }

    try {
      const payload = await this.callNative<unknown>(method, params, options, {
        safety,
        timeoutMs: options.timeoutMs,
        allowCliFallback: false
      });
      clearGatewayFallbackDiagnostic(operationId);
      this.clearNativeFailure(operationId);
      return parseObjectGatewayPayload<TPayload>(method, payload);
    } catch (error) {
      this.options.onNativeFailure?.(error, operationId);
      throw this.cliFallbackDisabledError(method, error);
    }
  }

  private async gatewayFirstSessionHistory(
    input: OpenClawSessionHistoryInput,
    options: OpenClawCommandOptions
  ) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return this.fallback.getSessionHistory(input, options);
    }

    const candidates = [
      ["chat.history", buildChatHistoryParams(input)] as const,
      ["sessions.preview", buildSessionPreviewParams(input)] as const,
      ["sessions.history", buildSessionHistoryParams(input)] as const
    ];
    let lastUnsupportedError: unknown = null;

    for (const [method, params] of candidates) {
      const policy = resolveGatewayRequestPolicy(method, options);

      try {
        const payload = parseObjectGatewayPayload<OpenClawSessionHistoryPayload>(
          method,
          await this.callNative<unknown>(method, params, options, policy)
        );
        for (const [candidate] of candidates) {
          clearGatewayFallbackDiagnostic(candidate);
          this.clearNativeFailure(candidate);
        }
        return payload;
      } catch (error) {
        this.options.onNativeFailure?.(error, method);
        if (isGatewayMethodUnsupported(error)) {
          lastUnsupportedError = error;
          continue;
        }

        if (!shouldUseCliFallback(error, method, policy)) {
          throw this.cliFallbackDisabledError(method, error);
        }

        this.recordGatewayFallback(method, error);
        return this.fallback.getSessionHistory(input, options);
      }
    }

    this.recordGatewayFallback(
      "chat.history",
      lastUnsupportedError ?? new NativeGatewayError(
        "OpenClaw Gateway does not advertise a compatible session history method.",
        { kind: "unsupported" }
      )
    );
    return this.fallback.getSessionHistory(input, options);
  }

  private async gatewayFirstSessionExport(
    input: OpenClawSessionExportInput,
    options: OpenClawCommandOptions
  ) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      return this.fallback.exportSession(input, options);
    }

    const params = buildSessionReferenceParams(input);
    const candidates = [
      ["sessions.get", params] as const,
      ["sessions.describe", params] as const,
      ["sessions.export", { ...params, format: input.format }] as const
    ];
    let lastUnsupportedError: unknown = null;

    for (const [method, candidateParams] of candidates) {
      const policy = resolveGatewayRequestPolicy(method, options);

      try {
        const payload = parseObjectGatewayPayload<Record<string, unknown>>(
          method,
          await this.callNative<unknown>(method, candidateParams, options, policy)
        );
        for (const [candidate] of candidates) {
          clearGatewayFallbackDiagnostic(candidate);
          this.clearNativeFailure(candidate);
        }
        return buildSessionExportPayload(input, payload);
      } catch (error) {
        this.options.onNativeFailure?.(error, method);
        if (isGatewayMethodUnsupported(error)) {
          lastUnsupportedError = error;
          continue;
        }

        if (!shouldUseCliFallback(error, method, policy)) {
          throw this.cliFallbackDisabledError(method, error);
        }

        this.recordGatewayFallback(method, error);
        return this.fallback.exportSession(input, options);
      }
    }

    this.recordGatewayFallback(
      "sessions.get",
      lastUnsupportedError ?? new NativeGatewayError(
        "OpenClaw Gateway does not advertise a compatible session export method.",
        { kind: "unsupported" }
      )
    );
    return this.fallback.exportSession(input, options);
  }

  private async gatewayFirst<TPayload>(
    method: string,
    params: Record<string, unknown>,
    options: OpenClawCommandOptions,
    normalize: (payload: unknown) => TPayload,
    fallback: () => Promise<TPayload>,
    policy: OpenClawGatewayRequestPolicy = resolveGatewayRequestPolicy(method, options)
  ) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      if (policy.safety === "mutation") {
        this.assertVerifiedCliMutationFallback(method, params, options);
      }
      return fallback();
    }

    try {
      const payload = normalize(await this.callNative<unknown>(method, params, options, policy));
      clearGatewayFallbackDiagnostic(method);
      this.clearNativeFailure(method);
      return payload;
    } catch (error) {
      this.options.onNativeFailure?.(error, method);
      if (!shouldUseCliFallback(error, method, policy)) {
        throw this.cliFallbackDisabledError(method, error);
      }
      if (policy.safety === "mutation") {
        this.assertVerifiedCliMutationFallback(method, params, options);
      }
      this.recordGatewayFallback(method, error);
      return fallback();
    }
  }

  private async gatewayFirstCompatible<TPayload>(
    operationId: OpenClawGatewayCompatibilityOperationId,
    params: Record<string, unknown>,
    options: OpenClawCommandOptions,
    normalize: (payload: unknown) => TPayload,
    fallback: () => Promise<TPayload>
  ) {
    const operation = getOpenClawGatewayCompatibilityOperation(operationId);
    let methods = getOpenClawGatewayMethodCandidates(operationId);

    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      if (operation.fallbackAllowed === false) {
        throw new OpenClawGatewayClientError(
          `${operation.label} requires native OpenClaw Gateway support; CLI fallback is disabled for this operation.`,
          "unsupported"
        );
      }

      const fallbackMethod = methods[0] ?? operationId;
      if (resolveGatewayRequestPolicy(fallbackMethod, options).safety === "mutation") {
        this.assertVerifiedCliMutationFallback(fallbackMethod, params, options);
      }

      return fallback();
    }

    try {
      const hello = await this.probeNativeHandshake(options);
      const advertisedMethods = readAdvertisedGatewayMethods(hello);
      if (advertisedMethods.length > 0) {
        methods = [
          ...methods.filter((method) => advertisedMethods.includes(method)),
          ...methods.filter((method) => !advertisedMethods.includes(method))
        ];
      }
    } catch (error) {
      this.options.onNativeFailure?.(error, operationId);
      if (!shouldUseCliFallback(error, operationId, { safety: "read" })) {
        throw this.cliFallbackDisabledError(operationId, error);
      }
      this.recordGatewayFallback(operationId, error);
      return fallback();
    }

    let lastUnsupportedError: unknown = null;

    for (const method of methods) {
      const policy = resolveGatewayRequestPolicy(method, options);

      try {
        const payload = normalize(await this.callNative<unknown>(method, params, options, policy));
        for (const candidate of methods) {
          clearGatewayFallbackDiagnostic(candidate);
          this.clearNativeFailure(candidate);
        }
        return payload;
      } catch (error) {
        this.options.onNativeFailure?.(error, method);

        if (isGatewayMethodUnsupported(error)) {
          lastUnsupportedError = error;
          continue;
        }

        if (operation.fallbackAllowed === false) {
          throw this.cliFallbackDisabledError(method, error);
        }

        if (!shouldUseCliFallback(error, method, policy)) {
          throw this.cliFallbackDisabledError(method, error);
        }
        if (policy.safety === "mutation") {
          this.assertVerifiedCliMutationFallback(method, params, options);
        }

        this.recordGatewayFallback(method, error);
        return fallback();
      }
    }

    const fallbackOperation = methods[0] ?? operationId;
    if (operation.fallbackAllowed === false) {
      throw this.cliFallbackDisabledError(
        fallbackOperation,
        lastUnsupportedError ?? new NativeGatewayError(
          `OpenClaw Gateway does not advertise a compatible method for ${operationId}.`,
          { kind: "unsupported" }
        )
      );
    }

    if (resolveGatewayRequestPolicy(fallbackOperation, options).safety === "mutation") {
      this.assertVerifiedCliMutationFallback(fallbackOperation, params, options);
    }
    this.recordGatewayFallback(
      fallbackOperation,
      lastUnsupportedError ?? new NativeGatewayError(
        `OpenClaw Gateway does not advertise a compatible method for ${operationId}.`,
        { kind: "unsupported" }
      )
    );
    return fallback();
  }

  private async gatewayConfigMutationFirst(
    operation: string,
    path: string,
    value: unknown,
    options: OpenClawCommandOptions,
    mutate: (config: Record<string, unknown>) => void,
    fallback: () => Promise<CommandResult>
  ) {
    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      this.assertVerifiedCliMutationFallback(operation, { path }, options);
      return fallback();
    }

    if (containsRedactedOpenClawSecret(value)) {
      throw new OpenClawGatewayClientError(
        "Refusing to write a redacted OpenClaw secret back to config.",
        "auth"
      );
    }

    const shouldCloseConnection = isGatewayTransportConfigPath(path);

    try {
      const snapshot = parseGatewayPayload<Record<string, unknown>>(
        "config.get",
        configSnapshotPayloadSchema,
        await this.callNative<unknown>("config.get", {}, options, { safety: "read" })
      );
      const config = cloneJsonObject(isObjectRecord(snapshot.config) ? snapshot.config : {});
      const currentValue = readConfigPath(config, path);
      const mustPersistAgentRegistry = operation === "config.set" && path === "agents.list";

      if (
        !mustPersistAgentRegistry && (
          (operation === "config.unset" && currentValue === undefined) ||
          (operation === "config.set" && jsonValuesEqual(currentValue, value))
        )
      ) {
        const configMutation: OpenClawConfigMutationMetadata = {
          path,
          reloadKind: "none",
          restartRequired: false,
          hotReloaded: false,
          appliedVia: "noop",
          ...(typeof snapshot.hash === "string" && snapshot.hash.trim() ? { baseHash: snapshot.hash } : {})
        };

        return commandResultFromGatewayPayload(
          {
            ok: true,
            configMutation
          },
          {
            openClawConfig: configMutation
          }
        );
      }

      mutate(config);
      const schemaLookupPayload = await this.callNative<unknown>("config.schema.lookup", { path }, options, { safety: "read" })
        .catch(() => this.callNative<unknown>("config.schema", {}, options, { safety: "read" }))
        .catch(() => null);
      const reloadKind = readConfigReloadKindFromSchemaLookup(schemaLookupPayload);

      const baseHash = typeof snapshot.hash === "string" && snapshot.hash.trim() ? snapshot.hash : undefined;
      // config.patch uses JSON Merge Patch semantics. A missing object member
      // means "preserve", while setConfig(path, object) promises replacement
      // semantics. Emit null tombstones for removed members so invalid legacy
      // values such as a blank provider baseUrl are actually removed.
      const patchValue = operation === "config.unset"
        ? null
        : buildMergePatchReplacementValue(currentValue, value);
      const patch = buildMergePatchForConfigPath(path, patchValue);
      const patchParams: Record<string, unknown> = {
        raw: JSON.stringify(patch)
      };

      if (path === "agents.list") {
        patchParams.replacePaths = ["agents.list[].skills"];
      }
      if (options.replacePaths?.length) {
        patchParams.replacePaths = [...new Set([...(Array.isArray(patchParams.replacePaths) ? patchParams.replacePaths : []), ...options.replacePaths])];
      }

      if (baseHash) {
        patchParams.baseHash = baseHash;
      }
      let payload: unknown;
      let appliedVia: OpenClawConfigMutationMetadata["appliedVia"] = "config.patch";

      try {
        payload = await this.callNative<unknown>("config.patch", patchParams, options, { safety: "mutation" });
      } catch (patchError) {
        if (!isGatewayMethodUnsupported(patchError)) {
          throw patchError;
        }

        try {
          const applyParams: Record<string, unknown> = {
            raw: JSON.stringify(config)
          };

          if (baseHash) {
            applyParams.baseHash = baseHash;
          }

          payload = await this.callNative<unknown>("config.apply", applyParams, options, { safety: "mutation" });
          appliedVia = "config.apply";
        } catch (applyError) {
          if (!isGatewayMethodUnsupported(applyError)) {
            throw applyError;
          }

          if (containsRedactedOpenClawSecret(snapshot.config)) {
            throw new OpenClawGatewayClientError(
              "OpenClaw returned redacted secrets in the config snapshot; refusing full Gateway config overwrite.",
              "auth",
              { cause: applyError }
            );
          }

          const params: Record<string, unknown> = {
            raw: JSON.stringify(config)
          };

          if (baseHash) {
            params.baseHash = baseHash;
          }

          try {
            payload = await this.callNative<unknown>("config.set", params, options, { safety: "mutation" });
            appliedVia = "config.set";
          } catch (setError) {
            if (!isGatewayMethodUnsupported(setError)) {
              throw setError;
            }

            throw patchError;
          }
        }
      }
      clearGatewayFallbackDiagnostic(operation);
      this.clearNativeFailure(operation);
      const configMutation: OpenClawConfigMutationMetadata = {
        path,
        reloadKind,
        restartRequired: reloadKind === "restart",
        hotReloaded: reloadKind === "hot",
        appliedVia,
        ...(baseHash ? { baseHash } : {})
      };

      return commandResultFromGatewayPayload(
        isObjectRecord(payload)
          ? {
              ...payload,
              configMutation
            }
          : {
              ok: true,
              configMutation
            },
        {
          openClawConfig: configMutation
        }
      );
    } catch (error) {
      this.options.onNativeFailure?.(error, operation);
      const failedMethod = error instanceof NativeGatewayRequestError ? error.method : operation;
      const fallbackAllowed = shouldUseCliFallback(error, failedMethod, {
        safety: "mutation"
      }) || canFallbackGatewayAuthConfigRepair(error, path);

      if (!fallbackAllowed) {
        throw this.cliFallbackDisabledError(failedMethod, error);
      }
      if (!options.allowGatewayAuthRepairFallback) {
        this.assertVerifiedCliMutationFallback(failedMethod, { path }, options);
      }
      this.recordGatewayFallback(operation, error);
      return fallback();
    } finally {
      if (shouldCloseConnection) {
        this.close(`${operation}:${path}`);
      }
    }
  }

  private assertVerifiedCliMutationFallback(
    method: string,
    params: Record<string, unknown>,
    options: OpenClawCommandOptions
  ) {
    const currentIdentity = this.connection.getOperatorIdentity();
    if (isVerifiedNativeAuthorizationProof(options.authorizationProof, currentIdentity, method, params)) {
      return;
    }

    const requiredScopes = resolveRequiredScopes(method, params);
    throw new OpenClawGatewayClientError(
      `CLI fallback for OpenClaw mutation ${method} requires a current native Gateway authorization proof for ${requiredScopes.join(", ")}.`,
      "auth"
    );
  }
}

function hasFallbackAfterLastConnected(
  diagnostics: OpenClawGatewayClientDiagnostics["recentFallbackDiagnostics"],
  lastConnectedAt: string | null
) {
  if (diagnostics.length === 0) {
    return false;
  }

  if (!lastConnectedAt) {
    return true;
  }

  return diagnostics.some((entry) => isDiagnosticAtOrAfter(entry.at, lastConnectedAt));
}

function jsonValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isGatewayAgentNotFoundError(error: unknown, agentId: string) {
  const message = normalizeClientError(error).message.replace(/\s+/g, " ").trim();

  if (!message || !/\bagent\b/i.test(message) || !/\bnot found\b/i.test(message)) {
    return false;
  }

  const escapedAgentId = escapeRegExp(agentId);
  return new RegExp(`\\bagent\\s+["'\`]?${escapedAgentId}["'\`]?\\s+not\\s+found\\b`, "i").test(message);
}

function shouldWaitForNativeAgentTurn(input: OpenClawAgentTurnInput, payload: MissionCommandPayload) {
  if (!payload.runId) {
    return false;
  }

  if (typeof input.timeoutSeconds !== "number" || !Number.isFinite(input.timeoutSeconds) || input.timeoutSeconds <= 0) {
    return false;
  }

  const status = payload.status?.trim().toLowerCase();
  return !status || status === "started" || status === "running" || status === "queued";
}

function withChatAdmission(payload: MissionCommandPayload, sessionKey: string, idempotencyKey: string) {
  const admission = normalizeOpenClawChatAdmission(payload, { sessionKey, idempotencyKey });
  return {
    ...payload,
    sessionKey: payload.sessionKey ?? sessionKey,
    idempotencyKey: payload.idempotencyKey ?? idempotencyKey,
    meta: {
      ...payload.meta,
      openClawAdmission: admission
    }
  };
}

function buildNativeAgentWaitParams(
  input: OpenClawAgentTurnInput,
  runId: string,
  timeoutMs: number,
  options: { includeSession?: boolean } = {}
) {
  if (!options.includeSession) {
    return {
      runId,
      timeoutMs
    };
  }

  return {
    runId,
      sessionKey: input.sessionKey?.trim() || buildAgentSessionKey(input.agentId, input.sessionId),
    sessionId: input.sessionId ?? undefined,
    timeoutMs
  };
}

function resolveNativeAgentWaitRequestTimeoutMs(waitMs: number) {
  return Math.max(waitMs + 5_000, 5_000);
}

function shouldRetryNativeAgentWaitWithSessionParams(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /agent\.wait/i.test(message) && /must have required property ['"]?(sessionKey|sessionId|key)['"]?/i.test(message);
}

function gatewayAgentListIncludes(payload: OpenClawAgentListPayload, agentId: string) {
  const normalizedAgentId = agentId.trim();

  if (!normalizedAgentId) {
    return false;
  }

  return (
    payload.defaultId === normalizedAgentId ||
    payload.mainKey === normalizedAgentId ||
    payload.agents.some((entry) => entry.id === normalizedAgentId)
  );
}

function buildGatewayAgentRegistryError(agentId: string, cause: unknown) {
  return new OpenClawGatewayClientError(
    `OpenClaw Gateway has not loaded agent "${agentId}" yet. Restart the Gateway or refresh AgentOS after OpenClaw finishes loading agents, then retry chat.`,
    "conflict",
    { cause }
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isDiagnosticAtOrAfter(value: string | null, reference: string | null) {
  if (!value) {
    return false;
  }

  if (!reference) {
    return true;
  }

  const valueMs = Date.parse(value);
  const referenceMs = Date.parse(reference);

  if (!Number.isFinite(valueMs) || !Number.isFinite(referenceMs)) {
    return true;
  }

  return valueMs >= referenceMs;
}

function resolveGatewayMode(input: {
  forceCli: boolean;
  connectionState: OpenClawGatewayClientDiagnostics["connectionState"];
  fallbackTotal: number;
  lastNativeError: string | null;
}): OpenClawGatewayClientDiagnostics["gatewayMode"] {
  if (input.forceCli) {
    return "cli-forced";
  }

  if (input.connectionState === "error") {
    return "unreachable";
  }

  if (input.fallbackTotal > 0) {
    return "fallback-active";
  }

  if (input.connectionState === "closed" || input.lastNativeError) {
    return "degraded";
  }

  return "native-ws";
}

function isLegacyDeviceApprovalScopesParamError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);

  return /invalid\s+device\.pair\.approve\s+params/i.test(message) &&
    /unexpected property ['"]?scopes['"]?|unknown property ['"]?scopes['"]?|unrecognized .*scopes/i.test(message);
}

function resolveGatewayStatusLabel(mode: OpenClawGatewayClientDiagnostics["gatewayMode"]) {
  switch (mode) {
    case "native-ws":
      return "Native Gateway: OK";
    case "cli-forced":
      return "CLI fallback forced";
    case "fallback-active":
      return "CLI fallback used";
    case "unreachable":
      return "Native Gateway: Unreachable";
    case "degraded":
    default:
      return "Native Gateway: Degraded";
  }
}

function resolveGatewayStatusRecovery(
  mode: OpenClawGatewayClientDiagnostics["gatewayMode"],
  nativeFailureRecovery: string | null
) {
  if (mode === "native-ws") {
    return null;
  }

  if (nativeFailureRecovery) {
    return nativeFailureRecovery;
  }

  switch (mode) {
    case "cli-forced":
      return "Unset CLI-forced Gateway mode and restart AgentOS to use native WebSocket transport.";
    case "fallback-active":
      return "Inspect recent fallback diagnostics, update OpenClaw for protocol or method gaps, repair token/device access for auth failures, then restart the Gateway if needed.";
    case "unreachable":
      return "Start or restart the OpenClaw Gateway, verify the endpoint and token/password, then retry the native operation.";
    case "degraded":
    default:
      return "Inspect Gateway diagnostics, check token/device access, update OpenClaw for compatibility gaps, then restart the Gateway before retrying.";
  }
}

function hasUpdateAvailabilityDetails(payload: OpenClawUpdateStatusPayload) {
  return collectUpdateStatusRecords(payload).some((record) =>
    typeof record.updateAvailable === "boolean" ||
    typeof record.latestVersion === "string" ||
    typeof record.targetVersion === "string" ||
    typeof record.availableVersion === "string" ||
    typeof record.recommendedVersion === "string" ||
    typeof record.available === "boolean" ||
    typeof record.hasRegistryUpdate === "boolean"
  );
}

function mergeUpdateStatusPayloads(
  nativeStatus: OpenClawUpdateStatusPayload,
  fallbackStatus: OpenClawUpdateStatusPayload
): OpenClawUpdateStatusPayload {
  return {
    ...nativeStatus,
    ...fallbackStatus
  };
}

function collectUpdateStatusRecords(payload: OpenClawUpdateStatusPayload | undefined) {
  const records: Record<string, unknown>[] = [];

  function add(value: unknown) {
    if (!isObjectRecord(value) || records.includes(value)) {
      return;
    }

    records.push(value);
  }

  add(payload);
  add(payload?.update);
  add(payload?.availability);
  add(readRecord(payload?.update)?.registry);
  add(payload?.registry);
  add(payload?.result);
  add(readRecord(payload?.result)?.update);
  add(readRecord(readRecord(payload?.result)?.update)?.registry);
  add(readRecord(payload?.result)?.availability);
  add(payload?.sentinel);
  add(readRecord(payload?.sentinel)?.stats);

  return records;
}

function readRecord(value: unknown) {
  return isObjectRecord(value) ? value : undefined;
}

function normalizeOpenClawUserProfile(value: unknown): OpenClawUserProfile | null {
  const record = isObjectRecord(value) ? value : null;
  const profile = record && isObjectRecord(record.profile) ? record.profile : record;
  if (!profile) return null;
  const profileId = readNonEmptyString(profile.profileId ?? profile.id);
  if (!profileId) return null;
  return {
    profileId,
    displayName: typeof profile.displayName === "string" ? profile.displayName : null,
    avatar: typeof profile.avatar === "string" ? profile.avatar : null,
    email: typeof profile.email === "string" ? profile.email : null,
    role: typeof profile.role === "string" ? profile.role : null
  };
}
