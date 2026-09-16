import { ChannelAcceptanceFixture, CHANNEL_FIXTURE_IDS } from "./channel-fixture.mjs";

export const BROWSER_ACCOUNT_FIXTURE_IDS = {
  ...CHANNEL_FIXTURE_IDS,
  accountId: "11111111-1111-4111-8111-111111111111",
  providerSessionId: "22222222-2222-4222-8222-222222222222",
  profileId: "acct-111111111111111111111111"
};

const NOW = "2026-09-16T08:00:00.000Z";

export class BrowserAccountAcceptanceFixture extends ChannelAcceptanceFixture {
  constructor() {
    super({ scenario: "telegram-online" });
    this.browserAccount = null;
    this.requests = [];
    this.responseBodies = [];
    this.taskDispatches = [];
    this.liveViewExchanges = [];
  }

  async install(page) {
    // Context routing covers the popup used by the real connection flow as
    // well as the Accounts page itself.
    await page.context().route("**/api/**", (route) => this.handle(route));
  }

  snapshot() {
    const snapshot = super.snapshot();
    return {
      ...snapshot,
      agents: snapshot.agents.map((agent) => ({
        ...agent,
        tools: ["browser"],
        observedTools: ["browser"]
      }))
    };
  }

  async handle(route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname === "/api/runtime/capabilities" && method === "GET") {
      await this.json(route, {
        platform: "local",
        gatewayLifecycle: "agentos-managed",
        gatewayConfigOwnership: "agentos-managed",
        terminalAccess: "unavailable",
        browserAutomation: "local-visible",
        interactiveBrowserLogin: "supported",
        existingBrowserSession: "supported",
        hostFileActions: "unavailable"
      });
      return;
    }

    if (url.pathname === "/api/accounts/browser-accounts") {
      if (method === "GET") {
        await this.json(route, this.browserAccountsResponse());
        return;
      }

      if (method === "POST") {
        await this.handleBrowserAccountMutation(route);
        return;
      }
    }

    if (url.pathname === "/api/accounts/browser-live/exchange" && method === "POST") {
      const body = this.readJsonBody(request);
      this.liveViewExchanges.push(body);
      const response = {
        accountId: this.browserAccount?.id ?? BROWSER_ACCOUNT_FIXTURE_IDS.accountId,
        workspaceId: BROWSER_ACCOUNT_FIXTURE_IDS.workspaceId,
        providerSessionId: BROWSER_ACCOUNT_FIXTURE_IDS.providerSessionId,
        sessionExpiresAt: new Date(Date.parse(NOW) + 20 * 60_000).toISOString(),
        viewerPath: `/secure-browser-client.html?path=${encodeURIComponent(`api/accounts/browser-live/ws/${BROWSER_ACCOUNT_FIXTURE_IDS.providerSessionId}`)}`
      };
      this.responseBodies.push(response);
      await this.json(route, response);
      return;
    }

    if (url.pathname === "/api/mission" && method === "POST") {
      const body = this.readJsonBody(request);
      this.requests.push({ pathname: url.pathname, method, body });
      this.taskDispatches.push(body);
      await this.json(route, {
        dispatchId: "dispatch-browser-acceptance-1",
        runId: "run-browser-acceptance-1",
        agentId: body.agentId,
        status: "queued",
        summary: "The secure browser task was bound to the selected account identity.",
        payloads: [],
        meta: { browserAccountId: body.browserAccountId }
      }, 202);
      return;
    }

    if (url.pathname === "/api/accounts/browser-profiles" && method === "GET") {
      await this.json(route, { ok: true, profiles: [] });
      return;
    }

    if (url.pathname === "/api/accounts/login-targets" && method === "GET") {
      await this.json(route, { ok: true, targets: [] });
      return;
    }

    if (url.pathname === "/api/accounts/access-rules" && method === "GET") {
      await this.json(route, { ok: true, rules: [] });
      return;
    }

