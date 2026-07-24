import "server-only";

import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getBrowserProvider } from "@/lib/agentos/browser-accounts/provider-registry";
import type {
  BrowserAccountAuditEvent,
  BrowserAccountAuditEventType,
  BrowserAccountLease,
  BrowserAccountProviderId,
  BrowserAccountRecord,
  BrowserAuthenticationStatus,
  BrowserLiveViewRecord
} from "@/lib/agentos/browser-accounts/types";
import { missionControlRootPath } from "@/lib/openclaw/state/paths";

type BrowserAccountRegistry = {
  version: 1;
  fencingCounter: number;
  accounts: BrowserAccountRecord[];
  liveViews: BrowserLiveViewRecord[];
  audit: BrowserAccountAuditEvent[];
};

export type BrowserAccountActor = {
  userId: string;
};

let registryRootOverride: string | null = null;
const registryLockStaleMs = 15_000;
const registryLockWaitMs = 5_000;
const defaultLeaseTtlMs = 2 * 60_000;
const liveViewExchangeTtlMs = 2 * 60_000;
const liveViewSessionTtlMs = 20 * 60_000;
const maxAuditEvents = 1_000;
const maxLiveViewRecords = 200;

export async function getBrowserAccountCapabilities(
  provider: BrowserAccountProviderId = "self-hosted-openclaw"
) {
  return getBrowserProvider(provider).getCapabilities();
}

