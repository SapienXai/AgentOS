import "server-only";

import { realpath } from "node:fs/promises";
import path from "node:path";

import {
  resolveGatewayRuntimeIdentity,
  type GatewayRuntimeIdentityOptions
} from "@/lib/openclaw/lifecycle/runtime-discovery";
import type { OpenClawRuntimeIdentity } from "@/lib/openclaw/client/types";

export type MemoryCliFallbackCapability =
  | "available-local-same-runtime"
  | "unavailable-remote"
  | "unavailable-unproven";

export type MemoryCliFallbackLocality = {
  status: "proven-same-runtime" | "remote" | "unproven";
  capability: MemoryCliFallbackCapability;
  gatewayUrlClass: "loopback" | "remote" | "unknown";
  reason: string | null;
  evidence: string[];
  cliEnvironment: MemoryCliRuntimeEnvironment | null;
};

export type MemoryCliRuntimeEnvironment = {
  stateDir: string;
  configPath: string;
  profile: string | null;
};

export type MemoryCliFallbackLocalityInput = {
  /** Trusted identity captured by the connected client factory. */
  gatewayRuntime: OpenClawRuntimeIdentity | null | undefined;
  /** Trusted local lifecycle/config identity; never request-derived. */
  cliRuntime?: OpenClawRuntimeIdentity | null;
};

/** Resolve the local CLI identity from the existing lifecycle discovery boundary. */
export function resolveLocalCliRuntimeIdentity(options: GatewayRuntimeIdentityOptions = {}) {
  return resolveGatewayRuntimeIdentity(options);
}

/**
 * A loopback URL is only a prerequisite. The CLI is usable for memory
 * maintenance only when lifecycle ownership, URL, profile, state root, and
 * config path all agree and both filesystem roots can be canonicalized.
 */
export async function resolveMemoryCliFallbackLocality(
  input: MemoryCliFallbackLocalityInput
): Promise<MemoryCliFallbackLocality> {
  const gatewayRuntime = input.gatewayRuntime;
  if (!gatewayRuntime) {
    return unproven("Connected Gateway runtime identity is unavailable.");
  }

  const gatewayUrlClass = classifyGatewayUrl(gatewayRuntime.gatewayUrl);
  if (gatewayUrlClass === "remote") {
    return {
      status: "remote",
      capability: "unavailable-remote",
      gatewayUrlClass,
      reason: "The connected OpenClaw Gateway is remote; local memory CLI maintenance is unavailable.",
      evidence: [],
      cliEnvironment: null
    };
  }

  if (gatewayUrlClass !== "loopback") {
    return unproven("The connected Gateway URL is not a proven loopback runtime.", gatewayUrlClass);
  }

  const cliRuntime = input.cliRuntime === undefined
    ? resolveLocalCliRuntimeIdentity()
    : input.cliRuntime;
  if (!cliRuntime) {
    return unproven("Local OpenClaw CLI runtime identity is unavailable.");
  }

  const cliUrlClass = classifyGatewayUrl(cliRuntime.gatewayUrl);
  if (cliUrlClass !== "loopback") {
    return unproven("The local CLI runtime does not resolve to the same loopback Gateway.");
  }

  if (!isAllowedLifecycleOwnership(gatewayRuntime) || !isAllowedLifecycleOwnership(cliRuntime)) {
    return unproven("Gateway lifecycle ownership is not trusted for local memory CLI maintenance.");
  }

  if (
    normalizeGatewayUrl(gatewayRuntime.gatewayUrl) !== normalizeGatewayUrl(cliRuntime.gatewayUrl) ||
    gatewayRuntime.profile !== cliRuntime.profile ||
    gatewayRuntime.deploymentMode !== cliRuntime.deploymentMode ||
    gatewayRuntime.ownership !== cliRuntime.ownership ||
    gatewayRuntime.managementStrategy !== cliRuntime.managementStrategy ||
    gatewayRuntime.supervisorEndpoint !== cliRuntime.supervisorEndpoint
  ) {
    return unproven("Connected Gateway and local CLI runtime identities do not match.");
  }

  const canonicalGatewayStateDir = await canonicalRuntimePath(gatewayRuntime.stateDir);
  const canonicalCliStateDir = await canonicalRuntimePath(cliRuntime.stateDir);
  const canonicalGatewayConfigPath = await canonicalRuntimePath(gatewayRuntime.configPath);
  const canonicalCliConfigPath = await canonicalRuntimePath(cliRuntime.configPath);

  if (!canonicalGatewayStateDir || !canonicalCliStateDir || !canonicalGatewayConfigPath || !canonicalCliConfigPath) {
    return unproven("Gateway and local CLI state/config paths could not be canonicalized.");
  }

  if (
    canonicalGatewayStateDir !== canonicalCliStateDir ||
    canonicalGatewayConfigPath !== canonicalCliConfigPath
  ) {
    return unproven("Connected Gateway and local CLI state/config identities do not match.");
  }

  const cliEnvironment = {
    stateDir: canonicalCliStateDir,
    configPath: canonicalCliConfigPath,
    profile: cliRuntime.profile
  } satisfies MemoryCliRuntimeEnvironment;

  return {
    status: "proven-same-runtime",
    capability: "available-local-same-runtime",
    gatewayUrlClass,
    reason: null,
    evidence: [
      "loopback-gateway",
      "trusted-lifecycle-ownership",
      "matching-gateway-url",
      "matching-profile",
      "matching-state-dir",
      "matching-config-path",
      "canonicalized-runtime-paths"
    ],
    cliEnvironment
  };
}

