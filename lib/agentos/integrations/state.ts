import type {
  AgentRecord,
  MissionControlSnapshot,
  ModelRecord,
  SurfaceAccountRecord,
  SurfaceChannelRecord
} from "@/lib/agentos/contracts";
import {
  formatAgentDisplayName,
  formatRelativeTime,
  resolveRelativeTimeReferenceMs
} from "@/lib/openclaw/presenters";
import {
  integrationRegistry,
  normalizeIntegrationLookupKey,
  type IntegrationActionCapability,
  type IntegrationCategory,
  type IntegrationDescriptor,
  type IntegrationId,
  type IntegrationManagedBy,
  type IntegrationProviderType
} from "@/lib/agentos/integrations/registry";
import { normalizeSurfaceIntegrationStatus } from "@/lib/openclaw/surface-status";
import type { SurfaceAccountRuntimeStatus } from "@/lib/openclaw/types";

export type IntegrationStatus =
  | "connected"
  | "running"
  | "linked"
  | "configured"
  | "stopped"
  | "disabled"
  | "pending-setup"
  | "failed"
  | "needs-authentication"
  | "missing-credentials"
  | "unsupported"
  | "unknown";

export type IntegrationLinkedAgent = {
  id: string;
  name: string;
  workspaceName: string;
  reason: string;
};

export type IntegrationConnectionHealth = {
  label: string;
  detail: string;
};

export type IntegrationActionSupport = Record<"configure" | "reconnect" | "disable", IntegrationActionCapability>;

export type IntegrationState = {
  id: IntegrationId;
  name: string;
  category: IntegrationCategory;
  description: string;
  managedBy: IntegrationManagedBy;
  providerType: IntegrationProviderType;
  surfaceProvider: IntegrationDescriptor["surfaceProvider"] | null;
  modelProvider: IntegrationDescriptor["modelProvider"] | null;
  status: IntegrationStatus;
  statusLabel: string;
  connectionHealth: IntegrationConnectionHealth;
  lastSyncLabel: string;
  lastActiveMs: number | null;
  uptimeLabel: string;
  rateLimitLabel: string;
  linkedAgents: IntegrationLinkedAgent[];
  linkedAgentCount: number;
  permissions: string[];
  setupRequirements: string[];
  missingConfiguration: string[];
  sourceMethods: string[];
  accountIds: string[];
  channelIds: string[];
  modelIds: string[];
  errorMessage: string | null;
  docsUrl: string | null;
  actionSupport: IntegrationActionSupport;
  source?: SurfaceAccountRecord;
};

export const integrationStatusLabels: Record<IntegrationStatus, string> = {
  connected: "Connected",
  running: "Running",
  linked: "Linked",
  configured: "Configured",
  stopped: "Stopped",
  disabled: "Disabled",
  "pending-setup": "Pending Setup",
  failed: "Failed",
  "needs-authentication": "Needs Authentication",
  "missing-credentials": "Missing Credentials",
  unsupported: "Unsupported",
  unknown: "Unknown"
};

export type IntegrationSummaryStats = {
  total: number;
  connected: number;
  pending: number;
  failed: number;
  automationsUsing: number | null;
};

