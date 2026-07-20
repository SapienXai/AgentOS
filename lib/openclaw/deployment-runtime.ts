import { resolveAgentOsDeploymentCapabilities } from "@/lib/agentos/deployment-capabilities";

export function isRailwayManagedRuntime(
  env: Readonly<Record<string, string | undefined>> = process.env
) {
  return resolveAgentOsDeploymentCapabilities(env).platform === "railway";
}
