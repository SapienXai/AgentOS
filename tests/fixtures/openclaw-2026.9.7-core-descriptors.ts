// Descriptor rows copied from OpenClaw v2026.9.7 src/gateway/methods/core-descriptors.ts.
export const OPENCLAW_2026_9_7_CORE_DESCRIPTOR_FIXTURE = `
const CORE_GATEWAY_METHOD_SPECS = [
  ["exec.approval.waitDecision", null, "operator.approvals", "<=2026.7", { lifetime: "observation" }],
  ["question.waitAnswer", null, "operator.questions", "2026.7", { lifetime: "observation" }],
  ["plugin.approval.waitDecision", null, "operator.approvals", "<=2026.7", { lifetime: "observation" }],
  ["agent.wait", "agent", "operator.write", "<=2026.7", { startup: true, lifetime: "observation" }],
  ["device.scopes.waitUpgrade", "devices", "operator.read", "2026.8", { lifetime: "observation" }],
  ["portal.session.list", "portals", "operator.write", "2026.9", { sessionAccess: { mode: "write", allowOwnSessionScope: true, requiredTool: "portal" } }],
  ["portal.session.open", "portals", "operator.write", "2026.9", { sessionAccess: { mode: "write", allowOwnSessionScope: true, requiredTool: "portal" } }],
  ["portal.session.close", "portals", "operator.write", "2026.9", { sessionAccess: { mode: "write", allowOwnSessionScope: true, requiredTool: "portal" } }],
] as const;
`;
