import "server-only";

import { getOpenClawAdapter, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  classifyNativeMutationError,
  normalizeClientError
} from "@/lib/openclaw/client/native-ws-gateway-errors";
import type {
  OpenClawCommandOptions,
  OpenClawGatewayRestartRequestInput,
  OpenClawGatewaySuspendPrepareInput,
  OpenClawGatewaySuspendResumeInput,
  OpenClawGatewaySuspendStatusInput,
  OpenClawUpdateRunInput
} from "@/lib/openclaw/client/types";
import { redactSecretText } from "@/lib/security/redaction";

export type NativeReadStatus = "available" | "unavailable" | "unknown";
export type NativeHealthStatus = "healthy" | "degraded" | "unavailable" | "unknown";
export type NativeConfigApplicationStatus = "applied" | "restart-required" | "unknown";
export type NativeUpdateStatus = "available" | "current" | "unavailable" | "unknown";
export type NativeRecoveryStatus = "healthy" | "needs-attention" | "restart-required" | "unavailable" | "unknown";

export type NativeDoctorSnapshot = {
  generatedAt: string;
  source: "openclaw-native";
  runtime: {
    status: NativeHealthStatus;
    reachable: boolean | null;
    explanation: string;
  };
  status: {
    readStatus: NativeReadStatus;
    runtimeVersion: string | null;
    version: string | null;
    updateChannel: string | null;
    gatewayReachable: boolean | null;
    gatewayMode: string | null;
  };
  diagnostics: {
    status: NativeReadStatus;
    stability: Record<string, unknown> | null;
  };
  config: {
    readStatus: NativeReadStatus;
    valid: boolean | null;
    configuredRevisionHash: string | null;
    appliedRevisionHash: string | null;
    hotReloadStatus: string | null;
    application: NativeConfigApplicationStatus;
    explanation: string;
  };
  update: {
    readStatus: NativeReadStatus;
    status: NativeUpdateStatus;
    updateAvailable: boolean | null;
    currentVersion: string | null;
    latestVersion: string | null;
    effectiveChannel: string | null;
    schedule: Record<string, unknown> | null;
    explanation: string;
  };
  recovery: {
    status: NativeRecoveryStatus;
    issues: string[];
    actions: Array<"refresh" | "probe" | "restart" | "update">;
    explanation: string;
  };
  identity: {
    connectionId: string | null;
    authenticated: boolean | null;
    role: string | null;
    grantedScopesKnown: boolean | null;
  };
  reads: Record<string, NativeReadStatus>;
};

export type NativeDoctorConfirmation = {
  connectionId: string | null;
  effectiveChannel: string | null;
};

export type NativeDoctorMutationOutcome = {
  outcome: "succeeded" | "accepted" | "deferred" | "failed" | "unknown";
  method: string;
  result: Record<string, unknown> | null;
  reconciliation: "not-required" | "confirmed" | "inconclusive";
  message: string;
};

const NATIVE_READ_TIMEOUT_MS = 12_000;

