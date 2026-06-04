import "server-only";

import {
  runOpenClaw,
  runOpenClawJson,
  runOpenClawJsonStream
} from "@/lib/openclaw/cli";
import { stringifyCommandFailure } from "@/lib/openclaw/command-failure";
import { containsRedactedOpenClawSecret } from "@/lib/openclaw/client/native-ws-gateway-utils";
import { OPENCLAW_GATEWAY_PROTOCOL_RANGE } from "@/lib/openclaw/client/native-ws-gateway-types";
import { OPENCLAW_SUPPORTED_BASELINE_VERSION } from "@/lib/openclaw/versions";
import type {
  AgentPayload,
  GatewayProbePayload,
  GatewayStatusPayload,
  MissionCommandPayload,
  ModelsPayload,
  ModelsStatusPayload,
  OpenClawAddAgentInput,
  OpenClawAgentIdentityInput,
  OpenClawAgentModelStatusInput,
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
  OpenClawGmailSetupInput,
  OpenClawHealthPayload,
  OpenClawListModelsInput,
  OpenClawListSessionsInput,
  OpenClawLogsTailInput,
  OpenClawLogsTailPayload,
  OpenClawModelScanPayload,
  OpenClawModelAuthOrderSetInput,
  OpenClawPluginListPayload,
  OpenClawRuntimeEventSubscriptionInput,
  OpenClawRuntimeSnapshotInput,
  OpenClawRuntimeSnapshotPayload,
  OpenClawSessionExportInput,
  OpenClawSessionExportPayload,
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

function buildAgentTurnArgs(input: OpenClawAgentTurnInput) {
  const args = [
    "agent",
    "--agent",
    input.agentId,
  ];

  if (input.sessionId) {
    args.push("--session-id", input.sessionId);
  }

  if (input.local) {
    args.push("--local");
  }

  args.push(
    "--message",
    input.message,
    "--thinking",
    input.thinking ?? "medium",
    "--timeout",
    String(input.timeoutSeconds ?? 45),
    "--json"
  );

  return args;
}

function buildAgentSessionKey(agentId?: string | null, sessionId?: string | null) {
  const trimmedSessionId = sessionId?.trim();
  const trimmedAgentId = agentId?.trim() || "main";
  return trimmedSessionId
    ? `agent:${trimmedAgentId}:explicit:${trimmedSessionId}`
    : `agent:${trimmedAgentId}:main`;
}

function buildSessionReferenceParams(input: { key?: string | null; sessionKey?: string | null; sessionId?: string | null; agentId?: string | null } = {}) {
  const key = input.key?.trim() || input.sessionKey?.trim();
  if (key) {
    return { key };
  }

  const sessionId = input.sessionId?.trim();
  const agentId = input.agentId?.trim();
  return {
    agentId: agentId || undefined,
    sessionId: sessionId || undefined,
    key: agentId || sessionId ? buildAgentSessionKey(agentId, sessionId) : undefined
  };
}

function buildSessionHistoryParams(input: OpenClawSessionHistoryInput = {}) {
  return {
    ...buildSessionReferenceParams(input),
    limit: input.limit,
    cursor: input.cursor ?? undefined
  };
}

function buildChatHistoryParams(input: OpenClawSessionHistoryInput = {}) {
  const reference = buildSessionReferenceParams(input);
  return {
    sessionKey: reference.key,
    limit: input.limit,
    cursor: input.cursor ?? undefined
  };
}

function buildSessionPreviewParams(input: OpenClawSessionHistoryInput = {}) {
  const reference = buildSessionReferenceParams(input);
  const key = reference.key;
  return {
    key,
    sessionKey: key,
    sessionKeys: key ? [key] : undefined,
    limit: input.limit,
    cursor: input.cursor ?? undefined
  };
}

function buildArtifactListParams(input: OpenClawArtifactListInput = {}) {
  const taskId = input.taskId?.trim();
  const runId = input.runId?.trim();
  const sessionKey = input.sessionKey?.trim() || input.sessionId?.trim();

  return {
    taskId: taskId || undefined,
    runId: runId || undefined,
    sessionKey: sessionKey || undefined
  };
}

function hasArtifactListScope(input: OpenClawArtifactListInput | OpenClawRuntimeSnapshotInput = {}) {
  return Boolean(input.taskId?.trim() || input.runId?.trim() || input.sessionKey?.trim() || input.sessionId?.trim());
}

function buildRuntimeSnapshotArtifactListInput(input: OpenClawRuntimeSnapshotInput): OpenClawArtifactListInput {
  return {
    taskId: input.taskId,
    runId: input.runId,
    sessionKey: input.sessionKey,
    sessionId: input.sessionId
  };
}

function buildSessionExportPayload(
  input: OpenClawSessionExportInput,
  payload: Record<string, unknown>
): OpenClawSessionExportPayload {
  if (typeof payload.content === "string") {
    return {
      ...payload,
      format: input.format ?? (typeof payload.format === "string" ? payload.format : "json")
    };
  }

  const format = input.format ?? "json";
  return {
    ...payload,
    format,
    session: payload.session ?? payload,
    content: format === "json" ? JSON.stringify(payload) : undefined
  };
}

function summarizeSnapshotError(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason || "Unknown OpenClaw Gateway snapshot error.");
}

