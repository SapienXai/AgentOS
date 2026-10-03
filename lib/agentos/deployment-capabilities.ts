import { existsSync } from "node:fs";
import path from "node:path";

export type AgentOsDeploymentPlatform = "local" | "railway" | "unknown";
export type AgentOsApplicationUpdateOwner = "desktop" | "release-launcher" | "package-manager" | "deployment" | "source" | "unknown";
export type AgentOsDesktopBundle = "macos" | "windows-nsis" | "linux-appimage" | "linux-package" | "unknown";

export type AgentOsDeploymentCapabilities = {
  platform: AgentOsDeploymentPlatform;
  applicationUpdateOwner: AgentOsApplicationUpdateOwner;
  desktopBundle: AgentOsDesktopBundle;
  gatewayLifecycle: "agentos-managed" | "external-supervisor" | "unavailable" | "unknown";
  gatewayConfigOwnership: "agentos-managed" | "external" | "unknown";
  terminalAccess: "macos" | "unavailable";
  browserAutomation: "local-visible" | "server-headless" | "unknown";
  interactiveBrowserLogin: "supported" | "unavailable";
  existingBrowserSession: "supported" | "unavailable";
  hostFileActions: "supported" | "unavailable";
};

export const unknownDeploymentCapabilities: AgentOsDeploymentCapabilities = {
  platform: "unknown",
  applicationUpdateOwner: "unknown",
  desktopBundle: "unknown",
  gatewayLifecycle: "unknown",
  gatewayConfigOwnership: "unknown",
  terminalAccess: "unavailable",
  browserAutomation: "unknown",
  interactiveBrowserLogin: "unavailable",
  existingBrowserSession: "unavailable",
  hostFileActions: "unavailable"
};

export function resolveAgentOsDeploymentCapabilities(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform = process.platform,
  cwd = process.cwd()
): AgentOsDeploymentCapabilities {
  const deploymentPlatform = env.AGENTOS_DEPLOYMENT_PLATFORM?.trim().toLowerCase();
  const supervisorMode = env.OPENCLAW_SUPERVISOR_MODE?.trim().toLowerCase();
  const configuredConfigOwnership = env.AGENTOS_GATEWAY_CONFIG_OWNERSHIP?.trim().toLowerCase();
  const applicationUpdateOwner = resolveAgentOsApplicationUpdateOwner(env, platform, cwd);
  const desktopBundle = resolveAgentOsDesktopBundle(env, platform);

  if (deploymentPlatform && deploymentPlatform !== "local" && deploymentPlatform !== "railway") {
    return unknownDeploymentCapabilities;
  }

  if (configuredConfigOwnership && !["agentos-managed", "external", "unknown"].includes(configuredConfigOwnership)) {
    return unknownDeploymentCapabilities;
  }

  const gatewayConfigOwnership = configuredConfigOwnership === "agentos-managed" || configuredConfigOwnership === "external" || configuredConfigOwnership === "unknown"
    ? configuredConfigOwnership
    : deploymentPlatform === "railway"
      ? "agentos-managed"
      : supervisorMode === "external"
        ? "unknown"
        : deploymentPlatform === "local" || !deploymentPlatform
          ? "agentos-managed"
          : "unknown";

  if (deploymentPlatform === "railway" || supervisorMode === "external") {
    return {
      platform: deploymentPlatform === "railway" ? "railway" : "local",
      applicationUpdateOwner,
      desktopBundle,
      gatewayLifecycle: "external-supervisor",
      gatewayConfigOwnership,
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
    applicationUpdateOwner,
    desktopBundle,
    gatewayLifecycle: "agentos-managed",
    gatewayConfigOwnership,
    terminalAccess: platform === "darwin" ? "macos" : "unavailable",
    browserAutomation: "local-visible",
    interactiveBrowserLogin: "supported",
    existingBrowserSession: "supported",
    hostFileActions: platform === "darwin" ? "supported" : "unavailable"
  };
}

export function resolveAgentOsApplicationUpdateOwner(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform = process.platform,
  cwd = process.cwd()
): AgentOsApplicationUpdateOwner {
  const deploymentPlatform = env.AGENTOS_DEPLOYMENT_PLATFORM?.trim().toLowerCase();
  if (deploymentPlatform === "railway" || Boolean(env.RAILWAY_ENVIRONMENT_ID)) return "deployment";
  if (env.AGENTOS_DESKTOP === "1" && env.AGENTOS_PACKAGE_RUNTIME === "1") return "desktop";
  const launcherOwner = env.AGENTOS_INSTALLATION_OWNER?.trim().toLowerCase();
  if (launcherOwner === "release-launcher" || launcherOwner === "package-manager" || launcherOwner === "source") {
    return launcherOwner;
  }
  if (env.AGENTOS_PACKAGE_RUNTIME === "1" && env.AGENTOS_LAUNCHER_PID) return "release-launcher";

  const inSourceCheckout = existsAgentOsSourceLayout(cwd);
  if (inSourceCheckout && env.AGENTOS_PACKAGE_RUNTIME !== "1") return "source";

  const packageManager = `${env.npm_config_user_agent ?? ""} ${env.npm_execpath ?? ""}`.toLowerCase();
  if (/\bpnpm\b/.test(packageManager)) return "package-manager";
  if (/\bnpm\b/.test(packageManager)) return "package-manager";
  if (platform === "win32" || platform === "darwin" || platform === "linux") return "unknown";
  return "unknown";
}

export function resolveAgentOsDesktopBundle(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform = process.platform
): AgentOsDesktopBundle {
  if (env.AGENTOS_DESKTOP !== "1") return "unknown";
  const configured = env.AGENTOS_DESKTOP_BUNDLE?.trim().toLowerCase();
  if (configured === "macos" || configured === "windows-nsis" || configured === "linux-appimage" || configured === "linux-package") {
    return configured;
  }
  if (platform === "darwin") return "macos";
  if (platform === "win32") return "windows-nsis";
  if (platform === "linux") return env.APPIMAGE ? "linux-appimage" : "unknown";
  return "unknown";
}

function existsAgentOsSourceLayout(cwd: string) {
  try {
    return requireSourcePackage(path.join(cwd, "packages", "agentos", "package.json"));
  } catch {
    return false;
  }
}

function requireSourcePackage(packagePath: string) {
  return existsSync(packagePath);
}
