import "server-only";

import agentOsPackage from "../../packages/agentos/package.json";

const agentOsVersion = typeof agentOsPackage.version === "string" ? agentOsPackage.version.trim() : "";

if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(agentOsVersion)) {
  throw new Error("The AgentOS build does not contain a valid stable product version.");
}

export async function resolveAgentOsVersion() {
  return agentOsVersion;
}
