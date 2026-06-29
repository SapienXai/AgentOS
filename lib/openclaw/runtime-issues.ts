import { redactSecretText } from "@/lib/security/redaction";

export type RuntimeIssueType =
  | "scope_upgrade_pending"
  | "model_auth_required"
  | "memory_config_missing"
  | "gateway_unreachable"
  | "rate_limit"
  | "plugin_compatibility"
  | "openclaw_update_failed"
  | "openclaw_postflight_failed"
  | "openclaw_rollback_needed"
  | "openclaw_certification_blocked"
  | "unknown_runtime_action";

export type RuntimeIssueSource =
  | "openclaw_gateway"
  | "openclaw_cli"
  | "model_auth"
  | "memory"
  | "plugin"
  | "system";

export type RuntimeIssueSeverity = "info" | "warning" | "action_required" | "blocked";
export type RuntimeIssueStatus = "open" | "resolving" | "resolved" | "dismissed" | "failed";

export type RuntimeIssue = {
  id: string;
  type: RuntimeIssueType;
  source: RuntimeIssueSource;
  severity: RuntimeIssueSeverity;
  title: string;
  message: string;
  requestId?: string;
  requestedScopes?: string[];
  approvedScopes?: string[];
  command?: string;
  recoveryCommand?: string;
  fallbackCommand?: string;
  inspectCommand?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  status: RuntimeIssueStatus;
  rawOutput?: string;
  errorMessage?: string;
};

export type RuntimeIssueState = Partial<RuntimeIssue> & {
  id: string;
  status: RuntimeIssueStatus;
  createdAt?: string;
  updatedAt?: string;
  resolvedAt?: string;
  dismissedAt?: string;
};

export type RuntimeIssueInput = {
  gatewayStatus?: {
    service?: { loaded?: boolean };
    rpc?: { ok?: boolean; error?: string };
  };
  status?: {
    gateway?: {
      reachable?: boolean;
      error?: string | null;
      authWarning?: string | null;
    };
  };
  deviceAccess?: {
    pending?: unknown[];
  };
  diagnostics?: {
    installed?: boolean;
    loaded?: boolean;
    rpcOk?: boolean;
    health?: "healthy" | "degraded" | "offline";
    transport?: {
      gatewayMode?: string;
      lastNativeError?: string | null;
    };
    gatewayFallbackDiagnostics?: Array<{
      issue: string;
      recovery?: string;
    }>;
    gatewayFallbackReasons?: string[];
    issues?: string[];
  };
  issues?: string[];
  runtimeIssues?: string[];
  modelReadinessIssues?: string[];
  states?: Record<string, RuntimeIssueState>;
  now?: Date;
};

const defaultIssueTypes: RuntimeIssueType[] = [
  "scope_upgrade_pending",
  "memory_config_missing",
  "gateway_unreachable",
  "rate_limit",
  "model_auth_required",
  "plugin_compatibility",
  "openclaw_update_failed",
  "openclaw_postflight_failed",
  "openclaw_rollback_needed",
  "openclaw_certification_blocked",
  "unknown_runtime_action"
];

export function createDefaultRuntimeIssueState(): Record<string, RuntimeIssueState> {
  return {};
}

export function getSupportedRuntimeIssueTypes() {
  return defaultIssueTypes;
}

export function buildRuntimeIssues(input: RuntimeIssueInput): RuntimeIssue[] {
  const now = (input.now ?? new Date()).toISOString();
  const candidates = collectRuntimeIssueCandidates(input, now);
  const activeById = new Map<string, RuntimeIssue>();
  const gatewayUnhealthy = isGatewayUnhealthy(input);

  for (const candidate of candidates) {
    const existing = activeById.get(candidate.id);
    activeById.set(candidate.id, existing ? mergeRuntimeIssue(existing, candidate, now) : candidate);
  }

  const states = input.states ?? {};
  let merged = [...activeById.values()].map((issue) =>
    applyRuntimeIssueState(issue, states[issue.id], now, {
      reopenDismissed: shouldReopenActiveRuntimeIssue(issue, gatewayUnhealthy)
    })
  );

  for (const state of Object.values(states)) {
    if (!state?.id || activeById.has(state.id)) {
      continue;
    }

    const restored = restoreRuntimeIssueFromState(state, now, {
      reopenDismissed: false
    });
    if (restored) {
      merged.push(restored);
    }
  }

  if (merged.some((issue) => issue.type === "openclaw_rollback_needed" && issue.status !== "resolved")) {
    merged = merged.filter((issue) => issue.type !== "gateway_unreachable");
  }

  return merged.sort(compareRuntimeIssues);
}

export function runtimeIssueDedupeId(input: {
  type: RuntimeIssueType;
  source: RuntimeIssueSource;
  requestId?: string | null;
}) {
  return [
    input.type,
    input.source,
    input.requestId?.trim() || "global"
  ].join(":");
}

