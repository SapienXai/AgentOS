import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  formatWorkspaceChannelSetupError,
  getWorkspaceChannelSetupStatus,
  performWorkspaceChannelSetup,
  WorkspaceChannelSetupError,
  type WorkspaceChannelSetupDependencies
} from "@/lib/openclaw/application/workspace-channel-setup-service";
import { WORKSPACE_PROVISIONING_MANIFEST_RELATIVE_PATH } from "@/lib/agentos/application/workspace-provisioning-store";
import type {
  ChannelRegistry,
  MissionControlSnapshot,
  SurfaceAccountRuntimeStatus,
  SurfaceRuntimeSnapshot
} from "@/lib/openclaw/types";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

test("service configure provisions Telegram, binds it, and never returns the token", async () => {
  const harness = await createHarness({ provider: "telegram", declarationId: "support" });
  let createdInput: Record<string, unknown> | null = null;
  harness.dependencies.createManagedChatChannelAccount = async (input) => {
    createdInput = input as Record<string, unknown>;
    const account = runtimeAccount("telegram", "support", { configured: true });
    harness.setAccount(account);
    return { id: "support", type: "telegram", name: input.name, enabled: true, configured: true } as never;
  };

  const result = await performWorkspaceChannelSetup({
    workspaceId: "workspace-1",
    action: "configure",
    provider: "telegram",
    declarationId: "support",
    name: "Support",
    token: "super-secret-token-123"
  }, {}, harness.dependencies);

  const capturedInput = createdInput as Record<string, unknown> | null;
  assert.equal(capturedInput?.token, "super-secret-token-123");
  assert.equal(harness.calls.upsert, 1);
  const setup = projectionOf(result);
  assert.equal(setup.items[0]?.bindingPresent, true);
  assert.equal(setup.items[0]?.action, "start");
  assert.equal(setup.pendingCount, 1);
  assert.doesNotMatch(JSON.stringify(result), /super-secret-token-123/);
});

test("configured but stopped Telegram remains pending and exposes Start", async () => {
  const harness = await createHarness({
    provider: "telegram",
    declarationId: "support",
    account: runtimeAccount("telegram", "support", { configured: true }),
    binding: true
  });

  const result = await getWorkspaceChannelSetupStatus("workspace-1", harness.dependencies);

  assert.equal(result.items[0]?.status, "configured");
  assert.equal(result.items[0]?.action, "start");
  assert.equal(result.items[0]?.complete, false);
  assert.equal(result.pendingCount, 1);
});

test("running Telegram becomes complete after the native status refresh", async () => {
  const harness = await createHarness({
    provider: "telegram",
    declarationId: "support",
    account: runtimeAccount("telegram", "support", { configured: true, running: true }),
    binding: true
  });

  const result = await getWorkspaceChannelSetupStatus("workspace-1", harness.dependencies);

  assert.equal(result.items[0]?.status, "running");
  assert.equal(result.items[0]?.action, "none");
  assert.equal(result.items[0]?.complete, true);
  assert.equal(result.pendingCount, 0);
});

test("WhatsApp login start uses the native QR dependency and keeps QR state transient", async () => {
  const harness = await createHarness({ provider: "whatsapp", declarationId: "support" });
  let loginInput: Record<string, unknown> | null = null;
  harness.dependencies.startChannelWebLogin = async (input) => {
    loginInput = input as Record<string, unknown>;
    return { qrDataUrl: "data:image/png;base64,qr", accountId: "support" } as never;
  };

  const result = await performWorkspaceChannelSetup({
    workspaceId: "workspace-1",
    action: "login-start",
    provider: "whatsapp",
    declarationId: "support",
    accountId: "support"
  }, {}, harness.dependencies);

  assert.deepEqual(loginInput, { provider: "whatsapp", accountId: "support", force: true });
  assert.equal(("login" in result ? result.login as { qrDataUrl?: string } : {}).qrDataUrl, "data:image/png;base64,qr");
  assert.doesNotMatch(JSON.stringify(projectionOf(result)), /qrDataUrl/);
});