function buildGmailSetupArgs(input: OpenClawGmailSetupInput) {
  const config = input.config ?? {};
  const args = ["webhooks", "gmail", "setup", "--account", input.account];
  const serveConfig = isObjectRecord(config.serve) ? config.serve : {};
  const tailscaleConfig = isObjectRecord(config.tailscale) ? config.tailscale : {};

  appendOptionalCliFlag(args, "--project", config.project);
  appendOptionalCliFlag(args, "--topic", config.topic);
  appendOptionalCliFlag(args, "--subscription", config.subscription);
  appendOptionalCliFlag(args, "--label", config.label);
  appendOptionalCliFlag(args, "--hook-url", config.hookUrl);
  appendOptionalCliFlag(args, "--hook-token", config.hookToken);
  appendOptionalCliFlag(args, "--push-token", config.pushToken);
  appendOptionalCliFlag(args, "--bind", serveConfig.bind);
  appendOptionalCliFlag(args, "--port", serveConfig.port);
  appendOptionalCliFlag(args, "--path", serveConfig.path);
  appendBooleanCliFlag(args, "--include-body", config.includeBody);
  appendOptionalCliFlag(args, "--max-bytes", config.maxBytes);
  appendOptionalCliFlag(args, "--renew-minutes", config.renewEveryMinutes);
  appendOptionalCliFlag(args, "--tailscale", tailscaleConfig.mode);
  appendOptionalCliFlag(args, "--tailscale-path", tailscaleConfig.path);
  appendOptionalCliFlag(args, "--tailscale-target", tailscaleConfig.target);
  appendOptionalCliFlag(args, "--push-endpoint", config.pushEndpoint);

  return args;
}

function buildAgentIdentityArgs(input: OpenClawAgentIdentityInput) {
  const args = [
    "agents",
    "set-identity",
    "--agent",
    input.agentId,
    "--workspace",
    input.workspace,
    "--identity-file",
    input.identityFile,
    "--json"
  ];

  appendOptionalCliFlag(args, "--name", input.name);
  appendOptionalCliFlag(args, "--emoji", input.emoji);
  appendOptionalCliFlag(args, "--theme", input.theme);
  appendOptionalCliFlag(args, "--avatar", input.avatar);

  return args;
}

function buildAutomationProvisionArgs(input: OpenClawAutomationProvisionInput) {
  const args = [
    "cron",
    "add",
    "--name",
    input.name,
    "--description",
    input.description || input.name,
    "--agent",
    input.agentId,
    "--message",
    input.message,
    "--thinking",
    input.thinking || "medium",
    "--timeout-seconds",
    String(input.timeoutSeconds ?? 120),
    "--json"
  ];

  if (input.schedule.kind === "every") {
    args.push("--every", input.schedule.value);
  } else {
    args.push("--cron", input.schedule.value);
  }

  if (input.announce?.channel) {
    args.push("--announce", "--channel", input.announce.channel);
    appendOptionalCliFlag(args, "--to", input.announce.target);
  }

  return args;
}

function appendOptionalCliFlag(args: string[], flag: string, value: unknown) {
  const normalized = normalizeCliFlagValue(value);
  if (normalized === null) {
    return;
  }

  args.push(flag, normalized);
}

function appendBooleanCliFlag(args: string[], flag: string, value: unknown) {
  if (value === true || value === "true") {
    args.push(flag);
  }
}

function normalizeCliFlagValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export class CliOpenClawGatewayClient implements OpenClawGatewayClient {
  getDiagnostics(): OpenClawGatewayClientDiagnostics {
    return {
      mode: "cli",
      gatewayMode: "cli-forced",
      statusLabel: "CLI fallback forced",
      recovery: "Unset the CLI-forced Gateway mode and restart AgentOS to use the native OpenClaw Gateway.",
      connectionState: "cli-forced",
      protocolVersion: null,
      protocolRange: OPENCLAW_GATEWAY_PROTOCOL_RANGE,
      fallbackCounts: {},
      fallbackTotal: 0,
      recentFallbackDiagnostics: [],
      lastNativeError: null,
      lastNativeFailureAt: null,
      lastConnectedAt: null,
      lastDisconnectedAt: null
    };
  }

  getHealth(options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawHealthPayload>("health", {}, options);
  }

  getStatus(options: OpenClawCommandOptions = {}) {
    return runOpenClawJson<StatusPayload>(["status", "--json"], options);
  }

  getUpdateStatus(options: OpenClawCommandOptions = {}) {
    return runOpenClawJson<OpenClawUpdateStatusPayload>(["update", "status", "--json"], options);
  }

  getGatewayStatus(options: OpenClawCommandOptions = {}) {
    return runOpenClawJson<GatewayStatusPayload>(["gateway", "status", "--json"], options);
  }

  getModelStatus(options: OpenClawCommandOptions = {}) {
    return runOpenClawJson<ModelsStatusPayload>(["models", "status", "--json"], options);
  }

  getAgentModelStatus(input: OpenClawAgentModelStatusInput, options: OpenClawCommandOptions = {}) {
    return runOpenClawJson<ModelsStatusPayload>(
      ["models", "status", "--agent", input.agentId, "--json"],
      options
    );
  }

  setModelAuthOrder(input: OpenClawModelAuthOrderSetInput, options: OpenClawCommandOptions = {}) {
    return runOpenClaw(
      [
        "models",
        "auth",
        "order",
        "set",
        "--provider",
        input.provider,
        "--agent",
        input.agentId,
        ...input.profileIds
      ],
      options
    );
  }

  async listAgents(options: OpenClawCommandOptions = {}) {
    const agents = await runOpenClawJson<AgentPayload>(["agents", "list", "--json"], options);

    return {
      agents: agents.map((agent) => ({
        id: agent.id,
        name: agent.name,
        identity: {
          name: agent.identityName,
          emoji: agent.identityEmoji
        },
        workspace: agent.workspace,
        model: agent.model ? { primary: agent.model } : undefined
      }))
    } satisfies OpenClawAgentListPayload;
  }

  listSessions(input: OpenClawListSessionsInput = {}, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawSessionsPayload>("sessions.list", { ...input }, options);
  }

  describeSession(input: OpenClawDescribeSessionInput = {}, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawSessionPayload>(
      "sessions.describe",
      {
        ...buildSessionReferenceParams(input),
        includeMessages: input.includeMessages,
        limit: input.limit
      },
      options
    );
  }

  async getSessionHistory(input: OpenClawSessionHistoryInput = {}, options: OpenClawCommandOptions = {}) {
    let lastError: unknown = null;
    const candidates = [
      ["chat.history", buildChatHistoryParams(input)] as const,
      ["sessions.preview", buildSessionPreviewParams(input)] as const,
      ["sessions.history", buildSessionHistoryParams(input)] as const
    ];

    for (const [method, params] of candidates) {
      try {
        return await this.call<OpenClawSessionHistoryPayload>(method, params, options);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }

  async exportSession(input: OpenClawSessionExportInput = {}, options: OpenClawCommandOptions = {}) {
    let lastError: unknown = null;
    const params = buildSessionReferenceParams(input);
    const candidates = ["sessions.get", "sessions.describe", "sessions.export"];

    for (const method of candidates) {
      try {
        const payload = await this.call<Record<string, unknown>>(
          method,
          method === "sessions.export" ? { ...params, format: input.format } : params,
          options
        );
        return buildSessionExportPayload(input, payload);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError;
  }

  listTasks(input: OpenClawTaskListInput = {}, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawTaskListPayload>("tasks.list", { ...input }, options);
  }

  getTask(input: OpenClawTaskGetInput, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawTaskPayload>("tasks.get", { ...input }, options);
  }

  assignTask(input: OpenClawTaskAssignInput, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawTaskPayload>("tasks.assign", { ...input, reason: input.reason ?? undefined }, options);
  }

  cancelTask(input: OpenClawTaskCancelInput, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawTaskPayload>("tasks.cancel", { taskId: input.taskId, reason: input.reason ?? undefined }, options);
  }

  listArtifacts(input: OpenClawArtifactListInput = {}, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawArtifactListPayload>("artifacts.list", buildArtifactListParams(input), options);
  }

  getArtifact(input: OpenClawArtifactGetInput, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawArtifactPayload>("artifacts.get", { ...input }, options);
  }

  async putArtifact(
    input: OpenClawArtifactPutInput,
    options: OpenClawCommandOptions = {}
  ): Promise<OpenClawArtifactPayload> {
    void input;
    void options;
    throw new Error(`Artifact writes are not part of the OpenClaw ${OPENCLAW_SUPPORTED_BASELINE_VERSION} Gateway baseline; native Gateway support must be explicitly advertised before AgentOS can use artifacts.put.`);
  }

  async deleteArtifact(
    input: OpenClawArtifactDeleteInput,
    options: OpenClawCommandOptions = {}
  ): Promise<OpenClawArtifactPayload> {
    void input;
    void options;
    throw new Error(`Artifact deletion is not part of the OpenClaw ${OPENCLAW_SUPPORTED_BASELINE_VERSION} Gateway baseline; native Gateway support must be explicitly advertised before AgentOS can use artifacts.delete.`);
  }

  async getRuntimeSnapshot(input: OpenClawRuntimeSnapshotInput = {}, options: OpenClawCommandOptions = {}) {
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
    return this.call<OpenClawToolsCatalogPayload>("tools.catalog", { ...input }, options);
  }

  getEffectiveTools(input: OpenClawToolsEffectiveInput = {}, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawToolsEffectivePayload>("tools.effective", { ...input }, options);
  }

  invokeTool(input: OpenClawToolInvokeInput, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawToolInvokePayload>("tools.invoke", { ...input }, options);
  }

  async subscribeRuntimeEvents(
    input: OpenClawRuntimeEventSubscriptionInput,
    callbacks: OpenClawGatewayEventCallbacks,
    options: OpenClawCommandOptions = {}
  ): Promise<OpenClawGatewayEventSubscription> {
    void input;
    void callbacks;
    void options;
    throw new Error("OpenClaw runtime event subscriptions require the native Gateway transport.");
  }

  getChannelStatus(input: OpenClawChannelStatusInput = {}, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawChannelStatusPayload>("channels.status", { ...input }, options);
  }

  getChannelLogs(input: OpenClawChannelLogsInput, options: OpenClawCommandOptions = {}) {
    const args = [
      "channels",
      "logs",
      "--channel",
      input.channel,
      "--json"
    ];

    if (typeof input.lines === "number" && Number.isFinite(input.lines) && input.lines > 0) {
      args.push("--lines", String(input.lines));
    }

    return runOpenClawJson<OpenClawChannelLogsPayload>(args, options);
  }

  provisionChannelAccount(input: OpenClawChannelAccountProvisionInput, options: OpenClawCommandOptions = {}) {
    const args = [
      "channels",
      "add",
      "--channel",
      input.channel
    ];

    appendOptionalCliFlag(args, "--account", input.account);
    appendOptionalCliFlag(args, "--token", input.token);
    appendOptionalCliFlag(args, "--bot-token", input.botToken);
    appendOptionalCliFlag(args, "--webhook-url", input.webhookUrl);
    appendOptionalCliFlag(args, "--name", input.name);

    return runOpenClaw(args, options);
  }

  removeChannelAccount(input: OpenClawChannelAccountRemoveInput, options: OpenClawCommandOptions = {}) {
    const args = [
      "channels",
      "remove",
      "--channel",
      input.channel,
      "--account",
      input.account
    ];

    if (input.delete) {
      args.push("--delete");
    }

    return runOpenClaw(args, options);
  }

  setupGmailWebhook(input: OpenClawGmailSetupInput, options: OpenClawCommandOptions = {}) {
    return runOpenClaw(buildGmailSetupArgs(input), options);
  }

  listSkills(options: OpenClawCommandOptions & { eligible?: boolean } = {}) {
    const args = ["skills", "list"];
    if (options.eligible) {
      args.push("--eligible");
    }
    args.push("--json");
    return runOpenClawJson<OpenClawSkillListPayload>(args, options);
  }

  listPlugins(options: OpenClawCommandOptions = {}) {
    return runOpenClawJson<OpenClawPluginListPayload>(["plugins", "list", "--json"], options);
  }

  listModels(input: OpenClawListModelsInput = {}, options: OpenClawCommandOptions = {}) {
    const args = ["models", "list"];
    if (input.all) {
      args.push("--all");
    }
    args.push("--json");
    if (input.provider) {
      args.push("--provider", input.provider);
    }
    return runOpenClawJson<ModelsPayload>(args, options);
  }

  scanModels(options: OpenClawCommandOptions & { yes?: boolean; noInput?: boolean; noProbe?: boolean } = {}) {
    const args = ["models", "scan", "--json"];
    if (options.yes) {
      args.push("--yes");
    }
    if (options.noInput) {
      args.push("--no-input");
    }
    if (options.noProbe) {
      args.push("--no-probe");
    }
    return runOpenClawJson<OpenClawModelScanPayload>(args, options);
  }

  probeGateway(options: OpenClawCommandOptions = {}) {
    return runOpenClawJson<GatewayProbePayload>(["gateway", "probe", "--json"], options);
  }

  controlGateway(
    action: "start" | "stop" | "restart",
    options: OpenClawCommandOptions & { force?: boolean } = {}
  ) {
    const args = ["gateway", action];

    if (action === "restart" && options.force) {
      args.push("--force");
    }

    args.push("--json");

    return runOpenClawJson<Record<string, unknown>>(args, options);
  }

  async approveDeviceAccess(
    input: OpenClawDeviceApproveInput = {},
    options: OpenClawCommandOptions = {}
  ): Promise<OpenClawDeviceApprovePayload> {
    if (input.latest !== false && !input.requestId) {
      const list = await runOpenClawJson<Record<string, unknown>>(["devices", "list", "--json"], options);
      const requestId = resolveLatestPendingDeviceRequestId(list);

      if (!requestId) {
        throw new Error("No pending OpenClaw device access request found.");
      }

      return this.approveDeviceAccess({
        ...input,
        latest: false,
        requestId
      }, options);
    }

    const args = ["devices", "approve"];

    if (input.requestId) {
      args.push(input.requestId);
    }
    for (const scope of input.scopes ?? []) {
      appendOptionalCliFlag(args, "--scope", scope);
    }
    args.push("--json");

    return runOpenClawJson<OpenClawDeviceApprovePayload>(args, options);
  }

  call<TPayload>(
    method: string,
    params: Record<string, unknown> = {},
    options: OpenClawCommandOptions = {}
  ) {
    return runOpenClawJson<TPayload>(
      ["gateway", "call", method, "--params", JSON.stringify(params), "--json"],
      options
    );
  }

  async getConfig<TPayload>(path: string, options: OpenClawCommandOptions = {}) {
    return runOpenClawJson<TPayload>(["config", "get", path, "--json"], options).catch(() => null);
  }

  async getConfigSchema(options: OpenClawCommandOptions = {}) {
    return this.call<Record<string, unknown>>("config.schema", {}, options).catch(() => null);
  }

  async lookupConfigSchema(input: OpenClawConfigSchemaLookupInput, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawConfigSchemaLookupPayload>("config.schema.lookup", { path: input.path }, options)
      .catch(() => null);
  }

  async hasConfig(path: string, options: OpenClawCommandOptions = {}) {
    try {
      await runOpenClaw(["config", "get", path, "--json"], options);
      return true;
    } catch (error) {
      const detail = stringifyCommandFailure(error);

      if (detail.includes("Config path not found")) {
        return false;
      }

      throw error;
    }
  }

  setConfig(
    path: string,
    value: unknown,
    options: OpenClawCommandOptions & { strictJson?: boolean } = {}
  ) {
    if (containsRedactedOpenClawSecret(value)) {
      throw new Error("Refusing to write a redacted OpenClaw secret back to config.");
    }

    const args = ["config", "set", path, typeof value === "string" ? value : JSON.stringify(value)];

    if (options.strictJson) {
      args.push("--strict-json");
    }

    return runOpenClaw(args, options);
  }

  unsetConfig(path: string, options: OpenClawCommandOptions = {}) {
    return runOpenClaw(["config", "unset", path], options);
  }

  addAgent(input: OpenClawAddAgentInput, options: OpenClawCommandOptions = {}) {
    const args = [
      "agents",
      "add",
      input.id,
      "--workspace",
      input.workspace,
      "--agent-dir",
      input.agentDir,
      "--non-interactive",
      "--json"
    ];

    if (input.model) {
      args.push("--model", input.model);
    }

    return runOpenClaw(args, options);
  }

  async updateAgent(input: OpenClawUpdateAgentInput, options: OpenClawCommandOptions = {}) {
    void input;
    void options;
    return { stdout: JSON.stringify({ ok: true, fallback: "application-config" }), stderr: "" };
  }

  setAgentIdentity(input: OpenClawAgentIdentityInput, options: OpenClawCommandOptions = {}) {
    return runOpenClaw(buildAgentIdentityArgs(input), options);
  }

  deleteAgent(agentId: string, options: OpenClawCommandOptions = {}) {
    return runOpenClaw(["agents", "delete", agentId, "--force", "--json"], options);
  }

  provisionAutomation(input: OpenClawAutomationProvisionInput, options: OpenClawCommandOptions = {}) {
    return runOpenClaw(buildAutomationProvisionArgs(input), options);
  }

  runAgentTurn(
    input: OpenClawAgentTurnInput,
    options: OpenClawCommandOptions = {}
  ) {
    return runOpenClawJson<MissionCommandPayload>(buildAgentTurnArgs(input), options);
  }

  abortAgentTurn(input: { runId?: string | null; sessionId?: string | null; agentId?: string | null; reason?: string | null }, options: OpenClawCommandOptions = {}) {
    return this.call<MissionCommandPayload>("chat.abort", {
      runId: input.runId ?? undefined,
      sessionId: input.sessionId ?? undefined,
      agentId: input.agentId ?? undefined,
      reason: input.reason ?? undefined
    }, options);
  }

  async steerSession(
    input: OpenClawSessionSteerInput,
    options: OpenClawCommandOptions = {}
  ): Promise<OpenClawSessionControlPayload> {
    void input;
    void options;
    throw new Error("Native OpenClaw Gateway is required for sessions.steer.");
  }

  async injectChat(
    input: OpenClawChatInjectInput,
    options: OpenClawCommandOptions = {}
  ): Promise<OpenClawSessionControlPayload> {
    void input;
    void options;
    throw new Error("Native OpenClaw Gateway is required for chat.inject.");
  }

  streamAgentTurn(
    input: OpenClawAgentTurnInput,
    callbacks: OpenClawStreamCallbacks = {},
    options: OpenClawCommandOptions = {}
  ) {
    return runOpenClawJsonStream<MissionCommandPayload>(buildAgentTurnArgs(input), {
      ...options,
      ...callbacks
    });
  }

  tailLogs(input: OpenClawLogsTailInput = {}, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawLogsTailPayload>("logs.tail", { ...input }, options);
  }

  listExecApprovals(input: OpenClawExecApprovalListInput = {}, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawExecApprovalListPayload>("exec.approval.list", { ...input }, options);
  }

  resolveExecApproval(input: OpenClawExecApprovalResolveInput, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawExecApprovalResolvePayload>("exec.approval.resolve", {
      approvalId: input.approvalId,
      decision: input.decision,
      reason: input.reason ?? undefined
    }, options);
  }

  getCronStatus(options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawCronStatusPayload>("cron.status", {}, options);
  }

  listCronJobs(input: OpenClawCronListInput = {}, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawCronListPayload>("cron.list", { ...input }, options);
  }
}

function resolveLatestPendingDeviceRequestId(payload: Record<string, unknown>) {
  const pending = Array.isArray(payload.pending) ? payload.pending : [];
  let selected: { requestId: string; ts: number } | null = null;

  for (const entry of pending) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const requestId = typeof record.requestId === "string" && record.requestId.trim()
      ? record.requestId.trim()
      : null;

    if (!requestId) {
      continue;
    }

    const ts = typeof record.ts === "number" && Number.isFinite(record.ts) ? record.ts : 0;

    if (!selected || ts > selected.ts) {
      selected = { requestId, ts };
    }
  }

  return selected?.requestId ?? null;
}