export async function listBrowserAccounts(input: {
  actor: BrowserAccountActor;
  workspaceId?: string | null;
}) {
  const registry = await readRegistry();
  const workspaceId = normalizeOptionalId(input.workspaceId);
  return registry.accounts
    .filter((account) =>
      account.ownerUserId === normalizeActor(input.actor).userId &&
      (!workspaceId || account.workspaceId === workspaceId)
    )
    .map(toBrowserAccountView)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function getBrowserAccount(input: {
  actor: BrowserAccountActor;
  accountId: string;
  workspaceId: string;
}) {
  const registry = await readRegistry();
  const account = requireOwnedAccount(registry, input);
  return toBrowserAccountView(account);
}

export async function createBrowserAccount(input: {
  actor: BrowserAccountActor;
  workspaceId: string;
  serviceName: string;
  primaryDomain: string;
  allowedAgentIds?: string[];
  allowedDomains?: string[];
  provider?: BrowserAccountProviderId;
}) {
  const actor = normalizeActor(input.actor);
  const workspaceId = requireId(input.workspaceId, "Workspace id");
  const primaryDomain = normalizeDomain(input.primaryDomain);
  const providerId = input.provider ?? "self-hosted-openclaw";
  const accountId = randomUUID();
  const browserProfileId = buildBrowserProfileId({
    ownerUserId: actor.userId,
    workspaceId,
    accountId
  });
  const provider = getBrowserProvider(providerId);
  const capabilities = await provider.getCapabilities();

  if (capabilities.profileCreation !== "supported") {
    throw new BrowserAccountError(
      capabilities.reason ?? "Browser profile creation is unavailable.",
      409,
      "provider-unsupported"
    );
  }

  const profile = await provider.createProfile({ browserProfileId });
  const now = new Date().toISOString();
  const account: BrowserAccountRecord = {
    id: accountId,
    provider: providerId,
    connectionType: "browser_profile",
    externalProfileId: profile.externalProfileId,
    browserProfileId: profile.browserProfileId,
    workspaceId,
    ownerUserId: actor.userId,
    allowedAgentIds: normalizeIds(input.allowedAgentIds),
    allowedDomains: normalizeDomains(input.allowedDomains?.length ? input.allowedDomains : [primaryDomain]),
    connectionStatus:
      capabilities.liveView === "supported" &&
      capabilities.humanTakeover === "supported"
        ? "needs_verification"
        : "unsupported",
    verificationSource: "unknown",
    lastVerifiedAt: null,
    lastUsedAt: null,
    sessionState: "idle",
    concurrencyLease: null,
    secretReference: null,
    riskLevel: "elevated",
    approvalPolicy: "block_sensitive",
    serviceName: normalizeLabel(input.serviceName, "Service name"),
    primaryDomain,
    source: profile.source === "native-openclaw"
      ? "openclaw.browser.request"
      : profile.source === "self-hosted-worker"
        ? "self-hosted-worker"
        : "agentos.browser-gateway",
    createdAt: now,
    updatedAt: now,
    revokedAt: null
  };

  try {
    await mutateRegistry((registry) => {
      registry.accounts.push(account);
      appendAudit(registry, account, actor.userId, "profile_created", {
        detail: "A dedicated browser profile was created without storing credentials."
      });
    });
  } catch (error) {
    try {
      await provider.revokeProfile({ browserProfileId: profile.browserProfileId });
    } catch {
      // The original durable-state failure remains the actionable error.
    }
    throw error;
  }

  return {
    account: toBrowserAccountView(account),
    capabilities
  };
}

export async function confirmBrowserAccountLogin(input: {
  actor: BrowserAccountActor;
  accountId: string;
  workspaceId: string;
  providerSessionId?: string;
  now?: Date;
}) {
  const actor = normalizeActor(input.actor);
  const now = input.now ?? new Date();
  let authenticationStatus: BrowserAuthenticationStatus = "unknown";
  let providerVerifiedAt: string | null = null;

  if (input.providerSessionId) {
    const registry = await readRegistry();
    const account = requireOwnedAccount(registry, input);
    const liveView = registry.liveViews.find((entry) =>
      entry.accountId === account.id &&
      entry.providerSessionId === input.providerSessionId &&
      entry.ownerUserId === actor.userId &&
      !entry.revokedAt
    );
    if (
      !liveView ||
      Date.parse(liveView.sessionExpiresAt) <= now.getTime() ||
      account.concurrencyLease?.leaseId !== liveView.leaseId ||
      account.concurrencyLease.fencingToken !== liveView.fencingToken
    ) {
      throw new BrowserAccountError(
        "The browser login session is invalid or expired.",
        409,
        "browser-verification-session-invalid"
      );
    }
    try {
      const verification = await getBrowserProvider(account.provider).verifyAuthentication({
        sessionId: liveView.providerSessionId,
        allowedDomains: account.allowedDomains
      });
      authenticationStatus = verification.status;
      providerVerifiedAt = verification.verifiedAt;
    } catch {
      authenticationStatus = "unknown";
    }
  }

  const confirmedAt = now.toISOString();
  let result: BrowserAccountRecord | null = null;

  await mutateRegistry((registry) => {
    const account = requireOwnedAccount(registry, input);
    assertAccountUsable(account, { allowExpired: true });
    account.connectionStatus =
      authenticationStatus === "verified"
        ? "connected"
        : authenticationStatus === "expired"
          ? "expired"
          : "needs_verification";
    account.verificationSource =
      authenticationStatus === "verified" ? "provider_verified" : "user_confirmed";
    account.lastVerifiedAt =
      authenticationStatus === "verified"
        ? providerVerifiedAt ?? confirmedAt
        : authenticationStatus === "expired"
          ? null
          : confirmedAt;
    account.updatedAt = confirmedAt;
    appendAudit(registry, account, input.actor.userId, "login_user_confirmed", {
      detail:
        authenticationStatus === "verified"
          ? "The operator confirmed login and the provider-specific authentication marker matched."
          : "The operator confirmed login; provider authentication was not independently verified."
    });
    if (authenticationStatus === "verified") {
      appendAudit(registry, account, actor.userId, "authentication_verified", {
        detail: "A provider-specific browser marker verified the authenticated session."
      });
    } else if (authenticationStatus === "expired") {
      appendAudit(registry, account, actor.userId, "authentication_expired", {
        detail: "The browser authentication session is expired."
      });
    } else if (
      authenticationStatus === "unverified" ||
      authenticationStatus === "needs_user_action"
    ) {
      appendAudit(registry, account, actor.userId, "authentication_failed", {
        detail: "The provider-specific authentication marker was not present."
      });
    }
    result = account;
  });

  return {
    ...toBrowserAccountView(result!),
    authenticationStatus
  };
}

export async function updateBrowserAccountAccess(input: {
  actor: BrowserAccountActor;
  accountId: string;
  workspaceId: string;
  allowedAgentIds: string[];
  allowedDomains: string[];
  now?: Date;
}) {
  const actor = normalizeActor(input.actor);
  const allowedAgentIds = normalizeIds(input.allowedAgentIds);
  const requestedDomains = normalizeDomains(input.allowedDomains);
  const now = input.now ?? new Date();
  let result: BrowserAccountRecord | null = null;

  await mutateRegistry((registry) => {
    const account = requireOwnedAccount(registry, input);
    assertAccountUsable(account);
    if (account.concurrencyLease) {
      const active = Date.parse(account.concurrencyLease.expiresAt) > now.getTime();
      throw new BrowserAccountError(
        active
          ? "Account access cannot change while a browser session holds the profile lease."
          : "Recover the expired browser session before changing account access.",
        409,
        active ? "access-policy-lease-conflict" : "access-policy-recovery-required"
      );
    }

    account.allowedAgentIds = allowedAgentIds;
    account.allowedDomains = normalizeDomains([
      account.primaryDomain,
      ...requestedDomains
    ]);
    account.updatedAt = now.toISOString();
    appendAudit(registry, account, actor.userId, "access_policy_updated", {
      detail: `Browser access policy updated for ${allowedAgentIds.length} agent(s) and ${account.allowedDomains.length} domain(s).`
    });
    result = account;
  });

  return toBrowserAccountView(result!);
}

export async function recordBrowserAuthenticationVerification(input: {
  actor: BrowserAccountActor;
  accountId: string;
  workspaceId: string;
  status: BrowserAuthenticationStatus;
  verifiedAt: string | null;
}) {
  if (input.status === "unknown") {
    return getBrowserAccount(input);
  }
  let result: BrowserAccountRecord | null = null;
  await mutateRegistry((registry) => {
    const account = requireOwnedAccount(registry, input);
    const now = new Date().toISOString();
    if (input.status === "verified") {
      account.connectionStatus = "connected";
      account.verificationSource = "provider_verified";
      account.lastVerifiedAt = input.verifiedAt ?? now;
      appendAudit(registry, account, input.actor.userId, "authentication_verified", {
        detail: "The provider-specific authentication marker was revalidated before task use."
      });
    } else {
      account.connectionStatus = "expired";
      account.verificationSource = "unknown";
      account.lastVerifiedAt = null;
      appendAudit(
        registry,
        account,
        input.actor.userId,
        input.status === "expired" ? "authentication_expired" : "authentication_failed",
        {
          detail: "Browser authentication could not be revalidated; reconnect is required."
        }
      );
    }
    account.updatedAt = now;
    result = account;
  });
  return toBrowserAccountView(result!);
}

export async function startBrowserAccountLiveView(input: {
  actor: BrowserAccountActor;
  accountId: string;
  workspaceId: string;
  now?: Date;
}) {
  const actor = normalizeActor(input.actor);
  const now = input.now ?? new Date();
  const registry = await readRegistry();
  const existing = requireOwnedAccount(registry, input);
  assertAccountUsable(existing, { allowExpired: true });
  const provider = getBrowserProvider(existing.provider);
  const capabilities = await provider.getCapabilities();
  if (capabilities.liveView !== "supported" || capabilities.humanTakeover !== "supported") {
    throw new BrowserAccountError(
      capabilities.reason ?? "Secure browser Live View is unavailable.",
      409,
      "live-view-unsupported"
    );
  }

  let lease: BrowserAccountLease | null = null;
  await mutateRegistry((nextRegistry) => {
    const account = requireOwnedAccount(nextRegistry, input);
    assertAccountUsable(account, { allowExpired: true });
    const current = account.concurrencyLease;
    if (current && Date.parse(current.expiresAt) > now.getTime()) {
      throw new BrowserAccountError(
        "The browser account already has an active write session.",
        409,
        "profile-lease-conflict"
      );
    }
    if (current) {
      appendAudit(nextRegistry, account, actor.userId, "lease_expired", {
        agentId: current.holderAgentId,
        taskId: current.holderTaskId,
        detail: "A stale browser profile lease expired and was fenced."
      });
    }

    nextRegistry.fencingCounter += 1;
    lease = {
      leaseId: randomUUID(),
      holderTaskId: `connect:${account.id}`,
      holderAgentId: `operator:${actor.userId}`,
      acquiredAt: now.toISOString(),
      heartbeatAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + liveViewSessionTtlMs).toISOString(),
      fencingToken: nextRegistry.fencingCounter
    };
    account.concurrencyLease = lease;
    account.sessionState = "starting";
    account.updatedAt = now.toISOString();
    appendAudit(nextRegistry, account, actor.userId, "lease_acquired", {
      detail: "An exclusive operator Live View lease was acquired."
    });
  });

  try {
    const session = await provider.startSession({
      browserProfileId: existing.browserProfileId,
      initialUrl: `https://${existing.primaryDomain}`
    });
    await provider.getLiveView({ sessionId: session.sessionId });
    const capabilityId = randomUUID();
    const capabilityToken = randomBytes(32).toString("base64url");
    const issuedAt = new Date().toISOString();
    const exchangeExpiresAt = new Date(Date.now() + liveViewExchangeTtlMs).toISOString();
    const sessionExpiresAt = new Date(Date.now() + liveViewSessionTtlMs).toISOString();

    await mutateRegistry((nextRegistry) => {
      const account = requireOwnedAccount(nextRegistry, input);
      const current = requireMatchingLease(
        account,
        lease!.leaseId,
        lease!.fencingToken,
        now
      );
      current.heartbeatAt = issuedAt;
      current.expiresAt = sessionExpiresAt;
      account.sessionState = "active";
      account.updatedAt = issuedAt;
      nextRegistry.liveViews.unshift({
        id: capabilityId,
        accountId: account.id,
        workspaceId: account.workspaceId,
        ownerUserId: actor.userId,
        providerSessionId: session.sessionId,
        tokenHash: hashLiveViewSecret("exchange", capabilityToken),
        credentialHash: null,
        issuedAt,
        exchangeExpiresAt,
        exchangedAt: null,
        sessionExpiresAt,
        revokedAt: null,
        leaseId: current.leaseId,
        fencingToken: current.fencingToken
      });
      nextRegistry.liveViews = nextRegistry.liveViews.slice(0, maxLiveViewRecords);
      appendAudit(nextRegistry, account, actor.userId, "browser_session_started", {
        detail: "The private headed Chromium session started."
      });
      appendAudit(nextRegistry, account, actor.userId, "live_view_issued", {
        detail: "A short-lived one-time Live View exchange capability was issued."
      });
    });

    return {
      launchUrl: `/accounts/browser-live#capability=${encodeURIComponent(`${capabilityId}.${capabilityToken}`)}`,
      exchangeExpiresAt,
      sessionExpiresAt
    };
  } catch (error) {
    await mutateRegistry((nextRegistry) => {
      const account = requireOwnedAccount(nextRegistry, input);
      if (
        account.concurrencyLease?.leaseId === lease!.leaseId &&
        account.concurrencyLease.fencingToken === lease!.fencingToken
      ) {
        account.concurrencyLease = null;
        account.sessionState = "recovery_required";
        account.updatedAt = new Date().toISOString();
        appendAudit(nextRegistry, account, actor.userId, "browser_session_crashed", {
          detail: "The private browser session did not start; operator recovery is required."
        });
      }
    });
    throw error;
  }
}

