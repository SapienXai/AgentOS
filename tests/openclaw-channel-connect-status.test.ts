import assert from "node:assert/strict";
import { test } from "node:test";

import type { ChannelAccountRecord } from "@/lib/openclaw/types";
import { normalizeChannelConnectAccounts } from "@/lib/openclaw/domains/channel-connect-status";

const configAccount: ChannelAccountRecord = {
  id: "support",
  accountId: "support",
  type: "whatsapp",
  name: "Support",
  enabled: true,
  configured: true,
  isDefault: true
};

test("config-only WhatsApp accounts do not imply authentication is required", () => {
  const accounts = normalizeChannelConnectAccounts(null, "whatsapp", [configAccount]);

  assert.equal(accounts.length, 1);
  assert.equal(accounts[0]?.accountId, "support");
  assert.equal(accounts[0]?.authenticationRequired, false);
  assert.equal(accounts[0]?.liveStatusAvailable, false);
});

test("config-only default WhatsApp accounts remain configured without live auth claims", () => {
  const accounts = normalizeChannelConnectAccounts(null, "whatsapp", [configAccount]);

  assert.equal(accounts[0]?.isDefault, true);
  assert.equal(accounts[0]?.configured, true);
  assert.equal(accounts[0]?.authenticationRequired, false);
});

test("live WhatsApp auth evidence is preserved while linked stopped accounts stay non-authenticated", () => {
  const unlinked = normalizeChannelConnectAccounts(
    channelStatus("whatsapp", { configured: true, linked: false, running: false, connected: false }),
    "whatsapp",
    []
  )[0];
  const linkedStopped = normalizeChannelConnectAccounts(
    channelStatus("whatsapp", { configured: true, linked: true, running: false, connected: false }),
    "whatsapp",
    []
  )[0];

  assert.equal(unlinked?.authenticationRequired, true);
  assert.equal(unlinked?.liveStatusAvailable, true);
  assert.equal(linkedStopped?.authenticationRequired, false);
  assert.equal(linkedStopped?.linked, true);
});

test("partial live WhatsApp data stays unknown instead of manufacturing auth failure", () => {
  const account = normalizeChannelConnectAccounts(
    channelStatus("whatsapp", { configured: true }),
    "whatsapp",
    []
  )[0];

  assert.equal(account?.authenticationRequired, false);
  assert.equal(account?.liveStatusAvailable, true);
});

test("Telegram account normalization remains independent of WhatsApp auth inference", () => {
  const account = normalizeChannelConnectAccounts(
    channelStatus("telegram", { configured: true, linked: false, running: false, connected: false }),
    "telegram",
    []
  )[0];

  assert.equal(account?.authenticationRequired, false);
  assert.equal(account?.accountId, "support");
});

function channelStatus(provider: "whatsapp" | "telegram", account: {
  configured?: boolean;
  linked?: boolean;
  running?: boolean;
  connected?: boolean;
}) {
  return {
    ts: 1,
    channelOrder: [provider],
    channelLabels: {},
    channels: {},
    channelAccounts: {
      [provider]: [{ accountId: "support", ...account }]
    },
    channelDefaultAccountId: { [provider]: "support" }
  };
}
