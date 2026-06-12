import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type { OpenClawChannelStatusPayload } from "@/lib/openclaw/client/types";
import { parseDiscordRouteId } from "@/lib/openclaw/domains/discord-route";
import { getSurfaceCatalogEntry } from "@/lib/openclaw/surface-catalog";
import type { SnapshotLoadProfile } from "@/lib/openclaw/state/snapshot-cache";
import type {
  ChannelAccountRecord,
  ChannelRegistry,
  MissionControlSurfaceProvider,
  SurfaceAccountHealthStatus,
  SurfaceAccountRuntimeStatus,
  SurfaceBindingDriftIssue,
  SurfaceBindingRepairResult,
  SurfaceDriftSnapshot,
  SurfaceGatewayAccessState,
  SurfaceRuntimeSnapshot,
  SurfaceRuntimeSource,
  WorkspaceChannelGroupAssignment,
  WorkspaceChannelSummary
} from "@/lib/openclaw/types";
import {
  resolveGatewayAuthRepairAction,
  type GatewayAuthRepairAction
} from "@/lib/openclaw/gateway-auth-actions";
import { redactErrorMessage, redactSecretText } from "@/lib/security/redaction";

type ManagedOpenClawBinding = {
  agentId: string;
  match: {
    channel: string;
    accountId?: string;
    guildId?: string;
    roles?: string[];
    teamId?: string;
    query?: string;
    peer?: {
      kind: string;
      id: string;
    };
  };
};

type NormalizedBinding = {
  key: string;
  matchKey: string;
  agentId: string;
  provider: MissionControlSurfaceProvider;
  accountId: string | null;
  routeId: string | null;
  routeKind: string | null;
  raw: unknown;
};

const REQUIRED_STATUS_SCOPES = ["operator.read"];
const EMPTY_GATEWAY_ACCESS: SurfaceGatewayAccessState = {
  ok: true,
  blocked: false,
  role: null,
  scopes: [],
  missingScopes: [],
  requestId: null,
  issue: null,
  repairAvailable: false,
  repairAction: null
};

export function createEmptySurfaceRuntimeSnapshot(
  source: SurfaceRuntimeSource,
  issue: string | null = null
): SurfaceRuntimeSnapshot {
  return {
    source,
    checkedAt: null,
    gatewayAccess: issue ? buildSurfaceGatewayAccessFromMessage(issue) : EMPTY_GATEWAY_ACCESS,
    providerOrder: [],
    providerLabels: {},
    accountsByProvider: {},
    accountsByKey: {},
    issue
  };
}

export function createEmptySurfaceDriftSnapshot(
  checked = false,
  source: SurfaceDriftSnapshot["source"] = "unavailable"
): SurfaceDriftSnapshot {
  return {
    checked,
    source,
    checkedAt: null,
    expectedBindingCount: 0,
    currentBindingCount: 0,
    summary: {
      ok: 0,
      missingBindings: 0,
      extraBindings: 0,
      agentMismatch: 0,
      accountMissing: 0,
      providerDisabled: 0
    },
    issues: []
  };
}