export function parseScopeUpgradeRequestId(text: string | null | undefined) {
  const normalized = text?.trim() ?? "";
  if (!normalized) {
    return null;
  }

  return (
    normalized.match(/\brequestId\s*[:=]\s*([A-Za-z0-9_-]{6,})\b/i)?.[1] ??
    normalized.match(/\brequest\s+([0-9a-f]{8}-[0-9a-f-]{27,})\b/i)?.[1] ??
    null
  );
}

export function isOpenRuntimeIssue(issue: RuntimeIssue) {
  return issue.status === "open" || issue.status === "resolving" || issue.status === "failed";
}

export function isRuntimeIssueActionRequired(issue: RuntimeIssue) {
  return isOpenRuntimeIssue(issue) && (issue.severity === "action_required" || issue.severity === "blocked");
}

function collectRuntimeIssueCandidates(input: RuntimeIssueInput, now: string): RuntimeIssue[] {
  const textSources = collectRuntimeIssueTextSources(input);
  const scopeUpgradeText = textSources.find((entry) => /scope upgrade pending approval/i.test(entry.text));
  const issues: RuntimeIssue[] = [];

  if (scopeUpgradeText) {
    const requestId = parseScopeUpgradeRequestId(scopeUpgradeText.text) ?? undefined;
    issues.push({
      id: runtimeIssueDedupeId({
        type: "scope_upgrade_pending",
        source: "openclaw_gateway",
        requestId
      }),
      type: "scope_upgrade_pending",
      source: "openclaw_gateway",
      severity: "action_required",
      title: "OpenClaw permission approval required",
      message: "This device is asking for additional OpenClaw scopes before AgentOS can read Gateway status.",
      ...(requestId ? { requestId } : {}),
      inspectCommand: "openclaw devices list",
      recoveryCommand: requestId ? `openclaw devices approve ${requestId}` : undefined,
      fallbackCommand: "openclaw devices approve --latest",
      rawOutput: redactSecretText(scopeUpgradeText.text),
      createdAt: now,
      updatedAt: now,
      status: "open"
    });
  }

  issues.push(...collectPendingDeviceAccessIssues(input.deviceAccess, now));

  for (const entry of textSources) {
    const text = entry.text;

    if (/Memory search provider is set to "openai" but no API key was found/i.test(text)) {
      issues.push(createRuntimeIssue({
        type: "memory_config_missing",
        source: "memory",
        severity: "action_required",
        title: "Memory configuration needs an API key",
        message: "OpenClaw reported that the memory search provider is configured without the required API key.",
        command: "Open Settings / Memory config",
        rawOutput: text,
        now
      }));
    }

    if (/\brate limit\b|429|retry after/i.test(text)) {
      issues.push(createRuntimeIssue({
        type: "rate_limit",
        source: entry.source === "openclaw_cli" ? "openclaw_cli" : "openclaw_gateway",
        severity: "warning",
        title: "Runtime rate limit reached",
        message: "OpenClaw reported a rate limit. Retry after the provider or Gateway cooldown has passed.",
        rawOutput: text,
        now
      }));
    }

    if (/auth(?:entication)? required|login required|token expired|provider token/i.test(text)) {
      issues.push(createRuntimeIssue({
        type: "model_auth_required",
        source: "model_auth",
        severity: "action_required",
        title: "Model authentication required",
        message: "A model provider needs to be reconnected before runtime requests can complete.",
        command: "Open Settings / Models",
        rawOutput: text,
        now
      }));
    }

    if (/\bplugin\b[\s\S]*\b(incompatible|compatibility|unsupported)\b/i.test(text)) {
      issues.push(createRuntimeIssue({
        type: "plugin_compatibility",
        source: "plugin",
        severity: "warning",
        title: "Plugin compatibility warning",
        message: "OpenClaw reported a plugin compatibility issue. Inspect diagnostics before relying on that plugin.",
        command: "Open Diagnostics",
        rawOutput: text,
        now
      }));
    }
  }

  const diagnostics = input.diagnostics;
  if (
    diagnostics &&
    diagnostics.installed &&
    !diagnostics.rpcOk &&
    (
      diagnostics.transport?.gatewayMode === "unreachable" ||
      (!diagnostics.loaded && diagnostics.health === "offline")
    )
  ) {
    issues.push(createRuntimeIssue({
      type: "gateway_unreachable",
      source: "openclaw_gateway",
      severity: "blocked",
      title: "OpenClaw Gateway is unreachable",
      message: "AgentOS cannot reach the OpenClaw Gateway. Restart the Gateway or inspect diagnostics before running runtime actions.",
      recoveryCommand: "openclaw gateway restart",
      inspectCommand: "openclaw gateway status --deep",
      rawOutput: diagnostics.transport?.lastNativeError ?? diagnostics.issues?.[0] ?? "",
      now
    }));
  }

  return issues;
}