export async function exchangeBrowserLiveViewCapability(input: {
  actor: BrowserAccountActor;
  capability: string;
  now?: Date;
}) {
  const actor = normalizeActor(input.actor);
  const now = input.now ?? new Date();
  const [capabilityId, token, ...rest] = input.capability.split(".");
  if (rest.length || !isUuid(capabilityId) || !isOpaqueSecret(token)) {
    throw new BrowserAccountError("Live View capability is invalid.", 403, "live-view-invalid");
  }

  const credential = randomBytes(32).toString("base64url");
  let result: {
    accountId: string;
    workspaceId: string;
    providerSessionId: string;
    sessionExpiresAt: string;
    cookieName: string;
  } | null = null;

  await mutateRegistry((registry) => {
    const liveView = registry.liveViews.find((entry) => entry.id === capabilityId);
    const account = liveView
      ? registry.accounts.find((entry) => entry.id === liveView.accountId)
      : null;
    if (
      !liveView ||
      !account ||
      liveView.ownerUserId !== actor.userId ||
      account.ownerUserId !== actor.userId ||
      liveView.revokedAt ||
      liveView.exchangedAt ||
      Date.parse(liveView.exchangeExpiresAt) <= now.getTime() ||
      Date.parse(liveView.sessionExpiresAt) <= now.getTime() ||
      !constantTimeHashEqual(liveView.tokenHash, hashLiveViewSecret("exchange", token))
    ) {
      throw new BrowserAccountError(
        "Live View capability is invalid, expired, or already used.",
        403,
        "live-view-invalid"
      );
    }

    liveView.tokenHash = null;
    liveView.credentialHash = hashLiveViewSecret("session", credential);
    liveView.exchangedAt = now.toISOString();
    account.updatedAt = now.toISOString();
    appendAudit(registry, account, actor.userId, "live_view_opened", {
      detail: "The one-time Live View capability was exchanged for a session-bound cookie."
    });
    result = {
      accountId: account.id,
      workspaceId: account.workspaceId,
      providerSessionId: liveView.providerSessionId,
      sessionExpiresAt: liveView.sessionExpiresAt,
      cookieName: buildBrowserLiveViewCookieName(liveView.providerSessionId)
    };
  });

  return {
    ...result!,
    credential,
    viewerPath: `/secure-browser-client.html?path=${encodeURIComponent(
      `api/accounts/browser-live/ws/${result!.providerSessionId}`
    )}`
  };
}

