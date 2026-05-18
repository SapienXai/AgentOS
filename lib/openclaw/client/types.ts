import type { CommandResult } from "@/lib/openclaw/cli";

export interface OpenClawCommandOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  forceCli?: boolean;
}

export type OpenClawGatewayConnectionState =
  | "cli-forced"
  | "idle"
  | "connecting"
  | "connected"
  | "closed"
  | "error";

export type OpenClawGatewayClientDiagnostics = {
  mode: "native-ws" | "cli";
  connectionState: OpenClawGatewayConnectionState;
  protocolVersion: number | null;
  fallbackCounts: Record<string, number>;
  lastNativeError: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
};

export type OpenClawGatewayRequestPolicy = {
  safety: "read" | "mutation";
  timeoutMs?: number;
  allowCliFallback?: boolean;
};

export interface OpenClawStreamCallbacks {
  onStdout?: (text: string) => Promise<void> | void;
  onStderr?: (text: string) => Promise<void> | void;
}

export type GatewayStatusPayload = {
  service?: {
    label?: string;
    loaded?: boolean;
  };
  gateway?: {
    bindMode?: string;
    port?: number;
    probeUrl?: string;
  };
  rpc?: {
    ok?: boolean;
  };
};

export type GatewayProbePayload = Record<string, unknown>;

export type OpenClawHealthPayload = Record<string, unknown> & {
  ok?: boolean;
};

export type OpenClawGatewayEventFrame = {
  type?: string;
  event?: string;
  payload?: unknown;
};

export interface OpenClawGatewayEventCallbacks {
  onEvent: (event: OpenClawGatewayEventFrame) => void;
  onError?: (error: unknown) => void;
  onClose?: () => void;
}

export type OpenClawGatewayEventSubscription = {
  close: () => void;
};

export interface OpenClawLogsTailInput {
  cursor?: number;
  limit?: number;
  maxBytes?: number;
}

export type OpenClawLogsTailPayload = Record<string, unknown> & {
  file?: string;
  cursor?: number;
  size?: number;
  lines?: string[];
  truncated?: boolean;
  reset?: boolean;
};

export interface OpenClawChannelLogsInput {
  channel: string;
  lines?: number;
}

export type OpenClawChannelLogsPayload = Record<string, unknown> & {
  lines?: Array<Record<string, unknown> & {
    time?: string;
    message?: string;
    raw?: string;
  }>;
};

export interface OpenClawChannelAccountProvisionInput {
  channel: string;
  account: string;
  name?: string | null;
  token?: string | null;
  botToken?: string | null;
  webhookUrl?: string | null;
}

export interface OpenClawChannelAccountRemoveInput {
  channel: string;
  account: string;
  delete?: boolean;
}

export interface OpenClawGmailSetupInput {
  account: string;
  config?: Record<string, unknown>;
}

export type StatusPayload = {
  runtimeVersion?: string;
  version?: string;
  updateChannel?: string;
  overview?: {
    version?: string;
    update?: string;
  };
  update?: {
    root?: string;
    installKind?: string;
    packageManager?: string;
    registry?: {
      latestVersion?: string | null;
      error?: string | null;
    };
  };
  securityAudit?: {
    findings?: Array<{ severity?: string; title?: string; detail?: string }>;
  };
  sessions?: {
    recent?: Array<{
      agentId?: string;
      key?: string;
      sessionId?: string;
      updatedAt?: number;
      age?: number;
      inputTokens?: number;
      outputTokens?: number;
      cacheRead?: number;
      totalTokens?: number;
      model?: string;
    }>;
  };
  agents?: {
    defaultId?: string;
  };
  heartbeat?: {
    agents?: Array<{
      agentId: string;
      enabled?: boolean;
      every?: string | null;
      everyMs?: number | null;
    }>;
  };
};

export type AgentPayload = Array<{
  id: string;
  name?: string;
  identityName?: string;
  identityEmoji?: string;
  identitySource?: string;
  workspace: string;
  agentDir: string;
  model?: string;
  bindings?: number;
  isDefault?: boolean;
}>;

export type OpenClawAgentListPayload = {
  defaultId?: string;
  mainKey?: string;
  scope?: "per-sender" | "global" | string;
  agents: Array<{
    id: string;
    name?: string;
    identity?: {
      name?: string;
      theme?: string;
      emoji?: string;
      avatar?: string;
      avatarUrl?: string;
    };
    workspace?: string;
    model?: {
      primary?: string;
      fallbacks?: string[];
    };
  }>;
};

