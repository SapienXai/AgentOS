import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ExecutionTopologyUnavailableError,
  prepareExecutionEnvironment
} from "@/lib/openclaw/application/execution-topology-service";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { OPENCLAW_STATIC_METHOD_SCOPES } from "@/lib/openclaw/identity/contract";
import { createNativeGatewayTestClient } from "@/tests/helpers/fake-openclaw-gateway";

test("environments.prepare sends the exact 2026.9.4 request and accepts the exact result", async () => {
  const { client, gateway, fallback } = createNativeGatewayTestClient({
    gatewayOptions: { methods: ["environments.list", "environments.prepare"] }
  });
  gateway.route("environments.list", (_frame, context) => context.respond({
    environments: [{ id: "gateway", type: "local", status: "available", sessionHost: true }],
    profiles: [{ id: "profile-local", providerId: "local" }]
  }));
  gateway.route("environments.prepare", (_frame, context) => context.respond({
    environmentId: "worker:prepared-1",
    preparationKey: "preparation-key-1",
    reused: false
  }));

  const result = await client.prepareNativeExecutionEnvironment({
    profileId: "profile-local",
    projectPath: "/workspace/acme"
  });

  assert.deepEqual(result, {
    environmentId: "worker:prepared-1",
    preparationKey: "preparation-key-1",
    reused: false
  });
  assert.deepEqual(gateway.sentFrames.at(-1)?.params, {
    profileId: "profile-local",
    projectPath: "/workspace/acme"
  });
  assert.deepEqual(fallback.calls, []);
});

test("environments.prepare rejects malformed native results and never falls back to CLI", async () => {
  const { client, gateway, fallback } = createNativeGatewayTestClient({
    gatewayOptions: { methods: ["environments.prepare"] }
  });
  gateway.route("environments.prepare", (_frame, context) => context.respond({
    environmentId: "worker:prepared-1",
    reused: false
  }));

  await assert.rejects(
    client.prepareNativeExecutionEnvironment({ profileId: "profile-local", projectPath: "/workspace/acme" }),
    /invalid environments\.prepare payload/
  );
  assert.deepEqual(fallback.calls, []);
});

test("preparation is capability and profile gated before the native mutation", async () => {
  let prepareCalls = 0;
  const adapter = {
    listNativeExecutionEnvironments: async () => ({
      environments: [],
      profiles: [{ id: "profile-valid", providerId: "provider-local" }]
    }),
    prepareNativeExecutionEnvironment: async () => {
      prepareCalls += 1;
      return { environmentId: "worker:1", preparationKey: "key:1", reused: false };
    }
  };

  await assert.rejects(
    prepareExecutionEnvironment({ profileId: "profile-missing", projectPath: "/workspace/acme" }, { adapter: adapter as unknown as OpenClawAdapter }),
    /profile is not available/
  );
  assert.equal(prepareCalls, 0);

  await assert.rejects(
    prepareExecutionEnvironment({ profileId: "profile-valid", projectPath: "/workspace/acme" }, {
      adapter: { listNativeExecutionEnvironments: adapter.listNativeExecutionEnvironments } as unknown as OpenClawAdapter
    }),
    ExecutionTopologyUnavailableError
  );
  assert.equal(prepareCalls, 0);
});

test("preparation uses the operator.admin native authorization contract", () => {
  assert.deepEqual(OPENCLAW_STATIC_METHOD_SCOPES["environments.prepare"], ["operator.admin"]);
});
