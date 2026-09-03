import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AgentsCreateParamsSchema,
  ChatSendParamsSchema,
  HelloOkSchema,
  SessionsAbortParamsSchema
} from "@openclaw/gateway-protocol/schema";
import {
  GATEWAY_CLIENT_CAPS,
  GATEWAY_CLIENT_IDS,
  GATEWAY_CLIENT_MODES
} from "@openclaw/gateway-protocol/client-info";

import {
  buildConnectParams,
  buildDeviceAuthPayloadV3,
  normalizeDeviceMetadataForAuth
} from "@/lib/openclaw/client/native-ws-gateway-auth";
import { resolveGatewayClientId } from "@/lib/openclaw/client/openclaw-protocol";
import { getOpenClawGatewayCompatibilityOperation } from "@/lib/openclaw/client/gateway-compatibility";
import {
  NativeGatewayRequestError,
  normalizeClientError
} from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  resolveGatewayEventSupportState,
  resolveGatewayMethodSupportState,
  supportsGatewayMethod
} from "@/lib/openclaw/client/native-ws-gateway-protocol";
import { parseGatewayFrameData, waitForConnectChallenge } from "@/lib/openclaw/client/native-ws-gateway-wire";
import {
  buildChatInjectParams,
  buildSessionSteerParams
} from "@/lib/openclaw/client/native-ws-gateway-mappers";
import {
  MAX_CONTROL_PROTOCOL_VERSION,
  MIN_CONTROL_PROTOCOL_VERSION,
  type WebSocketLike
} from "@/lib/openclaw/client/native-ws-gateway-types";
import type { OpenClawGatewayClient } from "@/lib/openclaw/client/types";

test("AgentOS derives the supported control range and roster capability from the official 8.2 package", () => {
  assert.equal(MIN_CONTROL_PROTOCOL_VERSION, 4);
  assert.equal(MAX_CONTROL_PROTOCOL_VERSION, 4);
  assert.equal(GATEWAY_CLIENT_CAPS.AGENT_KIND, "agent-kind");
  assert.equal(GATEWAY_CLIENT_CAPS.TOOL_EVENTS, "tool-events");
});

test("official 8.2 schemas keep AgentOS native payloads closed and exact", () => {
  assert.deepEqual(HelloOkSchema.required, ["type", "protocol", "server", "features", "snapshot", "auth", "policy"]);
  assert.deepEqual(AgentsCreateParamsSchema.required, ["name"]);
  assert.equal((AgentsCreateParamsSchema as { additionalProperties?: boolean }).additionalProperties, false);
  assert.deepEqual(SessionsAbortParamsSchema.required, undefined);
  assert.equal((SessionsAbortParamsSchema as { additionalProperties?: boolean }).additionalProperties, false);
  assert.deepEqual(ChatSendParamsSchema.required, ["sessionKey", "message", "idempotencyKey"]);
  assert.equal((ChatSendParamsSchema as { additionalProperties?: boolean }).additionalProperties, false);
});

test("modern steering and injection builders match their distinct 8.2 identities", () => {
  const steer = buildSessionSteerParams({
    key: "agent:worker-a:main",
    message: "Continue",
    idempotencyKey: "submission-1"
  });
  const inject = buildChatInjectParams({
    sessionKey: "agent:worker-a:main",
    message: "Reference only",
    label: "operator-context"
  });

  assert.deepEqual(steer, {
    sessionKey: "agent:worker-a:main",
    agentId: undefined,
    sessionId: undefined,
    message: "Continue",
    queueMode: "steer",
    idempotencyKey: "submission-1"
  });
  assert.deepEqual(inject, {
    sessionKey: "agent:worker-a:main",
    agentId: undefined,
    message: "Reference only",
    label: "operator-context"
  });
  assert.throws(
    () => buildSessionSteerParams({ message: "No target" }),
    /exact session key/
  );
  assert.throws(
    () => buildChatInjectParams({ message: "No target" }),
    /exact session key/
  );
});

test("AgentOS uses the official client registry and only implemented capabilities", async () => {
  const fallback = { getConfig: async () => null } as unknown as OpenClawGatewayClient;
  const connect = await buildConnectParams(
    fallback,
    { token: "gateway-token", clientName: GATEWAY_CLIENT_IDS.GATEWAY_CLIENT },
    "ws://gateway.example",
    {}
  );

  assert.deepEqual(connect.params.client, {
    id: GATEWAY_CLIENT_IDS.GATEWAY_CLIENT,
    version: "agentos",
    platform: process.platform,
    mode: GATEWAY_CLIENT_MODES.BACKEND,
    instanceId: undefined
  });
  assert.deepEqual(connect.params.caps, [GATEWAY_CLIENT_CAPS.AGENT_KIND, GATEWAY_CLIENT_CAPS.TOOL_EVENTS]);
  assert.throws(
    () => resolveGatewayClientId("not-a-registered-client"),
    /Unsupported OpenClaw Gateway client id/
  );
});

