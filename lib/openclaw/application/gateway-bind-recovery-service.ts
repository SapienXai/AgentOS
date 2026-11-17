import "server-only";

import { isIPv4 } from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { z } from "zod";

import { CliOpenClawGatewayClient } from "@/lib/openclaw/client/cli-gateway-client";
import { createOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import type { GatewayBindRecoveryStatus, GatewayBindRepairPlan, GatewayBindRepairResult } from "@/lib/openclaw/gateway-bind-recovery";
import { resolveGatewayPort, resolveGatewayRuntimeIdentity } from "@/lib/openclaw/lifecycle/runtime-discovery";
import type { GatewayLifecycleEnvironment } from "@/lib/openclaw/lifecycle/types";
import { isLoopbackHost } from "@/lib/security/local-operator";
import { controlGatewayForRecovery } from "./gateway-service";

const configFile = z.object({ path: z.string(), exists: z.literal(true), valid: z.literal(true) });
const offlineStatus = z.object({
  config: z.object({ cli: configFile, daemon: configFile }),
  service: z.object({
    loaded: z.literal(true),
    command: z.object({ programArguments: z.array(z.string()) }).optional()
  }),
  gateway: z.object({ bindMode: z.literal("custom"), customBindHost: z.string(), port: z.number() }),
  port: z.object({ status: z.literal("free"), port: z.number() })
});

const bindKey = "gateway.customBindHost";
const cliOptions = { timeoutMs: 5_000 };
const cli = new CliOpenClawGatewayClient();
let repairInProgress = false;

type RecoveryDependencies = {
  readStatus: () => Promise<unknown>;
  readConfig: (key: string) => Promise<unknown>;
  interfaces: typeof networkInterfaces;
  save: (plan: GatewayBindRepairPlan) => Promise<unknown>;
  restart: () => Promise<unknown>;
  verifyNative: () => Promise<boolean>;
  checkHealth: (address: string, port: number) => Promise<boolean>;
};

const defaultDependencies: RecoveryDependencies = {
  readStatus: () => cli.getGatewayServiceStatusForBindRecovery(cliOptions),
  readConfig: (key: string) => cli.getConfig<unknown>(key, cliOptions),
  interfaces: networkInterfaces,
  save: (plan: GatewayBindRepairPlan) => cli.replaceGatewayCustomBindHost(plan.previousAddress, plan.nextAddress, cliOptions),
  restart: () => controlGatewayForRecovery("restart"),
  verifyNative: async () => {
    const client = createOpenClawGatewayClient({ sharedStateMode: "read-only" });
    try {
      await client.callNative("status", {}, { timeoutMs: 5_000 });
      return true;
    } finally {
      client.close("Gateway address repair verification completed");
    }
  },
  checkHealth: async (address: string, port: number) => {
    const response = await fetch(`http://${address}:${port}/healthz`, {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(2_000)
    });
    return response.ok;
  }
};

export async function inspectGatewayBindRecovery(
  dependencies = defaultDependencies,
  env: GatewayLifecycleEnvironment = process.env
): Promise<Exclude<GatewayBindRecoveryStatus, { state: "owner-required" }>> {
  const target = resolveGatewayRuntimeIdentity({ env });
  const url = new URL(target.gatewayUrl);
  if (target.deploymentMode !== "local" || target.managementStrategy !== "openclaw-service" ||
      url.protocol !== "ws:" || !isLoopbackHost(url.host)) {
    return { state: "none" };
  }

  const result = offlineStatus.safeParse(await dependencies.readStatus());
  if (!result.success) return { state: "none" };
  const { config, gateway, port, service } = result.data;
  const previousAddress = gateway.customBindHost;
  if (path.resolve(config.cli.path) !== path.resolve(config.daemon.path) ||
      path.resolve(config.cli.path) !== target.configPath ||
      gateway.port !== port.port || port.port !== resolveGatewayPort(target.gatewayUrl, env) ||
      !isPrivateIpv4(previousAddress)) {
    return { state: "none" };
  }

  const interfaces = Object.values(dependencies.interfaces()).flatMap((entries) => entries ?? []);
  if (interfaces.some((entry) => entry.address === previousAddress)) return { state: "none" };
  const [mode, bind, confirmedAddress] = await Promise.all([
    dependencies.readConfig("gateway.mode"), dependencies.readConfig("gateway.bind"), dependencies.readConfig(bindKey)
  ]);
  if (mode !== "local" || bind !== "custom" || confirmedAddress !== previousAddress) return { state: "none" };

  const candidates = new Set(interfaces.filter((entry) =>
    !entry.internal && entry.family === "IPv4" && isPrivateIpv4(entry.address) &&
    isIPv4(entry.netmask) && entry.netmask !== "0.0.0.0" &&
    (ipv4Number(entry.address) & ipv4Number(entry.netmask)) ===
      (ipv4Number(previousAddress) & ipv4Number(entry.netmask))
  ).map((entry) => entry.address));
  const [nextAddress] = candidates;

  if (candidates.size !== 1) {
    return { state: "manual", previousAddress, reason: "ambiguous-network" };
  }
  const authMode = await dependencies.readConfig("gateway.auth.mode").catch(() => null);
  const launchArgs = service.command?.programArguments;
  if ((authMode !== "token" && authMode !== "password") || !launchArgs?.length ||
      launchArgs.some((arg) => arg === "--auth" || arg.startsWith("--auth="))) {
    return { state: "manual", previousAddress, reason: "unsupported-auth" };
  }
  return { state: "repairable", plan: { previousAddress, nextAddress, port: port.port } };
}

export async function repairGatewayBindAddress(
  confirmation: GatewayBindRepairPlan,
  dependencies = defaultDependencies,
  env: GatewayLifecycleEnvironment = process.env
): Promise<GatewayBindRepairResult> {
  if (repairInProgress) return { outcome: "busy" };
  repairInProgress = true;
  try {
    const current = await inspectGatewayBindRecovery(dependencies, env);
    if (current.state !== "repairable" || current.plan.previousAddress !== confirmation.previousAddress ||
        current.plan.nextAddress !== confirmation.nextAddress || current.plan.port !== confirmation.port) {
      return { outcome: "stale" };
    }

    const { plan } = current;
    try {
      await dependencies.save(plan);
    } catch {
      // A timed-out CLI can have written the file. Never retry or restart on an uncertain write.
      return { outcome: "write-unverified" };
    }

    await dependencies.restart().catch(() => null);
    const addressStillAssigned = Object.values(dependencies.interfaces()).some((entries) =>
      entries?.some((entry) => entry.address === plan.nextAddress)
    );
    if (!addressStillAssigned) return { outcome: "saved", plan };
    const [local, lan] = await Promise.all([
      dependencies.checkHealth("127.0.0.1", plan.port).catch(() => false),
      dependencies.checkHealth(plan.nextAddress, plan.port).catch(() => false)
    ]);
    if (!local || !lan) return { outcome: "saved", plan };
    const native = await dependencies.verifyNative().catch(() => false);
    return { outcome: native ? "recovered" : "listening", plan };
  } finally {
    repairInProgress = false;
  }
}

function ipv4Number(value: string) {
  return value.split(".").reduce((address, part) => (address << 8) | Number(part), 0);
}

function isPrivateIpv4(value: string) {
  if (!isIPv4(value)) return false;
  const [first, second] = value.split(".").map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}