    return super.handle(route);
  }

  async handleBrowserAccountMutation(route) {
    const request = route.request();
    const body = this.readJsonBody(request);
    this.requests.push({ pathname: "/api/accounts/browser-accounts", method: "POST", body });

    if (body.action === "create") {
      this.browserAccount = buildAccount({
        identityLabel: body.identityLabel ?? "X / Twitter",
        allowedAgentIds: body.allowedAgentIds ?? []
      });
      await this.json(route, { ok: true, result: { account: this.browserAccount } });
      return;
    }

    if (!this.browserAccount) {
      await this.json(route, { error: "No fixture browser account exists." }, 404);
      return;
    }

    if (body.action === "start-live-view") {
      this.browserAccount.sessionState = "active";
      await this.json(route, {
        ok: true,
        result: { launchUrl: "/accounts/browser-live#capability=fixture-capability" }
      });
      return;
    }

    if (body.action === "confirm-login") {
      this.browserAccount.connectionStatus = "connected";
      this.browserAccount.verificationSource = "provider_verified";
      this.browserAccount.lastVerifiedAt = NOW;
      this.browserAccount.updatedAt = NOW;
      await this.json(route, { ok: true, result: { authenticationStatus: "verified" } });
      return;
    }

    if (body.action === "stop-live-view") {
      this.browserAccount.sessionState = "idle";
      this.browserAccount.lastUsedAt = NOW;
      this.browserAccount.updatedAt = NOW;
      await this.json(route, { ok: true, result: this.browserAccount });
      return;
    }

    if (body.action === "update-access") {
      this.browserAccount.allowedAgentIds = body.allowedAgentIds ?? [];
      this.browserAccount.capabilities = body.capabilities ?? ["read"];
      this.browserAccount.accessGrants = body.accessGrants ?? [];
      this.browserAccount.allowedDomains = body.allowedDomains ?? ["x.com"];
      this.browserAccount.approvalPolicy = body.approvalPolicy ?? "block_sensitive";
      this.browserAccount.updatedAt = NOW;
      await this.json(route, { ok: true, result: this.browserAccount });
      return;
    }

    if (body.action === "revoke") {
      this.browserAccount.connectionStatus = "revoked";
      this.browserAccount.sessionState = "idle";
      this.browserAccount.revokedAt = NOW;
      this.browserAccount.concurrencyLease = null;
      this.browserAccount.updatedAt = NOW;
      await this.json(route, { ok: true, result: this.browserAccount });
      return;
    }

    await this.json(route, { ok: true, result: this.browserAccount });
  }

  browserAccountsResponse() {
    return {
      ok: true,
      generatedAt: NOW,
      source: "fixture.browser-gateway",
      accounts: this.browserAccount ? [this.browserAccount] : [],
      capabilities: {
        provider: "native-openclaw",
        source: "openclaw.gateway",
        profileCreation: "supported",
        persistentProfiles: "supported",
        liveView: "unsupported",
        humanTakeover: "unsupported",
        typedTaskDispatch: "supported",
        runtimeLocation: "local",
        reason: "OpenClaw native browser execution is available; interactive login uses the self-hosted fallback in this fixture.",
        fallbackCapabilities: {
          provider: "self-hosted-openclaw",
          source: "fixture.self-hosted-worker",
          profileCreation: "supported",
          persistentProfiles: "supported",
          liveView: "supported",
          humanTakeover: "supported",
          typedTaskDispatch: "supported",
          runtimeLocation: "cloud",
          reason: null
        }
      },
      recovery: { recoveredCount: 0, cleanupFailedCount: 0 }
    };
  }

  readJsonBody(request) {
    try {
      return request.postDataJSON() ?? {};
    } catch {
      return {};
    }
  }
}

function buildAccount({ identityLabel, allowedAgentIds }) {
  return {
    id: BROWSER_ACCOUNT_FIXTURE_IDS.accountId,
    provider: "self-hosted-openclaw",
    serviceId: "x",
    serviceName: "X / Twitter",
    identityLabel,
    runtimeLocation: "cloud",
    primaryDomain: "x.com",
    ownerUserId: "fixture-owner",
    workspaceId: BROWSER_ACCOUNT_FIXTURE_IDS.workspaceId,
    browserProfileId: BROWSER_ACCOUNT_FIXTURE_IDS.profileId,
    allowedAgentIds,
    capabilities: ["read"],
    approvalPolicy: "block_sensitive",
    accessGrants: allowedAgentIds.map((agentId) => ({
      agentId,
      capabilities: ["read"],
      approvalPolicy: "block_sensitive",
      updatedAt: NOW
    })),
    allowedDomains: ["x.com"],
    connectionStatus: "needs_verification",
    verificationSource: "unknown",
    sessionState: "idle",
    concurrencyLease: null,
    lastVerifiedAt: null,
    lastUsedAt: null,
    updatedAt: NOW,
    source: "self-hosted-worker",
    revokedAt: null
  };
}
