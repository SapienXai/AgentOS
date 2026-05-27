import {
  Activity,
  Archive,
  BellRing,
  Bot,
  BrainCircuit,
  Chrome,
  CircleCheck,
  CircleDashed,
  CirclePause,
  ClipboardCheck,
  ClipboardList,
  Code2,
  Database,
  FileArchive,
  FileJson,
  FileSpreadsheet,
  FileText,
  Folder,
  Github,
  Globe2,
  HardDrive,
  Mail,
  MessageCircle,
  Puzzle,
  ShieldCheck,
  Sparkles,
  Terminal,
  Workflow,
  XCircle,
  Zap
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type {
  AgentRecord,
  MissionControlSnapshot,
  ModelRecord,
  WorkItemRecord,
  WorkspaceRecord
} from "@/lib/agentos/contracts";
import {
  buildIntegrationStates,
  type IntegrationState,
  type IntegrationStatus as AgentOSIntegrationStatus
} from "@/lib/agentos/integrations/state";
import type { WorkspaceManagedFile } from "@/lib/openclaw/workspace-file-types";
import {
  formatAgentDisplayName,
  formatContextWindow,
  formatRelativeTime,
  formatTokens,
  resolveRelativeTimeReferenceMs
} from "@/lib/openclaw/presenters";
import type { StatusTone } from "@/components/operations/operations-ui";

export type AgentFilter = "all" | "ready" | "running" | "idle" | "needs-approval";
export type TaskFilter = "all" | "queued" | "running" | "approval" | "completed" | "cancelled" | "stalled";
export type IntegrationStatus = AgentOSIntegrationStatus;

export type AgentView = {
  id: string;
  name: string;
  purpose: string;
  status: AgentFilter;
  statusLabel: string;
  statusTone: StatusTone;
  modelLabel: string;
  policyLabel: string;
  workspaceName: string;
  toolsCount: number;
  sessionsCount: number;
  lastActiveLabel: string;
  online: boolean;
  icon: LucideIcon;
  iconTone: StatusTone;
  source?: AgentRecord;
};

export type TaskView = {
  id: string;
  title: string;
  status: Exclude<TaskFilter, "all">;
  statusLabel: string;
  statusTone: StatusTone;
  agentName: string;
  category: string;
  priority: "Low" | "Medium" | "High";
  progress: number;
  dueLabel: string;
  tokenLabel: string;
  objective: string;
  description: string;
  artifactCount: number;
  warningCount: number;
  source?: WorkItemRecord;
};

export type ModelView = {
  id: string;
  name: string;
  provider: string;
  statusLabel: string;
  statusTone: StatusTone;
  latencyLabel: string;
  contextLabel: string;
  costLabel: string;
  rateLimitLabel: string;
  role: "Primary" | "Fallback" | "Secondary" | "Experimental";
  lastActiveLabel: string;
  capabilities: string[];
  source?: ModelRecord;
};

export type IntegrationView = IntegrationState & {
  icon: LucideIcon;
  iconTone: StatusTone;
  statusTone: StatusTone;
};

export type FileView = {
  id: string;
  name: string;
  path: string;
  relativePath: string;
  type: string;
  category: string;
  collection: string;
  updatedLabel: string;
  owner: string;
  workspaceId: string | null;
  workspaceName: string;
  workspacePath: string | null;
  sizeLabel: string;
  sizeBytes: number | null;
  tags: string[];
  tasks: number;
  icon: LucideIcon;
  iconTone: StatusTone;
  source?: WorkspaceManagedFile;
};

const integrationStatusTones: Record<IntegrationStatus, StatusTone> = {
  connected: "success",
  disabled: "muted",
  "pending-setup": "warning",
  failed: "danger",
  "needs-authentication": "warning",
  "missing-credentials": "warning",
  unsupported: "muted",
  unknown: "muted"
};

const integrationIconRegistry: Record<string, { icon: LucideIcon; iconTone: StatusTone }> = {
  telegram: { icon: MessageCircle, iconTone: "info" },
  discord: { icon: MessageCircle, iconTone: "purple" },
  gmail: { icon: Mail, iconTone: "danger" },
  slack: { icon: MessageCircle, iconTone: "success" },
  "google-chat": { icon: MessageCircle, iconTone: "success" },
  email: { icon: Mail, iconTone: "info" },
  notion: { icon: FileText, iconTone: "muted" },
  "google-drive": { icon: HardDrive, iconTone: "warning" },
  github: { icon: Github, iconTone: "muted" },
  linear: { icon: ClipboardList, iconTone: "purple" },
  chrome: { icon: Chrome, iconTone: "warning" },
  webhooks: { icon: Workflow, iconTone: "danger" },
  cron: { icon: Activity, iconTone: "warning" },
  "x-twitter": { icon: BellRing, iconTone: "muted" },
  openrouter: { icon: Puzzle, iconTone: "muted" },
  ollama: { icon: Terminal, iconTone: "muted" }
};

export function scopeMissionControlSnapshot(
  snapshot: MissionControlSnapshot,
  workspaceId: string | null
): MissionControlSnapshot {
  if (!workspaceId) {
    return snapshot;
  }

  const workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);

  if (!workspace) {
    return {
      ...snapshot,
      workspaces: [],
      agents: [],
      tasks: [],
      runtimes: [],
      models: [],
      channelAccounts: [],
      channelRegistry: { ...snapshot.channelRegistry, channels: [] }
    };
  }

  const agents = snapshot.agents.filter((agent) => agent.workspaceId === workspace.id);
  const agentIds = new Set(agents.map((agent) => agent.id));
  const tasks = snapshot.tasks.filter(
    (task) =>
      task.workspaceId === workspace.id ||
      (task.primaryAgentId ? agentIds.has(task.primaryAgentId) : false) ||
      task.agentIds.some((agentId) => agentIds.has(agentId))
  );
  const taskIds = new Set(tasks.map((task) => task.id));
  const taskRuntimeIds = new Set(tasks.flatMap((task) => task.runtimeIds));
  const runtimes = snapshot.runtimes.filter(
    (runtime) =>
      runtime.workspaceId === workspace.id ||
      (runtime.agentId ? agentIds.has(runtime.agentId) : false) ||
      (runtime.taskId ? taskIds.has(runtime.taskId) : false) ||
      taskRuntimeIds.has(runtime.id)
  );
  const modelIds = new Set(
    [
      ...workspace.modelIds,
      ...agents.map((agent) => agent.modelId),
      ...runtimes.map((runtime) => runtime.modelId),
      snapshot.diagnostics.modelReadiness.resolvedDefaultModel,
      snapshot.diagnostics.modelReadiness.defaultModel
    ].filter((modelId): modelId is string => Boolean(modelId))
  );
  const models = snapshot.models.filter((model) => modelIds.has(model.id));
  const channels = snapshot.channelRegistry.channels
    .map((channel) => ({
      ...channel,
      workspaces: channel.workspaces.filter((binding) => binding.workspaceId === workspace.id)
    }))
    .filter((channel) => channel.workspaces.length > 0);
  const channelTypes = new Set(channels.map((channel) => normalizeIntegrationKey(channel.type)));
  const channelAccounts = snapshot.channelAccounts.filter((account) => {
    const key = normalizeIntegrationKey(account.type);
    return channelTypes.has(key) || channelTypes.has(aliasIntegrationKey(key));
  });

  return {
    ...snapshot,
    workspaces: [workspace],
    agents,
    tasks,
    runtimes,
    models,
    channelAccounts,
    channelRegistry: {
      ...snapshot.channelRegistry,
      channels
    }
  };
}

