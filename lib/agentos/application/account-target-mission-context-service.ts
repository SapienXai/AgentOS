import "server-only";

import { listAccountLoginTargets } from "@/lib/agentos/application/account-login-target-service";
import {
  getBrowserAccount,
  listBrowserAccounts,
  resolveBrowserAccountAccessGrant,
  type BrowserAccountActor
} from "@/lib/agentos/application/browser-account-service";
import { inferBrowserServiceId } from "@/lib/agentos/browser-accounts/service-registry";
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
    if (!resolveBrowserAccountAccessGrant(account, input.agentId)) {
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

  const accounts = await listBrowserAccounts({
    actor: input.actor,
    workspaceId: input.workspaceId
  });
  const targetServiceId = inferBrowserServiceId({
    serviceId: target.serviceId,
    serviceName: target.serviceName,
    primaryDomain: target.primaryDomain
  });
  const exactProfileMatches = accounts.filter((entry) => entry.browserProfileId === target.browserProfileName);
  const domainMatches = accounts.filter((entry) =>
    entry.serviceId === targetServiceId &&
    entry.primaryDomain === target.primaryDomain
  );
  const matches = exactProfileMatches.length ? exactProfileMatches : domainMatches;
  if (matches.length > 1) {
    throw new Error("Multiple browser account identities match this legacy target. Select a canonical browser account explicitly.");
  }
  const account = matches[0];
  if (!account) {
    throw new Error(
      "This legacy login target is not backed by a Secure Browser Account. Reconnect it as a canonical browser account before agent use."
    );
  }
  if (!resolveBrowserAccountAccessGrant(account, input.agentId)) {
    throw new Error("This agent is not allowed to use the selected browser account.");
  }
  return {
    accountId: account.id,
    actorUserId: input.actor.userId
  };
}
