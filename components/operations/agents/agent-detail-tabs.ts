export type AgentDetailTab = "overview" | "behavior" | "capabilities" | "channels" | "sessions";

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
