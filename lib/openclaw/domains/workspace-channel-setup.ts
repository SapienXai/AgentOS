import type {
  ChannelRegistry,
  MissionControlSurfaceProvider,
  SurfaceAccountRuntimeStatus,
  SurfaceRuntimeSnapshot
} from "@/lib/openclaw/types";

export type WorkspaceChannelSetupStatus =
  | "not-configured"
  | "plugin-required"
  | "credentials-required"
  | "authentication-required"
  | "account-selection-required"
  | "configured"
  | "starting"
  | "running"
  | "connected"
  | "linked"
  | "blocked"
  | "error"
  | "unavailable";

export type WorkspaceChannelSetupAction =
  | "configure"
  | "authenticate"
  | "select-account"
  | "bind"
  | "install-plugin"
  | "start"
  | "retry"
  | "none";

export type WorkspaceChannelSetupProvider = {
  id: MissionControlSurfaceProvider;
  label: string;
  setupMode: "qr" | "bot-token" | "app-tokens" | "cloud" | "local-mac" | "external-cli";
  setupLabel: string;
  implemented: boolean;
  availabilityReason: string | null;
  pluginInstalled: boolean;
  pluginEnabled: boolean;
};

export type WorkspaceChannelSetupItem = {
  declarationId: string;
  historicalPending: string;
  provider: MissionControlSurfaceProvider;
  label: string;
  setupLabel: string;
  status: WorkspaceChannelSetupStatus;
  statusLabel: string;
  action: WorkspaceChannelSetupAction;
  accountId: string | null;
  accountIds: string[];
  primaryAgentId: string | null;
  bindingPresent: boolean;
  pluginInstalled: boolean;
  pluginEnabled: boolean;
  configured: boolean;
  linked: boolean;
  running: boolean;
  connected: boolean;
  nativeStatusAvailable: boolean;
  requiresCredentials: boolean;
  requiresAuthentication: boolean;
  lastError: string | null;
  availabilityReason: string | null;
  complete: boolean;
};

export type WorkspaceChannelSetupProjection = {
  items: WorkspaceChannelSetupItem[];
  pendingCount: number;
  complete: boolean;
  source: "native" | "unavailable";
  issue: string | null;
};

export type WorkspaceChannelSetupProjectionInput = {
  pendingChannels: string[];
  workspaceId: string;
  primaryAgentId: string | null;
  registry: ChannelRegistry;
  surfaceRuntime: SurfaceRuntimeSnapshot;
  providers: WorkspaceChannelSetupProvider[];
};

export function parsePendingChannelDeclaration(value: string) {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    return null;
  }

  return {
    provider: value.slice(0, separator).trim() as MissionControlSurfaceProvider,
    declarationId: value.slice(separator + 1).trim()
  };
}

