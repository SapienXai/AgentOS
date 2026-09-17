import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import type { ChildProcess } from "node:child_process";

const AGENTOS_PACKAGE = "@sapienx/agentos";
const AGENTOS_ENTRY = path.join("bin", "agentos.js");
const SIGNAL_EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = {
  SIGHUP: 129,
  SIGINT: 130,
  SIGQUIT: 131,
  SIGTERM: 143
};
const FORWARDED_SIGNALS: readonly NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGQUIT"];

export type AgentOsTarget = {
  command: string;
  argsPrefix: readonly string[];
  source: "explicit" | "installed-package" | "path";
};

export type AgentOsStartOptions = {
  host?: string;
  open?: boolean;
  plain?: boolean;
  port?: string;
};

export type AgentOsStatusOptions = Pick<AgentOsStartOptions, "host" | "port">;

export type AgentOsDoctorOptions = AgentOsStatusOptions & {
  deep?: boolean;
  json?: boolean;
};

export function buildAgentOsStartArgs(options: AgentOsStartOptions, open = false): string[] {
  const args = ["start"];

  appendValue(args, "--port", options.port);
  appendValue(args, "--host", options.host);

  if (open || options.open) args.push("--open");
  if (options.plain) args.push("--plain");

  return args;
}

export function buildAgentOsStatusArgs(options: AgentOsStatusOptions): string[] {
  const args = ["status"];

  appendValue(args, "--port", options.port);
  appendValue(args, "--host", options.host);

  return args;
}

export function buildAgentOsDoctorArgs(options: AgentOsDoctorOptions): string[] {
  const args = ["doctor"];

  if (options.deep) args.push("--deep");
  if (options.json) args.push("--json");
  appendValue(args, "--port", options.port);
  appendValue(args, "--host", options.host);

  return args;
}

export function resolveAgentOsTarget(env: NodeJS.ProcessEnv = process.env): AgentOsTarget | null {
  const explicitPath = env.AGENTOS_BIN?.trim();
  if (explicitPath) return resolveFileTarget(explicitPath, "explicit");

  const installedPackageTarget = resolveInstalledPackageTarget();
  if (installedPackageTarget) return installedPackageTarget;

  return resolvePathTarget(env.PATH);
}

export async function runAgentOsCommand(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env
): Promise<number> {
  const target = resolveAgentOsTarget(env);

  if (!target) {
    console.error(
      env.AGENTOS_BIN
        ? "AgentOS CLI is unavailable: AGENTOS_BIN does not point to a usable executable."
        : "AgentOS CLI is unavailable. Install @sapienx/agentos or set AGENTOS_BIN to an absolute executable path."
    );
    return 127;
  }

  const child = spawn(target.command, [...target.argsPrefix, ...args], {
    env,
    shell: false,
    stdio: "inherit"
  });

  return waitForChild(child);
}

function appendValue(args: string[], flag: string, value: string | undefined): void {
  if (typeof value !== "string" || value.trim() === "") return;
  args.push(flag, value);
}

function resolveInstalledPackageTarget(): AgentOsTarget | null {
  try {
    const require = createRequire(import.meta.url);
    const packageJsonPath = require.resolve(`${AGENTOS_PACKAGE}/package.json`);
    const entryPath = path.resolve(path.dirname(packageJsonPath), AGENTOS_ENTRY);
    return isRegularFile(entryPath)
      ? { command: process.execPath, argsPrefix: [entryPath], source: "installed-package" }
      : null;
  } catch {
    return null;
  }
}

function resolvePathTarget(pathValue: string | undefined): AgentOsTarget | null {
  if (!pathValue) return null;

  const executableNames = process.platform === "win32"
    ? ["agentos.exe", "agentos.cmd", "agentos.bat", "agentos"]
    : ["agentos"];

  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;

    for (const name of executableNames) {
      const target = resolveFileTarget(path.join(directory, name), "path");
      if (target) return target;
    }
  }

  return null;
}

function resolveFileTarget(filePath: string, source: AgentOsTarget["source"]): AgentOsTarget | null {
  if (!path.isAbsolute(filePath) || !isUsableFile(filePath)) return null;

  if (path.extname(filePath).toLowerCase() === ".js") {
    return { command: process.execPath, argsPrefix: [filePath], source };
  }

  return { command: filePath, argsPrefix: [], source };
}

function isRegularFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isUsableFile(filePath: string): boolean {
  try {
    const stat = statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform === "win32") return true;
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function waitForChild(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    let settled = false;

    const forwardSignal = (signal: NodeJS.Signals) => {
      child.kill(signal);
    };

    const cleanup = () => {
      for (const signal of FORWARDED_SIGNALS) process.removeListener(signal, forwardSignal);
    };

    const settle = (code: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(code);
    };

    for (const signal of FORWARDED_SIGNALS) process.on(signal, forwardSignal);

    child.once("error", () => settle(127));
    child.once("close", (code, signal) => {
      if (typeof code === "number") {
        settle(code);
        return;
      }

      settle(signal ? SIGNAL_EXIT_CODES[signal] ?? 1 : 1);
    });
  });
}
