import assert from "node:assert/strict";
import { test } from "node:test";

import { POST } from "@/app/api/gateway/bind-recovery/route";
import { inspectGatewayBindRecovery, repairGatewayBindAddress } from "@/lib/openclaw/application/gateway-bind-recovery-service";

const plan = { previousAddress: "192.168.1.109", nextAddress: "192.168.1.146", port: 18789 };
const config = { path: "/tmp/agentos-gateway-recovery/openclaw.json", exists: true, valid: true };
const env = { OPENCLAW_CONFIG_PATH: config.path };
const observed = {
  config: { cli: config, daemon: config },
  service: { loaded: true, command: { programArguments: ["openclaw", "gateway", "run"] } },
  gateway: { bindMode: "custom", customBindHost: plan.previousAddress, port: plan.port },
  port: { status: "free", port: plan.port }
};

function interfaceAddress(address: string, netmask = "255.255.255.0") {
  return { address, netmask, cidr: null, internal: false, family: "IPv4" as const, mac: "" };
}

function fixture() {
  const operations: string[] = [];
  const values: Record<string, string> = {
    "gateway.mode": "local",
    "gateway.bind": "custom",
    "gateway.customBindHost": plan.previousAddress,
    "gateway.auth.mode": "token"
  };
  const dependencies = {
    readStatus: async () => observed as unknown,
    readConfig: async (key: string): Promise<unknown> => values[key],
    interfaces: () => ({ en0: [interfaceAddress(plan.nextAddress)], vm: [interfaceAddress("192.168.64.1")] }),
    save: async () => { operations.push("save"); },
    restart: async () => { operations.push("restart"); },
    verifyNative: async () => true,
    checkHealth: async (address: string, port: number) => {
      operations.push(`health ${address}:${port}`);
      return true;
    }
  };
  return { operations, dependencies };
}

test("detects the absent custom bind and previews the sole replacement on its subnet without writing", async () => {
  const { dependencies, operations } = fixture();
  assert.deepEqual(await inspectGatewayBindRecovery(dependencies, env), { state: "repairable", plan });
  assert.deepEqual(operations, []);
});

test("healthy, remote, and mismatched service targets cannot use offline repair", async () => {
  const { dependencies } = fixture();
  assert.deepEqual(await inspectGatewayBindRecovery(dependencies, { ...env, OPENCLAW_GATEWAY_URL: "ws://192.168.1.99:18789" }), { state: "none" });
  assert.deepEqual(await inspectGatewayBindRecovery({
    ...dependencies,
    readStatus: async () => ({ ...observed, port: { ...observed.port, status: "busy" } })
  }, env), { state: "none" });
  assert.deepEqual(await inspectGatewayBindRecovery({
    ...dependencies,
    readStatus: async () => ({ ...observed, config: { ...observed.config, daemon: { ...config, path: "/tmp/another/openclaw.json" } } })
  }, env), { state: "none" });
  assert.deepEqual(await inspectGatewayBindRecovery({
    ...dependencies,
    interfaces: () => ({ en0: [interfaceAddress(plan.previousAddress)], vm: [interfaceAddress("192.168.64.1")] })
  }, env), { state: "none" });
});

test("a missing or ambiguous replacement and unsupported auth require manual recovery", async () => {
  const { dependencies } = fixture();
  for (const en0 of [[], [interfaceAddress(plan.nextAddress), interfaceAddress("192.168.1.99")]]) {
    assert.deepEqual(await inspectGatewayBindRecovery({
      ...dependencies, interfaces: () => ({ en0 })
    }, env), { state: "manual", previousAddress: plan.previousAddress, reason: "ambiguous-network" });
  }
  assert.deepEqual(await inspectGatewayBindRecovery({
    ...dependencies, readConfig: async (key) => key === "gateway.auth.mode" ? "none" : dependencies.readConfig(key)
  }, env), { state: "manual", previousAddress: plan.previousAddress, reason: "unsupported-auth" });
  assert.deepEqual(await inspectGatewayBindRecovery({
    ...dependencies, readStatus: async () => ({
      ...observed, service: { loaded: true, command: { programArguments: ["openclaw", "gateway", "--auth=none"] } }
    })
  }, env), { state: "manual", previousAddress: plan.previousAddress, reason: "unsupported-auth" });
});

test("repair revalidates the reviewed address before using the CLI and verifies both listeners", async () => {
  const { dependencies, operations } = fixture();
  assert.deepEqual(await repairGatewayBindAddress({ ...plan, nextAddress: "192.168.1.77" }, dependencies, env), { outcome: "stale" });
  assert.deepEqual(operations, []);
  assert.deepEqual(await repairGatewayBindAddress(plan, dependencies, env), { outcome: "recovered", plan });
  assert.deepEqual(operations, ["save", "restart", "health 127.0.0.1:18789", "health 192.168.1.146:18789"]);
});

test("an uncertain write does not restart and liveness alone is not verified recovery", async () => {
  const { dependencies, operations } = fixture();
  assert.deepEqual(await repairGatewayBindAddress(plan, {
    ...dependencies, save: async () => { throw new Error("offline config write timed out"); }
  }, env), { outcome: "write-unverified" });
  assert.deepEqual(operations, []);
  assert.deepEqual(await repairGatewayBindAddress(plan, {
    ...dependencies, verifyNative: async () => false
  }, env), { outcome: "listening", plan });
  assert.deepEqual(await repairGatewayBindAddress(plan, {
    ...dependencies, checkHealth: async (address) => address === "127.0.0.1"
  }, env), { outcome: "saved", plan });
});

test("an unprotected local session and a hostile origin cannot submit a Gateway repair", async () => {
  const unprotected = new Request("http://agentos.test/api/gateway/bind-recovery", {
    method: "POST", headers: { host: "localhost:3000" }, body: JSON.stringify(plan)
  });
  // Use a loopback URL too for the cross-origin guard, without relying on auth rejection.
  const crossOrigin = new Request("http://localhost:3000/api/gateway/bind-recovery", {
    method: "POST", headers: { origin: "https://attacker.example" }, body: JSON.stringify(plan)
  });
  assert.equal((await POST(unprotected)).status, 403);
  assert.equal((await POST(crossOrigin)).status, 403);
});
