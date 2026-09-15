import assert from "node:assert/strict";
import { test } from "node:test";

import {
  presentChannelAccountState,
  presentChannelLogoutResult
} from "@/lib/openclaw/domains/channel-account-presentation";

const base = {
  accountId: "main",
  configured: true,
  enabled: true,
  linked: true,
  running: false,
  connected: false,
  liveStatusAvailable: true,
  authenticationRequired: false,
  lastError: null,
  credentialState: "present" as const
};

test("account presentation distinguishes usable online, starting, ready, and stopped states", () => {
  assert.equal(presentChannelAccountState({ ...base, connected: true }).state, "ONLINE");
  assert.equal(presentChannelAccountState({ ...base, running: true }).state, "STARTING");
  assert.equal(presentChannelAccountState(base).state, "READY");
  assert.equal(presentChannelAccountState({ ...base, healthState: "stopped" }).state, "STOPPED");
});

test("account presentation does not turn missing credentials or status gaps into green success", () => {
  assert.equal(
    presentChannelAccountState({ ...base, configured: false, credentialState: "missing" }).state,
    "NEEDS_SETUP"
  );
  assert.equal(
    presentChannelAccountState({ ...base, authenticationRequired: true }).state,
    "NEEDS_SETUP"
  );
  assert.equal(
    presentChannelAccountState({ ...base, liveStatusAvailable: false }).state,
    "STATUS_UNAVAILABLE"
  );
  assert.equal(
    presentChannelAccountState({ ...base, lastError: "OpenClaw reported an error." }).state,
    "NEEDS_ATTENTION"
  );
});

test("logout is green only after live OpenClaw state confirms the account is no longer usable", () => {
  const status = {
    ts: 1,
    channelOrder: ["telegram"],
    channelLabels: {},
    channels: {},
    channelAccounts: {
      telegram: [{ accountId: "main", connected: false, linked: false, running: false, configured: false }]
    },
    channelDefaultAccountId: { telegram: "main" }
  };
  const confirmed = presentChannelLogoutResult({
    result: { loggedOut: true },
    status,
    provider: "telegram",
    accountId: "main"
  });
  const unverifiable = presentChannelLogoutResult({
    result: { loggedOut: true },
    status: null,
    statusError: "status unavailable",
    provider: "telegram",
    accountId: "main"
  });

  assert.equal(confirmed.tone, "success");
  assert.equal(unverifiable.tone, "warning");
});