export function buildIntegrationStates(snapshot: MissionControlSnapshot): IntegrationState[] {
  const referenceMs = resolveRelativeTimeReferenceMs(snapshot.generatedAt);
  const generatedAtMs = Date.parse(snapshot.generatedAt);
  const workspaceNameById = new Map(snapshot.workspaces.map((workspace) => [workspace.id, workspace.name]));
  const agentsById = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
  const channelsByProvider = groupChannelsByProvider(snapshot.channelRegistry.channels);
  const accountsByProvider = groupAccountsByProvider(snapshot.channelAccounts);
  mergeRuntimeAccountsByProvider(accountsByProvider, snapshot);
  const modelsByProvider = groupModelsByProvider(snapshot.models);

  return integrationRegistry.map((descriptor) => {
    const sources = ["integrationRegistry"];

    if (descriptor.surfaceProvider) {
      sources.push("OPENCLAW_SURFACE_CATALOG");
    }

    const channels = descriptor.surfaceProvider
      ? channelsByProvider.get(normalizeIntegrationLookupKey(descriptor.surfaceProvider)) ?? []
      : [];
    const accounts = descriptor.surfaceProvider
      ? accountsByProvider.get(normalizeIntegrationLookupKey(descriptor.surfaceProvider)) ?? []
      : [];
    const models = descriptor.modelProvider
      ? modelsByProvider.get(descriptor.modelProvider) ?? []
      : [];

    if (accounts.length > 0) {
      sources.push("snapshot.channelAccounts");
    }

    if (channels.length > 0) {
      sources.push("snapshot.channelRegistry.channels");
    }

    if (models.length > 0) {
      sources.push("snapshot.models");
    }

    const linkedAgents = resolveLinkedAgents({
      descriptor,
      channels,
      models,
      agents: snapshot.agents,
      agentsById,
      workspaceNameById
    });

    if (linkedAgents.length > 0) {
      sources.push("snapshot.agents");
    }

    const state = resolveIntegrationStatus({
      descriptor,
      accounts,
      channels,
      models,
      linkedAgents,
      snapshot
    });
    const lastActiveMs = state.hasOperationalData && Number.isFinite(generatedAtMs) ? generatedAtMs : null;

    return {
      id: descriptor.id,
      name: descriptor.name,
      category: descriptor.category,
      description: descriptor.description,
      managedBy: descriptor.managedBy,
      providerType: descriptor.providerType,
      surfaceProvider: descriptor.surfaceProvider ?? null,
      modelProvider: descriptor.modelProvider ?? null,
      status: state.status,
      statusLabel: "statusLabel" in state && state.statusLabel
        ? state.statusLabel
        : integrationStatusLabels[state.status],
      connectionHealth: state.connectionHealth,
      lastSyncLabel: lastActiveMs ? `Snapshot ${formatRelativeTime(lastActiveMs, referenceMs)}` : "Unavailable",
      lastActiveMs,
      uptimeLabel: state.uptimeLabel,
      rateLimitLabel: state.rateLimitLabel,
      linkedAgents,
      linkedAgentCount: linkedAgents.length,
      permissions: descriptor.permissions,
      setupRequirements: descriptor.setupRequirements,
      missingConfiguration: state.missingConfiguration,
      sourceMethods: uniqueStrings(sources),
      accountIds: accounts.map((account) => resolveChannelAccountId(account)),
      channelIds: channels.map((channel) => channel.id),
      modelIds: models.map((model) => model.id),
      errorMessage: state.errorMessage,
      docsUrl: descriptor.docsUrl ?? null,
      actionSupport: {
        configure: descriptor.configure,
        reconnect: descriptor.reconnect,
        disable: descriptor.disable
      },
      source: accounts[0]
    };
  });
}

export function summarizeIntegrationStates(integrations: IntegrationState[]): IntegrationSummaryStats {
  return {
    total: integrations.length,
    connected: integrations.filter((integration) => integration.status === "connected").length,
    pending: integrations.filter((integration) =>
      integration.status === "running" ||
      integration.status === "linked" ||
      integration.status === "pending-setup" ||
      integration.status === "configured" ||
      integration.status === "stopped" ||
      integration.status === "missing-credentials" ||
      integration.status === "needs-authentication"
    ).length,
    failed: integrations.filter((integration) => integration.status === "failed").length,
    automationsUsing: null
  };
}

