import {
  getSurfaceCatalogEntry,
  sortSurfaceAccounts,
  type SurfaceCatalogEntry
} from "@/lib/openclaw/surface-catalog";
import type { GatewayAuthRepairAction } from "@/lib/openclaw/gateway-auth-actions";
import { isGatewayConfigRateLimitMessage } from "@/lib/openclaw/gateway-config-errors";
import type {
  ChannelAccountRecord,
  DiscoveredSurfaceRoute,
  MissionControlSnapshot,
  MissionControlSurfaceKind,
  MissionControlSurfaceProvider,
  SurfaceAccountRuntimeStatus,
  SurfaceBindingDriftIssue,
  WorkspaceChannelGroupAssignment
} from "@/lib/agentos/contracts";
import type { AccountAccessRuleView } from "@/lib/agentos/account-access-policy-types";
import type { AccountLoginTargetView } from "@/lib/agentos/account-login-target-types";

export function mergeAccountTargets(
  currentTargets: AccountLoginTargetView[],
  nextWorkspaceTargets: AccountLoginTargetView[],
  workspaceId: string | null
) {
  if (!workspaceId) {
    return nextWorkspaceTargets;
  }

  return [
    ...currentTargets.filter((target) => target.workspaceId !== workspaceId),
    ...nextWorkspaceTargets
  ];
}

export function mergeAccountAccessRules(
  currentRules: AccountAccessRuleView[],
  nextWorkspaceRules: AccountAccessRuleView[],
  workspaceId: string | null
) {
  if (!workspaceId) {
    return nextWorkspaceRules;
  }

  return [
    ...currentRules.filter((rule) => rule.workspaceId !== workspaceId),
    ...nextWorkspaceRules
  ];
}

export function formatLinkedAccountAgents(rules: AccountAccessRuleView[]) {
  const labels = rules.map((rule) => rule.agentName).sort((left, right) => left.localeCompare(right));

  if (labels.length <= 3) {
    return labels.join(", ");
  }

  return `${labels.slice(0, 3).join(", ")} +${labels.length - 3} more`;
}

export function agentHasBrowserAccess(agent: MissionControlSnapshot["agents"][number]) {
  const tools = [...(agent.tools ?? []), ...(agent.observedTools ?? [])].map((tool) => tool.toLowerCase());
  return agent.policy.preset === "browser" || tools.some((tool) => tool === "browser" || tool.includes("chrome"));
}

export function readSurfaceErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown surface error.";
}

export function isGatewayRecoveryCandidate(message: string) {
  if (isGatewayConfigRateLimitMessage(message)) {
    return false;
  }

  return /gateway|websocket|connection closed|service restart|ECONNREFUSED|ECONNRESET|socket hang up|unreachable|not reachable|timed out|timeout|scope upgrade|scope mismatch|missing operator/i.test(
    message
  );
}

export function buildFallbackGatewayRepairAction(): GatewayAuthRepairAction {
  return {
    apiAction: "repairDeviceAccess",
    cta: "Repair access",
    label: "Gateway access",
    detail: "Approve any pending local AgentOS Gateway scope request, then retry."
  };
}

export function mergeRuntimeSurfaceAccounts(
  configuredAccounts: ChannelAccountRecord[],
  runtimeAccounts: SurfaceAccountRuntimeStatus[]
) {
  const accountsById = new Map(configuredAccounts.map((account) => [account.id, account]));

  for (const runtimeAccount of runtimeAccounts) {
    if (accountsById.has(runtimeAccount.accountId)) {
      continue;
    }

    accountsById.set(runtimeAccount.accountId, {
      id: runtimeAccount.accountId,
      type: runtimeAccount.provider,
      name: runtimeAccount.name || runtimeAccount.label || runtimeAccount.accountId,
      enabled: runtimeAccount.enabled,
      kind: getSurfaceCatalogEntry(runtimeAccount.provider).kind,
      metadata: {
        runtimeOnly: true
      }
    });
  }

  return sortSurfaceAccounts(Array.from(accountsById.values()));
}

