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

export async function getWorkspaceChannelSetupStatus(workspaceId: string) {
  const loaded = await loadWorkspaceChannelSetup(workspaceId);
  return {
    workspaceId,
    workspaceName: loaded.workspace.name,
    ...loaded.projection
  };
}

export async function performWorkspaceChannelSetup(
  input: WorkspaceChannelSetupRequest,
  options: OpenClawCommandOptions = {}
) {
  const loaded = await loadWorkspaceChannelSetup(input.workspaceId);
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
    const plugin = await installChannelPlugin(input.provider as Parameters<typeof installChannelPlugin>[0], options);
    return {
      plugin,
      setup: await getWorkspaceChannelSetupStatus(input.workspaceId)
    };
  }

  if (input.action === "login-start") {
    if (input.provider !== "whatsapp") {
      throw new WorkspaceChannelSetupError("workspace-channel-login-unsupported", "Only WhatsApp uses the native web login flow.");
    }
    const login = await startChannelWebLogin({
      provider: "whatsapp",
      accountId: normalizeOptional(input.accountId),
      force: true
    }, options);
    return {
      login,
      setup: await getWorkspaceChannelSetupStatus(input.workspaceId)
    };
  }

  if (input.action === "login-wait") {
    if (input.provider !== "whatsapp") {
      throw new WorkspaceChannelSetupError("workspace-channel-login-unsupported", "Only WhatsApp uses the native web login flow.");
    }
    const login = await waitForChannelWebLogin({
      provider: "whatsapp",
      accountId: normalizeOptional(input.accountId),
      currentQrDataUrl: normalizeOptional(input.currentQrDataUrl)
    }, options);
    return {
      login,
      setup: await getWorkspaceChannelSetupStatus(input.workspaceId)
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
    const existing = item?.accountIds.includes(accountId ?? "") ? item : null;
    if (existing?.configured) {
      await upsertWorkspaceChannel({
        workspaceId: input.workspaceId,
        workspacePath: loaded.workspace.path,
        channelId: accountId!,
        type: input.provider,
        name,
        primaryAgentId: resolveAgentId(loaded.workspace.agentIds, input.primaryAgentId),
        agentIds: resolveAgentIds(loaded.workspace.agentIds, input.primaryAgentId)
      });
      return getWorkspaceChannelSetupStatus(input.workspaceId);
    }

    const account = await createManagedChatChannelAccount({
      provider: input.provider,
      name,
      accountId,
      token: input.token ?? undefined,
      botToken: input.botToken ?? undefined,
      appToken: input.appToken ?? undefined,
      commandOptions: options
    });
    await upsertWorkspaceChannel({
      workspaceId: input.workspaceId,
      workspacePath: loaded.workspace.path,
      channelId: account.id,
      type: input.provider,
      name,
      primaryAgentId: resolveAgentId(loaded.workspace.agentIds, input.primaryAgentId),
      agentIds: resolveAgentIds(loaded.workspace.agentIds, input.primaryAgentId)
    });
    return getWorkspaceChannelSetupStatus(input.workspaceId);
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
    await upsertWorkspaceChannel({
      workspaceId: input.workspaceId,
      workspacePath: loaded.workspace.path,
      channelId: accountId,
      type: input.provider,
      name: runtimeAccount.name || accountId,
      primaryAgentId: resolveAgentId(loaded.workspace.agentIds, input.primaryAgentId),
      agentIds: resolveAgentIds(loaded.workspace.agentIds, input.primaryAgentId)
    });
    return getWorkspaceChannelSetupStatus(input.workspaceId);
  }

  if (input.action === "start") {
    await startChannelAccount({ provider: input.provider as Parameters<typeof startChannelAccount>[0]["provider"], accountId }, options);
  } else {
    await stopChannelAccount({ provider: input.provider as Parameters<typeof stopChannelAccount>[0]["provider"], accountId }, options);
  }

  return getWorkspaceChannelSetupStatus(input.workspaceId);
}

async function loadWorkspaceChannelSetup(workspaceId: string) {
  const snapshot = await getMissionControlSnapshot({
    force: true,
    includeHidden: false,
    loadProfile: "refresh"
  });
  const workspace = snapshot.workspaces.find((candidate) => candidate.id === workspaceId) ?? null;
  if (!workspace) {
    throw new WorkspaceChannelSetupError("workspace-not-found", "Workspace was not found.", 404);
  }

  const pendingChannels = await readPendingChannelDeclarations(workspace.path);
  const providers = await resolveSetupProviders();
  const primaryAgentId = snapshot.agents.find((agent) => agent.workspaceId === workspace.id && agent.id === workspace.agentIds[0])?.id ?? workspace.agentIds[0] ?? null;
  const projection = projectWorkspaceChannelSetup({
    pendingChannels,
    workspaceId,
    primaryAgentId,
    registry: snapshot.channelRegistry,
    surfaceRuntime: snapshot.surfaceRuntime,
    providers
  });

  return { snapshot, workspace, projection };
}

async function resolveSetupProviders(): Promise<WorkspaceChannelSetupProvider[]> {
  const overview = await getChannelConnectOverview().catch(() => null);
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
  return candidate && agentIds.includes(candidate) ? candidate : agentIds[0] ?? null;
}

function resolveAgentIds(agentIds: string[], requested: string | null | undefined) {
  const selected = resolveAgentId(agentIds, requested);
  return selected ? [selected] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function formatWorkspaceChannelSetupError(error: unknown) {
  return redactErrorMessage(error, "Workspace channel setup failed.");
}
