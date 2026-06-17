import type {
  AgentRecord,
  AgentCreateInput,
  WorkspaceCreateResult,
  WorkspacePlanDeployResult
} from "@/lib/agentos/contracts";

export const pendingAgentProjectionStorageKey = "agentos:pending-created-agents";
const pendingAgentProjectionTtlMs = 10 * 60 * 1000;

export type PendingAgentProjection = {
  id: string;
  workspaceId: string;
  workspacePath: string;
  workspaceName?: string;
  name: string;
  modelId: string;
  emoji?: string;
  theme?: string;
  policy: NonNullable<AgentCreateInput["policy"]>;
  heartbeat: NonNullable<AgentCreateInput["heartbeat"]>;
  skills: string[];
  tools: string[];
  createdAt: number;
  warning?: string | null;
};

export type PendingWorkspaceMenuEntry = {
  id: string;
  name: string;
  detail: string;
  pending: true;
  createdAt: number;
};

export function parsePendingAgentProjections(
  rawValue: string | null,
  referenceTimeMs = Date.now()
): PendingAgentProjection[] {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry) => normalizePendingAgentProjection(entry, referenceTimeMs))
      .filter((entry): entry is PendingAgentProjection => Boolean(entry));
  } catch {
    return [];
  }
}

type PendingWorkspaceAgentSource = {
  id: string;
  name?: string;
  modelId?: string;
  emoji?: string;
  theme?: string;
  policy?: PendingAgentProjection["policy"];
  heartbeat?: PendingAgentProjection["heartbeat"];
  skills?: string[];
  tools?: string[];
};

export function buildPendingAgentsForWorkspaceResult(
  result: WorkspaceCreateResult | WorkspacePlanDeployResult,
  createdAt = Date.now()
): PendingAgentProjection[] {
  const workspaceName = result.workspaceName?.trim() || readPathBasename(result.workspacePath) || result.workspaceId;
  const projections: PendingWorkspaceAgentSource[] = result.agentProjections?.length
    ? result.agentProjections
    : result.agentIds.map((agentId) => ({
        id: agentId,
        name: inferDisplayNameFromScopedAgentId(agentId, result.workspaceId)
      }));

  return projections
    .filter((agent) => typeof agent.id === "string" && agent.id.trim().length > 0)
    .map((agent) => {
      const policy = agent.policy ?? {
        preset: "worker",
        missingToolBehavior: "fallback",
        installScope: "workspace",
        fileAccess: "workspace-only",
        networkAccess: "restricted"
      } satisfies PendingAgentProjection["policy"];

      return {
        id: agent.id,
        workspaceId: result.workspaceId,
        workspacePath: result.workspacePath,
        workspaceName,
        name: agent.name?.trim() || inferDisplayNameFromScopedAgentId(agent.id, result.workspaceId),
        modelId: agent.modelId?.trim() || "unassigned",
        emoji: agent.emoji,
        theme: agent.theme,
        policy,
        heartbeat: agent.heartbeat ?? {
          enabled: false
        },
        skills: agent.skills ?? [],
        tools: agent.tools ?? (policy.fileAccess === "workspace-only" ? ["fs.workspaceOnly"] : []),
        createdAt
      };
    });
}

export function buildPendingWorkspaceMenuEntries(
  pendingAgents: PendingAgentProjection[],
  liveWorkspaceIds: Set<string>
): PendingWorkspaceMenuEntry[] {
  const byWorkspace = new Map<string, PendingAgentProjection[]>();

  for (const agent of pendingAgents) {
    if (liveWorkspaceIds.has(agent.workspaceId)) {
      continue;
    }

    const agents = byWorkspace.get(agent.workspaceId) ?? [];
    agents.push(agent);
    byWorkspace.set(agent.workspaceId, agents);
  }

  return Array.from(byWorkspace.entries())
    .map(([workspaceId, agents]) => {
      const firstAgent = agents[0];
      const createdAt = Math.max(...agents.map((agent) => agent.createdAt));

      return {
        id: workspaceId,
        name: firstAgent?.workspaceName ?? readPathBasename(firstAgent?.workspacePath ?? "") ?? workspaceId,
        detail: `${agents.length} agent${agents.length === 1 ? "" : "s"} creating`,
        pending: true as const,
        createdAt
      };
    })
    .sort((left, right) => right.createdAt - left.createdAt || left.name.localeCompare(right.name));
}

