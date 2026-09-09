import "server-only";

import path from "node:path";

import {
  readKnowledgeSnapshot,
  type KnowledgeSnapshot
} from "@/lib/agentos/domains/workspace-knowledge-ingestion";
import { readWorkspaceProjectManifest } from "@/lib/openclaw/domains/workspace-manifest";
import { getOpenClawAdapter, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type {
  OpenClawCommandOptions,
  OpenClawMemoryIndexStatusPayload
} from "@/lib/openclaw/client/types";
import { getWorkerMemoryProjection } from "@/lib/openclaw/application/native-memory-service";
import type { WorkerMemoryProjection } from "@/lib/openclaw/memory-types";
import { redactErrorMessage } from "@/lib/security/redaction";

/** Stable AgentOS corpus path. The path is resolved from the workspace root. */
export const AGENTOS_NATIVE_KNOWLEDGE_RELATIVE_PATH = "knowledge/sources";

const AGENTOS_NATIVE_KNOWLEDGE_EXTRA_PATH = {
  path: AGENTOS_NATIVE_KNOWLEDGE_RELATIVE_PATH
} as const;

type NativeMemoryExtraPath = string | { path: string; pattern?: string };

export type WorkspaceNativeKnowledgeBindingInput = {
  workspacePath: string;
  /** Omit to derive enabled workspace agents from the canonical project manifest. */
  agentIds?: readonly string[];
  adapter?: OpenClawAdapter;
  commandOptions?: OpenClawCommandOptions;
};

export type WorkspaceKnowledgeCorpusCoverage = {
  totalDocuments: number;
  markdownDocuments: number;
  nonMarkdownDocuments: number;
  markdownCoveragePercent: number;
  formats: Record<string, number>;
};

export type WorkspaceNativeKnowledgeBindingAction =
  | "add"
  | "remove"
  | "unchanged"
  | "not-applicable"
  | "blocked";

export type WorkspaceNativeKnowledgeAgentPlan = {
  agentId: string;
  configPath: string;
  currentExtraPaths: NativeMemoryExtraPath[];
  nextExtraPaths: NativeMemoryExtraPath[];
  action: WorkspaceNativeKnowledgeBindingAction;
  issue: string | null;
};

export type WorkspaceNativeKnowledgeBindingPlan = {
  workspacePath: string;
  corpusRoot: string;
  stateRoot: string;
  activeCorpus: boolean;
  generationId: string | null;
  coverage: WorkspaceKnowledgeCorpusCoverage;
  desiredExtraPath: NativeMemoryExtraPath;
  agents: WorkspaceNativeKnowledgeAgentPlan[];
  warnings: string[];
};

export type WorkspaceNativeKnowledgeBindingMutation = {
  agentId: string;
  configPath: string;
  action: "add" | "remove";
  appliedVia: string | null;
  pending: boolean;
  restartRequired: boolean | null;
  changedPaths: string[];
};

export type WorkspaceNativeKnowledgeBindingResult = WorkspaceNativeKnowledgeBindingPlan & {
  status: "applied" | "unchanged" | "not-applicable" | "partial" | "failed" | "pending";
  mutations: WorkspaceNativeKnowledgeBindingMutation[];
  errors: string[];
  restartRequired: boolean | null;
  indexRefresh: WorkspaceNativeKnowledgeIndexRefresh[];
};

export type WorkspaceNativeKnowledgeIndexRefresh = {
  agentId: string;
  action: "reindexed" | "not-required" | "skipped" | "unavailable" | "failed";
  dirty: boolean | null;
  indexIdentityStatus: string | null;
  appliedVia: "cli-fallback" | null;
  issue: string | null;
};

export type WorkspaceNativeKnowledgeStatus = {
  status: "configured" | "not-configured" | "degraded" | "unknown" | "not-applicable";
  configured: boolean;
  activeCorpus: boolean;
  generationId: string | null;
  desiredExtraPath: NativeMemoryExtraPath;
  coverage: WorkspaceKnowledgeCorpusCoverage;
  agents: Array<{
    agentId: string;
    binding: "configured" | "missing" | "not-applicable" | "unknown";
    nativeStatus: WorkerMemoryProjection | null;
    issue: string | null;
  }>;
  warnings: string[];
  /** Null means the current OpenClaw status surface did not expose the field. */
  index: {
    files: number | null;
    chunks: number | null;
    dirty: boolean | null;
    lastSyncError: string | null;
    sourceCounts: Record<string, number> | null;
  } | null;
  restartRequired: boolean | null;
  indexActionRequired: "required" | "not-required" | "unknown";
};

export class WorkspaceNativeKnowledgeBindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceNativeKnowledgeBindingError";
  }
}

