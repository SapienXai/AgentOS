import "server-only";

import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { getMissionControlSnapshot } from "@/lib/openclaw/application/mission-control-service";
import {
  listWorkspaceManagedFiles,
  readWorkspaceManagedFile,
  writeWorkspaceManagedFile
} from "@/lib/openclaw/application/workspace-file-service";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  resolveAgentModelLabel
} from "@/lib/openclaw/presenters";
import {
  getAgentPresetMeta,
  resolveAgentPolicy
} from "@/lib/openclaw/agent-presets";
import type {
  ContextEngineFile,
  ContextEngineFileOwner,
  ContextEngineFileReadResponse,
  ContextEngineSaveInput,
  ContextEnginePolicySnapshot,
  ContextEngineBudget,
  ContextEngineBudgetItem,
  ContextEngineCapabilities,
  ContextEngineConfiguration,
  ContextEngineRuntimeFile,
  ContextEngineRuntimeReport,
  ContextEngineRuntimeReportSource,
  ContextEngineTokenSource,
  ContextEngineSnapshot
} from "@/lib/openclaw/context-engine-types";
import type { OpenClawAgent, RuntimeRecord } from "@/lib/openclaw/types";
import type { WorkspaceManagedFile } from "@/lib/openclaw/workspace-file-types";

type RuntimeReportCandidate = {
  session: Record<string, unknown>;
  report: Record<string, unknown>;
  source: ContextEngineRuntimeReportSource;
};

type StoredContextEngineConfig = {
  version?: number;
  agents?: Record<string, StoredAgentContextConfig>;
};

type StoredAgentContextConfig = {
  files?: Record<string, { enabled?: boolean }>;
  updatedAt?: string | null;
};

type StoredContextEngineConfigRead = {
  config: StoredContextEngineConfig;
  status: ContextEngineConfiguration["persistenceStatus"];
  warning: string | null;
};

export async function getAgentContextEngineSnapshot(agentId: string): Promise<ContextEngineSnapshot> {
  const snapshot = await getMissionControlSnapshot({ includeHidden: true });
  const normalizedAgentId = agentId.trim();
  const agent = snapshot.agents.find((entry) => entry.id === normalizedAgentId);

  if (!agent) {
    throw new Error("Agent was not found.");
  }

  const workspace = snapshot.workspaces.find((entry) => entry.id === agent.workspaceId);

  if (!workspace) {
    throw new Error("Agent workspace was not found.");
  }

  const workspaceFiles = await listWorkspaceManagedFiles(workspace.id);
  const configuration = await readContextEngineConfiguration(workspace.path, workspace.id, agent.id);
  const runtimeCandidate = await findLatestOpenClawContextReport(agent.id);
  const agentRuntimes = snapshot.runtimes.filter((runtime) => runtime.agentId === agent.id);
  const latestRuntime = agentRuntimes.toSorted(sortRuntimeByRecency)[0] ?? null;
  const runtimeReport = runtimeCandidate
    ? normalizeOpenClawContextReport(runtimeCandidate)
    : buildDegradedRuntimeReport(agent, latestRuntime);
  const model = snapshot.models.find((entry) => entry.id === agent.modelId) ?? null;
  const visibleWorkspaceFiles = filterContextEngineFilesForAgent(workspaceFiles.files, agent.id);
  const files = visibleWorkspaceFiles.map((file) =>
    decorateContextEngineFile(file, agent.id, runtimeReport.injectedFiles, configuration)
  );
  const policy = buildPolicySnapshot(agent);
  const budget = buildContextBudget(files, runtimeReport, policy, model?.contextWindow ?? null);
  const capabilities = buildContextEngineCapabilities();
  const preview = buildContextPreview(files, runtimeReport, policy, budget);

  return {
    agent,
    workspace,
    model: {
      id: agent.modelId || null,
      label: resolveAgentModelLabel(agent.modelId, snapshot.models),
      provider: model?.provider ?? null,
      contextWindow: model?.contextWindow ?? null
    },
    sessionCount: agent.sessionCount,
    runtimeCount: agentRuntimes.length,
    files,
    budget,
    policy,
    runtimeReport,
    preview,
    configuration,
    capabilities,
    diagnostics: [
      ...runtimeReport.diagnostics,
      ...budget.diagnostics,
      ...(runtimeReport.status === "degraded"
        ? ["Exact model context is only shown when OpenClaw exposes a session system prompt report."]
        : [])
    ],
    maxFileBytes: workspaceFiles.maxFileBytes
  };
}