export type AgentConfigPayload = Array<{
  id: string;
  name?: string;
  workspace: string;
  agentDir?: string;
  model?: string;
  heartbeat?: {
    every?: string;
  };
  skills?: string[];
  tools?: {
    fs?: {
      workspaceOnly?: boolean;
    };
  };
  identity?: {
    name?: string;
    emoji?: string;
    theme?: string;
    avatar?: string;
  };
  default?: boolean;
}>;

export type ModelsPayload = {
  models: Array<{
    key: string;
    name: string;
    input: string;
    contextWindow: number | null;
    local: boolean | null;
    available: boolean | null;
    tags: string[];
    missing: boolean;
  }>;
};

export type OpenClawSkillListPayload = {
  skills: Array<{
    name: string;
    description?: string;
    emoji?: string;
    eligible?: boolean;
    disabled?: boolean;
    blockedByAllowlist?: boolean;
    source?: string;
    bundled?: boolean;
  }>;
};

export type OpenClawPluginListPayload = {
  plugins: Array<{
    id: string;
    name: string;
    status?: string;
    toolNames?: string[];
  }>;
};

export type OpenClawModelScanPayload = Array<{
  id: string;
  name: string;
  provider: string;
  modelRef?: string;
  contextLength?: number | null;
  supportsToolsMeta?: boolean;
  isFree?: boolean;
}>;

export interface OpenClawListModelsInput {
  all?: boolean;
  provider?: string;
}

export interface OpenClawListSessionsInput {
  limit?: number;
  activeMinutes?: number;
  includeGlobal?: boolean;
  includeUnknown?: boolean;
  includeDerivedTitles?: boolean;
  includeLastMessage?: boolean;
  label?: string;
  spawnedBy?: string;
  agentId?: string;
  search?: string;
}

export type OpenClawSessionsPayload = {
  sessions: Array<Record<string, unknown> & {
    agentId?: string;
    key?: string;
    sessionId?: string;
    updatedAt?: number;
    ageMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    model?: string;
    modelProvider?: string;
    cacheRead?: number;
    kind?: string;
    origin?: string;
  }>;
};

export interface OpenClawSessionReferenceInput {
  key?: string;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
}

export interface OpenClawDescribeSessionInput extends OpenClawSessionReferenceInput {
  includeMessages?: boolean;
  limit?: number;
}

export interface OpenClawSessionHistoryInput extends OpenClawSessionReferenceInput {
  limit?: number;
  cursor?: string | number | null;
}

export interface OpenClawSessionExportInput extends OpenClawSessionReferenceInput {
  format?: string;
}

export type OpenClawSessionPayload = Record<string, unknown> & {
  session?: Record<string, unknown>;
  key?: string;
  sessionKey?: string;
  sessionId?: string;
  messages?: unknown[];
};

export type OpenClawSessionHistoryPayload = Record<string, unknown> & {
  messages?: unknown[];
  turns?: unknown[];
  items?: unknown[];
  cursor?: string | number | null;
};

export type OpenClawSessionExportPayload = Record<string, unknown> & {
  content?: string;
  format?: string;
  session?: unknown;
};

export interface OpenClawTaskListInput {
  status?: string;
  agentId?: string;
  workspace?: string;
  sessionId?: string;
  limit?: number;
  cursor?: string | number | null;
}

export interface OpenClawTaskGetInput {
  taskId: string;
  includeRuns?: boolean;
  includeArtifacts?: boolean;
}

export interface OpenClawTaskAssignInput {
  taskId: string;
  agentId?: string;
  workspace?: string;
  reason?: string | null;
}

export interface OpenClawTaskCancelInput {
  taskId: string;
  reason?: string | null;
}

export type OpenClawTaskListPayload = Record<string, unknown> & {
  tasks?: unknown[];
  cursor?: string | number | null;
};

export type OpenClawTaskPayload = Record<string, unknown> & {
  task?: unknown;
  id?: string;
  taskId?: string;
  status?: string;
};

export interface OpenClawArtifactListInput {
  taskId?: string;
  sessionId?: string;
  agentId?: string;
  workspace?: string;
  limit?: number;
  cursor?: string | number | null;
}

export interface OpenClawArtifactGetInput {
  artifactId: string;
  includeContent?: boolean;
}

export interface OpenClawArtifactPutInput {
  artifactId?: string;
  taskId?: string;
  sessionId?: string;
  name?: string;
  path?: string;
  mimeType?: string;
  content?: unknown;
  metadata?: Record<string, unknown>;
}

export interface OpenClawArtifactDeleteInput {
  artifactId: string;
  reason?: string | null;
}

export type OpenClawArtifactListPayload = Record<string, unknown> & {
  artifacts?: unknown[];
  cursor?: string | number | null;
};

export type OpenClawArtifactPayload = Record<string, unknown> & {
  artifact?: unknown;
  artifactId?: string;
  content?: unknown;
};

