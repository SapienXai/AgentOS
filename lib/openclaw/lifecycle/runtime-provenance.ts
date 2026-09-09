import "server-only";

import type { ChildProcess } from "node:child_process";
import path from "node:path";

import type {
  OpenClawRuntimeIdentity,
  OpenClawRuntimeOwnershipProof
} from "@/lib/openclaw/client/types";
import { requestSupervisorCommand } from "./supervisor-ipc";
import type { GatewayLifecycleChild, GatewayRuntimeDescriptor } from "./types";

type ManagedChildRecord = {
  child: ChildProcess;
  proof: OpenClawRuntimeOwnershipProof;
};

const managedChildRecords = new Map<string, ManagedChildRecord>();

/**
 * Records the exact child and launch identity after AgentOS spawns a Gateway.
 * The record is process-local and is invalidated when that child exits.
 */
export function registerAgentOsManagedGatewayRuntime(
  descriptor: GatewayRuntimeDescriptor,
  child: GatewayLifecycleChild
) {
  if (child.pid <= 1 || child.generation <= 0) return null;

  const proof: OpenClawRuntimeOwnershipProof = {
    source: "agentos-child",
    gatewayUrl: descriptor.gatewayUrl,
    stateDir: descriptor.stateDir,
    configPath: descriptor.configPath,
    profile: descriptor.profile,
    generation: child.generation,
    pid: child.pid,
    supervisorEndpoint: null
  };
  managedChildRecords.set(runtimeKey(descriptor), { child: child.process, proof });
  child.process.once("exit", () => {
    clearAgentOsManagedGatewayRuntime(descriptor, child);
  });
  return proof;
}

export function clearAgentOsManagedGatewayRuntime(
  descriptor: GatewayRuntimeDescriptor,
  child: GatewayLifecycleChild
) {
  const current = managedChildRecords.get(runtimeKey(descriptor));
  if (current?.child === child.process) managedChildRecords.delete(runtimeKey(descriptor));
}

/**
 * Reads fresh authoritative ownership evidence. Configured runtime fields are
 * deliberately insufficient; only a live AgentOS child or a fresh response
 * from the private Railway supervisor can produce a proof.
 */
export async function resolveAuthoritativeRuntimeOwnershipProof(
  runtime: OpenClawRuntimeIdentity
): Promise<OpenClawRuntimeOwnershipProof | null> {
  if (runtime.ownership === "agentos-managed" && runtime.managementStrategy === "child") {
    const record = managedChildRecords.get(runtimeKey(runtime));
    if (!record || record.child.exitCode !== null || record.proof.pid <= 1) return null;
    return record.proof;
  }

  if (
    runtime.ownership !== "external-supervisor" ||
    runtime.deploymentMode !== "railway" ||
    runtime.managementStrategy !== "external-supervisor" ||
    !runtime.supervisorEndpoint
  ) {
    return null;
  }

  const response = await requestSupervisorCommand(runtime.supervisorEndpoint, "status").catch(() => null);
  if (!response || response.state !== "ready" || response.ready !== true) return null;
  if (
    typeof response.gatewayUrl !== "string" ||
    typeof response.stateDir !== "string" ||
    typeof response.configPath !== "string" ||
    !("profile" in response) ||
    (response.profile !== null && typeof response.profile !== "string") ||
    response.generation === null || response.generation <= 0 ||
    response.pid === null || response.pid <= 1
  ) {
    return null;
  }

  return {
    source: "external-supervisor",
    gatewayUrl: response.gatewayUrl,
    stateDir: response.stateDir,
    configPath: response.configPath,
    profile: response.profile,
    generation: response.generation,
    pid: response.pid,
    supervisorEndpoint: runtime.supervisorEndpoint
  };
}

function runtimeKey(runtime: Pick<OpenClawRuntimeIdentity, "gatewayUrl" | "stateDir" | "configPath" | "profile"> | Pick<GatewayRuntimeDescriptor, "gatewayUrl" | "stateDir" | "configPath" | "profile">) {
  return [
    normalizeGatewayUrl(runtime.gatewayUrl),
    path.resolve(runtime.stateDir),
    path.resolve(runtime.configPath),
    runtime.profile ?? ""
  ].join("\u0000");
}

function normalizeGatewayUrl(value: string) {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return value.trim().replace(/\/$/, "").toLowerCase();
  }
}