export async function readAgentContextEngineFile(input: {
  agentId: string;
  path: string;
}): Promise<ContextEngineFileReadResponse> {
  const { agent, workspace, runtimeReport, configuration } = await resolveAgentAndRuntimeReport(input.agentId);
  const visiblePath = await assertContextEngineFileVisibleForAgent(workspace.id, agent.id, input.path);
  const response = await readWorkspaceManagedFile({
    workspaceId: workspace.id,
    path: visiblePath
  });

  return {
    ...response,
    file: decorateContextEngineFile(response.file, agent.id, runtimeReport.injectedFiles, configuration)
  };
}

export async function writeAgentContextEngineFile(input: {
  agentId: string;
  path: string;
  content: string;
}): Promise<ContextEngineFileReadResponse> {
  const { agent, workspace, runtimeReport, configuration } = await resolveAgentAndRuntimeReport(input.agentId);
  const visiblePath = await assertContextEngineFileVisibleForAgent(workspace.id, agent.id, input.path);
  const response = await writeWorkspaceManagedFile({
    workspaceId: workspace.id,
    path: visiblePath,
    content: input.content
  });

  return {
    ...response,
    file: decorateContextEngineFile(response.file, agent.id, runtimeReport.injectedFiles, configuration)
  };
}

export async function saveAgentContextEngineConfiguration(input: {
  agentId: string;
  configuration: ContextEngineSaveInput;
}): Promise<ContextEngineSnapshot> {
  const snapshot = await getMissionControlSnapshot({ includeHidden: true });
  const agent = snapshot.agents.find((entry) => entry.id === input.agentId.trim());

  if (!agent) {
    throw new Error("Agent was not found.");
  }

  const workspace = snapshot.workspaces.find((entry) => entry.id === agent.workspaceId);
  if (!workspace) {
    throw new Error("Agent workspace was not found.");
  }

  const workspaceFiles = await listWorkspaceManagedFiles(workspace.id);
  const allowedPaths = new Set(filterContextEngineFilesForAgent(workspaceFiles.files, agent.id).map((file) => file.path));
  const nextFiles = input.configuration.files
    .filter((file) => allowedPaths.has(file.path))
    .map((file) => ({
      path: file.path,
      enabled: Boolean(file.enabled)
    }));

  await writeContextEngineConfiguration(workspace.path, agent.id, nextFiles);

  return getAgentContextEngineSnapshot(agent.id);
}

export function decorateContextEngineFile(
  file: WorkspaceManagedFile,
  agentId: string,
  runtimeFiles: ContextEngineRuntimeFile[] = [],
  configuration?: ContextEngineConfiguration
): ContextEngineFile {
  const owner = classifyContextEngineFileOwner(file);
  const runtimeFile = runtimeFiles.find((entry) => normalizeReportPath(entry.path) === normalizeReportPath(file.path));
  const selectedAgentProfilePath = `agents/${agentId}/PROFILE.md`;
  const configuredEnabled = configuration?.files.find((entry) => entry.path === file.path)?.enabled;
  const defaultEnabled = file.exists && file.editable !== false;
  const enabled = file.exists ? configuredEnabled ?? defaultEnabled : false;
  const status = resolveFileStatus(file, enabled, runtimeFile);
  const rawTokens = estimateTokensFromFile(file);
  const injectedTokens = enabled ? runtimeFile?.tokens ?? rawTokens : 0;
  const tokenSource: ContextEngineTokenSource = runtimeFile?.tokens != null ? "reported" : rawTokens != null ? "estimated" : "unknown";

  return {
    ...file,
    owner,
    ownerLabel: contextEngineOwnerLabels[owner],
    selectedAgentOwned: file.path === selectedAgentProfilePath || owner === "agent-policy",
    enabled,
    savedEnabled: enabled,
    canToggle: file.exists && file.editable !== false,
    status,
    statusReason: resolveFileStatusReason(file, status),
    scope: resolveFileScope(owner),
    rawTokens,
    injectedTokens,
    tokenSource,
    lastUpdatedAt: null,
    runtimeIncluded: Boolean(runtimeFile),
    runtimeTokenEstimate: runtimeFile?.tokens ?? null,
    preferenceSource: configuredEnabled === undefined ? "default" : "agentos-sidecar",
    runtimeInclusionSource: runtimeFile ? "openclaw-report" : "unreported"
  };
}