/** Build the exact per-agent OpenClaw config path used by the native binding. */
export function buildWorkspaceNativeKnowledgeConfigPath(agentId: string) {
  const normalizedAgentId = normalizeAgentId(agentId);
  return `agents.entries[${JSON.stringify(normalizedAgentId)}].memory.search.extraPaths`;
}

/** Read and plan the AgentOS-owned native binding without mutating OpenClaw config. */
export async function planWorkspaceKnowledgeBinding(
  input: WorkspaceNativeKnowledgeBindingInput
): Promise<WorkspaceNativeKnowledgeBindingPlan> {
  const workspacePath = path.resolve(input.workspacePath);
  const corpusRoot = path.join(workspacePath, "knowledge");
  const stateRoot = path.join(workspacePath, ".openclaw", "knowledge");
  const corpus = await readKnowledgeSnapshot(corpusRoot, stateRoot);
  const agentIds = await resolveWorkspaceAgentIds(workspacePath, input.agentIds);
  const basePlan: WorkspaceNativeKnowledgeBindingPlan = {
    workspacePath,
    corpusRoot,
    stateRoot,
    activeCorpus: Boolean(corpus?.documents.length),
    generationId: corpus?.state.generationId ?? null,
    coverage: buildCorpusCoverage(corpus),
    desiredExtraPath: { ...AGENTOS_NATIVE_KNOWLEDGE_EXTRA_PATH },
    agents: [],
    warnings: [] as string[]
  };

  if (agentIds.length === 0) {
    basePlan.warnings.push("The workspace has no enabled OpenClaw agents to bind.");
    return basePlan;
  }

  const adapter = input.adapter ?? getOpenClawAdapter();
  const snapshot = await readNativeConfigSnapshot(adapter, input.commandOptions);
  const config = isRecord(snapshot.config) ? snapshot.config : {};
  const entries = readNativeAgentEntries(config);

  for (const agentId of agentIds) {
    const configPath = buildWorkspaceNativeKnowledgeConfigPath(agentId);
    const entry = entries[agentId];

    if (!isRecord(entry)) {
      basePlan.agents.push({
        agentId,
        configPath,
        currentExtraPaths: [],
        nextExtraPaths: [],
        action: "blocked",
        issue: "The enabled workspace agent is not present in OpenClaw agents.entries."
      });
      continue;
    }

    const currentExtraPaths = readNativeExtraPaths(entry, agentId);
    const hasBinding = currentExtraPaths.some(isAgentOsNativeKnowledgePath);
    const nextExtraPaths = basePlan.activeCorpus
      ? hasBinding ? currentExtraPaths : [...currentExtraPaths, { ...AGENTOS_NATIVE_KNOWLEDGE_EXTRA_PATH }]
      : currentExtraPaths.filter((entry) => !isAgentOsNativeKnowledgePath(entry));
    const changed = !jsonValuesEqual(currentExtraPaths, nextExtraPaths);

    basePlan.agents.push({
      agentId,
      configPath,
      currentExtraPaths,
      nextExtraPaths,
      action: changed
        ? basePlan.activeCorpus ? "add" : "remove"
        : basePlan.activeCorpus ? "unchanged" : "not-applicable",
      issue: null
    });
  }

  if (corpus?.state.warnings.length) {
    basePlan.warnings.push(...corpus.state.warnings);
  }
  if (basePlan.activeCorpus) {
    basePlan.warnings.push(
      "OpenClaw owns native memory watching, synchronization, indexing, retrieval, and index repair."
    );
  }

  return basePlan;
}

