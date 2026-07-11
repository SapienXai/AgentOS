import "server-only";

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveLocalGatewayConfigPath } from "@/lib/openclaw/client/local-gateway-probe";

export type OpenClawToolSettings = {
  browserEnabled: boolean;
  webFetchEnabled: boolean;
  webSearchEnabled: boolean;
  configPath: string;
};

type ToolSettingsOptions = {
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
};

export async function readOpenClawToolSettings(
  options: ToolSettingsOptions = {}
): Promise<OpenClawToolSettings> {
  const configPath = resolveLocalGatewayConfigPath(options);
  const config = await readConfig(configPath);
  const browser = asRecord(config.browser);
  const tools = asRecord(config.tools);
  const web = asRecord(tools.web);
  const fetch = asRecord(web.fetch);
  const search = asRecord(web.search);

  return {
    browserEnabled: browser.enabled === true,
    webFetchEnabled: fetch.enabled === true,
    webSearchEnabled: search.enabled === true,
    configPath
  };
}

export async function updateOpenClawToolSettings(
  input: {
    browserEnabled: boolean;
    webFetchEnabled: boolean;
    webSearchEnabled: boolean;
  },
  options: ToolSettingsOptions = {}
): Promise<OpenClawToolSettings> {
  const configPath = resolveLocalGatewayConfigPath(options);
  const config = await readConfig(configPath);
  const browser = asRecord(config.browser);
  const tools = asRecord(config.tools);
  const web = asRecord(tools.web);
  const fetch = asRecord(web.fetch);
  const search = asRecord(web.search);

  config.browser = {
    ...browser,
    enabled: input.browserEnabled
  };
  config.tools = {
    ...tools,
    web: {
      ...web,
      fetch: {
        ...fetch,
        enabled: input.webFetchEnabled
      },
      search: {
        ...search,
        enabled: input.webSearchEnabled
      }
    }
  };

  await writeConfig(configPath, config);

  return {
    browserEnabled: input.browserEnabled,
    webFetchEnabled: input.webFetchEnabled,
    webSearchEnabled: input.webSearchEnabled,
    configPath
  };
}

async function readConfig(configPath: string): Promise<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
    return asRecord(parsed);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : null;
    if (code === "ENOENT") {
      return {};
    }
    throw new Error(`AgentOS could not read OpenClaw config at ${configPath}.`);
  }
}

async function writeConfig(configPath: string, config: Record<string, unknown>) {
  await mkdir(path.dirname(configPath), { recursive: true });
  const temporaryPath = `${configPath}.agentos-${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  await rename(temporaryPath, configPath);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}
