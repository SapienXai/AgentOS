import assert from "node:assert/strict";
import { test } from "node:test";

import {
  connectOpenClawChatGptProvider,
  extractOpenAiAuthorizationUrl
} from "@/lib/openclaw/application/chatgpt-provider-auth-service";

test("ChatGPT browser auth extracts only the official OpenAI authorization URL", () => {
  const authorizationUrl = extractOpenAiAuthorizationUrl(
    "Open the following URL: \u001b[36mhttps://auth.openai.com/oauth/authorize?client_id=agentos&state=test\u001b[0m"
  );

  assert.equal(
    authorizationUrl,
    "https://auth.openai.com/oauth/authorize?client_id=agentos&state=test"
  );
  assert.equal(
    extractOpenAiAuthorizationUrl("https://evil.example/oauth/authorize?state=test"),
    null
  );
});

test("ChatGPT provider auth runs OpenClaw login directly when the Codex plugin is ready", async () => {
  const setupCalls: string[][] = [];
  const loginCalls: Array<{ force: boolean }> = [];

  const result = await connectOpenClawChatGptProvider(
    { force: true },
    {
      platform: "darwin",
      readPluginReady: async () => true,
      runSetupCommand: async (args) => {
        setupCalls.push(args);
      },
      runInteractiveLogin: async (input) => {
        loginCalls.push({ force: input.force });
      }
    }
  );

  assert.deepEqual(setupCalls, []);
  assert.deepEqual(loginCalls, [{ force: true }]);
  assert.deepEqual(result, {
    pluginInstalled: false,
    authMode: "openclaw-cli-interactive"
  });
});

test("ChatGPT provider auth installs and repairs the Codex plugin before login", async () => {
  const calls: string[] = [];

  const result = await connectOpenClawChatGptProvider(
    {},
    {
      platform: "darwin",
      readPluginReady: async () => false,
      runSetupCommand: async (args) => {
        calls.push(args.join(" "));
      },
      runInteractiveLogin: async (input) => {
        calls.push(`login force=${input.force}`);
      }
    }
  );

  assert.deepEqual(calls, [
    "plugins install --force @openclaw/codex",
    "doctor --fix",
    "gateway restart",
    "login force=false"
  ]);
  assert.equal(result.pluginInstalled, true);
});

test("ChatGPT provider auth fails honestly when in-app OAuth is unavailable", async () => {
  await assert.rejects(
    () => connectOpenClawChatGptProvider(
      {},
      {
        platform: "linux",
        readPluginReady: async () => true,
        runSetupCommand: async () => {},
        runInteractiveLogin: async () => {}
      }
    ),
    /requires local AgentOS on macOS/
  );
});
