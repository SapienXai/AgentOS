import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  CHANNEL_CONNECT_PROVIDERS,
  getChannelConnectOverview,
  installChannelPlugin,
  startChannelAccount,
  startChannelWebLogin,
  stopChannelAccount,
  waitForChannelWebLogin
} from "@/lib/openclaw/application/channel-connect-service";
import { getMissionControlSnapshot } from "@/lib/openclaw/application/mission-control-service";
import {
  createManagedChatChannelAccount,
  upsertWorkspaceChannel
} from "@/lib/openclaw/application/channel-service";
import {
  getSurfaceCatalogEntry
} from "@/lib/openclaw/surface-catalog";
import type { OpenClawCommandOptions } from "@/lib/openclaw/client/types";
import type { MissionControlSurfaceProvider } from "@/lib/openclaw/types";
import {
  projectWorkspaceChannelSetup,
  type WorkspaceChannelSetupProvider
} from "@/lib/openclaw/domains/workspace-channel-setup";
import { WORKSPACE_PROVISIONING_MANIFEST_RELATIVE_PATH } from "@/lib/agentos/application/workspace-provisioning-store";
import { redactErrorMessage } from "@/lib/security/redaction";

export type WorkspaceChannelSetupAction =
  | "install-plugin"
  | "login-start"
  | "login-wait"
  | "configure"
  | "bind"
  | "start"
  | "stop";

export type WorkspaceChannelSetupRequest = {
  workspaceId: string;
  action: WorkspaceChannelSetupAction;
  provider: MissionControlSurfaceProvider;
  declarationId?: string | null;
  accountId?: string | null;
  name?: string | null;
  token?: string | null;
  botToken?: string | null;
  appToken?: string | null;
  primaryAgentId?: string | null;
  currentQrDataUrl?: string | null;
};

/** Application-service seam for executable orchestration tests. Provider-specific
 * behavior remains owned by the existing channel/connect services. */
export type WorkspaceChannelSetupDependencies = {
  getMissionControlSnapshot: typeof getMissionControlSnapshot;
  getChannelConnectOverview: typeof getChannelConnectOverview;
  installChannelPlugin: typeof installChannelPlugin;
  startChannelWebLogin: typeof startChannelWebLogin;
  waitForChannelWebLogin: typeof waitForChannelWebLogin;
  createManagedChatChannelAccount: typeof createManagedChatChannelAccount;
  upsertWorkspaceChannel: typeof upsertWorkspaceChannel;
  startChannelAccount: typeof startChannelAccount;
  stopChannelAccount: typeof stopChannelAccount;
};

const defaultWorkspaceChannelSetupDependencies: WorkspaceChannelSetupDependencies = {
  getMissionControlSnapshot,
  getChannelConnectOverview,
  installChannelPlugin,
  startChannelWebLogin,
  waitForChannelWebLogin,
  createManagedChatChannelAccount,
  upsertWorkspaceChannel,
  startChannelAccount,
  stopChannelAccount
};

export class WorkspaceChannelSetupError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(code: string, message: string, statusCode = 400) {
    super(message);
    this.name = "WorkspaceChannelSetupError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export async function getWorkspaceChannelSetupStatus(
  workspaceId: string,
  dependencies: WorkspaceChannelSetupDependencies = defaultWorkspaceChannelSetupDependencies
) {
  const loaded = await loadWorkspaceChannelSetup(workspaceId, dependencies);
  return {
    workspaceId,
    workspaceName: loaded.workspace.name,
    ...loaded.projection
  };
}

