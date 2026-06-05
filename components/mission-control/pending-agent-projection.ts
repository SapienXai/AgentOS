import type { AgentRecord, AgentCreateInput } from "@/lib/agentos/contracts";

export type PendingAgentProjection = {
  id: string;
  workspaceId: string;
  workspacePath: string;
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
