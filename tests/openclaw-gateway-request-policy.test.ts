import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AgentOsGatewayRequestPolicy,
  buildGatewayRequestCacheKey
} from "@/lib/openclaw/client/gateway-client";

test("AgentOS request policy uses deterministic method and parameter cache identity", () => {
  assert.equal(
    buildGatewayRequestCacheKey("config.get", { a: 1, b: 2 }),
    buildGatewayRequestCacheKey("config.get", { b: 2, a: 1 })
  );
});

test("AgentOS request policy does not let an old-generation read populate new cache state", async () => {
  let state = { lifecycleState: "connected", generation: 1 };
  let sendCount = 0;
  let resolveOldRead: (payload: { value: string }) => void = () => {
    throw new Error("The controlled read resolver was not initialized.");
  };
  const policy = new AgentOsGatewayRequestPolicy({ now: () => 1_000 });
  const connection = () => ({
    ...state,
    getCurrentState: () => ({ ...state })
  });

  const oldRead = policy.request(
    "sessions.list",
    {},
    {},
    { safety: "read" },
    () => {
      sendCount += 1;
      return new Promise<{ value: string }>((resolve) => {
        resolveOldRead = resolve;
      });
    },
    connection()
  );

  await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
  state = { lifecycleState: "reconnecting", generation: 1 };
  state = { lifecycleState: "connected", generation: 2 };
  resolveOldRead({ value: "old-generation" });
  assert.deepEqual(await oldRead, { value: "old-generation" });
  assert.equal(policy.getDiagnostics().cachedReadRequestCount, 0);

  assert.deepEqual(
    await policy.request(
      "sessions.list",
      {},
      {},
      { safety: "read" },
      async () => {
        sendCount += 1;
        return { value: "new-generation" };
      },
      connection()
    ),
    { value: "new-generation" }
  );
  assert.equal(sendCount, 2);
});