export async function getNativeDoctorSnapshot(
  options: { adapter?: OpenClawAdapter; commandOptions?: OpenClawCommandOptions; probe?: boolean } = {}
): Promise<NativeDoctorSnapshot> {
  const adapter = options.adapter ?? getOpenClawAdapter();
  const commandOptions = {
    timeoutMs: NATIVE_READ_TIMEOUT_MS,
    ...options.commandOptions
  };

  const [health, status, diagnostics, config, update, identity] = await Promise.all([
    readNative(() => adapter.getNativeHealth?.({
      ...commandOptions,
      ...(options.probe === undefined ? {} : { probe: options.probe })
    })),
    readNative(() => adapter.getNativeStatus?.(commandOptions)),
    readNative(() => adapter.getDiagnosticsStability?.(commandOptions)),
    readNative(() => adapter.getConfigSnapshot?.(commandOptions)),
    readNative(() => adapter.getNativeUpdateStatus?.(commandOptions)),
    readNative(async () => {
      const connection = adapter.getConnectionIdentity?.();
      const nativeIdentity = await connection?.client.getOperatorIdentity?.(commandOptions);
      const diagnostics = connection?.client.getDiagnostics?.();
      return nativeIdentity ?? diagnostics?.operatorIdentity ?? null;
    })
  ]);

  const healthPayload = health.value;
  const healthStatus: NativeHealthStatus = health.status === "unavailable"
    ? "unavailable"
    : health.status !== "available"
      ? "unknown"
      : healthPayload?.ok === true
        ? "healthy"
        : healthPayload?.ok === false
          ? "degraded"
          : "unknown";
  const configPayload = config.value;
  const configuredRevisionHash = readNonEmptyString(configPayload?.configRevisionHash);
  const appliedRevisionHash = readNonEmptyString(configPayload?.appliedConfigHash);
  const configApplication: NativeConfigApplicationStatus = configuredRevisionHash && appliedRevisionHash
    ? configuredRevisionHash === appliedRevisionHash
      ? "applied"
      : "restart-required"
    : "unknown";
  const healthConfigReload = isRecord(healthPayload?.configReload) ? healthPayload.configReload : null;
  const statusPayload = status.value;
  const updatePayload = update.value;
  const updateAvailableRecord = isRecord(updatePayload?.updateAvailable) ? updatePayload.updateAvailable : null;
  const updateAvailable = updatePayload
    ? updateAvailableRecord !== null
    : null;
  const recoveryStatus: NativeRecoveryStatus = configApplication === "restart-required"
    ? "restart-required"
    : healthStatus === "unavailable"
      ? "unavailable"
      : healthStatus === "unknown" || status.status === "unknown"
        ? "unknown"
        : healthStatus === "degraded"
          ? "needs-attention"
          : "healthy";
  const recoveryIssues = [
    ...(configApplication === "restart-required" ? ["Saved configuration is newer than the active Gateway."] : []),
    ...(healthStatus === "degraded" ? ["OpenClaw reported a degraded runtime."] : []),
    ...(healthStatus === "unavailable" ? ["OpenClaw health is unavailable."] : []),
    ...(healthStatus === "unknown" ? ["OpenClaw health could not be verified."] : []),
  ];
  const recoveryActions: NativeDoctorSnapshot["recovery"]["actions"] = ["refresh", "probe"];
  if (configApplication === "restart-required") recoveryActions.push("restart");
  if (updateAvailable) recoveryActions.push("update");

  return {
    generatedAt: new Date().toISOString(),
    source: "openclaw-native",
    runtime: {
      status: healthStatus,
      reachable: health.status === "available" ? true : health.status === "unavailable" ? false : null,
      explanation: healthStatus === "healthy"
        ? "OpenClaw reported a healthy Gateway."
        : healthStatus === "degraded"
          ? "OpenClaw is reachable but reported a degraded runtime."
          : healthStatus === "unavailable"
            ? "The native OpenClaw health method is unavailable."
        : "AgentOS could not verify the current OpenClaw runtime health.",
    },
    status: {
      readStatus: status.status,
      runtimeVersion: readNonEmptyString(statusPayload?.runtimeVersion),
      version: readNonEmptyString(statusPayload?.version),
      updateChannel: readNonEmptyString(statusPayload?.updateChannel),
      gatewayReachable: typeof statusPayload?.gateway?.reachable === "boolean" ? statusPayload.gateway.reachable : null,
      gatewayMode: readNonEmptyString(statusPayload?.gateway?.mode)
    },
    diagnostics: {
      status: diagnostics.status,
      stability: diagnostics.value ? projectStability(diagnostics.value) : null
    },
    config: {
      readStatus: config.status,
      valid: typeof configPayload?.valid === "boolean" ? configPayload.valid : null,
      configuredRevisionHash,
      appliedRevisionHash,
      hotReloadStatus: readNonEmptyString(healthConfigReload?.hotReloadStatus),
      application: configApplication,
      explanation: configApplication === "applied"
        ? "The configured revision is applied by the active Gateway."
        : configApplication === "restart-required"
          ? "The configured revision differs from the revision applied by the active Gateway."
          : "AgentOS could not determine whether the configured revision is applied.",
    },
    update: {
      readStatus: update.status,
      status: update.status === "unavailable"
        ? "unavailable"
        : update.status !== "available"
          ? "unknown"
          : updateAvailable
            ? "available"
            : "current",
      updateAvailable,
      currentVersion: readNonEmptyString(updateAvailableRecord?.currentVersion),
      latestVersion: readNonEmptyString(updateAvailableRecord?.latestVersion),
      effectiveChannel: readNonEmptyString(updatePayload?.effectiveChannel),
      schedule: projectUpdateSchedule(updatePayload?.schedule),
      explanation: update.status === "available"
        ? updateAvailable
          ? "OpenClaw reports an update is available."
          : "OpenClaw reports no update is currently available."
        : update.status === "unavailable"
          ? "The native OpenClaw update status method is unavailable."
          : "AgentOS could not verify the current OpenClaw update state.",
    },
    recovery: {
      status: recoveryStatus,
      issues: recoveryIssues,
      actions: recoveryActions,
      explanation: recoveryStatus === "restart-required"
        ? "OpenClaw reports that a restart is required to apply the saved configuration."
        : recoveryStatus === "needs-attention"
          ? "OpenClaw reported an operational issue that needs investigation."
          : recoveryStatus === "unavailable"
            ? "OpenClaw recovery state is unavailable."
            : recoveryStatus === "unknown"
              ? "AgentOS could not verify the current recovery state."
              : "No native recovery issue is currently reported."
    },
    identity: {
      connectionId: readNonEmptyString(identity.value?.connectionId),
      authenticated: typeof identity.value?.authenticated === "boolean" ? identity.value.authenticated : null,
      role: readNonEmptyString(identity.value?.role),
      grantedScopesKnown: typeof identity.value?.grantedScopesKnown === "boolean"
        ? identity.value.grantedScopesKnown
        : null
    },
    reads: {
      health: health.status,
      status: status.status,
      "diagnostics.stability": diagnostics.status,
      "config.get": config.status,
      "update.status": update.status,
      identity: identity.status
    }
  };
}