test("AgentOS device-auth metadata normalization matches the official 8.2 helper", () => {
  const vectors: Array<[string | null | undefined, string]> = [
    [undefined, ""],
    [null, ""],
    ["", ""],
    ["   ", ""],
    ["  DARWIN  ", "darwin"],
    [process.platform, process.platform.toLowerCase()],
    [" MacBookPro18,3 ", "macbookpro18,3"],
    [" Darwin|ARM64 ", "darwin|arm64"]
  ];

  for (const [input, expected] of vectors) {
    assert.equal(normalizeDeviceMetadataForAuth(input), expected, input ?? "missing");
  }

  assert.equal(
    buildDeviceAuthPayloadV3({
      deviceId: "device-1",
      clientId: "gateway-client",
      clientMode: "backend",
      role: "operator",
      scopes: ["operator.read"],
      signedAtMs: 42,
      token: "token",
      nonce: "nonce",
      platform: " Darwin|ARM64 ",
      deviceFamily: " MacBookPro18,3 "
    }),
    "v3|device-1|gateway-client|backend|operator|operator.read|42|token|nonce|darwin|arm64|macbookpro18,3"
  );
});

test("the 8.2 task contract uses snapshot RPCs plus the raw task event", () => {
  const taskEvents = getOpenClawGatewayCompatibilityOperation("taskEvents");

  assert.deepEqual(taskEvents?.methods, ["tasks.list", "tasks.get"]);
  assert.deepEqual(taskEvents?.events, ["task"]);
});

test("official Gateway discovery omission remains unknown rather than unsupported", () => {
  const hello = { features: { methods: ["status"], events: ["sessions.changed"] } };

  assert.equal(resolveGatewayMethodSupportState(hello, "models.list"), "known-by-contract");
  assert.equal(resolveGatewayMethodSupportState(hello, "future.method"), "unknown-not-advertised");
  assert.equal(resolveGatewayEventSupportState(hello, "session.message"), "unknown-not-advertised");
  assert.equal(supportsGatewayMethod(hello, "models.list"), true);
  assert.equal(resolveGatewayMethodSupportState(hello, "models.list", { kind: "unsupported" }), "proven-unsupported");
});

test("native wire parsing uses official frame guards and preserves legacy response compatibility", () => {
  assert.deepEqual(parseGatewayFrameData(JSON.stringify({
    type: "event",
    event: "connect.challenge",
    payload: { nonce: "nonce", ts: 42 }
  })), {
    type: "event",
    event: "connect.challenge",
    payload: { nonce: "nonce", ts: 42 }
  });

  const frame = parseGatewayFrameData(JSON.stringify({
    type: "res",
    id: 7,
    ok: false,
    error: { message: "unknown method: models.list" }
  }));
  assert.equal(frame?.type, "res");
  assert.equal((frame as { id?: string }).id, "7");
  assert.equal((frame as { error?: { code?: string } }).error?.code, "UNKNOWN");
});

test("connect challenge timestamp is validated and used for v3 device signatures", async () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const socket: WebSocketLike = {
    readyState: 1,
    send: () => undefined,
    close: () => undefined,
    addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: (type) => listeners.delete(type)
  };
  const challenge = waitForConnectChallenge(socket, 100);
  listeners.get("message")?.({
    data: JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: " nonce ", ts: 42 } })
  });
  assert.deepEqual(await challenge, { nonce: "nonce", ts: 42 });

  const invalidChallenge = waitForConnectChallenge(socket, 100);
  listeners.get("message")?.({
    data: JSON.stringify({ type: "event", event: "connect.challenge", payload: { nonce: "nonce", ts: -1 } })
  });
  await assert.rejects(invalidChallenge, /valid timestamp/);

  const stateDir = await mkdtemp(join(tmpdir(), "agentos-openclaw-device-"));
  const previousStateDir = process.env.OPENCLAW_STATE_DIR;
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  try {
    process.env.OPENCLAW_STATE_DIR = stateDir;
    await mkdir(join(stateDir, "identity"), { recursive: true });
    await writeFile(join(stateDir, "identity", "device.json"), JSON.stringify({
      deviceId: "device-1",
      publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
      privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" })
    }));
    await writeFile(join(stateDir, "identity", "device-auth.json"), JSON.stringify({
      deviceId: "device-1",
      tokens: { operator: { token: "device-token" } }
    }));

    const fallback = { getConfig: async () => null } as unknown as OpenClawGatewayClient;
    const connect = await buildConnectParams(
      fallback,
      {},
      "ws://127.0.0.1:18789",
      {},
      { nonce: "nonce", ts: 42 }
    );

    assert.equal((connect.params.device as { signedAt?: number }).signedAt, 42);
    assert.equal((connect.params.device as { nonce?: string }).nonce, "nonce");
  } finally {
    if (previousStateDir === undefined) {
      delete process.env.OPENCLAW_STATE_DIR;
    } else {
      process.env.OPENCLAW_STATE_DIR = previousStateDir;
    }
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("structured Gateway errors keep unsupported and scope denial distinct", () => {
  const scopeError = new NativeGatewayRequestError(
    "FORBIDDEN: missing scope",
    "config.patch",
    true,
    {
      cause: {
        type: "res",
        id: "request-1",
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "missing scope",
          details: { code: "MISSING_SCOPE", missingScope: "operator.admin", requiredScopes: ["operator.admin"] }
        }
      }
    }
  );
  const unsupportedError = new NativeGatewayRequestError(
    "INVALID_REQUEST: unknown method",
    "future.method",
    true,
    {
      cause: {
        type: "res",
        id: "request-2",
        ok: false,
        error: { code: "INVALID_REQUEST", message: "unknown method: future.method" }
      }
    }
  );

  assert.equal(normalizeClientError(scopeError).kind, "scope-limited");
  assert.equal(normalizeClientError(unsupportedError).kind, "unsupported");
});
