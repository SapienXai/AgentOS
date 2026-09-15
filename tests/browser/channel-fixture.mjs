export const CHANNEL_FIXTURE_TOKEN = "fixture-telegram-token-should-never-leak";

export const CHANNEL_FIXTURE_IDS = {
  workspaceId: "workspace-key-2-lab",
  agentId: "agent-key-2-lead",
  defaultAgentId: "main",
  telegramAccountId: "telegram-support-bot",
  discordAccountId: "discord-support-bot",
  telegramSupportRouteId: "telegram-support-group",
  telegramReservationsRouteId: "telegram-reservations-group",
  discordServerRouteId: "discord-sapienx-server",
  discordSupportRouteId: "discord-support",
  discordSalesRouteId: "discord-sales",
  discordThreadRouteId: "discord-support-thread"
};

const OPENCLAW_VERSION = "2026.9.4";
const NOW = "2026-09-15T08:00:00.000Z";

const TELEGRAM_ONLINE = "ONLINE";
const TELEGRAM_STOPPED = "STOPPED";
const TELEGRAM_READY = "READY";
const TELEGRAM_NEEDS_SETUP = "NEEDS_SETUP";
const DISCORD_ONLINE = "ONLINE";

export class ChannelAcceptanceFixture {
  constructor({ scenario = "telegram-online", seedBindings = [] } = {}) {
    this.scenario = scenario;
    this.revision = 1;
    this.startRequests = [];
    this.routeMutations = [];
    this.accountCreates = [];
    this.bindings = new Map();
    this.startSequences = new Map();
    this.createdTelegramAccountId = null;

    for (const binding of seedBindings) {
      this.bindings.set(bindingKey(binding), binding.agentId ?? null);
    }
  }

  async install(page) {
    await page.route("**/api/**", (route) => this.handle(route));
  }

  async handle(route) {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname === "/api/stream") {
      await route.fulfill({
        status: 200,
        headers: {
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        },
        contentType: "text/event-stream",
        body: this.streamBody()
      });
      return;
    }

    if (url.pathname === "/api/snapshot") {
      await this.json(route, this.snapshot());
      return;
    }

    if (url.pathname === "/api/openclaw/channels/center" && method === "GET") {
      await this.json(route, this.center());
      return;
    }

    if (url.pathname === "/api/openclaw/channels/agent-routes" && method === "GET") {
      await this.json(route, this.agentRoutes(url.searchParams.get("agentId")));
      return;
    }

    if (url.pathname === "/api/openclaw/channels/directory" && method === "GET") {
      await this.json(route, this.directory(url.searchParams));
      return;
    }

    if (url.pathname === "/api/openclaw/channels/connect" && method === "POST") {
      await this.json(route, this.lifecycle(request));
      return;
    }

    if (url.pathname.endsWith("/channels") && method === "POST" && url.pathname.startsWith("/api/workspaces/")) {
      await this.json(route, this.createAccount(request));
      return;
    }

    if (url.pathname === "/api/openclaw/channels/route-binding" && method === "PATCH") {
      await this.json(route, this.routeBinding(request));
      return;
    }