export function projectWorkspaceChannelSetup(
  input: WorkspaceChannelSetupProjectionInput
): WorkspaceChannelSetupProjection {
  const nativeStatusAvailable =
    (input.surfaceRuntime.source === "gateway-probe" || input.surfaceRuntime.source === "gateway-status") &&
    !input.surfaceRuntime.gatewayAccess.blocked;
  const providerById = new Map(input.providers.map((provider) => [provider.id, provider] as const));
  const items = input.pendingChannels.map((historicalPending) => {
    const declaration = parsePendingChannelDeclaration(historicalPending);
    if (!declaration) {
      return buildUnavailableItem({
        historicalPending,
        declarationId: historicalPending,
        provider: "unknown" as MissionControlSurfaceProvider,
        label: "Unknown channel",
        setupLabel: "Unavailable",
        reason: "The historical channel declaration is malformed."
      });
    }

    const provider = providerById.get(declaration.provider);
    if (!provider) {
      return buildUnavailableItem({
        historicalPending,
        declarationId: declaration.declarationId,
        provider: declaration.provider,
        label: declaration.provider,
        setupLabel: "Unavailable",
        reason: "This channel provider is not available in the current AgentOS catalog."
      });
    }

    const workspaceChannels = input.registry.channels.filter((channel) =>
      channel.type === declaration.provider &&
      channel.workspaces.some((binding) => binding.workspaceId === input.workspaceId)
    );
    const runtimeAccounts = Object.values(
      input.surfaceRuntime.accountsByProvider[declaration.provider] ?? {}
    );
    const boundChannel = workspaceChannels.find((channel) => channel.id === declaration.declarationId) ??
      (workspaceChannels.length === 1 ? workspaceChannels[0] : null);
    const boundRuntime = boundChannel
      ? runtimeAccounts.find((account) => account.accountId === boundChannel.id) ?? null
      : null;

    if (!provider.implemented) {
      return buildUnavailableItem({
        historicalPending,
        declarationId: declaration.declarationId,
        provider: declaration.provider,
        label: provider.label,
        setupLabel: provider.setupLabel,
        reason: provider.availabilityReason ?? "This provider is not available in AgentOS."
      });
    }

    if (!nativeStatusAvailable) {
      return buildUnavailableItem({
        historicalPending,
        declarationId: declaration.declarationId,
        provider: declaration.provider,
        label: provider.label,
        setupLabel: provider.setupLabel,
        reason: input.surfaceRuntime.gatewayAccess.issue ?? input.surfaceRuntime.issue ?? "Live OpenClaw channel status is unavailable."
      });
    }

    if (!provider.pluginInstalled || !provider.pluginEnabled) {
      return buildBaseItem({
        historicalPending,
        declarationId: declaration.declarationId,
        provider,
        status: "plugin-required",
        statusLabel: "Channel plugin required",
        action: "install-plugin",
        accountId: null,
        accountIds: runtimeAccounts.map((account) => account.accountId),
        primaryAgentId: input.primaryAgentId,
        bindingPresent: Boolean(boundChannel),
        runtime: null,
        lastError: null,
        complete: false
      });
    }

    if (boundChannel && !boundRuntime) {
      return buildBaseItem({
        historicalPending,
        declarationId: declaration.declarationId,
        provider,
        status: "error",
        statusLabel: "Account not returned",
        action: "retry",
        accountId: boundChannel.id,
        accountIds: runtimeAccounts.map((account) => account.accountId),
        primaryAgentId: boundChannel.primaryAgentId ?? input.primaryAgentId,
        bindingPresent: true,
        runtime: null,
        lastError: "AgentOS has a workspace binding, but OpenClaw did not return that account in live status.",
        complete: false
      });
    }

    if (boundRuntime) {
      return buildRuntimeItem({
        historicalPending,
        declarationId: declaration.declarationId,
        provider,
        runtime: boundRuntime,
        accountId: boundRuntime.accountId,
        accountIds: runtimeAccounts.map((account) => account.accountId),
        primaryAgentId: boundChannel?.primaryAgentId ?? input.primaryAgentId,
        bindingPresent: true
      });
    }

    if (runtimeAccounts.length > 1) {
      return buildBaseItem({
        historicalPending,
        declarationId: declaration.declarationId,
        provider,
        status: "account-selection-required",
        statusLabel: "Choose an account",
        action: "select-account",
        accountId: null,
        accountIds: runtimeAccounts.map((account) => account.accountId),
        primaryAgentId: input.primaryAgentId,
        bindingPresent: false,
        runtime: null,
        lastError: "Multiple OpenClaw accounts exist; AgentOS will not select one implicitly.",
        complete: false
      });
    }

    const runtime = runtimeAccounts[0] ?? null;
    if (!runtime) {
      const needsAuthentication = provider.setupMode === "qr";
      const needsPlugin = !provider.pluginInstalled || !provider.pluginEnabled;
      return buildBaseItem({
        historicalPending,
        declarationId: declaration.declarationId,
        provider,
        status: needsPlugin
          ? "plugin-required"
          : needsAuthentication
            ? "authentication-required"
            : "credentials-required",
        statusLabel: needsPlugin
          ? "Channel plugin required"
          : needsAuthentication
            ? "Authentication required"
            : "Credentials required",
        action: needsPlugin ? "install-plugin" : needsAuthentication ? "authenticate" : "configure",
        accountId: null,
        accountIds: [],
        primaryAgentId: input.primaryAgentId,
        bindingPresent: false,
        runtime: null,
        lastError: null,
        complete: false
      });
    }

    return buildRuntimeItem({
      historicalPending,
      declarationId: declaration.declarationId,
      provider,
      runtime,
      accountId: runtime.accountId,
      accountIds: [runtime.accountId],
      primaryAgentId: input.primaryAgentId,
      bindingPresent: false
    });
  });

  const pendingCount = items.filter((item) => !item.complete).length;
  return {
    items,
    pendingCount,
    complete: pendingCount === 0,
    source: nativeStatusAvailable ? "native" : "unavailable",
    issue: nativeStatusAvailable ? null : input.surfaceRuntime.gatewayAccess.issue ?? input.surfaceRuntime.issue
  };
}

