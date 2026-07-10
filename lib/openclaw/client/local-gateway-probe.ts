import "server-only";

import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type { GatewayStatusPayload } from "@/lib/openclaw/client/gateway-client";

export async function probeLocalGatewayStatus(port = 18789): Promise<GatewayStatusPayload | null> {
  const ready = await probeGatewayReadyEndpoint(port, 750);

  if (ready !== null) {
    return {
      service: {
        label: "Local readiness probe",
        loaded: true
      },
      gateway: {
        bindMode: "loopback",
        port,
        probeUrl: `ws://127.0.0.1:${port}`
      },
      rpc: {
        ok: ready,
        capability: ready ? "readyz" : "starting"
      }
    };
  }

  const reachable = await probeTcpPort("127.0.0.1", port, 400);

  if (!reachable) {
    return null;
  }

  return {
    service: {
      label: "Local port probe",
      loaded: true
    },
    gateway: {
      bindMode: "loopback",
      port,
      probeUrl: `ws://127.0.0.1:${port}`
    }
  };
}

export async function probeLocalGatewayRegistration(options: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
} = {}): Promise<boolean | null> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;

  if (platform === "darwin") {
    const profile = env.OPENCLAW_PROFILE?.trim();
    const label = env.OPENCLAW_LAUNCHD_LABEL?.trim()
      || (!profile || profile.toLowerCase() === "default" ? "ai.openclaw.gateway" : `ai.openclaw.${profile}`);
    const plistPath = path.join(options.homeDir ?? os.homedir(), "Library", "LaunchAgents", `${label}.plist`);

    try {
      await access(plistPath);
      return true;
    } catch {
      return false;
    }
  }

  if (platform !== "win32") {
    return null;
  }

  const executable = env.SystemRoot
    ? path.join(env.SystemRoot, "System32", "schtasks.exe")
    : "schtasks.exe";
  const taskName = env.OPENCLAW_WINDOWS_TASK_NAME?.trim() || "OpenClaw Gateway";

  return await new Promise<boolean>((resolve) => {
    let child;
    try {
      child = spawn(executable, ["/Query", "/TN", taskName], {
        stdio: "ignore",
        windowsHide: true
      });
    } catch {
      resolve(false);
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(false);
    }, 1_000);
    const finish = (registered: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(registered);
    };

    child.once("error", () => finish(false));
    child.once("exit", (code) => finish(code === 0));
  });
}

export async function probeLocalGatewayConfiguration(options: {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
} = {}) {
  const state = await readLocalGatewayConfiguration(options);
  return state.modeLocal && state.authTokenMode && state.hasToken;
}

export async function readLocalGatewayConfiguration(options: {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
} = {}) {
  const env = options.env ?? process.env;
  const stateDirOverride = env.OPENCLAW_STATE_DIR?.trim();
  const stateDir = stateDirOverride
    ? stateDirOverride.startsWith("~")
      ? path.join(options.homeDir ?? os.homedir(), stateDirOverride.slice(1))
      : stateDirOverride
    : path.join(options.homeDir ?? os.homedir(), ".openclaw");
  const configPath = env.OPENCLAW_CONFIG_PATH?.trim()
    || path.join(stateDir, "openclaw.json");

  try {
    const config = JSON.parse(await readFile(configPath, "utf8")) as {
      gateway?: { mode?: unknown; auth?: { mode?: unknown; token?: unknown } };
    };
    return {
      modeLocal: config.gateway?.mode === "local",
      authTokenMode: config.gateway?.auth?.mode === "token",
      hasToken: typeof config.gateway?.auth?.token === "string" && config.gateway.auth.token.trim().length > 0
    };
  } catch {
    return { modeLocal: false, authTokenMode: false, hasToken: false };
  }
}

async function probeGatewayReadyEndpoint(port: number, timeoutMs: number): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/readyz`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });

    if (response.ok) {
      const payload = await response.json().catch(() => null) as { ready?: boolean } | null;
      return payload?.ready !== false;
    }

    return response.status === 503 ? false : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probeTcpPort(host: string, port: number, timeoutMs: number) {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}
