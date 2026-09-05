import type {
  OpenClawEnvironmentListPayload,
  OpenClawEnvironmentSummary,
  OpenClawSessionPayload,
  OpenClawSessionPlacement,
  OpenClawSessionsDispatchInput,
  OpenClawSessionsMoveInput
} from "@/lib/openclaw/client/types";

export const MAX_EXECUTION_ENVIRONMENTS = 64;
export const MAX_ENVIRONMENT_CAPABILITIES = 64;
export const MAX_ENVIRONMENT_ISSUES = 32;

export type ExecutionEnvironmentProductStatus = "available" | "starting" | "stopping" | "unavailable" | "error" | "unknown";

export type ExecutionEnvironmentProjection = {
  id: string;
  type: string;
  label: string;
  status: ExecutionEnvironmentProductStatus;
  nativeStatus: string;
  platform: string | null;
  sessionHost: boolean;
  trust: string | null;
  capabilities: string[];
  invocableCommands: string[];
  workerSlots: { total: number; available: number } | null;
  worker: {
    providerId: string;
    state: string;
    attachedSessionIds: string[];
    tunnelStatus: string;
    error: string | null;
  } | null;
  issues: Array<Record<string, unknown>>;
  lastSeenAtMs: number | null;
};

export type ExecutionTopologyProjection = {
  source: "openclaw";
  sourceStatus: "available" | "unavailable" | "unknown";
  environments: ExecutionEnvironmentProjection[];
  profiles: Array<{
    id: string;
    providerId: string;
    trust: string | null;
    executionMode: string | null;
    executionModes: string[];
  }>;
};

export type NativePlacementState =
  | "local"
  | "requested"
  | "provisioning"
  | "syncing"
  | "starting"
  | "active"
  | "draining"
  | "reconciling"
  | "reclaimed"
  | "failed";

export type SessionPlacementProjection = {
  source: "openclaw";
  state: NativePlacementState | "unknown";
  generation: number | null;
  environmentId: string | null;
  profileId: string | null;
  deviceId: string | null;
  ownerEpoch: number | null;
  updatedAtMs: number | null;
};

export type ExecutionDestination =
  | { kind: "automatic" }
  | { kind: "gateway" }
  | { kind: "device"; deviceId: string }
  | { kind: "profile"; profileId: string; machineClass?: string };

export function normalizeExecutionTopology(payload: OpenClawEnvironmentListPayload): ExecutionTopologyProjection {
  return {
    source: "openclaw",
    sourceStatus: "available",
    environments: payload.environments.slice(0, MAX_EXECUTION_ENVIRONMENTS).map(normalizeExecutionEnvironment),
    profiles: (payload.profiles ?? []).slice(0, MAX_EXECUTION_ENVIRONMENTS).map((profile) => ({
      id: profile.id,
      providerId: profile.providerId,
      trust: profile.trust ?? null,
      executionMode: profile.executionMode ?? null,
      executionModes: (profile.executionModes ?? []).slice(0, 8)
    }))
  };
}

export function unavailableExecutionTopology(sourceStatus: "unavailable" | "unknown" = "unavailable"): ExecutionTopologyProjection {
  return {
    source: "openclaw",
    sourceStatus,
    environments: [],
    profiles: []
  };
}

export function normalizeExecutionEnvironment(environment: OpenClawEnvironmentSummary): ExecutionEnvironmentProjection {
  const nativeStatus = environment.status.trim().toLowerCase();
  const worker = environment.worker
    ? {
        providerId: environment.worker.providerId,
        state: environment.worker.state,
        attachedSessionIds: environment.worker.attachedSessionIds.slice(0, 64),
        tunnelStatus: environment.worker.tunnelStatus,
        error: environment.worker.error ?? null
      }
    : null;

  return {
    id: environment.id,
    type: environment.type,
    label: environment.label?.trim() || environment.id,
    status: normalizeEnvironmentStatus(nativeStatus),
    nativeStatus: environment.status,
    platform: environment.platform ?? null,
    sessionHost: environment.sessionHost === true,
    trust: environment.trust ?? null,
    capabilities: (environment.capabilities ?? []).slice(0, MAX_ENVIRONMENT_CAPABILITIES),
    invocableCommands: (environment.invocableCommands ?? []).slice(0, MAX_ENVIRONMENT_CAPABILITIES),
    workerSlots: environment.workerSlots
      ? { total: environment.workerSlots.total, available: environment.workerSlots.available }
      : null,
    worker,
    issues: (environment.issues ?? []).slice(0, MAX_ENVIRONMENT_ISSUES),
    lastSeenAtMs: environment.lastSeenAtMs ?? null
  };
}