    if (url.pathname === "/api/openclaw/channels/route-policy" && method === "PATCH") {
      await this.json(route, { ok: true, applyMode: "live", pending: false });
      return;
    }

    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ error: "Fixture endpoint not implemented" })
    });
  }

  async json(route, payload, status = 200) {
    await route.fulfill({
      status,
      contentType: "application/json",
      headers: { "Cache-Control": "no-store" },
      body: JSON.stringify(payload)
    });
  }

  streamBody() {
    return [
      "event: snapshot",
      `data: ${JSON.stringify(this.snapshot())}`,
      "",
      "event: system-status",
      `data: ${JSON.stringify({ gatewayReachable: true, gatewayReady: true, gatewayRegistered: true, gatewayConfigured: true, cliInstalled: true, runtimeWritable: true, modelStatus: { checked: true, defaultModelId: "fixture-model", modelIds: ["fixture-model"] } })}`,
      "",
      "event: ready",
      "data: {}",
      "",
      ""
    ].join("\n");
  }

  snapshot() {
    this.revision += 1;
    const badgeProviders = this.badgeProviders(this.agentId);
    return {
      generatedAt: new Date(Date.parse(NOW) + this.revision * 1000).toISOString(),
      revision: this.revision,
      mode: "live",
      diagnostics: diagnostics(),
      presence: [],
      channelAccounts: this.channelAccounts(),
      workspaces: [workspace()],
      agents: [agent(), defaultAgent()],
      models: [model()],
      runtimes: [],
      tasks: [],
      agentInbox: [],
      nativeWork: nativeWork(),
      relationships: [],
      missionPresets: [],
      channelRegistry: { version: 1, channels: [] },
      nativeChannelRouteBadges: badgeProviders.length > 0 ? { [this.agentId]: { providers: badgeProviders } } : {},
      surfaceRuntime: emptySurfaceRuntime(),
      surfaceDrift: emptySurfaceDrift()
    };
  }

  get agentId() {
    return CHANNEL_FIXTURE_IDS.agentId;
  }

  channelAccounts() {
    return [
      ...this.providerAccounts("telegram").map((account) => ({
        id: account.accountId,
        accountId: account.accountId,
        type: "telegram",
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        isDefault: account.isDefault ?? false,
        kind: "chat",
        capabilities: [],
        metadata: {}
      })),
      ...this.providerAccounts("discord").map((account) => ({
        id: account.accountId,
        accountId: account.accountId,
        type: "discord",
        name: account.name,
        enabled: account.enabled,
        configured: account.configured,
        isDefault: account.isDefault ?? false,
        kind: "chat",
        capabilities: [],
        metadata: {}
      }))
    ];
  }

  center() {
    const telegramAccounts = this.providerAccounts("telegram");
    const discordAccounts = this.providerAccounts("discord");
    return {
      installedOpenClawVersion: OPENCLAW_VERSION,
      recommendedOpenClawVersion: OPENCLAW_VERSION,
      supportedBaselineVersion: "2026.9.1",
      gatewayAvailable: true,
      statusError: null,
      pluginDiscoveryError: null,
      plugins: [
        { id: "telegram", name: "Telegram", status: "loaded", enabled: true, channelIds: ["telegram"] },
        { id: "discord", name: "Discord", status: "loaded", enabled: true, channelIds: ["discord"] }
      ],
      providers: [
        this.provider("telegram", "Telegram", "Connect a Telegram bot created with BotFather.", "bot-token", telegramAccounts),
        this.provider("discord", "Discord", "Connect a Discord application bot for servers, channels, and DMs.", "bot-token", discordAccounts)
      ]
    };
  }

  provider(id, label, description, setupMode, accounts) {
    const configured = accounts.some((account) => account.configured);
    const connected = accounts.some((account) => account.connected);
    const running = accounts.some((account) => account.running);
    return {
      id,
      label,
      description,
      setupMode,
      setupLabel: "Bot token",
      pluginInstalled: true,
      pluginEnabled: true,
      pluginStateSource: "gateway",
      pluginStateError: null,
      configured,
      connected,
      running,
      available: true,
      availabilityReason: null,
      address: null,
      accounts,
      inventorySource: "openclaw-status",
      capabilities: capabilities(id),
      state: {
        availability: "ready",
        pluginInstalled: true,
        pluginEnabled: true,
        configured,
        connected,
        running,
        accountCount: accounts.length,
        accountIds: accounts.map((account) => account.accountId),
        source: "openclaw-status",
        error: null
      }
    };
  }

  providerAccounts(provider) {
    if (provider === "telegram") {
      if (this.createdTelegramAccountId) {
        return [this.account(this.createdTelegramAccountId, "Support Bot", this.stateFor("telegram", this.createdTelegramAccountId, TELEGRAM_READY))];
      }

      const state = this.scenario === "telegram-stopped" ? TELEGRAM_STOPPED : this.scenario === "telegram-setup" ? TELEGRAM_NEEDS_SETUP : TELEGRAM_ONLINE;
      return [this.account(
        CHANNEL_FIXTURE_IDS.telegramAccountId,
        this.scenario === "telegram-setup" ? "Unconfigured Bot" : "Support Bot",
        this.stateFor("telegram", CHANNEL_FIXTURE_IDS.telegramAccountId, state)
      )];
    }

    return [this.account(CHANNEL_FIXTURE_IDS.discordAccountId, "Support Bot", this.stateFor("discord", CHANNEL_FIXTURE_IDS.discordAccountId, DISCORD_ONLINE))];
  }

  account(accountId, name, state) {
    const values = accountState(state);
    return {
      accountId,
      name,
      configured: values.configured,
      enabled: true,
      isDefault: false,
      linked: values.linked,
      running: values.running,
      connected: values.connected,
      liveStatusAvailable: true,
      authenticationRequired: values.authenticationRequired,
      healthState: values.healthState,
      credentialState: values.credentialState,
      evidence: "live-and-config",
      lastError: null
    };
  }

  stateFor(provider, accountId, baseState) {
    const key = `${provider}:${accountId}`;
    const sequence = this.startSequences.get(key);
    if (!sequence) return baseState;
    const index = Math.min(sequence.index, sequence.states.length - 1);
    const state = sequence.states[index];
    sequence.index += 1;
    return state;
  }

  lifecycle(request) {
    const body = parseRequestJson(request);
    const provider = String(body.provider ?? "");
    const accountId = String(body.accountId ?? "");
    const action = String(body.action ?? "");
    if (action === "start") {
      this.startRequests.push({ provider, accountId });
      const key = `${provider}:${accountId}`;
      const current = this.currentBaseState(provider, accountId);
      const states = provider === "telegram" && this.scenario === "telegram-stopped"
        ? [TELEGRAM_STOPPED, TELEGRAM_STOPPED, "STARTING", TELEGRAM_ONLINE]
        : current === TELEGRAM_READY
          ? ["STARTING", TELEGRAM_ONLINE]
          : [TELEGRAM_ONLINE];
      this.startSequences.set(key, { states, index: 0 });
    }
    this.revision += 1;
    return {
      ok: true,
      result: { status: action === "start" ? "started" : action },
      status: null,
      statusError: null
    };
  }

  currentBaseState(provider, accountId) {
    if (provider === "telegram" && this.createdTelegramAccountId === accountId) return TELEGRAM_READY;
    if (provider === "telegram" && this.scenario === "telegram-stopped") return TELEGRAM_STOPPED;
    if (provider === "telegram" && this.scenario === "telegram-setup") return TELEGRAM_NEEDS_SETUP;
    return provider === "discord" ? DISCORD_ONLINE : TELEGRAM_ONLINE;
  }

  createAccount(request) {
    const body = parseRequestJson(request);
    const provider = String(body.type ?? "");
    if (provider !== "telegram" || typeof body.token !== "string" || body.token.length === 0) {
      return { error: "Fixture requires a Telegram bot token." };
    }
    this.accountCreates.push({ provider, name: String(body.name ?? "") });
    this.createdTelegramAccountId = "telegram-support-bot-created";
    this.revision += 1;
    return {
      account: {
        id: this.createdTelegramAccountId,
        accountId: this.createdTelegramAccountId,
        name: String(body.name ?? "Support Bot")
      }
    };
  }

  directory(searchParams) {
    const provider = searchParams.get("provider") ?? "";
    const accountId = searchParams.get("accountId") ?? "";
    const account = this.providerAccounts(provider).find((entry) => entry.accountId === accountId);
    const accountStateName = account ? this.accountState(account) : "STATUS_UNAVAILABLE";
    if (accountStateName !== "ONLINE") {
      return { entries: [], status: "empty", source: "openclaw", fallbackReason: null, error: null };
    }
    const entries = provider === "discord" ? this.discordEntries(accountId) : this.telegramEntries(accountId);
    return { entries, status: entries.length > 0 ? "ok" : "empty", source: "openclaw", fallbackReason: null, error: null };
  }

  telegramEntries(accountId) {
    return [
      this.directoryEntry({ provider: "telegram", accountId, kind: "group", routeId: CHANNEL_FIXTURE_IDS.telegramSupportRouteId, parentRouteId: null, title: "Support Group", handle: "@support", memberCount: 12 }),
      this.directoryEntry({ provider: "telegram", accountId, kind: "group", routeId: CHANNEL_FIXTURE_IDS.telegramReservationsRouteId, parentRouteId: null, title: "Reservations Group", handle: "@reservations", memberCount: 8 })
    ];
  }

  discordEntries(accountId) {
    return [
      this.directoryEntry({ provider: "discord", accountId, kind: "group", routeId: CHANNEL_FIXTURE_IDS.discordServerRouteId, parentRouteId: null, title: "SapienX Server", handle: "sapienx", memberCount: 42 }),
      this.directoryEntry({ provider: "discord", accountId, kind: "channel", routeId: CHANNEL_FIXTURE_IDS.discordSupportRouteId, parentRouteId: CHANNEL_FIXTURE_IDS.discordServerRouteId, title: "#support", handle: "support", memberCount: 14 }),
      this.directoryEntry({ provider: "discord", accountId, kind: "channel", routeId: CHANNEL_FIXTURE_IDS.discordSalesRouteId, parentRouteId: CHANNEL_FIXTURE_IDS.discordServerRouteId, title: "#sales", handle: "sales", memberCount: 9 }),
      this.directoryEntry({ provider: "discord", accountId, kind: "thread", routeId: CHANNEL_FIXTURE_IDS.discordThreadRouteId, parentRouteId: CHANNEL_FIXTURE_IDS.discordSupportRouteId, title: "Support thread", handle: "support-thread", memberCount: null })
    ];
  }

  directoryEntry({ provider, accountId, kind, routeId, parentRouteId, title, handle, memberCount }) {
    const directAgentId = this.bindings.get(bindingKey({ provider, accountId, kind, routeId, parentRouteId })) ?? null;
    const parentBinding = kind === "thread"
      ? this.bindings.get(bindingKey({ provider, accountId, kind: "channel", routeId: parentRouteId, parentRouteId: CHANNEL_FIXTURE_IDS.discordServerRouteId })) ?? null
      : null;
    const inherited = kind === "thread" && parentBinding
      ? { routeId: parentRouteId, kind: "channel", title: "#support" }
      : null;
    const agentId = directAgentId ?? parentBinding;
    return {
      routeId,
      kind,
      accountId,
      parentRouteId,
      title,
      handle,
      memberCount,
      metadata: provider === "discord" ? { guildId: CHANNEL_FIXTURE_IDS.discordServerRouteId } : {},
      agentId,
      bindingSource: agentId ? "openclaw" : null,
      bindingMatch: directAgentId ? "exact" : inherited ? "inherited" : "none",
      bindingConflict: false,
      bindingEditingAmbiguous: false,
      inheritedFrom: inherited,
      shadowedBindingCount: 0,
      accessPolicy: { enabled: true, groupPolicy: "open", allowFrom: [], requireMention: false }
    };
  }

  agentRoutes(agentId) {
    const routes = [];
    for (const entry of this.allDirectoryEntries()) {
      const directAgentId = this.bindings.get(bindingKey(entry)) ?? null;
      const inheritedAgentId = entry.kind === "thread"
        ? this.bindings.get(bindingKey({ provider: "discord", accountId: entry.accountId, kind: "channel", routeId: entry.parentRouteId, parentRouteId: CHANNEL_FIXTURE_IDS.discordServerRouteId })) ?? null
        : null;
      const effectiveAgentId = directAgentId ?? inheritedAgentId;
      if (!effectiveAgentId || effectiveAgentId !== agentId) continue;
      const isInherited = !directAgentId && Boolean(inheritedAgentId);
      const route = {
        provider: entry.provider,
        accountId: entry.accountId,
        kind: entry.kind,
        routeId: entry.routeId,
        parentRouteId: entry.parentRouteId,
        metadata: entry.metadata
      };
      routes.push({
        id: bindingKey(route),
        route,
        provider: entry.provider,
        accountId: entry.accountId,
        kind: entry.kind,
        title: entry.title,
        subtitle: isInherited ? `Inherited from ${entry.inheritedFrom?.title ?? "parent route"}` : `${entry.provider} · ${entry.accountId}`,
        scope: "route",
        effectiveAgentId,
        explicitAgentId: directAgentId,
        displayMatch: isInherited ? "inherited" : "explicit",
        bindingMatch: isInherited ? "inherited" : "exact",
        inheritedFrom: entry.inheritedFrom,
        editable: entry.kind !== "thread",
        editingAmbiguity: false,
        shadowedBindingCount: 0
      });
    }
    return { routes, diagnostics: { topicConfig: "read" } };
  }

  allDirectoryEntries() {
    return [
      ...this.telegramEntries(CHANNEL_FIXTURE_IDS.telegramAccountId),
      ...this.discordEntries(CHANNEL_FIXTURE_IDS.discordAccountId)
    ].map((entry) => ({ ...entry, provider: entry.kind === "channel" || entry.kind === "thread" || entry.routeId.startsWith("discord-") ? "discord" : "telegram" }));
  }

  routeBinding(request) {
    const body = parseRequestJson(request);
    const route = {
      provider: String(body.provider ?? ""),
      accountId: String(body.accountId ?? ""),
      kind: String(body.kind ?? "peer"),
      routeId: String(body.routeId ?? ""),
      parentRouteId: body.parentRouteId ? String(body.parentRouteId) : null
    };
    const agentId = body.agentId ? String(body.agentId) : null;
    if (agentId) this.bindings.set(bindingKey(route), agentId);
    else this.bindings.delete(bindingKey(route));
    this.routeMutations.push({ route, agentId });
    this.revision += 1;
    return {
      route,
      agentId,
      changed: true,
      source: "openclaw",
      applyMode: "live",
      reloadKind: "none",
      restartRequired: false,
      hotReloaded: true,
      appliedVia: "config.patch",
      pending: false,
      verification: {
        verified: true,
        effectiveAgentId: agentId,
        explicitAgentId: agentId,
        match: agentId ? "exact" : "none"
      }
    };
  }

  badgeProviders(agentId) {
    const counts = new Map();
    for (const [key, boundAgentId] of this.bindings) {
      if (boundAgentId !== agentId) continue;
      const provider = key.split(":", 1)[0];
      counts.set(provider, (counts.get(provider) ?? 0) + 1);
    }
    return [...counts.entries()].map(([provider, routeCount]) => ({ provider, routeCount }));
  }

  accountState(account) {
    if (account.authenticationRequired) return "NEEDS_SETUP";
    if (account.connected) return "ONLINE";
    if (account.running) return "STARTING";
    if (account.configured) return "STOPPED";
    return "STATUS_UNAVAILABLE";
  }
}