export async function executeNativeDoctorMutation(
  input:
    | { action: "update.run"; input?: OpenClawUpdateRunInput }
    | { action: "update.hold" }
    | { action: "gateway.restart.request"; input?: OpenClawGatewayRestartRequestInput }
    | { action: "gateway.suspend.prepare"; input: OpenClawGatewaySuspendPrepareInput }
    | { action: "gateway.suspend.status"; input: OpenClawGatewaySuspendStatusInput }
    | { action: "gateway.suspend.resume"; input: OpenClawGatewaySuspendResumeInput },
  options: { adapter?: OpenClawAdapter; commandOptions?: OpenClawCommandOptions } = {}
): Promise<NativeDoctorMutationOutcome> {
  const adapter = options.adapter ?? getOpenClawAdapter();
  const commandOptions = options.commandOptions;

  try {
    let result: Record<string, unknown>;
    switch (input.action) {
      case "update.run":
        result = await requireNativeMethod(adapter.runNativeUpdate, "update.run")?.call(adapter, input.input, commandOptions) as Record<string, unknown>;
        return buildMutationOutcome("update.run", result, "succeeded", "OpenClaw accepted the native update request.");
      case "update.hold":
        result = await requireNativeMethod(adapter.holdNativeUpdate, "update.hold")?.call(adapter, commandOptions) as Record<string, unknown>;
        return buildMutationOutcome("update.hold", result, "succeeded", "OpenClaw processed the update hold request.");
      case "gateway.restart.request":
        result = await requireNativeMethod(adapter.requestNativeGatewayRestart, "gateway.restart.request")?.call(adapter, input.input, commandOptions) as Record<string, unknown>;
        return buildMutationOutcome("gateway.restart.request", result, readRestartOutcome(result), "OpenClaw accepted the native Gateway restart request.");
      case "gateway.suspend.prepare":
        result = await requireNativeMethod(adapter.prepareNativeGatewaySuspend, "gateway.suspend.prepare")?.call(adapter, input.input, commandOptions) as Record<string, unknown>;
        return buildMutationOutcome("gateway.suspend.prepare", result, readSuspendOutcome(result), "OpenClaw returned the native Gateway suspension state.");
      case "gateway.suspend.status":
        result = await requireNativeMethod(adapter.getNativeGatewaySuspendStatus, "gateway.suspend.status")?.call(adapter, input.input, commandOptions) as Record<string, unknown>;
        return buildMutationOutcome("gateway.suspend.status", result, "succeeded", "OpenClaw returned the native suspension state.");
      case "gateway.suspend.resume":
        result = await requireNativeMethod(adapter.resumeNativeGatewaySuspend, "gateway.suspend.resume")?.call(adapter, input.input, commandOptions) as Record<string, unknown>;
        return buildMutationOutcome("gateway.suspend.resume", result, "succeeded", "OpenClaw accepted the native Gateway resume request.");
    }
  } catch (error) {
    const classification = classifyNativeMutationError(error);
    const method = input.action;
    return {
      outcome: classification.disposition === "definite-rejection" ? "failed" : "unknown",
      method,
      result: null,
      reconciliation: "inconclusive",
      message: classification.disposition === "definite-rejection"
        ? redactSecretText(classification.message)
        : "The native request outcome is uncertain. AgentOS did not retry it; re-read OpenClaw state before acting again."
    };
  }
}