/** Apply only the planned AgentOS-owned per-agent extra-path changes. */
export async function ensureWorkspaceNativeKnowledge(
  input: WorkspaceNativeKnowledgeBindingInput
): Promise<WorkspaceNativeKnowledgeBindingResult> {
  const plan = await planWorkspaceKnowledgeBinding(input);
  const adapter = input.adapter ?? getOpenClawAdapter();
  const mutations: WorkspaceNativeKnowledgeBindingMutation[] = [];
  const errors = plan.agents
    .filter((agent) => agent.action === "blocked" && agent.issue)
    .map((agent) => `${agent.agentId}: ${agent.issue}`);

  for (const agent of plan.agents.filter((entry) => entry.action === "add" || entry.action === "remove")) {
    try {
      const result = await adapter.setConfig(agent.configPath, agent.nextExtraPaths, {
        ...(input.commandOptions ?? {}),
        strictJson: true
      });
      const mutation = readConfigMutation(result);
      mutations.push({
        agentId: agent.agentId,
        configPath: agent.configPath,
        action: agent.action === "add" ? "add" : "remove",
        appliedVia: mutation.appliedVia,
        pending: mutation.pending,
        restartRequired: mutation.restartRequired,
        changedPaths: mutation.changedPaths
      });
    } catch (error) {
      errors.push(`${agent.agentId}: ${redactErrorMessage(error, "OpenClaw native config mutation failed.")}`);
    }
  }

  const indexRefresh = await refreshNativeKnowledgeIndexes({
    plan,
    mutations,
    adapter,
    commandOptions: input.commandOptions
  });

  const restartRequired = mutations.some((mutation) => mutation.restartRequired === true)
    ? true
    : mutations.some((mutation) => mutation.restartRequired === false)
      ? false
      : null;
  const pending = mutations.some((mutation) => mutation.pending);
  const hasChanges = plan.agents.some((agent) => agent.action === "add" || agent.action === "remove");
  const status = errors.length > 0
    ? mutations.length > 0 ? "partial" : "failed"
    : pending
      ? "pending"
      : hasChanges
        ? "applied"
        : plan.activeCorpus
          ? "unchanged"
          : "not-applicable";

  const warnings = [...plan.warnings];
  if (restartRequired === true) {
    warnings.push("OpenClaw reported that the Gateway must be restarted before this binding is active.");
  }
  if (pending) {
    warnings.push("OpenClaw config pacing queued one or more native binding updates; refresh status after the queue drains.");
  }
  warnings.push(...indexRefresh.filter((entry) => entry.issue).map((entry) => `${entry.agentId}: ${entry.issue}`));

  return {
    ...plan,
    warnings,
    status,
    mutations,
    errors,
    restartRequired,
    indexRefresh
  };
}

/** Project config binding plus OpenClaw's native memory health facts. */
export async function getWorkspaceNativeKnowledgeStatus(
  input: WorkspaceNativeKnowledgeBindingInput
): Promise<WorkspaceNativeKnowledgeStatus> {
  try {
    const plan = await planWorkspaceKnowledgeBinding(input);
    const adapter = input.adapter ?? getOpenClawAdapter();
    const agents = await Promise.all(plan.agents.map(async (agent) => {
      const nativeStatus = agent.action === "blocked"
        ? null
        : await getWorkerMemoryProjection(agent.agentId, {
            adapter,
            commandOptions: input.commandOptions
          });
      return {
        agentId: agent.agentId,
        binding: agent.action === "blocked"
          ? "unknown"
          : plan.activeCorpus
            ? agent.action === "add" ? "missing" : "configured"
            : "not-applicable",
        nativeStatus,
        issue: agent.issue
      } as const;
    }));
    const indexObservations = await Promise.all(agents.map(async (agent) => {
      if (agent.binding !== "configured") {
        return { agentId: agent.agentId, payload: null, issue: null };
      }
      if (!adapter.getMemoryIndexStatus) {
        return {
          agentId: agent.agentId,
          payload: null,
          issue: "OpenClaw memory index status is unavailable; index freshness is unknown."
        };
      }
      try {
        return {
          agentId: agent.agentId,
          payload: await adapter.getMemoryIndexStatus({ agentId: agent.agentId }, input.commandOptions),
          issue: null
        };
      } catch (error) {
        return {
          agentId: agent.agentId,
          payload: null,
          issue: redactErrorMessage(error, "OpenClaw memory index status could not be read.")
        };
      }
    }));
    const indexObservationsWithPayload = indexObservations.filter(
      (observation): observation is { agentId: string; payload: OpenClawMemoryIndexStatusPayload; issue: null } =>
        observation.payload !== null
    );
    const index = aggregateNativeIndexStatus(indexObservationsWithPayload.map((observation) => observation.payload));
    const indexActionRequired = indexObservations.some((observation) => observation.issue)
      ? "unknown" as const
      : resolveIndexActionRequired(indexObservationsWithPayload.map((observation) => observation.payload));
    const indexWarnings = indexObservations
      .filter((observation) => observation.issue)
      .map((observation) => `${observation.agentId}: ${observation.issue}`);
    if (indexObservationsWithPayload.length > 0) {
      indexWarnings.unshift(
        "OpenClaw 2026.9.3 has no Gateway memory index status/sync method; AgentOS uses its structured CLI fallback only when the native status reports dirty or incompatible."
      );
    }
    const configured = plan.activeCorpus
      ? agents.length > 0 && agents.every((agent) => agent.binding === "configured")
      : agents.every((agent) => agent.binding === "not-applicable");
    const hasNativeFailure = agents.some((agent) =>
      agent.nativeStatus?.status === "unknown" || agent.nativeStatus?.status === "unavailable"
    );
    const hasNativeWarning = agents.some((agent) => agent.nativeStatus?.status === "degraded" || agent.nativeStatus?.status === "needs-attention");
    const hasUnknownBinding = agents.some((agent) => agent.binding === "unknown");
    const hasUnknownIndex = plan.activeCorpus && configured && indexActionRequired === "unknown";
    const hasStaleIndex = plan.activeCorpus && configured && indexActionRequired === "required";
    const hasIndexError = indexObservationsWithPayload.some((observation) => Boolean(observation.payload.lastSyncError));

    return {
      status: !plan.activeCorpus
        ? "not-applicable"
          : hasUnknownBinding || hasNativeFailure || hasUnknownIndex
            ? "unknown"
            : !configured
              ? "not-configured"
              : hasNativeWarning || hasStaleIndex || hasIndexError
                ? "degraded"
                : "configured",
      configured,
      activeCorpus: plan.activeCorpus,
      generationId: plan.generationId,
      desiredExtraPath: plan.desiredExtraPath,
      coverage: plan.coverage,
      agents,
      warnings: [
        ...plan.warnings,
        ...indexWarnings
      ],
      index,
      restartRequired: null,
      indexActionRequired
    };
  } catch (error) {
    return {
      status: "unknown",
      configured: false,
      activeCorpus: false,
      generationId: null,
      desiredExtraPath: { ...AGENTOS_NATIVE_KNOWLEDGE_EXTRA_PATH },
      coverage: emptyCoverage(),
      agents: [],
      warnings: [redactErrorMessage(error, "Unable to read native workspace knowledge status.")],
      index: null,
      restartRequired: null,
      indexActionRequired: "unknown"
    };
  }
}

