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
      agents?: { defaults?: { model?: string | { primary?: string } } };
    };
    const model = config.agents?.defaults?.model;
    const defaultModelId = typeof model === "string" ? model.trim() : model?.primary?.trim();
    return { checked: true, defaultModelId: defaultModelId || null };
  } catch {
    return { checked: true, defaultModelId: null };
  }
}
