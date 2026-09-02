import type { CommandResult } from "@/lib/openclaw/cli";
import type {
  OpenClawNativeAuthorizationProof,
  OpenClawOperatorIdentity
} from "@/lib/openclaw/identity/types";
import type {
  AgentMemorySearchConfig,
  AgentSandboxConfig,
  AgentToolPolicyConfig
} from "@/lib/openclaw/types";

export interface OpenClawCommandOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  forceCli?: boolean;
  /** Server-created native handshake proof required for mutation CLI fallback. */
  authorizationProof?: OpenClawNativeAuthorizationProof;
  /** Dedicated local Gateway-auth bootstrap path; never accepted from HTTP input. */
  allowGatewayAuthRepairFallback?: boolean;
}

export type OpenClawGatewayControlOptions = OpenClawCommandOptions & {
  force?: boolean;
};

export type OpenClawConfigReloadKind = "restart" | "hot" | "none" | "unknown";

export type OpenClawConfigMutationMetadata = {
  path: string;
  reloadKind: OpenClawConfigReloadKind;
  restartRequired: boolean;
  hotReloaded: boolean;
  appliedVia: "config.patch" | "config.apply" | "config.set" | "noop";
  baseHash?: string;
};

export type OpenClawGatewayConnectionState =
  | "cli-forced"
  | "idle"
  | "connecting"
  | "connected"
  | "closed"
  | "error";

export type OpenClawGatewayMode =
  | "native-ws"
  | "cli-forced"
  | "fallback-active"
  | "degraded"
  | "unreachable";

export type OpenClawGatewayRecentFallbackDiagnostic = {
  at: string;
  operation: string;
  issue: string;
  kind: string;
  recovery: string;
};

export type OpenClawGatewayClientDiagnostics = {
  mode: "native-ws" | "cli";
  gatewayMode: OpenClawGatewayMode;
  statusLabel: string;
  recovery: string | null;
  connectionState: OpenClawGatewayConnectionState;
  protocolVersion: number | null;
  protocolRange: {
    min: number;
    max: number;
  };
  fallbackCounts: Record<string, number>;
  fallbackTotal: number;
  pendingRequestCount?: number;
  sharedInFlightRequestCount?: number;
  cachedReadRequestCount?: number;
  recentFallbackDiagnostics: OpenClawGatewayRecentFallbackDiagnostic[];
  lastNativeError: string | null;
  lastNativeFailureAt: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  operatorIdentity?: OpenClawOperatorIdentity;
};

export type OpenClawUserProfile = {
  profileId: string;
  displayName: string | null;
  avatar: string | null;
  email: string | null;
  role: string | null;
};

export type OpenClawUserListPayload = {
  profiles: OpenClawUserProfile[];
};