export async function performWorkspaceChannelSetup(
  input: WorkspaceChannelSetupRequest,
  options: OpenClawCommandOptions = {},
  dependencies: WorkspaceChannelSetupDependencies = defaultWorkspaceChannelSetupDependencies
) {
  const loaded = await loadWorkspaceChannelSetup(input.workspaceId, dependencies);
  const item = input.declarationId
    ? loaded.projection.items.find((candidate) =>
        candidate.declarationId === input.declarationId && candidate.provider === input.provider
      ) ?? null
    : null;

  if (!item && input.action !== "install-plugin") {
    throw new WorkspaceChannelSetupError(
      "workspace-channel-declaration-not-found",
      "The requested channel declaration is not present in this workspace's provisioning history."
    );
  }

  if (input.action === "install-plugin") {
    const plugin = await dependencies.installChannelPlugin(input.provider as Parameters<typeof installChannelPlugin>[0], options);
    return {
      plugin,
      setup: await getWorkspaceChannelSetupStatus(input.workspaceId, dependencies)
    };
  }

  if (input.action === "login-start") {
    if (input.provider !== "whatsapp") {
      throw new WorkspaceChannelSetupError("workspace-channel-login-unsupported", "Only WhatsApp uses the native web login flow.");
    }
    const login = await dependencies.startChannelWebLogin({
      provider: "whatsapp",
      accountId: normalizeOptional(input.accountId),
      force: true
    }, options);
    return {
      login,
      setup: await getWorkspaceChannelSetupStatus(input.workspaceId, dependencies)
    };
  }

  if (input.action === "login-wait") {
    if (input.provider !== "whatsapp") {
      throw new WorkspaceChannelSetupError("workspace-channel-login-unsupported", "Only WhatsApp uses the native web login flow.");
    }
    const login = await dependencies.waitForChannelWebLogin({
      provider: "whatsapp",
      accountId: normalizeOptional(input.accountId),
      currentQrDataUrl: normalizeOptional(input.currentQrDataUrl)
    }, options);
    return {
      login,
      setup: await getWorkspaceChannelSetupStatus(input.workspaceId, dependencies)
    };
  }

  if (input.action === "configure") {
    if (!isConfigurableChannelProvider(input.provider)) {
      throw new WorkspaceChannelSetupError(
        "workspace-channel-configuration-unsupported",
        `${getSurfaceCatalogEntry(input.provider).label} must be configured through its native OpenClaw account flow.`
      );
    }

    const name = normalizeOptional(input.name);
    if (!name) {
      throw new WorkspaceChannelSetupError("workspace-channel-name-required", "A channel account name is required.");
    }

    const requestedAccountId = normalizeAccountId(input.accountId);
    if (item && item.accountIds.length > 0 && !requestedAccountId) {
      throw new WorkspaceChannelSetupError(
        "workspace-channel-account-selection-required",
        "Choose an explicit OpenClaw account before configuring this declaration."
      );
    }
    const accountId = requestedAccountId ?? normalizeAccountId(item?.declarationId);
    const primaryAgentId = resolveAgentId(loaded.workspace.agentIds, input.primaryAgentId);
    const agentIds = primaryAgentId ? [primaryAgentId] : [];
    const existing = item?.accountIds.includes(accountId ?? "") ? item : null;
    if (existing?.configured) {
      await dependencies.upsertWorkspaceChannel({
        workspaceId: input.workspaceId,
        workspacePath: loaded.workspace.path,
        channelId: accountId!,
        type: input.provider,
        name,
        primaryAgentId,
        agentIds
      });
      return getWorkspaceChannelSetupStatus(input.workspaceId, dependencies);
    }

    const account = await dependencies.createManagedChatChannelAccount({
      provider: input.provider,
      name,
      accountId,
      token: input.token ?? undefined,
      botToken: input.botToken ?? undefined,
      appToken: input.appToken ?? undefined,
      commandOptions: options
    });
    await dependencies.upsertWorkspaceChannel({
      workspaceId: input.workspaceId,
      workspacePath: loaded.workspace.path,
      channelId: account.id,
      type: input.provider,
      name,
      primaryAgentId,
      agentIds
    });
    return getWorkspaceChannelSetupStatus(input.workspaceId, dependencies);
  }

  const accountId = normalizeAccountId(input.accountId ?? item?.accountId);
  if (!accountId) {
    throw new WorkspaceChannelSetupError("workspace-channel-account-required", "Choose an explicit OpenClaw account before continuing.");
  }

  const runtimeAccount = loaded.snapshot.surfaceRuntime.accountsByProvider[input.provider]?.[accountId] ?? null;
  if (!runtimeAccount) {
    throw new WorkspaceChannelSetupError("workspace-channel-account-unavailable", "OpenClaw did not return the selected account in live status.", 503);
  }

  if (input.action === "bind") {
    if (!(runtimeAccount.configured || runtimeAccount.connected || runtimeAccount.running || runtimeAccount.linked)) {
      throw new WorkspaceChannelSetupError("workspace-channel-account-not-ready", "The selected OpenClaw account is not configured or authenticated yet.");
    }
    const primaryAgentId = resolveAgentId(loaded.workspace.agentIds, input.primaryAgentId);
    const agentIds = primaryAgentId ? [primaryAgentId] : [];
    await dependencies.upsertWorkspaceChannel({
      workspaceId: input.workspaceId,
      workspacePath: loaded.workspace.path,
      channelId: accountId,
      type: input.provider,
      name: runtimeAccount.name || accountId,
      primaryAgentId,
      agentIds
    });
    return getWorkspaceChannelSetupStatus(input.workspaceId, dependencies);
  }

  if (input.action === "start") {
    await dependencies.startChannelAccount({ provider: input.provider as Parameters<typeof startChannelAccount>[0]["provider"], accountId }, options);
  } else {
    await dependencies.stopChannelAccount({ provider: input.provider as Parameters<typeof stopChannelAccount>[0]["provider"], accountId }, options);
  }

  return getWorkspaceChannelSetupStatus(input.workspaceId, dependencies);
}

