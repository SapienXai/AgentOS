import "server-only";

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Neutral OpenClaw state/config path and JSON helpers shared by the official
 * host adapter and the rollback transport. This module does not assemble a
 * Gateway connection or authenticate a WebSocket.
 */
export function resolveOpenClawStateDir(
  env: Readonly<Record<string, string | undefined>> = process.env
) {
  const override = env.OPENCLAW_STATE_DIR?.trim();
  if (override) {
    return expandHomePath(override);
  }

  return join(homedir(), ".openclaw");
}

export function resolveOpenClawConfigPath(
  env: Readonly<Record<string, string | undefined>> = process.env
) {
  const override = env.OPENCLAW_CONFIG_PATH?.trim();
  return override
    ? expandHomePath(override)
    : join(resolveOpenClawStateDir(env), "openclaw.json");
}

export function expandHomePath(value: string) {
  return value.startsWith("~") ? join(homedir(), value.slice(1)) : value;
}

export async function readJsonFile<TPayload>(path: string): Promise<TPayload | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as TPayload;
  } catch {
    return null;
  }
}