function collectPendingDeviceAccessIssues(deviceAccess: RuntimeIssueInput["deviceAccess"], now: string): RuntimeIssue[] {
  const pending = Array.isArray(deviceAccess?.pending) ? deviceAccess.pending : [];

  return pending.flatMap((entry) => {
    const record = readRecord(entry);
    if (!record) {
      return [];
    }

    const requestId = normalizeString(record.requestId) ?? normalizeString(record.id) ?? undefined;
    const requestedScopes =
      readStringArray(record.requestedScopes) ??
      readStringArray(record.scopes) ??
      readStringArray(record.requested) ??
      [];
    const approvedScopes =
      readStringArray(record.approvedScopes) ??
      readStringArray(record.approved) ??
      [];

    return [{
      id: runtimeIssueDedupeId({
        type: "scope_upgrade_pending",
        source: "openclaw_gateway",
        requestId
      }),
      type: "scope_upgrade_pending",
      source: "openclaw_gateway",
      severity: "action_required",
      title: "OpenClaw permission approval required",
      message: "OpenClaw has a pending device scope request that needs operator approval before that device can use the requested Gateway access.",
      ...(requestId ? { requestId } : {}),
      requestedScopes,
      approvedScopes,
      inspectCommand: "openclaw devices list",
      recoveryCommand: requestId ? `openclaw devices approve ${requestId}` : undefined,
      fallbackCommand: "openclaw devices approve --latest",
      rawOutput: redactSecretText(JSON.stringify(entry)),
      createdAt: now,
      updatedAt: now,
      status: "open"
    } satisfies RuntimeIssue];
  });
}

function collectRuntimeIssueTextSources(input: RuntimeIssueInput) {
  const sources: Array<{ source: RuntimeIssueSource; text: string }> = [];
  const add = (source: RuntimeIssueSource, value: string | null | undefined) => {
    const text = value?.trim();
    if (text) {
      sources.push({ source, text: redactSecretText(text) });
    }
  };

  add("openclaw_gateway", input.gatewayStatus?.rpc?.error);
  add("openclaw_gateway", input.status?.gateway?.error);
  add("openclaw_gateway", input.status?.gateway?.authWarning);
  add("openclaw_gateway", input.diagnostics?.transport?.lastNativeError);

  for (const entry of input.diagnostics?.gatewayFallbackDiagnostics ?? []) {
    add("openclaw_gateway", entry.issue);
    add("openclaw_gateway", entry.recovery);
  }

  for (const entry of input.diagnostics?.gatewayFallbackReasons ?? []) {
    add("openclaw_gateway", entry);
  }

  for (const entry of input.issues ?? []) {
    add("system", entry);
  }

  for (const entry of input.runtimeIssues ?? []) {
    add("system", entry);
  }

  for (const entry of input.modelReadinessIssues ?? []) {
    add("model_auth", entry);
  }

  return sources;
}

function createRuntimeIssue(input: {
  type: RuntimeIssueType;
  source: RuntimeIssueSource;
  severity: RuntimeIssueSeverity;
  title: string;
  message: string;
  command?: string;
  recoveryCommand?: string;
  inspectCommand?: string;
  rawOutput?: string;
  now: string;
}): RuntimeIssue {
  return {
    id: runtimeIssueDedupeId({ type: input.type, source: input.source }),
    type: input.type,
    source: input.source,
    severity: input.severity,
    title: input.title,
    message: input.message,
    command: input.command,
    recoveryCommand: input.recoveryCommand,
    inspectCommand: input.inspectCommand,
    rawOutput: input.rawOutput ? redactSecretText(input.rawOutput) : undefined,
    createdAt: input.now,
    updatedAt: input.now,
    status: "open"
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalizeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return null;
  }

  const output = value
    .map((entry) => normalizeString(entry))
    .filter((entry): entry is string => Boolean(entry));

  return output;
}

function mergeRuntimeIssue(left: RuntimeIssue, right: RuntimeIssue, now: string): RuntimeIssue {
  return {
    ...left,
    ...right,
    createdAt: left.createdAt,
    updatedAt: now,
    rawOutput: right.rawOutput ?? left.rawOutput
  };
}

function applyRuntimeIssueState(
  issue: RuntimeIssue,
  state: RuntimeIssueState | undefined,
  now: string,
  options: { reopenDismissed?: boolean } = {}
): RuntimeIssue {
  if (!state) {
    return issue;
  }

  const activeStatus =
    state.status === "dismissed" && options.reopenDismissed
      ? "open"
      : state.status === "dismissed" || state.status === "failed"
      ? state.status
      : "open";

  return {
    ...issue,
    ...pickRuntimeIssueStateDetails(state),
    createdAt: state.createdAt ?? issue.createdAt,
    updatedAt: now,
    status: activeStatus,
    resolvedAt: activeStatus === "open" ? undefined : state.resolvedAt
  };
}