function bindingKey(route) {
  return [route.provider, route.accountId, route.kind, route.parentRouteId ?? "", route.routeId].join(":");
}

function parseRequestJson(request) {
  const body = request.postDataJSON();
  return body && typeof body === "object" ? body : {};
}

function accountState(state) {
  switch (state) {
    case "ONLINE":
      return { configured: true, linked: true, running: true, connected: true, authenticationRequired: false, healthState: "connected", credentialState: "present" };
    case "STARTING":
      return { configured: true, linked: true, running: true, connected: false, authenticationRequired: false, healthState: null, credentialState: "present" };
    case "READY":
      return { configured: true, linked: true, running: false, connected: false, authenticationRequired: false, healthState: null, credentialState: "present" };
    case "STOPPED":
      return { configured: true, linked: true, running: false, connected: false, authenticationRequired: false, healthState: "stopped", credentialState: "present" };
    case "NEEDS_SETUP":
      return { configured: false, linked: false, running: false, connected: false, authenticationRequired: true, healthState: null, credentialState: "missing" };
    default:
      return { configured: false, linked: false, running: false, connected: false, authenticationRequired: false, healthState: null, credentialState: "unknown" };
  }
}

function capabilities(provider) {
  return {
    supportsAccounts: true,
    supportsMultiAccount: true,
    supportsStart: true,
    supportsStop: true,
    supportsRestart: true,
    supportsLogout: true,
    supportsQrLogin: false,
    supportsTokenSetup: true,
    supportsDirectoryPeers: true,
    supportsDirectoryGroups: true,
    supportsDirectoryMembers: true,
    supportsDirectoryHierarchy: provider === "discord",
    supportsThreads: provider === "discord",
    supportsRoles: provider === "discord",
    supportsDirectMessages: true,
    supportsTopics: provider === "telegram",
    supportsGroupPolicy: true,
    supportsMentionPolicy: true,
    supportsNativeBindings: true,
    supportsPluginInstall: false,
    supportsPluginDisable: false,
    supportsPluginReload: false
  };
}

