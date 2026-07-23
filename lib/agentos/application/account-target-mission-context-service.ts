import "server-only";

import { resolveAccountAccessDecision } from "@/lib/agentos/application/account-access-policy-service";
import { listAccountLoginTargets } from "@/lib/agentos/application/account-login-target-service";
import { getBrowserAccount, listBrowserAccounts, type BrowserAccountActor } from "@/lib/agentos/application/browser-account-service";
import type { BrowserTaskBindingRequest } from "@/lib/agentos/application/browser-task-binding-service";

export async function resolveAccountTargetMissionBinding(input: {
  actor: BrowserAccountActor;
  workspaceId?: string;
  agentId?: string;
  accountTargetId?: string;
  browserAccountId?: string;
}): Promise<BrowserTaskBindingRequest> {
  if (!input.workspaceId) {
    throw new Error("Workspace id is required when running a task with an account target.");
  }

  if (!input.agentId) {
    throw new Error("Select an agent before running a task with an account target.");
  }

  if (input.browserAccountId) {
    const account = await getBrowserAccount({
      actor: input.actor,
      accountId: input.browserAccountId,
      workspaceId: input.workspaceId
    });
    if (!account.allowedAgentIds.includes(input.agentId)) {
      throw new Error("This agent is not allowed to use the selected browser account.");
    }
    return {
      accountId: account.id,
      actorUserId: input.actor.userId
    };
  }

  if (!input.accountTargetId) {
    throw new Error("A browser account or account target is required.");
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

  const accounts = await listBrowserAccounts({
    actor: input.actor,
    workspaceId: input.workspaceId
  });
  const account = accounts.find((entry) =>
    entry.browserProfileId === target.browserProfileName ||
    (
      entry.primaryDomain === target.primaryDomain &&
      entry.allowedAgentIds.includes(input.agentId!)
    )
  );
  if (!account) {
    throw new Error(
      "This legacy login target is not backed by a Secure Browser Account. Reconnect it with Secure Self-hosted Browser before agent use."
    );
  }
  if (!account.allowedAgentIds.includes(input.agentId)) {
    throw new Error("This agent is not allowed to use the selected browser account.");
  }
  return {
    accountId: account.id,
    actorUserId: input.actor.userId
  };
}