async function loadWorkspaceChannelSetup(
  workspaceId: string,
  dependencies: WorkspaceChannelSetupDependencies
) {
  const snapshot = await dependencies.getMissionControlSnapshot({
    force: true,
    includeHidden: false,
    loadProfile: "refresh"
  });
  const workspace = snapshot.workspaces.find((candidate) => candidate.id === workspaceId) ?? null;
  if (!workspace) {
    throw new WorkspaceChannelSetupError("workspace-not-found", "Workspace was not found.", 404);
  }

  const pendingChannels = await readPendingChannelDeclarations(workspace.path);
  const providers = await resolveSetupProviders(dependencies);
  // WorkspaceProject.agentIds is the authoritative ordered agent list; the
  // first entry is the canonical primary established by provisioning.
  const primaryAgentId = workspace.agentIds[0] ?? null;
  const projection = projectWorkspaceChannelSetup({
    pendingChannels,
    workspaceId,
    primaryAgentId,
    workspaceAgentIds: workspace.agentIds,
    registry: snapshot.channelRegistry,
    surfaceRuntime: snapshot.surfaceRuntime,
    providers
  });

  return { snapshot, workspace, projection };
}

async function resolveSetupProviders(
  dependencies: WorkspaceChannelSetupDependencies
): Promise<WorkspaceChannelSetupProvider[]> {
  const overview = await dependencies.getChannelConnectOverview().catch(() => null);
  if (overview) {
    return overview.providers.map((provider) => ({
      id: provider.id,
      label: provider.label,
      setupMode: provider.setupMode,
      setupLabel: provider.setupLabel,
      implemented: provider.available,
      availabilityReason: provider.availabilityReason,
      pluginInstalled: provider.pluginInstalled,
      pluginEnabled: provider.pluginEnabled
    }));
  }

  return CHANNEL_CONNECT_PROVIDERS.map((provider) => {
    const catalog = getSurfaceCatalogEntry(provider);
    const implemented = ["whatsapp", "telegram", "discord", "slack"].includes(provider);
    return {
      id: provider,
      label: catalog.label,
      setupMode: provider === "whatsapp"
        ? "qr"
        : provider === "slack"
          ? "app-tokens"
          : provider === "telegram" || provider === "discord"
            ? "bot-token"
            : "cloud",
      setupLabel: provider === "whatsapp" ? "QR code" : catalog.label,
      implemented,
      availabilityReason: implemented ? null : "This provider setup is not available in AgentOS yet.",
      pluginInstalled: false,
      pluginEnabled: false
    } satisfies WorkspaceChannelSetupProvider;
  });
}

async function readPendingChannelDeclarations(workspacePath: string) {
  const filePath = path.join(workspacePath, WORKSPACE_PROVISIONING_MANIFEST_RELATIVE_PATH);
  const parsed = await readFile(filePath, "utf8").then((raw) => JSON.parse(raw) as unknown).catch(() => null);
  if (!isRecord(parsed) || !isRecord(parsed.agentosProvisioning) || !isRecord(parsed.agentosProvisioning.pendingSetup)) {
    return [];
  }

  const channels = parsed.agentosProvisioning.pendingSetup.channels;
  return Array.isArray(channels)
    ? channels.filter((channel): channel is string => typeof channel === "string" && channel.trim().length > 0)
    : [];
}

function isConfigurableChannelProvider(provider: MissionControlSurfaceProvider): provider is "telegram" | "discord" | "slack" {
  return provider === "telegram" || provider === "discord" || provider === "slack";
}

function normalizeOptional(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeAccountId(value: string | null | undefined) {
  const normalized = normalizeOptional(value);
  if (!normalized) return undefined;
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(normalized)) {
    throw new WorkspaceChannelSetupError("workspace-channel-account-id-invalid", "Account id contains unsupported characters.");
  }
  return normalized;
}

function resolveAgentId(agentIds: string[], requested: string | null | undefined) {
  const candidate = normalizeOptional(requested);
  if (!candidate) return agentIds[0] ?? null;
  if (!agentIds.includes(candidate)) {
    throw new WorkspaceChannelSetupError(
      "workspace-channel-agent-invalid",
      "The selected agent is no longer available in this workspace. Choose another agent and retry."
    );
  }
  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatWorkspaceChannelSetupError(error: unknown) {
  return redactErrorMessage(error, "Workspace channel setup failed.");
}
