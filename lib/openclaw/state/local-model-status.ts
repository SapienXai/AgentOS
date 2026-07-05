import "server-only";

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function probeLocalDefaultModel(options: {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
} = {}) {
  const env = options.env ?? process.env;
  const stateRoot = env.OPENCLAW_STATE_DIR?.trim()
    || path.join(options.homeDir ?? os.homedir(), ".openclaw");

  try {
    const config = JSON.parse(await readFile(path.join(stateRoot, "openclaw.json"), "utf8")) as {
      agents?: {
        defaults?: {
          model?: string | { primary?: string };
          models?: Record<string, unknown>;
        };
      };
    };
    const model = config.agents?.defaults?.model;
    const defaultModelId = typeof model === "string" ? model.trim() : model?.primary?.trim();
    const configuredModelIds = config.agents?.defaults?.models
      && typeof config.agents.defaults.models === "object"
      && !Array.isArray(config.agents.defaults.models)
      ? Object.keys(config.agents.defaults.models)
      : [];
    const modelIds = Array.from(
      new Set([defaultModelId, ...configuredModelIds].map((modelId) => modelId?.trim()).filter(Boolean))
    ) as string[];
    return { checked: true, defaultModelId: defaultModelId || null, modelIds };
  } catch {
    return { checked: true, defaultModelId: null, modelIds: [] as string[] };
  }
}