export async function loadSurfaceRuntimeSnapshot(input: {
  profile: SnapshotLoadProfile;
  channelAccounts: ChannelAccountRecord[];
  channelRegistry: ChannelRegistry;
}): Promise<SurfaceRuntimeSnapshot> {
  if (input.profile === "interactive") {
    return createConfigOnlySurfaceRuntimeSnapshot(input.channelAccounts, input.channelRegistry, {
      issue: "Live OpenClaw channel status is skipped for interactive snapshots."
    });
  }

  try {
    const payload = await getOpenClawAdapter().getChannelStatus(
      {
        probe: true,
        timeoutMs: 5_000
      },
      {
        timeoutMs: 7_000
      }
    );

    return normalizeSurfaceRuntimeFromChannelStatus(payload, {
      source: "gateway-probe",
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    const message = redactErrorMessage(error, "OpenClaw channel status is unavailable.");
    return createConfigOnlySurfaceRuntimeSnapshot(input.channelAccounts, input.channelRegistry, {
      issue: message,
      gatewayAccess: buildSurfaceGatewayAccessFromMessage(message)
    });
  }
}

export function normalizeSurfaceRuntimeFromChannelStatus(
  payload: OpenClawChannelStatusPayload,
  options: {
    source: Extract<SurfaceRuntimeSource, "gateway-probe" | "gateway-status">;
    checkedAt: string;
  }
): SurfaceRuntimeSnapshot {
  const providerLabels = normalizeProviderLabels(payload);
  const providerOrder = uniqueStrings([
    ...(Array.isArray(payload.channelOrder) ? payload.channelOrder : []),
    ...Object.keys(payload.channelAccounts ?? {}),
    ...Object.keys(providerLabels)
  ]) as MissionControlSurfaceProvider[];
  const accountsByProvider: SurfaceRuntimeSnapshot["accountsByProvider"] = {};
  const accountsByKey: SurfaceRuntimeSnapshot["accountsByKey"] = {};

  for (const provider of providerOrder) {
    const providerAccounts = payload.channelAccounts?.[provider] ?? [];
    for (const rawAccount of providerAccounts) {
      if (isPlaceholderDefaultRuntimeAccount(rawAccount, providerAccounts)) {
        continue;
      }

      const account = normalizeSurfaceAccountRuntimeStatus(provider, rawAccount, {
        source: options.source,
        checkedAt: options.checkedAt,
        providerLabel: providerLabels[provider] ?? getSurfaceCatalogEntry(provider).label
      });

      if (!account) {
        continue;
      }

      accountsByProvider[provider] ??= {};
      accountsByProvider[provider][account.accountId] = account;
      accountsByKey[account.key] = account;
    }
  }

  return {
    source: options.source,
    checkedAt: options.checkedAt,
    gatewayAccess: EMPTY_GATEWAY_ACCESS,
    providerOrder,
    providerLabels,
    accountsByProvider,
    accountsByKey,
    issue: null
  };
}

export function createConfigOnlySurfaceRuntimeSnapshot(
  channelAccounts: ChannelAccountRecord[],
  channelRegistry: ChannelRegistry,
  options: {
    issue?: string | null;
    gatewayAccess?: SurfaceGatewayAccessState;
  } = {}
): SurfaceRuntimeSnapshot {
  const checkedAt = new Date().toISOString();
  const providers = uniqueStrings([
    ...channelAccounts.map((account) => account.type),
    ...channelRegistry.channels.map((channel) => channel.type)
  ]) as MissionControlSurfaceProvider[];
  const accountsByProvider: SurfaceRuntimeSnapshot["accountsByProvider"] = {};
  const accountsByKey: SurfaceRuntimeSnapshot["accountsByKey"] = {};
  const providerLabels: Record<string, string> = {};

  for (const provider of providers) {
    providerLabels[provider] = getSurfaceCatalogEntry(provider).label;
  }

  for (const account of channelAccounts) {
    const status = account.enabled === false ? "disabled" : "configured";
    const runtimeAccount: SurfaceAccountRuntimeStatus = {
      key: buildSurfaceAccountKey(account.type, account.id),
      provider: account.type,
      accountId: account.id,
      name: account.name,
      label: account.name,
      enabled: account.enabled !== false,
      configured: true,
      linked: false,
      running: false,
      connected: false,
      disabled: account.enabled === false,
      failed: false,
      status,
      healthState: null,
      errorMessage: null,
      source: "config-only",
      checkedAt
    };

    accountsByProvider[account.type] ??= {};
    accountsByProvider[account.type][account.id] = runtimeAccount;
    accountsByKey[runtimeAccount.key] = runtimeAccount;
  }

  return {
    source: providers.length > 0 ? "config-only" : "unavailable",
    checkedAt,
    gatewayAccess: options.gatewayAccess ?? EMPTY_GATEWAY_ACCESS,
    providerOrder: providers,
    providerLabels,
    accountsByProvider,
    accountsByKey,
    issue: options.issue ?? null
  };
}

export function buildSurfaceGatewayAccessFromMessage(message: string | null | undefined): SurfaceGatewayAccessState {
  const issue = message?.trim() || null;
  const repairAction = issue ? normalizeRepairAction(resolveGatewayAuthRepairAction(issue)) : null;
  const missingScopes = parseMissingScopes(issue);
  const requestId = parseGatewayRequestId(issue);
  const blocked = Boolean(issue && (repairAction || missingScopes.length > 0 || requestId));

  return {
    ok: !blocked,
    blocked,
    role: null,
    scopes: [],
    missingScopes,
    requestId,
    issue,
    repairAvailable: Boolean(repairAction),
    repairAction
  };
}

export function buildManagedOpenClawBindings(
  registry: ChannelRegistry,
  options: {
    workspaceId?: string | null;
  } = {}
): ManagedOpenClawBinding[] {
  const workspaceId = normalizeOptionalString(options.workspaceId);
  const bindings: ManagedOpenClawBinding[] = [];

  for (const channel of registry.channels.filter(isManagedChatChannel)) {
    const workspaces = workspaceId
      ? channel.workspaces.filter((workspace) => workspace.workspaceId === workspaceId)
      : channel.workspaces;

    if (workspaces.length === 0) {
      continue;
    }

    if (channel.primaryAgentId) {
      bindings.push({
        agentId: channel.primaryAgentId,
        match: {
          channel: channel.type,
          accountId: channel.id
        }
      });
    }

    if (channel.type === "telegram") {
      for (const workspace of workspaces) {
        for (const assignment of workspace.groupAssignments.filter(hasEnabledAssignedRoute)) {
          bindings.push({
            agentId: assignment.agentId,
            match: {
              channel: "telegram",
              accountId: channel.id
            }
          });
          bindings.push({
            agentId: assignment.agentId,
            match: {
              channel: "telegram",
              accountId: channel.id,
              peer: {
                kind: "group",
                id: assignment.chatId
              }
            }
          });
        }
      }
    }

    if (channel.type === "discord") {
      for (const workspace of workspaces) {
        for (const assignment of workspace.groupAssignments.filter(hasEnabledAssignedRoute)) {
          const binding = buildDiscordBinding(channel.id, assignment);
          if (binding) {
            bindings.push(binding);
          }
        }
      }
    }
  }

  return dedupeBindings(bindings);
}

export function buildSurfaceDriftSnapshot(input: {
  registry: ChannelRegistry;
  currentBindings: unknown[] | null;
  surfaceRuntime: SurfaceRuntimeSnapshot;
  configuredAccounts: ChannelAccountRecord[];
  workspaceId?: string | null;
}): SurfaceDriftSnapshot {
  if (!Array.isArray(input.currentBindings)) {
    return createEmptySurfaceDriftSnapshot(false, "unavailable");
  }

  const checkedAt = new Date().toISOString();
  const expectedBindings = buildManagedOpenClawBindings(input.registry, {
    workspaceId: input.workspaceId
  });
  const expected = expectedBindings
    .map((binding) => normalizeBinding(binding))
    .filter((binding): binding is NormalizedBinding => Boolean(binding));
  const current = input.currentBindings
    .map((binding) => normalizeBinding(binding))
    .filter((binding): binding is NormalizedBinding => Boolean(binding));
  const managedChannels = input.registry.channels.filter((channel) =>
    isManagedChatChannel(channel) &&
    (!input.workspaceId || channel.workspaces.some((workspace) => workspace.workspaceId === input.workspaceId))
  );
  const managedAccountKeys = new Set(managedChannels.map((channel) => buildSurfaceAccountKey(channel.type, channel.id)));
  const currentManaged = current.filter((binding) => {
    if (!binding.accountId) {
      return false;
    }

    return (
      managedAccountKeys.has(buildSurfaceAccountKey(binding.provider, binding.accountId)) ||
      isLikelyAgentOSManagedAccountId(binding.provider, binding.accountId)
    );
  });
  const currentByKey = new Map(currentManaged.map((binding) => [binding.key, binding]));
  const currentByMatchKey = groupBindingsByMatchKey(currentManaged);
  const expectedByKey = new Map(expected.map((binding) => [binding.key, binding]));
  const expectedMatchKeys = new Set(expected.map((binding) => binding.matchKey));
  const issues: SurfaceBindingDriftIssue[] = [];
  const summary: SurfaceDriftSnapshot["summary"] = {
    ok: 0,
    missingBindings: 0,
    extraBindings: 0,
    agentMismatch: 0,
    accountMissing: 0,
    providerDisabled: 0
  };

  for (const binding of expected) {
    if (currentByKey.has(binding.key)) {
      summary.ok += 1;
      continue;
    }

    const actualBindings = currentByMatchKey.get(binding.matchKey) ?? [];
    if (actualBindings.length > 0) {
      summary.agentMismatch += 1;
      issues.push(buildDriftIssue("agent-mismatch", binding, {
        severity: "error",
        actualAgentId: actualBindings.map((entry) => entry.agentId).join(", "),
        detail: `OpenClaw binding exists for this route, but it points at ${actualBindings.map((entry) => entry.agentId).join(", ")} instead of ${binding.agentId}.`,
        ...resolveWorkspaceContextForBinding(input.registry, binding, input.workspaceId)
      }));
      continue;
    }

    summary.missingBindings += 1;
    issues.push(buildDriftIssue("missing-binding", binding, {
      severity: "error",
      detail: "AgentOS expects this OpenClaw binding, but it is missing from OpenClaw config.",
      ...resolveWorkspaceContextForBinding(input.registry, binding, input.workspaceId)
    }));
  }

  for (const binding of currentManaged) {
    if (expectedByKey.has(binding.key) || expectedMatchKeys.has(binding.matchKey)) {
      continue;
    }

    summary.extraBindings += 1;
    issues.push(buildDriftIssue("extra-binding", binding, {
      severity: "warning",
      detail: "OpenClaw has a managed binding that is no longer represented by the AgentOS workspace integration registry.",
      ...resolveWorkspaceContextForBinding(input.registry, binding, input.workspaceId)
    }));
  }

  const configuredAccountKeys = new Set(
    input.configuredAccounts.map((account) => buildSurfaceAccountKey(account.type, account.id))
  );
  for (const channel of managedChannels) {
    const accountKey = buildSurfaceAccountKey(channel.type, channel.id);
    if (!configuredAccountKeys.has(accountKey) && !input.surfaceRuntime.accountsByKey[accountKey]) {
      summary.accountMissing += 1;
      issues.push(buildChannelDriftIssue("account-missing", channel, {
        severity: "error",
        detail: "AgentOS has a workspace integration binding, but OpenClaw did not return a matching configured account.",
        workspaceId: input.workspaceId ?? null
      }));
    }

    const runtimeAccount = input.surfaceRuntime.accountsByKey[accountKey];
    if (runtimeAccount?.disabled) {
      summary.providerDisabled += 1;
      issues.push(buildChannelDriftIssue("provider-disabled", channel, {
        severity: "warning",
        detail: "OpenClaw returned this account as disabled.",
        workspaceId: input.workspaceId ?? null
      }));
    }
  }

  return {
    checked: true,
    source: "openclaw-bindings",
    checkedAt,
    expectedBindingCount: expected.length,
    currentBindingCount: currentManaged.length,
    summary,
    issues
  };
}

export function buildSurfaceBindingRepairResult(input: {
  scope: "workspace" | "all";
  workspaceId: string | null;
  registry: ChannelRegistry;
  previousBindings: unknown[];
  nextBindings: unknown[];
  drift: SurfaceDriftSnapshot;
  configMutations?: SurfaceBindingRepairResult["configMutations"];
  dryRun?: boolean;
  applied?: boolean;
  auditId?: string;
  auditPath?: string;
  confirmedPreviewAuditId?: string;
  backupId?: string;
  backupPath?: string;
  restorePlan?: SurfaceBindingRepairResult["restorePlan"];
}): SurfaceBindingRepairResult {
  const previousKeys = new Set(
    input.previousBindings
      .map((binding) => normalizeBinding(binding)?.key)
      .filter((key): key is string => Boolean(key))
  );
  const nextKeys = new Set(
    input.nextBindings
      .map((binding) => normalizeBinding(binding)?.key)
      .filter((key): key is string => Boolean(key))
  );
  const removedBindingCount = [...previousKeys].filter((key) => !nextKeys.has(key)).length;
  const addedBindingCount = [...nextKeys].filter((key) => !previousKeys.has(key)).length;

  return {
    scope: input.scope,
    workspaceId: input.workspaceId,
    checkedAt: new Date().toISOString(),
    dryRun: input.dryRun === true,
    applied: input.applied ?? input.dryRun !== true,
    ...(input.auditId ? { auditId: input.auditId } : {}),
    ...(input.auditPath ? { auditPath: input.auditPath } : {}),
    ...(input.confirmedPreviewAuditId ? { confirmedPreviewAuditId: input.confirmedPreviewAuditId } : {}),
    ...(input.backupId ? { backupId: input.backupId } : {}),
    ...(input.backupPath ? { backupPath: input.backupPath } : {}),
    ...(input.restorePlan ? { restorePlan: input.restorePlan } : {}),
    expectedBindingCount: buildManagedOpenClawBindings(input.registry, {
      workspaceId: input.scope === "workspace" ? input.workspaceId : null
    }).length,
    previousBindingCount: input.previousBindings.length,
    nextBindingCount: input.nextBindings.length,
    changed: removedBindingCount > 0 || addedBindingCount > 0,
    removedBindingCount,
    addedBindingCount,
    ...(input.configMutations ? { configMutations: input.configMutations } : {}),
    drift: input.drift
  };
}

export type SurfaceReconcilePreviewAudit = {
  id: string;
  createdAt: string;
  dryRun: boolean;
  applied: boolean;
  scope: "workspace" | "all";
  workspaceId: string | null;
  plannedConfigPaths: string[];
  previousBindings?: unknown[];
  nextBindings?: unknown[];
};

export function validateSurfaceReconcilePreviewForApply(input: {
  preview: SurfaceReconcilePreviewAudit;
  previewMaxAgeMs: number;
  nowMs?: number;
  scope: "workspace" | "all";
  workspaceId: string | null;
  plannedConfigPaths: string[];
  currentBindings: unknown[];
  nextBindings: unknown[];
}) {
  const createdAtMs = Date.parse(input.preview.createdAt);
  const nowMs = input.nowMs ?? Date.now();

  if (input.preview.dryRun !== true) {
    throw new Error("Integration repair preview audit is not a dry-run preview.");
  }

  if (input.preview.applied !== false) {
    throw new Error("Integration repair preview audit was already applied.");
  }

  if (input.preview.scope !== input.scope) {
    throw new Error("Integration repair preview scope does not match this apply request.");
  }

  if ((input.preview.workspaceId ?? null) !== (input.workspaceId ?? null)) {
    throw new Error("Integration repair preview workspace does not match this apply request.");
  }

  if (!Number.isFinite(createdAtMs) || nowMs - createdAtMs > input.previewMaxAgeMs) {
    throw new Error("Integration repair preview is stale. Run a new dry-run preview before applying repair.");
  }

  if (!stringArraysEqual(input.preview.plannedConfigPaths, input.plannedConfigPaths)) {
    throw new Error("Integration repair planned config paths changed since preview. Run a new dry-run preview.");
  }

  if (Array.isArray(input.preview.previousBindings) && !configValuesEqual(input.preview.previousBindings, input.currentBindings)) {
    throw new Error("Current OpenClaw bindings changed since preview. Run a new dry-run preview before applying repair.");
  }

  if (Array.isArray(input.preview.nextBindings) && !configValuesEqual(input.preview.nextBindings, input.nextBindings)) {
    throw new Error("Integration repair target bindings changed since preview. Run a new dry-run preview.");
  }
}

export function mergeManagedOpenClawBindings(input: {
  registry: ChannelRegistry;
  currentBindings: unknown[];
  scope: "workspace" | "all";
  workspaceId?: string | null;
}) {
  const expected = buildManagedOpenClawBindings(input.registry, {
    workspaceId: input.scope === "workspace" ? input.workspaceId : null
  });
  const expectedNormalized = expected
    .map((binding) => normalizeBinding(binding))
    .filter((binding): binding is NormalizedBinding => Boolean(binding));
  const replacementMatchKeys = new Set(expectedNormalized.map((binding) => binding.matchKey));
  const managedAccountKeys = new Set(
    input.registry.channels
      .filter((channel) =>
        isManagedChatChannel(channel) &&
        (input.scope === "all" ||
          channel.workspaces.some((workspace) => workspace.workspaceId === input.workspaceId))
      )
      .map((channel) => buildSurfaceAccountKey(channel.type, channel.id))
  );

  const preserved = input.currentBindings.filter((binding) => {
    const normalized = normalizeBinding(binding);
    if (!normalized?.accountId) {
      return true;
    }

    const accountKey = buildSurfaceAccountKey(normalized.provider, normalized.accountId);
    const managedAccount = managedAccountKeys.has(accountKey);
    const orphanAgentOSManagedAccount = !managedAccount && isLikelyAgentOSManagedAccountId(
      normalized.provider,
      normalized.accountId
    );

    if (!managedAccount && !orphanAgentOSManagedAccount) {
      return true;
    }

    if (input.scope === "all") {
      return false;
    }

    if (orphanAgentOSManagedAccount) {
      return false;
    }

    if (replacementMatchKeys.has(normalized.matchKey)) {
      return false;
    }

    return isBindingOwnedByDifferentWorkspace(input.registry, normalized, input.workspaceId ?? null);
  });

  return dedupeBindings([...preserved, ...expected]);
}

export function normalizeSurfaceIntegrationStatus(
  surfaceRuntime: SurfaceRuntimeSnapshot,
  provider: MissionControlSurfaceProvider
) {
  const providerAccounts = Object.values(surfaceRuntime.accountsByProvider[provider] ?? {});
  const accountError = providerAccounts.find((account) => account.errorMessage);

  if (surfaceRuntime.gatewayAccess.blocked) {
    return {
      status: "unknown" as const,
      statusLabel: "Gateway Blocked",
      connectionHealth: {
        label: "Gateway access blocked",
        detail: surfaceRuntime.gatewayAccess.issue ?? "OpenClaw Gateway access needs approval before live status can be checked."
      },
      errorMessage: surfaceRuntime.gatewayAccess.issue
    };
  }

  if (accountError?.errorMessage) {
    return {
      status: "failed" as const,
      statusLabel: "Failed",
      connectionHealth: {
        label: "Connector error",
        detail: accountError.errorMessage
      },
      errorMessage: accountError.errorMessage
    };
  }

  if (surfaceRuntime.source === "unavailable" && providerAccounts.length === 0) {
    return {
      status: "unknown" as const,
      statusLabel: "Unknown",
      connectionHealth: {
        label: "OpenClaw status unavailable",
        detail: surfaceRuntime.issue ?? "OpenClaw channel status is unavailable."
      },
      errorMessage: surfaceRuntime.issue
    };
  }

  if (providerAccounts.length === 0) {
    return {
      status: "missing-credentials" as const,
      statusLabel: "Missing Credentials",
      connectionHealth: {
        label: "No OpenClaw account",
        detail: "OpenClaw channel status did not return an account for this provider."
      },
      errorMessage: null
    };
  }

  if (providerAccounts.every((account) => account.disabled)) {
    return {
      status: "disabled" as const,
      statusLabel: "Disabled",
      connectionHealth: {
        label: "Disabled",
        detail: "OpenClaw returned account records, but every account is disabled."
      },
      errorMessage: null
    };
  }

  const connectedAccounts = providerAccounts.filter((account) =>
    account.connected || account.running || account.linked
  );
  if (connectedAccounts.length > 0) {
    return {
      status: "connected" as const,
      statusLabel: "Connected",
      connectionHealth: {
        label: "Verified by OpenClaw",
        detail: `${connectedAccounts.length} account${connectedAccounts.length === 1 ? "" : "s"} returned connected, running, or linked from channels.status.`
      },
      errorMessage: null
    };
  }

  const configuredAccounts = providerAccounts.filter((account) => account.configured || account.enabled);
  if (configuredAccounts.length > 0) {
    return {
      status: "unknown" as const,
      statusLabel: surfaceRuntime.source === "config-only" ? "Configured" : "Unknown",
      connectionHealth: {
        label: surfaceRuntime.source === "config-only" ? "Configured, not live-verified" : "Configured, not live-verified",
        detail:
          surfaceRuntime.source === "config-only"
            ? "OpenClaw configuration exists, but live channel status was unavailable."
            : "OpenClaw returned configured account records, but no account reported connected, running, or linked."
      },
      errorMessage: null
    };
  }

  return {
    status: "pending-setup" as const,
    statusLabel: "Pending Setup",
    connectionHealth: {
      label: "Setup incomplete",
      detail: "OpenClaw returned account records without configured or connected state."
    },
    errorMessage: null
  };
}

function normalizeSurfaceAccountRuntimeStatus(
  provider: MissionControlSurfaceProvider,
  rawAccount: Record<string, unknown> & {
    accountId?: string;
    name?: string;
    enabled?: boolean;
    configured?: boolean;
    linked?: boolean;
    running?: boolean;
    connected?: boolean;
    lastError?: string;
    healthState?: string;
  },
  options: {
    source: SurfaceRuntimeSource;
    checkedAt: string;
    providerLabel: string;
  }
): SurfaceAccountRuntimeStatus | null {
  const accountId = normalizeOptionalString(rawAccount.accountId);
  if (!accountId) {
    return null;
  }

  const errorMessage = normalizeOptionalString(rawAccount.lastError);
  const enabled = rawAccount.enabled !== false;
  const configured = rawAccount.configured === true || (rawAccount.configured !== false && rawAccount.enabled === true);
  const linked = rawAccount.linked === true;
  const running = rawAccount.running === true;
  const connected = rawAccount.connected === true;
  const disabled = rawAccount.enabled === false;
  const failed = Boolean(errorMessage);
  const status = resolveSurfaceAccountStatus({
    failed,
    disabled,
    connected,
    running,
    linked,
    configured
  });
  const name = normalizeOptionalString(rawAccount.name) ?? accountId;

  return {
    key: buildSurfaceAccountKey(provider, accountId),
    provider,
    accountId,
    name,
    label: name || options.providerLabel,
    enabled,
    configured,
    linked,
    running,
    connected,
    disabled,
    failed,
    status,
    healthState: normalizeOptionalString(rawAccount.healthState),
    errorMessage: errorMessage ? redactSecretText(errorMessage) : null,
    source: options.source,
    checkedAt: options.checkedAt,
    raw: redactSurfaceAccountRaw(rawAccount)
  };
}

function isPlaceholderDefaultRuntimeAccount(
  rawAccount: Record<string, unknown> & { accountId?: string; lastError?: string },
  providerAccounts: Array<Record<string, unknown> & { accountId?: string }>
) {
  if (normalizeOptionalString(rawAccount.accountId) !== "default") {
    return false;
  }

  const hasConcreteSiblingAccount = providerAccounts.some((account) => {
    const accountId = normalizeOptionalString(account.accountId);
    return Boolean(accountId && accountId !== "default");
  });
  if (!hasConcreteSiblingAccount) {
    return false;
  }

  const configured = rawAccount.configured === true || (rawAccount.configured !== false && rawAccount.enabled === true);
  const live = rawAccount.connected === true || rawAccount.running === true || rawAccount.linked === true;
  const errorMessage = normalizeOptionalString(rawAccount.lastError)?.toLowerCase() ?? "";

  return !configured && !live && errorMessage.includes("not configured");
}

function resolveSurfaceAccountStatus(input: {
  failed: boolean;
  disabled: boolean;
  connected: boolean;
  running: boolean;
  linked: boolean;
  configured: boolean;
}): SurfaceAccountHealthStatus {
  if (input.failed) {
    return "failed";
  }
  if (input.disabled) {
    return "disabled";
  }
  if (input.connected) {
    return "connected";
  }
  if (input.running) {
    return "running";
  }
  if (input.linked) {
    return "linked";
  }
  if (input.configured) {
    return "configured";
  }
  return "unknown";
}

function normalizeProviderLabels(payload: OpenClawChannelStatusPayload) {
  const labels: Record<string, string> = {
    ...(payload.channelLabels ?? {})
  };

  for (const meta of payload.channelMeta ?? []) {
    if (meta.id && meta.label) {
      labels[meta.id] = meta.label;
    }
  }

  return labels;
}

function buildDiscordBinding(accountId: string, assignment: WorkspaceChannelGroupAssignment): ManagedOpenClawBinding | null {
  if (!assignment.agentId) {
    return null;
  }

  const parsed = parseDiscordRouteId(assignment.chatId);
  if (!parsed) {
    return null;
  }

  if (parsed.kind === "role") {
    if (!parsed.guildId) {
      return null;
    }

    return {
      agentId: assignment.agentId,
      match: {
        channel: "discord",
        accountId,
        guildId: parsed.guildId,
        roles: [parsed.targetId]
      }
    };
  }

  return {
    agentId: assignment.agentId,
    match: {
      channel: "discord",
      accountId,
      ...(parsed.guildId ? { guildId: parsed.guildId } : {}),
      peer: {
        kind: parsed.kind,
        id: parsed.targetId
      }
    }
  };
}

function normalizeBinding(binding: unknown): NormalizedBinding | null {
  if (!isObjectRecord(binding) || typeof binding.agentId !== "string") {
    return null;
  }

  const match = isObjectRecord(binding.match) ? binding.match : null;
  const provider = normalizeOptionalString(match?.channel);
  if (!match || !provider) {
    return null;
  }

  const agentId = binding.agentId.trim();
  if (!agentId) {
    return null;
  }

  const accountId = normalizeOptionalString(match.accountId);
  const peer = isObjectRecord(match.peer) ? match.peer : null;
  const peerKind = normalizeOptionalString(peer?.kind);
  const peerId = normalizeOptionalString(peer?.id);
  const routeKind = peerKind ?? (Array.isArray(match.roles) && match.roles.length > 0 ? "role" : null);
  const routeId = peerId ?? normalizeRoles(match.roles).join(",");
  const normalizedMatch = {
    channel: provider,
    accountId,
    guildId: normalizeOptionalString(match.guildId),
    peer: peerKind && peerId ? { kind: peerKind, id: peerId } : null,
    query: normalizeOptionalString(match.query),
    roles: normalizeRoles(match.roles),
    teamId: normalizeOptionalString(match.teamId)
  };
  const matchKey = stableStringify(normalizedMatch);

  return {
    key: stableStringify({ agentId, match: normalizedMatch }),
    matchKey,
    agentId,
    provider,
    accountId,
    routeKind,
    routeId: routeId || null,
    raw: binding
  };
}

function isLikelyAgentOSManagedAccountId(provider: string, accountId: string) {
  return accountId.startsWith(`${provider}-agentos-`);
}

function buildDriftIssue(
  kind: SurfaceBindingDriftIssue["kind"],
  binding: NormalizedBinding,
  options: {
    severity: SurfaceBindingDriftIssue["severity"];
    detail: string;
    actualAgentId?: string | null;
    workspaceId?: string | null;
    workspacePath?: string | null;
  }
): SurfaceBindingDriftIssue {
  return {
    id: `${kind}:${binding.key}`,
    kind,
    severity: options.severity,
    title: formatDriftTitle(kind),
    detail: options.detail,
    workspaceId: options.workspaceId ?? null,
    workspacePath: options.workspacePath ?? null,
    provider: binding.provider,
    accountId: binding.accountId,
    routeId: binding.routeId,
    routeKind: binding.routeKind,
    expectedAgentId: kind === "extra-binding" ? null : binding.agentId,
    actualAgentId: options.actualAgentId ?? (kind === "extra-binding" ? binding.agentId : null),
    bindingKey: binding.key
  };
}

function buildChannelDriftIssue(
  kind: Extract<SurfaceBindingDriftIssue["kind"], "account-missing" | "provider-disabled">,
  channel: WorkspaceChannelSummary,
  options: {
    severity: SurfaceBindingDriftIssue["severity"];
    detail: string;
    workspaceId?: string | null;
  }
): SurfaceBindingDriftIssue {
  const workspaceBinding = options.workspaceId
    ? channel.workspaces.find((workspace) => workspace.workspaceId === options.workspaceId) ?? null
    : channel.workspaces.length === 1
      ? channel.workspaces[0]
      : null;

  return {
    id: `${kind}:${channel.type}:${channel.id}`,
    kind,
    severity: options.severity,
    title: formatDriftTitle(kind),
    detail: options.detail,
    workspaceId: workspaceBinding?.workspaceId ?? options.workspaceId ?? null,
    workspacePath: workspaceBinding?.workspacePath ?? null,
    provider: channel.type,
    accountId: channel.id,
    routeId: null,
    routeKind: null,
    expectedAgentId: channel.primaryAgentId,
    actualAgentId: null,
    bindingKey: null
  };
}

function resolveWorkspaceContextForBinding(
  registry: ChannelRegistry,
  binding: NormalizedBinding,
  requestedWorkspaceId?: string | null
) {
  const channel = registry.channels.find(
    (entry) => entry.type === binding.provider && entry.id === binding.accountId
  );

  if (!channel) {
    return {
      workspaceId: requestedWorkspaceId ?? null,
      workspacePath: null
    };
  }

  const workspaceBinding = requestedWorkspaceId
    ? channel.workspaces.find((workspace) => workspace.workspaceId === requestedWorkspaceId) ?? null
    : binding.routeId
      ? channel.workspaces.find((workspace) =>
          workspace.groupAssignments.some(
            (assignment) => assignment.enabled !== false && assignment.chatId === binding.routeId
          )
        ) ?? null
      : channel.workspaces.length === 1
        ? channel.workspaces[0]
        : null;

  return {
    workspaceId: workspaceBinding?.workspaceId ?? requestedWorkspaceId ?? null,
    workspacePath: workspaceBinding?.workspacePath ?? null
  };
}

function isBindingOwnedByDifferentWorkspace(
  registry: ChannelRegistry,
  binding: NormalizedBinding,
  workspaceId: string | null
) {
  if (!workspaceId || !binding.routeId) {
    return false;
  }

  const channel = registry.channels.find(
    (entry) => entry.type === binding.provider && entry.id === binding.accountId
  );
  const owningWorkspace = channel?.workspaces.find((workspace) =>
    workspace.groupAssignments.some(
      (assignment) => assignment.enabled !== false && assignment.chatId === binding.routeId
    )
  );

  return Boolean(owningWorkspace && owningWorkspace.workspaceId !== workspaceId);
}

function formatDriftTitle(kind: SurfaceBindingDriftIssue["kind"]) {
  switch (kind) {
    case "missing-binding":
      return "Missing OpenClaw binding";
    case "extra-binding":
      return "Extra OpenClaw binding";
    case "agent-mismatch":
      return "Agent mismatch";
    case "account-missing":
      return "Missing OpenClaw account";
    case "provider-disabled":
      return "Provider disabled";
  }
}

function buildSurfaceAccountKey(provider: string, accountId: string) {
  return `${provider}:${accountId}`;
}

function parseMissingScopes(message: string | null) {
  const scopes = new Set<string>();
  if (!message) {
    return [];
  }

  for (const match of message.matchAll(/operator\.(?:admin|read|write|approvals|pairing|talk\.secrets)/g)) {
    scopes.add(match[0]);
  }

  if (/scope upgrade pending approval|pairing_pending|connected_no_operator_scope/i.test(message)) {
    for (const scope of REQUIRED_STATUS_SCOPES) {
      scopes.add(scope);
    }
  }

  return Array.from(scopes).sort();
}

function parseGatewayRequestId(message: string | null) {
  if (!message) {
    return null;
  }

  return /requestId:\s*([a-z0-9-]+)/i.exec(message)?.[1] ?? null;
}

function normalizeRepairAction(action: GatewayAuthRepairAction | null): SurfaceGatewayAccessState["repairAction"] {
  return action ? { ...action } : null;
}

function groupBindingsByMatchKey(bindings: NormalizedBinding[]) {
  const grouped = new Map<string, NormalizedBinding[]>();
  for (const binding of bindings) {
    grouped.set(binding.matchKey, [...(grouped.get(binding.matchKey) ?? []), binding]);
  }
  return grouped;
}

function hasEnabledAssignedRoute(
  assignment: WorkspaceChannelGroupAssignment
): assignment is WorkspaceChannelGroupAssignment & { agentId: string } {
  return assignment.enabled !== false && Boolean(assignment.agentId) && Boolean(assignment.chatId);
}

function isManagedChatChannel(channel: WorkspaceChannelSummary) {
  return (
    channel.type === "telegram" ||
    channel.type === "discord" ||
    channel.type === "slack" ||
    channel.type === "googlechat"
  );
}

function dedupeBindings<T>(bindings: T[]) {
  const seen = new Set<string>();
  const output: T[] = [];

  for (const binding of bindings) {
    const key = JSON.stringify(binding);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(binding);
  }

  return output;
}

function normalizeRoles(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((entry) => normalizeOptionalString(String(entry)))
        .filter((entry): entry is string => Boolean(entry))
        .sort()
    : [];
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArraysEqual(left: string[], right: string[]) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function configValuesEqual(left: unknown, right: unknown) {
  return stableStringify(left ?? null) === stableStringify(right ?? null);
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => normalizeOptionalString(value)).filter(Boolean))) as string[];
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortStable(value));
}

function sortStable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortStable);
  }

  if (!isObjectRecord(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined && entryValue !== null && !(Array.isArray(entryValue) && entryValue.length === 0))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, sortStable(entryValue)])
  );
}

function redactSurfaceAccountRaw(rawAccount: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rawAccount)) {
    if (/token|secret|password|credential/i.test(key)) {
      output[key] = "__REDACTED__";
      continue;
    }
    output[key] = typeof value === "string" ? redactSecretText(value) : value;
  }
  return output;
}