export function getSurfaceAccountRuntime(
  snapshot: MissionControlSnapshot,
  provider: MissionControlSurfaceProvider,
  accountId: string
) {
  return (
    snapshot.surfaceRuntime.accountsByKey[`${provider}:${accountId}`] ??
    snapshot.surfaceRuntime.accountsByKey[`${provider}:${toLegacySurfaceId(accountId)}`] ??
    null
  );
}

export function formatSurfaceRuntimeSource(source: MissionControlSnapshot["surfaceRuntime"]["source"]) {
  switch (source) {
    case "gateway-probe":
      return "Gateway probe";
    case "gateway-status":
      return "Gateway status";
    case "config-only":
      return "Config only";
    case "unavailable":
      return "Unavailable";
  }
}

export function formatSurfaceAccountStatus(
  runtimeStatus: SurfaceAccountRuntimeStatus | null,
  gatewayBlocked: boolean
) {
  if (gatewayBlocked && !runtimeStatus) {
    return "Gateway blocked";
  }

  if (!runtimeStatus) {
    return "Unknown";
  }

  switch (runtimeStatus.status) {
    case "connected":
      return "Connected";
    case "running":
      return "Running";
    case "linked":
      return "Linked";
    case "configured":
      return "Configured";
    case "disabled":
      return "Disabled";
    case "failed":
      return "Failed";
    case "gateway-blocked":
      return "Gateway blocked";
    case "unknown":
      return "Unknown";
  }
}

export function getSurfaceRuntimeBadgeClass(
  runtimeStatus: SurfaceAccountRuntimeStatus | null,
  gatewayBlocked: boolean
) {
  if (gatewayBlocked && !runtimeStatus) {
    return "border-amber-300/45 bg-amber-100 text-amber-800 dark:border-amber-300/25 dark:bg-amber-400/10 dark:text-amber-100";
  }

  switch (runtimeStatus?.status) {
    case "connected":
    case "running":
    case "linked":
      return "border-emerald-300/45 bg-emerald-50 text-emerald-700 dark:border-emerald-300/25 dark:bg-emerald-400/10 dark:text-emerald-100";
    case "configured":
      return "border-cyan-300/45 bg-cyan-50 text-cyan-700 dark:border-cyan-300/25 dark:bg-cyan-400/10 dark:text-cyan-100";
    case "disabled":
      return "border-border bg-muted text-muted-foreground dark:border-slate-300/15 dark:bg-slate-400/10 dark:text-slate-300";
    case "failed":
      return "border-rose-300/45 bg-rose-50 text-rose-700 dark:border-rose-300/25 dark:bg-rose-400/10 dark:text-rose-100";
    default:
      return "border-border bg-muted text-muted-foreground dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300";
  }
}

export function filterWorkspaceDriftIssues(issues: SurfaceBindingDriftIssue[], workspaceId: string | null) {
  if (!workspaceId) {
    return issues;
  }

  return issues.filter((issue) => !issue.workspaceId || issue.workspaceId === workspaceId);
}

export function summarizeSurfaceDriftIssues(issues: SurfaceBindingDriftIssue[]) {
  return issues.reduce(
    (summary, issue) => {
      if (issue.kind === "missing-binding") {
        summary.missingBindings += 1;
      } else if (issue.kind === "extra-binding") {
        summary.extraBindings += 1;
      } else if (issue.kind === "agent-mismatch") {
        summary.agentMismatch += 1;
      } else if (issue.kind === "account-missing") {
        summary.accountMissing += 1;
      } else if (issue.kind === "provider-disabled") {
        summary.providerDisabled += 1;
      }
      return summary;
    },
    {
      missingBindings: 0,
      extraBindings: 0,
      agentMismatch: 0,
      accountMissing: 0,
      providerDisabled: 0
    }
  );
}

export function formatSurfaceDriftSummary(summary: ReturnType<typeof summarizeSurfaceDriftIssues>) {
  return [
    summary.missingBindings > 0 ? `${summary.missingBindings} missing` : null,
    summary.extraBindings > 0 ? `${summary.extraBindings} extra` : null,
    summary.agentMismatch > 0 ? `${summary.agentMismatch} mismatch` : null,
    summary.accountMissing > 0 ? `${summary.accountMissing} account missing` : null,
    summary.providerDisabled > 0 ? `${summary.providerDisabled} disabled` : null
  ].filter((entry): entry is string => Boolean(entry));
}

