import assert from "node:assert/strict";
import { test } from "node:test";

import { inferProviderCapabilities } from "@/lib/openclaw/application/channel-center-service";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type { OpenClawChannelStatusPayload } from "@/lib/openclaw/client/types";

function runtime(overrides: Partial<Parameters<typeof inferProviderCapabilities>[3]> = {}) {
  return {
    adapter: {
      startChannel: async () => ({ started: true }),
      stopChannel: async () => ({ stopped: true }),
      logoutChannel: async () => ({ loggedOut: true })
    } as unknown as OpenClawAdapter,
    nativeBindingsAvailable: true,
    telegramConfig: {
      accounts: {
        main: {
          groups: {
            "-1001": { topics: { "10": { agentId: "reservations" } } }
          }
        }
      }
    },
    ...overrides
  } satisfies Parameters<typeof inferProviderCapabilities>[3];
}

function statusFor(provider: string, accountIds: string[] = []): OpenClawChannelStatusPayload {
  return {
    ts: 1,
    channelOrder: [provider],
    channelLabels: { [provider]: provider },
    channels: { [provider]: {} },
    channelAccounts: {
      [provider]: accountIds.map((accountId) => ({ accountId, configured: true, running: false }))
    },
    channelDefaultAccountId: { [provider]: accountIds[0] ?? null }
  };
}

test("Telegram capability projection uses runtime operations and native topic config", () => {
  const capabilities = inferProviderCapabilities(
    statusFor("telegram", ["main", "support"]),
    "telegram",
    [{ id: "telegram", channelIds: ["telegram"], enabled: true }],
    runtime(),
    "bot-token"
  );

  assert.equal(capabilities.supportsAccounts, true);
  assert.equal(capabilities.supportsMultiAccount, true);
  assert.equal(capabilities.supportsStart, true);
  assert.equal(capabilities.supportsStop, true);
  assert.equal(capabilities.supportsRestart, true);
  assert.equal(capabilities.supportsLogout, true);
  assert.equal(capabilities.supportsTokenSetup, true);
  assert.equal(capabilities.supportsDirectoryGroups, true);
  assert.equal(capabilities.supportsTopics, true);
  assert.equal(capabilities.supportsNativeBindings, true);
});

test("a discovered provider does not inherit token or lifecycle actions from a static catalog", () => {
  const capabilities = inferProviderCapabilities(
    statusFor("future-chat", []),
    "future-chat",
    [{ id: "future-chat", channelIds: ["future-chat"], enabled: true }],
    runtime({
      adapter: {} as OpenClawAdapter,
      nativeBindingsAvailable: false,
      telegramConfig: null
    }),
    "external-cli"
  );

  assert.equal(capabilities.supportsAccounts, true);
  assert.equal(capabilities.supportsStart, false);
  assert.equal(capabilities.supportsStop, false);
  assert.equal(capabilities.supportsRestart, false);
  assert.equal(capabilities.supportsLogout, false);
  assert.equal(capabilities.supportsTokenSetup, false);
  assert.equal(capabilities.supportsDirectoryGroups, false);
  assert.equal(capabilities.supportsTopics, false);
  assert.equal(capabilities.supportsNativeBindings, false);
});

test("runtime-declared capabilities can enable setup without an AgentOS provider list", () => {
  const capabilities = inferProviderCapabilities(
    {
      ...statusFor("new-provider"),
      channels: { "new-provider": { capabilities: ["supportsTokenSetup", "supportsDirectoryGroups"] } }
    },
    "new-provider",
    [],
    runtime({
      adapter: {} as OpenClawAdapter,
      nativeBindingsAvailable: false,
      telegramConfig: null
    }),
    "external-cli"
  );

  assert.equal(capabilities.supportsTokenSetup, true);
  assert.equal(capabilities.supportsDirectoryGroups, true);
  assert.equal(capabilities.supportsAccounts, true);
});
