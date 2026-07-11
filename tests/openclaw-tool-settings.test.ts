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
    browser: { enabled: true, cdpPort: 9222 },
    tools: {
      existing: "preserved",
      web: {
        existing: "preserved",
        fetch: { enabled: true, maxChars: 5000 },
        search: { enabled: true, provider: "example" }
      }
    }
  }), "utf8");

  assert.deepEqual(await readOpenClawToolSettings({ homeDir, env: {} }), {
    browserEnabled: true,
    webFetchEnabled: true,
    webSearchEnabled: true,
    configPath
  });
  await updateOpenClawToolSettings({
    browserEnabled: false,
    webFetchEnabled: false,
    webSearchEnabled: false
  }, { homeDir, env: {} });

  const config = JSON.parse(await readFile(configPath, "utf8")) as {
    gateway: { mode: string };
    browser: { enabled: boolean; cdpPort: number };
    tools: {
      existing: string;
      web: {
        existing: string;
        fetch: { enabled: boolean; maxChars: number };
        search: { enabled: boolean; provider: string };
      };
    };
  };
  assert.deepEqual(config.gateway, { mode: "local" });
  assert.deepEqual(config.browser, { enabled: false, cdpPort: 9222 });
  assert.deepEqual(config.tools, {
    existing: "preserved",
    web: {
      existing: "preserved",
      fetch: { enabled: false, maxChars: 5000 },
      search: { enabled: false, provider: "example" }
    }
  });
});

test("missing browser config reads as disabled", async (context) => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "agentos-tool-settings-empty-"));
  context.after(() => rm(homeDir, { recursive: true, force: true }));

  const settings = await readOpenClawToolSettings({ homeDir, env: {} });
  assert.equal(settings.browserEnabled, false);
  assert.equal(settings.webFetchEnabled, false);
  assert.equal(settings.webSearchEnabled, false);
});