export function filterContextEngineFilesForAgent(files: WorkspaceManagedFile[], agentId: string) {
  return files.filter((file) => isContextEngineFileVisibleForAgent(file, agentId));
}

export function isContextEngineFileVisibleForAgent(file: WorkspaceManagedFile, agentId: string) {
  const owner = classifyContextEngineFileOwner(file);

  if (owner === "agent-profile") {
    return file.path === `agents/${agentId}/PROFILE.md`;
  }

  if (owner === "agent-policy") {
    const policySkillId = `agent-policy-${slugifyAgentId(agentId) || "agent"}`;

    return file.path.split("/").includes(policySkillId);
  }

  return true;
}

export function classifyContextEngineFileOwner(
  file: Pick<WorkspaceManagedFile, "path" | "category" | "source">
): ContextEngineFileOwner {
  if (/^agents\/[^/]+\/PROFILE\.md$/.test(file.path)) {
    return "agent-profile";
  }

  if (file.category === "agent-policy-config" || /(^|\/)agent-policy[-_/]/i.test(file.path)) {
    return "agent-policy";
  }

  if (file.category === "skills" || file.path.endsWith("/SKILL.md")) {
    return "workspace-skill";
  }

  if (file.category === "memory" || file.path === "MEMORY.md" || file.path.startsWith("memory/")) {
    return "memory";
  }

  if (file.path.startsWith(".openclaw/runtime/") || file.path.startsWith("runtime/")) {
    return "generated-runtime-output";
  }

  return "workspace-global";
}

function resolveFileStatus(
  file: WorkspaceManagedFile,
  enabled: boolean,
  runtimeFile: ContextEngineRuntimeFile | undefined
): ContextEngineFile["status"] {
  if (!file.exists) {
    return "missing";
  }

  if (!file.editable && file.reason) {
    return "error";
  }

  if (!enabled) {
    return "disabled";
  }

  if (runtimeFile?.truncated) {
    return "truncated";
  }

  return "enabled";
}

function resolveFileStatusReason(file: WorkspaceManagedFile, status: ContextEngineFile["status"]) {
  if (status === "missing") {
    return file.createable
      ? "The file is allowlisted but does not exist yet. Create it before enabling it."
      : "The file is allowlisted but missing and cannot be created from this surface.";
  }

  if (status === "disabled") {
    return "This file is saved as excluded in the AgentOS Context Engine configuration.";
  }

  if (status === "truncated") {
    return "OpenClaw reported this file as truncated in the runtime context.";
  }

  if (status === "error") {
    return file.reason ?? "This file cannot be included from this surface.";
  }

  return undefined;
}

function resolveFileScope(owner: ContextEngineFileOwner): ContextEngineFile["scope"] {
  if (owner === "agent-profile" || owner === "agent-policy") {
    return "agent";
  }

  if (owner === "generated-runtime-output") {
    return "session";
  }

  return "workspace";
}

function estimateTokensFromFile(file: WorkspaceManagedFile) {
  if (!file.exists || typeof file.size !== "number") {
    return null;
  }

  return Math.max(1, Math.ceil(file.size / 4));
}

