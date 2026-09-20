export type AgentDetailTab = "overview" | "behavior" | "capabilities" | "channels" | "sessions";

export type AgentDetailQueryState = {
  tab: AgentDetailTab;
  capabilityFocus: string | null;
  sessionFocus: string | null;
};

export const AGENT_DETAIL_TABS: Array<{ id: AgentDetailTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "behavior", label: "Behavior" },
  { id: "capabilities", label: "Capabilities" },
  { id: "channels", label: "Channels" },
  { id: "sessions", label: "Sessions" }
];

export function parseAgentDetailTab(value: string | null | undefined): AgentDetailTab {
  return AGENT_DETAIL_TABS.some((tab) => tab.id === value) ? value as AgentDetailTab : "overview";
}

export function parseAgentDetailQueryState(input: {
  tab?: string | null;
  capability?: string | null;
  session?: string | null;
}): AgentDetailQueryState {
  return {
    tab: parseAgentDetailTab(input.tab),
    capabilityFocus: normalizeFocus(input.capability),
    sessionFocus: normalizeFocus(input.session)
  };
}

function normalizeFocus(value: string | null | undefined) {
  const normalized = value?.trim() || null;
  return normalized && normalized.length <= 256 ? normalized : null;
}
