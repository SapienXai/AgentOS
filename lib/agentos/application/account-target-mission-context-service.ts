import "server-only";

import type { AccountLoginTargetView } from "@/lib/agentos/account-login-target-types";
import { resolveAccountAccessDecision } from "@/lib/agentos/application/account-access-policy-service";
import { listAccountLoginTargets } from "@/lib/agentos/application/account-login-target-service";
import { redactSecretText } from "@/lib/security/redaction";

export async function resolveAccountTargetMissionContext(input: {
  workspaceId?: string;
  agentId?: string;
  accountTargetId: string;
}) {
  if (!input.workspaceId) {
    throw new Error("Workspace id is required when running a task with an account target.");
  }

  if (!input.agentId) {
    throw new Error("Select an agent before running a task with an account target.");
  }

  const targetsResponse = await listAccountLoginTargets({ workspaceId: input.workspaceId });
  const target = targetsResponse.targets.find((entry) => entry.id === input.accountTargetId);

  if (!target) {
    throw new Error("The selected account target was not found in this workspace.");
  }

  const decision = await resolveAccountAccessDecision({
    workspaceId: input.workspaceId,
    targetId: target.id,
    agentId: input.agentId
  });

  if (decision.approvalRequired) {
    throw new Error("This account target requires approval, but account approval dispatch is not exposed yet.");
  }

  if (!decision.allowed) {
    throw new Error(decision.error ?? "This agent is not allowed to use the selected account target.");
  }

  return buildAccountTargetMissionContext(target);
}

export function buildAccountTargetMissionContext(target: Pick<
  AccountLoginTargetView,
  "serviceName" | "primaryDomain" | "browserProfileName"
>) {
  return [
    "[AgentOS account target]",
    `Service: ${formatContextValue(target.serviceName)}`,
    `Domain: ${formatContextValue(target.primaryDomain)}`,
    `OpenClaw browser profile: ${formatContextValue(target.browserProfileName)}`,
    "AgentOS account-target context is an MVP bridge until OpenClaw exposes typed browser-profile dispatch.",
    "Use this existing browser profile/session only if the available browser tools support profile selection.",
    "Do not ask for, print, store, or expose credentials, passwords, tokens, cookies, secrets, session data, query parameters, or URL fragments.",
    "If the browser tool cannot select this profile, stop and report that OpenClaw profile selection is not exposed for this dispatch path."
  ].join("\n");
}

function formatContextValue(value: string) {
  const safe = redactSecretText(value).replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return safe ? safe.slice(0, 160) : "Not reported";
}