export function buildNativeDoctorConfirmation(snapshot: NativeDoctorSnapshot): NativeDoctorConfirmation {
  return {
    connectionId: snapshot.identity.connectionId,
    effectiveChannel: snapshot.update.effectiveChannel
  };
}

export function confirmationMatches(
  expected: NativeDoctorConfirmation,
  actual: NativeDoctorConfirmation
) {
  return expected.connectionId !== null
    && actual.connectionId !== null
    && expected.connectionId === actual.connectionId
    && expected.effectiveChannel === actual.effectiveChannel;
}

type NativeReadResult<T> = {
  status: NativeReadStatus;
  value: T | null;
};

async function readNative<T>(read: () => Promise<T | null | undefined> | undefined): Promise<NativeReadResult<T>> {
  if (!read) {
    return { status: "unavailable", value: null };
  }
  try {
    const value = await read();
    return value === null || value === undefined
      ? { status: "unknown", value: null }
      : { status: "available", value };
  } catch (error) {
    const normalized = normalizeClientError(error);
    return {
      status: normalized.kind === "unsupported" ? "unavailable" : "unknown",
      value: null
    };
  }
}

function requireNativeMethod<T extends (...args: never[]) => unknown>(method: T | undefined, name: string) {
  if (!method) {
    throw new Error(`OpenClaw native ${name} is unavailable.`);
  }
  return method;
}

function buildMutationOutcome(
  method: string,
  result: Record<string, unknown>,
  outcome: NativeDoctorMutationOutcome["outcome"],
  message: string
): NativeDoctorMutationOutcome {
  return {
    outcome,
    method,
    result: projectMutationResult(method, result),
    reconciliation: "not-required",
    message
  };
}

function readRestartOutcome(result: Record<string, unknown>): NativeDoctorMutationOutcome["outcome"] {
  const status = readNonEmptyString(result.status);
  return status === "deferred" ? "deferred" : "accepted";
}