function buildContextBudget(
  files: ContextEngineFile[],
  runtimeReport: ContextEngineRuntimeReport,
  policy: ContextEnginePolicySnapshot,
  limit: number | null
): ContextEngineBudget {
  const systemTokens = charsToTokens(runtimeReport.systemPromptChars);
  const fileProjectTokens = sumKnownTokens(
    files
      .filter((file) => file.enabled && isProjectBudgetFile(file))
      .map((file) => file.injectedTokens)
  );
  const reportedProjectTokens = charsToTokens(runtimeReport.projectContextChars);
  const projectTokens = reportedProjectTokens ?? fileProjectTokens;
  const fileSkillsTokens = sumKnownTokens(
    files
      .filter((file) => file.enabled && isSkillBudgetFile(file))
      .map((file) => file.injectedTokens)
  );
  const fileToolsTokens = sumKnownTokens(
    files
      .filter((file) => file.enabled && isToolBudgetFile(file))
      .map((file) => file.injectedTokens)
  );
  const estimatedSkillTokens = estimateCollectionTokens(policy.effectiveSkills, 80);
  const estimatedToolTokens = estimateCollectionTokens(policy.effectiveTools, 160);
  const skillsTokens = charsToTokens(runtimeReport.skillsPromptChars) ?? sumKnownTokens([fileSkillsTokens, estimatedSkillTokens]);
  const toolsTokens = charsToTokens(runtimeReport.toolsSchemaChars) ?? sumKnownTokens([fileToolsTokens, estimatedToolTokens]);
  const knownWithoutHistory = sumKnownTokens([systemTokens, projectTokens, skillsTokens, toolsTokens]);
  const historyTokens =
    typeof runtimeReport.totalTokens === "number" && knownWithoutHistory !== null
      ? Math.max(0, runtimeReport.totalTokens - knownWithoutHistory)
      : null;
  const attachmentsTokens = null;
  const items: ContextEngineBudgetItem[] = [
    { id: "system", label: "System Prompt", tokens: systemTokens, source: systemTokens == null ? "unknown" : runtimeReport.status === "exact" ? "reported" : "estimated" },
    { id: "project", label: "Project Context", tokens: projectTokens, source: reportedProjectTokens == null ? projectTokens == null ? "unknown" : "estimated" : "reported" },
    { id: "skills", label: "Skills", tokens: skillsTokens, source: runtimeReport.skillsPromptChars == null ? skillsTokens == null ? "unknown" : "estimated" : "reported" },
    { id: "tools", label: "Tools", tokens: toolsTokens, source: runtimeReport.toolsSchemaChars == null ? toolsTokens == null ? "unknown" : "estimated" : "reported" },
    { id: "history", label: "History", tokens: historyTokens, source: historyTokens == null ? "unknown" : "reported" },
    { id: "attachments", label: "Attachments", tokens: attachmentsTokens, source: "unknown" }
  ];
  const itemTotal = sumKnownTokens(items.map((item) => item.tokens));
  const usedTokens = runtimeReport.totalTokens ?? itemTotal;
  const usedSource: ContextEngineTokenSource = runtimeReport.totalTokens == null ? "estimated" : "reported";
  const usedPercent =
    typeof usedTokens === "number" && typeof limit === "number" && limit > 0
      ? Math.min(100, Math.round((usedTokens / limit) * 100))
      : null;

  return {
    limit,
    usedTokens,
    usedSource,
    usedPercent,
    items,
    diagnostics: [
      ...(runtimeReport.status === "exact" ? [] : ["Budget values are estimated because OpenClaw did not expose an exact context report."]),
      "Attachments and compaction summaries are shown only when OpenClaw exposes them."
    ]
  };
}

