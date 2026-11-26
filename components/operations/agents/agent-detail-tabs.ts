export type AgentDetailTab = "overview" | "behavior" | "knowledge" | "capabilities" | "intelligence" | "channels" | "sessions" | "settings";

export type AgentDetailQueryState = {
  tab: AgentDetailTab;
  capabilityFocus: string | null;
  sessionFocus: string | null;
};

export const AGENT_DETAIL_TABS: Array<{ id: AgentDetailTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "behavior", label: "Identity" },
  { id: "knowledge", label: "Knowledge" },
  { id: "capabilities", label: "Capabilities" },
  { id: "intelligence", label: "Intelligence" },
  { id: "channels", label: "Connections" },
  { id: "sessions", label: "Activity" }
];

export const EMPLOYEE_SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "knowledge", label: "Knowledge" },
  { id: "capabilities", label: "Capabilities" },
  { id: "sessions", label: "Activity" },
  { id: "settings", label: "Settings" }
] as const;

export function getEmployeeSection(tab: AgentDetailTab) {
  return tab === "behavior" || tab === "intelligence" || tab === "channels" ? "settings" : tab;
}

export function parseAgentDetailTab(value: string | null | undefined): AgentDetailTab {
  return value === "settings" || AGENT_DETAIL_TABS.some((tab) => tab.id === value) ? value as AgentDetailTab : "overview";
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