export function classifyGatewayUrl(value: string | null | undefined) {
  if (!value) {
    return "unknown" as const;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      return "unknown" as const;
    }
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (hostname === "localhost" || isLoopbackIp(hostname)) {
      return "loopback" as const;
    }
    if (hostname) {
      return "remote" as const;
    }
  } catch {
    return "unknown" as const;
  }

  return "unknown" as const;
}

function isAllowedLifecycleOwnership(runtime: OpenClawRuntimeIdentity) {
  return runtime.ownership === "agentos-managed" || (
    runtime.ownership === "external-supervisor" &&
    runtime.deploymentMode === "railway" &&
    runtime.managementStrategy === "external-supervisor"
  );
}

function isLoopbackIp(hostname: string) {
  if (hostname === "::1" || hostname === "0:0:0:0:0:0:0:1") {
    return true;
  }

  const ipv4 = hostname.startsWith("::ffff:") ? hostname.slice("::ffff:".length) : hostname;
  const octets = ipv4.includes(".")
    ? ipv4.split(".").map((value) => Number(value))
    : decodeMappedIpv4(ipv4);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    return false;
  }

  return octets[0] === 127;
}

function decodeMappedIpv4(value: string) {
  const parts = value.split(":");
  if (parts.length !== 2) {
    return [];
  }
  const high = Number.parseInt(parts[0], 16);
  const low = Number.parseInt(parts[1], 16);
  if (![high, low].every((part) => Number.isInteger(part) && part >= 0 && part <= 0xffff)) {
    return [];
  }
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function normalizeGatewayUrl(value: string) {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return value.trim().replace(/\/$/, "").toLowerCase();
  }
}

async function canonicalRuntimePath(value: string) {
  if (!path.isAbsolute(value) || path.resolve(value) === path.parse(value).root) {
    return null;
  }

  try {
    return await realpath(value);
  } catch {
    return null;
  }
}

function unproven(
  reason: string,
  gatewayUrlClass: "loopback" | "remote" | "unknown" = "unknown"
): MemoryCliFallbackLocality {
  return {
    status: "unproven",
    capability: "unavailable-unproven",
    gatewayUrlClass,
    reason,
    evidence: [],
    cliEnvironment: null
  };
}