function readSuspendOutcome(result: Record<string, unknown>): NativeDoctorMutationOutcome["outcome"] {
  const status = readNonEmptyString(result.status);
  return status === "busy" || status === "draining" ? "deferred" : "accepted";
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function projectStability(value: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  for (const key of ["status", "healthy", "ok", "checksRun", "checksSkipped", "warningCount", "errorCount"]) {
    const item = value[key];
    if (typeof item === "string" || typeof item === "boolean" || typeof item === "number") {
      safe[key] = item;
    }
  }
  return safe;
}

function projectMutationResult(method: string, value: Record<string, unknown>) {
  const safe: Record<string, unknown> = {};
  const keys = method === "update.run"
    ? ["status", "reason", "durationMs", "restart", "handoff"]
    : method === "gateway.suspend.prepare" || method === "gateway.suspend.status"
      ? ["status", "suspensionId", "retryAfterMs", "expiresAtMs", "blockers"]
      : ["ok", "status", "resumed", "reason"];
  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string" || typeof item === "boolean" || typeof item === "number") {
      safe[key] = item;
    } else if ((key === "restart" || key === "handoff") && isRecord(item)) {
      const nested: Record<string, unknown> = {};
      for (const nestedKey of ["status", "reconnected", "verified"]) {
        const nestedValue = item[nestedKey];
        if (typeof nestedValue === "string" || typeof nestedValue === "boolean") {
          nested[nestedKey] = nestedValue;
        }
      }
      if (Object.keys(nested).length > 0) safe[key] = nested;
    } else if (key === "blockers" && Array.isArray(item)) {
      safe[key] = item.filter((entry): entry is string => typeof entry === "string").slice(0, 8).map(redactSecretText);
    }
  }
  return safe;
}

function projectUpdateSchedule(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const safe: Record<string, unknown> = {};
  const channel = readNonEmptyString(value.channel);
  if (channel) safe.channel = channel;
  if (typeof value.autoEnabled === "boolean") safe.autoEnabled = value.autoEnabled;
  const target = projectScheduleTarget(value.target);
  if (target) safe.target = target;
  const campaign = projectScheduleCampaign(value.campaign);
  if (campaign) safe.campaign = campaign;
  const install = isRecord(value.install) ? projectScheduleInstall(value.install) : null;
  if (install) safe.install = install;
  return Object.keys(safe).length > 0 ? safe : null;
}

function projectScheduleTarget(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const safe: Record<string, unknown> = {};
  const kind = readNonEmptyString(value.kind);
  if (kind) safe.kind = kind;
  for (const key of ["version", "upstreamRef", "upstreamSha"]) {
    const item = readNonEmptyString(value[key]);
    if (item) safe[key] = item;
  }
  if (typeof value.commitsBehind === "number" && Number.isSafeInteger(value.commitsBehind) && value.commitsBehind >= 0) {
    safe.commitsBehind = value.commitsBehind;
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function projectScheduleCampaign(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const safe: Record<string, unknown> = {};
  const id = readNonEmptyString(value.id);
  const state = readNonEmptyString(value.state);
  if (id) safe.id = id;
  if (state) safe.state = state;
  for (const key of ["announcedAtMs", "applyAtMs", "holdUntilMs", "forceAtMs", "updatedAtMs"]) {
    const item = value[key];
    if (typeof item === "number" && Number.isSafeInteger(item) && item >= 0) safe[key] = item;
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function projectScheduleInstall(value: Record<string, unknown>): Record<string, unknown> | null {
  const safe: Record<string, unknown> = {};
  const kind = readNonEmptyString(value.kind);
  if (kind) safe.kind = kind;
  const git = value.git;
  if (isRecord(git)) {
    const gitSafe: Record<string, unknown> = {};
    const status = readNonEmptyString(git.status);
    const reason = readNonEmptyString(git.reason);
    const currentSha = readNonEmptyString(git.currentSha);
    if (status) gitSafe.status = status;
    if (reason) gitSafe.reason = reason;
    if (currentSha) gitSafe.currentSha = currentSha;
    for (const key of ["commitsBehind", "commitsAhead"]) {
      const item = git[key];
      if (typeof item === "number" && Number.isSafeInteger(item) && item >= 0) gitSafe[key] = item;
    }
    if (Object.keys(gitSafe).length > 0) safe.git = gitSafe;
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
