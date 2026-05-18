import "server-only";

import {
  runOpenClaw,
  runOpenClawJson,
  runOpenClawJsonStream
} from "@/lib/openclaw/cli";
import { stringifyCommandFailure } from "@/lib/openclaw/command-failure";
import type {
  AgentPayload,
  GatewayProbePayload,
  GatewayStatusPayload,
  MissionCommandPayload,
  ModelsPayload,
  ModelsStatusPayload,
  OpenClawAddAgentInput,
  OpenClawAgentModelStatusInput,
  OpenClawArtifactDeleteInput,
  OpenClawArtifactGetInput,
  OpenClawArtifactListInput,
  OpenClawArtifactListPayload,
  OpenClawArtifactPayload,
  OpenClawArtifactPutInput,
  OpenClawChannelStatusInput,
  OpenClawChannelStatusPayload,
  OpenClawChannelLogsInput,
  OpenClawChannelLogsPayload,
  OpenClawAgentListPayload,
  OpenClawAgentTurnInput,
  OpenClawCommandOptions,
  OpenClawConfigSchemaLookupInput,
  OpenClawConfigSchemaLookupPayload,
  OpenClawCronListInput,
  OpenClawCronListPayload,
  OpenClawCronStatusPayload,
  OpenClawDescribeSessionInput,
  OpenClawExecApprovalListInput,
  OpenClawExecApprovalListPayload,
  OpenClawExecApprovalResolveInput,
  OpenClawExecApprovalResolvePayload,
  OpenClawGatewayClient,
  OpenClawGatewayEventCallbacks,
  OpenClawGatewayEventSubscription,
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
  OpenClawSessionPayload,
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

export class CliOpenClawGatewayClient implements OpenClawGatewayClient {
  getHealth(options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawHealthPayload>("health", {}, options);
  }

  getStatus(options: OpenClawCommandOptions = {}) {
    return runOpenClawJson<StatusPayload>(["status", "--json"], options);
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
    return this.call<OpenClawSessionPayload>("sessions.describe", { ...input }, options);
  }

  getSessionHistory(input: OpenClawSessionHistoryInput = {}, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawSessionHistoryPayload>("sessions.history", { ...input }, options);
  }

  exportSession(input: OpenClawSessionExportInput = {}, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawSessionExportPayload>("sessions.export", { ...input }, options);
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
    return this.call<OpenClawArtifactListPayload>("artifacts.list", { ...input }, options);
  }

  getArtifact(input: OpenClawArtifactGetInput, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawArtifactPayload>("artifacts.get", { ...input }, options);
  }

  putArtifact(input: OpenClawArtifactPutInput, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawArtifactPayload>("artifacts.put", { ...input }, options);
  }

  deleteArtifact(input: OpenClawArtifactDeleteInput, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawArtifactPayload>(
      "artifacts.delete",
      { artifactId: input.artifactId, reason: input.reason ?? undefined },
      options
    );
  }

  getRuntimeSnapshot(input: OpenClawRuntimeSnapshotInput = {}, options: OpenClawCommandOptions = {}) {
    return this.call<OpenClawRuntimeSnapshotPayload>("runtime.snapshot", { ...input }, options);
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
    options: OpenClawCommandOptions = {}
  ) {
    return runOpenClawJson<Record<string, unknown>>(["gateway", action, "--json"], options);
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

  deleteAgent(agentId: string, options: OpenClawCommandOptions = {}) {
    return runOpenClaw(["agents", "delete", agentId, "--force", "--json"], options);
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