export function buildAgentViews(snapshot: MissionControlSnapshot): AgentView[] {
  if (snapshot.agents.length === 0) {
    return [];
  }

  const referenceMs = resolveRelativeTimeReferenceMs(snapshot.generatedAt);
  const workspaceById = new Map(snapshot.workspaces.map((workspace) => [workspace.id, workspace]));
  const modelById = new Map(snapshot.models.map((model) => [model.id, model]));

  return snapshot.agents.map((agent) => {
    const status = mapAgentStatus(agent);
    const workspaceName = workspaceById.get(agent.workspaceId)?.name ?? agent.workspaceId ?? "Unassigned";
    return {
      id: agent.id,
      name: formatAgentDisplayName(agent),
      purpose: agent.profile.purpose || agent.currentAction || "Not reported",
      status,
      statusLabel: status === "needs-approval" ? "Needs Approval" : status === "running" ? "Running" : toTitleCase(status),
      statusTone: statusToneForAgentFilter(status),
      modelLabel: modelById.get(agent.modelId)?.name || agent.modelId || "Unassigned",
      policyLabel: toTitleCase(agent.policy.preset),
      workspaceName,
      toolsCount: uniqueCount([...(agent.tools || []), ...(agent.observedTools || [])]),
      sessionsCount: agent.sessionCount,
      lastActiveLabel: formatRelativeTime(agent.lastActiveAt, referenceMs),
      online: agent.status !== "offline",
      icon: iconForAgent(agent),
      iconTone: status === "needs-approval" ? "danger" : status === "running" ? "info" : status === "idle" ? "warning" : "success",
      source: agent
    };
  });
}

