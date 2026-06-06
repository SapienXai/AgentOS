import "server-only";

import path from "node:path";
import { readFile } from "node:fs/promises";

import type { AgentConfigPayload } from "@/lib/openclaw/client/gateway-client";

export async function settleAgentConfigFromStateFile(
  openClawStateRootPath: string
): Promise<PromiseSettledResult<AgentConfigPayload>> {
  try {
    const raw = await readFile(path.join(openClawStateRootPath, "openclaw.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      agents?: {
        list?: unknown;
      };
    };
    const list = parsed.agents?.list;

    return {
      status: "fulfilled",
      value: Array.isArray(list) ? (list as AgentConfigPayload) : []
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}

export async function settleConfiguredModelIdsFromStateFile(
  openClawStateRootPath: string
): Promise<PromiseSettledResult<string[]>> {
  try {
    const raw = await readFile(path.join(openClawStateRootPath, "openclaw.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      agents?: {
        defaults?: {
          models?: unknown;
          model?: {
            primary?: unknown;
          };
        };
      };
    };
    const configuredModels = parsed.agents?.defaults?.models;
    const configuredModelIds = configuredModels && typeof configuredModels === "object" && !Array.isArray(configuredModels)
      ? Object.keys(configuredModels)
      : [];
    const primaryModelId = typeof parsed.agents?.defaults?.model?.primary === "string"
      ? parsed.agents.defaults.model.primary
      : "";

    return {
      status: "fulfilled",
      value: Array.from(new Set([...configuredModelIds, primaryModelId].filter(Boolean)))
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}