function resolveIntegrationStatus(input: {
  descriptor: IntegrationDescriptor;
  accounts: SurfaceAccountRecord[];
  channels: SurfaceChannelRecord[];
  models: ModelRecord[];
  linkedAgents: IntegrationLinkedAgent[];
  snapshot: MissionControlSnapshot;
}) {
  const { descriptor, accounts, channels, models, linkedAgents, snapshot } = input;
  const accountError = readAccountError(accounts);

  if (descriptor.managedBy === "unsupported") {
    return {
      status: "unsupported" as const,
      connectionHealth: {
        label: "Unsupported",
        detail: descriptor.configure.reason
      },
      missingConfiguration: descriptor.setupRequirements,
      errorMessage: null,
      uptimeLabel: "Unavailable",
      rateLimitLabel: "Unavailable",
      hasOperationalData: false
    };
  }

  if (!snapshot.diagnostics.installed) {
    return {
      status: "unknown" as const,
      connectionHealth: {
        label: "OpenClaw not installed",
        detail: "AgentOS cannot resolve live integration state until OpenClaw is installed."
      },
      missingConfiguration: ["OpenClaw installation"],
      errorMessage: null,
      uptimeLabel: "Unavailable",
      rateLimitLabel: "Unavailable",
      hasOperationalData: false
    };
  }

  if (descriptor.surfaceProvider && snapshot.surfaceRuntime) {
    const runtime = normalizeSurfaceIntegrationStatus(snapshot.surfaceRuntime, descriptor.surfaceProvider);
    if (runtime.status !== "missing-credentials" || Object.keys(snapshot.surfaceRuntime.accountsByProvider[descriptor.surfaceProvider] ?? {}).length > 0) {
      return {
        status: runtime.status,
        statusLabel: runtime.statusLabel,
        connectionHealth: runtime.connectionHealth,
        missingConfiguration: [],
        errorMessage: runtime.errorMessage,
        uptimeLabel: "Unavailable",
        rateLimitLabel: "Unavailable",
        hasOperationalData: true
      };
    }
  }

  if (accountError) {
    return {
      status: "failed" as const,
      connectionHealth: {
        label: "OpenClaw reported an error",
        detail: accountError
      },
      missingConfiguration: [],
      errorMessage: accountError,
      uptimeLabel: "Unavailable",
      rateLimitLabel: "Unavailable",
      hasOperationalData: true
    };
  }

  if (descriptor.modelProvider) {
    return resolveModelProviderStatus(descriptor, models, snapshot);
  }

  if (descriptor.providerType === "tool") {
    if (linkedAgents.length > 0) {
      return {
        status: "connected" as const,
        connectionHealth: {
          label: "Configured on agents",
          detail: "This state is inferred from real agent tool declarations and runtime tool metadata."
        },
        missingConfiguration: [],
        errorMessage: null,
        uptimeLabel: "Unavailable",
        rateLimitLabel: "Unavailable",
        hasOperationalData: true
      };
    }

    return {
      status: "unknown" as const,
      connectionHealth: {
        label: "No linked agent tools",
        detail: "No agent currently declares or recently used a matching tool."
      },
      missingConfiguration: descriptor.setupRequirements,
      errorMessage: null,
      uptimeLabel: "Unavailable",
      rateLimitLabel: "Unavailable",
      hasOperationalData: false
    };
  }

  if (accounts.length > 0 && accounts.every((account) => account.enabled === false)) {
    return {
      status: "disabled" as const,
      connectionHealth: {
        label: "Disabled in OpenClaw config",
        detail: "The integration account exists but is disabled."
      },
      missingConfiguration: [],
      errorMessage: null,
      uptimeLabel: "Unavailable",
      rateLimitLabel: "Unavailable",
      hasOperationalData: true
    };
  }

  if (accounts.some((account) => account.enabled !== false)) {
    return {
      status: "unknown" as const,
      connectionHealth: {
        label: "Configured, not verified",
        detail: "OpenClaw configuration exists, but this snapshot does not include a live connector health probe. Use Reconnect to run channels.status."
      },
      missingConfiguration: [],
      errorMessage: null,
      uptimeLabel: "Unavailable",
      rateLimitLabel: "Unavailable",
      hasOperationalData: true
    };
  }

  if (channels.length > 0) {
    return {
      status: "unknown" as const,
      connectionHealth: {
        label: "Workspace binding found",
        detail: "A workspace binding exists, but OpenClaw account configuration was not returned in the snapshot."
      },
      missingConfiguration: descriptor.setupRequirements,
      errorMessage: null,
      uptimeLabel: "Unavailable",
      rateLimitLabel: "Unavailable",
      hasOperationalData: true
    };
  }

  return {
    status: descriptor.surfaceProvider ? "missing-credentials" as const : "pending-setup" as const,
    connectionHealth: {
      label: "Not configured",
      detail: "No OpenClaw account, workspace binding, or runtime state was found for this integration."
    },
    missingConfiguration: descriptor.setupRequirements,
    errorMessage: null,
    uptimeLabel: "Unavailable",
    rateLimitLabel: "Unavailable",
    hasOperationalData: false
  };
}