export async function authorizeBrowserLiveViewWebSocket(input: {
  actor: BrowserAccountActor;
  providerSessionId: string;
  credential: string | null;
  now?: Date;
}) {
  const actor = normalizeActor(input.actor);
  const now = input.now ?? new Date();
  if (!isUuid(input.providerSessionId) || !isOpaqueSecret(input.credential ?? "")) {
    throw new BrowserAccountError("Live View session access is denied.", 403, "live-view-denied");
  }
  const registry = await readRegistry();
  const liveView = registry.liveViews.find(
    (entry) => entry.providerSessionId === input.providerSessionId
  );
  const account = liveView
    ? registry.accounts.find((entry) => entry.id === liveView.accountId)
    : null;
  if (
    !liveView ||
    !account ||
    account.ownerUserId !== actor.userId ||
    liveView.ownerUserId !== actor.userId ||
    liveView.revokedAt ||
    !liveView.exchangedAt ||
    Date.parse(liveView.sessionExpiresAt) <= now.getTime() ||
    !constantTimeHashEqual(
      liveView.credentialHash,
      hashLiveViewSecret("session", input.credential!)
    )
  ) {
    throw new BrowserAccountError("Live View session access is denied.", 403, "live-view-denied");
  }
  return { authorized: true as const };
}

export async function stopBrowserAccountLiveView(input: {
  actor: BrowserAccountActor;
  accountId: string;
  workspaceId: string;
  providerSessionId: string;
}) {
  const actor = normalizeActor(input.actor);
  const registry = await readRegistry();
  const existing = requireOwnedAccount(registry, input);
  const liveView = registry.liveViews.find(
    (entry) =>
      entry.accountId === existing.id &&
      entry.providerSessionId === input.providerSessionId &&
      !entry.revokedAt
  );
  if (!liveView) {
    throw new BrowserAccountError("Live View session was not found.", 409, "live-view-not-found");
  }

  let cleanupFailed = false;
  try {
    await getBrowserProvider(existing.provider).stopSession({
      sessionId: liveView.providerSessionId
    });
  } catch {
    cleanupFailed = true;
  }

  await mutateRegistry((nextRegistry) => {
    const account = requireOwnedAccount(nextRegistry, input);
    const currentLiveView = nextRegistry.liveViews.find((entry) => entry.id === liveView.id);
    const now = new Date().toISOString();
    if (currentLiveView) {
      currentLiveView.revokedAt = now;
      currentLiveView.tokenHash = null;
      currentLiveView.credentialHash = null;
    }
    if (
      account.concurrencyLease?.leaseId === liveView.leaseId &&
      account.concurrencyLease.fencingToken === liveView.fencingToken
    ) {
      account.concurrencyLease = null;
    }
    account.sessionState = cleanupFailed ? "recovery_required" : "idle";
    account.lastUsedAt = now;
    account.updatedAt = now;
    appendAudit(nextRegistry, account, actor.userId, "live_view_revoked", {
      detail: "The operator Live View capability was revoked."
    });
    appendAudit(nextRegistry, account, actor.userId, cleanupFailed ? "browser_session_crashed" : "browser_session_stopped", {
      detail: cleanupFailed
        ? "The private browser session could not be stopped cleanly."
        : "The private browser session stopped and profile state remained persistent."
    });
  });

  if (cleanupFailed) {
    throw new BrowserAccountError(
      "The browser session could not be stopped cleanly. Recovery is required.",
      409,
      "browser-session-recovery-required"
    );
  }
}