function buildContextPreview(
  files: ContextEngineFile[],
  runtimeReport: ContextEngineRuntimeReport,
  policy: ContextEnginePolicySnapshot,
  budget: ContextEngineBudget
) {
  const activeFiles = files
    .filter((file) => file.enabled && file.exists && isProjectContextFile(file))
    .map((file) => ({
      path: file.path,
      label: file.label,
      status: file.status,
      tokens: file.injectedTokens,
      source: file.tokenSource
    }));

  return {
    source: runtimeReport.status === "exact" ? "openclaw-report" as const : "agentos-estimate" as const,
    status: runtimeReport.status === "exact" ? "exact" as const : "estimated" as const,
    systemPromptSummary:
      runtimeReport.systemPromptChars != null
        ? `OpenClaw reported ${runtimeReport.systemPromptChars.toLocaleString()} system prompt characters.`
        : "OpenClaw did not expose the exact system prompt body to AgentOS.",
    activeFiles,
    skills: policy.effectiveSkills,
    tools: policy.effectiveTools,
    historySummary:
      runtimeReport.sessionId || runtimeReport.sessionKey
        ? "Recent session context is represented by the latest OpenClaw session report when available."
        : "No recent session context report is available.",
    attachmentsSummary: "Attachment context is not exposed by the current OpenClaw gateway methods.",
    totalTokens: budget.usedTokens,
    diagnostics: runtimeReport.diagnostics
  };
}

function buildContextEngineCapabilities(): ContextEngineCapabilities {
  return {
    compaction: {
      supported: false,
      method: "unsupported",
      reason: "OpenClaw does not currently expose a native context compaction method through the AgentOS adapter."
    },
    nativeFileToggles: {
      supported: false,
      reason: "OpenClaw loads workspace context files natively, but does not yet expose a file include/exclude API. AgentOS persists the operator configuration separately."
    }
  };
}

export function normalizeOpenClawContextReport(candidate: RuntimeReportCandidate): ContextEngineRuntimeReport {
  const session = candidate.session;
  const report = candidate.report;
  const promptSizes = readObject(report.promptSizes) ?? readObject(report.sizes) ?? readObject(report.stats);
  const source = readString(report.source) ?? readString(session.origin) ?? null;
  const injectedFiles = readRuntimeFiles(report);
  const truncationNotes = readStringArray(report.truncationNotes)
    .concat(readStringArray(report.truncatedFiles))
    .concat(readStringArray(report.warnings));
  const truncationOccurred =
    readBoolean(report.truncated) ??
    readBoolean(report.hasTruncation) ??
    injectedFiles.some((file) => file.truncated === true) ??
    false;

  return {
    source: candidate.source,
    status: "exact",
    sessionId: readString(session.sessionId) ?? readString(session.id) ?? null,
    sessionKey: readString(session.key) ?? readString(session.sessionKey) ?? null,
    updatedAt: readNumber(session.updatedAt),
    model: readString(session.model) ?? readString(report.model) ?? null,
    systemPromptChars: readNumber(report.systemPromptChars) ?? readNumber(promptSizes?.systemPromptChars),
    projectContextChars:
      readNumber(report.projectContextChars) ??
      readNumber(promptSizes?.projectContextChars) ??
      readNumber(promptSizes?.injectedWorkspaceFilesChars),
    toolsSchemaChars: readNumber(report.toolsSchemaChars) ?? readNumber(promptSizes?.toolsSchemaChars),
    skillsPromptChars: readNumber(report.skillsPromptChars) ?? readNumber(promptSizes?.skillsPromptChars),
    totalTokens: readNumber(session.totalTokens) ?? readNumber(report.totalTokens),
    inputTokens: readNumber(session.inputTokens) ?? readNumber(report.inputTokens),
    outputTokens: readNumber(session.outputTokens) ?? readNumber(report.outputTokens),
    cacheReadTokens: readNumber(session.cacheRead) ?? readNumber(report.cacheReadTokens),
    injectedFiles,
    truncation: {
      occurred: Boolean(truncationOccurred),
      notes: uniqueStrings(truncationNotes)
    },
    diagnostics: [
      `OpenClaw context report source: ${source ?? candidate.source}.`
    ]
  };
}