test("WhatsApp login wait refreshes native status instead of inferring success from the click", async () => {
  const harness = await createHarness({
    provider: "whatsapp",
    declarationId: "support",
    account: runtimeAccount("whatsapp", "support", { configured: true, linked: true })
  });
  let waitCount = 0;
  harness.dependencies.waitForChannelWebLogin = async () => {
    waitCount += 1;
    harness.setAccount(runtimeAccount("whatsapp", "support", {
      configured: true,
      linked: true,
      running: true,
      connected: true
    }));
    return { status: "linked", accountId: "support" } as never;
  };

  const result = await performWorkspaceChannelSetup({
    workspaceId: "workspace-1",
    action: "login-wait",
    provider: "whatsapp",
    declarationId: "support",
    accountId: "support",
    currentQrDataUrl: "data:image/png;base64:qr"
  }, {}, harness.dependencies);

  assert.equal(waitCount, 1);
  const setup = projectionOf(result);
  assert.equal(setup.items[0]?.status, "connected");
  assert.equal(setup.items[0]?.action, "bind");
});

test("WhatsApp authentication failure stays visible and redacted", async () => {
  const harness = await createHarness({ provider: "whatsapp", declarationId: "support" });
  harness.dependencies.waitForChannelWebLogin = async () => {
    throw new Error("login failed token=super-secret-token-123");
  };

  let error: unknown = null;
  await assert.rejects(
    performWorkspaceChannelSetup({
      workspaceId: "workspace-1",
      action: "login-wait",
      provider: "whatsapp",
      declarationId: "support",
      accountId: "support"
    }, {}, harness.dependencies),
    (candidate: unknown) => {
      error = candidate;
      return candidate instanceof Error;
    }
  );
  const formatted = formatWorkspaceChannelSetupError(error);

  assert.doesNotMatch(formatted, /super-secret-token-123/);
  const status = await getWorkspaceChannelSetupStatus("workspace-1", harness.dependencies);
  assert.equal(status.items[0]?.status, "authentication-required");
  assert.equal(status.items[0]?.complete, false);
});

test("bind uses the selected account and canonical primary agent", async () => {
  const harness = await createHarness({
    provider: "telegram",
    declarationId: "support",
    account: runtimeAccount("telegram", "support", { configured: true, connected: true })
  });

  const result = await performWorkspaceChannelSetup({
    workspaceId: "workspace-1",
    action: "bind",
    provider: "telegram",
    declarationId: "support",
    accountId: "support"
  }, {}, harness.dependencies);

  assert.equal(harness.calls.upsert, 1);
  assert.equal(harness.lastUpsert?.channelId, "support");
  assert.deepEqual(harness.lastUpsert?.agentIds, ["agent-primary"]);
  assert.equal(projectionOf(result).items[0]?.complete, true);
});

test("explicit invalid agent fails before any binding mutation", async () => {
  const harness = await createHarness({
    provider: "telegram",
    declarationId: "support",
    account: runtimeAccount("telegram", "support", { configured: true, connected: true })
  });

  await assert.rejects(
    performWorkspaceChannelSetup({
      workspaceId: "workspace-1",
      action: "bind",
      provider: "telegram",
      declarationId: "support",
      accountId: "support",
      primaryAgentId: "deleted-agent"
    }, {}, harness.dependencies),
    (error: unknown) => error instanceof WorkspaceChannelSetupError &&
      error.code === "workspace-channel-agent-invalid"
  );
  assert.equal(harness.calls.upsert, 0);
});

test("omitted agent selection resolves to the workspace primary only", async () => {
  const harness = await createHarness({
    provider: "telegram",
    declarationId: "support",
    account: runtimeAccount("telegram", "support", { configured: true, connected: true })
  });

  await performWorkspaceChannelSetup({
    workspaceId: "workspace-1",
    action: "bind",
    provider: "telegram",
    declarationId: "support",
    accountId: "support"
  }, {}, harness.dependencies);

  assert.equal(harness.lastUpsert?.primaryAgentId, "agent-primary");
  assert.deepEqual(harness.lastUpsert?.agentIds, ["agent-primary"]);
});

