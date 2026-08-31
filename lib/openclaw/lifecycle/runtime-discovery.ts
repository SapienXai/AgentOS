import "server-only";

import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

import { resolveGatewayUrl } from "@/lib/openclaw/client/native-ws-gateway-policy";
import { resolveOpenClawBin } from "@/lib/openclaw/cli";
import { readOpenClawRuntimeIdentity } from "@/lib/openclaw/migration-engine/paths";
import { OPENCLAW_SUPPORTED_BASELINE_VERSION } from "@/lib/openclaw/versions";
import type {
  GatewayDeploymentMode,
  GatewayLifecycleEnvironment,
  GatewayLifecycleOwnership,
  GatewayManagementStrategy,
  GatewayRuntimeDescriptor
} from "./types";

export const DEFAULT_SUPERVISOR_SOCKET_PATH = "/tmp/agentos-supervisor.sock";
export const DEFAULT_GATEWAY_PORT = 18789;

export type GatewayRuntimeDiscoveryOptions = {
  env?: GatewayLifecycleEnvironment;
  platform?: NodeJS.Platform;
  now?: () => Date;
  resolveBinary?: () => Promise<string>;
  probe?: (input: { url: string; port: number }) => Promise<GatewayProbeResult>;
};

type GatewayProbeResult = {
    health: "unknown" | "live" | "not-live";
    ready: boolean;
    authenticated: boolean;
    protocolVersion: number | null;
    version: string | null;
    sourceCommit: string | null;
};

export async function discoverGatewayRuntime(
  options: GatewayRuntimeDiscoveryOptions = {}
): Promise<GatewayRuntimeDescriptor> {
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const deploymentMode = resolveDeploymentMode(env);
  const ownership = resolveOwnership(env, deploymentMode);
  const stateDir = resolveSafeRuntimePath(
    env.OPENCLAW_STATE_DIR?.trim() || path.join(homedir(), ".openclaw"),
    "OpenClaw state"
  );
  const configPath = resolveSafeRuntimePath(
    env.OPENCLAW_CONFIG_PATH?.trim() || path.join(stateDir, "openclaw.json"),
    "OpenClaw config"
  );
  const gatewayUrl = resolveTrustedGatewayUrl(env);
  const gatewayPort = resolveGatewayPort(gatewayUrl, env);
  const supervisorEndpoint = ownership === "external-supervisor"
    ? resolveSupervisorSocketPath(env)
    : null;
  const managementStrategy = resolveManagementStrategy(env, ownership);

  let binaryPath: string | null = null;
  let version: string | null = null;
  let sourceCommit: string | null = null;
  let installLocation: string | null = null;
  const configuredBinary = env.OPENCLAW_GATEWAY_BINARY?.trim() || env.OPENCLAW_BIN?.trim();
  const resolveBinary = options.resolveBinary ?? (configuredBinary
    ? async () => configuredBinary
    : resolveOpenClawBin);

  if (ownership !== "external-supervisor" || env.OPENCLAW_GATEWAY_BINARY?.trim()) {
    binaryPath = await resolveBinary().catch(() => null);
    if (binaryPath) {
      installLocation = path.dirname(binaryPath);
      const identity = await readOpenClawRuntimeIdentity({ binaryPath }).catch(() => null);
      version = identity?.version ?? null;
      sourceCommit = identity?.sourceCommit ?? null;
    }
  }
  const probed = options.probe
    ? await options.probe({ url: gatewayUrl, port: gatewayPort }).catch(() => null)
    : null;
  const socketInfo = supervisorEndpoint ? await inspectSupervisorEndpoint(supervisorEndpoint) : null;
  const checkedAt = now().toISOString();

  return {
    ownership,
    state: resolveInitialState(ownership, probed),
    deploymentMode,
    managementStrategy,
    gatewayUrl,
    gatewayPort,
    binaryPath,
    installLocation,
    stateDir,
    configPath,
    pid: socketInfo?.pid ?? null,
    generation: socketInfo?.generation ?? null,
    supervisorEndpoint,
    supervisorProtocolVersion: socketInfo?.protocolVersion ?? null,
    version: probed?.version ?? version,
    sourceCommit: probed?.sourceCommit ?? sourceCommit,
    health: probed?.health ?? "unknown",
    ready: probed?.ready ?? false,
    authenticated: probed?.authenticated ?? false,
    protocolVersion: probed?.protocolVersion ?? null,
    checkedAt,
    reason: resolveInitialReason(ownership, binaryPath, socketInfo, probed)
  };
}

