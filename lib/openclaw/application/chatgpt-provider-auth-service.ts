import "server-only";

import { spawn } from "node:child_process";

import {
  buildOpenClawSpawnEnv,
  resolveOpenClawSpawnInvocation
} from "@/lib/openclaw/install";
import { resolveOpenClawBin, runOpenClaw } from "@/lib/openclaw/cli";
import { readOpenClawCodexPluginReady } from "@/lib/openclaw/application/model-provider-state-service";
import { getOpenClawLifecycleService } from "@/lib/openclaw/lifecycle/service";

const chatGptAuthTimeoutMs = 6 * 60_000;
const pluginSetupTimeoutMs = 2 * 60_000;

type ChatGptProviderAuthDependencies = {
  platform: NodeJS.Platform;
  readPluginReady: () => Promise<boolean>;
  runSetupCommand: (args: string[], timeoutMs: number) => Promise<void>;
  runInteractiveLogin: (input: {
    force: boolean;
    signal?: AbortSignal;
  }) => Promise<void>;
};

export type ChatGptProviderAuthResult = {
  pluginInstalled: boolean;
  authMode: "openclaw-cli-interactive";
};

const defaultDependencies: ChatGptProviderAuthDependencies = {
  platform: process.platform,
  readPluginReady: async () => await readOpenClawCodexPluginReady(),
  runSetupCommand: async (args, timeoutMs) => {
    if (args[0] === "gateway" && args[1] === "restart") {
      await getOpenClawLifecycleService().restart();
      return;
    }
    await runOpenClaw(args, { timeoutMs });
  },
  runInteractiveLogin: runOpenClawChatGptInteractiveLogin
};

/**
 * Runs OpenClaw's official provider-auth flow without handing a shell command to
 * the operator. The current OpenClaw Gateway contract does not expose OAuth
 * start through Gateway, so this remains an explicit, isolated CLI fallback at
 * the application boundary.
 */
export async function connectOpenClawChatGptProvider(
  input: {
    force?: boolean;
    signal?: AbortSignal;
  } = {},
  dependencies: ChatGptProviderAuthDependencies = defaultDependencies
): Promise<ChatGptProviderAuthResult> {
  if (dependencies.platform !== "darwin") {
    throw new Error(
      "In-app ChatGPT sign-in currently requires local AgentOS on macOS. OpenClaw does not expose provider OAuth through Gateway yet."
    );
  }

  let pluginInstalled = false;
  const pluginReady = await dependencies.readPluginReady().catch(() => false);

  if (!pluginReady) {
    await dependencies.runSetupCommand(
      ["plugins", "install", "--force", "@openclaw/codex"],
      pluginSetupTimeoutMs
    );
    await dependencies.runSetupCommand(["gateway", "restart"], pluginSetupTimeoutMs);
    pluginInstalled = true;
  }

  await dependencies.runInteractiveLogin({
    force: input.force === true,
    signal: input.signal
  });

  return {
    pluginInstalled,
    authMode: "openclaw-cli-interactive"
  };
}

async function runOpenClawChatGptInteractiveLogin(input: {
  force: boolean;
  signal?: AbortSignal;
}) {
  const openClawBin = await resolveOpenClawBin();
  const args = [
    "models",
    "auth",
    "login",
    "--provider",
    "openai",
    ...(input.force ? ["--force"] : []),
    "--set-default"
  ];
  const invocation = resolveOpenClawSpawnInvocation(openClawBin, args);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "/usr/bin/script",
      ["-q", "/dev/null", invocation.command, ...invocation.args],
      {
        detached: true,
        env: buildOpenClawSpawnEnv(),
        stdio: ["ignore", "ignore", "ignore"],
        windowsHide: true
      }
    );
    let settled = false;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const terminate = (signal: NodeJS.Signals) => {
      if (child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {}
      }
      child.kill(signal);
    };
    const cleanup = (preserveKillTimer = false) => {
      clearTimeout(timeout);
      if (killTimer && !preserveKillTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      input.signal?.removeEventListener("abort", handleAbort);
    };
    const finish = (handler: () => void, preserveKillTimer = false) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup(preserveKillTimer);
      handler();
    };
    const stop = () => {
      terminate("SIGTERM");
      killTimer = setTimeout(() => terminate("SIGKILL"), 2_000);
      killTimer.unref();
    };
    const handleAbort = () => {
      stop();
      finish(() => reject(new Error("ChatGPT sign-in was cancelled.")), true);
    };
    const timeout = setTimeout(() => {
      stop();
      finish(
        () => reject(new Error("ChatGPT sign-in timed out. Close any stale authorization tab and try again.")),
        true
      );
    }, chatGptAuthTimeoutMs);

    if (input.signal?.aborted) {
      handleAbort();
      return;
    }
    input.signal?.addEventListener("abort", handleAbort, { once: true });

    child.once("error", () => {
      finish(() => reject(new Error("OpenClaw could not start the in-app ChatGPT sign-in flow.")));
    });
    child.once("exit", (code, signal) => {
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      if (settled) {
        return;
      }
      if (code === 0) {
        finish(resolve);
        return;
      }
      finish(() => reject(new Error(
        signal
          ? "ChatGPT sign-in was interrupted before OpenClaw saved the account."
          : "OpenClaw did not complete ChatGPT sign-in. Close any stale authorization tab and try again."
      )));
    });
  });
}
