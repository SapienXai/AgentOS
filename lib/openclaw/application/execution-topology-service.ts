import "server-only";

import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  executeNativeMutation,
  type NativeMutationExecution
} from "@/lib/openclaw/application/native-mutation-service";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { NativeGatewayError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import type {
  OpenClawCommandOptions,
  OpenClawEnvironmentMutationPayload,
  OpenClawSessionsDispatchPayload,
  OpenClawSessionsMovePayload,
  OpenClawSessionsReclaimPayload
} from "@/lib/openclaw/client/types";
import {
  isEnvironmentEligible,
  normalizeExecutionEnvironment,
  normalizeExecutionTopology,
  normalizeSessionPlacement,
  placementMatchesTarget,
  placementTargetToDispatchInput,
  placementTargetToMoveInput,
  type ExecutionDestination,
  type ExecutionEnvironmentProjection,
  type ExecutionTopologyProjection,
  type SessionPlacementProjection
} from "@/lib/openclaw/domains/execution-topology";

export const EXECUTION_TOPOLOGY_TIMEOUT_MS = 5_000;

export class ExecutionTopologyUnavailableError extends Error {
  constructor(message = "OpenClaw execution topology is unavailable.") {
    super(message);
    this.name = "ExecutionTopologyUnavailableError";
  }
}

export type ExecutionTopologyServiceOptions = {
  adapter?: OpenClawAdapter;
  commandOptions?: OpenClawCommandOptions;
  timeoutMs?: number;
};

export async function readExecutionTopology(
  options: ExecutionTopologyServiceOptions = {}
): Promise<ExecutionTopologyProjection> {
  const adapter = options.adapter ?? getOpenClawAdapter();
  if (!adapter.listNativeExecutionEnvironments) return {
    source: "openclaw",
    sourceStatus: "unavailable",
    environments: [],
    profiles: []
  };

  try {
    const payload = await adapter.listNativeExecutionEnvironments(
      withTimeout(options.commandOptions, options.timeoutMs)
    );
    return normalizeExecutionTopology(payload);
  } catch {
    return {
      source: "openclaw",
      sourceStatus: "unknown",
      environments: [],
      profiles: []
    };
  }
}

export async function readExecutionEnvironment(
  environmentId: string,
  options: ExecutionTopologyServiceOptions = {}
) {
  const adapter = options.adapter ?? getOpenClawAdapter();
  if (!adapter.getNativeExecutionEnvironmentStatus) {
    throw new ExecutionTopologyUnavailableError("OpenClaw environments.status is unavailable.");
  }
  const environment = await adapter.getNativeExecutionEnvironmentStatus(
    { environmentId },
    withTimeout(options.commandOptions, options.timeoutMs)
  );
  return normalizeExecutionEnvironment(environment);
}

export async function readNativeNodeInventory(options: ExecutionTopologyServiceOptions = {}) {
  const adapter = options.adapter ?? getOpenClawAdapter();
  if (!adapter.listNativeNodes) {
    throw new ExecutionTopologyUnavailableError("OpenClaw node.list is unavailable.");
  }
  return adapter.listNativeNodes(withTimeout(options.commandOptions, options.timeoutMs));
}

export async function readNativeNodeDetail(
  nodeId: string,
  options: ExecutionTopologyServiceOptions = {}
) {
  const adapter = options.adapter ?? getOpenClawAdapter();
  if (!adapter.describeNativeNode) {
    throw new ExecutionTopologyUnavailableError("OpenClaw node.describe is unavailable.");
  }
  return adapter.describeNativeNode({ nodeId }, withTimeout(options.commandOptions, options.timeoutMs));
}

export async function readSessionPlacement(
  input: { sessionKey: string; agentId?: string },
  options: ExecutionTopologyServiceOptions = {}
): Promise<SessionPlacementProjection> {
  const adapter = options.adapter ?? getOpenClawAdapter();
  if (!adapter.getNativeSession) {
    throw new ExecutionTopologyUnavailableError("OpenClaw sessions.get is unavailable.");
  }
  const payload = await adapter.getNativeSession(
    { key: input.sessionKey, ...(input.agentId ? { agentId: input.agentId } : {}) },
    withTimeout(options.commandOptions, options.timeoutMs)
  );
  return normalizeSessionPlacement(payload);
}

export type SessionPlacementMutationInput = {
  sessionKey: string;
  agentId?: string;
  target: ExecutionDestination;
  machineClass?: string;
};

export async function dispatchSession(
  input: SessionPlacementMutationInput,
  options: ExecutionTopologyServiceOptions = {}
): Promise<NativeMutationExecution<OpenClawSessionsDispatchPayload>> {
  if (input.target.kind === "gateway") {
    throw new ExecutionTopologyUnavailableError("Gateway is a move destination, not a sessions.dispatch target.");
  }
  const adapter = options.adapter ?? getOpenClawAdapter();
  if (!adapter.dispatchNativeSession) {
    throw new ExecutionTopologyUnavailableError("OpenClaw sessions.dispatch is unavailable.");
  }
  const commandOptions = withTimeout(options.commandOptions, options.timeoutMs);
  const before = await readSessionPlacement({ sessionKey: input.sessionKey, agentId: input.agentId }, { adapter, commandOptions, timeoutMs: options.timeoutMs });
  const topology = input.target.kind === "automatic"
    ? null
    : await requireDestinationTopology(input.target, { adapter, commandOptions, timeoutMs: options.timeoutMs });
  const dispatchInput = placementTargetToDispatchInput(
    input.sessionKey,
    input.target.kind === "profile" && input.machineClass
      ? { ...input.target, machineClass: input.machineClass }
      : input.target,
    input.agentId
  );
  const targetEnvironmentId = resolveTargetEnvironmentId(input.target, topology?.environments ?? []);

  return executeNativeMutation({
    operation: "sessions.dispatch",
    mutate: () => adapter.dispatchNativeSession!(dispatchInput, commandOptions),
    reconcile: async () => {
      const after = await readSessionPlacement({ sessionKey: input.sessionKey, agentId: input.agentId }, { adapter, commandOptions, timeoutMs: options.timeoutMs });
      return {
        verified: hasPlacementTransition(before, after) && (
          input.target.kind === "automatic"
            ? true
            : input.target.kind === "gateway"
              ? false
              : placementMatchesTarget(after, input.target, targetEnvironmentId)
        ),
        result: null
      };
    }
  });
}

export async function moveSession(
  input: SessionPlacementMutationInput,
  options: ExecutionTopologyServiceOptions = {}
): Promise<NativeMutationExecution<OpenClawSessionsMovePayload>> {
  const target = input.target;
  if (target.kind === "automatic") {
    throw new ExecutionTopologyUnavailableError("Automatic placement is selected through sessions.dispatch.");
  }
  const adapter = options.adapter ?? getOpenClawAdapter();
  if (!adapter.moveNativeSession) {
    throw new ExecutionTopologyUnavailableError("OpenClaw sessions.move is unavailable.");
  }
  const commandOptions = withTimeout(options.commandOptions, options.timeoutMs);
  const before = await readSessionPlacement({ sessionKey: input.sessionKey, agentId: input.agentId }, { adapter, commandOptions, timeoutMs: options.timeoutMs });
  if (before.generation === null || before.environmentId === null || before.ownerEpoch === null) {
    throw new NativeGatewayError("OpenClaw has not exposed enough current placement state to move this session safely.", { kind: "unknown" });
  }
  const topology = target.kind === "gateway"
    ? null
    : await requireDestinationTopology(target, { adapter, commandOptions, timeoutMs: options.timeoutMs });
  const targetEnvironmentId = resolveTargetEnvironmentId(target, topology?.environments ?? []);
  const moveInput = placementTargetToMoveInput(
    input.sessionKey,
    { generation: before.generation, environmentId: before.environmentId, ownerEpoch: before.ownerEpoch },
    target.kind === "profile" && input.machineClass
      ? { ...target, machineClass: input.machineClass }
      : target,
    input.agentId
  );

  return executeNativeMutation({
    operation: "sessions.move",
    mutate: () => adapter.moveNativeSession!(moveInput, commandOptions),
    reconcile: async () => {
      const after = await readSessionPlacement({ sessionKey: input.sessionKey, agentId: input.agentId }, { adapter, commandOptions, timeoutMs: options.timeoutMs });
      return {
        verified: hasPlacementTransition(before, after) && placementMatchesTarget(after, target, targetEnvironmentId),
        result: null
      };
    }
  });
}

export async function reclaimSession(
  input: { sessionKey: string; agentId?: string },
  options: ExecutionTopologyServiceOptions = {}
): Promise<NativeMutationExecution<OpenClawSessionsReclaimPayload>> {
  const adapter = options.adapter ?? getOpenClawAdapter();
  if (!adapter.reclaimNativeSession) {
    throw new ExecutionTopologyUnavailableError("OpenClaw sessions.reclaim is unavailable.");
  }
  const commandOptions = withTimeout(options.commandOptions, options.timeoutMs);
  const before = await readSessionPlacement(input, { adapter, commandOptions, timeoutMs: options.timeoutMs });
  return executeNativeMutation({
    operation: "sessions.reclaim",
    mutate: () => adapter.reclaimNativeSession!({ key: input.sessionKey, ...(input.agentId ? { agentId: input.agentId } : {}) }, commandOptions),
    reconcile: async () => {
      const after = await readSessionPlacement(input, { adapter, commandOptions, timeoutMs: options.timeoutMs });
      return { verified: hasPlacementTransition(before, after) && (after.state === "local" || after.state === "reclaimed"), result: null };
    }
  });
}

export async function createExecutionEnvironment(
  input: { profileId: string; idempotencyKey: string },
  options: ExecutionTopologyServiceOptions = {}
): Promise<NativeMutationExecution<OpenClawEnvironmentMutationPayload>> {
  const adapter = options.adapter ?? getOpenClawAdapter();
  if (!adapter.createNativeExecutionEnvironment) throw new ExecutionTopologyUnavailableError("OpenClaw environments.create is unavailable.");
  const commandOptions = withTimeout(options.commandOptions, options.timeoutMs);
  return executeNativeMutation({
    operation: "environments.create",
    mutate: () => adapter.createNativeExecutionEnvironment!(input, commandOptions),
    reconcile: async () => {
      // The public 2026.9.1 environment summary exposes worker.providerId but
      // not the requested profileId or create idempotency identity. A new
      // same-provider row is therefore not causal evidence for this request.
      await readExecutionTopology({ adapter, commandOptions, timeoutMs: options.timeoutMs });
      return {
        verified: false,
        result: null
      };
    }
  });
}

export async function destroyExecutionEnvironment(
  input: { environmentId: string; force?: boolean },
  options: ExecutionTopologyServiceOptions = {}
): Promise<NativeMutationExecution<OpenClawEnvironmentMutationPayload>> {
  const adapter = options.adapter ?? getOpenClawAdapter();
  if (!adapter.destroyNativeExecutionEnvironment) throw new ExecutionTopologyUnavailableError("OpenClaw environments.destroy is unavailable.");
  const commandOptions = withTimeout(options.commandOptions, options.timeoutMs);
  const before = await readExecutionTopology({ adapter, commandOptions, timeoutMs: options.timeoutMs });
  const target = before.environments.find((environment) => environment.id === input.environmentId);
  if (!target || target.id === "gateway" || target.type === "local") {
    throw new NativeGatewayError("Only native disposable worker environments can be destroyed.", { kind: "conflict" });
  }
  return executeNativeMutation({
    operation: "environments.destroy",
    mutate: () => adapter.destroyNativeExecutionEnvironment!(input, commandOptions),
    reconcile: async () => {
      const after = await readExecutionTopology({ adapter, commandOptions, timeoutMs: options.timeoutMs });
      if (after.sourceStatus !== "available") return { verified: false, result: null };
      const current = after.environments.find((environment) => environment.id === input.environmentId);
      const wasAlreadyDestroyed = target.worker?.state === "destroyed";
      if (!current) return { verified: !wasAlreadyDestroyed, result: null };
      return {
        verified: !wasAlreadyDestroyed && current.worker?.state === "destroyed" && hasEnvironmentTransition(target, current),
        result: toNativeEnvironmentMutationPayload(current)
      };
    }
  });
}

async function requireDestinationTopology(
  target: Exclude<ExecutionDestination, { kind: "automatic" | "gateway" }>,
  options: ExecutionTopologyServiceOptions
) {
  const topology = await readExecutionTopology(options);
  if (topology.sourceStatus !== "available") throw new ExecutionTopologyUnavailableError("OpenClaw did not provide a current execution destination inventory.");
  if (target.kind === "profile" && !topology.profiles.some((profile) => profile.id === target.profileId)) {
    throw new NativeGatewayError("The requested OpenClaw execution profile is not available.", { kind: "conflict" });
  }
  if (target.kind === "device") {
    const environment = topology.environments.find((entry) => environmentMatchesDevice(entry, target.deviceId));
    if (!environment || !isEnvironmentEligible(environment)) {
      throw new NativeGatewayError("The requested OpenClaw node is not an eligible session host.", { kind: "conflict" });
    }
  }
  return topology;
}

function resolveTargetEnvironmentId(
  target: ExecutionDestination,
  environments: ExecutionEnvironmentProjection[]
) {
  if (target.kind !== "device") return null;
  return environments.find((environment) => environmentMatchesDevice(environment, target.deviceId))?.id ?? null;
}

function environmentMatchesDevice(environment: ExecutionEnvironmentProjection, deviceId: string) {
  return environment.id === deviceId || environment.id === `node:${deviceId}`;
}

function hasPlacementTransition(before: SessionPlacementProjection, after: SessionPlacementProjection) {
  if (before.generation !== null && after.generation !== null) return after.generation > before.generation;
  return before.state !== after.state || before.environmentId !== after.environmentId;
}

function hasEnvironmentTransition(before: ExecutionEnvironmentProjection, after: ExecutionEnvironmentProjection) {
  return before.status !== after.status || before.worker?.state !== after.worker?.state;
}

function toNativeEnvironmentMutationPayload(environment: ExecutionEnvironmentProjection): OpenClawEnvironmentMutationPayload {
  return {
    id: environment.id,
    type: environment.type,
    label: environment.label,
    status: environment.nativeStatus,
    ...(environment.platform ? { platform: environment.platform } : {}),
    sessionHost: environment.sessionHost,
    ...(environment.trust ? { trust: environment.trust } : {}),
    capabilities: environment.capabilities,
    invocableCommands: environment.invocableCommands,
    ...(environment.workerSlots ? { workerSlots: environment.workerSlots } : {})
  };
}

function withTimeout(options: OpenClawCommandOptions | undefined, timeoutMs = EXECUTION_TOPOLOGY_TIMEOUT_MS): OpenClawCommandOptions {
  return { ...options, timeoutMs: options?.timeoutMs ?? timeoutMs };
}