test("explicit invalid agent fails before Telegram account provisioning", async () => {
  const harness = await createHarness({ provider: "telegram", declarationId: "support" });
  let createCount = 0;
  harness.dependencies.createManagedChatChannelAccount = async (input) => {
    createCount += 1;
    return { id: input.accountId ?? "support", type: input.provider, name: input.name, enabled: true, configured: true } as never;
  };

  await assert.rejects(
    performWorkspaceChannelSetup({
      workspaceId: "workspace-1",
      action: "configure",
      provider: "telegram",
      declarationId: "support",
      name: "Support",
      token: "super-secret-token-123",
      primaryAgentId: "foreign-agent"
    }, {}, harness.dependencies),
    (error: unknown) => error instanceof WorkspaceChannelSetupError &&
      error.code === "workspace-channel-agent-invalid"
  );
  assert.equal(createCount, 0);
  assert.equal(harness.calls.upsert, 0);
});

test("multiple accounts require selection and never fall back to the first account", async () => {
  const harness = await createHarness({
    provider: "telegram",
    declarationId: "support",
    accounts: [
      runtimeAccount("telegram", "first", { configured: true, connected: true }),
      runtimeAccount("telegram", "second", { configured: true, connected: true })
    ]
  });

  const status = await getWorkspaceChannelSetupStatus("workspace-1", harness.dependencies);
  assert.equal(status.items[0]?.action, "select-account");

  await assert.rejects(
    performWorkspaceChannelSetup({
      workspaceId: "workspace-1",
      action: "bind",
      provider: "telegram",
      declarationId: "support"
    }, {}, harness.dependencies),
    (error: unknown) => error instanceof WorkspaceChannelSetupError &&
      error.code === "workspace-channel-account-required"
  );
  assert.equal(harness.calls.upsert, 0);

  await performWorkspaceChannelSetup({
    workspaceId: "workspace-1",
    action: "bind",
    provider: "telegram",
    declarationId: "support",
    accountId: "second"
  }, {}, harness.dependencies);
  assert.equal(harness.lastUpsert?.channelId, "second");
});

test("plugin installation returns restart failure truthfully", async () => {
  const harness = await createHarness({
    provider: "discord",
    declarationId: "support",
    pluginInstalled: false,
    pluginEnabled: false
  });
  let installCount = 0;
  harness.dependencies.installChannelPlugin = async () => {
    installCount += 1;
    return { provider: "discord", installed: true, restarted: false, restartError: "Gateway restart failed." } as never;
  };

  const result = await performWorkspaceChannelSetup({
    workspaceId: "workspace-1",
    action: "install-plugin",
    provider: "discord",
    declarationId: "support"
  }, {}, harness.dependencies);

  assert.equal(installCount, 1);
  assert.equal(("plugin" in result ? result.plugin as { restartError?: string } : {}).restartError, "Gateway restart failed.");
});

test("start and stop reproject native state without leaving stale completion", async () => {
  const harness = await createHarness({
    provider: "telegram",
    declarationId: "support",
    account: runtimeAccount("telegram", "support", { configured: true }),
    binding: true
  });

  const started = await performWorkspaceChannelSetup({
    workspaceId: "workspace-1",
    action: "start",
    provider: "telegram",
    declarationId: "support",
    accountId: "support"
  }, {}, harness.dependencies);
  assert.equal(harness.calls.start, 1);
  assert.equal(projectionOf(started).items[0]?.complete, true);

  const stopped = await performWorkspaceChannelSetup({
    workspaceId: "workspace-1",
    action: "stop",
    provider: "telegram",
    declarationId: "support",
    accountId: "support"
  }, {}, harness.dependencies);
  assert.equal(harness.calls.stop, 1);
  assert.equal(projectionOf(stopped).items[0]?.complete, false);
  assert.equal(projectionOf(stopped).items[0]?.action, "start");
});

test("repeated bind calls keep one logical registry binding", async () => {
  const harness = await createHarness({
    provider: "telegram",
    declarationId: "support",
    account: runtimeAccount("telegram", "support", { configured: true, connected: true })
  });
  const input = {
    workspaceId: "workspace-1",
    action: "bind" as const,
    provider: "telegram" as const,
    declarationId: "support",
    accountId: "support"
  };

  await performWorkspaceChannelSetup(input, {}, harness.dependencies);
  await performWorkspaceChannelSetup(input, {}, harness.dependencies);

  assert.equal(harness.snapshot.channelRegistry.channels.length, 1);
  assert.equal(harness.snapshot.channelRegistry.channels[0]?.workspaces.length, 1);
});