async function refreshNativeKnowledgeIndexes(input: {
  plan: WorkspaceNativeKnowledgeBindingPlan;
  mutations: WorkspaceNativeKnowledgeBindingMutation[];
  adapter: OpenClawAdapter;
  commandOptions?: OpenClawCommandOptions;
}): Promise<WorkspaceNativeKnowledgeIndexRefresh[]> {
  if (!input.plan.activeCorpus) {
    return [];
  }

  return Promise.all(input.plan.agents.map(async (agent) => {
    if (agent.action === "blocked" || agent.action === "remove") {
      return {
        agentId: agent.agentId,
        action: "skipped" as const,
        dirty: null,
        indexIdentityStatus: null,
        appliedVia: null,
        issue: "Native index refresh is not applicable without an active binding."
      };
    }

    const mutation = input.mutations.find((entry) => entry.agentId === agent.agentId);
    if (agent.action === "add" && !mutation) {
      return {
        agentId: agent.agentId,
        action: "skipped" as const,
        dirty: null,
        indexIdentityStatus: null,
        appliedVia: null,
        issue: "Native index refresh is deferred because the native knowledge binding was not applied."
      };
    }
    if (mutation && (mutation.pending || mutation.restartRequired !== false)) {
      return {
        agentId: agent.agentId,
        action: "skipped" as const,
        dirty: null,
        indexIdentityStatus: null,
        appliedVia: null,
        issue: mutation.pending
          ? "Native index refresh is pending until OpenClaw config pacing drains."
          : "Native index refresh is deferred until the OpenClaw Gateway restart completes."
      };
    }

    if (!input.adapter.getMemoryIndexStatus) {
      return {
        agentId: agent.agentId,
        action: "unavailable" as const,
        dirty: null,
        indexIdentityStatus: null,
        appliedVia: null,
        issue: "OpenClaw memory index status is unavailable; index refresh was not attempted."
      };
    }

    let status: OpenClawMemoryIndexStatusPayload;
    try {
      status = await input.adapter.getMemoryIndexStatus(
        { agentId: agent.agentId },
        input.commandOptions
      );
    } catch (error) {
      return {
        agentId: agent.agentId,
        action: "failed" as const,
        dirty: null,
        indexIdentityStatus: null,
        appliedVia: null,
        issue: redactErrorMessage(error, "OpenClaw memory index status could not be read.")
      };
    }

    const required = isNativeIndexRefreshRequired(status);
    if (!required) {
      const clean = status.dirty === false && status.indexIdentity?.status === "valid";
      return {
        agentId: agent.agentId,
        action: clean
          ? "not-required" as const
          : "failed" as const,
        dirty: status.dirty,
        indexIdentityStatus: status.indexIdentity?.status ?? null,
        appliedVia: status.appliedVia,
        issue: clean
          ? status.lastSyncError
            ? "OpenClaw reported a previous memory index synchronization error."
            : null
          : "OpenClaw memory index status did not provide a clean, compatible index state."
      };
    }

    if (!input.adapter.rebuildMemoryIndex) {
      return {
        agentId: agent.agentId,
        action: "unavailable" as const,
        dirty: status.dirty,
        indexIdentityStatus: status.indexIdentity?.status ?? null,
        appliedVia: status.appliedVia,
        issue: "OpenClaw memory index rebuild is unavailable; the dirty or incompatible index was not changed."
      };
    }

    try {
      const rebuilt = await input.adapter.rebuildMemoryIndex(
        { agentId: agent.agentId },
        input.commandOptions
      );
      return {
        agentId: agent.agentId,
        action: "reindexed" as const,
        dirty: status.dirty,
        indexIdentityStatus: status.indexIdentity?.status ?? null,
        appliedVia: rebuilt.appliedVia,
        issue: null
      };
    } catch (error) {
      return {
        agentId: agent.agentId,
        action: "failed" as const,
        dirty: status.dirty,
        indexIdentityStatus: status.indexIdentity?.status ?? null,
        appliedVia: status.appliedVia,
        issue: redactErrorMessage(error, "OpenClaw memory index rebuild failed.")
      };
    }
  }));
}

