import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { setOpenClawGatewayClientForTesting } from "@/lib/openclaw/client/gateway-client-factory";
import { OpenClawAuthorizationService } from "@/lib/openclaw/identity/authorization";
import {
  OPENCLAW_8_1_IDENTITY_INVENTORY,
  OPENCLAW_CAPABILITY_SCOPES,
  OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT,
  OPENCLAW_IDENTITY_CONTRACT_VERSION
} from "@/lib/openclaw/identity/contract";
import type { OpenClawGatewayClient } from "@/lib/openclaw/client/types";
import type { OpenClawOperatorIdentity } from "@/lib/openclaw/identity/types";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";

function fakeClient(identity: OpenClawOperatorIdentity) {
  return {
    getOperatorIdentity: async () => ({
      ...identity,
      requestedScopes: [...identity.requestedScopes],
      grantedScopes: [...identity.grantedScopes]
    })
  } as unknown as OpenClawGatewayClient;
}

function nativeIdentity(grantedScopes: string[], requestedScopes = grantedScopes): OpenClawOperatorIdentity {
  return {
    requestedRole: "operator",
    role: "operator",
    requestedScopes,
    grantedScopes,
    grantedScopesKnown: true,
    deviceId: "device-1",
    connectionId: "connection-1",
    authenticated: true,
    source: "native-handshake"
  };
}

test("8.1 authorization uses granted scopes, not requested scopes", async () => {
  const service = new OpenClawAuthorizationService(fakeClient(nativeIdentity(
    ["operator.read"],
    ["operator.admin", "operator.read", "operator.write"]
  )));

  assert.equal((await service.authorizeCapability("canRead")).state, "allowed");
  assert.equal((await service.authorizeCapability("canAdmin")).state, "denied");
  assert.equal((await service.authorizeCapability("canWrite")).state, "denied");
  assert.equal((await service.authorizeCapability("canAskQuestions")).state, "denied");
  assert.deepEqual((await service.authorizeCapability("canAdmin")).grantedScopes, ["operator.read"]);
});

test("8.1 dedicated scopes remain distinct and dynamic operations stay runtime-required", async () => {
  const service = new OpenClawAuthorizationService(fakeClient(nativeIdentity([
    "operator.read",
    "operator.write",
    "operator.questions",
    "operator.talk"
  ])));

  assert.equal((await service.authorizeMethod("question.list")).state, "allowed");
  assert.equal((await service.authorizeMethod("device.pair.list")).state, "denied");
  assert.equal((await service.authorizeMethod("talk.client.create")).state, "allowed");
  assert.equal((await service.authorizeMethod("talk.config", { includeSecrets: true })).state, "denied");
  assert.equal((await service.authorizeMethod("sessions.patch", { key: "agent:main:main" })).state, "runtime-required");
  assert.equal((await service.authorizeMethod("node.invoke", { nodeId: "node-1", command: "system.run" })).state, "runtime-required");
  assert.equal((await service.authorizeMethod("config.patch", { raw: {} })).state, "denied");
});

test("missing native handshake identity is unknown rather than permission", async () => {
  const service = new OpenClawAuthorizationService(fakeClient({
    requestedRole: "operator",
    role: null,
    requestedScopes: ["operator.admin"],
    grantedScopes: [],
    grantedScopesKnown: false,
    deviceId: null,
    connectionId: null,
    authenticated: false,
    source: "unavailable"
  }));

  const result = await service.authorizeCapability("canAdmin");
  assert.equal(result.state, "unknown");
  assert.deepEqual(result.grantedScopes, []);
  assert.match(result.reason, /not exposed|not.*authenticated/i);
});

test("the application preflight blocks a known Gateway denial and derives actor server-side", async () => {
  const previous = {
    runtime: process.env.AGENTOS_RUNTIME_DIR,
    nodeEnv: process.env.NODE_ENV
  };
  const mutableEnv = process.env as Record<string, string | undefined>;
  mutableEnv.AGENTOS_RUNTIME_DIR = await mkdtemp(path.join(tmpdir(), "agentos-preflight-"));
  mutableEnv.NODE_ENV = "development";
  setOpenClawGatewayClientForTesting(fakeClient(nativeIdentity(["operator.read"])));

  try {
    const denied = await requireAgentOsOpenClawPreflight(
      new Request("http://127.0.0.1:3000/api/agents", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          "x-agentos-actor-id": "forged",
          "x-agentos-role": "admin",
          "x-agentos-scopes": "operator.admin"
        }
      }),
      {
        operation: "agent.create",
        method: "agents.create",
        targetKind: "agent"
      }
    );
    assert.equal("response" in denied, true);
    if ("response" in denied) {
      assert.equal(denied.response.status, 403);
      assert.equal((await denied.response.json()).code, "openclaw-capability-denied");
    }

    setOpenClawGatewayClientForTesting(fakeClient(nativeIdentity(["operator.admin", "operator.read"])));
    const allowed = await requireAgentOsOpenClawPreflight(
      new Request("http://127.0.0.1:3000/api/agents", { method: "POST", headers: { host: "127.0.0.1:3000" } }),
      {
        operation: "agent.create",
        method: "agents.create",
        targetKind: "agent"
      }
    );
    assert.equal("actor" in allowed, true);
    if ("actor" in allowed) {
      assert.equal(allowed.actor.actorId, "unprotected-local");
      assert.equal(allowed.actor.agentOsRole, null);
      assert.equal(allowed.authorization.state, "allowed");
      assert.equal(allowed.context.actorId, allowed.actor.actorId);
      assert.equal(allowed.context.operation, "agent.create");
      assert.equal(allowed.context.openClaw.connectionId, "connection-1");
    }
  } finally {
    setOpenClawGatewayClientForTesting(null);
    if (previous.runtime === undefined) delete mutableEnv.AGENTOS_RUNTIME_DIR;
    else mutableEnv.AGENTOS_RUNTIME_DIR = previous.runtime;
    if (previous.nodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous.nodeEnv;
  }
});

test("identity inventory pins the 8.1 contract and current AgentOS use", () => {
  assert.equal(OPENCLAW_IDENTITY_CONTRACT_VERSION, "2026.8.1");
  assert.equal(OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT, "ea806575e6450e4d1efdfc72c19f04be982a1b9b");
  assert.deepEqual(OPENCLAW_CAPABILITY_SCOPES.canUseTalkSecrets, ["operator.talk.secrets"]);
  assert.ok(OPENCLAW_8_1_IDENTITY_INVENTORY.some((entry) => entry.methodOrField === "users.list"));
  assert.ok(OPENCLAW_8_1_IDENTITY_INVENTORY.some((entry) => entry.methodOrField === "sessions.create/patch/delete/dispatch" && entry.dynamicAuthorization));
});