type HarnessOptions = {
  provider: "whatsapp" | "telegram" | "discord" | "slack";
  declarationId: string;
  account?: SurfaceAccountRuntimeStatus;
  accounts?: SurfaceAccountRuntimeStatus[];
  binding?: boolean;
  pluginInstalled?: boolean;
  pluginEnabled?: boolean;
};

async function createHarness(options: HarnessOptions) {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), "agentos-channel-setup-"));
  cleanups.push(() => rm(workspacePath, { recursive: true, force: true }));
  await mkdir(path.join(workspacePath, ".openclaw"), { recursive: true });
  await writeFile(
    path.join(workspacePath, WORKSPACE_PROVISIONING_MANIFEST_RELATIVE_PATH),
    JSON.stringify({ agentosProvisioning: { pendingSetup: { channels: [`${options.provider}:${options.declarationId}`] } } })
  );

  const accounts = options.accounts ?? (options.account ? [options.account] : []);
  const snapshot = createSnapshot({
    workspacePath,
    provider: options.provider,
    accounts,
    binding: options.binding ? options.account ?? accounts[0] ?? runtimeAccount(options.provider, options.declarationId, { configured: true }) : null
  });
  const calls = { upsert: 0, start: 0, stop: 0 };
  let lastUpsert: Record<string, unknown> | null = null;
  const setAccount = (account: SurfaceAccountRuntimeStatus) => {
    snapshot.surfaceRuntime.accountsByProvider[options.provider] = {
      ...snapshot.surfaceRuntime.accountsByProvider[options.provider],
      [account.accountId]: account
    };
  };
  const upsert = async (input: Parameters<WorkspaceChannelSetupDependencies["upsertWorkspaceChannel"]>[0]) => {
    calls.upsert += 1;
    lastUpsert = input as Record<string, unknown>;
    const channel = snapshot.channelRegistry.channels.find((entry) => entry.id === input.channelId);
    snapshot.channelRegistry = {
      version: 1,
      channels: [
        ...snapshot.channelRegistry.channels.filter((entry) => entry.id !== input.channelId),
        {
          id: input.channelId,
          type: input.type,
          name: input.name,
          primaryAgentId: input.primaryAgentId ?? channel?.primaryAgentId ?? null,
          workspaces: [{
            workspaceId: input.workspaceId,
            workspacePath: input.workspacePath,
            agentIds: input.agentIds ?? [],
            groupAssignments: []
          }]
        }
      ]
    };
    return snapshot.channelRegistry;
  };

  const dependencies: WorkspaceChannelSetupDependencies = {
    getMissionControlSnapshot: async () => snapshot,
    getChannelConnectOverview: async () => ({
      providers: [{
        id: options.provider,
        label: options.provider,
        description: options.provider,
        setupMode: options.provider === "whatsapp" ? "qr" : options.provider === "slack" ? "app-tokens" : "bot-token",
        setupLabel: options.provider,
        pluginInstalled: options.pluginInstalled ?? true,
        pluginEnabled: options.pluginEnabled ?? true,
        pluginStateSource: "gateway",
        pluginStateError: null,
        configured: accounts.some((account) => account.configured),
        connected: accounts.some((account) => account.connected),
        running: accounts.some((account) => account.running),
        available: true,
        availabilityReason: null,
        address: null,
        accounts: accounts.map((account) => ({
          accountId: account.accountId,
          name: account.name,
          configured: account.configured,
          enabled: account.enabled,
          isDefault: account.isDefault ?? false,
          linked: account.linked,
          running: account.running,
          connected: account.connected,
          liveStatusAvailable: true,
          authenticationRequired: account.authenticationRequired === true,
          lastError: account.errorMessage
        }))
      }]
    } as never),
    installChannelPlugin: async () => ({ provider: options.provider, installed: true, restarted: true, restartError: null } as never),
    startChannelWebLogin: async () => ({ qrDataUrl: "data:image/png;base64,qr" } as never),
    waitForChannelWebLogin: async () => ({ status: "linked" } as never),
    createManagedChatChannelAccount: async (input) => ({
      id: input.accountId ?? options.declarationId,
      type: input.provider,
      name: input.name,
      enabled: true,
      configured: true
    } as never),
    upsertWorkspaceChannel: upsert,
    startChannelAccount: async (input) => {
      calls.start += 1;
      const current = snapshot.surfaceRuntime.accountsByProvider[input.provider]?.[input.accountId ?? ""];
      if (current) setAccount({ ...current, running: true, connected: true, status: "running" });
      return {} as never;
    },
    stopChannelAccount: async (input) => {
      calls.stop += 1;
      const current = snapshot.surfaceRuntime.accountsByProvider[input.provider]?.[input.accountId ?? ""];
      if (current) setAccount({ ...current, running: false, connected: false, status: "stopped" });
      return {} as never;
    }
  };

  for (const account of accounts) setAccount(account);
  return {
    dependencies,
    snapshot,
    calls,
    setAccount,
    get lastUpsert() {
      return lastUpsert;
    }
  };
}

