import "server-only";

import { CliOpenClawGatewayClient } from "@/lib/openclaw/client/cli-gateway-client";
import {
  getOpenClawGatewayCompatibilityOperation,
  getOpenClawGatewayMethodCandidates,
  type OpenClawGatewayCompatibilityOperationId
} from "@/lib/openclaw/client/gateway-compatibility";
import {
  canFallbackGatewayAuthConfigRepair,
  buildMergePatchForConfigPath,
  isGatewayTransportConfigPath,
  readConfigReloadKindFromSchemaLookup
} from "@/lib/openclaw/client/native-ws-gateway-config";
import { PersistentOpenClawGatewayConnection } from "@/lib/openclaw/client/native-ws-gateway-connection";
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
  buildNativeSessionPatchParams,
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
  resolveLatestPendingDeviceRequestId
} from "@/lib/openclaw/client/native-ws-gateway-protocol";
import {
  isCliGatewayClientForcedByEnv,
  resolveGatewayRequestPolicy,
  resolveNativeTimeoutMs,
  shouldUseCliFallback
} from "@/lib/openclaw/client/native-ws-gateway-policy";
import { isKnownOpenAiCodexModelId } from "@/lib/openclaw/domains/model-provider-connection";
import {
  CONNECT_METHOD,
  OPENCLAW_GATEWAY_PROTOCOL_RANGE,
  type NativeWsOpenClawGatewayClientOptions,
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
import type { CommandResult } from "@/lib/openclaw/cli";
import type {
  GatewayStatusPayload,
  MissionCommandPayload,
  OpenClawAddAgentInput,
  OpenClawAgentIdentityInput,
  OpenClawAgentModelStatusInput,
  OpenClawAbortTurnInput,
  OpenClawArtifactDeleteInput,
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
  OpenClawCronStatusPayload,
  OpenClawDescribeSessionInput,
  OpenClawDeviceApproveInput,
  OpenClawDeviceApprovePayload,
  OpenClawExecApprovalListInput,
  OpenClawExecApprovalListPayload,
  OpenClawExecApprovalResolveInput,
  OpenClawExecApprovalResolvePayload,
  OpenClawGatewayClient,
  OpenClawGatewayClientDiagnostics,
  OpenClawGatewayEventCallbacks,
  OpenClawGatewayEventSubscription,
  OpenClawGatewayRequestPolicy,
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
  StatusPayload
} from "@/lib/openclaw/client/types";

export {
  isCliGatewayClientForcedByEnv,
  OPENCLAW_GATEWAY_PROTOCOL_RANGE,
  OpenClawGatewayClientError
};
export type {
  NativeWsOpenClawGatewayClientOptions,
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
  const hasOpenAiCodexRoute = allowed.some((modelId) => isKnownOpenAiCodexModelId(modelId));

  if (!hasOpenAiCodexRoute) {
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
  const hasOpenAiCodexAuthRoute = (status.auth?.runtimeAuthRoutes ?? []).some((entry) => {
    const provider = entry.provider?.trim().toLowerCase();
    const runtime = entry.runtime?.trim().toLowerCase();
    const authProvider = entry.authProvider?.trim().toLowerCase();
    const routeProvider = provider === "openai" || provider === "codex" || provider === "openai-codex";
    const codexRuntime = runtime === "codex" || runtime === "openai-codex" || runtime === "app-server" || runtime === "codex-app-server";
    const openAiAuth = !authProvider || authProvider === "openai" || authProvider === "codex" || authProvider === "openai-codex";

    return routeProvider && codexRuntime && openAiAuth;
  });

  if (hasOpenAiCodexAuthRoute) {
    return false;
  }

  return !authProviders.has("openai") &&
    !authProviders.has("codex") &&
    !authProviders.has("openai-codex") &&
    !oauthProviders.has("openai") &&
    !oauthProviders.has("codex") &&
    !oauthProviders.has("openai-codex");
}

export class NativeWsOpenClawGatewayClient implements OpenClawGatewayClient {
  private readonly fallback: OpenClawGatewayClient;
  private readonly connection: PersistentOpenClawGatewayConnection;
  private readonly fallbackCounts: Record<string, number> = {};
  private lastNativeFailure: {
    at: string;
    operation: string;
    issue: string;
    kind: string;
    recovery: string;
  } | null = null;

  constructor(private readonly options: NativeWsOpenClawGatewayClientOptions = {}) {
    this.fallback = options.fallback ?? new CliOpenClawGatewayClient();
    this.connection = new PersistentOpenClawGatewayConnection(this.fallback, options);
  }

  close(reason = "closed") {
    this.connection.close(reason);
  }

  getDiagnostics(): OpenClawGatewayClientDiagnostics {
    const connection = this.connection.getDiagnostics();
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
      recentFallbackDiagnostics,
      lastNativeError: lastNativeError || null,
      lastNativeFailureAt: this.lastNativeFailure?.at ?? null,
      lastConnectedAt: connection.lastConnectedAt,
      lastDisconnectedAt: connection.lastDisconnectedAt
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
    return new OpenClawGatewayClientError(
      `${normalized.message} Gateway-native operation failed; CLI fallback disabled for this operation. Recovery: ${resolveGatewayRecoveryMessage(normalized)}`,
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

  describeSession(input: OpenClawDescribeSessionInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawSessionPayload>(
      "sessions.describe",
      {
        ...buildSessionReferenceParams(input),
        includeMessages: input.includeMessages,
        limit: input.limit
      },
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
    return this.gatewayFirst<OpenClawTaskListPayload>(
      "tasks.list",
      { ...input },
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
    return this.gatewayFirstCompatible<OpenClawTaskPayload>(
      "taskAssign",
      {
        ...input,
        reason: input.reason ?? undefined
      },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawTaskPayload>("tasks.assign", payload),
      () => this.fallback.assignTask(input, options)
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
    return this.gatewayFirst<OpenClawToolsCatalogPayload>(
      "tools.catalog",
      { ...input },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawToolsCatalogPayload>("tools.catalog", payload),
      () => this.fallback.getToolsCatalog(input, options)
    );
  }

  getEffectiveTools(input: OpenClawToolsEffectiveInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawToolsEffectivePayload>(
      "tools.effective",
      { ...input },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawToolsEffectivePayload>("tools.effective", payload),
      () => this.fallback.getEffectiveTools(input, options)
    );
  }

  invokeTool(input: OpenClawToolInvokeInput, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst<OpenClawToolInvokePayload>(
      "tools.invoke",
      { ...input },
      options,
      (payload) => parseObjectGatewayPayload<OpenClawToolInvokePayload>("tools.invoke", payload),
      () => this.fallback.invokeTool(input, options)
    );
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

  listModels(input: OpenClawListModelsInput = {}, options: OpenClawCommandOptions = {}) {
    return this.gatewayFirst(
      "models.list",
      { view: input.all ? "all" : "configured" },
      options,
      (payload) => {
        const normalized = normalizeModelsPayload(payload);
        return input.provider
          ? { ...normalized, models: normalized.models.filter((model) => model.key.split("/", 1)[0] === input.provider) }
          : normalized;
      },
      () => this.fallback.listModels(input, options)
    );
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
    this.close(`gateway.${action}`);
    return this.fallback.controlGateway(action, options).finally(() => {
      this.close(`gateway.${action}.completed`);
    });
  }

  approveDeviceAccess(
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

    return this.gatewayFirstCompatible(
      "deviceApproval",
      {
        requestId: input.requestId ?? undefined,
        scopes: input.scopes
      },
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
    // OpenClaw Gateway agents.create currently rejects agentDir and derives state
    // under the default agent store. AgentOS needs the explicit workspace-local
    // agentDir, so creation must use the official CLI path until Gateway exposes it.
    if (input.agentDir?.trim()) {
      return this.fallback.addAgent(input, options);
    }

    const params: Record<string, unknown> = {
      name: input.name?.trim() || input.id,
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
      if (!shouldUseCliFallback(error, method, { safety: "mutation" })) {
        throw this.cliFallbackDisabledError(method, error);
      }
      this.recordGatewayFallback("chat.send", error);
      return this.fallback.runAgentTurn(input, options);
    }
  }

  abortAgentTurn(input: OpenClawAbortTurnInput, options: OpenClawCommandOptions = {}) {
    const sessionKey = input.sessionId || input.agentId ? buildAgentSessionKey(input.agentId, input.sessionId) : undefined;

    return this.gatewayFirst(
      "sessions.abort",
      {
        key: sessionKey,
        runId: input.runId ?? undefined
      },
      options,
      (payload) => payload as MissionCommandPayload,
      () => this.gatewayFirst(
        "chat.abort",
        {
          sessionKey,
          runId: input.runId ?? undefined
        },
        options,
        (payload) => payload as MissionCommandPayload,
        () => this.fallback.abortAgentTurn?.(input, options) ??
          this.fallback.call<MissionCommandPayload>("sessions.abort", { key: sessionKey, runId: input.runId ?? undefined }, options)
      )
    );
  }

  async steerSession(input: OpenClawSessionSteerInput, options: OpenClawCommandOptions = {}) {
    if (this.options.forceCli || options.forceCli || isCliGatewayClientForcedByEnv()) {
      throw new OpenClawGatewayClientError("Native OpenClaw Gateway is required for sessions.steer.", "unsupported");
    }

    try {
      const payload = await this.callNative<unknown>(
        "sessions.steer",
        buildSessionSteerParams(input),
        options,
        {
          safety: "mutation",
          timeoutMs: options.timeoutMs,
          allowCliFallback: false,
          allowMutationFallbackOnUnsupported: false
        }
      );
      this.clearNativeFailure("sessions.steer");
      return parseObjectGatewayPayload<OpenClawSessionControlPayload>("sessions.steer", payload);
    } catch (error) {
      this.options.onNativeFailure?.(error, "sessions.steer");
      throw this.cliFallbackDisabledError("sessions.steer", error);
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
      return this.fallback.streamAgentTurn(input, callbacks, options);
    }

    const sessionKey = buildAgentSessionKey(input.agentId, input.sessionId);
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
      this.recordGatewayFallback("streamAgentTurn", error);
      return this.fallback.streamAgentTurn(input, callbacks, options);
    } finally {
      subscription?.close();
      resolveFinal(null);
    }
  }

  private async runAgentTurnNative(input: OpenClawAgentTurnInput, options: OpenClawCommandOptions = {}) {
    const sessionKey = buildAgentSessionKey(input.agentId, input.sessionId);
    const timeoutMs = typeof input.timeoutSeconds === "number" && Number.isFinite(input.timeoutSeconds)
      ? Math.max(0, Math.floor(input.timeoutSeconds * 1000))
      : undefined;
    const idempotencyKey = input.idempotencyKey?.trim() || input.dispatchId || createRequestId();
    await this.prepareNativeSession(input, sessionKey, options);
    const chatParams = {
      sessionKey,
      sessionId: input.sessionId,
      message: input.message,
      thinking: input.thinking,
      timeoutMs,
      idempotencyKey
    };

    try {
      return await this.callNative<MissionCommandPayload>("chat.send", chatParams, options);
    } catch (error) {
      if (!isGatewayMethodUnsupported(error)) {
        if (isGatewayAgentNotFoundError(error, input.agentId)) {
          const registryState = await this.checkGatewayAgentRegistry(input.agentId, options);

          if (registryState === "present") {
            try {
              await this.prepareNativeSession(input, sessionKey, options);
              return await this.callNative<MissionCommandPayload>("chat.send", chatParams, options);
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
    );
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
      return;
    }

    try {
      await this.callNative<unknown>(
        "sessions.create",
        buildNativeSessionCreateParams(input, sessionKey),
        options,
        { safety: "mutation" }
      );
      clearGatewayFallbackDiagnostic("sessions.create");
    } catch (error) {
      if (!shouldIgnoreNativeSessionPreparationError(error)) {
        throw error;
      }
    }

    try {
      await this.callNative<unknown>(
        "sessions.patch",
        buildNativeSessionPatchParams(input, sessionKey),
        options,
        { safety: "mutation" }
      );
      clearGatewayFallbackDiagnostic("sessions.patch");
    } catch (error) {
      if (!shouldIgnoreNativeSessionPreparationError(error)) {
        throw error;
      }
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
    return this.connection.request<TPayload>(method, params, options, timeoutMs);
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
    return this.connection.subscribe(params, callbacks, options, timeoutMs);
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

    if (this.options.forceCli || isCliGatewayClientForcedByEnv()) {
      if (operation.fallbackAllowed === false) {
        throw new OpenClawGatewayClientError(
          `${operation.label} requires native OpenClaw Gateway support; CLI fallback is disabled for this operation.`,
          "unsupported"
        );
      }

      return fallback();
    }

    const methods = getOpenClawGatewayMethodCandidates(operationId);
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
      mutate(config);
      const schemaLookupPayload = await this.callNative<unknown>("config.schema.lookup", { path }, options, { safety: "read" })
        .catch(() => this.callNative<unknown>("config.schema", {}, options, { safety: "read" }))
        .catch(() => null);
      const reloadKind = readConfigReloadKindFromSchemaLookup(schemaLookupPayload);

      const baseHash = typeof snapshot.hash === "string" && snapshot.hash.trim() ? snapshot.hash : undefined;
      const patch = buildMergePatchForConfigPath(path, operation === "config.unset" ? null : value);
      const patchParams: Record<string, unknown> = {
        raw: JSON.stringify(patch)
      };

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
      this.recordGatewayFallback(operation, error);
      return fallback();
    } finally {
      if (shouldCloseConnection) {
        this.close(`${operation}:${path}`);
      }
    }
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
    sessionKey: buildAgentSessionKey(input.agentId, input.sessionId),
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