export interface OpenClawRuntimeSnapshotInput {
  includeSessions?: boolean;
  includeTasks?: boolean;
  includeArtifacts?: boolean;
  agentId?: string;
  workspace?: string;
  limit?: number;
}

export type OpenClawRuntimeSnapshotPayload = Record<string, unknown> & {
  runtimes?: unknown[];
  sessions?: unknown[];
  tasks?: unknown[];
  artifacts?: unknown[];
  agents?: unknown[];
};

export interface OpenClawToolsCatalogInput {
  agentId?: string;
  workspace?: string;
  includeDisabled?: boolean;
}

export interface OpenClawToolsEffectiveInput {
  agentId?: string;
  sessionId?: string;
  workspace?: string;
}

export interface OpenClawToolInvokeInput {
  toolName: string;
  agentId?: string;
  sessionId?: string;
  input?: unknown;
  args?: Record<string, unknown>;
}

export type OpenClawToolsCatalogPayload = Record<string, unknown> & {
  tools?: unknown[];
};

export type OpenClawToolsEffectivePayload = Record<string, unknown> & {
  tools?: unknown[];
};

export type OpenClawToolInvokePayload = Record<string, unknown> & {
  ok?: boolean;
  result?: unknown;
  output?: unknown;
};

export interface OpenClawRuntimeEventSubscriptionInput {
  includeSessions?: boolean;
  includeTasks?: boolean;
  includeArtifacts?: boolean;
  includeApprovals?: boolean;
  sessionKeys?: string[];
  taskIds?: string[];
  artifactIds?: string[];
}

export type OpenClawChannelStatusPayload = {
  ts: number;
  channelOrder: string[];
  channelLabels: Record<string, string>;
  channelDetailLabels?: Record<string, string>;
  channelSystemImages?: Record<string, string>;
  channelMeta?: Array<{
    id: string;
    label: string;
    detailLabel: string;
    systemImage?: string;
  }>;
  channels: Record<string, unknown>;
  channelAccounts: Record<string, Array<Record<string, unknown> & {
    accountId: string;
    name?: string;
    enabled?: boolean;
    configured?: boolean;
    linked?: boolean;
    running?: boolean;
    connected?: boolean;
    lastError?: string;
    healthState?: string;
  }>>;
  channelDefaultAccountId: Record<string, string>;
};

export interface OpenClawChannelStatusInput {
  probe?: boolean;
  timeoutMs?: number;
}

export type ModelsStatusPayload = {
  agentDir?: string | null;
  defaultModel?: string | null;
  resolvedDefault?: string | null;
  allowed?: string[];
  auth?: {
    providers?: Array<{
      provider?: string;
      effective?: {
        kind?: string;
        detail?: string;
      };
      profiles?: {
        count?: number;
      };
    }>;
    missingProvidersInUse?: string[];
    unusableProfiles?: unknown[];
    oauth?: {
      providers?: Array<{
        provider?: string;
        status?: string;
        profiles?: unknown[];
        effectiveProfiles?: unknown[];
      }>;
    };
  };
};

export interface OpenClawAgentModelStatusInput {
  agentId: string;
}

export interface OpenClawModelAuthOrderSetInput {
  provider: string;
  agentId: string;
  profileIds: string[];
}

export type PresencePayload = Array<{
  host: string;
  ip: string;
  version: string;
  platform: string;
  deviceFamily?: string;
  mode: string;
  reason: string;
  text: string;
  ts: number;
}>;

export type MissionCommandPayload = {
  runId?: string;
  status?: string;
  summary?: string;
  payloads?: Array<{
    text: string;
    mediaUrl: string | null;
  }>;
  meta?: Record<string, unknown>;
  result?: {
    payloads?: Array<{
      text: string;
      mediaUrl: string | null;
    }>;
    meta?: Record<string, unknown>;
  };
};

export interface OpenClawAddAgentInput {
  id: string;
  workspace: string;
  agentDir: string;
  model?: string | null;
  bindings?: unknown;
  skills?: string[];
  name?: string | null;
  emoji?: string | null;
  avatar?: string | null;
}

export interface OpenClawUpdateAgentInput {
  id: string;
  name?: string | null;
  workspace?: string | null;
  model?: string | null;
  emoji?: string | null;
  avatar?: string | null;
}

export interface OpenClawAgentTurnInput {
  agentId: string;
  sessionId?: string;
  message: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high";
  timeoutSeconds?: number;
  workspace?: string | null;
  dispatchId?: string | null;
}

export interface OpenClawAbortTurnInput {
  runId?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
  reason?: string | null;
}

