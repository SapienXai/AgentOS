import "server-only";

import os from "node:os";
import path from "node:path";

import { resolveAgentOsMissionControlRoot } from "@/lib/agentos/runtime-storage";

export const missionControlRootPath = resolveAgentOsMissionControlRoot(process.env, /*turbopackIgnore: true*/ process.cwd());
export const channelRegistryPath = path.join(missionControlRootPath, "channel-registry.json");

export function getOpenClawStateRootPath() {
  return path.resolve(process.env.OPENCLAW_STATE_DIR?.trim() || path.join(os.homedir(), ".openclaw"));
}

export const openClawStateRootPath = getOpenClawStateRootPath();
