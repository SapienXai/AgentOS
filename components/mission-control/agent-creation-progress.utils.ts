export type AgentCreationProgressState = "creating" | "syncing" | "complete";
export type AgentCreationCardPhase = "pending" | "online";

type AgentCreationStepStatus = "pending" | "active" | "done";

export type AgentCreationProgressStep = {
  id: "identity" | "openclaw" | "workspace" | "online";
  label: string;
  description: string;
  status: AgentCreationStepStatus;
};

const progressStageByState: Record<AgentCreationProgressState, number> = {
  creating: 1,
  syncing: 2,
  complete: 4
};

const progressPercentByState: Record<AgentCreationProgressState, number> = {
  creating: 42,
  syncing: 78,
  complete: 100
};

/**
 * The steps represent lifecycle milestones known to the client. They are not
 * pretending to be byte-level backend progress; each transition maps to a
 * real client/server boundary in the create flow.
 */
export function resolveAgentCreationProgressSteps(
  state: AgentCreationProgressState,
  hasChannelBindings: boolean
): AgentCreationProgressStep[] {
  const activeStage = progressStageByState[state];
  const workspaceLabel = hasChannelBindings ? "Linking workspace routes" : "Joining workspace";
  const workspaceDescription = hasChannelBindings
    ? "The selected workspace routes are being attached after OpenClaw provisions the agent."
    : "AgentOS is refreshing the workspace snapshot so the new agent can appear on the canvas.";

  return [
    {
      id: "identity",
      label: "Identity drafted",
      description: "Role, mission, and safe access defaults are ready to send.",
      status: activeStage > 0 ? "done" : "active"
    },
    {
      id: "openclaw",
      label: "Provisioning in OpenClaw",
      description: "The native agent profile and runtime configuration are being written.",
      status: activeStage > 1 ? "done" : activeStage === 1 ? "active" : "pending"
    },
    {
      id: "workspace",
      label: workspaceLabel,
      description: workspaceDescription,
      status: activeStage > 2 ? "done" : activeStage === 2 ? "active" : "pending"
    },
    {
      id: "online",
      label: "Live on canvas",
      description: "The live Mission Control snapshot will welcome the new agent.",
      status: activeStage >= 4 ? "done" : "pending"
    }
  ];
}

export function resolveAgentCreationProgressPercent(state: AgentCreationProgressState) {
  return progressPercentByState[state];
}