export type OpenClawConfigSchemaPayload = Record<string, unknown> & {
  schema?: unknown;
  hash?: string;
  version?: string;
};

export type OpenClawConfigSchemaLookupPayload = Record<string, unknown> & {
  path?: string;
  normalizedPath?: string;
  schema?: unknown;
  hint?: unknown;
  hintPath?: string;
  children?: unknown[];
};

export interface OpenClawConfigSchemaLookupInput {
  path: string;
}

export interface OpenClawExecApprovalListInput {
  status?: string;
  limit?: number;
}

export type OpenClawExecApprovalListPayload = Record<string, unknown> & {
  approvals?: unknown[];
  pending?: unknown[];
};

export interface OpenClawExecApprovalResolveInput {
  approvalId: string;
  decision: "allow" | "deny" | "approved" | "rejected";
  reason?: string | null;
}

export type OpenClawExecApprovalResolvePayload = Record<string, unknown> & {
  ok?: boolean;
  approvalId?: string;
  status?: string;
};

export type OpenClawCronStatusPayload = Record<string, unknown> & {
  enabled?: boolean;
  jobs?: number;
  nextWakeAtMs?: number | null;
};

export interface OpenClawCronListInput {
  includeDisabled?: boolean;
}

export type OpenClawCronListPayload = Record<string, unknown> & {
  jobs?: unknown[];
};

export interface OpenClawGatewayClient {
  getHealth(options?: OpenClawCommandOptions): Promise<OpenClawHealthPayload>;
  getStatus(options?: OpenClawCommandOptions): Promise<StatusPayload>;
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
  listSkills(options?: OpenClawCommandOptions & { eligible?: boolean }): Promise<OpenClawSkillListPayload>;
  listPlugins(options?: OpenClawCommandOptions): Promise<OpenClawPluginListPayload>;
  listModels(input?: OpenClawListModelsInput, options?: OpenClawCommandOptions): Promise<ModelsPayload>;
  scanModels(options?: OpenClawCommandOptions & { yes?: boolean; noInput?: boolean; noProbe?: boolean }): Promise<OpenClawModelScanPayload>;
  probeGateway(options?: OpenClawCommandOptions): Promise<GatewayProbePayload>;
  controlGateway(
    action: "start" | "stop" | "restart",
    options?: OpenClawCommandOptions
  ): Promise<Record<string, unknown>>;
  call<TPayload>(
    method: string,
    params?: Record<string, unknown>,
    options?: OpenClawCommandOptions
  ): Promise<TPayload>;
  hasConfig(path: string, options?: OpenClawCommandOptions): Promise<boolean>;
  getConfig<TPayload>(path: string, options?: OpenClawCommandOptions): Promise<TPayload | null>;
  getConfigSchema?(options?: OpenClawCommandOptions): Promise<OpenClawConfigSchemaPayload | null>;
  lookupConfigSchema?(
    input: OpenClawConfigSchemaLookupInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawConfigSchemaLookupPayload | null>;
  setConfig(
    path: string,
    value: unknown,
    options?: OpenClawCommandOptions & { strictJson?: boolean }
  ): Promise<CommandResult>;
  unsetConfig(path: string, options?: OpenClawCommandOptions): Promise<CommandResult>;
  addAgent(input: OpenClawAddAgentInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  updateAgent?(input: OpenClawUpdateAgentInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  deleteAgent(agentId: string, options?: OpenClawCommandOptions): Promise<CommandResult>;
  runAgentTurn(
    input: OpenClawAgentTurnInput,
    options?: OpenClawCommandOptions
  ): Promise<MissionCommandPayload>;
  abortAgentTurn?(input: OpenClawAbortTurnInput, options?: OpenClawCommandOptions): Promise<MissionCommandPayload>;
  streamAgentTurn(
    input: OpenClawAgentTurnInput,
    callbacks?: OpenClawStreamCallbacks,
    options?: OpenClawCommandOptions
  ): Promise<MissionCommandPayload>;
  tailLogs?(input?: OpenClawLogsTailInput, options?: OpenClawCommandOptions): Promise<OpenClawLogsTailPayload>;
  listExecApprovals?(
    input?: OpenClawExecApprovalListInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawExecApprovalListPayload>;
  resolveExecApproval?(
    input: OpenClawExecApprovalResolveInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawExecApprovalResolvePayload>;
  getCronStatus?(options?: OpenClawCommandOptions): Promise<OpenClawCronStatusPayload>;
  listCronJobs?(input?: OpenClawCronListInput, options?: OpenClawCommandOptions): Promise<OpenClawCronListPayload>;
  close?(reason?: string): Promise<void> | void;
  getDiagnostics?(): OpenClawGatewayClientDiagnostics;
}
