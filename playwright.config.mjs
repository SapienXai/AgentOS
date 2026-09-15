import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

const fixtureRoot = path.join(os.tmpdir(), `agentos-channels-browser-${process.pid}`);
const port = process.env.AGENTOS_PLAYWRIGHT_PORT ?? "3177";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: "**/*.spec.mjs",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    browserName: "chromium",
    headless: true,
    trace: "off",
    screenshot: "off",
    video: "off"
  },
  webServer: {
    command: `pnpm dev --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/mission-control`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      NODE_ENV: "development",
      AGENTOS_RUNTIME_DIR: path.join(fixtureRoot, "agentos"),
      OPENCLAW_STATE_DIR: path.join(fixtureRoot, "openclaw"),
      OPENCLAW_CONFIG_PATH: path.join(fixtureRoot, "openclaw", "openclaw.json"),
      AGENTOS_API_TOKEN: "",
      AGENTOS_UNSAFE_DISABLE_API_AUTH: ""
    }
  }
});
