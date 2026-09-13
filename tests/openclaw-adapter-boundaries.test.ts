import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  GatewayBackedOpenClawAdapter,
  type OpenClawGatewaySurfacePort
} from "@/lib/openclaw/adapter/openclaw-adapter";
import type {
  OpenClawCommandOptions,
  OpenClawGatewayClient
} from "@/lib/openclaw/client/types";

const root = process.cwd();

test("the gateway surface port delegates read-only probes through the captured client", async () => {
  const calls: Array<{
    method: string;
    params: Record<string, unknown>;
    options: OpenClawCommandOptions;
    policy: unknown;
  }> = [];
  const client = {
    callNative: async <TPayload>(
      method: string,
      params: Record<string, unknown>,
      options: OpenClawCommandOptions,
      policy: unknown
    ) => {
      calls.push({ method, params, options, policy });
      return { ok: true } as TPayload;
    }
  } as unknown as OpenClawGatewayClient;
  const adapter = new GatewayBackedOpenClawAdapter(() => client);
  const port: OpenClawGatewaySurfacePort = adapter.getGatewaySurfacePort!();

  assert.equal(port, adapter);
  assert.equal(port.canProbeNativeGateway(), true);
  assert.deepEqual(
    await port.probeNativeGateway<{ ok: boolean }>("sessions.list", { limit: 1 }, { timeoutMs: 250 }),
    { ok: true }
  );
  assert.deepEqual(calls, [{
    method: "sessions.list",
    params: { limit: 1 },
    options: { timeoutMs: 250 },
    policy: { safety: "read", timeoutMs: 250, allowCliFallback: false }
  }]);
});

test("application gateway surface service does not reach around the adapter", async () => {
  const surface = await readFile(`${root}/lib/openclaw/application/gateway-surface-service.ts`, "utf8");

  assert.match(surface, /import \{ getOpenClawAdapter, type OpenClawGatewaySurfacePort \}/);
  assert.doesNotMatch(surface, /from "@\/lib\/openclaw\/client\/gateway-client-factory"/);
  assert.doesNotMatch(surface, /from "@\/lib\/openclaw\/client\/native-ws-gateway-client"/);
  assert.doesNotMatch(surface, /\.callNative/);
});