export function buildTaskViews(snapshot: MissionControlSnapshot): TaskView[] {
  if (snapshot.tasks.length === 0) {
    return [];
  }

  const referenceMs = resolveRelativeTimeReferenceMs(snapshot.generatedAt);

  return snapshot.tasks.map((task) => {
    const status = mapTaskStatus(task);
    const progress = resolveTaskProgress(task, status);
    const fallbackDescription = task.subtitle || task.mission || task.title || task.id;

    return {
      id: task.id,
      title: task.title || task.mission || task.id,
      status,
      statusLabel: resolveTaskStatusLabel(status),
      statusTone: resolveTaskStatusTone(status),
      agentName: task.primaryAgentName || "Unassigned",
      category: readMetadataString(task.metadata, ["category", "type", "source"]) || "Uncategorized",
      priority: inferTaskPriority(task),
      progress,
      dueLabel: readMetadataString(task.metadata, ["dueLabel", "dueAt", "scheduledAt"]) || formatRelativeTime(task.updatedAt, referenceMs),
      tokenLabel: formatTokens(task.tokenUsage?.total),
      objective: task.mission || fallbackDescription,
      description: fallbackDescription,
      artifactCount: task.artifactCount,
      warningCount: task.warningCount,
      source: task
    };
  });
}

export function buildModelViews(snapshot: MissionControlSnapshot): ModelView[] {
  if (snapshot.models.length === 0) {
    return [];
  }

  const defaultModelId = snapshot.diagnostics.modelReadiness.resolvedDefaultModel ?? snapshot.diagnostics.modelReadiness.defaultModel;

  return snapshot.models.map((model) => ({
    id: model.id,
    name: model.name || model.id,
    provider: formatProviderName(model.provider),
    statusLabel: model.local ? "Local" : model.missing || model.available === false ? "Unavailable" : "Healthy",
    statusTone: model.missing || model.available === false ? "danger" : model.local ? "info" : "success",
    latencyLabel: "Not reported",
    contextLabel: formatContextWindow(model.contextWindow),
    costLabel: "Not reported",
    rateLimitLabel: "Not reported",
    role: resolveModelRole(model, defaultModelId),
    lastActiveLabel: model.usageCount > 0 ? `${model.usageCount} use${model.usageCount === 1 ? "" : "s"}` : "Not reported",
    capabilities: buildModelCapabilities(model),
    source: model
  }));
}

export function buildIntegrationViews(snapshot: MissionControlSnapshot): IntegrationView[] {
  return buildIntegrationStates(snapshot).map((entry) => {
    const iconConfig = integrationIconRegistry[entry.id] ?? { icon: Puzzle, iconTone: "muted" as const };
    return {
      ...entry,
      ...iconConfig,
      statusTone: integrationStatusTones[entry.status]
    };
  });
}

export function buildFileViews(
  files: WorkspaceManagedFile[],
  workspace: WorkspaceRecord | null,
  agents: AgentRecord[]
): FileView[] {
  if (files.length === 0) {
    return [];
  }

  return files.map((file) => {
    const collection = collectionForFile(file);
    const ownerAgent = resolveFileOwnerAgent(file, agents);
    return {
      id: `${workspace?.id ?? "global"}:${file.path}`,
      name: file.label,
      path: `/${file.path}`,
      relativePath: file.path,
      type: languageLabel(file.language),
      category: file.category,
      collection,
      updatedLabel: file.exists ? "Not reported" : "Not created",
      owner: ownerAgent ? formatAgentDisplayName(ownerAgent) : "Workspace",
      workspaceId: workspace?.id ?? null,
      workspaceName: workspace?.name ?? "All workspaces",
      workspacePath: workspace?.path ?? null,
      sizeLabel: file.size == null ? "-" : formatBytes(file.size),
      sizeBytes: file.size,
      tags: tagFile(file),
      tasks: 0,
      icon: iconForFile(file.path, file.language),
      iconTone: toneForFile(file),
      source: file
    };
  });
}

export function summarizeTokens(snapshot: MissionControlSnapshot) {
  return snapshot.runtimes.reduce((total, runtime) => total + (runtime.tokenUsage?.total ?? 0), 0);
}

export function formatBigNumber(value: number) {
  if (value >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  }

  return String(value);
}