export function resolveDeploymentMode(env: GatewayLifecycleEnvironment): GatewayDeploymentMode {
  const value = env.AGENTOS_DEPLOYMENT_PLATFORM?.trim().toLowerCase();
  if (value === "railway") return "railway";
  if (value === "local" || !value) return "local";
  return "unknown";
}

export function resolveOwnership(
  env: GatewayLifecycleEnvironment,
  deploymentMode = resolveDeploymentMode(env)
): GatewayLifecycleOwnership {
  const supervisorMode = env.OPENCLAW_SUPERVISOR_MODE?.trim().toLowerCase();
  if (deploymentMode === "unknown") return "unknown";
  if (supervisorMode === "external" || deploymentMode === "railway") {
    return "external-supervisor";
  }
  if (supervisorMode === "agentos-managed" || deploymentMode === "local") {
    return "agentos-managed";
  }
  if (supervisorMode && supervisorMode !== "agentos-managed" && supervisorMode !== "external") {
    return "unknown";
  }
  return "unavailable";
}

export function resolveManagementStrategy(
  env: GatewayLifecycleEnvironment,
  ownership: GatewayLifecycleOwnership
): GatewayManagementStrategy {
  if (ownership === "external-supervisor") return "external-supervisor";
  if (ownership !== "agentos-managed") return "unavailable";
  return env.OPENCLAW_GATEWAY_PROCESS_MODE?.trim().toLowerCase() === "child"
    ? "child"
    : "openclaw-service";
}

export function resolveTrustedGatewayUrl(env: GatewayLifecycleEnvironment) {
  const url = resolveGatewayUrl(env.AGENTOS_OPENCLAW_GATEWAY_URL ?? env.OPENCLAW_GATEWAY_URL);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("OpenClaw Gateway URL must be a valid ws:// or wss:// URL.");
  }
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error("OpenClaw Gateway URL must use ws:// or wss://.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("OpenClaw Gateway URL must not contain credentials or query data.");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function resolveGatewayPort(url: string, env: GatewayLifecycleEnvironment) {
  const parsed = new URL(url);
  const configured = Number.parseInt(env.OPENCLAW_GATEWAY_PORT?.trim() || "", 10);
  const port = configured || Number.parseInt(parsed.port, 10) || DEFAULT_GATEWAY_PORT;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("OpenClaw Gateway port must be between 1 and 65535.");
  }
  return port;
}

export function resolveSupervisorSocketPath(env: GatewayLifecycleEnvironment) {
  return resolveSafeRuntimePath(
    env.AGENTOS_SUPERVISOR_SOCKET_PATH?.trim() || DEFAULT_SUPERVISOR_SOCKET_PATH,
    "Gateway supervisor socket"
  );
}

export function resolveSafeRuntimePath(value: string, label: string) {
  const resolved = path.resolve(value);
  if (!path.isAbsolute(value) || resolved === path.parse(resolved).root) {
    throw new Error(`Unsafe ${label} path; an explicit non-root absolute path is required.`);
  }
  return resolved;
}

async function inspectSupervisorEndpoint(socketPath: string) {
  const metadata = await stat(socketPath).catch(() => null);
  if (!metadata) return null;
  if (!metadata.isSocket()) return { protocolVersion: null, pid: null, generation: null };
  const mode = metadata.mode & 0o777;
  if (mode & 0o077) return { protocolVersion: null, pid: null, generation: null };
  return { protocolVersion: 1, pid: null, generation: null };
}

function resolveInitialState(
  ownership: GatewayLifecycleOwnership,
  probed: GatewayProbeResult | null
): GatewayRuntimeDescriptor["state"] {
  if (ownership === "unknown" || ownership === "unavailable") return "unknown";
  if (probed?.ready) return "ready";
  if (probed?.health === "live") return "running";
  if (probed?.health === "not-live") return "stopped";
  return "unknown";
}

function resolveInitialReason(
  ownership: GatewayLifecycleOwnership,
  binaryPath: string | null,
  socketInfo: unknown,
  probed: unknown
) {
  if (ownership === "unknown") return "Gateway lifecycle ownership could not be determined safely.";
  if (ownership === "unavailable") return "Gateway lifecycle is unavailable in the current deployment.";
  if (!binaryPath && ownership === "agentos-managed") return `OpenClaw ${OPENCLAW_SUPPORTED_BASELINE_VERSION} binary could not be resolved.`;
  if (!socketInfo && ownership === "external-supervisor") return "External supervisor endpoint is not available.";
  if (!probed) return "Gateway readiness has not been probed.";
  return null;
}
