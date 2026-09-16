import "server-only";

import process from "node:process";
import { setImmediate as scheduleImmediate } from "node:timers";

export const AGENTOS_LAUNCHER_PID_ENV = "AGENTOS_LAUNCHER_PID" as const;
export const AGENTOS_RUNTIME_SHUTDOWN_MESSAGE = "agentos:full-uninstall-shutdown" as const;

type RuntimeShutdownMessage = {
  type: typeof AGENTOS_RUNTIME_SHUTDOWN_MESSAGE;
  reason: "full-uninstall";
};

type RuntimeShutdownSend = (
  message: RuntimeShutdownMessage,
  callback?: (error?: Error | null) => void
) => boolean | void;

export type RuntimeShutdownDependencies = {
  env?: NodeJS.ProcessEnv;
  pid?: number;
  send?: RuntimeShutdownSend;
  kill?: (pid: number, signal: NodeJS.Signals) => void;
  waitForResponseFlush?: () => Promise<void>;
};

export type RuntimeShutdownResult = {
  requested: true;
  mode: "launcher-ipc" | "self-signal";
  launcherPid: number | null;
};

/**
 * Requests the narrow, Full Uninstall-only runtime shutdown boundary.
 * The caller must invoke this after the response body has been closed.
 */
export async function requestAgentOsRuntimeShutdown(
  options: RuntimeShutdownDependencies = {}
): Promise<RuntimeShutdownResult> {
  await (options.waitForResponseFlush ?? waitForResponseFlush)();

  const currentPid = options.pid ?? process.pid;
  const launcherPid = parsePositivePid((options.env ?? process.env)[AGENTOS_LAUNCHER_PID_ENV]);
  const send = options.send ?? resolveProcessSend();

  if (launcherPid && launcherPid !== currentPid && send && await sendShutdownRequest(send)) {
    return {
      requested: true,
      mode: "launcher-ipc",
      launcherPid
    };
  }

  (options.kill ?? ((pid, signal) => process.kill(pid, signal)))(currentPid, "SIGTERM");

  return {
    requested: true,
    mode: "self-signal",
    launcherPid
  };
}

function resolveProcessSend(): RuntimeShutdownSend | null {
  const processWithIpc = process as NodeJS.Process & {
    send?: RuntimeShutdownSend;
  };

  return typeof processWithIpc.send === "function" ? processWithIpc.send.bind(processWithIpc) : null;
}

function sendShutdownRequest(send: RuntimeShutdownSend) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (sent: boolean) => {
      if (settled) return;
      settled = true;
      resolve(sent);
    };

    try {
      const accepted = send(
        {
          type: AGENTOS_RUNTIME_SHUTDOWN_MESSAGE,
          reason: "full-uninstall"
        },
        (error) => finish(!error)
      );
      if (accepted === false) finish(false);
    } catch {
      finish(false);
    }
  });
}

function waitForResponseFlush() {
  return new Promise<void>((resolve) => {
    scheduleImmediate(resolve);
  });
}

function parsePositivePid(value: string | undefined) {
  if (!value || !/^\d+$/.test(value.trim())) return null;
  const pid = Number(value);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}