export function normalizeSessionPlacement(payload: OpenClawSessionPayload): SessionPlacementProjection {
  const row = isRecord(payload.session) ? payload.session : payload;
  const placement = isRecord(row.placement)
    ? row.placement as OpenClawSessionPlacement
    : null;
  const runner = placement && isRecord(placement.runner) ? placement.runner : null;
  const state = placement && isNativePlacementState(placement.state) ? placement.state : "unknown";
  return {
    source: "openclaw",
    state,
    generation: placement && typeof placement.generation === "number" ? placement.generation : null,
    environmentId: placement && typeof placement.environmentId === "string"
      ? placement.environmentId
      : typeof row.execNode === "string" && row.execNode.trim()
        ? row.execNode
        : state === "local"
          ? "gateway"
          : null,
    profileId: placement && typeof placement.profileId === "string" ? placement.profileId : null,
    deviceId: runner && typeof runner.deviceId === "string" ? runner.deviceId : null,
    ownerEpoch: placement && typeof placement.activeOwnerEpoch === "number"
      ? placement.activeOwnerEpoch
      : placement && typeof placement.ownerEpoch === "number"
        ? placement.ownerEpoch
        : null,
    updatedAtMs: placement && typeof placement.updatedAtMs === "number" ? placement.updatedAtMs : null
  };
}

export function isEnvironmentEligible(environment: ExecutionEnvironmentProjection) {
  if (!environment.sessionHost || environment.status !== "available") return false;
  if (!environment.worker) return true;
  return ["ready", "attached", "idle"].includes(environment.worker.state);
}

export function isPlacementActive(placement: SessionPlacementProjection) {
  return placement.state === "active" || placement.state === "draining" || placement.state === "reconciling";
}

export function placementTargetToDispatchInput(
  key: string,
  target: Extract<ExecutionDestination, { kind: "automatic" | "device" | "profile" }>,
  agentId?: string
): OpenClawSessionsDispatchInput {
  if (target.kind === "automatic") {
    return { key, ...(agentId ? { agentId } : {}), autoDevice: true };
  }
  if (target.kind === "device") {
    return { key, ...(agentId ? { agentId } : {}), deviceId: target.deviceId };
  }
  return {
    key,
    ...(agentId ? { agentId } : {}),
    profileId: target.profileId,
    ...(target.machineClass ? { machineClass: target.machineClass } : {})
  };
}

export function placementTargetToMoveInput(
  key: string,
  expected: NonNullable<OpenClawSessionsMoveInput["expected"]>,
  target: Exclude<ExecutionDestination, { kind: "automatic" }>,
  agentId?: string
): OpenClawSessionsMoveInput {
  const nativeTarget = target.kind === "gateway"
    ? { kind: "gateway" as const }
    : target.kind === "device"
      ? { kind: "device" as const, deviceId: target.deviceId }
      : { kind: "profile" as const, profileId: target.profileId, ...(target.machineClass ? { machineClass: target.machineClass } : {}) };
  return {
    key,
    ...(agentId ? { agentId } : {}),
    expected,
    target: nativeTarget
  };
}

export function placementMatchesTarget(
  placement: SessionPlacementProjection,
  target: Exclude<ExecutionDestination, { kind: "automatic" }>,
  targetEnvironmentId?: string | null
) {
  if (target.kind === "gateway") return placement.state === "local" && placement.environmentId === "gateway";
  if (target.kind === "profile") return isPlacementActive(placement) && placement.profileId === target.profileId;
  return isPlacementActive(placement) && Boolean(targetEnvironmentId) && placement.environmentId === targetEnvironmentId;
}

function normalizeEnvironmentStatus(status: string): ExecutionEnvironmentProductStatus {
  if (["available", "ready", "attached", "idle"].includes(status)) return "available";
  if (["starting", "requested", "provisioning", "bootstrapping", "syncing"].includes(status)) return "starting";
  if (["stopping", "draining", "destroying"].includes(status)) return "stopping";
  if (["unavailable", "offline", "disconnected", "destroyed"].includes(status)) return "unavailable";
  if (["error", "failed", "orphaned"].includes(status)) return "error";
  return "unknown";
}

function isNativePlacementState(value: unknown): value is NativePlacementState {
  return value === "local" || value === "requested" || value === "provisioning" || value === "syncing" ||
    value === "starting" || value === "active" || value === "draining" || value === "reconciling" ||
    value === "reclaimed" || value === "failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