export function formatSurfaceDriftKind(kind: SurfaceBindingDriftIssue["kind"]) {
  switch (kind) {
    case "missing-binding":
      return "Missing";
    case "extra-binding":
      return "Extra";
    case "agent-mismatch":
      return "Mismatch";
    case "account-missing":
      return "Account";
    case "provider-disabled":
      return "Disabled";
  }
}

export function formatSurfaceProviderLabelFromCatalog(
  provider: MissionControlSurfaceProvider,
  catalog: Map<MissionControlSurfaceProvider, SurfaceCatalogEntry>
) {
  return catalog.get(provider)?.label ?? getSurfaceCatalogEntry(provider).label;
}

export function formatSurfaceDriftIssueDetail(
  issue: SurfaceBindingDriftIssue,
  resolveAgentDisplayName: (agentId: string | null | undefined, fallback?: string) => string
) {
  const route = issue.routeId ? ` route ${issue.routeId}` : "";
  const account = issue.accountId ? `${issue.provider}:${issue.accountId}` : issue.provider;
  const expected = issue.expectedAgentId ? resolveAgentDisplayName(issue.expectedAgentId, issue.expectedAgentId) : null;
  const actual = issue.actualAgentId ? resolveAgentDisplayName(issue.actualAgentId, issue.actualAgentId) : null;

  if (expected && actual) {
    return `${account}${route}: expected ${expected}, OpenClaw has ${actual}.`;
  }

  if (expected) {
    return `${account}${route}: expected ${expected}. ${issue.detail}`;
  }

  if (actual) {
    return `${account}${route}: OpenClaw has ${actual}. ${issue.detail}`;
  }

  return `${account}${route}: ${issue.detail}`;
}

export function buildSurfaceRouteOptions(
  discoveredRoutes: DiscoveredSurfaceRoute[],
  currentAssignments: WorkspaceChannelGroupAssignment[],
  provider: MissionControlSurfaceProvider
) {
  const options = new Map<string, DiscoveredSurfaceRoute>();

  for (const route of discoveredRoutes) {
    options.set(route.routeId, route);
  }

  for (const assignment of currentAssignments) {
    options.set(assignment.chatId, {
      routeId: assignment.chatId,
      provider,
      kind: inferRouteKind(provider, assignment.chatId),
      title: assignment.title ?? options.get(assignment.chatId)?.title ?? null,
      subtitle: options.get(assignment.chatId)?.subtitle ?? null,
      lastSeen: options.get(assignment.chatId)?.lastSeen ?? null
    });
  }

  return Array.from(options.values()).sort((left, right) => {
    const leftLabel = left.title ?? left.routeId;
    const rightLabel = right.title ?? right.routeId;
    return leftLabel.localeCompare(rightLabel);
  });
}

export function getEmptyRouteDiscoveryCopy(provider: MissionControlSurfaceProvider) {
  if (provider === "telegram") {
    return "No Telegram groups found yet. Send one message in the target group, then refresh surface discovery.";
  }

  if (provider === "discord") {
    return "No Discord surfaces were discovered yet. Send one message in the target server, then refresh surface discovery.";
  }

  return "No surfaces were discovered yet for this provider.";
}

export function formatSurfaceKindLabel(kind: MissionControlSurfaceKind) {
  return kind.slice(0, 1).toUpperCase() + kind.slice(1);
}

export function inferRouteKind(provider: MissionControlSurfaceProvider, routeId: string): DiscoveredSurfaceRoute["kind"] {
  if (provider === "telegram") {
    return "group";
  }

  if (provider === "discord") {
    if (routeId.startsWith("thread:")) {
      return "thread";
    }

    if (routeId.startsWith("role:")) {
      return "role";
    }

    return "channel";
  }

  return "channel";
}

export function toLegacySurfaceId(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function formatSurfaceTimestamp(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return value;
  }

  return new Date(parsed).toISOString().replace("T", " ").slice(0, 16);
}
