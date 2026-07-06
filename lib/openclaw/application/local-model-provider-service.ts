import "server-only";

import { spawn } from "node:child_process";

import { parseOllamaListModelNames } from "@/lib/openclaw/domains/model-provider-catalog";

export type LocalProviderProbeSource = "local-runtime";

export interface LocalOllamaState {
  installed: boolean;
  models: string[];
  source: LocalProviderProbeSource;
  degraded: boolean;
  warning: string | null;
}

const ollamaListTimeoutMs = 5_000;

export async function readLocalOllamaModels(): Promise<LocalOllamaState> {
  const output = await runLocalOllamaList().catch((error) => {
    const message = error instanceof Error ? error.message : String(error || "");

    if (/spawn|not found|enoent/i.test(message)) {
      return null;
    }

    return "";
  });

  if (output === null) {
    return {
      installed: false,
      models: [],
      source: "local-runtime",
      degraded: true,
      warning: "Ollama was probed locally because OpenClaw did not return a usable Ollama model catalog."
    };
  }

  return {
    installed: true,
    models: parseOllamaListModelNames(output),
    source: "local-runtime",
    degraded: true,
    warning: "Ollama models were read from the local Ollama runtime fallback."
  };
}

function runLocalOllamaList() {
  return new Promise<string>((resolve, reject) => {
    const child = spawn("ollama", ["list"], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timer = globalThis.setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Timed out while running ollama list."));
    }, ollamaListTimeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      globalThis.clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      globalThis.clearTimeout(timer);
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(stderr.trim() || `ollama list exited with code ${code ?? "unknown"}.`));
    });
  });
}