export type OpenClawGatewayRequestPolicy = {
  safety: "read" | "mutation";
  timeoutMs?: number;
  allowCliFallback?: boolean;
  allowReadCliFallbackOnNativeFailure?: boolean;
  allowMutationFallbackOnUnsupported?: boolean;
  allowUnsafeMutationCliFallback?: boolean;
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
    capability?: string;
    error?: string;
    auth?: {
      role?: string | null;
      scopes?: string[];
      capability?: string;
    };
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
  account?: string | null;
  name?: string | null;
  token?: string | null;
  botToken?: string | null;
  appToken?: string | null;
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

export interface OpenClawAgentIdentityInput {
  agentId: string;
  workspace: string;
  identityFile: string;
  name?: string | null;
  emoji?: string | null;
  theme?: string | null;
  avatar?: string | null;
}

export interface OpenClawAutomationProvisionInput {
  name: string;
  description?: string | null;
  declarationKey?: string | null;
  agentId: string;
  message: string;
  thinking?: string | null;
  timeoutSeconds?: number | null;
  sessionTarget?: "isolated" | "main" | "current" | `session:${string}`;
  schedule:
    | {
        kind: "every";
        value: string;
      }
    | {
        kind: "cron";
        value: string;
      };
  announce?: {
    channel: string;
    target?: string | null;
  } | null;
}

export interface OpenClawDeviceApproveInput {
  latest?: boolean;
  requestId?: string | null;
  scopes?: string[];
}

export type OpenClawDeviceApprovePayload = Record<string, unknown> & {
  requestId?: unknown;
  device?: {
    deviceId?: unknown;
    scopes?: unknown;
    approvedScopes?: unknown;
  };
};

export type OpenClawDeviceListPayload = Record<string, unknown> & {
  pending?: unknown[];
};

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
  gateway?: {
    mode?: string;
    url?: string;
    urlSource?: string;
    reachable?: boolean;
    error?: string | null;
    authWarning?: string | null;
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
  tasks?: {
    total?: number;
    active?: number;
    terminal?: number;
    failures?: number;
    byStatus?: Record<string, number>;
    byRuntime?: Record<string, number>;
  };
  taskAudit?: {
    total?: number;
    warnings?: number;
    errors?: number;
    byCode?: Record<string, number>;
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
  description?: string;
  workspace: string;
  agentDir?: string;
  model?: string;
  heartbeat?: {
    every?: string;
  };
  skills?: string[];
  tools?: AgentToolPolicyConfig;
  sandbox?: AgentSandboxConfig;
  memorySearch?: AgentMemorySearchConfig;
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
    enabled?: boolean;
    origin?: string;
    channelIds?: string[];
    toolNames?: string[];
    dependencyStatus?: {
      installed?: boolean;
      requiredInstalled?: boolean;
    };
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

export interface OpenClawSessionModelPatchInput extends OpenClawSessionReferenceInput {
  model: string | null;
}

export type OpenClawSessionModelPatchPayload = Record<string, unknown>;

export interface OpenClawDescribeSessionInput extends OpenClawSessionReferenceInput {
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
  /** Exact 8.1 `tasks.list` filter. */
  sessionKey?: string;
  /** @deprecated Use the exact Gateway `sessionKey` field. */
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
  nextCursor?: string | number | null;
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
  runId?: string;
  sessionKey?: string;
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

export interface OpenClawArtifactDownloadInput {
  artifactId: string;
  format?: string;
  destination?: string;
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

export type OpenClawArtifactDownloadPayload = OpenClawArtifactPayload & {
  bytes?: unknown;
  data?: unknown;
  path?: string;
  url?: string;
};

export interface OpenClawRuntimeSnapshotInput {
  includeSessions?: boolean;
  includeTasks?: boolean;
  includeArtifacts?: boolean;
  agentId?: string;
  workspace?: string;
  taskId?: string;
  runId?: string;
  sessionKey?: string;
  sessionId?: string;
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
  includePlugins?: boolean;
}

export interface OpenClawToolsEffectiveInput {
  agentId?: string;
  sessionKey: string;
}

export interface OpenClawToolInvokeInput {
  name: string;
  args?: Record<string, unknown>;
  sessionKey?: string;
  agentId?: string;
  confirm?: boolean;
  idempotencyKey?: string;
}

export type OpenClawToolCatalogEntry = {
  id: string;
  label: string;
  description: string;
  source: "core" | "plugin";
  pluginId?: string;
  optional?: boolean;
  risk?: "low" | "medium" | "high";
  tags?: string[];
  defaultProfiles: Array<"minimal" | "coding" | "messaging" | "full">;
};

export type OpenClawToolsCatalogPayload = {
  agentId: string;
  profiles: Array<{
    id: "minimal" | "coding" | "messaging" | "full";
    label: string;
  }>;
  groups: Array<{
    id: string;
    label: string;
    source: "core" | "plugin";
    pluginId?: string;
    tools: OpenClawToolCatalogEntry[];
  }>;
};

export type OpenClawToolsEffectivePayload = {
  agentId: string;
  profile: string;
  groups: Array<{
    id: "core" | "plugin" | "channel" | "mcp";
    label: string;
    source: "core" | "plugin" | "channel" | "mcp";
    tools: Array<{
      id: string;
      label: string;
      description: string;
      rawDescription: string;
      source: "core" | "plugin" | "channel" | "mcp";
      pluginId?: string;
      channelId?: string;
      risk?: "low" | "medium" | "high";
      tags?: string[];
    }>;
  }>;
  notices?: Array<{
    id: string;
    severity: "info" | "warning";
    message: string;
  }>;
};

export type OpenClawToolInvokePayload = {
  ok: boolean;
  toolName: string;
  output?: unknown;
  requiresApproval?: boolean;
  approvalId?: string;
  source?: string;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type OpenClawGatewaySurfaceInput = Record<string, unknown>;

export type OpenClawGatewaySurfacePayload = Record<string, unknown>;

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

export interface OpenClawWebLoginStartInput {
  accountId?: string;
  force?: boolean;
  timeoutMs?: number;
  verbose?: boolean;
}

export interface OpenClawWebLoginWaitInput {
  accountId?: string;
  timeoutMs?: number;
  currentQrDataUrl?: string;
}

export type OpenClawWebLoginResult = Record<string, unknown> & {
  connected?: boolean;
  qrDataUrl?: string;
  message?: string;
};

export interface OpenClawChannelLogoutInput {
  channel: string;
  accountId?: string;
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
        oauth?: number;
        token?: number;
        apiKey?: number;
      };
      syntheticAuth?: {
        value?: string;
        source?: string;
        credential?: string;
        mode?: string;
      };
    }>;
    runtimeAuthRoutes?: Array<{
      provider?: string;
      runtime?: string;
      authProvider?: string;
      status?: string;
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
  idempotencyKey?: string | null;
  local?: boolean;
}

export interface OpenClawAbortTurnInput {
  runId?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
  reason?: string | null;
}

export interface OpenClawSessionSteerInput {
  key?: string | null;
  sessionId?: string | null;
  message: string;
}

export interface OpenClawChatInjectInput {
  sessionKey?: string | null;
  sessionId?: string | null;
  message: string;
}

export type OpenClawSessionControlPayload = Record<string, unknown> & {
  ok?: boolean;
  status?: string;
  runId?: string;
  sessionId?: string;
  taskId?: string;
};

export type OpenClawConfigSchemaPayload = Record<string, unknown> & {
  schema?: unknown;
  hash?: string;
  version?: string;
};

export type OpenClawConfigSchemaLookupPayload = Record<string, unknown> & {
  path?: string;
  normalizedPath?: string;
  reloadKind?: OpenClawConfigReloadKind | string;
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
  triggersEnabled?: boolean;
  storage?: string;
  sqlitePath?: string | null;
  jobs?: number;
  nextWakeAtMs?: number | null;
};

export interface OpenClawCronListInput {
  includeDisabled?: boolean;
  limit?: number;
  offset?: number;
  query?: string;
  enabled?: boolean;
  scheduleKind?: string;
  lastRunStatus?: string;
  trigger?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  agentId?: string;
  compact?: boolean;
  includeDeliveryPreviews?: boolean;
}

export type OpenClawCronListPayload = Record<string, unknown> & {
  jobs?: unknown[];
};

export interface OpenClawCronGetInput {
  id: string;
}

export type OpenClawCronRunMode = "due" | "force" | "if-enabled";

export interface OpenClawCronRunInput {
  id: string;
  mode?: OpenClawCronRunMode;
  expectedProcessInstanceId?: string;
}

export type OpenClawCronRunPayload = Record<string, unknown> & {
  ok?: boolean;
  ran?: boolean;
  enqueued?: boolean;
  runId?: string;
  reason?: "disabled" | "not-due" | "already-running" | "invalid-spec" | "stopped" | string;
  processInstanceId?: string;
};

export interface OpenClawCronRunsInput {
  id?: string;
  jobId?: string;
  runId?: string;
  scope?: "job" | "all";
  agentId?: string;
  limit?: number;
  offset?: number;
  statuses?: string[];
  status?: string;
  deliveryStatuses?: string[];
  deliveryStatus?: string;
  query?: string;
  sortDir?: "asc" | "desc";
}

export type OpenClawCronRunsPayload = Record<string, unknown> & {
  entries?: unknown[];
  total?: number;
  offset?: number;
  limit?: number;
  hasMore?: boolean;
  nextOffset?: number | null;
};

export type OpenClawUpdateStatusPayload = Record<string, unknown> & {
  currentVersion?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  update?: {
    root?: string | null;
    installKind?: string | null;
    packageManager?: string | null;
    registry?: {
      latestVersion?: string | null;
      tag?: string | null;
      error?: string | null;
    } | null;
  };
  availability?: {
    available?: boolean | null;
    hasRegistryUpdate?: boolean | null;
    latestVersion?: string | null;
  };
  channel?: {
    value?: string | null;
    label?: string | null;
  };
  sentinel?: unknown;
};

export interface OpenClawGatewayClient {
  getDiagnostics?(): OpenClawGatewayClientDiagnostics;
  getOperatorIdentity?(options?: OpenClawCommandOptions): Promise<OpenClawOperatorIdentity>;
  getHealth(options?: OpenClawCommandOptions): Promise<OpenClawHealthPayload>;
  getStatus(options?: OpenClawCommandOptions): Promise<StatusPayload>;
  getUpdateStatus(options?: OpenClawCommandOptions): Promise<OpenClawUpdateStatusPayload>;
  getGatewayStatus(options?: OpenClawCommandOptions): Promise<GatewayStatusPayload>;
  listUsers?(options?: OpenClawCommandOptions): Promise<OpenClawUserListPayload>;
  getCurrentUser?(options?: OpenClawCommandOptions): Promise<OpenClawUserProfile | null>;
  setUserDisplayName?(profileId: string, displayName: string, options?: OpenClawCommandOptions): Promise<OpenClawUserProfile | null>;
  setUserAvatar?(profileId: string, avatar: string | null, options?: OpenClawCommandOptions): Promise<OpenClawUserProfile | null>;
  linkUserEmail?(profileId: string, email: string, options?: OpenClawCommandOptions): Promise<OpenClawUserProfile | null>;
  setUserRole?(profileId: string, role: string | null, options?: OpenClawCommandOptions): Promise<OpenClawUserProfile | null>;
  listGatewayRoleNames?(options?: OpenClawCommandOptions): Promise<string[]>;
  getModelStatus(options?: OpenClawCommandOptions): Promise<ModelsStatusPayload>;
  getAgentModelStatus(input: OpenClawAgentModelStatusInput, options?: OpenClawCommandOptions): Promise<ModelsStatusPayload>;
  setModelAuthOrder(input: OpenClawModelAuthOrderSetInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  listAgents(options?: OpenClawCommandOptions): Promise<OpenClawAgentListPayload>;
  listSessions(input?: OpenClawListSessionsInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionsPayload>;
  patchSessionModel?(input: OpenClawSessionModelPatchInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionModelPatchPayload>;
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
  downloadArtifact?(
    input: OpenClawArtifactDownloadInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawArtifactDownloadPayload>;
  putArtifact(input: OpenClawArtifactPutInput, options?: OpenClawCommandOptions): Promise<OpenClawArtifactPayload>;
  deleteArtifact(input: OpenClawArtifactDeleteInput, options?: OpenClawCommandOptions): Promise<OpenClawArtifactPayload>;
  getRuntimeSnapshot(
    input?: OpenClawRuntimeSnapshotInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawRuntimeSnapshotPayload>;
  getToolsCatalog(input?: OpenClawToolsCatalogInput, options?: OpenClawCommandOptions): Promise<OpenClawToolsCatalogPayload>;
  getEffectiveTools(input: OpenClawToolsEffectiveInput, options?: OpenClawCommandOptions): Promise<OpenClawToolsEffectivePayload>;
  invokeTool(input: OpenClawToolInvokeInput, options?: OpenClawCommandOptions): Promise<OpenClawToolInvokePayload>;
  listCommands?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  getUsageStatus?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  getUsageCost?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  getSessionUsage?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  getSessionUsageTimeseries?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  getSessionUsageLogs?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  getMemoryDoctorStatus?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  getMemoryDreamDiary?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  listAgentFiles?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  getAgentFile?(input: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  setAgentFile?(input: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  listEnvironments?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  getEnvironmentStatus?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  getTalkCatalog?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  getTalkConfig?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  getTtsStatus?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  getTtsProviders?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  listNodes?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  describeNode?(input: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  invokeNode?(input: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  listPluginApprovals?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  resolvePluginApproval?(input: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  subscribeRuntimeEvents(
    input: OpenClawRuntimeEventSubscriptionInput,
    callbacks: OpenClawGatewayEventCallbacks,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawGatewayEventSubscription>;
  getChannelStatus(
    input?: OpenClawChannelStatusInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawChannelStatusPayload>;
  startWebLogin?(input?: OpenClawWebLoginStartInput, options?: OpenClawCommandOptions): Promise<OpenClawWebLoginResult>;
  waitForWebLogin?(input?: OpenClawWebLoginWaitInput, options?: OpenClawCommandOptions): Promise<OpenClawWebLoginResult>;
  logoutChannel?(input: OpenClawChannelLogoutInput, options?: OpenClawCommandOptions): Promise<Record<string, unknown>>;
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
    options?: OpenClawGatewayControlOptions
  ): Promise<Record<string, unknown>>;
  listDeviceAccess?(options?: OpenClawCommandOptions): Promise<OpenClawDeviceListPayload>;
  approveDeviceAccess(input?: OpenClawDeviceApproveInput, options?: OpenClawCommandOptions): Promise<OpenClawDeviceApprovePayload>;
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
  setAgentIdentity(input: OpenClawAgentIdentityInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  deleteAgent(agentId: string, options?: OpenClawCommandOptions): Promise<CommandResult>;
  provisionAutomation(input: OpenClawAutomationProvisionInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  runAgentTurn(
    input: OpenClawAgentTurnInput,
    options?: OpenClawCommandOptions
  ): Promise<MissionCommandPayload>;
  abortAgentTurn?(input: OpenClawAbortTurnInput, options?: OpenClawCommandOptions): Promise<MissionCommandPayload>;
  steerSession?(input: OpenClawSessionSteerInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionControlPayload>;
  injectChat?(input: OpenClawChatInjectInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionControlPayload>;
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
  getCronJob?(input: OpenClawCronGetInput, options?: OpenClawCommandOptions): Promise<Record<string, unknown>>;
  runCronJob?(input: OpenClawCronRunInput, options?: OpenClawCommandOptions): Promise<OpenClawCronRunPayload>;
  listCronRuns?(input?: OpenClawCronRunsInput, options?: OpenClawCommandOptions): Promise<OpenClawCronRunsPayload>;
  close?(reason?: string): Promise<void> | void;
  getDiagnostics?(): OpenClawGatewayClientDiagnostics;
}