export function inferDisplayNameFromScopedAgentId(agentId: string, workspaceId: string) {
  const workspacePrefix = `${workspaceId}-`;
  const localId = agentId.startsWith(workspacePrefix)
    ? agentId.slice(workspacePrefix.length)
    : agentId;
  const words = localId
    .split(/[-_\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (words.length === 0) {
    return "Agent";
  }

  return words
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function normalizePendingAgentProjection(
  value: unknown,
  referenceTimeMs: number
): PendingAgentProjection | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const id = readString(record.id);
  const workspaceId = readString(record.workspaceId);
  const workspacePath = readString(record.workspacePath);
  const name = readString(record.name);
  const modelId = readString(record.modelId);
  const createdAt = typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
    ? record.createdAt
    : null;
  const policy = readPolicy(record.policy);
  const heartbeat = readHeartbeat(record.heartbeat);

  if (!id || !workspaceId || !workspacePath || !name || !modelId || !createdAt || !policy || !heartbeat) {
    return null;
  }

  if (referenceTimeMs - createdAt > pendingAgentProjectionTtlMs) {
    return null;
  }

  return {
    id,
    workspaceId,
    workspacePath,
    workspaceName: readString(record.workspaceName) ?? undefined,
    name,
    modelId,
    emoji: readString(record.emoji) ?? undefined,
    theme: readString(record.theme) ?? undefined,
    policy,
    heartbeat,
    skills: readStringList(record.skills),
    tools: readStringList(record.tools),
    createdAt,
    warning: readString(record.warning)
  };
}

function readPolicy(value: unknown): PendingAgentProjection["policy"] | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const preset = readString(record.preset);
  const missingToolBehavior = readString(record.missingToolBehavior);
  const installScope = readString(record.installScope);
  const fileAccess = readString(record.fileAccess);
  const networkAccess = readString(record.networkAccess);

  if (!preset || !missingToolBehavior || !installScope || !fileAccess || !networkAccess) {
    return null;
  }

  return {
    preset,
    missingToolBehavior,
    installScope,
    fileAccess,
    networkAccess
  } as PendingAgentProjection["policy"];
}

function readHeartbeat(value: unknown): PendingAgentProjection["heartbeat"] | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  return {
    enabled: record.enabled === true,
    every: readString(record.every) ?? undefined
  };
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPathBasename(value: string) {
  const normalized = value.trim().replace(/\/+$/g, "");

  if (!normalized) {
    return null;
  }

  return normalized.split("/").pop() || null;
}

function readStringList(value: unknown) {
  return Array.isArray(value)
    ? value.map(readString).filter((entry): entry is string => Boolean(entry))
    : [];
}

export function buildPendingAgentRecord(pending: PendingAgentProjection): AgentRecord {
  return {
    id: pending.id,
    name: pending.name,
    identityName: pending.name,
    workspaceId: pending.workspaceId,
    workspacePath: pending.workspacePath,
    modelId: pending.modelId,
    isDefault: false,
    status: "standby",
    sessionCount: 0,
    lastActiveAt: null,
    currentAction: "Provisioning in OpenClaw",
    activeRuntimeIds: [],
    heartbeat: {
      enabled: Boolean(pending.heartbeat.enabled),
      every: pending.heartbeat.every ?? null,
      everyMs: null
    },
    identity: {
      emoji: pending.emoji,
      theme: pending.theme,
      source: "agentos-pending-create"
    },
    profile: {
      purpose: "OpenClaw is provisioning this agent. The card will activate when the live snapshot syncs.",
      operatingInstructions: [],
      responseStyle: [],
      outputPreference: null,
      sourceFiles: []
    },
    skills: pending.skills,
    tools: pending.tools,
    policy: pending.policy
  };
}