function isNativeIndexRefreshRequired(status: OpenClawMemoryIndexStatusPayload) {
  return status.dirty === true || (
    status.indexIdentity !== null &&
    status.indexIdentity.status !== null &&
    status.indexIdentity.status !== "valid"
  );
}

function resolveIndexActionRequired(statuses: OpenClawMemoryIndexStatusPayload[]) {
  if (statuses.length === 0) {
    return "unknown" as const;
  }
  if (statuses.some(isNativeIndexRefreshRequired)) {
    return "required" as const;
  }
  if (statuses.some((status) => status.dirty === null || status.indexIdentity?.status !== "valid")) {
    return "unknown" as const;
  }
  return "not-required" as const;
}

function aggregateNativeIndexStatus(statuses: OpenClawMemoryIndexStatusPayload[]) {
  if (statuses.length === 0) {
    return null;
  }
  const first = statuses[0];
  const same = <T>(read: (status: OpenClawMemoryIndexStatusPayload) => T) =>
    statuses.every((status) => JSON.stringify(read(status)) === JSON.stringify(read(first)));
  return {
    files: same((status) => status.files) ? first.files : null,
    chunks: same((status) => status.chunks) ? first.chunks : null,
    dirty: same((status) => status.dirty) ? first.dirty : null,
    lastSyncError: same((status) => status.lastSyncError) ? first.lastSyncError : "OpenClaw agents reported different index errors.",
    sourceCounts: same((status) => status.sourceCounts) ? first.sourceCounts : null
  };
}

async function resolveWorkspaceAgentIds(workspacePath: string, requested?: readonly string[]) {
  const values = requested === undefined
    ? (await readWorkspaceProjectManifest(workspacePath)).agents.filter((agent) => agent.enabled).map((agent) => agent.id)
    : requested;
  return Array.from(new Set(values.map(normalizeAgentId).filter(Boolean))).sort();
}

async function readNativeConfigSnapshot(adapter: OpenClawAdapter, options?: OpenClawCommandOptions) {
  if (!adapter.getConfigSnapshot) {
    throw new WorkspaceNativeKnowledgeBindingError(
      "OpenClaw native config.get is unavailable; refusing to mutate resolved or CLI config."
    );
  }
  const snapshot = await adapter.getConfigSnapshot(options);
  if (snapshot.valid === false) {
    throw new WorkspaceNativeKnowledgeBindingError("OpenClaw returned an invalid config snapshot; native knowledge binding was not changed.");
  }
  return snapshot;
}

