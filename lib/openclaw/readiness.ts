import type { MissionControlSnapshot } from "@/lib/openclaw/types";
import { redactSecretText } from "@/lib/security/redaction";

export function isOpenClawRuntimeStateReady(snapshot: MissionControlSnapshot) {
  return snapshot.diagnostics.runtime.stateWritable && snapshot.diagnostics.runtime.sessionStoreWritable;
}

export function isOpenClawOnboardingSystemReady(snapshot: MissionControlSnapshot) {
  return snapshot.diagnostics.installed && snapshot.diagnostics.rpcOk;
}

export function isOpenClawOnboardingModelReady(snapshot: MissionControlSnapshot) {
  return isOpenClawOnboardingSystemReady(snapshot) && (
    snapshot.diagnostics.modelReadiness.ready ||
    Boolean(resolveUsableAgentModelId(snapshot))
  );
}

export function isOpenClawRuntimeSmokeTestReady(snapshot: MissionControlSnapshot) {
  return snapshot.diagnostics.runtime.smokeTest.status === "passed";
}

export function isOpenClawSystemReady(snapshot: MissionControlSnapshot) {
  return snapshot.diagnostics.installed && snapshot.diagnostics.rpcOk && isOpenClawRuntimeStateReady(snapshot);
}

export function isOpenClawMissionReady(snapshot: MissionControlSnapshot) {
  return isOpenClawSystemReady(snapshot) &&
    isOpenClawOnboardingModelReady(snapshot) &&
    isOpenClawRuntimeSmokeTestReady(snapshot);
}

export function resolveMissionDispatchReadinessError(
  snapshot: MissionControlSnapshot,
  requestedModelId?: string | null
) {
  const systemIssue = resolveOpenClawSystemReadinessIssue(snapshot);

  if (systemIssue) {
    return `${systemIssue} Mission dispatch is blocked until OpenClaw system readiness is healthy.`;
  }

  const modelIssue = resolveOpenClawModelReadinessIssue(snapshot, requestedModelId);

  if (modelIssue) {
    return `${modelIssue} Mission dispatch is blocked until a usable model is ready.`;
  }

  return null;
}

export function resolveWorkspaceCreationReadinessError(
  snapshot: MissionControlSnapshot,
  requestedModelId?: string | null
) {
  const systemIssue = resolveOpenClawSystemReadinessIssue(snapshot);

  if (systemIssue) {
    return `${systemIssue} Workspace creation is blocked before any files are written.`;
  }

  const modelIssue = resolveOpenClawModelReadinessIssue(snapshot, requestedModelId);

  if (modelIssue) {
    return `${modelIssue} Choose a model before creating the first workspace.`;
  }

  return null;
}

export function resolveAgentCreationReadinessError(
  snapshot: MissionControlSnapshot,
  requestedModelId?: string | null
) {
  const systemIssue = resolveOpenClawSystemReadinessIssue(snapshot);

  if (systemIssue) {
    return `${systemIssue} Agent creation is blocked until OpenClaw is ready.`;
  }

  const modelIssue = resolveOpenClawModelReadinessIssue(snapshot, requestedModelId);

  if (modelIssue) {
    return `${modelIssue} Choose a ready model before creating the agent.`;
  }

  return null;
}