function workspace() {
  return {
    id: CHANNEL_FIXTURE_IDS.workspaceId,
    name: "Key 2 Lab",
    slug: "key-2-lab",
    path: "/tmp/agentos-channel-browser/key-2-lab",
    kind: "workspace",
    createdAt: Date.parse(NOW),
    agentIds: [CHANNEL_FIXTURE_IDS.agentId, CHANNEL_FIXTURE_IDS.defaultAgentId],
    modelIds: ["fixture-model"],
    activeRuntimeIds: [],
    totalSessions: 0,
    health: "idle",
    bootstrap: { template: null, sourceMode: null, agentTemplate: null, coreFiles: [], optionalFiles: [], folders: [], projectShell: [], localSkillIds: [] },
    capabilities: { skills: [], tools: [], workspaceOnlyAgentCount: 1 },
    channels: []
  };
}

function agent() {
  return {
    id: CHANNEL_FIXTURE_IDS.agentId,
    kind: "agent",
    createdVia: "operator",
    creatorAgentId: null,
    createdAt: Date.parse(NOW),
    name: "Key 2 Lead",
    identityName: "Key 2 Lead",
    workspaceId: CHANNEL_FIXTURE_IDS.workspaceId,
    workspacePath: "/tmp/agentos-channel-browser/key-2-lab",
    agentDir: "/tmp/agentos-channel-browser/key-2-lab/.openclaw/agents/key-2-lead",
    modelId: "fixture-model",
    isDefault: false,
    status: "idle",
    sessionCount: 0,
    lastActiveAt: null,
    currentAction: "",
    activeRuntimeIds: [],
    heartbeat: { enabled: false, every: null, everyMs: null },
    identity: { emoji: "🧭", theme: "Operations" },
    profile: { purpose: "Fixture acceptance agent", operatingInstructions: [], responseStyle: [], outputPreference: null, sourceFiles: [] },
    skills: [],
    tools: [],
    policy: { preset: "worker", missingToolBehavior: "fallback", installScope: "none", fileAccess: "workspace-only", networkAccess: "restricted" }
  };
}