export async function revokeBrowserAccount(input: {
  actor: BrowserAccountActor;
  accountId: string;
  workspaceId: string;
}) {
  const actor = normalizeActor(input.actor);
  const registry = await readRegistry();
  const existing = requireOwnedAccount(registry, input);
  if (existing.revokedAt) {
    return toBrowserAccountView(existing);
  }

  let cleanupFailed = false;
  try {
    await getBrowserProvider(existing.provider).revokeProfile({
      browserProfileId: existing.browserProfileId
    });
  } catch {
    cleanupFailed = true;
  }

  let result: BrowserAccountRecord | null = null;
  await mutateRegistry((nextRegistry) => {
    const account = requireOwnedAccount(nextRegistry, input);
    const now = new Date().toISOString();
    for (const liveView of nextRegistry.liveViews) {
      if (liveView.accountId !== account.id || liveView.revokedAt) continue;
      liveView.revokedAt = now;
      liveView.tokenHash = null;
      liveView.credentialHash = null;
    }
    account.connectionStatus = "revoked";
    account.sessionState = cleanupFailed ? "recovery_required" : "idle";
    account.concurrencyLease = null;
    account.revokedAt = now;
    account.updatedAt = now;
    appendAudit(nextRegistry, account, actor.userId, "account_revoked", {
      detail: "Account access and active leases were revoked."
    });
    if (cleanupFailed) {
      appendAudit(nextRegistry, account, actor.userId, "profile_cleanup_failed", {
        detail: "OpenClaw profile cleanup could not be confirmed; operator recovery is required."
      });
    }
    result = account;
  });

  return toBrowserAccountView(result!);
}

export async function acquireBrowserAccountLease(input: {
  actor: BrowserAccountActor;
  accountId: string;
  workspaceId: string;
  agentId: string;
  taskId: string;
  ttlMs?: number;
  now?: Date;
}) {
  const actor = normalizeActor(input.actor);
  const agentId = requireId(input.agentId, "Agent id");
  const taskId = requireId(input.taskId, "Task id");
  const accountSnapshot = await readRegistry().then((registry) => requireOwnedAccount(registry, input));
  const capabilities = await getBrowserProvider(accountSnapshot.provider).getCapabilities();
  if (capabilities.typedTaskDispatch !== "supported") {
    throw new BrowserAccountError(
      capabilities.reason ?? "Typed task-bound browser profile dispatch is unavailable.",
      409,
      "browser-dispatch-unsupported"
    );
  }
  const now = input.now ?? new Date();
  const ttlMs = normalizeLeaseTtl(input.ttlMs);
  let lease: BrowserAccountLease | null = null;

  await mutateRegistry((registry) => {
    const account = requireOwnedAccount(registry, input);
    assertAccountUsable(account);
    if (!account.allowedAgentIds.includes(agentId)) {
      throw new BrowserAccountError(
        "This agent is not allowed to use the browser account.",
        403,
        "agent-access-denied"
      );
    }

    const current = account.concurrencyLease;
    if (current && Date.parse(current.expiresAt) > now.getTime()) {
      throw new BrowserAccountError(
        "The browser account already has an active write session.",
        409,
        "profile-lease-conflict"
      );
    }
    if (current) {
      appendAudit(registry, account, actor.userId, "lease_expired", {
        agentId: current.holderAgentId,
        taskId: current.holderTaskId,
        detail: "A stale browser profile lease expired and was fenced."
      });
    }

    registry.fencingCounter += 1;
    lease = {
      leaseId: randomUUID(),
      holderTaskId: taskId,
      holderAgentId: agentId,
      acquiredAt: now.toISOString(),
      heartbeatAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      fencingToken: registry.fencingCounter
    };
    account.concurrencyLease = lease;
    account.sessionState = "starting";
    account.updatedAt = now.toISOString();
    appendAudit(registry, account, actor.userId, "lease_acquired", {
      agentId,
      taskId,
      detail: "An exclusive browser profile write lease was acquired."
    });
  });

  return lease!;
}

