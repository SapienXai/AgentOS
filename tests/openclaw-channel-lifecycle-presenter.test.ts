import assert from "node:assert/strict";
import { test } from "node:test";

import type { OpenClawChannelStatusPayload } from "@/lib/openclaw/client/types";
import { presentChannelLifecycleResult } from "@/lib/openclaw/domains/channel-lifecycle-presenter";

const provider = "telegram";
const accountId = "operations";

test("presents a confirmed start only when live status reports running", () => {
  const presentation = presentChannelLifecycleResult({
    action: "start",
    provider,
    accountId,
    result: { started: true, outcome: { status: "handed-off" } },
    status: channelStatus({ running: true })
  });

  assert.deepEqual(
    { state: presentation.state, title: presentation.title, tone: presentation.tone },
    { state: "running", title: "Running", tone: "success" }
  );
});

test("keeps a handed-off start neutral until live status confirms it", () => {
  const presentation = presentChannelLifecycleResult({
    action: "start",
    provider,
    accountId,
    result: { started: false, outcome: { status: "handed-off" } },
    status: channelStatus({ running: false })
  });

  assert.equal(presentation.state, "requested");
  assert.equal(presentation.title, "Start requested");
  assert.notEqual(presentation.title, "Started");
});

test("presents retry outcomes as pending with useful native reasons", () => {
  const startInFlight = presentChannelLifecycleResult({
    action: "start",
    provider,
    accountId,
    result: { outcome: { status: "retry", reason: "start-in-flight" } },
    status: channelStatus({ running: false })
  });
  const stopInFlight = presentChannelLifecycleResult({
    action: "start",
    provider,
    accountId,
    result: { outcome: { status: "retry", reason: "stop-in-flight" } },
    status: channelStatus({ running: false })
  });
  const taskOwned = presentChannelLifecycleResult({
    action: "start",
    provider,
    accountId,
    result: { outcome: { status: "retry", reason: "task-owned" } },
    status: channelStatus({ running: false })
  });

  assert.equal(startInFlight.state, "pending");
  assert.equal(startInFlight.title, "Start pending");
  assert.match(startInFlight.detail, /another start/i);
  assert.match(stopInFlight.detail, /stop is still in progress/i);
  assert.match(taskOwned.detail, /runtime task currently owns/i);
});

test("presents skipped start reasons without treating them as transport failures", () => {
  const unlinked = presentChannelLifecycleResult({
    action: "start",
    provider,
    accountId,
    result: { outcome: { status: "skipped", reason: "unlinked" } },
    status: channelStatus({ running: false })
  });
  const disabled = presentChannelLifecycleResult({
    action: "start",
    provider,
    accountId,
    result: { outcome: { status: "skipped", reason: "disabled" } },
    status: channelStatus({ running: false })
  });

  assert.deepEqual(
    { state: unlinked.state, title: unlinked.title },
    { state: "skipped", title: "Needs authentication" }
  );
  assert.deepEqual(
    { state: disabled.state, title: disabled.title },
    { state: "skipped", title: "Account disabled" }
  );
});

test("confirms a stop only when the refreshed runtime is no longer running", () => {
  const stopped = presentChannelLifecycleResult({
    action: "stop",
    provider,
    accountId,
    result: { stopped: true },
    status: channelStatus({ running: false })
  });
  const stillRunning = presentChannelLifecycleResult({
    action: "stop",
    provider,
    accountId,
    result: { stopped: true },
    status: channelStatus({ running: true })
  });

  assert.deepEqual(
    { state: stopped.state, title: stopped.title },
    { state: "stopped", title: "Stopped" }
  );
  assert.deepEqual(
    { state: stillRunning.state, title: stillRunning.title },
    { state: "requested", title: "Stop requested" }
  );
  assert.match(stopped.detail, /credentials remain saved/i);
});

test("confirms restart only when both native operations and live status agree", () => {
  const restarted = presentChannelLifecycleResult({
    action: "restart",
    provider,
    accountId,
    result: {
      stop: { stopped: true },
      start: { started: true, outcome: { status: "handed-off" } }
    },
    status: channelStatus({ running: true })
  });
  const pending = presentChannelLifecycleResult({
    action: "restart",
    provider,
    accountId,
    result: {
      stop: { stopped: true },
      start: { started: false, outcome: { status: "retry", reason: "start-in-flight" } }
    },
    status: channelStatus({ running: false })
  });
  const skipped = presentChannelLifecycleResult({
    action: "restart",
    provider,
    accountId,
    result: {
      stop: { stopped: true },
      start: { started: false, outcome: { status: "skipped", reason: "unlinked" } }
    },
    status: channelStatus({ running: false })
  });

  assert.deepEqual(
    { state: restarted.state, title: restarted.title },
    { state: "running", title: "Connection restarted" }
  );
  assert.deepEqual(
    { state: pending.state, title: pending.title },
    { state: "pending", title: "Restart pending" }
  );
  assert.deepEqual(
    { state: skipped.state, title: skipped.title },
    { state: "skipped", title: "Restart incomplete" }
  );
});

test("does not claim a lifecycle success when live status could not be refreshed", () => {
  const presentation = presentChannelLifecycleResult({
    action: "start",
    provider,
    accountId,
    result: { started: true, outcome: { status: "handed-off" } },
    status: null,
    statusError: "OpenClaw channel status could not be refreshed."
  });

  assert.equal(presentation.state, "requested");
  assert.equal(presentation.title, "Start requested");
  assert.match(presentation.detail, /live status could not be refreshed/i);
});

function channelStatus(account: { running: boolean }): OpenClawChannelStatusPayload {
  return {
    ts: 1,
    channelOrder: [provider],
    channelLabels: {},
    channels: {},
    channelAccounts: {
      [provider]: [{ accountId, configured: true, connected: false, linked: false, ...account }]
    },
    channelDefaultAccountId: { [provider]: accountId }
  };
}
