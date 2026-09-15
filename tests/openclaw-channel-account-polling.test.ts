import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyChannelAccountPollState,
  pollChannelAccount
} from "@/lib/openclaw/domains/channel-account-polling";

test("start polling keeps stale STOPPED snapshots retryable until ONLINE", async () => {
  const states = ["STOPPED", "STOPPED", "STARTING", "ONLINE"] as const;
  let reads = 0;

  const result = await pollChannelAccount({
    delaysMs: [0, 1, 1, 1],
    read: async () => states[reads++] ?? "ONLINE",
    classify: (state) => classifyChannelAccountPollState({ operation: "start", state })
  });

  assert.equal(result.value, "ONLINE");
  assert.equal(result.classification, "SUCCESS");
  assert.equal(result.timedOut, false);
  assert.equal(reads, 4);
});

test("start polling keeps READY retryable while OpenClaw starts the account", async () => {
  const states = ["READY", "STARTING", "ONLINE"] as const;
  let reads = 0;

  const result = await pollChannelAccount({
    delaysMs: [0, 1, 1],
    read: async () => states[reads++] ?? "ONLINE",
    classify: (state) => classifyChannelAccountPollState({ operation: "start", state })
  });

  assert.equal(result.value, "ONLINE");
  assert.equal(result.classification, "SUCCESS");
  assert.equal(reads, 3);
});

test("start polling continues through STARTING snapshots", async () => {
  const states = ["STARTING", "STARTING", "ONLINE"] as const;
  let reads = 0;

  const result = await pollChannelAccount({
    delaysMs: [0, 1, 1],
    read: async () => states[reads++] ?? "ONLINE",
    classify: (state) => classifyChannelAccountPollState({ operation: "start", state })
  });

  assert.equal(result.value, "ONLINE");
  assert.equal(result.classification, "SUCCESS");
  assert.equal(reads, 3);
});

test("post-create polling treats READY and STOPPED as account-found handoff states", () => {
  assert.equal(
    classifyChannelAccountPollState({ operation: "post-create", state: "READY" }),
    "SUCCESS"
  );
  assert.equal(
    classifyChannelAccountPollState({ operation: "post-create", state: "STOPPED" }),
    "SUCCESS"
  );
  assert.equal(
    classifyChannelAccountPollState({ operation: "post-create", state: "STARTING" }),
    "RETRY"
  );
  assert.equal(
    classifyChannelAccountPollState({ operation: "post-create", state: "STATUS_UNAVAILABLE" }),
    "RETRY"
  );
  assert.equal(
    classifyChannelAccountPollState({ operation: "post-create", state: "NEEDS_SETUP" }),
    "FAILURE"
  );
});

test("start polling stops immediately on a definitive failure", async () => {
  let reads = 0;

  const result = await pollChannelAccount({
    delaysMs: [0, 20],
    read: async () => {
      reads += 1;
      return "NEEDS_ATTENTION" as const;
    },
    classify: (state) => classifyChannelAccountPollState({ operation: "start", state })
  });

  assert.equal(result.value, "NEEDS_ATTENTION");
  assert.equal(result.classification, "FAILURE");
  assert.equal(result.timedOut, false);
  assert.equal(reads, 1);
});

test("start polling returns the latest STOPPED state after its bounded timeout", async () => {
  let reads = 0;

  const result = await pollChannelAccount({
    delaysMs: [0, 1, 1],
    read: async () => {
      reads += 1;
      return "STOPPED" as const;
    },
    classify: (state) => classifyChannelAccountPollState({ operation: "start", state })
  });

  assert.equal(result.value, "STOPPED");
  assert.equal(result.classification, "RETRY");
  assert.equal(result.timedOut, true);
  assert.equal(reads, 3);
});

test("channel account polling is cancel-safe", async () => {
  const controller = new AbortController();
  const polling = pollChannelAccount({
    delaysMs: [0, 50],
    signal: controller.signal,
    read: async () => "STARTING" as const,
    classify: (state) => classifyChannelAccountPollState({ operation: "start", state })
  });

  setTimeout(() => controller.abort(), 5);

  await assert.rejects(polling, (error: unknown) => error instanceof Error && error.name === "AbortError");
});
