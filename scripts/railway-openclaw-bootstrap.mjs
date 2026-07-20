import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const defaultConfigPath = "/data/openclaw/openclaw.json";

/**
 * Creates only the durable Gateway baseline required for a new Railway volume.
 *
 * Deliberately do not seed a provider, auth profile, model catalog entry, or
 * default model here. OpenClaw must stay unable to dispatch an agent turn until
 * the operator connects a provider and explicitly selects a model in AgentOS.
 */
export async function bootstrapRailwayOpenClawConfig(env = process.env) {
  const configPath = env.OPENCLAW_CONFIG_PATH?.trim() || defaultConfigPath;

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
    return { created: true, configPath };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      return { created: false, configPath };
    }

    throw error;
  }
}
