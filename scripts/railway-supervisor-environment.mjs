const agentosGatewayEnvironmentAllowlist = new Set([
  "AGENTOS_BROWSER_POLICY_HEARTBEAT_URL",
  "AGENTOS_BROWSER_POLICY_READY_PATH",
  "AGENTOS_BROWSER_POLICY_TOKEN",
  "AGENTOS_MISSION_CONTROL_ROOT"
]);

/**
 * Keep AgentOS-only credentials out of the OpenClaw process environment while
 * preserving OpenClaw and provider environment variables configured by the
 * operator.
 */
export function buildGatewayEnvironment(environment = process.env, overrides = {}) {
  const filtered = Object.fromEntries(
    Object.entries(environment).filter(([name]) =>
      !name.startsWith("AGENTOS_") || agentosGatewayEnvironmentAllowlist.has(name)
    )
  );

  return {
    ...filtered,
    ...overrides
  };
}
