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
        entries?: unknown;
      };
    };
    const list = parsed.agents?.entries ?? parsed.agents?.list;

    return {
      status: "fulfilled",
      value: normalizeAgentConfigList(list)
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}

function normalizeAgentConfigList(value: unknown): AgentConfigPayload {
  if (Array.isArray(value)) {
    return value as AgentConfigPayload;
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([id, entry]) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return [];
    }

    return [{ ...(entry as Record<string, unknown>), id } as AgentConfigPayload[number]];
  });
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
