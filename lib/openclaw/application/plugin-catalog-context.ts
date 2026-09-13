import type { ControlPlaneSnapshot } from "@/lib/agentos/contracts";
import {
  createPluginCatalogContext,
  type PluginCatalogContext
} from "@/lib/openclaw/domains/plugin-catalog";

export function resolvePluginCatalogContext(
  snapshot: Pick<ControlPlaneSnapshot, "workspaces" | "agents">,
  workspaceId?: string,
  agentId?: string
): PluginCatalogContext | null {
  const normalizedWorkspaceId = normalizeIdentifier(workspaceId, 512);
  const normalizedAgentId = normalizeIdentifier(agentId, 512);
  if (!normalizedWorkspaceId || !normalizedAgentId) {
    return null;
  }

  const workspace = snapshot.workspaces.find((entry) => entry.id === normalizedWorkspaceId);
  const agent = snapshot.agents.find((entry) => entry.id === normalizedAgentId);
  if (!workspace || !agent || agent.workspaceId !== workspace.id || !workspace.agentIds.includes(agent.id)) {
    return null;
  }

  return createPluginCatalogContext(workspace, agent);
}

function normalizeIdentifier(value: string | undefined, maxLength: number) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized.length > 0 ? normalized.slice(0, maxLength) : null;
}
