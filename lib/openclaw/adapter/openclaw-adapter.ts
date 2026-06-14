import "server-only";

import type { CommandResult } from "@/lib/openclaw/cli";
import { runGatewayConfigMutationWithPacing } from "@/lib/openclaw/application/config-pacing-service";
import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import type {
  GatewayProbePayload,
  GatewayStatusPayload,
  MissionCommandPayload,
  ModelsPayload,
  ModelsStatusPayload,
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
  OpenClawAgentListPayload,
  OpenClawAgentTurnInput,
  OpenClawCommandOptions,
  OpenClawGatewayControlOptions,
  OpenClawChatInjectInput,
  OpenClawGatewayClient,
  OpenClawGatewayEventCallbacks,
  OpenClawGatewayEventSubscription,
  OpenClawGmailSetupInput,
  OpenClawHealthPayload,
  OpenClawListModelsInput,
  OpenClawListSessionsInput,
  OpenClawLogsTailInput,
  OpenClawLogsTailPayload,
  OpenClawModelAuthOrderSetInput,
  OpenClawModelScanPayload,
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
} from "@/lib/openclaw/client/gateway-client";

export interface OpenClawAdapter {
  getHealth(options?: OpenClawCommandOptions): Promise<OpenClawHealthPayload>;
  getStatus(options?: OpenClawCommandOptions): Promise<StatusPayload>;
  getUpdateStatus(options?: OpenClawCommandOptions): Promise<OpenClawUpdateStatusPayload>;
  getGatewayStatus(options?: OpenClawCommandOptions): Promise<GatewayStatusPayload>;
  getModelStatus(options?: OpenClawCommandOptions): Promise<ModelsStatusPayload>;
  getAgentModelStatus(input: OpenClawAgentModelStatusInput, options?: OpenClawCommandOptions): Promise<ModelsStatusPayload>;
  setModelAuthOrder(input: OpenClawModelAuthOrderSetInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  listAgents(options?: OpenClawCommandOptions): Promise<OpenClawAgentListPayload>;
  listSessions(input?: OpenClawListSessionsInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionsPayload>;
  describeSession(input?: OpenClawDescribeSessionInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionPayload>;
  getSessionHistory(
    input?: OpenClawSessionHistoryInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawSessionHistoryPayload>;
  exportSession(input?: OpenClawSessionExportInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionExportPayload>;
  listTasks(input?: OpenClawTaskListInput, options?: OpenClawCommandOptions): Promise<OpenClawTaskListPayload>;
  getTask(input: OpenClawTaskGetInput, options?: OpenClawCommandOptions): Promise<OpenClawTaskPayload>;
  assignTask(input: OpenClawTaskAssignInput, options?: OpenClawCommandOptions): Promise<OpenClawTaskPayload>;
  cancelTask(input: OpenClawTaskCancelInput, options?: OpenClawCommandOptions): Promise<OpenClawTaskPayload>;
  listArtifacts(input?: OpenClawArtifactListInput, options?: OpenClawCommandOptions): Promise<OpenClawArtifactListPayload>;
  getArtifact(input: OpenClawArtifactGetInput, options?: OpenClawCommandOptions): Promise<OpenClawArtifactPayload>;
  putArtifact(input: OpenClawArtifactPutInput, options?: OpenClawCommandOptions): Promise<OpenClawArtifactPayload>;
  deleteArtifact(input: OpenClawArtifactDeleteInput, options?: OpenClawCommandOptions): Promise<OpenClawArtifactPayload>;
  getRuntimeSnapshot(
    input?: OpenClawRuntimeSnapshotInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawRuntimeSnapshotPayload>;
  getToolsCatalog(input?: OpenClawToolsCatalogInput, options?: OpenClawCommandOptions): Promise<OpenClawToolsCatalogPayload>;
  getEffectiveTools(input?: OpenClawToolsEffectiveInput, options?: OpenClawCommandOptions): Promise<OpenClawToolsEffectivePayload>;
  invokeTool(input: OpenClawToolInvokeInput, options?: OpenClawCommandOptions): Promise<OpenClawToolInvokePayload>;
  subscribeRuntimeEvents(
    input: OpenClawRuntimeEventSubscriptionInput,
    callbacks: OpenClawGatewayEventCallbacks,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawGatewayEventSubscription>;
  getChannelStatus(
    input?: OpenClawChannelStatusInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawChannelStatusPayload>;
  getChannelLogs(input: OpenClawChannelLogsInput, options?: OpenClawCommandOptions): Promise<OpenClawChannelLogsPayload>;
  provisionChannelAccount(input: OpenClawChannelAccountProvisionInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  removeChannelAccount(input: OpenClawChannelAccountRemoveInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  setupGmailWebhook(input: OpenClawGmailSetupInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  listModels(input?: OpenClawListModelsInput, options?: OpenClawCommandOptions): Promise<ModelsPayload>;
  listSkills(options?: OpenClawCommandOptions & { eligible?: boolean }): Promise<OpenClawSkillListPayload>;
  listPlugins(options?: OpenClawCommandOptions): Promise<OpenClawPluginListPayload>;
  scanModels(options?: OpenClawCommandOptions & {
    yes?: boolean;
    noInput?: boolean;
    noProbe?: boolean;
  }): Promise<OpenClawModelScanPayload>;
  getConfig<TPayload>(path: string, options?: OpenClawCommandOptions): Promise<TPayload | null>;
  getConfigSchema(options?: OpenClawCommandOptions): Promise<OpenClawConfigSchemaPayload | null>;
  lookupConfigSchema(
    input: OpenClawConfigSchemaLookupInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawConfigSchemaLookupPayload | null>;
  hasConfig(path: string, options?: OpenClawCommandOptions): Promise<boolean>;
  setConfig(
    path: string,
    value: unknown,
    options?: OpenClawCommandOptions & { strictJson?: boolean }
  ): Promise<CommandResult>;
  unsetConfig(path: string, options?: OpenClawCommandOptions): Promise<CommandResult>;
  addAgent(
    input: OpenClawAddAgentInput,
    options?: OpenClawCommandOptions
  ): Promise<CommandResult>;
  updateAgent(input: OpenClawUpdateAgentInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  setAgentIdentity(input: OpenClawAgentIdentityInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  deleteAgent(agentId: string, options?: OpenClawCommandOptions): Promise<CommandResult>;
  provisionAutomation(input: OpenClawAutomationProvisionInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  runAgentTurn(input: OpenClawAgentTurnInput, options?: OpenClawCommandOptions): Promise<MissionCommandPayload>;
  abortAgentTurn(input: OpenClawAbortTurnInput, options?: OpenClawCommandOptions): Promise<MissionCommandPayload>;
  steerSession(input: OpenClawSessionSteerInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionControlPayload>;
  injectChat(input: OpenClawChatInjectInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionControlPayload>;
  streamAgentTurn(
    input: OpenClawAgentTurnInput,
    callbacks?: OpenClawStreamCallbacks,
    options?: OpenClawCommandOptions
  ): Promise<MissionCommandPayload>;
  probeGateway(options?: OpenClawCommandOptions): Promise<GatewayProbePayload>;
  controlGateway(
    action: "start" | "stop" | "restart",
    options?: OpenClawGatewayControlOptions
  ): Promise<Record<string, unknown>>;
  listDeviceAccess?(options?: OpenClawCommandOptions): Promise<import("@/lib/openclaw/client/types").OpenClawDeviceListPayload>;
  approveDeviceAccess(input?: OpenClawDeviceApproveInput, options?: OpenClawCommandOptions): Promise<OpenClawDeviceApprovePayload>;
  call<TPayload>(
    method: string,
    params?: Record<string, unknown>,
    options?: OpenClawCommandOptions
  ): Promise<TPayload>;
  tailLogs(input?: OpenClawLogsTailInput, options?: OpenClawCommandOptions): Promise<OpenClawLogsTailPayload>;
  listExecApprovals(
    input?: OpenClawExecApprovalListInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawExecApprovalListPayload>;
  resolveExecApproval(
    input: OpenClawExecApprovalResolveInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawExecApprovalResolvePayload>;
  getCronStatus(options?: OpenClawCommandOptions): Promise<OpenClawCronStatusPayload>;
  listCronJobs(input?: OpenClawCronListInput, options?: OpenClawCommandOptions): Promise<OpenClawCronListPayload>;
}

export class GatewayBackedOpenClawAdapter implements OpenClawAdapter {
  constructor(private readonly getClient: () => OpenClawGatewayClient = getOpenClawGatewayClient) {}

  getHealth(options: OpenClawCommandOptions = {}) {
    return this.getClient().getHealth(options);
  }

  getStatus(options: OpenClawCommandOptions = {}) {
    return this.getClient().getStatus(options);
  }

  getUpdateStatus(options: OpenClawCommandOptions = {}) {
    return this.getClient().getUpdateStatus(options);
  }

  getGatewayStatus(options: OpenClawCommandOptions = {}) {
    return this.getClient().getGatewayStatus(options);
  }

  getModelStatus(options: OpenClawCommandOptions = {}) {
    return this.getClient().getModelStatus(options);
  }

  getAgentModelStatus(input: OpenClawAgentModelStatusInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().getAgentModelStatus(input, options);
  }

  setModelAuthOrder(input: OpenClawModelAuthOrderSetInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().setModelAuthOrder(input, options);
  }

  listAgents(options: OpenClawCommandOptions = {}) {
    return this.getClient().listAgents(options);
  }

  listSessions(input: OpenClawListSessionsInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().listSessions(input, options);
  }

  describeSession(input: OpenClawDescribeSessionInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().describeSession(input, options);
  }

  getSessionHistory(input: OpenClawSessionHistoryInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().getSessionHistory(input, options);
  }

  exportSession(input: OpenClawSessionExportInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().exportSession(input, options);
  }

  listTasks(input: OpenClawTaskListInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().listTasks(input, options);
  }

  getTask(input: OpenClawTaskGetInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().getTask(input, options);
  }

  assignTask(input: OpenClawTaskAssignInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().assignTask(input, options);
  }

  cancelTask(input: OpenClawTaskCancelInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().cancelTask(input, options);
  }

  listArtifacts(input: OpenClawArtifactListInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().listArtifacts(input, options);
  }

  getArtifact(input: OpenClawArtifactGetInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().getArtifact(input, options);
  }

  putArtifact(input: OpenClawArtifactPutInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().putArtifact(input, options);
  }

  deleteArtifact(input: OpenClawArtifactDeleteInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().deleteArtifact(input, options);
  }

  getRuntimeSnapshot(input: OpenClawRuntimeSnapshotInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().getRuntimeSnapshot(input, options);
  }

  getToolsCatalog(input: OpenClawToolsCatalogInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().getToolsCatalog(input, options);
  }

  getEffectiveTools(input: OpenClawToolsEffectiveInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().getEffectiveTools(input, options);
  }

  invokeTool(input: OpenClawToolInvokeInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().invokeTool(input, options);
  }

  subscribeRuntimeEvents(
    input: OpenClawRuntimeEventSubscriptionInput,
    callbacks: OpenClawGatewayEventCallbacks,
    options: OpenClawCommandOptions = {}
  ) {
    return this.getClient().subscribeRuntimeEvents(input, callbacks, options);
  }

  getChannelStatus(input: OpenClawChannelStatusInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().getChannelStatus(input, options);
  }

  getChannelLogs(input: OpenClawChannelLogsInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().getChannelLogs(input, options);
  }

  provisionChannelAccount(input: OpenClawChannelAccountProvisionInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().provisionChannelAccount(input, options);
  }

  removeChannelAccount(input: OpenClawChannelAccountRemoveInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().removeChannelAccount(input, options);
  }

  setupGmailWebhook(input: OpenClawGmailSetupInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().setupGmailWebhook(input, options);
  }

  listModels(input: OpenClawListModelsInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().listModels(input, options);
  }

  listSkills(options: OpenClawCommandOptions & { eligible?: boolean } = {}) {
    return this.getClient().listSkills(options);
  }

  listPlugins(options: OpenClawCommandOptions = {}) {
    return this.getClient().listPlugins(options);
  }

  scanModels(options: OpenClawCommandOptions & { yes?: boolean; noInput?: boolean; noProbe?: boolean } = {}) {
    return this.getClient().scanModels(options);
  }

  getConfig<TPayload>(path: string, options: OpenClawCommandOptions = {}) {
    return this.getClient().getConfig<TPayload>(path, options);
  }

  getConfigSchema(options: OpenClawCommandOptions = {}) {
    return this.getClient().getConfigSchema?.(options) ?? Promise.resolve(null);
  }

  lookupConfigSchema(input: OpenClawConfigSchemaLookupInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().lookupConfigSchema?.(input, options) ?? Promise.resolve(null);
  }

  hasConfig(path: string, options: OpenClawCommandOptions = {}) {
    return this.getClient().hasConfig(path, options);
  }

  setConfig(path: string, value: unknown, options: OpenClawCommandOptions & { strictJson?: boolean } = {}) {
    return runGatewayConfigMutationWithPacing({
      path,
      operation: "set",
      value,
      options,
      execute: () => this.getClient().setConfig(path, value, options)
    });
  }

  unsetConfig(path: string, options: OpenClawCommandOptions = {}) {
    return runGatewayConfigMutationWithPacing({
      path,
      operation: "unset",
      value: null,
      options,
      execute: () => this.getClient().unsetConfig(path, options)
    });
  }

  addAgent(input: OpenClawAddAgentInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().addAgent(input, options);
  }

  updateAgent(input: OpenClawUpdateAgentInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();

    if (!client.updateAgent) {
      throw new Error(
        "OpenClaw agent update is unavailable: the active Gateway client does not expose agents.update or a real CLI fallback."
      );
    }

    return client.updateAgent(input, options);
  }

  setAgentIdentity(input: OpenClawAgentIdentityInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().setAgentIdentity(input, options);
  }

  deleteAgent(agentId: string, options: OpenClawCommandOptions = {}) {
    return this.getClient().deleteAgent(agentId, options);
  }

  provisionAutomation(input: OpenClawAutomationProvisionInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().provisionAutomation(input, options);
  }

  runAgentTurn(input: OpenClawAgentTurnInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().runAgentTurn(input, options);
  }

  abortAgentTurn(input: OpenClawAbortTurnInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.abortAgentTurn
      ? client.abortAgentTurn(input, options)
      : client.call<MissionCommandPayload>("chat.abort", { ...input }, options);
  }

  steerSession(input: OpenClawSessionSteerInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();

    if (!client.steerSession) {
      throw new Error("Native OpenClaw Gateway is required for sessions.steer.");
    }

    return client.steerSession(input, options);
  }

  injectChat(input: OpenClawChatInjectInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();

    if (!client.injectChat) {
      throw new Error("Native OpenClaw Gateway is required for chat.inject.");
    }

    return client.injectChat(input, options);
  }

  streamAgentTurn(
    input: OpenClawAgentTurnInput,
    callbacks: OpenClawStreamCallbacks = {},
    options: OpenClawCommandOptions = {}
  ) {
    return this.getClient().streamAgentTurn(input, callbacks, options);
  }

  probeGateway(options: OpenClawCommandOptions = {}) {
    return this.getClient().probeGateway(options);
  }

  controlGateway(action: "start" | "stop" | "restart", options: OpenClawCommandOptions & { force?: boolean } = {}) {
    return this.getClient().controlGateway(action, options);
  }

  listDeviceAccess(options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (client.listDeviceAccess) {
      return client.listDeviceAccess(options);
    }

    return client.call<import("@/lib/openclaw/client/types").OpenClawDeviceListPayload>("device.pair.list", {}, options);
  }

  approveDeviceAccess(input: OpenClawDeviceApproveInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().approveDeviceAccess(input, options);
  }

  call<TPayload>(method: string, params: Record<string, unknown> = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().call<TPayload>(method, params, options);
  }

  tailLogs(input: OpenClawLogsTailInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.tailLogs?.(input, options) ?? client.call<OpenClawLogsTailPayload>("logs.tail", { ...input }, options);
  }

  listExecApprovals(input: OpenClawExecApprovalListInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.listExecApprovals?.(input, options) ??
      client.call<OpenClawExecApprovalListPayload>("exec.approval.list", { ...input }, options);
  }

  resolveExecApproval(input: OpenClawExecApprovalResolveInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.resolveExecApproval?.(input, options) ??
      client.call<OpenClawExecApprovalResolvePayload>(
        "exec.approval.resolve",
        {
          approvalId: input.approvalId,
          decision: input.decision,
          reason: input.reason ?? undefined
        },
        options
      );
  }

  getCronStatus(options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.getCronStatus?.(options) ?? client.call<OpenClawCronStatusPayload>("cron.status", {}, options);
  }

  listCronJobs(input: OpenClawCronListInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.listCronJobs?.(input, options) ?? client.call<OpenClawCronListPayload>("cron.list", { ...input }, options);
  }
}

let defaultAdapter: OpenClawAdapter | null = null;

export function getOpenClawAdapter() {
  if (!defaultAdapter) {
    defaultAdapter = new GatewayBackedOpenClawAdapter();
  }

  return defaultAdapter;
}

export function setOpenClawAdapterForTesting(adapter: OpenClawAdapter | null) {
  defaultAdapter = adapter;
}