export async function renewBrowserAccountLease(input: {
  actor: BrowserAccountActor;
  accountId: string;
  workspaceId: string;
  leaseId: string;
  fencingToken: number;
  ttlMs?: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const ttlMs = normalizeLeaseTtl(input.ttlMs);
  let lease: BrowserAccountLease | null = null;

  await mutateRegistry((registry) => {
    const account = requireOwnedAccount(registry, input);
    const current = requireMatchingLease(account, input.leaseId, input.fencingToken, now);
    current.heartbeatAt = now.toISOString();
    current.expiresAt = new Date(now.getTime() + ttlMs).toISOString();
    account.updatedAt = now.toISOString();
    appendAudit(registry, account, input.actor.userId, "lease_renewed", {
      agentId: current.holderAgentId,
      taskId: current.holderTaskId,
      detail: "The exclusive browser profile lease was renewed."
    });
    lease = current;
  });

  return lease!;
}

export async function releaseBrowserAccountLease(input: {
  actor: BrowserAccountActor;
  accountId: string;
  workspaceId: string;
  leaseId: string;
  fencingToken: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  await mutateRegistry((registry) => {
    const account = requireOwnedAccount(registry, input);
    const current = requireMatchingLease(account, input.leaseId, input.fencingToken, now, true);
    account.concurrencyLease = null;
    account.sessionState = "idle";
    account.lastUsedAt = now.toISOString();
    account.updatedAt = now.toISOString();
    appendAudit(registry, account, input.actor.userId, "lease_released", {
      agentId: current.holderAgentId,
      taskId: current.holderTaskId,
      detail: "The exclusive browser profile lease was released."
    });
  });
}

export async function activateBrowserAccountTaskSession(input: {
  actor: BrowserAccountActor;
  accountId: string;
  workspaceId: string;
  agentId: string;
  taskId: string;
  leaseId: string;
  fencingToken: number;
}) {
  const now = new Date();
  await mutateRegistry((registry) => {
    const account = requireOwnedAccount(registry, input);
    const lease = requireMatchingLease(
      account,
      input.leaseId,
      input.fencingToken,
      now
    );
    if (lease.holderAgentId !== input.agentId || lease.holderTaskId !== input.taskId) {
      throw new BrowserAccountError("The browser profile lease owner changed.", 409, "lease-fenced");
    }
    account.sessionState = "active";
    account.updatedAt = now.toISOString();
    appendAudit(registry, account, input.actor.userId, "browser_session_started", {
      agentId: input.agentId,
      taskId: input.taskId,
      detail: "A private browser session started for an OpenClaw task."
    });
    appendAudit(registry, account, input.actor.userId, "agent_bound", {
      agentId: input.agentId,
      taskId: input.taskId,
      detail: "The browser profile was bound to one OpenClaw task session."
    });
  });
}

export async function completeBrowserAccountTaskSession(input: {
  actor: BrowserAccountActor;
  accountId: string;
  workspaceId: string;
  agentId: string;
  taskId: string;
  providerSessionId: string;
  leaseId: string;
  fencingToken: number;
  configurationCleanupFailed?: boolean;
}) {
  const registry = await readRegistry();
  const existing = requireOwnedAccount(registry, input);
  let cleanupFailed = input.configurationCleanupFailed === true;

  try {
    await getBrowserProvider(existing.provider).stopSession({
      sessionId: input.providerSessionId
    });
  } catch {
    cleanupFailed = true;
  }

  await mutateRegistry((nextRegistry) => {
    const account = requireOwnedAccount(nextRegistry, input);
    const current = account.concurrencyLease;
    const now = new Date().toISOString();
    if (
      current?.leaseId === input.leaseId &&
      current.fencingToken === input.fencingToken
    ) {
      account.concurrencyLease = null;
    }
    account.sessionState = cleanupFailed ? "recovery_required" : "idle";
    account.lastUsedAt = now;
    account.updatedAt = now;
    appendAudit(nextRegistry, account, input.actor.userId, "agent_unbound", {
      agentId: input.agentId,
      taskId: input.taskId,
      detail: "The OpenClaw task browser binding was removed."
    });
    appendAudit(
      nextRegistry,
      account,
      input.actor.userId,
      cleanupFailed ? "browser_session_crashed" : "browser_session_stopped",
      {
        agentId: input.agentId,
        taskId: input.taskId,
        detail: cleanupFailed
          ? "Task browser cleanup was incomplete; operator recovery is required."
          : "The task browser session stopped and its persistent profile was retained."
      }
    );
    if (cleanupFailed) {
      appendAudit(nextRegistry, account, input.actor.userId, "profile_cleanup_failed", {
        agentId: input.agentId,
        taskId: input.taskId,
        detail: "The task browser transport or OpenClaw profile cleanup could not be confirmed."
      });
    }
  });

  return { cleanupFailed };
}

export async function markBrowserWorkerSessionsInterrupted(input: { now?: Date } = {}) {
  const now = (input.now ?? new Date()).toISOString();
  let affectedAccounts = 0;
  await mutateRegistry((registry) => {
    for (const account of registry.accounts) {
      if (
        !account.concurrencyLease ||
        (account.sessionState !== "active" && account.sessionState !== "starting")
      ) {
        continue;
      }
      affectedAccounts += 1;
      account.sessionState = "recovery_required";
      account.concurrencyLease.expiresAt = now;
      account.updatedAt = now;
      for (const liveView of registry.liveViews) {
        if (liveView.accountId !== account.id || liveView.revokedAt) continue;
        liveView.revokedAt = now;
        liveView.tokenHash = null;
        liveView.credentialHash = null;
      }
      appendAudit(registry, account, "system:browser-worker", "browser_session_crashed", {
        agentId: account.concurrencyLease.holderAgentId,
        taskId: account.concurrencyLease.holderTaskId,
        detail: "The private browser worker restarted; the active session was fenced for recovery."
      });
    }
  });
  return { affectedAccounts };
}

export async function listBrowserAccountAudit(input: {
  actor: BrowserAccountActor;
  workspaceId?: string | null;
  accountId?: string | null;
}) {
  const actor = normalizeActor(input.actor);
  const workspaceId = normalizeOptionalId(input.workspaceId);
  const accountId = normalizeOptionalId(input.accountId);
  const registry = await readRegistry();
  const policyAudit = await readBrowserPolicyAudit();
  const ownedAccountIds = new Set(
    registry.accounts
      .filter((account) => account.ownerUserId === actor.userId)
      .map((account) => account.id)
  );

  return [...registry.audit, ...policyAudit].filter((event) =>
    ownedAccountIds.has(event.accountId) &&
    (!workspaceId || event.workspaceId === workspaceId) &&
    (!accountId || event.accountId === accountId)
  ).sort((left, right) => right.at.localeCompare(left.at)).slice(0, maxAuditEvents);
}

export function toBrowserAccountView(account: BrowserAccountRecord) {
  return {
    ...account,
    concurrencyLease: account.concurrencyLease
      ? {
          holderTaskId: account.concurrencyLease.holderTaskId,
          holderAgentId: account.concurrencyLease.holderAgentId,
          acquiredAt: account.concurrencyLease.acquiredAt,
          heartbeatAt: account.concurrencyLease.heartbeatAt,
          expiresAt: account.concurrencyLease.expiresAt,
          fencingToken: account.concurrencyLease.fencingToken
        }
      : null,
    secretReference: account.secretReference ? "configured" : null
  };
}

export function buildBrowserProfileId(input: {
  ownerUserId: string;
  workspaceId: string;
  accountId: string;
}) {
  const digest = createHash("sha256")
    .update(`${input.ownerUserId}\0${input.workspaceId}\0${input.accountId}`)
    .digest("hex")
    .slice(0, 24);
  return `acct-${digest}`;
}

function assertAccountUsable(
  account: BrowserAccountRecord,
  options: { allowExpired?: boolean } = {}
) {
  if (account.revokedAt || account.connectionStatus === "revoked") {
    throw new BrowserAccountError("The browser account has been revoked.", 409, "account-revoked");
  }
  if (account.connectionStatus === "unsupported") {
    throw new BrowserAccountError(
      "Secure Live View and typed task-bound browser dispatch are unavailable for this account.",
      409,
      "browser-dispatch-unsupported"
    );
  }
  if (
    account.connectionStatus === "recovery_required" ||
    account.sessionState === "recovery_required"
  ) {
    throw new BrowserAccountError(
      "Recover or revoke the browser account before starting another session.",
      409,
      "browser-session-recovery-required"
    );
  }
  if (account.connectionStatus === "expired" && !options.allowExpired) {
    throw new BrowserAccountError(
      "Reconnect and verify the browser account before starting another session.",
      409,
      "browser-authentication-expired"
    );
  }
}

function requireMatchingLease(
  account: BrowserAccountRecord,
  leaseId: string,
  fencingToken: number,
  now: Date,
  allowExpired = false
) {
  const lease = account.concurrencyLease;
  if (
    !lease ||
    lease.leaseId !== leaseId ||
    lease.fencingToken !== fencingToken
  ) {
    throw new BrowserAccountError("The browser profile lease is no longer valid.", 409, "lease-fenced");
  }
  if (!allowExpired && Date.parse(lease.expiresAt) <= now.getTime()) {
    throw new BrowserAccountError("The browser profile lease has expired.", 409, "lease-expired");
  }
  return lease;
}

function requireOwnedAccount(
  registry: BrowserAccountRegistry,
  input: { actor: BrowserAccountActor; accountId: string; workspaceId: string }
) {
  const actor = normalizeActor(input.actor);
  const accountId = requireId(input.accountId, "Account id");
  const workspaceId = requireId(input.workspaceId, "Workspace id");
  const account = registry.accounts.find((entry) => entry.id === accountId);
  if (!account || account.ownerUserId !== actor.userId || account.workspaceId !== workspaceId) {
    throw new BrowserAccountError("Browser account access is denied.", 403, "account-access-denied");
  }
  return account;
}

function appendAudit(
  registry: BrowserAccountRegistry,
  account: BrowserAccountRecord,
  actorUserId: string,
  type: BrowserAccountAuditEventType,
  input: {
    agentId?: string | null;
    taskId?: string | null;
    detail: string;
  }
) {
  registry.audit.unshift({
    id: randomUUID(),
    type,
    accountId: account.id,
    workspaceId: account.workspaceId,
    actorUserId: normalizeActor({ userId: actorUserId }).userId,
    agentId: input.agentId ?? null,
    taskId: input.taskId ?? null,
    at: new Date().toISOString(),
    detail: normalizeAuditDetail(input.detail)
  });
  registry.audit = registry.audit.slice(0, maxAuditEvents);
}

async function readRegistry(): Promise<BrowserAccountRegistry> {
  const registryPath = resolveRegistryPath();
  try {
    const parsed = JSON.parse(await readFile(registryPath, "utf8")) as Partial<BrowserAccountRegistry>;
    return {
      version: 1,
      fencingCounter: Number.isSafeInteger(parsed.fencingCounter) ? parsed.fencingCounter! : 0,
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      liveViews: Array.isArray(parsed.liveViews) ? parsed.liveViews.slice(0, maxLiveViewRecords) : [],
      audit: Array.isArray(parsed.audit) ? parsed.audit.slice(0, maxAuditEvents) : []
    };
  } catch (error) {
    if (isFileError(error, "ENOENT")) {
      return { version: 1, fencingCounter: 0, accounts: [], liveViews: [], audit: [] };
    }
    throw new Error("Browser account state could not be read.");
  }
}

async function mutateRegistry(mutator: (registry: BrowserAccountRegistry) => void) {
  return withRegistryLock(async () => {
    const registry = await readRegistry();
    mutator(registry);
    await writeRegistry(registry);
  });
}

async function writeRegistry(registry: BrowserAccountRegistry) {
  const registryPath = resolveRegistryPath();
  await mkdir(path.dirname(registryPath), { recursive: true, mode: 0o700 });
  const tempPath = `${registryPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(registry, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(tempPath, registryPath);
}

async function withRegistryLock<T>(operation: () => Promise<T>) {
  const registryLockPath = resolveRegistryLockPath();
  await mkdir(path.dirname(registryLockPath), { recursive: true, mode: 0o700 });
  const deadline = Date.now() + registryLockWaitMs;

  while (true) {
    try {
      const handle = await open(registryLockPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ createdAt: new Date().toISOString() })}\n`);
      await handle.close();
      break;
    } catch (error) {
      if (!isFileError(error, "EEXIST")) throw error;
      if (await recoverStaleRegistryLock(registryLockPath)) {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new BrowserAccountError(
          "Browser account state is busy. Retry shortly.",
          409,
          "registry-busy"
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  try {
    return await operation();
  } finally {
    await rm(registryLockPath, { force: true });
  }
}

async function recoverStaleRegistryLock(registryLockPath: string) {
  try {
    const parsed = JSON.parse(await readFile(registryLockPath, "utf8")) as { createdAt?: unknown };
    const createdAt = typeof parsed.createdAt === "string" ? Date.parse(parsed.createdAt) : Number.NaN;
    if (Number.isFinite(createdAt) && Date.now() - createdAt <= registryLockStaleMs) {
      return false;
    }
  } catch {
    // A corrupt lock is treated as stale, but it is still claimed atomically below.
  }

  const stalePath = `${registryLockPath}.stale.${randomUUID()}`;
  try {
    await rename(registryLockPath, stalePath);
    await rm(stalePath, { force: true });
    return true;
  } catch (error) {
    if (isFileError(error, "ENOENT")) return false;
    throw error;
  }
}

function normalizeActor(actor: BrowserAccountActor) {
  return { userId: requireId(actor.userId, "Owner user id") };
}

function requireId(value: string, label: string) {
  const normalized = value.trim();
  if (!/^[a-z0-9](?:[a-z0-9_.:@-]{0,126}[a-z0-9])?$/i.test(normalized)) {
    throw new BrowserAccountError(`${label} is invalid.`, 400, "invalid-input");
  }
  return normalized;
}

function normalizeOptionalId(value: string | null | undefined) {
  return value?.trim() ? requireId(value, "Identifier") : null;
}

function normalizeIds(values: string[] | undefined) {
  return [...new Set((values ?? []).map((value) => requireId(value, "Agent id")))].sort();
}

function normalizeDomain(value: string) {
  const candidate = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(candidate)) {
    throw new BrowserAccountError("Domain is invalid.", 400, "invalid-input");
  }
  return candidate;
}

function normalizeDomains(values: string[]) {
  return [...new Set(values.map(normalizeDomain))].sort();
}

function normalizeLabel(value: string, label: string) {
  const normalized = value.trim();
  if (!normalized) throw new BrowserAccountError(`${label} is required.`, 400, "invalid-input");
  return normalized.slice(0, 120);
}

function normalizeLeaseTtl(value: number | undefined) {
  if (value === undefined) return defaultLeaseTtlMs;
  if (!Number.isSafeInteger(value) || value < 15_000 || value > 10 * 60_000) {
    throw new BrowserAccountError("Lease TTL is invalid.", 400, "invalid-input");
  }
  return value;
}

function normalizeAuditDetail(value: string) {
  return value
    .replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/\b(token|password|cookie|secret|otp|cdp)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .slice(0, 240);
}

export function buildBrowserLiveViewCookieName(capabilityId: string) {
  if (!isUuid(capabilityId)) {
    throw new BrowserAccountError("Live View capability id is invalid.", 400, "invalid-input");
  }
  return `agentos_browser_live_${capabilityId.replaceAll("-", "")}`;
}

export function readBrowserLiveViewCookie(headers: Headers, capabilityId: string) {
  const cookieName = buildBrowserLiveViewCookieName(capabilityId);
  const cookieHeader = headers.get("cookie") ?? "";
  for (const entry of cookieHeader.split(";")) {
    const [name, ...parts] = entry.trim().split("=");
    if (name !== cookieName) continue;
    try {
      return decodeURIComponent(parts.join("=")) || null;
    } catch {
      return null;
    }
  }
  return null;
}

function hashLiveViewSecret(purpose: "exchange" | "session", value: string) {
  return createHash("sha256")
    .update(`agentos-browser-live:${purpose}\0${value}`)
    .digest("hex");
}

function constantTimeHashEqual(left: string | null, right: string) {
  if (!left || !/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function isOpaqueSecret(value: string) {
  return /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

function isUuid(value: string | undefined) {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

export function setBrowserAccountRegistryRootForTesting(root: string | null) {
  registryRootOverride = root;
}

export function getBrowserAccountRegistryPathForTesting() {
  return resolveRegistryPath();
}

function resolveRegistryPath() {
  return path.join(registryRootOverride ?? missionControlRootPath, "browser-accounts.json");
}

function resolveRegistryLockPath() {
  return `${resolveRegistryPath()}.lock`;
}

async function readBrowserPolicyAudit(): Promise<BrowserAccountAuditEvent[]> {
  try {
    const raw = await readFile(
      path.join(registryRootOverride ?? missionControlRootPath, "browser-policy-audit.jsonl"),
      "utf8"
    );
    if (Buffer.byteLength(raw, "utf8") > 1024 * 1024 + 4096) return [];
    const allowedTypes = new Set<BrowserAccountAuditEventType>([
      "sensitive_action_requested",
      "sensitive_action_approved",
      "sensitive_action_blocked"
    ]);
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-maxAuditEvents)
      .flatMap((line) => {
        try {
          const value = JSON.parse(line) as Partial<BrowserAccountAuditEvent>;
          if (
            typeof value.id !== "string" ||
            typeof value.type !== "string" ||
            !allowedTypes.has(value.type as BrowserAccountAuditEventType) ||
            typeof value.accountId !== "string" ||
            typeof value.workspaceId !== "string" ||
            typeof value.actorUserId !== "string" ||
            typeof value.at !== "string" ||
            typeof value.detail !== "string"
          ) {
            return [];
          }
          return [{
            id: value.id,
            type: value.type as BrowserAccountAuditEventType,
            accountId: value.accountId,
            workspaceId: value.workspaceId,
            actorUserId: value.actorUserId,
            agentId: typeof value.agentId === "string" ? value.agentId : null,
            taskId: typeof value.taskId === "string" ? value.taskId : null,
            at: value.at,
            detail: normalizeAuditDetail(value.detail)
          }];
        } catch {
          return [];
        }
      });
  } catch (error) {
    if (isFileError(error, "ENOENT")) return [];
    return [];
  }
}

function isFileError(error: unknown, code: string) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

export class BrowserAccountError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 409 | 429,
    readonly code: string
  ) {
    super(message);
  }
}
