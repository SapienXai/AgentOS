import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

const fallbackAgentOsVersion = "0.7.2";

export async function resolveAgentOsVersion() {
  const packageJsonPath = path.join(process.cwd(), "packages", "agentos", "package.json");

  try {
    const parsed = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      version?: unknown;
    };

    return typeof parsed.version === "string" && parsed.version.trim()
      ? parsed.version.trim()
      : fallbackAgentOsVersion;
  } catch {
    return fallbackAgentOsVersion;
  }
}