function defaultAgent() {
  return {
    ...agent(),
    id: CHANNEL_FIXTURE_IDS.defaultAgentId,
    name: "Main",
    identityName: "Main",
    workspaceId: CHANNEL_FIXTURE_IDS.workspaceId,
    isDefault: true,
    agentDir: "/tmp/agentos-channel-browser/key-2-lab/.openclaw/agents/main"
  };
}

function model() {
  return { id: "fixture-model", name: "Fixture Model", provider: "fixture", api: "openai-responses", model: "fixture-model", contextWindow: 128000, maxTokens: 4096, reasoning: true, input: ["text"], tags: [], available: true, auth: { kind: "none", configured: true }, metadata: {} };
}

function diagnostics() {
  return {
    installed: true,
    loaded: true,
    rpcOk: true,
    health: "healthy",
    version: OPENCLAW_VERSION,
    latestVersion: OPENCLAW_VERSION,
    updateAvailable: false,
    workspaceRoot: "/tmp/agentos-channel-browser",
    configuredWorkspaceRoot: "/tmp/agentos-channel-browser",
    dashboardUrl: "http://127.0.0.1:18789/",
    gatewayUrl: "ws://127.0.0.1:18789",
    configuredGatewayUrl: "ws://127.0.0.1:18789",
    openClawBinarySelection: { mode: "auto", path: null, resolvedPath: null, label: "Auto", detail: "Fixture gateway" },
    modelReadiness: { ready: true, defaultModel: "fixture-model", resolvedDefaultModel: "fixture-model", defaultModelReady: true, recommendedModelId: "fixture-model", preferredLoginProvider: null, totalModelCount: 1, availableModelCount: 1, localModelCount: 0, remoteModelCount: 1, missingModelCount: 0, authProviders: [], issues: [] },
    configUpdatePacing: { settings: { mode: "respect-gateway", minimumIntervalMs: null }, queueDurability: "persistent", pending: false, pendingCount: 0, pendingPaths: [], pendingSince: null, cooldownUntil: null, retryAfterMs: null, lastIssue: null, lastUpdatedAt: null },
    runtime: { stateRoot: "/tmp/agentos-channel-browser/openclaw", stateWritable: true, sessionStoreWritable: true, sessionStores: [], smokeTest: { status: "passed", checkedAt: NOW, agentId: null, runId: null, summary: "Fixture runtime", error: null }, issues: [] },
    eventBridge: { mode: "live", connected: true, reconnecting: false, reconnectAttempt: 0, lastEventAt: NOW, lastError: null, message: null, recovery: null },
    runtimeIssues: [],
    securityWarnings: [],
    issues: []
  };
}

function nativeWork() {
  return { availability: { worktrees: "unknown", suggestions: "unknown", ownership: "unknown", assignment: "unknown" }, worktrees: [], suggestions: [], executions: [], issues: [] };
}

function emptySurfaceRuntime() {
  return { source: "gateway-status", checkedAt: NOW, accounts: [], issues: [] };
}

function emptySurfaceDrift() {
  return { detected: false, checkedAt: NOW, issues: [] };
}
