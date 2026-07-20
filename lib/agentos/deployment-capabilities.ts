export type AgentOsDeploymentPlatform = "local" | "railway" | "unknown";

export type AgentOsDeploymentCapabilities = {
  platform: AgentOsDeploymentPlatform;
  gatewayLifecycle: "agentos-managed" | "supervisor-managed" | "unavailable";
  terminalAccess: "macos" | "unavailable";
  browserAutomation: "local-visible" | "server-headless" | "unknown";
  interactiveBrowserLogin: "supported" | "unavailable";
  existingBrowserSession: "supported" | "unavailable";
  hostFileActions: "supported" | "unavailable";
};

export const unknownDeploymentCapabilities: AgentOsDeploymentCapabilities = {
  platform: "unknown",
  gatewayLifecycle: "unavailable",
  terminalAccess: "unavailable",
  browserAutomation: "unknown",
  interactiveBrowserLogin: "unavailable",
  existingBrowserSession: "unavailable",
  hostFileActions: "unavailable"
};

export function resolveAgentOsDeploymentCapabilities(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform = process.platform
): AgentOsDeploymentCapabilities {
  if (env.AGENTOS_DEPLOYMENT_PLATFORM?.trim().toLowerCase() === "railway") {
    return {
      platform: "railway",
      gatewayLifecycle: "supervisor-managed",
      terminalAccess: "unavailable",
      browserAutomation: "server-headless",
      interactiveBrowserLogin: "unavailable",
      existingBrowserSession: "unavailable",
      hostFileActions: "unavailable"
    };
  }

  return {
    platform: "local",
    gatewayLifecycle: "agentos-managed",
    terminalAccess: platform === "darwin" ? "macos" : "unavailable",
    browserAutomation: "local-visible",
    interactiveBrowserLogin: "supported",
    existingBrowserSession: "supported",
    hostFileActions: platform === "darwin" ? "supported" : "unavailable"
  };
}
