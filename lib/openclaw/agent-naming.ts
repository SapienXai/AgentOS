import { getAgentPresetMeta } from "@/lib/openclaw/agent-presets";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type { AgentPreset, MissionControlSnapshot } from "@/lib/agentos/contracts";

const DEFAULT_AGENT_NAME_CANDIDATES: Record<AgentPreset, readonly string[]> = {
  worker: ["Builder", "Operator", "Coordinator", "Navigator", "Analyst", "Pilot", "Partner"],
  setup: ["Setup Operator", "Systems Keeper", "Runtime Steward", "Config Guide", "Launch Engineer"],
  browser: ["Research Scout", "Web Navigator", "Source Analyst", "Market Scout", "Evidence Runner"],
  monitoring: ["Watchkeeper", "Signal Monitor", "Drift Sentinel", "Health Scout", "Reliability Watch"],
  custom: ["Specialist", "Mission Partner", "Field Operator", "Strategy Lead", "Project Guide"]
};

/**
 * Pick a readable, deterministic display name for a fresh agent. Names are
 * unique inside the target workspace while explicit user-entered names remain
 * untouched by the caller.
 */
export function buildUniqueAgentName(
  agents: MissionControlSnapshot["agents"],
  workspaceId: string | undefined,
  preset: AgentPreset,
  reservedNames: readonly string[] = []
) {
  const usedNames = new Set(
    [
      ...agents
        .filter((agent) => !workspaceId || agent.workspaceId === workspaceId)
        .flatMap((agent) => [agent.name, agent.identityName, formatAgentDisplayName(agent)]),
      ...reservedNames
    ]
      .map((name) => normalizeAgentName(name))
      .filter(Boolean)
  );
  const candidates = DEFAULT_AGENT_NAME_CANDIDATES[preset];

  for (const candidate of candidates) {
    if (!usedNames.has(normalizeAgentName(candidate))) {
      return candidate;
    }
  }

  const fallback = candidates[0] ?? getAgentPresetMeta(preset).defaultName;
  let suffix = 2;
  let candidate = `${fallback} ${suffix}`;

  while (usedNames.has(normalizeAgentName(candidate))) {
    suffix += 1;
    candidate = `${fallback} ${suffix}`;
  }

  return candidate;
}

function normalizeAgentName(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("en-US") ?? "";
}
