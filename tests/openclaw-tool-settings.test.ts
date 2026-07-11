import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  readOpenClawToolSettings,
  updateOpenClawToolSettings
} from "@/lib/openclaw/application/tool-settings-service";

test("browser tool settings preserve unrelated OpenClaw config", async (context) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "agentos-tool-settings-"));
  context.after(() => rm(homeDir, { recursive: true, force: true }));
  const configDir = path.join(homeDir, ".openclaw");
  const configPath = path.join(configDir, "openclaw.json");
  await mkdir(configDir, { recursive: true });
  await writeFile(configPath, JSON.stringify({
    gateway: { mode: "local" },
    browser: { enabled: true, cdpPort: 9222 }
  }), "utf8");

  assert.equal((await readOpenClawToolSettings({ homeDir, env: {} })).browserEnabled, true);
  await updateOpenClawToolSettings({ browserEnabled: false }, { homeDir, env: {} });

  const config = JSON.parse(await readFile(configPath, "utf8")) as {
    gateway: { mode: string };
    browser: { enabled: boolean; cdpPort: number };
  };
  assert.deepEqual(config.gateway, { mode: "local" });
  assert.deepEqual(config.browser, { enabled: false, cdpPort: 9222 });
});

test("missing browser config reads as disabled", async (context) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "agentos-tool-settings-empty-"));
  context.after(() => rm(homeDir, { recursive: true, force: true }));

  const settings = await readOpenClawToolSettings({ homeDir, env: {} });
  assert.equal(settings.browserEnabled, false);
});