function buildDegradedRuntimeReport(
  agent: OpenClawAgent,
  latestRuntime: RuntimeRecord | null
): ContextEngineRuntimeReport {
  return {
    source: "degraded-estimate",
    status: "degraded",
    sessionId: latestRuntime?.sessionId ?? null,
    sessionKey: null,
    updatedAt: latestRuntime?.updatedAt ?? null,
    model: agent.modelId || null,
    systemPromptChars: null,
    projectContextChars: null,
    toolsSchemaChars: null,
    skillsPromptChars: null,
    totalTokens: latestRuntime?.tokenUsage?.total ?? null,
    inputTokens: latestRuntime?.tokenUsage?.input ?? null,
    outputTokens: latestRuntime?.tokenUsage?.output ?? null,
    cacheReadTokens: null,
    injectedFiles: [],
    truncation: {
      occurred: false,
      notes: []
    },
    diagnostics: [
      "OpenClaw did not expose a system prompt report for the latest agent session."
    ]
  };
}

async function resolveAgentAndRuntimeReport(agentId: string) {
  const snapshot = await getMissionControlSnapshot({ includeHidden: true });
  const agent = snapshot.agents.find((entry) => entry.id === agentId.trim());

  if (!agent) {
    throw new Error("Agent was not found.");
  }

  const workspace = snapshot.workspaces.find((entry) => entry.id === agent.workspaceId);
  if (!workspace) {
    throw new Error("Agent workspace was not found.");
  }

  const configuration = await readContextEngineConfiguration(workspace.path, workspace.id, agent.id);
  const runtimeCandidate = await findLatestOpenClawContextReport(agent.id);
  const runtimeReport = runtimeCandidate
    ? normalizeOpenClawContextReport(runtimeCandidate)
    : buildDegradedRuntimeReport(agent, null);

  return { agent, workspace, runtimeReport, configuration };
}

async function assertContextEngineFileVisibleForAgent(
  workspaceId: string,
  agentId: string,
  requestedPath: string
) {
  const workspaceFiles = await listWorkspaceManagedFiles(workspaceId);
  const normalizedRequestedPath = normalizeReportPath(requestedPath);
  const file = filterContextEngineFilesForAgent(workspaceFiles.files, agentId).find(
    (entry) => entry.path === normalizedRequestedPath
  );

  if (!file) {
    throw new Error("Context file is not available for this agent.");
  }

  return file.path;
}

async function readContextEngineConfiguration(
  workspacePath: string,
  workspaceId: string,
  agentId: string
): Promise<ContextEngineConfiguration> {
  const stored = await readStoredContextEngineConfig(workspacePath);
  const storedConfig = stored.config;
  const agentConfig = storedConfig.agents?.[agentId] ?? {};

  return {
    version: 1,
    agentId,
    workspaceId,
    source: "agentos-sidecar",
    storagePath: ".openclaw/context-engine.json",
    persistenceStatus: stored.status,
    persistenceWarning: stored.warning,
    files: Object.entries(agentConfig.files ?? {}).flatMap(([filePath, value]) =>
      typeof value.enabled === "boolean"
        ? [
            {
              path: filePath,
              enabled: value.enabled
            }
          ]
        : []
    ),
    updatedAt: agentConfig.updatedAt ?? null
  };
}

async function writeContextEngineConfiguration(
  workspacePath: string,
  agentId: string,
  files: Array<{ path: string; enabled: boolean }>
) {
  const stored = await readStoredContextEngineConfig(workspacePath);
  const nextAgents = {
    ...(stored.config.agents ?? {})
  };
  const now = new Date().toISOString();

  nextAgents[agentId] = {
    files: Object.fromEntries(files.map((file) => [file.path, { enabled: file.enabled }])),
    updatedAt: now
  };

  await writeStoredContextEngineConfig(workspacePath, {
    version: 1,
    agents: nextAgents
  });
}

async function readStoredContextEngineConfig(workspacePath: string): Promise<StoredContextEngineConfigRead> {
  const configPath = resolveContextEngineConfigPath(workspacePath);

  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);

    if (!readObject(parsed)) {
      return {
        config: { version: 1, agents: {} },
        status: "recovered",
        warning: "AgentOS could not read the saved Context Engine preferences, so it is using defaults until the next save."
      };
    }

    return {
      config: normalizeStoredContextEngineConfig(parsed),
      status: "loaded",
      warning: null
    };
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {
        config: { version: 1, agents: {} },
        status: "missing",
        warning: null
      };
    }

    return {
      config: { version: 1, agents: {} },
      status: "recovered",
      warning: "AgentOS could not read the saved Context Engine preferences, so it is using defaults until the next save."
    };
  }
}