function readNativeAgentEntries(config: Record<string, unknown>) {
  const agents = isRecord(config.agents) ? config.agents : null;
  const entries = agents && isRecord(agents.entries) ? agents.entries : null;
  if (!entries) {
    throw new WorkspaceNativeKnowledgeBindingError(
      "OpenClaw agents.entries is unavailable; refusing to create a parallel or legacy agent config binding."
    );
  }
  return entries;
}

function readNativeExtraPaths(entry: Record<string, unknown>, agentId: string): NativeMemoryExtraPath[] {
  const memory = isRecord(entry.memory) ? entry.memory : null;
  const search = memory && isRecord(memory.search) ? memory.search : null;
  const extraPaths = search?.extraPaths;
  if (extraPaths === undefined) {
    return [];
  }
  if (!Array.isArray(extraPaths) || !extraPaths.every(isNativeMemoryExtraPath)) {
    throw new WorkspaceNativeKnowledgeBindingError(
      `OpenClaw agents.entries[${JSON.stringify(agentId)}].memory.search.extraPaths is malformed; refusing to overwrite it.`
    );
  }
  return extraPaths.map((entry) => typeof entry === "string" ? entry : { ...entry });
}

function isNativeMemoryExtraPath(value: unknown): value is NativeMemoryExtraPath {
  return typeof value === "string"
    ? value.trim().length > 0
    : isRecord(value)
      && typeof value.path === "string"
      && value.path.trim().length > 0
      && (value.pattern === undefined || typeof value.pattern === "string");
}

function isAgentOsNativeKnowledgePath(value: NativeMemoryExtraPath) {
  const configuredPath = typeof value === "string" ? value : value.path;
  const pattern = typeof value === "string" ? undefined : value.pattern;
  return configuredPath.trim().replaceAll("\\", "/") === AGENTOS_NATIVE_KNOWLEDGE_RELATIVE_PATH
    && (!pattern || pattern.trim().length === 0);
}

function buildCorpusCoverage(snapshot: KnowledgeSnapshot | null): WorkspaceKnowledgeCorpusCoverage {
  if (!snapshot) {
    return emptyCoverage();
  }
  const formats: Record<string, number> = {};
  let markdownDocuments = 0;
  for (const document of snapshot.documents) {
    const format = document.format.trim().toLowerCase() || "unknown";
    formats[format] = (formats[format] ?? 0) + 1;
    if (document.outputPath.toLowerCase().endsWith(".md")) {
      markdownDocuments += 1;
    }
  }
  const totalDocuments = snapshot.documents.length;
  return {
    totalDocuments,
    markdownDocuments,
    nonMarkdownDocuments: totalDocuments - markdownDocuments,
    markdownCoveragePercent: totalDocuments === 0 ? 0 : Math.round((markdownDocuments / totalDocuments) * 10000) / 100,
    formats
  };
}

function emptyCoverage(): WorkspaceKnowledgeCorpusCoverage {
  return {
    totalDocuments: 0,
    markdownDocuments: 0,
    nonMarkdownDocuments: 0,
    markdownCoveragePercent: 0,
    formats: {}
  };
}

function readConfigMutation(result: { metadata?: Record<string, unknown>; stdout?: string }) {
  const metadata = result.metadata ?? {};
  const raw = isRecord(metadata.openClawConfig) ? metadata.openClawConfig : {};
  let stdout: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(result.stdout ?? "{}");
    stdout = isRecord(parsed) ? parsed : {};
  } catch {
    stdout = {};
  }
  const configMutation = isRecord(raw) && isRecord(raw.configMutation)
    ? raw.configMutation
    : isRecord(stdout.configMutation) ? stdout.configMutation : raw;
  return {
    appliedVia: typeof configMutation.appliedVia === "string" ? configMutation.appliedVia : null,
    pending: metadata.pending === true || stdout.pending === true,
    restartRequired: typeof configMutation.restartRequired === "boolean" ? configMutation.restartRequired : null,
    changedPaths: Array.isArray(configMutation.changedPaths)
      ? configMutation.changedPaths.filter((entry): entry is string => typeof entry === "string")
      : []
  };
}

function normalizeAgentId(value: string) {
  const normalized = value.trim();
  if (!normalized) {
    throw new WorkspaceNativeKnowledgeBindingError("Workspace native knowledge binding requires non-empty agent ids.");
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function jsonValuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}