export function formatBytes(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "-";
  }

  if (value >= 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  if (value >= 1024) {
    return `${Math.round(value / 1024)} KB`;
  }

  return `${value} B`;
}

export function statusToneForAgentFilter(status: AgentFilter): StatusTone {
  if (status === "ready") {
    return "success";
  }

  if (status === "running") {
    return "info";
  }

  if (status === "needs-approval") {
    return "danger";
  }

  if (status === "idle") {
    return "warning";
  }

  return "muted";
}

function mapAgentStatus(agent: AgentRecord): AgentFilter {
  const metadataNeedsApproval =
    agent.currentAction.toLowerCase().includes("approval") ||
    agent.status === "standby" && agent.activeRuntimeIds.length === 0 && agent.heartbeat.enabled;

  if (metadataNeedsApproval) {
    return "needs-approval";
  }

  if (agent.activeRuntimeIds.length > 0 || agent.status === "engaged" || agent.status === "monitoring") {
    return "running";
  }

  if (agent.status === "ready") {
    return "ready";
  }

  return "idle";
}

function mapTaskStatus(task: WorkItemRecord): TaskView["status"] {
  if (task.warningCount > 0 && task.status !== "completed" && task.status !== "cancelled") {
    return "approval";
  }

  if (task.status === "running") {
    return "running";
  }

  if (task.status === "queued" || task.status === "idle") {
    return "queued";
  }

  if (task.status === "completed") {
    return "completed";
  }

  if (task.status === "cancelled") {
    return "cancelled";
  }

  if (task.status === "stalled") {
    return "stalled";
  }

  return "queued";
}

function resolveTaskProgress(task: WorkItemRecord, status: TaskView["status"]) {
  const metadataProgress = readMetadataNumber(task.metadata, ["progress", "progressPercent", "percentComplete"]);
  if (metadataProgress != null) {
    return clampProgress(metadataProgress);
  }

  return status === "completed" ? 100 : 0;
}

function resolveTaskStatusLabel(status: TaskView["status"]) {
  if (status === "approval") {
    return "Awaiting Approval";
  }

  if (status === "queued") {
    return "Queued";
  }

  return toTitleCase(status);
}

function resolveTaskStatusTone(status: TaskView["status"]): StatusTone {
  if (status === "completed") {
    return "success";
  }

  if (status === "running") {
    return "info";
  }

  if (status === "approval" || status === "stalled") {
    return "warning";
  }

  if (status === "cancelled") {
    return "danger";
  }

  return "muted";
}

function inferTaskPriority(task: WorkItemRecord): TaskView["priority"] {
  const raw = readMetadataString(task.metadata, ["priority"]);
  if (raw && /high/i.test(raw)) {
    return "High";
  }

  if (raw && /low/i.test(raw)) {
    return "Low";
  }

  if (task.warningCount > 0 || task.liveRunCount > 1) {
    return "High";
  }

  return task.runtimeCount > 1 ? "Medium" : "Low";
}

function iconForAgent(agent: AgentRecord): LucideIcon {
  if (agent.policy.preset === "browser" || /browser|web/i.test(agent.name)) {
    return Globe2;
  }

  if (agent.policy.preset === "monitoring") {
    return Activity;
  }

  if (agent.policy.preset === "setup") {
    return Code2;
  }

  return Bot;
}