function restoreRuntimeIssueFromState(
  state: RuntimeIssueState,
  now: string,
  options: { reopenDismissed?: boolean } = {}
): RuntimeIssue | null {
  if (state.status === "open" || state.status === "resolving") {
    return null;
  }

  const type = state.type ?? "unknown_runtime_action";
  const source = state.source ?? "system";

  return {
    id: state.id,
    type,
    source,
    severity: state.severity ?? "info",
    title: state.title ?? "Runtime issue",
    message: state.message ?? "This runtime issue is no longer active.",
    requestId: state.requestId,
    requestedScopes: state.requestedScopes,
    approvedScopes: state.approvedScopes,
    command: state.command,
    recoveryCommand: normalizeRollbackRecoveryCommandFromState(state) ?? state.recoveryCommand,
    fallbackCommand: state.fallbackCommand,
    inspectCommand: state.inspectCommand,
    createdAt: state.createdAt ?? state.updatedAt ?? now,
    updatedAt: state.updatedAt ?? now,
    resolvedAt: state.resolvedAt,
    status: state.status === "dismissed" && options.reopenDismissed ? "open" : state.status,
    rawOutput: state.rawOutput,
    errorMessage: state.errorMessage
  };
}

function normalizeRollbackRecoveryCommandFromState(state: RuntimeIssueState) {
  if (state.type !== "openclaw_rollback_needed" || !state.recoveryCommand) {
    return null;
  }

  const rollbackVersion = readRollbackSnapshotVersionFromOutput(state.rawOutput);
  if (!rollbackVersion) {
    return null;
  }

  const openClawCommand = readOpenClawCommandPrefix(state.recoveryCommand);
  if (!openClawCommand) {
    return null;
  }

  return `${openClawCommand} update --tag ${rollbackVersion} --yes && ${openClawCommand} gateway restart && ${openClawCommand} gateway status --deep`;
}

function readRollbackSnapshotVersionFromOutput(output: string | null | undefined) {
  const text = output?.trim();
  if (!text) {
    return null;
  }

  return (
    text.match(/\bSaved OpenClaw rollback snapshot for v?(\d+(?:\.\d+)+)\b/i)?.[1] ??
    text.match(/\bRestoring previous OpenClaw version v?(\d+(?:\.\d+)+)\b/i)?.[1] ??
    null
  );
}

function readOpenClawCommandPrefix(command: string) {
  const text = command.trim();
  if (!text) {
    return null;
  }

  return (
    text.match(/^(.+?)\s+update\s+--tag\s+\S+/i)?.[1]?.trim() ??
    text.match(/^(.+?)\s+gateway\s+restart\b/i)?.[1]?.trim() ??
    null
  );
}

function isGatewayUnhealthy(input: RuntimeIssueInput) {
  return Boolean(
    input.diagnostics?.installed &&
      !input.diagnostics.rpcOk &&
      (
        input.diagnostics.transport?.gatewayMode === "unreachable" ||
        !input.diagnostics.loaded ||
        input.diagnostics.health === "offline" ||
        input.diagnostics.health === "degraded"
      )
  );
}

function shouldReopenActiveRuntimeIssue(issue: RuntimeIssue, gatewayUnhealthy: boolean) {
  return gatewayUnhealthy && issue.type === "gateway_unreachable" && issue.severity === "blocked";
}

function pickRuntimeIssueStateDetails(state: RuntimeIssueState): Partial<RuntimeIssue> {
  return {
    requestedScopes: state.requestedScopes,
    approvedScopes: state.approvedScopes,
    rawOutput: state.rawOutput,
    errorMessage: state.errorMessage
  };
}

function compareRuntimeIssues(left: RuntimeIssue, right: RuntimeIssue) {
  const statusRank = runtimeIssueStatusRank(left) - runtimeIssueStatusRank(right);
  if (statusRank !== 0) {
    return statusRank;
  }

  const severityRank = runtimeIssueSeverityRank(right.severity) - runtimeIssueSeverityRank(left.severity);
  if (severityRank !== 0) {
    return severityRank;
  }

  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}

function runtimeIssueStatusRank(issue: RuntimeIssue) {
  switch (issue.status) {
    case "open":
    case "resolving":
    case "failed":
      return 0;
    case "dismissed":
      return 1;
    case "resolved":
      return 2;
  }
}

function runtimeIssueSeverityRank(severity: RuntimeIssueSeverity) {
  switch (severity) {
    case "blocked":
      return 4;
    case "action_required":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
  }
}