function resolveModelProviderStatus(
  descriptor: IntegrationDescriptor,
  models: ModelRecord[],
  snapshot: MissionControlSnapshot
) {
  if (models.length === 0) {
    return {
      status: descriptor.modelProvider === "ollama" ? "pending-setup" as const : "missing-credentials" as const,
      connectionHealth: {
        label: descriptor.modelProvider === "ollama" ? "No local models detected" : "No configured model routes",
        detail: descriptor.modelProvider === "ollama"
          ? "Ollama may be installed, but this snapshot does not include any local Ollama model routes."
          : "Connect the provider and add at least one model route in the existing Add Models flow."
      },
      missingConfiguration: descriptor.setupRequirements,
      errorMessage: null,
      uptimeLabel: "Unavailable",
      rateLimitLabel: "Unavailable",
      hasOperationalData: false
    };
  }

  if (models.every((model) => model.missing || model.available === false)) {
    return {
      status: "failed" as const,
      connectionHealth: {
        label: "Configured routes unavailable",
        detail: "OpenClaw returned model routes for this provider, but none are currently available."
      },
      missingConfiguration: [],
      errorMessage: "Configured model routes are missing or unavailable.",
      uptimeLabel: "Unavailable",
      rateLimitLabel: "Unavailable",
      hasOperationalData: true
    };
  }

  const defaultModel = snapshot.diagnostics.modelReadiness.resolvedDefaultModel ?? snapshot.diagnostics.modelReadiness.defaultModel;
  const defaultMatchesProvider = defaultModel
    ? normalizeModelProviderKey(defaultModel) === descriptor.modelProvider
    : false;

  return {
    status: "connected" as const,
    connectionHealth: {
      label: defaultMatchesProvider ? "Connected and default-capable" : "Connected",
      detail: `${models.length} configured model route${models.length === 1 ? "" : "s"} found in the OpenClaw model snapshot.`
    },
    missingConfiguration: [],
    errorMessage: null,
    uptimeLabel: "Unavailable",
    rateLimitLabel: "Provider-specific limits are not exposed in the snapshot",
    hasOperationalData: true
  };
}

function resolveLinkedAgents(input: {
  descriptor: IntegrationDescriptor;
  channels: SurfaceChannelRecord[];
  models: ModelRecord[];
  agents: AgentRecord[];
  agentsById: Map<string, AgentRecord>;
  workspaceNameById: Map<string, string>;
}) {
  const linkedAgents = new Map<string, IntegrationLinkedAgent>();

  for (const channel of input.channels) {
    const channelAgentIds = new Set<string>();

    if (channel.primaryAgentId) {
      channelAgentIds.add(channel.primaryAgentId);
    }

    for (const binding of channel.workspaces) {
      for (const agentId of binding.agentIds) {
        channelAgentIds.add(agentId);
      }

      for (const assignment of binding.groupAssignments) {
        if (assignment.agentId) {
          channelAgentIds.add(assignment.agentId);
        }
      }
    }

    for (const agentId of channelAgentIds) {
      const agent = input.agentsById.get(agentId);
      if (agent) {
        linkedAgents.set(agent.id, buildLinkedAgent(agent, input.workspaceNameById, `Workspace surface: ${channel.name}`));
      }
    }
  }

  if (input.descriptor.modelProvider) {
    for (const agent of input.agents) {
      if (normalizeModelProviderKey(agent.modelId) === input.descriptor.modelProvider) {
        linkedAgents.set(agent.id, buildLinkedAgent(agent, input.workspaceNameById, `Model route: ${agent.modelId}`));
      }
    }
  }

  if (input.descriptor.toolHints?.length) {
    const hintPattern = new RegExp(input.descriptor.toolHints.map(escapeRegExp).join("|"), "i");
    for (const agent of input.agents) {
      const toolList = [...agent.tools, ...(agent.observedTools ?? [])].join(" ");
      if (hintPattern.test(toolList) || hintPattern.test(agent.policy.preset) || hintPattern.test(agent.name)) {
        linkedAgents.set(agent.id, buildLinkedAgent(agent, input.workspaceNameById, "Agent tool configuration"));
      }
    }
  }

  return Array.from(linkedAgents.values()).sort((left, right) => left.name.localeCompare(right.name));
}

