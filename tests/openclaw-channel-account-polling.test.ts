import assert from "node:assert/strict";
import { test } from "node:test";

import { pollChannelAccount } from "@/lib/openclaw/domains/channel-account-polling";

type AccountState = "STARTING" | "ONLINE" | "NEEDS_ATTENTION";

test("channel account polling returns immediately when the account is online", async () => {
  let reads = 0;

  const result = await pollChannelAccount({
    delaysMs: [0, 1],
    read: async () => {
      reads += 1;
      return "ONLINE" as const;
    },
    isTerminal: (state) => state === "ONLINE"
  });

  assert.equal(result, "ONLINE");
  assert.equal(reads, 1);
});

test("channel account polling waits for a delayed online state", async () => {
  const states: AccountState[] = ["STARTING", "STARTING", "ONLINE"];
  let reads = 0;

  const result = await pollChannelAccount({
    delaysMs: [0, 1, 1],
    read: async () => states[reads++] ?? "ONLINE",
    isTerminal: (state) => state === "ONLINE" || state === "NEEDS_ATTENTION"
  });

  assert.equal(result, "ONLINE");
  assert.equal(reads, 3);
});

test("channel account polling stops immediately on a definitive failure", async () => {
  let reads = 0;

  const result = await pollChannelAccount({
    delaysMs: [0, 20],
    read: async () => {
      reads += 1;
      return "NEEDS_ATTENTION" as const;
    },
    isTerminal: (state) => state === "NEEDS_ATTENTION"
  });

  assert.equal(result, "NEEDS_ATTENTION");
  assert.equal(reads, 1);
});

test("channel account polling returns the latest state after its bounded window", async () => {
  let reads = 0;

  const result = await pollChannelAccount({
    delaysMs: [0, 1, 1],
    read: async () => {
      reads += 1;
      return `STARTING-${reads}`;
    },
    isTerminal: () => false
  });

  assert.equal(result, "STARTING-3");
  assert.equal(reads, 3);
});

test("channel account polling is cancel-safe", async () => {
  const controller = new AbortController();
  const polling = pollChannelAccount({
    delaysMs: [0, 50],
    signal: controller.signal,
    read: async () => "STARTING" as const,
    isTerminal: () => false
  });

  setTimeout(() => controller.abort(), 5);

  await assert.rejects(polling, (error: unknown) => error instanceof Error && error.name === "AbortError");
});