function createSnapshot(options: {
  workspacePath: string;
  provider: HarnessOptions["provider"];
  accounts: SurfaceAccountRuntimeStatus[];
  binding: SurfaceAccountRuntimeStatus | null;
}): MissionControlSnapshot {
  const registry: ChannelRegistry = options.binding
    ? {
        version: 1,
        channels: [{
          id: options.binding.accountId,
          type: options.provider,
          name: options.binding.name,
          primaryAgentId: "agent-primary",
          workspaces: [{
            workspaceId: "workspace-1",
            workspacePath: options.workspacePath,
            agentIds: ["agent-primary"],
            groupAssignments: []
          }]
        }]
      }
    : { version: 1, channels: [] };
  const accountsByProvider = {
    [options.provider]: Object.fromEntries(options.accounts.map((account) => [account.accountId, account]))
  };
  const surfaceRuntime: SurfaceRuntimeSnapshot = {
    source: "gateway-probe",
    checkedAt: new Date().toISOString(),
    gatewayAccess: {
      ok: true,
      blocked: false,
      role: "operator",
      scopes: ["operator.read"],
      missingScopes: [],
      requestId: null,
      issue: null,
      repairAvailable: false,
      repairAction: null
    },
    providerOrder: [options.provider],
    providerLabels: {},
    accountsByProvider,
    accountsByKey: Object.fromEntries(options.accounts.map((account) => [account.key, account])),
    issue: null
  };
  return {
    generatedAt: new Date().toISOString(),
    mode: "live",
    diagnostics: {} as never,
    presence: [],
    channelAccounts: [],
    workspaces: [{
      id: "workspace-1",
      name: "Test workspace",
      slug: "test-workspace",
      path: options.workspacePath,
      kind: "workspace",
      agentIds: ["agent-primary"],
      modelIds: [],
      activeRuntimeIds: [],
      totalSessions: 0,
      health: "ready",
      bootstrap: {} as never,
      capabilities: { skills: [], tools: [], workspaceOnlyAgentCount: 1 },
      channels: []
    }],
    agents: [],
    models: [],
    runtimes: [],
    tasks: [],
    agentInbox: [],
    relationships: [],
    missionPresets: [],
    channelRegistry: registry,
    surfaceRuntime,
    surfaceDrift: {} as never
  };
}

function runtimeAccount(
  provider: HarnessOptions["provider"],
  accountId: string,
  overrides: Partial<SurfaceAccountRuntimeStatus> = {}
): SurfaceAccountRuntimeStatus {
  return {
    key: `${provider}:${accountId}`,
    provider,
    accountId,
    name: accountId,
    label: accountId,
    enabled: true,
    configured: false,
    linked: false,
    running: false,
    connected: false,
    isDefault: false,
    authenticationRequired: false,
    disabled: false,
    failed: false,
    status: "unknown",
    healthState: null,
    errorMessage: null,
    source: "gateway-probe",
    checkedAt: new Date().toISOString(),
    ...overrides
  };
}

function projectionOf(result: Awaited<ReturnType<typeof performWorkspaceChannelSetup>>) {
  type SetupProjection = Awaited<ReturnType<typeof getWorkspaceChannelSetupStatus>>;
  const candidate = result as { setup?: SetupProjection };
  return candidate.setup ?? result as SetupProjection;
}