function buildLinkedAgent(
  agent: AgentRecord,
  workspaceNameById: Map<string, string>,
  reason: string
): IntegrationLinkedAgent {
  return {
    id: agent.id,
    name: formatAgentDisplayName(agent),
    workspaceName: workspaceNameById.get(agent.workspaceId) ?? agent.workspaceId,
    reason
  };
}

function groupChannelsByProvider(channels: SurfaceChannelRecord[]) {
  const grouped = new Map<string, SurfaceChannelRecord[]>();

  for (const channel of channels) {
    const key = normalizeIntegrationLookupKey(channel.type);
    grouped.set(key, [...(grouped.get(key) ?? []), channel]);
  }

  return grouped;
}

function groupAccountsByProvider(accounts: SurfaceAccountRecord[]) {
  const grouped = new Map<string, SurfaceAccountRecord[]>();

  for (const account of accounts) {
    const key = normalizeIntegrationLookupKey(account.type);
    grouped.set(key, [...(grouped.get(key) ?? []), account]);
  }

  return grouped;
}

function resolveChannelAccountId(account: Pick<SurfaceAccountRecord, "id" | "accountId">) {
  return account.accountId?.trim() || account.id;
}

function groupModelsByProvider(models: ModelRecord[]) {
  const grouped = new Map<string, ModelRecord[]>();

  for (const model of models) {
    const key = normalizeModelProviderKey(model.provider || model.id);
    grouped.set(key, [...(grouped.get(key) ?? []), model]);
  }

  return grouped;
}

function mergeRuntimeAccountsByProvider(
  grouped: Map<string, SurfaceAccountRecord[]>,
  snapshot: MissionControlSnapshot
) {
  const runtimeAccounts = Object.values(snapshot.surfaceRuntime?.accountsByKey ?? {});
  for (const account of runtimeAccounts) {
    const key = normalizeIntegrationLookupKey(account.provider);
    const current = grouped.get(key) ?? [];
    if (current.some((candidate) => resolveChannelAccountId(candidate) === account.accountId)) {
      continue;
    }

    current.push(toSurfaceAccountRecord(account));
    grouped.set(key, current);
  }
}

function toSurfaceAccountRecord(account: SurfaceAccountRuntimeStatus): SurfaceAccountRecord {
  return {
    id: account.accountId,
    accountId: account.accountId,
    type: account.provider,
    name: account.name,
    enabled: account.enabled,
    configured: account.configured,
    isDefault: account.isDefault === true,
    kind: "chat",
    capabilities: ["chat"],
    metadata: {
      source: "surfaceRuntime",
      status: account.status,
      healthState: account.healthState,
      ...(account.errorMessage ? { lastError: account.errorMessage } : {})
    }
  };
}

function normalizeModelProviderKey(value: string) {
  return value.trim().toLowerCase().split("/")[0];
}

function readAccountError(accounts: SurfaceAccountRecord[]) {
  for (const account of accounts) {
    const metadata = account.metadata ?? {};
    const candidate =
      readMetadataString(metadata, ["lastError", "error", "healthError", "reason"]) ??
      (typeof metadata.healthState === "string" && /fail|error/i.test(metadata.healthState)
        ? metadata.healthState
        : null);

    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function readMetadataString(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