function readMetadataString(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readMetadataNumber(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function clampProgress(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function uniqueCount(values: string[]) {
  return new Set(values.filter(Boolean)).size;
}

function formatProviderName(value: string) {
  if (!value) {
    return "Unknown";
  }

  if (value === "openai") {
    return "OpenAI";
  }

  if (value === "openrouter") {
    return "OpenRouter";
  }

  return toTitleCase(value.replace(/[-_]/g, " "));
}

function resolveModelRole(model: ModelRecord, defaultModelId: string | null | undefined): ModelView["role"] {
  const tags = new Set(model.tags.map((tag) => tag.toLowerCase()));

  if (model.id === defaultModelId || tags.has("default") || tags.has("primary")) {
    return "Primary";
  }

  if (tags.has("fallback")) {
    return "Fallback";
  }

  if (tags.has("experimental") || tags.has("preview") || tags.has("beta")) {
    return "Experimental";
  }

  return "Secondary";
}

function buildModelCapabilities(model: ModelRecord) {
  const capabilities = model.input
    .split(/[+,/|]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => (entry === "image" ? "Vision" : toTitleCase(entry)));

  capabilities.push(...model.tags.map(toTitleCase));

  return Array.from(new Set(capabilities));
}

function normalizeIntegrationKey(value: string) {
  const normalized = value.toLowerCase().replace(/_/g, "-");

  if (normalized === "webhook") {
    return "webhooks";
  }

  if (normalized === "googlechat") {
    return "google-chat";
  }

  if (normalized === "browser") {
    return "chrome";
  }

  if (normalized === "x" || normalized === "twitter") {
    return "x-twitter";
  }

  return normalized;
}

function aliasIntegrationKey(value: string) {
  if (value === "google-drive") {
    return "drive";
  }

  if (value === "x-twitter") {
    return "twitter";
  }

  return value;
}

function collectionForFile(file: WorkspaceManagedFile) {
  if (file.category === "memory") {
    return "Memory";
  }

  if (file.category === "context" || file.category === "identity" || file.category === "tools" || file.category === "boot") {
    return "Core Knowledge";
  }

  if (file.category === "project-config" || file.category === "agent-policy-config") {
    return "Core Knowledge";
  }

  if (file.category === "skills") {
    return "Generated Outputs";
  }

  return "All Files";
}

function languageLabel(language: WorkspaceManagedFile["language"]) {
  return language === "json" ? "JSON" : "Markdown";
}

function iconForFile(filePath: string, language: WorkspaceManagedFile["language"]): LucideIcon {
  if (filePath.endsWith(".json")) {
    return FileJson;
  }

  if (filePath.endsWith(".csv")) {
    return FileSpreadsheet;
  }

  if (filePath.endsWith(".zip")) {
    return FileArchive;
  }

  if (filePath.endsWith("/")) {
    return Folder;
  }

  return language === "json" ? FileJson : FileText;
}

function toneForFile(file: WorkspaceManagedFile): StatusTone {
  if (!file.exists) {
    return "muted";
  }

  if (file.category === "memory") {
    return "purple";
  }

  if (file.category === "project-config" || file.category === "agent-policy-config") {
    return "warning";
  }

  return "info";
}

function tagFile(file: WorkspaceManagedFile) {
  const tags = [file.category.replace("-config", ""), file.source];
  if (!file.editable) {
    tags.push("read-only");
  }

  return tags.slice(0, 3);
}

function resolveFileOwnerAgent(file: WorkspaceManagedFile, agents: AgentRecord[]) {
  const profileMatch = /^agents\/([^/]+)\/PROFILE\.md$/.exec(file.path);
  const agentProfileOwner = profileMatch?.[1]
    ? agents.find((agent) => agent.id === profileMatch[1])
    : null;

  if (agentProfileOwner) {
    return agentProfileOwner;
  }

  const agentDirMatch = /^\.openclaw\/agents\/([^/]+)\/agent\//.exec(file.path);
  const agentDirOwner = agentDirMatch?.[1]
    ? agents.find((agent) => agent.id === agentDirMatch[1])
    : null;

  if (agentDirOwner) {
    return agentDirOwner;
  }

  return agents.find((agent) => file.path === `skills/${buildAgentPolicySkillId(agent.id)}/SKILL.md`) ?? null;
}

function buildAgentPolicySkillId(agentId: string) {
  return `agent-policy-${slugify(agentId) || "agent"}`;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function toTitleCase(value: string) {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export const agentStatusIcons: Record<AgentFilter, LucideIcon> = {
  all: Bot,
  ready: CircleCheck,
  running: Activity,
  idle: CirclePause,
  "needs-approval": ShieldCheck
};

export const taskStatusIcons: Record<TaskView["status"], LucideIcon> = {
  queued: CircleDashed,
  running: Zap,
  approval: ClipboardCheck,
  completed: CircleCheck,
  cancelled: XCircle,
  stalled: CirclePause
};

export const integrationStatusIcons: Record<IntegrationStatus, LucideIcon> = {
  connected: CircleCheck,
  disabled: Archive,
  "pending-setup": CircleDashed,
  failed: XCircle,
  "needs-authentication": ShieldCheck,
  "missing-credentials": ShieldCheck,
  unsupported: Archive,
  unknown: CircleDashed
};

export const fileCollectionIcons: Record<string, LucideIcon> = {
  "All Files": Folder,
  "Core Knowledge": FileText,
  Memory: BrainCircuit,
  "Generated Outputs": Sparkles,
  Reports: ClipboardList,
  Screenshots: HardDrive,
  Datasets: Database,
  Campaigns: BellRing,
  Archived: Archive,
  Trash: XCircle
};
