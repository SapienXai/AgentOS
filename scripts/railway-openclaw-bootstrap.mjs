import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const defaultConfigPath = "/data/openclaw/openclaw.json";
const defaultBrowserPolicyPluginPath = "/agentos/openclaw-plugins/agentos-browser-policy";

/**
 * Creates only the durable Gateway baseline required for a new Railway volume.
 *
 * Deliberately do not seed a provider, auth profile, model catalog entry, or
 * default model here. OpenClaw must stay unable to dispatch an agent turn until
 * the operator connects a provider and explicitly selects a model in AgentOS.
 */
export async function bootstrapRailwayOpenClawConfig(env = process.env) {
  const configPath = env.OPENCLAW_CONFIG_PATH?.trim() || defaultConfigPath;
  const pluginPath =
    env.AGENTOS_BROWSER_POLICY_PLUGIN_PATH?.trim() ||
    defaultBrowserPolicyPluginPath;

  await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });

  try {
    await writeFile(
      configPath,
      `${JSON.stringify({
        gateway: {
          mode: "local",
          auth: {
            mode: "token"
          }
        },
        agents: {
          defaults: {
            models: {}
          }
        }
      }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" }
    );
    await chmod(configPath, 0o600);
    await ensureBrowserPolicyPluginConfig(configPath, pluginPath);
    return { created: true, configPath };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      await ensureBrowserPolicyPluginConfig(configPath, pluginPath);
      return { created: false, configPath };
    }

    throw error;
  }
}

async function ensureBrowserPolicyPluginConfig(configPath, pluginPath) {
  const parsed = JSON.parse(await readFile(configPath, "utf8"));
  const config = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  const plugins =
    config.plugins && typeof config.plugins === "object" && !Array.isArray(config.plugins)
      ? config.plugins
      : {};
  const load =
    plugins.load && typeof plugins.load === "object" && !Array.isArray(plugins.load)
      ? plugins.load
      : {};
  const entries =
    plugins.entries && typeof plugins.entries === "object" && !Array.isArray(plugins.entries)
      ? plugins.entries
      : {};
  const currentPaths = Array.isArray(load.paths)
    ? load.paths.filter((entry) => typeof entry === "string" && entry.trim())
    : [];
  const nextConfig = {
    ...config,
    plugins: {
      ...plugins,
      load: {
        ...load,
        paths: [...new Set([...currentPaths, pluginPath])]
      },
      entries: {
        ...entries,
        "agentos-browser-policy": {
          ...(entries["agentos-browser-policy"] &&
          typeof entries["agentos-browser-policy"] === "object" &&
          !Array.isArray(entries["agentos-browser-policy"])
            ? entries["agentos-browser-policy"]
            : {}),
          enabled: true
        }
      }
    }
  };

  if (JSON.stringify(nextConfig) === JSON.stringify(config)) return;
  const tempPath = `${configPath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(nextConfig, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  await rename(tempPath, configPath);
  await chmod(configPath, 0o600);
}