function buildRuntimeItem(input: {
  historicalPending: string;
  declarationId: string;
  provider: WorkspaceChannelSetupProvider;
  runtime: SurfaceAccountRuntimeStatus;
  accountId: string;
  accountIds: string[];
  primaryAgentId: string | null;
  bindingPresent: boolean;
}) {
  const runtimeState = normalizeRuntimeState(input.runtime);
  const connected = input.runtime.connected;
  const complete = input.bindingPresent && (connected || input.runtime.running || input.runtime.linked || input.runtime.configured);

  return buildBaseItem({
    ...input,
    status: runtimeState.status,
    statusLabel: runtimeState.statusLabel,
    action: complete
      ? "none"
      : input.runtime.authenticationRequired
        ? "authenticate"
        : !input.runtime.configured
          ? input.provider.setupMode === "qr" ? "authenticate" : "configure"
          : input.bindingPresent
            ? runtimeState.status === "configured" ? "start" : "retry"
            : "bind",
    runtime: input.runtime,
    lastError: input.runtime.errorMessage,
    complete
  });
}

function normalizeRuntimeState(runtime: SurfaceAccountRuntimeStatus): {
  status: WorkspaceChannelSetupStatus;
  statusLabel: string;
} {
  if (runtime.errorMessage || runtime.failed) return { status: "error", statusLabel: "OpenClaw error" };
  if (runtime.disabled) return { status: "blocked", statusLabel: "Disabled" };
  if (runtime.authenticationRequired) return { status: "authentication-required", statusLabel: "Authentication required" };
  if (runtime.connected) return { status: "connected", statusLabel: "Connected" };
  if (runtime.running) return { status: "running", statusLabel: "Running" };
  if (runtime.linked) return { status: "linked", statusLabel: "Linked" };
  if (runtime.configured) return { status: "configured", statusLabel: "Configured" };
  return { status: "not-configured", statusLabel: "Setup required" };
}

function buildUnavailableItem(input: {
  historicalPending: string;
  declarationId: string;
  provider: MissionControlSurfaceProvider;
  label: string;
  setupLabel: string;
  reason: string;
}): WorkspaceChannelSetupItem {
  const provider: WorkspaceChannelSetupProvider = {
    id: input.provider,
    label: input.label,
    setupMode: "cloud",
    setupLabel: input.setupLabel,
    implemented: false,
    availabilityReason: input.reason,
    pluginInstalled: false,
    pluginEnabled: false
  };

  return buildBaseItem({
    historicalPending: input.historicalPending,
    declarationId: input.declarationId,
    provider,
    status: "unavailable",
    statusLabel: "Unavailable",
    action: "none",
    accountId: null,
    accountIds: [],
    primaryAgentId: null,
    bindingPresent: false,
    runtime: null,
    lastError: null,
    availabilityReason: input.reason,
    complete: false
  });
}

function buildBaseItem(input: {
  historicalPending: string;
  declarationId: string;
  provider: WorkspaceChannelSetupProvider;
  status: WorkspaceChannelSetupStatus;
  statusLabel: string;
  action: WorkspaceChannelSetupAction;
  accountId: string | null;
  accountIds: string[];
  primaryAgentId: string | null;
  bindingPresent: boolean;
  runtime: SurfaceAccountRuntimeStatus | null;
  lastError: string | null;
  availabilityReason?: string | null;
  complete: boolean;
}): WorkspaceChannelSetupItem {
  return {
    declarationId: input.declarationId,
    historicalPending: input.historicalPending,
    provider: input.provider.id,
    label: input.provider.label,
    setupLabel: input.provider.setupLabel,
    status: input.status,
    statusLabel: input.statusLabel,
    action: input.action,
    accountId: input.accountId,
    accountIds: input.accountIds,
    primaryAgentId: input.primaryAgentId,
    bindingPresent: input.bindingPresent,
    pluginInstalled: input.provider.pluginInstalled,
    pluginEnabled: input.provider.pluginEnabled,
    configured: input.runtime?.configured ?? false,
    linked: input.runtime?.linked ?? false,
    running: input.runtime?.running ?? false,
    connected: input.runtime?.connected ?? false,
    nativeStatusAvailable: input.status !== "unavailable",
    requiresCredentials: input.provider.setupMode === "bot-token" || input.provider.setupMode === "app-tokens",
    requiresAuthentication: input.provider.setupMode === "qr" || input.runtime?.authenticationRequired === true,
    lastError: input.lastError,
    availabilityReason: input.availabilityReason ?? null,
    complete: input.complete
  };
}
