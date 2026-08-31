import { spawn } from "node:child_process";
import net from "node:net";
import { redactSecretText } from "@/lib/security/redaction";
import { certifyOpenClawMigrationRuntime } from "@/lib/openclaw/migration-engine/certification";
import type {
  OpenClawMigrationCommandResult,
  OpenClawMigrationRuntimeHooks
} from "@/lib/openclaw/migration-engine/types";

export const DEFAULT_MIGRATION_COMMAND_TIMEOUT_MS = 120_000;

export function createDefaultMigrationRuntimeHooks(): OpenClawMigrationRuntimeHooks {
  return {
    runCommand: runOpenClawMigrationCommand,
    gateway: { start: startMigrationGateway },
    certify: async ({ gatewayUrl, token, phase, expectedVersion, expectedCommit, existingSessionKey }) => {
      if (!token) throw new Error("A Gateway token is required for migration runtime certification.");
      return certifyOpenClawMigrationRuntime({ gatewayUrl, token, phase, expectedVersion, expectedCommit, existingSessionKey });
    }
  };
}

async function startMigrationGateway(input: {
  binaryPath: string;
  stateDir: string;
  configPath: string;
  port: number;
  token: string;
  phase?: "staged" | "canonical" | "rollback";
}) {
  const child = spawn(process.execPath, [
    input.binaryPath,
    "gateway",
    "run",
    "--port",
    String(input.port),
    "--bind",
    "loopback",
    "--allow-unconfigured",
    "--ws-log",
    "compact",
    "--no-color"
  ], {
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: input.stateDir,
      OPENCLAW_CONFIG_PATH: input.configPath,
      OPENCLAW_GATEWAY_TOKEN: input.token
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-4_000); });
  child.stderr?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-4_000); });
  let exited = false;
  child.once("close", () => { exited = true; });
  try {
    await waitForLoopbackPort(input.port, () => exited, 30_000);
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(`${error instanceof Error ? error.message : String(error)} ${redactSecretText(output).trim()}`.trim());
  }
  return {
    pid: child.pid ?? -1,
    isRunning: () => !exited && child.exitCode === null,
    stop: async () => {
      if (exited || child.exitCode !== null) return;
      child.kill("SIGTERM");
      await waitForChildClose(child, 3_000);
      if (!exited && child.exitCode === null) {
        child.kill("SIGKILL");
        await waitForChildClose(child, 3_000);
      }
      if (!exited && child.exitCode === null) throw new Error("Migration Gateway process did not exit after SIGKILL.");
    }
  };
}

function waitForChildClose(child: ReturnType<typeof spawn>, timeoutMs: number) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export async function runOpenClawMigrationCommand(input: {
  binaryPath: string;
  args: string[];
  env: Record<string, string | undefined>;
  cwd?: string;
  timeoutMs?: number;
}): Promise<OpenClawMigrationCommandResult> {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [input.binaryPath, ...input.args], {
      cwd: input.cwd,
      env: { ...process.env, ...input.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 2_000).unref();
    }, input.timeoutMs ?? DEFAULT_MIGRATION_COMMAND_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout = limitOutput(`${stdout}${chunk.toString()}`);
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr = limitOutput(`${stderr}${chunk.toString()}`);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        command: process.execPath,
        args: [input.binaryPath, ...input.args],
        exitCode,
        signal,
        stdout: redactSecretText(stdout),
        stderr: redactSecretText(stderr),
        durationMs: Date.now() - startedAt
      });
    });
  });
}

export function parseJsonCommandOutput<T>(result: OpenClawMigrationCommandResult): T | null {
  const candidates = [result.stdout, result.stderr]
    .flatMap((output) => [output.trim(), ...output.split(/\r?\n/).map((line) => line.trim())])
    .filter(Boolean);
  for (const candidate of candidates.reverse()) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // OpenClaw may print advisory lines before JSON; keep looking.
    }
  }
  return null;
}

function limitOutput(value: string) {
  return value.length > 32_000 ? value.slice(-32_000) : value;
}

async function waitForLoopbackPort(port: number, hasExited: () => boolean, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (hasExited()) throw new Error(`Target Gateway exited before listening on port ${port}.`);
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Target Gateway did not listen on loopback port ${port}.`);
}
