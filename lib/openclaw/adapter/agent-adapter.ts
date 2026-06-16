import path from "node:path";

import type {
  AgentConfigPayload,
  AgentPayload,
  OpenClawAgentListPayload
} from "@/lib/openclaw/client/gateway-client";
import { normalizeOptionalValue } from "@/lib/openclaw/domains/control-plane-normalization";

export function buildAgentPayloadsFromConfig(
  agentConfig: AgentConfigPayload,
  openClawStateRootPath: string
): AgentPayload {
  return dedupeLegacyAgentPayloads(agentConfig.map((entry) => ({
    id: entry.id,
    name: resolveConfigAgentDisplayName(entry),
    identityName: entry.identity?.name,
    identityEmoji: entry.identity?.emoji,
    identitySource: entry.identity ? "config" : undefined,
    workspace: normalizeOptionalValue(entry.workspace) ?? "",
    agentDir: entry.agentDir || path.join(openClawStateRootPath, "agents", entry.id, "agent"),
    model: entry.model,
    isDefault: Boolean(entry.default)
  })), openClawStateRootPath);
}

export function buildAgentPayloadsFromGatewayList(
  gatewayPayload: OpenClawAgentListPayload,
  agentConfig: AgentConfigPayload,
  openClawStateRootPath: string
): AgentPayload {
  const configByAgent = new Map(agentConfig.map((entry) => [entry.id, entry]));

  return dedupeLegacyAgentPayloads(gatewayPayload.agents.map((entry) => {
    const configured = configByAgent.get(entry.id);
    const identity = entry.identity ?? configured?.identity;
    const workspace = normalizeOptionalValue(entry.workspace) ?? normalizeOptionalValue(configured?.workspace) ?? "";
    const model = entry.model?.primary ?? configured?.model;

    return {
      id: entry.id,
      name: resolveGatewayAgentDisplayName(entry.id, entry.name, identity?.name, configured?.name),
      identityName: identity?.name,
      identityEmoji: identity?.emoji,
      identitySource: entry.identity ? "gateway" : configured?.identity ? "config" : undefined,
      workspace,
      agentDir: configured?.agentDir || path.join(openClawStateRootPath, "agents", entry.id, "agent"),
      model,
      isDefault: entry.id === gatewayPayload.defaultId || Boolean(configured?.default)
    };
  }), openClawStateRootPath);
}

function resolveConfigAgentDisplayName(entry: AgentConfigPayload[number]) {
  return resolveAgentDisplayName({
    id: entry.id,
    primaryName: entry.name,
    fallbackName: entry.identity?.name
  });
}

function resolveGatewayAgentDisplayName(
  agentId: string,
  gatewayName: string | undefined,
  identityName: string | undefined,
  configuredName: string | undefined
) {
  return resolveAgentDisplayName({
    id: agentId,
    primaryName: gatewayName,
    fallbackName: identityName ?? configuredName
  });
}

function resolveAgentDisplayName(input: {
  id: string;
  primaryName: string | undefined;
  fallbackName: string | undefined;
}) {
  const primaryName = normalizeOptionalValue(input.primaryName);
  const fallbackName = normalizeOptionalValue(input.fallbackName);

  if (primaryName && primaryName !== input.id) {
    return primaryName;
  }

  return fallbackName ?? primaryName ?? input.id;
}

function dedupeLegacyAgentPayloads(agents: AgentPayload, openClawStateRootPath: string): AgentPayload {
  const removableKeys = new Set<string>();
  const groups = new Map<string, AgentPayload>();

  for (const agent of agents) {
    const key = buildLegacyDuplicateKey(agent);
    if (!key) {
      continue;
    }

    const group = groups.get(key) ?? [];
    group.push(agent);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.length < 2) {
      continue;
    }

    const workspaceManagedAgents = group.filter(isWorkspaceManagedAgent);
    if (workspaceManagedAgents.length === 0) {
      continue;
    }

    for (const candidate of group) {
      if (
        workspaceManagedAgents.includes(candidate) ||
        !isGlobalStateAgentDir(candidate, openClawStateRootPath)
      ) {
        continue;
      }

      removableKeys.add(buildAgentPayloadKey(candidate));
    }
  }

  return agents.filter((agent) => !removableKeys.has(buildAgentPayloadKey(agent)));
}

function buildLegacyDuplicateKey(agent: AgentPayload[number]) {
  const workspace = normalizePathForComparison(agent.workspace);
  const name = normalizeAgentNameForComparison(agent.identityName || agent.name || agent.id);

  return workspace && name ? `${workspace}\0${name}` : null;
}

function buildAgentPayloadKey(agent: AgentPayload[number]) {
  return `${agent.id}\0${normalizePathForComparison(agent.agentDir)}`;
}

function isWorkspaceManagedAgent(agent: AgentPayload[number]) {
  const workspace = normalizePathForComparison(agent.workspace);
  const agentDir = normalizePathForComparison(agent.agentDir);

  if (!workspace || !agentDir) {
    return false;
  }

  return agentDir.startsWith(`${path.join(workspace, ".openclaw", "agents")}${path.sep}`);
}

function isGlobalStateAgentDir(agent: AgentPayload[number], openClawStateRootPath: string) {
  const agentDir = normalizePathForComparison(agent.agentDir);
  const globalAgentRoot = normalizePathForComparison(path.join(openClawStateRootPath, "agents"));

  return Boolean(agentDir && globalAgentRoot && agentDir.startsWith(`${globalAgentRoot}${path.sep}`));
}

function normalizePathForComparison(value: string | null | undefined) {
  const normalized = normalizeOptionalValue(value);

  return normalized ? path.normalize(normalized) : "";
}

function normalizeAgentNameForComparison(value: string | null | undefined) {
  return normalizeOptionalValue(value)?.toLocaleLowerCase("en-US") ?? "";
}
