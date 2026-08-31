export type AgentOsDeploymentPlatform = "local" | "railway" | "unknown";

export type AgentOsDeploymentCapabilities = {
  platform: AgentOsDeploymentPlatform;
  gatewayLifecycle: "agentos-managed" | "external-supervisor" | "unavailable" | "unknown";
  terminalAccess: "macos" | "unavailable";
  browserAutomation: "local-visible" | "server-headless" | "unknown";
  interactiveBrowserLogin: "supported" | "unavailable";
  existingBrowserSession: "supported" | "unavailable";
  hostFileActions: "supported" | "unavailable";
};

export const unknownDeploymentCapabilities: AgentOsDeploymentCapabilities = {
  platform: "unknown",
  gatewayLifecycle: "unknown",
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
  const deploymentPlatform = env.AGENTOS_DEPLOYMENT_PLATFORM?.trim().toLowerCase();
  const supervisorMode = env.OPENCLAW_SUPERVISOR_MODE?.trim().toLowerCase();

  if (deploymentPlatform && deploymentPlatform !== "local" && deploymentPlatform !== "railway") {
    return unknownDeploymentCapabilities;
  }

  if (deploymentPlatform === "railway" || supervisorMode === "external") {
    return {
      platform: deploymentPlatform === "railway" ? "railway" : "local",
      gatewayLifecycle: "external-supervisor",
      terminalAccess: "unavailable",
      browserAutomation: "server-headless",
      interactiveBrowserLogin: "unavailable",
      existingBrowserSession: "unavailable",
      hostFileActions: "unavailable"
    };
  }

  if (supervisorMode && supervisorMode !== "agentos-managed") {
    return unknownDeploymentCapabilities;
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