async function writeStoredContextEngineConfig(workspacePath: string, config: StoredContextEngineConfig) {
  const configPath = resolveContextEngineConfigPath(workspacePath);
  const tempPath = `${configPath}.${process.pid}.${Date.now()}.tmp`;

  await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFile(tempPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(tempPath, 0o600).catch(() => undefined);
  await rename(tempPath, configPath);
  await chmod(configPath, 0o600).catch(() => undefined);
}

function resolveContextEngineConfigPath(workspacePath: string) {
  return path.join(workspacePath, ".openclaw", "context-engine.json");
}

export function resolveContextEngineConfigPathForTesting(workspacePath: string) {
  return resolveContextEngineConfigPath(workspacePath);
}

export function readContextEngineConfigurationForTesting(
  workspacePath: string,
  workspaceId: string,
  agentId: string
) {
  return readContextEngineConfiguration(workspacePath, workspaceId, agentId);
}

export function writeContextEngineConfigurationForTesting(
  workspacePath: string,
  agentId: string,
  files: Array<{ path: string; enabled: boolean }>
) {
  return writeContextEngineConfiguration(workspacePath, agentId, files);
}

function normalizeStoredContextEngineConfig(value: Record<string, unknown>): StoredContextEngineConfig {
  const agents = readObject(value.agents);
  const normalizedAgents: Record<string, StoredAgentContextConfig> = {};

  if (agents) {
    for (const [agentId, rawAgentConfig] of Object.entries(agents)) {
      const agentConfig = readObject(rawAgentConfig);
      const files = readObject(agentConfig?.files);

      normalizedAgents[agentId] = {
        files: files
          ? Object.fromEntries(
              Object.entries(files).flatMap(([filePath, rawFileConfig]) => {
                const fileConfig = readObject(rawFileConfig);
                return typeof fileConfig?.enabled === "boolean"
                  ? [[filePath, { enabled: fileConfig.enabled }]]
                  : [];
              })
            )
          : {},
        updatedAt: readString(agentConfig?.updatedAt)
      };
    }
  }

  return {
    version: 1,
    agents: normalizedAgents
  };
}

function isFileNotFoundError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

async function findLatestOpenClawContextReport(agentId: string): Promise<RuntimeReportCandidate | null> {
  try {
    const payload = await getOpenClawAdapter().listSessions(
      {
        agentId,
        limit: 10,
        includeLastMessage: false,
        includeDerivedTitles: false
      },
      { timeoutMs: 8_000 }
    );
    const sessions = Array.isArray(payload.sessions) ? payload.sessions : [];

    for (const session of sessions.toSorted(sortSessionByRecency)) {
      const report = readObject(session.systemPromptReport) ?? readObject(session.contextReport);

      if (report) {
        return {
          session,
          report,
          source: "openclaw-session-report"
        };
      }

      const described = await describeSessionForContextReport(session, agentId);
      if (described) {
        return described;
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function describeSessionForContextReport(
  session: Record<string, unknown>,
  agentId: string
): Promise<RuntimeReportCandidate | null> {
  const sessionKey = readString(session.key) ?? readString(session.sessionKey);
  const sessionId = readString(session.sessionId) ?? readString(session.id);

  if (!sessionKey && !sessionId) {
    return null;
  }

  try {
    const payload = await getOpenClawAdapter().describeSession(
      buildDescribeSessionInput(agentId, sessionKey, sessionId),
      { timeoutMs: 8_000 }
    );
    const describedSession = readObject(payload.session) ?? payload;
    const report = readObject(describedSession.systemPromptReport) ?? readObject(describedSession.contextReport);

    if (!report) {
      return null;
    }

    return {
      session: {
        ...session,
        ...describedSession
      },
      report,
      source: "openclaw-session-describe"
    };
  } catch {
    return null;
  }
}

function buildDescribeSessionInput(agentId: string, sessionKey: string | null, sessionId: string | null) {
  return {
    agentId,
    ...(sessionKey ? { key: sessionKey, sessionKey } : {}),
    ...(sessionId ? { sessionId } : {})
  };
}

function buildPolicySnapshot(agent: OpenClawAgent): ContextEnginePolicySnapshot {
  const policy = resolveAgentPolicy(agent.policy.preset, agent.policy);
  const presetMeta = getAgentPresetMeta(policy.preset);
  const declaredTools = agent.tools.filter((tool) => tool !== "fs.workspaceOnly");
  const declaredSkills = agent.skills;

  return {
    preset: policy.preset,
    missingToolBehavior: policy.missingToolBehavior,
    installScope: policy.installScope,
    fileAccess: policy.fileAccess,
    networkAccess: policy.networkAccess,
    declaredSkills,
    effectiveSkills: declaredSkills.length > 0 ? declaredSkills : presetMeta.skillIds,
    declaredTools,
    effectiveTools: declaredTools.length > 0 ? declaredTools : presetMeta.tools,
    observedTools: agent.observedTools ?? [],
    heartbeatEnabled: agent.heartbeat.enabled
  };
}

function readRuntimeFiles(report: Record<string, unknown>) {
  const fileValues =
    readArray(report.injectedWorkspaceFiles) ??
    readArray(report.injectedFiles) ??
    readArray(report.files) ??
    [];

  return fileValues
    .map((entry): ContextEngineRuntimeFile | null => {
      if (typeof entry === "string") {
        return {
          path: entry
        };
      }

      const object = readObject(entry);
      const filePath =
        readString(object?.path) ??
        readString(object?.relativePath) ??
        readString(object?.filePath) ??
        readString(object?.name);

      if (!filePath) {
        return null;
      }

      return {
        path: filePath,
        label: readString(object?.label) ?? readString(object?.name),
        chars: readNumber(object?.chars) ?? readNumber(object?.size),
        tokens: readNumber(object?.tokens),
        truncated: readBoolean(object?.truncated) ?? undefined
      };
    })
    .filter((entry): entry is ContextEngineRuntimeFile => entry !== null);
}

function sortSessionByRecency(left: Record<string, unknown>, right: Record<string, unknown>) {
  return (readNumber(right.updatedAt) ?? 0) - (readNumber(left.updatedAt) ?? 0);
}

function sortRuntimeByRecency(left: RuntimeRecord, right: RuntimeRecord) {
  return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
}

function isProjectContextFile(file: ContextEngineFile) {
  return file.owner === "workspace-global" || file.owner === "agent-profile" || file.owner === "agent-policy" || file.owner === "memory";
}

function isProjectBudgetFile(file: ContextEngineFile) {
  return (
    (file.owner === "workspace-global" || file.owner === "agent-profile" || file.owner === "memory") &&
    !isToolBudgetFile(file)
  );
}

function isSkillBudgetFile(file: ContextEngineFile) {
  return file.owner === "workspace-skill" || file.owner === "agent-policy";
}

function isToolBudgetFile(file: ContextEngineFile) {
  return file.path === "TOOLS.md";
}

function charsToTokens(value: number | null | undefined) {
  return typeof value === "number" ? Math.max(1, Math.ceil(value / 4)) : null;
}

function estimateCollectionTokens(values: string[], perItem: number) {
  return values.length > 0 ? values.length * perItem : 0;
}

function sumKnownTokens(values: Array<number | null | undefined>) {
  const known = values.filter((value): value is number => typeof value === "number");

  if (known.length === 0) {
    return null;
  }

  return known.reduce((total, value) => total + value, 0);
}

function normalizeReportPath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.?\//, "");
}

function slugifyAgentId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

const contextEngineOwnerLabels: Record<ContextEngineFileOwner, string> = {
  "workspace-global": "Workspace global",
  "agent-profile": "Agent profile",
  "agent-policy": "Agent policy",
  "workspace-skill": "Workspace skill",
  memory: "Memory",
  "generated-runtime-output": "Generated/runtime output"
};