export function resolveOpenClawSystemReadinessIssue(snapshot: MissionControlSnapshot) {
  const diagnostics = snapshot.diagnostics;

  if (!diagnostics.installed) {
    return "OpenClaw CLI is not installed or not on PATH. Install OpenClaw, then run agentos doctor and agentos start --open.";
  }

  if (!diagnostics.rpcOk) {
    const transport = diagnostics.transport;
    const recovery = redactOptionalDiagnostic(transport?.recovery);
    const lastNativeError = redactOptionalDiagnostic(transport?.lastNativeError);
    const suffix = recovery || lastNativeError ? ` ${recovery || lastNativeError}` : "";

    if (transport?.gatewayMode === "cli-forced") {
      return `OpenClaw Gateway native transport is disabled by CLI-forced mode.${suffix || " Unset CLI-forced Gateway mode and restart AgentOS."}`;
    }

    if (transport?.gatewayMode === "unreachable") {
      return `OpenClaw Gateway is unreachable.${suffix || " Start or restart the Gateway, then retry."}`;
    }

    if (transport?.gatewayMode === "fallback-active" || transport?.gatewayMode === "degraded") {
      return `OpenClaw Gateway is not fully ready (${transport.statusLabel}).${suffix || " Inspect Gateway diagnostics, repair auth/device access, and retry."}`;
    }

    if (diagnostics.loaded) {
      return "OpenClaw Gateway service is registered, but RPC is not ready. Restart the Gateway and inspect diagnostics if it stays offline.";
    }

    return "OpenClaw Gateway is not running. Start or repair the local Gateway before using write actions.";
  }

  if (!diagnostics.runtime.stateWritable || !diagnostics.runtime.sessionStoreWritable) {
    const runtimeIssue = diagnostics.runtime.issues.map(redactSecretText).find(Boolean);
    return runtimeIssue
      ? `OpenClaw runtime state is not writable. ${runtimeIssue}`
      : `OpenClaw runtime state is not writable at ${diagnostics.runtime.stateRoot}. Check permissions and retry.`;
  }

  return null;
}

export function resolveOpenClawModelReadinessIssue(
  snapshot: MissionControlSnapshot,
  requestedModelId?: string | null
) {
  const readiness = snapshot.diagnostics.modelReadiness;
  const requestedModel = normalizeModelId(requestedModelId);

  if (requestedModel) {
    const model = findSnapshotModel(snapshot, requestedModel);

    if (model) {
      return isSnapshotModelRecordUsable(model)
        ? null
        : `OpenClaw model setup is incomplete. Requested model ${requestedModel} is not ready.`;
    }

    if (readiness.ready && isConfiguredModelReference(snapshot, requestedModel)) {
      return null;
    }

    return `OpenClaw model setup is incomplete. Requested model ${requestedModel} is not ready.`;
  }

  if (readiness.ready || resolveUsableAgentModelId(snapshot)) {
    return null;
  }

  const firstIssue = readiness.issues.map(redactSecretText).find(Boolean);

  if (firstIssue) {
    return `OpenClaw model setup is incomplete. ${firstIssue}`;
  }

  if (readiness.totalModelCount === 0) {
    return "OpenClaw model setup is incomplete. No models are configured yet.";
  }

  if (readiness.availableModelCount === 0) {
    return "OpenClaw model setup is incomplete. Models are configured, but none are currently available.";
  }

  if (readiness.defaultModel && !readiness.defaultModelReady) {
    return `OpenClaw model setup is incomplete. Default model ${readiness.defaultModel} is not ready.`;
  }

  return "OpenClaw model setup is incomplete. Configure a usable default model in Add Models.";
}

function redactOptionalDiagnostic(value: string | null | undefined) {
  const redacted = typeof value === "string" ? redactSecretText(value).trim() : "";
  return redacted || null;
}

function resolveUsableAgentModelId(snapshot: MissionControlSnapshot) {
  return snapshot.agents
    .map((agent) => normalizeModelId(agent.modelId))
    .find((modelId) => modelId && isSnapshotModelUsable(snapshot, modelId));
}

function normalizeModelId(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized && normalized !== "unassigned" ? normalized : null;
}

function isSnapshotModelUsable(snapshot: MissionControlSnapshot, modelId: string) {
  const model = findSnapshotModel(snapshot, modelId);

  if (!model) {
    return false;
  }

  return isSnapshotModelRecordUsable(model);
}

function findSnapshotModel(snapshot: MissionControlSnapshot, modelId: string) {
  return snapshot.models.find((entry) => entry.id === modelId);
}

function isSnapshotModelRecordUsable(model: MissionControlSnapshot["models"][number]) {
  return model.missing !== true && model.available !== false;
}

function isConfiguredModelReference(snapshot: MissionControlSnapshot, modelId: string) {
  const readiness = snapshot.diagnostics.modelReadiness;
  const configuredIds = [
    normalizeModelId(readiness.resolvedDefaultModel),
    normalizeModelId(readiness.defaultModel),
    normalizeModelId(readiness.recommendedModelId),
    ...snapshot.agents.map((agent) => normalizeModelId(agent.modelId))
  ];

  return configuredIds.includes(modelId);
}
